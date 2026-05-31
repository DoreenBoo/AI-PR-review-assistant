import React, { useState, useMemo, useRef } from "react";
import { 
  motion
} from "motion/react";
import { 
  ShieldAlert, 
  BookOpen, 
  Cpu, 
  Sparkles, 
  Play, 
  Check, 
  AlertTriangle, 
  ExternalLink, 
  FileCode, 
  Copy, 
  Maximize2, 
  CheckCircle2, 
  Terminal, 
  Clock, 
  Flame, 
  CheckSquare, 
  Square, 
  AlertCircle, 
  Github, 
  ArrowRight,
  Sliders,
  FileText
} from "lucide-react";
import { ReviewComment, AiModel, AuditLevel } from "./types";
import RadarChart from "./components/RadarChart";
import { SecurityCard, CorrectnessCard, DependencyCard, EngineeringScoreCard, SkeletonCard, LevelBadge } from "./components/DimensionCards";
import { useSSEReview } from "./hooks/useSSEReview";

// ==========================================
// PRESET MOCK DATA FOR DEMO PURPOSES
// ==========================================

// ==========================================
// DEMO REVIEW STATE — FULL 9-DIMENSION RADAR DATA
// ==========================================
const DEMO_SSE_STATE = {
  semantics: {
    intent: "修复登录模块SQL注入漏洞并新增用户行为追踪与监控组件",
    impactScope: ["用户认证模块", "JWT令牌签发", "数据分析引擎", "系统监控"],
    riskLevel: "high" as const,
  },
  security: {
    level: "critical" as const,
    score: 35,
    vulnerabilities: [
      { category: "sql_injection", description: "用户输入直接拼接到SQL查询，未使用参数化绑定", filePath: "src/auth.ts", lineNumber: 13, severity: "high" as const },
      { category: "hardcoded_secret", description: "JWT签名密钥硬编码在源码中，任何获取代码者均可伪造令牌", filePath: "src/auth.ts", lineNumber: 19, severity: "high" as const },
    ],
    _inferred: false,
    _source: "deep" as const,
  },
  correctness: {
    level: "warning" as const,
    score: 65,
    concerns: [
      { type: "null_safety" as const, description: "findUserByCredentials 未处理数据库返回空结果的情况", filePath: "src/auth.ts", lineNumber: 15 },
      { type: "boundary_gap" as const, description: "sendAnalytics 未校验数据字段长度，可能引发OOM", filePath: "src/utils/tracker.ts", lineNumber: 22 },
    ],
    _inferred: false,
    _source: "deep" as const,
  },
  dependency: {
    level: "warning" as const,
    score: 70,
    outdatedDeps: [{ name: "jsonwebtoken", currentVersion: "8.5.1", latestVersion: "9.0.2", risk: "存在已知CVE-2022-23529，建议立即升级" }],
    licenseIssues: [],
    _inferred: false,
    _source: "deep" as const,
  },
  maintainability: { score: 60, highlights: ["函数命名清晰表达意图", "认证逻辑封装良好"], suggestions: ["tracker.ts 中 UserTracker 类职责过多，建议拆分", "多处使用魔法数字（5000、3600000）应提取为常量"], _inferred: false, _source: "deep" as const },
  architecture: { score: 80, highlights: ["新增模块遵循现有分层架构", "Tracker 通过构造函数注入，解耦良好"], suggestions: ["tracker 模块建议改为接口抽象，方便后续替换存储后端"], _inferred: false, _source: "deep" as const },
  performance: { score: 75, highlights: ["数据库查询使用了 LIMIT 1 限制返回行数"], suggestions: ["setInterval 5秒心跳频率偏高，建议调整为30秒", "sendAnalytics 每次全量发送，建议改为增量上报"], _inferred: false, _source: "deep" as const },
  robustness: { score: 40, highlights: [], suggestions: ["setInterval 未存储句柄，无法在组件销毁时清除——存在内存泄漏", "generateSessionToken 未校验 userId 参数有效性", "缺少对数据库连接失败的异常处理与重试逻辑", "sendAnalytics 无超时保护，网络异常时可能永久阻塞"], _inferred: false, _source: "deep" as const },
  testQuality: { score: 50, highlights: [], suggestions: ["本次变更未包含任何测试代码", "SQL注入修复后缺少对应的安全回归测试用例", "建议为 UserTracker 的生命周期管理增加单元测试"], _inferred: false, _source: "deep" as const },
  impact: {
    level: "high" as const,
    affectedModules: ["用户认证", "JWT令牌签发", "数据追踪", "系统监控"],
    publicApiChanges: false,
    dataModelChanges: true,
    crossModuleDeps: ["auth → tracker"],
    _inferred: false,
    _source: "deep" as const,
  },
  overallScore: 57,
  overallLevel: "review" as const,
  summary: "本次变更涉及认证安全修复和新增监控组件，但存在SQL注入和硬编码密钥等高危安全问题，且缺少相应测试覆盖。建议修复安全缺陷后重新提交审查。",
  badge: "需复审",
  keyFindings: [
    "src/auth.ts 中发现SQL注入漏洞：用户输入直接拼接进数据库查询，未使用参数化绑定",
    "src/auth.ts 中JWT签名密钥硬编码在源码中，存在核心凭证泄露风险",
    "src/utils/tracker.ts 中 setInterval 未管理生命周期句柄，长时间运行将导致内存泄漏",
  ],
  comments: [] as ReviewComment[],
  rawDiff: `diff --git a/src/auth.ts b/src/auth.ts
index b838f32..cbdac44 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,12 +10,18 @@
-  return null;
+  const query = \`SELECT * FROM users WHERE username = '\${username}' AND password_hash = '\${passwordHash}' LIMIT 1\`;
+  const result = await db.executeRaw(query);
+  return result[0];
-  return jwt.sign({ userId, expiry }, process.env.JWT_SECRET!);
+  return jwt.sign({ userId, expiry }, "default_insecure_key_123");
diff --git a/src/utils/tracker.ts b/src/utils/tracker.ts
index 9f32ab1..d4e5f6a 100644
--- a/src/utils/tracker.ts
+++ b/src/utils/tracker.ts
@@ -1,5 +1,12 @@
 export class UserTracker {
+  constructor() {
+    setInterval(() => {
+      console.log("Tracking active session statistics...");
+      this.sendAnalytics();
+    }, 5000);
   }
 
   sendAnalytics() {`,
  loading: false,
  progressMessage: "演示数据已加载",
  error: null as string | null,
};

function decodeGitOctalEscapes(diffText: string): string {
  let result = diffText.replace(
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
  result = result.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  return result;
}

export default function App() {
  const [prUrl, setPrUrl] = useState("");
  const [pastedDiff, setPastedDiff] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedModel, setSelectedModel] = useState<AiModel>('deepseek');
  const [demoMode, setDemoMode] = useState(false);
  
  // Custom checklist representing resolved issues
  const [resolvedIssues, setResolvedIssues] = useState<Record<string, boolean>>({});
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [expandedHeaders, setExpandedHeaders] = useState<Record<string, boolean>>({});
  const [showFileDropdown, setShowFileDropdown] = useState(false);
  const fileTabsRef = useRef<HTMLDivElement>(null);
  const leftSidebarRef = useRef<HTMLElement>(null);
  const [highlightedDimension, setHighlightedDimension] = useState<string | null>(null);
  const [expandedDimension, setExpandedDimension] = useState<string | null>(null);
  const { startReview: startSSEReview, cancelReview, ...reviewState } = useSSEReview();

  // Active radar dashboard state: SSE stream > demo > null
  const activeState = (reviewState.loading || reviewState.semantics)
    ? reviewState
    : demoMode
      ? DEMO_SSE_STATE
      : null;

  // Unified comments from both SSE reviews and legacy POST reviews
  const allComments = useMemo(() => {
    return activeState?.comments || [];
  }, [activeState?.comments]);

  // Per-file risk aggregation: fileName → { highest, count, high, medium, low }
  const fileRiskMap = useMemo(() => {
    const map: Record<string, { high: number; medium: number; low: number; total: number; highest: 'high' | 'medium' | 'low' | null }> = {};
    for (const c of allComments) {
      const f = map[c.filePath] || { high: 0, medium: 0, low: 0, total: 0, highest: null };
      f.total++;
      if (c.severity === 'high') f.high++;
      else if (c.severity === 'medium') f.medium++;
      else f.low++;
      if (!f.highest || (c.severity === 'high') || (c.severity === 'medium' && f.highest === 'low')) {
        f.highest = c.severity;
      }
      map[c.filePath] = f;
    }
    return map;
  }, [allComments]);

  // Parse the Unified Patch / Diff
  const parsedFiles = useMemo(() => {
    const diffText = decodeGitOctalEscapes(activeState?.rawDiff || pastedDiff || "");
    const filesList: {
      fileName: string;
      lines: {
        type: 'add' | 'delete' | 'normal' | 'header';
        content: string;
        oldLine?: number;
        newLine?: number;
      }[];
    }[] = [];

    const lines = diffText.split("\n");
    let currentFile: typeof filesList[0] | null = null;
    let oldLineNum = 0;
    let newLineNum = 0;

    for (const line of lines) {
      if (line.startsWith("diff --git ")) {
        const match = line.match(/b\/(.+)$/);
        const fileName = match ? match[1] : line.replace("diff --git a/", "");
        currentFile = { fileName, lines: [] };
        filesList.push(currentFile);
        oldLineNum = 0;
        newLineNum = 0;
        currentFile.lines.push({ type: 'header', content: line });
      } else if (currentFile) {
        if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("index ")) {
          currentFile.lines.push({ type: 'header', content: line });
        } else if (line.startsWith("@@ ")) {
          currentFile.lines.push({ type: 'header', content: line });
          const hunkMatch = line.match(/^@@ -(\d+),?\d* \+(\d+),?\d* @@/);
          if (hunkMatch) {
            oldLineNum = parseInt(hunkMatch[1], 10);
            newLineNum = parseInt(hunkMatch[2], 10);
          }
        } else if (line.startsWith("+")) {
          currentFile.lines.push({
            type: 'add',
            content: line.substring(1),
            newLine: newLineNum
          });
          newLineNum++;
        } else if (line.startsWith("-")) {
          currentFile.lines.push({
            type: 'delete',
            content: line.substring(1),
            oldLine: oldLineNum
          });
          oldLineNum++;
        } else {
          currentFile.lines.push({
            type: 'normal',
            content: line,
            oldLine: oldLineNum,
            newLine: newLineNum
          });
          oldLineNum++;
          newLineNum++;
        }
      }
    }

    return filesList;
  }, [reviewState.rawDiff, pastedDiff]);

  // Set the default selected file on result load/change
  useMemo(() => {
    if (parsedFiles.length > 0) {
      const withComments = parsedFiles.find(f => 
        (allComments).some(c => c.filePath === f.fileName)
      );
      setSelectedFile(withComments ? withComments.fileName : parsedFiles[0].fileName);
    } else {
      setSelectedFile("");
    }
  }, [parsedFiles]);

  // Copy support for code snippets
  const copyToClipboard = (text: string, id: string) => {
    const code = text.replace(/```[a-z]*\n?/g, "").replace(/```$/g, "");
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCodeId(id);
      setTimeout(() => setCopiedCodeId(null), 2000);
    });
  };

  const handleSSEReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prUrl && !pastedDiff) {
      setErrorMessage("请输入合法的 GitHub PR URL 或粘贴 Unified Diff 文本内容");
      return;
    }
    setErrorMessage("");
    startSSEReview(prUrl, pastedDiff, selectedModel);
  };

  const loadDemoDiff = () => {
    setDemoMode(true);
    setPrUrl("https://github.com/developer/sec-demo-app/pull/15");
    setPastedDiff(DEMO_SSE_STATE.rawDiff);
setResolvedIssues({});
    setErrorMessage("");
    setHighlightedDimension(null);
    setExpandedDimension(null);
  };

  // Compute severity distribution
  const statistics = useMemo(() => {
    const comments = allComments;
    const result = {
      high: 0,
      medium: 0,
      low: 0,
    };
    comments.forEach(c => {
      if (c.severity === "high") result.high++;
      else if (c.severity === "medium") result.medium++;
      else if (c.severity === "low") result.low++;
    });
    return result;
  }, [allComments]);

  const toggleIssueResolution = (id: string) => {
    setResolvedIssues(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-emerald-400";
    if (score >= 60) return "text-amber-400";
    return "text-rose-500";
  };

  const renderInputForm = () => (
    <form onSubmit={handleSSEReview} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">GitHub PR URL</label>
        <div className="relative">
          <Github className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
          <input
            type="text"
            value={prUrl}
            onChange={(e) => setPrUrl(e.target.value)}
            placeholder="https://github.com/owner/repo/pull/123"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-10 pr-4 py-2.5 text-xs text-white placeholder-zinc-600 font-mono focus:outline-none focus:border-emerald-500/60 transition-colors"
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-zinc-800" />
        <span className="text-[10px] text-zinc-600 font-mono">或直接粘贴 Diff</span>
        <div className="flex-1 h-px bg-zinc-800" />
      </div>
      <div className="flex flex-col gap-1.5">
        <textarea
          value={pastedDiff}
          onChange={(e) => setPastedDiff(e.target.value)}
          placeholder="diff --git a/src/index.ts b/src/index.ts&#10;index 83db48f..bf374d8 100644&#10;--- a/src/index.ts&#10;+++ b/src/index.ts&#10;@@ -1,5 +1,6 @@&#10; ..."
          rows={5}
          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2.5 text-[11px] text-white placeholder-zinc-600 font-mono resize-none focus:outline-none focus:border-emerald-500/60 transition-colors"
        />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">模型</label>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value as AiModel)}
            className="bg-zinc-950 border border-zinc-800 rounded-md px-3 py-1.5 text-[11px] text-zinc-300 font-mono focus:outline-none focus:border-emerald-500/60 cursor-pointer"
          >
            <option value="deepseek">DeepSeek-V4-Pro</option>
            <option value="gemini">Gemini 3.5-Flash</option>
          </select>
        </div>
        <div className="flex-1" />
        <button
          type="submit"
          className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs font-bold text-white transition cursor-pointer shadow-lg shadow-emerald-500/20"
        >
          <Play className="w-3.5 h-3.5" />
          开始审查
        </button>
      </div>
    </form>
  );

  const renderInputCompact = () => (
    <form onSubmit={handleSSEReview} className="flex items-center gap-3 flex-1 min-w-0">
      <div className="relative flex-1 min-w-0">
        <Github className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
        <input
          type="text"
          value={prUrl}
          onChange={(e) => setPrUrl(e.target.value)}
          placeholder="GitHub PR URL..."
          className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-8 pr-3 py-1.5 text-[11px] text-white placeholder-zinc-600 font-mono focus:outline-none focus:border-emerald-500/60 transition-colors"
        />
      </div>
      <select
        value={selectedModel}
        onChange={(e) => setSelectedModel(e.target.value as AiModel)}
        className="bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1.5 text-[10px] text-zinc-400 font-mono focus:outline-none focus:border-emerald-500/60 cursor-pointer shrink-0"
      >
        <option value="deepseek">DeepSeek-V4</option>
        <option value="gemini">Gemini-3.5</option>
      </select>
      <button
        type="submit"
        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-md text-[10px] font-bold text-white transition cursor-pointer shrink-0"
      >
        <Play className="w-3 h-3" />
        审查
      </button>
    </form>
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 flex flex-col font-mono" id="app_root">
      
      {/* HEADER SECTION - Styled precisely matching the tech-header design */}
      <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-6 bg-zinc-950/80 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.3)]">
            <div className="w-4 h-4 border-2 border-zinc-950"></div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-2">
            <span className="text-sm sm:text-base font-bold text-white tracking-tighter">AI_PR_REVIEWER</span>
            <span className="text-zinc-500 text-[10px] font-mono select-none">v1.1.5-STABLE</span>
          </div>
        </div>


        <div className="flex items-center gap-3">
          
          
        </div>
      </header>

      {/* DETAILED TELESCOPIC SUBHEADER FOR SYSTEM STATUS */}
      <div className="bg-zinc-900/40 border-b border-zinc-900 px-6 py-2 flex items-center justify-between text-[10px] text-zinc-500 select-none">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1"><Terminal className="w-3 h-3 text-zinc-600" /> STABLE REVISION ENGINE: <strong>{selectedModel === 'deepseek' ? 'DEEPSEEK-V4-PRO' : 'GEMINI-3.5-FLASH'}</strong></span>
          <span className="hidden sm:inline text-zinc-700">|</span>
          <span className="hidden sm:inline">PROMPT SCHEMA: STRICT_JSON</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="w-3 h-3 text-zinc-600" />
          <span>STATION CLOCK: {new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC</span>
        </div>
      </div>

      {/* MAIN LAYOUT */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 flex flex-col gap-6">
        
        {/* ==========================================
            LANDING PAGE — when no review or demo is active
            ========================================== */}
        {!activeState && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-6"
          >
            {/* HERO: Radar chart + title */}
            <div className="w-full flex flex-col lg:flex-row items-center gap-8 lg:gap-16 py-6 lg:py-10">
              {/* Left: Radar chart hero */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="shrink-0"
              >
                <RadarChart
                  security={null}
                  correctness={null}
                  dependency={null}
                  maintainability={null}
                  architecture={null}
                  performance={null}
                  robustness={null}
                  testQuality={null}
                  overallScore={null}
                  highlightedDimension={null}
                />
              </motion.div>

              {/* Right: Title + tagline */}
              <div className="flex-1 flex flex-col items-center lg:items-start text-center lg:text-left gap-5">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.15 }}
                >
                  <h1 className="text-3xl lg:text-4xl font-black text-white tracking-tighter leading-none">
                    AI PR Review
                  </h1>
                  <p className="text-sm lg:text-base text-zinc-400 mt-2 font-sans tracking-wide">
                    9 维度代码质量雷达评估
                  </p>
                </motion.div>

                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.25 }}
                  className="text-xs lg:text-sm text-zinc-500 max-w-md leading-relaxed font-sans"
                >
                  覆盖安全漏洞、功能正确性、依赖风险、可维护性、架构设计、性能、容错健壮性、测试质量
                  及变更影响评估。通过 <span className="text-emerald-400 font-bold">快速总览 + 深度推理</span> 两段式流水线，最快 25 秒呈现完整质量面板。
                </motion.p>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.35 }}
                  className="flex items-center gap-3"
                >
                  <div className="flex items-center gap-1.5">
                    {["安全", "正确性", "依赖", "可维护", "架构", "性能", "容错", "测试"].map((label, i) => (
                      <div
                        key={label}
                        className="w-2 h-2 rounded-full"
                        style={{
                          background: `hsl(${i * 45}, 60%, ${50 + i * 3}%)`,
                          opacity: 0.7,
                        }}
                      />
                    ))}
                  </div>
                  <span className="text-[10px] text-zinc-600 font-mono">8 DIMENSIONS ACTIVE</span>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.45 }}
                />
              </div>
            </div>

            {/* INPUT FORM — below the hero */}
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="w-full max-w-2xl bg-zinc-900/30 border border-zinc-800 rounded-xl p-5 relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-3 select-none">
                <span className="text-[9px] bg-zinc-800/80 px-2 py-0.5 rounded text-zinc-500 font-bold border border-zinc-800">审查源配置</span>
              </div>
              {renderInputForm()}
            </motion.section>
          </motion.div>
        )}

        {/* ==========================================
            DASHBOARD — when review or demo is active
            ========================================== */}
        {activeState && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col gap-6 flex-1 min-h-0"
            id="review_results_block"
          >
            {/* Compact input bar when dashboard is active */}
            <section className="bg-zinc-900/20 border border-zinc-800/60 rounded-lg px-4 py-3 flex items-center gap-4 flex-wrap">
              <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold shrink-0">审查源</span>
              {renderInputCompact()}
            </section>

            {/* Progress indicator */}
            {reviewState.loading && reviewState.progressMessage && (
              <div className="bg-zinc-900/40 border border-emerald-500/20 rounded-lg px-4 py-2 flex items-center gap-2 text-xs">
                <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                <span className="text-emerald-300/80 font-mono">{reviewState.progressMessage}</span>
              </div>
            )}

                        {/* Demo mode badge */}
            {demoMode && !reviewState.loading && !reviewState.semantics && (
              <div className="bg-amber-950/20 border border-amber-500/20 rounded-lg px-4 py-2 flex items-center gap-2 text-xs">
                <Flame className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-amber-300/80 font-mono">当前显示演示数据 — 请粘贴 PR URL 或 Diff 文本启动真实审计</span>
              </div>
            )}

            {/* 2x2 GRID: Row1=Radar|Analysis Row2=Cards|Diff — rows align at bottom */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0" style={{ gridTemplateRows: 'auto minmax(0, 1fr)' }}>
              
              {/* ====== ROW 1 LEFT: Radar chart ====== */}
              <div className="lg:col-span-4 flex justify-center">
                <RadarChart
                  security={activeState.security}
                  correctness={activeState.correctness}
                  dependency={activeState.dependency}
                  maintainability={activeState.maintainability}
                  architecture={activeState.architecture}
                  performance={activeState.performance}
                  robustness={activeState.robustness}
                  testQuality={activeState.testQuality}
                  overallScore={activeState.overallScore}
                  highlightedDimension={highlightedDimension}
                />
              </div>

              {/* ====== ROW 1 RIGHT: Change Analysis — bottom aligns with radar bottom ====== */}
              <section className="lg:col-span-8">
                {(activeState.semantics?.intent || activeState.semantics?.impactScope?.length) ? (
                  <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-5 flex flex-col gap-3 h-full">
                    <div className="border-t border-zinc-800/60 my-1" />

                    <div className="flex flex-col gap-3 bg-zinc-950/50 border border-zinc-800 rounded-lg p-5 relative overflow-hidden flex-1">
                      <div className="absolute top-0 left-0 bottom-0 w-1 bg-gradient-to-b from-emerald-500 via-amber-500 to-rose-500" />
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2.5">
                          <span className="text-xs text-emerald-400 uppercase tracking-[0.2em] font-black">变更分析</span>
                          {activeState.semantics?.riskLevel && (
                            <span className={`text-xs px-2.5 py-1 rounded font-black font-mono shadow-lg ${
                              activeState.semantics.riskLevel === 'high' ? 'bg-rose-600/80 text-white shadow-rose-500/30' :
                              activeState.semantics.riskLevel === 'medium' ? 'bg-amber-500/80 text-zinc-950 shadow-amber-500/30' :
                              'bg-emerald-500/80 text-zinc-950 shadow-emerald-500/30'
                            }`}>
                              {activeState.semantics.riskLevel === 'high' ? '⚠ HIGH RISK' :
                               activeState.semantics.riskLevel === 'medium' ? '⚡ MEDIUM' : '✓ LOW'}
                            </span>
                          )}
                        </div>
                        {activeState.overallScore !== null && (
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold">审计结论</div>
                            <div className={`text-2xl font-black ${(activeState.overallScore ?? 0) >= 70 ? 'text-emerald-400' : (activeState.overallScore ?? 0) >= 50 ? 'text-amber-400' : 'text-rose-500'}`}>
                              {activeState.overallScore}
                            </div>
                            <LevelBadge level={(activeState.overallLevel ?? 'pass') as AuditLevel} />
                          </div>
                        )}
                      </div>
                      {activeState.semantics?.intent && (
                        <p className="text-xl font-bold text-white leading-snug tracking-tight">{activeState.semantics.intent}</p>
                      )}
                      {activeState.semantics?.impactScope && activeState.semantics.impactScope.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-zinc-500 font-bold shrink-0">📌 影响范围</span>
                          {activeState.semantics.impactScope.map((scope: string, idx: number) => (
                            <span key={idx} className="text-[11px] bg-zinc-800 text-zinc-300 px-2.5 py-1 rounded-full font-sans border border-zinc-700">{scope}</span>
                          ))}
                        </div>
                      )}
                      {activeState.summary && (
                        <p className="text-sm text-zinc-400 leading-relaxed font-sans border-t border-zinc-800/60 pt-3">{activeState.summary}</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-zinc-900/20 border border-zinc-800/40 rounded-xl p-5 flex flex-col gap-3 h-full animate-pulse">
                    <div className="flex items-center gap-2.5 mb-2">
                      <span className="text-xs text-emerald-400/40 uppercase tracking-[0.2em] font-black">变更分析</span>
                      <div className="h-5 w-20 bg-zinc-800/60 rounded" />
                    </div>
                    <div className="flex flex-col gap-3 bg-zinc-950/30 border border-zinc-800/30 rounded-lg p-5 flex-1">
                      <div className="h-6 w-3/4 bg-zinc-800/40 rounded" />
                      <div className="h-4 w-full bg-zinc-800/30 rounded" />
                      <div className="h-4 w-5/6 bg-zinc-800/30 rounded" />
                      <div className="h-4 w-2/3 bg-zinc-800/30 rounded" />
                      <div className="flex gap-2 mt-2">
                        <div className="h-6 w-16 bg-zinc-800/40 rounded-full" />
                        <div className="h-6 w-20 bg-zinc-800/40 rounded-full" />
                        <div className="h-6 w-14 bg-zinc-800/40 rounded-full" />
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* ====== ROW 2 LEFT: Dimension Cards — scrollable, aligned with diff viewer ====== */}
              <aside ref={leftSidebarRef} className="lg:col-span-4 flex flex-col gap-4 min-h-0 overflow-hidden">
                <div className="flex flex-col gap-1.5">
                  {(activeState.security?._inferred || activeState.correctness?._inferred || activeState.dependency?._inferred) && (
                    <div className="text-[9px] text-zinc-500 text-center shrink-0">🔍 部分维度使用本地启发式分析</div>
                  )}
                  {reviewState.loading && (
                    <div className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-emerald-500/5 border border-emerald-500/15 text-xs mb-1">
                      <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                      <span className="text-emerald-300/90 font-mono">
                        {reviewState.progressMessage || '正在分析语义...'}
                      </span>
                    </div>
                  )}
                  <React.Fragment key={`security-${activeState.security?.score}-${activeState.security?._inferred}`}>
                  <SecurityCard
                    data={activeState.security}
                    highlighted={highlightedDimension === 'security'}
                    onHover={(entering: boolean) => setHighlightedDimension(entering ? 'security' : null)}
                    onClick={() => setExpandedDimension(expandedDimension === 'security' ? null : 'security')}
                    expanded={expandedDimension === 'security'}
                    riskItems={activeState.riskItems?.security}
                    dataflowTraces={activeState.dataflowTraces}
                  />
                  </React.Fragment>
                  <React.Fragment key={`correctness-${activeState.correctness?.score}-${activeState.correctness?._inferred}`}>
                  <CorrectnessCard
                    data={activeState.correctness}
                    highlighted={highlightedDimension === 'correctness'}
                    onHover={(entering: boolean) => setHighlightedDimension(entering ? 'correctness' : null)}
                    onClick={() => setExpandedDimension(expandedDimension === 'correctness' ? null : 'correctness')}
                    expanded={expandedDimension === 'correctness'}
                    riskItems={activeState.riskItems?.correctness}
                    dataflowTraces={activeState.dataflowTraces}
                  />
                  </React.Fragment>
                  <React.Fragment key={`dependency-${activeState.dependency?.score}-${activeState.dependency?._inferred}`}>
                  <DependencyCard
                    data={activeState.dependency}
                    highlighted={highlightedDimension === 'dependency'}
                    onHover={(entering: boolean) => setHighlightedDimension(entering ? 'dependency' : null)}
                    onClick={() => setExpandedDimension(expandedDimension === 'dependency' ? null : 'dependency')}
                    expanded={expandedDimension === 'dependency'}
                  />
                  </React.Fragment>
                  <React.Fragment key={`maintainability-${activeState.maintainability?.score}-${activeState.maintainability?._inferred}`}>
                  <EngineeringScoreCard label="可维护性" icon="📝" data={activeState.maintainability}
                    highlighted={highlightedDimension === 'maintainability'} onHover={(entering: boolean) => setHighlightedDimension(entering ? 'maintainability' : null)}
                    onClick={() => setExpandedDimension(expandedDimension === 'maintainability' ? null : 'maintainability')}
                    expanded={expandedDimension === 'maintainability'} />
                  </React.Fragment>
                  <React.Fragment key={`architecture-${activeState.architecture?.score}-${activeState.architecture?._inferred}`}>
                  <EngineeringScoreCard label="架构设计" icon="🏗️" data={activeState.architecture}
                    highlighted={highlightedDimension === 'architecture'} onHover={(entering: boolean) => setHighlightedDimension(entering ? 'architecture' : null)}
                    onClick={() => setExpandedDimension(expandedDimension === 'architecture' ? null : 'architecture')}
                    expanded={expandedDimension === 'architecture'} />
                  </React.Fragment>
                  <React.Fragment key={`performance-${activeState.performance?.score}-${activeState.performance?._inferred}`}>
                  <EngineeringScoreCard label="性能" icon="⚡" data={activeState.performance}
                    highlighted={highlightedDimension === 'performance'} onHover={(entering: boolean) => setHighlightedDimension(entering ? 'performance' : null)}
                    onClick={() => setExpandedDimension(expandedDimension === 'performance' ? null : 'performance')}
                    expanded={expandedDimension === 'performance'} />
                  </React.Fragment>
                  <React.Fragment key={`robustness-${activeState.robustness?.score}-${activeState.robustness?._inferred}`}>
                  <EngineeringScoreCard label="容错健壮" icon="🛟" data={activeState.robustness}
                    highlighted={highlightedDimension === 'robustness'} onHover={(entering: boolean) => setHighlightedDimension(entering ? 'robustness' : null)}
                    onClick={() => setExpandedDimension(expandedDimension === 'robustness' ? null : 'robustness')}
                    expanded={expandedDimension === 'robustness'} />
                  </React.Fragment>
                  <React.Fragment key={`testQuality-${activeState.testQuality?.score}-${activeState.testQuality?._inferred}`}>
                  <EngineeringScoreCard label="测试质量" icon="🧪" data={activeState.testQuality}
                    highlighted={highlightedDimension === 'testQuality'} onHover={(entering: boolean) => setHighlightedDimension(entering ? 'testQuality' : null)}
                    onClick={() => setExpandedDimension(expandedDimension === 'testQuality' ? null : 'testQuality')}
                    expanded={expandedDimension === 'testQuality'} />
                  </React.Fragment>
                </div>

                {activeState.keyFindings && activeState.keyFindings.length > 0 && (
                  <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-4 shrink-0">
                    <div className="text-[9px] text-zinc-500 uppercase font-bold mb-2">关键发现</div>
                    <div className="flex flex-col gap-1">
                      {activeState.keyFindings.map((f: string, i: number) => (
                        <div key={i} className="text-[10px] text-zinc-300 flex items-start gap-2">
                          <span className="text-rose-400 shrink-0 mt-0.5">•</span>
                          <span>{f}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </aside>

              {/* ====== ROW 2 RIGHT: Diff Viewer — top/bottom aligned with dimension cards ====== */}
              <section className="lg:col-span-8 flex flex-col min-h-0 bg-zinc-900 border border-zinc-800 overflow-hidden" id="diff_explorer">
                
                {/* FILE SELECTOR BAR */}
                <div className="bg-zinc-800/35 px-4 py-2 border-b border-zinc-800 flex items-center gap-3">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold shrink-0">文件</span>
                  <div ref={fileTabsRef} className="flex-1 overflow-x-auto flex gap-1 hide-scrollbar cursor-default" title="滚轮切换文件">
                    {parsedFiles.map((fFile) => {
                      const risk = fileRiskMap[fFile.fileName];
                      const active = fFile.fileName === selectedFile;
                      const badgeColor = !risk ? '' :
                        risk.highest === 'high' ? 'bg-rose-600 text-white' :
                        risk.highest === 'medium' ? 'bg-amber-500 text-zinc-950' :
                        'bg-zinc-600 text-zinc-300';
                      return (
                        <button
                          key={fFile.fileName}
                          onClick={() => setSelectedFile(fFile.fileName)}
                          className={`px-2.5 py-1 text-[10px] font-mono border rounded transition-all shrink-0 cursor-pointer flex items-center gap-1 ${
                            active ? 'bg-zinc-950 border-emerald-500/40 text-white font-semibold' : 'bg-zinc-900/40 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
                          }`}
                        >
                          <span className="truncate max-w-[160px]">{fFile.fileName.split('/').pop()}</span>
                          {risk && risk.total > 0 && (
                            <span className={`px-1 text-[9px] rounded font-bold ${badgeColor}`} title={`高风险 ${risk.high} | 中风险 ${risk.medium} | 低风险 ${risk.low}`}>
                              {risk.total}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {parsedFiles.length > 1 && (
                    <div className="relative shrink-0">
                      <button
                        onClick={() => setShowFileDropdown(!showFileDropdown)}
                        className="flex items-center gap-1.5 text-[10px] text-zinc-300 font-bold font-mono bg-zinc-800/60 hover:bg-zinc-700/60 px-2 py-1 rounded border border-zinc-700 hover:border-zinc-500 transition cursor-pointer"
                      >
                        <span>{parsedFiles.length} files</span>
                        <span className={`text-zinc-500 transition-transform duration-200 ${showFileDropdown ? 'rotate-180' : ''}`}>▼</span>
                      </button>
                      {showFileDropdown && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowFileDropdown(false)} />
                          <div className="absolute right-0 top-full mt-1 z-20 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl min-w-[220px] max-h-[280px] overflow-y-auto py-1">
                            {parsedFiles.map((fFile) => {
                              const risk = fileRiskMap[fFile.fileName];
                              const active = fFile.fileName === selectedFile;
                              const badgeColor = !risk ? '' :
                                risk.highest === 'high' ? 'bg-rose-600 text-white' :
                                risk.highest === 'medium' ? 'bg-amber-500 text-zinc-950' :
                                'bg-zinc-600 text-zinc-300';
                              return (
                                <button
                                  key={fFile.fileName}
                                  onClick={() => { setSelectedFile(fFile.fileName); setShowFileDropdown(false); }}
                                  className={`w-full text-left px-3 py-1.5 text-[10px] font-mono flex items-center justify-between gap-2 transition cursor-pointer ${
                                    active ? 'bg-emerald-500/10 text-emerald-400 font-bold' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                                  }`}
                                >
                                  <span className="truncate">{fFile.fileName.split('/').pop()}</span>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {risk && risk.total > 0 && (
                                      <span className={`px-1 text-[9px] rounded font-bold ${badgeColor}`} title={`高风险 ${risk.high} | 中风险 ${risk.medium} | 低风险 ${risk.low}`}>
                                        {risk.total}
                                      </span>
                                    )}
                                    {active && <span className="text-emerald-400 text-[8px]">●</span>}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* CODE LINES VIEWPORT */}
                <div
                  className="flex-1 overflow-auto relative p-4 bg-zinc-950"
                  id="diff_code_viewport"
                >
                  {(() => {
                    const activeFileObj = parsedFiles.find(f => f.fileName === selectedFile);
                    if (!activeFileObj) {
                      return (
                        <div className="p-12 text-center text-zinc-600 font-sans text-xs">
                          没有检测到合适的代码变更差异段
                        </div>
                      );
                    }
                    const activeFileComments = (allComments).filter(c => c.filePath === selectedFile);
                    const metaLineIndices: number[] = [];
                    activeFileObj.lines.forEach((l, i) => { if (l.type === 'header') metaLineIndices.push(i); });
                    const showMeta = expandedHeaders[selectedFile] ?? false;
                    return (
                      <div className="min-w-[620px] font-mono text-[11px] leading-6 bg-zinc-950 rounded-md border border-zinc-900 overflow-hidden">
                        {metaLineIndices.length > 0 && (
                          <div onClick={() => setExpandedHeaders(prev => ({ ...prev, [selectedFile]: !showMeta }))}
                            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/60 cursor-pointer hover:bg-zinc-900/80 transition select-none border-b border-zinc-900">
                            <span className="text-[10px] text-zinc-500 transition-transform duration-200 shrink-0" style={{ transform: showMeta ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                            <span className="text-[10px] text-zinc-400 font-semibold shrink-0">FILE HEADER</span>
                            <span className="text-[9px] text-zinc-500 shrink-0 ml-auto">{metaLineIndices.length} lines</span>
                          </div>
                        )}
                        {activeFileObj.lines.map((line, lineIdx) => {
                          if (!showMeta && metaLineIndices.includes(lineIdx)) return null;
                          const matchedComments = activeFileComments.filter((cmt) => {
                            const trimmedLine = line.content.trim();
                            const trimmedOriginal = cmt.originalContent.trim().replace(/^[\+\-]/, "").trim();
                            return trimmedLine.length > 5 && (trimmedLine.includes(trimmedOriginal) || trimmedOriginal.includes(trimmedLine) || cmt.lineNumber === line.newLine);
                          });
                          let gutterClass = "bg-zinc-950 text-zinc-700";
                          let rowClass = "text-zinc-400";
                          let displayPrefix = " ";
                          if (line.type === 'add') { gutterClass = "bg-zinc-950 text-zinc-600"; rowClass = "text-emerald-300 border-l-2 border-emerald-500/40"; displayPrefix = "+"; }
                          else if (line.type === 'delete') { gutterClass = "bg-zinc-950 text-zinc-600"; rowClass = "text-rose-300 border-l-2 border-rose-500/40"; displayPrefix = "-"; }
                          else if (line.type === 'header') { gutterClass = "bg-zinc-900/50 text-zinc-600"; rowClass = "text-white font-semibold py-0.5"; displayPrefix = "#"; }
                          return (
                            <div key={lineIdx} className="flex flex-col">
                              <div className={`flex items-center group/line ${line.type === 'header' ? 'bg-zinc-900/50 text-[10px]' : 'bg-zinc-950 hover:bg-zinc-900/20'} ${rowClass}`}>
                                <div className={`w-10 text-right pr-2 select-none border-r border-zinc-900/80 text-[10px] shrink-0 py-px group-hover/line:bg-zinc-900/20 ${gutterClass}`}>{line.oldLine || ""}</div>
                                <div className={`w-10 text-right pr-2 select-none border-r border-zinc-900/80 text-[10px] shrink-0 py-px group-hover/line:bg-zinc-900/20 ${gutterClass}`}>{line.newLine || ""}</div>
                                <div className="flex-1 pl-3 font-mono whitespace-pre break-all select-text py-px">
                                  <span className="text-zinc-600 select-none inline-block w-3">{displayPrefix}</span>
                                  {line.content}
                                </div>
                              </div>
                              {matchedComments.map((comment) => {
                                const isResolved = resolvedIssues[comment.id];
                                return (
                                  <div key={comment.id} className="ml-10 sm:ml-20 my-3.5 mr-4 relative font-sans">
                                    <div className="absolute -left-6 top-1/2 w-6 h-[1.5px] bg-rose-500/40 select-none" />
                                    <div className="bg-zinc-950 border border-rose-500/30 rounded-lg p-4 shadow-2xl relative overflow-hidden">
                                      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-rose-500/50 to-transparent" />
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-black uppercase text-white font-mono ${comment.severity === 'high' ? 'bg-rose-600' : 'bg-amber-600'}`}>
                                            {comment.severity === 'high' ? 'High Risk' : 'Medium Warning'}
                                          </span>
                                          <span className="text-[11px] font-bold text-zinc-100 font-mono">
                                            {comment.severity === 'high' ? '🎯 安全红线拦截警告' : '⚡ 性能架构诊断'}
                                          </span>
                                        </div>
                                        <button type="button" onClick={() => toggleIssueResolution(comment.id)}
                                          className={`text-[10px] sm:text-[11px] font-mono px-2 py-0.5 rounded border flex items-center gap-1.5 transition cursor-pointer ${
                                            isResolved ? 'bg-emerald-950/40 border-emerald-800 text-emerald-400' : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300'
                                          }`}>
                                          {isResolved ? <><CheckCircle2 className="w-3.5 h-3.5" /><span>已修复</span></> : <><Square className="w-3 h-3 text-zinc-650" /><span>标记已修复</span></>}
                                        </button>
                                      </div>
                                      <p className={`text-[11px] leading-relaxed text-zinc-300 mb-3.5 whitespace-normal ${isResolved ? 'line-through opacity-50' : ''}`}>{comment.description}</p>
                                      <div className="bg-emerald-950/15 border border-emerald-900/45 rounded p-3 text-[11px] font-sans">
                                        <div className="flex justify-between items-center mb-1.5">
                                          <span className="text-[10px] text-emerald-400 uppercase font-mono font-bold tracking-wider">修复方案</span>
                                          <button onClick={() => copyToClipboard(comment.suggestion, comment.id)}
                                            className="text-[9px] text-zinc-500 hover:text-white flex items-center gap-1 cursor-pointer font-mono">
                                            {copiedCodeId === comment.id ? <span className="text-emerald-400 font-bold">复制成功</span> : <span>[ COPY ]</span>}
                                          </button>
                                        </div>
                                        <code className="text-xs text-zinc-300 block bg-zinc-950/80 p-2 border border-zinc-900 rounded font-mono break-all whitespace-pre-wrap select-all leading-5">
                                          {comment.suggestion.replace(/```[a-z]*\n?/g, "").replace(/```$/g, "")}
                                        </code>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </section>
            </div>
          </motion.div>
        )}

      </main>

      {/* FOOTER */}
      <footer className="border-t border-zinc-900 py-6 text-center text-[11px] text-zinc-500 bg-zinc-950 mt-12 shrink-0">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="font-sans">© 2026 AI PR Reviewer Pro. @DODO @小何先生 设计.</p>
          <div className="flex items-center gap-3 font-mono">
            <span className="text-emerald-500/80">HTTPS SECURE TRANSMISSION</span>
            <span>•</span>
            <span className="text-zinc-600">SANDBOX HOSTED</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
