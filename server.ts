import express from "express";
import type { Response as ExpressResponse } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";
import { ProxyAgent, setGlobalDispatcher, Agent } from "undici";
import { SSEEvent, SecurityAudit, CorrectnessAudit, DependencyAudit, EngineeringScore } from "./src/types.js";
import { getPhase1SystemInstruction, getPhase1UserPrompt, getSecurityPrompt, getCorrectnessPrompt, getDependencyPrompt, getEngineeringPrompts, buildPhase2UserPrompt } from "./server/prompts.js";
import { inferSecurityFromDiff, inferCorrectnessFromDiff, inferDependencyFromDiff, inferMaintainabilityFromDiff, inferArchitectureFromDiff, inferPerformanceFromDiff, inferRobustnessFromDiff, inferImpactFromDiff, inferTestQualityFromDiff } from "./server/fallback.js";

dotenv.config();
if (!process.env.GEMINI_API_KEY) {
  const altEnvPath = path.resolve(".env.example");
  if (fs.existsSync(altEnvPath)) {
    dotenv.config({ path: altEnvPath });
    console.log("Loaded environment variables from .env.example fallback");
  }
}

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (proxyUrl) {
  try {
    setGlobalDispatcher(new ProxyAgent({ uri: proxyUrl }));
    console.log(`HTTPS Proxy enabled: ${proxyUrl}`);
  } catch (e) {
    console.warn("Failed to configure HTTPS proxy:", e);
  }
}

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_Key;
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = "deepseek-v4-pro";

const directDispatcher = new Agent();

async function callDeepSeekAPI(systemInstruction: string, userPrompt: string): Promise<string> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error(
      "DEEPSEEK_API_KEY environment variable is not defined. Please configure it in Settings > Secrets."
    );
  }

  const response = await fetch(DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
    dispatcher: directDispatcher,
    } as RequestInit & { dispatcher: Agent });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API error (${response.status}): ${errorText}`);
  }

  const data: any = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("No response content received from DeepSeek API.");
  }
  return content;
}

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "15mb" }));

function decodeGitOctalEscapes(diffText: string): string {
  return diffText.replace(
    /"([^"]*\\[0-7]{3}[^"]*)"/g,
    (match) => {
      const inner = match.slice(1, -1);
      const bytes: number[] = [];
      let i = 0;
      while (i < inner.length) {
        if (inner[i] === '\\' && /^[0-7]{3}$/.test(inner.slice(i + 1, i + 4))) {
          bytes.push(parseInt(inner.slice(i + 1, i + 4), 8));
          i += 4;
        } else {
          bytes.push(inner.charCodeAt(i));
          i++;
        }
      }
      const decoder = new TextDecoder('utf-8');
      return '"' + decoder.decode(new Uint8Array(bytes)) + '"';
    }
  );
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout: number = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseGithubPr(urlStr: string) {
  try {
    const url = new URL(urlStr);
    if (!url.hostname.includes("github.com")) return null;
    
    const pathname = url.pathname.replace(/\/+$/, "");
    const parts = pathname.split("/").filter(Boolean);
    
    const pullIndex = parts.indexOf("pull");
    if (pullIndex === -1 || !parts[pullIndex + 1]) {
      return null;
    }
    
    const pullNumber = parts[pullIndex + 1];
    if (!/^\d+$/.test(pullNumber)) {
      return null;
    }
    
    if (pullIndex >= 2) {
      const owner = parts[pullIndex - 2];
      const repo = parts[pullIndex - 1];
      if (owner && repo) {
        return { owner, repo, pullNumber };
      }
    }
    
    const match = urlStr.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
    if (match) {
      return {
        owner: match[1],
        repo: match[2],
        pullNumber: match[3],
      };
    }
  } catch (e) {
    return null;
  }
  return null;
}

// Lazy load Gemini client to avoid crashes on startup if key is missing
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY environment variable is not defined. Please configure it in Settings > Secrets."
    );
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

async function fetchPrMetadata(owner: string, repo: string, pullNumber: string): Promise<{
  owner: string; repo: string; pullNumber: number;
  title: string; description: string;
  author: string; createdAt: string;
  linkedIssues: { number: number; title: string }[];
}> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "AI-Studio-PR-Reviewer",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const prUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`;
  const prRes = await fetchWithTimeout(prUrl, { headers }, 10000);
  if (!prRes.ok) {
    throw new Error(`GitHub API responded with status ${prRes.status}`);
  }

  const prData: any = await prRes.json();
  const prNumber = parseInt(pullNumber, 10);

  const issueRefs = [...((prData.body || '') as string).matchAll(/#(\d+)/g)];
  const linkedIssues = issueRefs.map(m => ({ number: parseInt(m[1]), title: '' }));

  return {
    owner,
    repo,
    pullNumber: prNumber,
    title: prData.title || '',
    description: (prData.body || '').substring(0, 2000),
    author: prData.user?.login || '',
    createdAt: prData.created_at || '',
    linkedIssues,
  };
}

export function detectCodeBlocks(diffText: string): {
  type: 'function' | 'class' | 'interface' | 'export';
  name: string;
  filePath: string;
  lineNumber: number;
}[] {
  const blocks: {
    type: 'function' | 'class' | 'interface' | 'export';
    name: string;
    filePath: string;
    lineNumber: number;
  }[] = [];
  const lines = diffText.split('\n');
  let currentFile = '';
  let newLineNum = 0;

  const patterns: { type: 'function' | 'class' | 'interface' | 'export'; regex: RegExp }[] = [
    { type: 'function',  regex: /^\+\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/ },
    { type: 'function',  regex: /^\+\s*(?:export\s+)?(?:static\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{?\s*$/ },
    { type: 'function',  regex: /^\+\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/ },
    { type: 'class',     regex: /^\+\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/ },
    { type: 'interface', regex: /^\+\s*(?:export\s+)?interface\s+(\w+)/ },
    { type: 'export',    regex: /^\+\s*export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/ },
  ];

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/b\/(.+)$/);
      currentFile = match ? match[1] : '';
      newLineNum = 0;
      continue;
    }

    if (line.startsWith('@@ -')) {
      const match = line.match(/\+(\d+)/);
      newLineNum = match ? parseInt(match[1], 10) - 1 : 0;
      continue;
    }

    if (!currentFile) continue;

    if (line.startsWith('+')) {
      newLineNum++;
      for (const p of patterns) {
        const match = line.match(p.regex);
        if (match) {
          const dup = blocks.find(b => b.filePath === currentFile && b.lineNumber === newLineNum);
          if (!dup) {
            blocks.push({ type: p.type, name: match[1], filePath: currentFile, lineNumber: newLineNum });
            break;
          }
        }
      }
    } else if (line.startsWith(' ')) {
      newLineNum++;
    }
  }

  return blocks;
}

export function inferSemanticsFromDiff(diffText: string, codeBlocks: ReturnType<typeof detectCodeBlocks>): {
  intent: string;
  impactScope: string[];
  riskLevel: 'low' | 'medium' | 'high';
} {
  const lines = diffText.split('\n');

  const filePaths: string[] = [];
  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      const p = line.slice(6);
      if (p && p !== '/dev/null') filePaths.push(p);
    } else if (line.startsWith('--- a/')) {
      const p = line.slice(6);
      if (p && p !== '/dev/null' && !filePaths.includes(p)) filePaths.push(p);
    }
  }

  const dirNames = [...new Set(filePaths.map(p => {
    const parts = p.split('/');
    if (parts.length >= 3) return parts.slice(1, 3).join('/');
    if (parts.length >= 2) return parts[0];
    return p.replace(/\.[^.]+$/, '');
  }))];

  const moduleKeywords: Record<string, string> = {
    'auth': '认证模块',
    'login': '登录模块',
    'user': '用户模块',
    'api': 'API接口',
    'db': '数据库',
    'database': '数据库',
    'config': '系统配置',
    'router': '路由层',
    'middleware': '中间件',
    'component': '前端组件',
    'util': '工具函数',
    'test': '测试模块',
    'ci': 'CI/CD流水线',
    'docker': '容器部署',
    'package': '依赖管理',
    'migration': '数据迁移',
    'schema': '数据模型',
    'validator': '校验层',
    'service': '业务服务层',
    'controller': '控制器层',
    'model': '数据模型层',
  };

  const impactScope: string[] = [];
  for (const dir of dirNames) {
    for (const [key, label] of Object.entries(moduleKeywords)) {
      if (dir.toLowerCase().includes(key) && !impactScope.includes(label)) {
        impactScope.push(label);
      }
    }
  }
  if (impactScope.length === 0 && filePaths.length > 0) {
    const sample = filePaths[0].split('/');
    if (sample.length >= 2) impactScope.push(sample[0]);
    else impactScope.push(filePaths[0].replace(/\.[^.]+$/, ''));
  }

  const addedCount = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
  const removedCount = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;

  let riskLevel: 'low' | 'medium' | 'high' = 'low';

  const highRiskPatterns = [
    /\.executeRaw\s*\(/i, /\bexec\s*\(\s*['"]/i,
    /password\s*[=:]\s*['"][^'"]+['"](?!\s*$)/i,
    /api[_-]?key\s*[=:]\s*['"][^'"]+['"]/i,
    /secret\s*[=:]\s*['"][^'"]+['"]/i,
    /token\s*[=:]\s*['"][^'"]+['"]/i,
    /jwt\.sign\s*\([^)]*['"][^'"]+['"]/i,
    /innerHTML\s*=/i, /dangerouslySetInnerHTML/i,
    /eval\s*\(/i, /Function\s*\(/i,
    /\$\{.*(?:username|password|query|sql)\}/i,
  ];

  const mediumRiskPatterns = [
    /setInterval\s*\(/, /setTimeout\s*\(/,
    /new\s+Promise\s*\(/, /async\s+function/,
    /delete\s+\w+\.\w+/, /\.remove\(\)/,
    /TODO|FIXME|HACK|XXX/,
    /\.catch\s*\(/, /throw\s+new\s+Error/,
  ];

  for (const line of lines) {
    if (line.startsWith('+')) {
      for (const pattern of highRiskPatterns) {
        if (pattern.test(line)) {
          riskLevel = 'high';
          break;
        }
      }
      if (riskLevel === 'high') break;

      for (const pattern of mediumRiskPatterns) {
        if (pattern.test(line)) {
          riskLevel = 'medium';
        }
      }
    }
  }

  const newFiles = filePaths.filter(p => !lines.some(l => l.startsWith('--- a/' + p)));
  const deletedFiles = lines.filter(l => l.startsWith('--- a/') && lines.some(l2 => l2.startsWith('+++ b//dev/null'))).length;

  let intent = '';
  if (deletedFiles > 0 && addedCount < 3) {
    intent = '清理项目中的废弃代码和文件';
  } else if (newFiles.length > 0 && removedCount < 3) {
    intent = `新增${newFiles.length > 1 ? '多' : ''}个功能模块`;
  } else if (riskLevel === 'high') {
    intent = '代码变更中存在安全风险项，建议重点审查';
  } else if (codeBlocks.length > 0) {
    intent = `更新${codeBlocks.length}处代码逻辑`;
  } else if (addedCount > removedCount * 2) {
    intent = '扩展功能实现，新增业务逻辑';
  } else if (removedCount > addedCount * 2) {
    intent = '精简代码结构，移除冗余逻辑';
  } else {
    intent = '常规代码变更与优化';
  }

  return { intent, impactScope, riskLevel };
}

function sseWrite(res: ExpressResponse, event: SSEEvent): void {
  res.write(`event: dimension\ndata: ${JSON.stringify(event)}\n\n`);
}

function sseDone(
  res: ExpressResponse,
  data: { overallScore: number; overallLevel: string; summary: string; badge: string; keyFindings: string[]; comments: any[] }
): void {
  res.write(`event: done\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
}

function calculateOverall(
  security: SecurityAudit,
  correctness: CorrectnessAudit,
  dependency: DependencyAudit,
  maintainability: EngineeringScore,
  architecture: EngineeringScore,
  performance: EngineeringScore,
  robustness: EngineeringScore,
  testQuality: EngineeringScore
): { overallScore: number; overallLevel: 'block' | 'review' | 'approve' } {
  let rawScore = Math.round(
    correctness.score * 0.20 +
    dependency.score * 0.10 +
    maintainability.score * 0.15 +
    architecture.score * 0.15 +
    performance.score * 0.15 +
    robustness.score * 0.15 +
    testQuality.score * 0.10
  );

  if (security.level === 'critical') {
    rawScore = Math.min(rawScore, 40);
  }
  if (correctness.level === 'critical') {
    rawScore = Math.min(rawScore, 35);
  }

  const overallScore = Math.min(100, Math.max(0, rawScore));

  let overallLevel: 'block' | 'review' | 'approve';
  if (security.level === 'critical' || correctness.level === 'critical' || overallScore < 50) {
    overallLevel = 'block';
  } else if (overallScore < 70) {
    overallLevel = 'review';
  } else {
    overallLevel = 'approve';
  }

  return { overallScore, overallLevel };
}

async function callLLMForDimension(
  model: string,
  systemInstruction: string,
  userPrompt: string,
  jsonSchemaInstruction: string
): Promise<string> {
  if (model === 'deepseek') {
    const fullSystem = systemInstruction + '\n\n' + jsonSchemaInstruction;
    return callDeepSeekAPI(fullSystem, userPrompt);
  } else {
    const client = getGeminiClient();
    const response = await client.models.generateContent({
      model: "gemini-3.5-flash",
      contents: userPrompt,
      config: {
        systemInstruction,
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });
    if (!response.text) throw new Error("Empty response from Gemini API");
    return response.text;
  }
}

app.post("/api/pr/metadata", async (req, res): Promise<any> => {
  const url = req.body.githubUrl || req.body.url;
  if (!url) {
    return res.status(400).json({ error: "Please provide a GitHub PR URL." });
  }
  const parsed = parseGithubPr(url);
  if (!parsed) {
    return res.status(400).json({ error: "Invalid GitHub PR URL." });
  }
  try {
    const metadata = await fetchPrMetadata(parsed.owner, parsed.repo, parsed.pullNumber);
    return res.json(metadata);
  } catch (e: any) {
    return res.status(500).json({
      error: "Failed to fetch PR metadata from GitHub.",
      details: e.message,
    });
  }
});

app.post("/api/review/stream", async (req, res): Promise<any> => {
  const url = req.body.githubUrl || req.body.url;
  const { diff } = req.body;
  let targetDiff = diff || "";
  const hasPastedDiff = !!diff && diff.trim().length > 0;
  const model: string = req.body.model || 'deepseek';

  let codeBlocks: any[] = [];
  try {
    if (hasPastedDiff) {
      targetDiff = diff.trim();
    } else if (url) {
      const prPattern = /https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/;
      const match = url.match(prPattern);
      if (match) {
        const owner = match[1];
        const repo = match[2];
        const pullNumber = parseInt(match[3]);
        try {
          const response = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}.diff`,
            { headers: { Accept: "application/vnd.github.v3.diff" } }
          );
          if (!response.ok) {
            res.status(500).json({ error: `GitHub API error: ${response.status}` });
            return;
          }
          targetDiff = await response.text();
        } catch (e: any) {
          res.status(500).json({ error: `Failed to fetch PR diff: ${e.message}` });
          return;
        }
      }
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  try {
    codeBlocks = detectCodeBlocks(targetDiff);
    const DEEPSEEK_SCHEMA = `\n\nReturn ONLY a valid JSON object. Do not include markdown code fences or other text:\n{"businessIntent":"...","impactScope":["..."],"riskLevel":"high"|"medium"|"low"}`;

    const phase1System = getPhase1SystemInstruction();
    const phase1Text = await callLLMForDimension(model, phase1System, getPhase1UserPrompt(targetDiff), DEEPSEEK_SCHEMA);
    const phase1Json = JSON.parse(phase1Text.trim());
    const semantics = {
      intent: phase1Json.businessIntent || '',
      impactScope: Array.isArray(phase1Json.impactScope) ? phase1Json.impactScope : [],
      riskLevel: (phase1Json.riskLevel && ['low', 'medium', 'high'].includes(phase1Json.riskLevel))
        ? phase1Json.riskLevel as 'low' | 'medium' | 'high'
        : 'low',
    };

    if (!semantics.intent || semantics.impactScope.length === 0) {
      const fallback = inferSemanticsFromDiff(targetDiff, codeBlocks);
      Object.assign(semantics, fallback);
    }
    sseWrite(res, { stage: 'semantics', data: semantics });

    const secPrompt = getSecurityPrompt();
    const secChecklist = `1. SQL/NoSQL injection\n2. XSS / HTML injection\n3. Hardcoded credentials\n4. Authentication/authorization bypass\n5. Cryptographic flaws\n6. Path traversal / IDOR\n7. Insecure deserialization`;

    const corrPrompt = getCorrectnessPrompt();
    const corrChecklist = `1. Logic errors\n2. Race conditions\n3. Boundary/edge case gaps\n4. API/library misuse\n5. Incomplete error handling\n6. State inconsistency risks`;

    const depPrompt = getDependencyPrompt();
    const depChecklist = `1. Dependencies with known CVEs\n2. License compliance\n3. Downgraded security libraries\n4. Pre-release/unstable versions`;

    const engPrompts = getEngineeringPrompts();

    let security: SecurityAudit = { level: 'pass', score: 80, vulnerabilities: [], items: [], traces: [], _inferred: true };
    let correctness: CorrectnessAudit = { level: 'pass', score: 75, concerns: [], items: [], _inferred: true };
    let dependency: DependencyAudit = { level: 'na', score: 0, outdatedDeps: [], licenseIssues: [], _inferred: true };
    let maintainability: EngineeringScore = { score: 50, highlights: [], suggestions: [], _inferred: true };
    let architecture: EngineeringScore = { score: 50, highlights: [], suggestions: [], _inferred: true };
    let performance: EngineeringScore = { score: 50, highlights: [], suggestions: [], _inferred: true };
    let robustness: EngineeringScore = { score: 50, highlights: [], suggestions: [], _inferred: true };
    let testQuality: EngineeringScore = { score: 50, highlights: [], suggestions: [], _inferred: true };

    const securityTask = (async () => {
      try {
        const text = await callLLMForDimension(model, secPrompt.systemInstruction,
          buildPhase2UserPrompt(semantics, "安全风险", secChecklist, targetDiff), secPrompt.jsonSchema);
        const j = JSON.parse(text.trim());
        security = { level: j.level || 'pass', score: j.score ?? 80, vulnerabilities: j.vulnerabilities || [], items: [], traces: [] };
      } catch { security = inferSecurityFromDiff(targetDiff); }
      sseWrite(res, { stage: 'security', data: security });
    })();

    const correctnessTask = (async () => {
      try {
        const text = await callLLMForDimension(model, corrPrompt.systemInstruction,
          buildPhase2UserPrompt(semantics, "功能正确性", corrChecklist, targetDiff), corrPrompt.jsonSchema);
        const j = JSON.parse(text.trim());
        correctness = { level: j.level || 'pass', score: j.score ?? 75, concerns: j.concerns || [], items: [] };
      } catch { correctness = inferCorrectnessFromDiff(targetDiff); }
      sseWrite(res, { stage: 'correctness', data: correctness });
    })();

    const dependencyTask = (async () => {
      try {
        const text = await callLLMForDimension(model, depPrompt.systemInstruction,
          buildPhase2UserPrompt(semantics, "依赖安全性", depChecklist, targetDiff), depPrompt.jsonSchema);
        const j = JSON.parse(text.trim());
        dependency = { level: j.level || 'pass', score: j.score ?? 75, outdatedDeps: j.outdatedDeps || [], licenseIssues: j.licenseIssues || [] };
      } catch { dependency = inferDependencyFromDiff(targetDiff); }
      sseWrite(res, { stage: 'dependency', data: dependency });
    })();

    const engineeringTasks = engPrompts.map(prompt => (async () => {
      try {
        const text = await callLLMForDimension(model, prompt.systemInstruction,
          buildPhase2UserPrompt(semantics, prompt.dimensionName, prompt.checklist, targetDiff), prompt.jsonSchema);
        const j = JSON.parse(text.trim());
        const score: EngineeringScore = { score: j.score ?? 50, highlights: j.highlights || [], suggestions: j.suggestions || [] };
        switch (prompt.dimensionName) {
          case '可维护性': maintainability = score; sseWrite(res, { stage: 'maintainability', data: score }); break;
          case '架构与设计': architecture = score; sseWrite(res, { stage: 'architecture', data: score }); break;
          case '性能': performance = score; sseWrite(res, { stage: 'performance', data: score }); break;
          case '容错与健壮性': robustness = score; sseWrite(res, { stage: 'robustness', data: score }); break;
          case '测试质量': testQuality = score; sseWrite(res, { stage: 'testQuality', data: score }); break;
        }
      } catch {
        const fallbackMap: Record<string, EngineeringScore> = {
          '可维护性': inferMaintainabilityFromDiff(targetDiff),
          '架构与设计': inferArchitectureFromDiff(targetDiff),
          '性能': inferPerformanceFromDiff(targetDiff),
          '容错与健壮性': inferRobustnessFromDiff(targetDiff),
          '测试质量': inferTestQualityFromDiff(targetDiff),
        };
        const fb = fallbackMap[prompt.dimensionName] || { score: 50, highlights: [], suggestions: [], _inferred: true };
        fb._inferred = true;
        switch (prompt.dimensionName) {
          case '可维护性': maintainability = fb; sseWrite(res, { stage: 'maintainability', data: fb }); break;
          case '架构与设计': architecture = fb; sseWrite(res, { stage: 'architecture', data: fb }); break;
          case '性能': performance = fb; sseWrite(res, { stage: 'performance', data: fb }); break;
          case '容错与健壮性': robustness = fb; sseWrite(res, { stage: 'robustness', data: fb }); break;
          case '测试质量': testQuality = fb; sseWrite(res, { stage: 'testQuality', data: fb }); break;
        }
      }
    })());

    await Promise.allSettled([securityTask, correctnessTask, dependencyTask, ...engineeringTasks]);

    const impact = inferImpactFromDiff(targetDiff, semantics);
    sseWrite(res, { stage: 'impact', data: impact });

    const { overallScore, overallLevel } = calculateOverall(
      security, correctness, dependency,
      maintainability, architecture, performance, robustness, testQuality
    );

    const summary = `审计完成: 安全(${security.level}) 正确性(${correctness.level}) 综合评分 ${overallScore}`;
    const badge = overallLevel === 'block' ? '阻断' : overallLevel === 'review' ? '需复审' : '通过';
    const keyFindings: string[] = [];
    if (security.vulnerabilities?.length > 0) keyFindings.push(`发现 ${security.vulnerabilities.length} 个安全问题`);
    if (correctness.concerns?.length > 0) keyFindings.push(`发现 ${correctness.concerns.length} 个功能正确性问题`);

    sseDone(res, { overallScore, overallLevel, summary, badge, keyFindings, comments: [] });

  } catch (error: any) {
    console.error("SSE Pipeline error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.end();
    }
  }
});

// Configure serving for Vite/Production
async function initServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite Development Middleware Mounted.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Static Production Distribution Mounted.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening at http://localhost:${PORT}`);
  });
}

initServer();
