import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import fs from "fs";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { SecurityAudit, CorrectnessAudit, DependencyAudit, EngineeringScore } from "./src/types.js";
import { getPhase1SystemInstruction, getPhase1UserPrompt, getSecurityPrompt, getCorrectnessPrompt, getDependencyPrompt, getEngineeringPrompts, buildPhase2UserPrompt } from "./server/prompts.js";
import { inferSecurityFromDiff, inferCorrectnessFromDiff, inferDependencyFromDiff, inferMaintainabilityFromDiff, inferArchitectureFromDiff, inferPerformanceFromDiff, inferRobustnessFromDiff, inferImpactFromDiff, inferTestQualityFromDiff } from "./server/fallback.js";
import { detectCodeBlocks, inferSemanticsFromDiff } from "./server/diff.js";
import { sseWrite, sseDone } from "./server/sse.js";
import { calculateOverall, callLLMForDimension } from "./server/scoring.js";
import { parseGithubPr, fetchPrMetadata } from "./server/github.js";

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

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "15mb" }));

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
