import React, { useState, useMemo } from "react";
import { 
  motion, 
  AnimatePresence 
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
import { PrReviewResult, ReviewComment } from "./types";

// ==========================================
// PRESET MOCK DATA FOR DEMO PURPOSES
// ==========================================
const MOCK_REVIEW_RESULT: PrReviewResult = {
  summary: "本次更改主要在认证模块引入了用户凭证检索，并尝试添加了一套高频运行的心跳和分析组件以支持监控。但由于多处拼接传值和定时器内存泄露，导致整体代码质量评分下滑较大。",
  badge: "安全&架构重构",
  overallScore: 48,
  scores: {
    security: 35,
    readability: 65,
    performance: 70,
    robustness: 45
  },
  keyFindings: [
    "在 src/auth.ts 中直接将外部传入的 username 进行字符串模版拼接并执行数据库查询，引发严重的高危 SQL 注入漏洞。",
    "在 src/utils/tracker.ts 中，启动的 setInterval 循环定时器未进行句柄存储和清除逻辑，存在明显的长期物理内存泄露。",
    "在 JWT 签名部分将加密私钥或强签名信息直接硬编码写死，极易在团队共享或仓库被下载时发生核心秘钥泄露事故。"
  ],
  comments: [
    {
      id: "cmt_1",
      filePath: "src/auth.ts",
      lineNumber: 13,
      originalContent: "  const query = `SELECT * FROM users WHERE username = '${username}' AND password_hash = '${passwordHash}' LIMIT 1`;",
      description: "【高危 SQL 注入漏洞】接收用户输入的 username 与 passwordHash 未做任何校验且没有采用参数化机制，直接采取拼装模版。攻击者只要传入类似 `' OR '1'='1` 的载荷即可突破检验，或者直接对数据库进行恶意爆破与泄库操作。",
      suggestion: "```typescript\n// 推荐：采用安全参数化绑定查询，彻底防御 SQL 注入！ 🛡️\nconst query = 'SELECT * FROM users WHERE username = ? AND password_hash = ? LIMIT 1';\nconst result = await db.query(query, [username, passwordHash]);\n```",
      severity: "high"
    },
    {
      id: "cmt_2",
      filePath: "src/auth.ts",
      lineNumber: 19,
      originalContent: "  return jwt.sign({ userId, expiry }, \"default_insecure_key_123\");",
      description: "【严重配置安全缺陷】禁止在代码文件甚至开发阶段直接硬编码敏感的私钥（如 `default_insecure_key_123`）。这属于高危的安全审计项，任何掌握该文件的人都能随心所欲伪造用户令牌。",
      suggestion: "```typescript\n// 从环境变量中安全提取密钥，并增加容错保护机制\nconst jwtSecret = process.env.JWT_SECRET;\nif (!jwtSecret) {\n  throw new Error('SYSTEM ERROR: Required environmental variable JWT_SECRET is undefined!');\n}\nreturn jwt.sign({ userId, expiry }, jwtSecret);\n```",
      severity: "high"
    },
    {
      id: "cmt_3",
      filePath: "src/utils/tracker.ts",
      lineNumber: 12,
      originalContent: "    setInterval(() => {",
      description: "【中度内存泄漏隐患】无副作用声明且无注销机制的 `setInterval` 定时器。每实例化一个 `UserTracker` 都会在全局环境常驻一个不断打印的计时事件。如果没有在析构或手动调用时执行 `clearInterval`，长此以往将常驻并耗尽系统 Node 堆空间。",
      suggestion: "```typescript\n// 增加生命周期控制方法，储存定时器句柄，并在不需要时主动销毁\nexport class UserTracker {\n  private heartbeatTimer: NodeJS.Timeout | null = null;\n\n  startHeartbeat() {\n    this.heartbeatTimer = setInterval(() => {\n      console.log(\"Tracking active session statistics...\");\n      this.sendAnalytics();\n    }, 5000);\n  }\n\n  destroy() {\n    if (this.heartbeatTimer) {\n      clearInterval(this.heartbeatTimer);\n    }\n  }\n}\n```",
      severity: "medium"
    }
  ],
  diff: `diff --git a/src/auth.ts b/src/auth.ts
index b838f32..cbdac44 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,12 +10,18 @@ export async function findUserByCredentials(username: string, passwordHash: stri
-  // TODO: Implement secure database checks
-  return null;
+  console.log(\`Authenticating user: \${username}\default_insecure_key_123\`);
+  const query = \`SELECT * FROM users WHERE username = '\${username}' AND password_hash = '\${passwordHash}' LIMIT 1\`;
+  const result = await db.executeRaw(query);
+  return result[0];
 }
 
 export function generateSessionToken(userId: string): string {
   const expiry = new Date(Date.now() + 3600000);
-  return jwt.sign({ userId, expiry }, process.env.JWT_SECRET!);
+  return jwt.sign({ userId, expiry }, "default_insecure_key_123");
 }
diff --git a/src/utils/tracker.ts b/src/utils/tracker.ts
index c6b9e31..fd821ac 100644
--- a/src/utils/tracker.ts
+++ b/src/utils/tracker.ts
@@ -1,15 +1,19 @@
 export class UserTracker {
   private activeTimers: any[] = [];
 
   constructor() {
     this.startHeartbeat();
   }
 
   startHeartbeat() {
-    const handle = setInterval(() => {
-      this.sendAnalytics();
-    }, 5000);
-    this.activeTimers.push(handle);
+    setInterval(() => {
+      console.log("Tracking active session statistics...");
+      this.sendAnalytics();
+    }, 5000);
   }
 
   sendAnalytics() {`
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
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [reviewResult, setReviewResult] = useState<PrReviewResult>(MOCK_REVIEW_RESULT);
  const [errorMessage, setErrorMessage] = useState("");
  
  // Custom checklist representing resolved issues
  const [resolvedIssues, setResolvedIssues] = useState<Record<string, boolean>>({});
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [expandedHeaders, setExpandedHeaders] = useState<Record<string, boolean>>({});

  // Parse the Unified Patch / Diff
  const parsedFiles = useMemo(() => {
    const diffText = decodeGitOctalEscapes(reviewResult?.diff || "");
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
  }, [reviewResult]);

  // Set the default selected file on result load/change
  useMemo(() => {
    if (parsedFiles.length > 0) {
      const withComments = parsedFiles.find(f => 
        (reviewResult?.comments || []).some(c => c.filePath === f.fileName)
      );
      setSelectedFile(withComments ? withComments.fileName : parsedFiles[0].fileName);
    } else {
      setSelectedFile("");
    }
  }, [parsedFiles, reviewResult]);

  // Copy support for code snippets
  const copyToClipboard = (text: string, id: string) => {
    const code = text.replace(/```[a-z]*\n?/g, "").replace(/```$/g, "");
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCodeId(id);
      setTimeout(() => setCopiedCodeId(null), 2000);
    });
  };

  const handleStartReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prUrl && !pastedDiff) {
      setErrorMessage("请输入合法的 GitHub PR URL 或粘贴 Unified Diff 文本内容");
      return;
    }

    setLoading(true);
    setErrorMessage("");
    setLoadingStep("正在解构及提取 Pull Request 代码变更...");

    try {
      setTimeout(() => {
        setLoadingStep("正在触发 Gemini 3.5-flash AI 审计引擎进行安全性静态扫描...");
      }, 1000);

      setTimeout(() => {
        setLoadingStep("正在生成代码重构优化建议与维度加权评分...");
      }, 2500);

      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: prUrl,
          diff: pastedDiff || null,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "发生了未预期的服务器处理异常。");
      }

      setReviewResult(data);
      setResolvedIssues({});
    } catch (err: any) {
      console.error(err);
      setErrorMessage(
        err.message || 
        "无法调用大模型审计。这可能是因为无网络连接或未在 Settings 中正确设置 GEMINI_API_KEY。"
      );
    } finally {
      setLoading(false);
      setLoadingStep("");
    }
  };

  const loadDemoDiff = () => {
    setPrUrl("https://github.com/developer/sec-demo-app/pull/15");
    setPastedDiff(MOCK_REVIEW_RESULT.diff);
    setReviewResult(MOCK_REVIEW_RESULT);
    setResolvedIssues({});
    setErrorMessage("");
  };

  // Compute severity distribution
  const statistics = useMemo(() => {
    const comments = reviewResult?.comments || [];
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
  }, [reviewResult]);

  const toggleIssueResolution = (id: string) => {
    setResolvedIssues(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-emerald-400";
    if (score >= 60) return "text-amber-400";
    return "text-rose-500";
  };

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

        {/* Small Inline Micro-Form inside the Header */}
        <div className="hidden lg:flex flex-1 max-w-xl px-8">
          <div className="relative w-full">
            <input 
              type="text" 
              value={prUrl || "粘贴 PR 地址以快速开启极速审计"} 
              onChange={(e) => setPrUrl(e.target.value)}
              placeholder="Paste GitHub URL..."
              className="w-full bg-zinc-900/60 border border-zinc-800 text-xs py-1.5 px-3.5 rounded-md text-zinc-400 focus:outline-none focus:border-emerald-500/50 focus:bg-zinc-900 font-mono transition"
            />
            <div className="absolute right-2 top-1.5 flex items-center gap-2 select-none">
              <span className="text-[9px] bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-500 border border-zinc-800">AUTOMATIC</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={loadDemoDiff}
            className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-850 text-[10px] text-zinc-400 font-bold transition cursor-pointer"
          >
            <Flame className="w-3.5 h-3.5 text-amber-500" />
            演示示例
          </button>

          <div className="flex items-center gap-1.5 bg-zinc-900 px-3 py-1.5 rounded border border-zinc-800 font-mono text-[10px] text-emerald-400 select-none">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
            <span>AGENT_ONLINE</span>
          </div>
        </div>
      </header>

      {/* DETAILED TELESCOPIC SUBHEADER FOR SYSTEM STATUS */}
      <div className="bg-zinc-900/40 border-b border-zinc-900 px-6 py-2 flex items-center justify-between text-[10px] text-zinc-500 select-none">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1"><Terminal className="w-3 h-3 text-zinc-600" /> STABLE REVISION ENGINE: <strong>GEMINI-3.5-FLASH</strong></span>
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
        
        {/* INPUT SOURCE SECTION WITH ADVANCED MODERN TECH CODE ACCENTS */}
        <section className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-5 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-3 select-none">
            <span className="text-[9px] bg-zinc-800/80 px-2 py-0.5 rounded text-zinc-500 font-bold border border-zinc-800">01 / SOURCE_CONFIG</span>
          </div>

          <form onSubmit={handleStartReview} className="space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Sliders className="w-4 h-4 text-emerald-400 shrink-0" />
                <h2 className="text-xs font-bold text-white uppercase tracking-wider">
                  配置审计变更源 / PULL REQUEST OR DIFF TEXT
                </h2>
              </div>
              <p className="text-[11px] text-zinc-500 max-w-3xl mb-3 leading-relaxed">
                本平台支持深度自动化扫描。粘贴公开的 GitHub PR 地址（例如: <code className="text-zinc-400 bg-zinc-950 px-1 py-0.5 rounded">https://github.com/owner/repo/pull/1</code>），或在下方文本区直接贴入 Git 终端输出的 <code className="text-zinc-400 bg-zinc-950 px-1 py-0.5 rounded">git diff</code> 字符。
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {!pastedDiff && (
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                      GitHub Pull Request 网址 (PUBLIC REPOSITORY ONLY)
                      <Github className={`w-3.5 h-3.5 transition-colors ${prUrl ? 'text-emerald-400' : 'text-zinc-600'}`} />
                    </label>
                    {prUrl && (
                      <button 
                        type="button" 
                        onClick={() => setPrUrl("")}
                        className="text-[10px] text-rose-400 hover:text-rose-300 font-bold underline cursor-pointer"
                      >
                        清空输入框
                      </button>
                    )}
                  </div>
                  <input
                    type="url"
                    value={prUrl}
                    onChange={(e) => setPrUrl(e.target.value)}
                    placeholder="例如: https://github.com/facebook/react/pull/24185"
                    className="w-full bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-emerald-500 focus:outline-none rounded px-4 py-2 text-xs font-mono text-zinc-200 placeholder-zinc-600 transition"
                  />
                </div>
              )}

              {!prUrl && (
                <div>
                  <div className="flex justify-between items-center mb-1.5 text-[10px]">
                    <span className="flex items-center gap-1.5 text-zinc-500 font-bold uppercase tracking-wider">
                      贴入 UNIFIED RAW PATCH / GIT DIFF TEXT
                      <FileText className={`w-3.5 h-3.5 transition-colors ${pastedDiff ? 'text-emerald-400' : 'text-zinc-500'}`} />
                    </span>
                    {pastedDiff && (
                      <button 
                        type="button" 
                        onClick={() => setPastedDiff("")}
                        className="text-rose-400 hover:text-rose-300 font-bold underline cursor-pointer"
                      >
                        清空输入框
                      </button>
                    )}
                  </div>
                  <textarea
                    value={pastedDiff}
                    onChange={(e) => setPastedDiff(e.target.value)}
                    rows={4}
                    placeholder={`--- a/src/index.ts\n+++ b/src/index.ts\n@@ -2,3 +2,4 @@\n- console.log("old");\n+ console.log("new code changes");`}
                    className="w-full block bg-zinc-950 border border-zinc-800 hover:border-zinc-700 focus:border-emerald-500 focus:outline-none p-4 rounded text-xs leading-relaxed text-zinc-200 font-mono placeholder-zinc-600 scrollbar-thin"
                  />
                </div>
              )}
            </div>

            {/* Error Message Panel */}
            {errorMessage && (
              <div className="p-4 rounded-md bg-rose-950/30 border border-rose-500/30 flex items-start gap-3 mt-2 text-xs text-rose-200 animate-headShake" id="error_alert">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-semibold text-rose-400 block mb-1">AUDIT SYSTEM REPORTED AN ERROR:</strong>
                  <p className="font-sans text-[11px] text-zinc-400">{errorMessage}</p>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-2 border-t border-zinc-900">
              <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                已准备安全探针: SQL-Injection, Node Process, Memory Leaks, Cryptography Hardcoding.
              </span>
              
              <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 px-5 py-2 rounded font-bold text-xs flex items-center justify-center gap-2 transition duration-200 shadow-[0_0_15px_rgba(16,185,129,0.2)] disabled:opacity-50 disabled:pointer-events-none w-full sm:w-auto cursor-pointer"
                >
                  {loading ? (
                    <>
                      <div className="w-3 h-3 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                      <span>正在分析变更...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-zinc-950" />
                      <span>TRIGGER RE-ANALYZE / 执行安全审计</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </section>

        {/* LOADING SCANNERS OVERLAY */}
        <AnimatePresence>
          {loading && (
            <motion.div 
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="bg-zinc-900/40 border border-emerald-500/30 p-8 rounded-xl flex flex-col items-center justify-center text-center gap-4 relative overflow-hidden"
              id="loading_panel"
            >
              <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-emerald-500 to-transparent animate-pulse" />
              <div className="w-10 h-10 rounded-full border-2 border-zinc-800 border-t-emerald-400 animate-spin flex items-center justify-center">
                <ShieldAlert className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="max-w-md">
                <span className="text-[9px] uppercase tracking-wider text-emerald-500 font-bold block mb-1">SYSTEM LEVEL LOG</span>
                <p className="text-xs text-white tracking-tight font-mono mb-2 min-h-[1.5rem] bg-zinc-950 p-2 border border-zinc-900 rounded">
                  {loadingStep}
                </p>
                <div className="w-32 mx-auto bg-zinc-950 h-1 rounded-full overflow-hidden border border-zinc-800/60 mt-1">
                  <div className="h-full bg-emerald-500 rounded-full animate-[loading-bar_10s_infinite_linear]" style={{ width: "75%" }} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* DATA CONTAINER INSIDE SHARP TECH GRID */}
        <AnimatePresence>
          {!loading && reviewResult && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col gap-6"
              id="review_results_block"
            >
              
              {reviewResult.fetchError && (
                <div className="p-4 rounded-md bg-amber-950/30 border border-amber-500/30 flex items-start gap-3 text-xs" id="fetch_warning">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-semibold text-amber-400 block mb-1">获取 PR 失败，正在使用演示数据</strong>
                    <p className="font-sans text-[11px] text-zinc-400">{reviewResult.fetchError.message}</p>
                  </div>
                </div>
              )}
              
              {((reviewResult.metadata || reviewResult.semantics) && (reviewResult.semantics?.intent || reviewResult.semantics?.impactScope?.length || reviewResult.summary)) && (
                <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-5 flex flex-col gap-3" id="metadata_panel">
                  {reviewResult.metadata && (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Github className="w-4 h-4 text-emerald-400" />
                          <span className="text-xs text-zinc-400 font-mono">
                            PR #{reviewResult.metadata.pullNumber}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-mono">
                          <span>👤 {reviewResult.metadata.author}</span>
                          <span>📅 {new Date(reviewResult.metadata.createdAt).toLocaleDateString('zh-CN')}</span>
                        </div>
                      </div>

                      <h3 className="text-sm font-bold text-white leading-snug">
                        {reviewResult.metadata.title}
                      </h3>

                      {reviewResult.metadata.description && (
                        <p className="text-[11px] text-zinc-400 leading-relaxed font-sans line-clamp-3">
                          {reviewResult.metadata.description}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-2 text-[10px]">
                        {reviewResult.metadata.linkedIssues.length > 0 && (
                          <span className="text-zinc-500">
                            🔗 Issues: {reviewResult.metadata.linkedIssues.map(i => `#${i.number}`).join(' · ')}
                          </span>
                        )}
                      </div>

                      <div className="border-t border-zinc-800/60 my-1" />
                    </>
                  )}

                  {/* Semantics section — always shown when available */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">变更分析</span>
                      {reviewResult.semantics?.riskLevel && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold ${
                          reviewResult.semantics.riskLevel === 'high' ? 'bg-rose-950 text-rose-400' :
                          reviewResult.semantics.riskLevel === 'medium' ? 'bg-amber-950 text-amber-400' :
                          'bg-emerald-950 text-emerald-400'
                        }`}>
                          {reviewResult.semantics.riskLevel === 'high' ? 'HIGH RISK' :
                           reviewResult.semantics.riskLevel === 'medium' ? 'MEDIUM' : 'LOW'}
                        </span>
                      )}
                    </div>
                    {reviewResult.semantics?.intent && (
                      <p className="text-[12px] text-white leading-relaxed font-sans">
                        {reviewResult.semantics.intent}
                      </p>
                    )}
                    {reviewResult.semantics?.impactScope && reviewResult.semantics.impactScope.length > 0 && (
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className="text-zinc-500 shrink-0">📌 影响范围</span>
                        <span className="text-zinc-400">{reviewResult.semantics.impactScope.join(' · ')}</span>
                      </div>
                    )}
                    <p className="text-[10px] text-zinc-500 leading-relaxed font-sans border-t border-zinc-800/60 pt-2">
                      {reviewResult.summary}
                    </p>
                  </div>
                </div>
              )}
              
              {/* TWO COLUMN SIDEBAR & COMPARATOR LAYOUT */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6" id="overview_grids">
                
                {/* SIDEBAR: PR CHANGE SUMMARY PANEL */}
                <aside className="lg:col-span-4 flex flex-col gap-5" id="sidebar_analytics">
                  
                  {/* Key Findings — moved above score */}
                  <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      <h3 className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">关键发现 ({reviewResult.keyFindings.length})</h3>
                    </div>
                    <ul className="flex flex-col gap-2.5">
                      {reviewResult.keyFindings.map((finding, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-[11px] text-zinc-300 leading-relaxed font-sans">
                          <span className="text-amber-400 shrink-0 select-none mt-0.5 font-bold">{idx + 1}.</span>
                          <span>{finding}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Score Card */}
                  <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-5 flex flex-col items-center">
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mb-3">综合评分</span>
                    
                    <div className={`text-6xl font-black tracking-tighter ${
                      reviewResult.overallScore >= 75 ? 'text-emerald-400' : reviewResult.overallScore >= 60 ? 'text-amber-400' : 'text-rose-500'
                    }`}>
                      {reviewResult.overallScore}
                    </div>
                    <span className="text-[10px] text-zinc-600 font-mono mt-0.5">/ 100</span>

                    <div className="w-full h-1 bg-zinc-800 rounded-full mt-4 overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-1000 ${
                          reviewResult.overallScore >= 75 ? 'bg-emerald-500' : reviewResult.overallScore >= 60 ? 'bg-amber-500' : 'bg-rose-500'
                        }`} 
                        style={{ width: `${reviewResult.overallScore}%` }}
                      />
                    </div>

                    <span className={`text-[10px] mt-3 font-semibold font-sans ${
                      reviewResult.overallScore >= 75 ? 'text-emerald-400' : reviewResult.overallScore >= 60 ? 'text-amber-400' : 'text-rose-500'
                    }`}>
                      {reviewResult.overallScore >= 75 ? '通过审计 · 建议合入' : reviewResult.overallScore >= 60 ? '人工复审 · 存在风险' : '拦截 · 高危威胁'}
                    </span>
                  </div>

                  {/* Quality Dimensions */}
                  <div className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-4 flex flex-col gap-3.5">
                    <h3 className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold">质量维度</h3>
                    
                    {[
                      { key: 'security', label: '安全性 Security' },
                      { key: 'readability', label: '可读性 Readability' },
                      { key: 'performance', label: '性能 Performance' },
                      { key: 'robustness', label: '容错性 Robustness' },
                    ].map(({ key, label }) => {
                      const score = reviewResult.scores[key as keyof typeof reviewResult.scores];
                      const color = score >= 80 ? 'emerald' : score >= 60 ? 'amber' : 'rose';
                      return (
                        <div key={key} className="flex flex-col gap-1">
                          <div className="flex justify-between text-[10px] font-mono">
                            <span className="text-zinc-400">{label}</span>
                            <span className={`text-${color}-400`}>{score}%</span>
                          </div>
                          <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full bg-${color}-500 transition-all duration-1000`} style={{ width: `${score}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  </aside>

                {/* RIGHT CELL: CORE DOUBLE COLUMN DIFF COMPILER WITH INTERACTIVE REVIEW CARDS */}
                <section className="lg:col-span-8 flex flex-col bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden" id="diff_explorer">
                  
                  {/* FILE SELECTOR BAR */}
                  <div className="bg-zinc-800/35 px-4 py-2 border-b border-zinc-800 flex items-center gap-3">

                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold shrink-0">文件</span>
                    
                    <div className="flex-1 overflow-x-auto flex gap-1 hide-scrollbar">
                      {parsedFiles.map((fFile) => {
                        const count = (reviewResult?.comments || []).filter(c => c.filePath === fFile.fileName).length;
                        const active = fFile.fileName === selectedFile;
                        return (
                          <button
                            key={fFile.fileName}
                            onClick={() => setSelectedFile(fFile.fileName)}
                            className={`px-2.5 py-1 text-[10px] font-mono border rounded transition-all shrink-0 cursor-pointer flex items-center gap-1 ${
                              active 
                                ? 'bg-zinc-950 border-emerald-500/40 text-white font-semibold' 
                                : 'bg-zinc-900/40 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700'
                            }`}
                          >
                            <span className="truncate max-w-[160px]">{fFile.fileName.split('/').pop()}</span>
                            {count > 0 && (
                              <span className="px-1 bg-rose-950 text-rose-400 text-[9px] rounded font-bold">{count}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {parsedFiles.length > 5 && (
                      <span className="text-[10px] text-zinc-300 font-bold font-mono shrink-0">{parsedFiles.length} files</span>
                    )}

                  </div>

                  {/* MAIN CODELINES LIST CONTAINER WITH REAL HOVER SCANNER EFFECT */}
                  <div className="flex-1 overflow-auto relative p-4 max-h-[640px] bg-zinc-950" id="diff_code_viewport">
                    
                    {(() => {
                      const activeFileObj = parsedFiles.find(f => f.fileName === selectedFile);
                      if (!activeFileObj) {
                        return (
                          <div className="p-12 text-center text-zinc-600 font-sans text-xs">
                            {"没有检测到本分支中合适的文件代码库更改差异段。"}
                          </div>
                        );
                      }

                      // Filter any AI comments bound to this active file
                      const activeFileComments = (reviewResult?.comments || []).filter(
                        (c) => c.filePath === selectedFile
                      );

                      const metaLineIndices: number[] = [];
                      activeFileObj.lines.forEach((l, i) => {
                        if (l.type === 'header') {
                          metaLineIndices.push(i);
                        }
                      });
                      const showMeta = expandedHeaders[selectedFile] ?? false;

                      return (
                        <div className="min-w-[620px] font-mono text-[11px] leading-6 bg-zinc-950 rounded-md border border-zinc-900 overflow-hidden">
                          {metaLineIndices.length > 0 && (
                            <div
                              onClick={() => setExpandedHeaders(prev => ({ ...prev, [selectedFile]: !showMeta }))}
                              className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/60 cursor-pointer hover:bg-zinc-900/80 transition select-none border-b border-zinc-900"
                            >
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
                              
                              return (
                                trimmedLine.length > 5 && 
                                (trimmedLine.includes(trimmedOriginal) || trimmedOriginal.includes(trimmedLine) || cmt.lineNumber === line.newLine)
                              );
                            });

                            let gutterClass = "bg-zinc-950 text-zinc-700";
                            let rowClass = "text-zinc-400";
                            let displayPrefix = " ";

                            if (line.type === 'add') {
                              gutterClass = "bg-zinc-950 text-zinc-600";
                              rowClass = "text-emerald-300 border-l-2 border-emerald-500/40";
                              displayPrefix = "+";
                            } else if (line.type === 'delete') {
                              gutterClass = "bg-zinc-950 text-zinc-600";
                              rowClass = "text-rose-300 border-l-2 border-rose-500/40";
                              displayPrefix = "-";
                            } else if (line.type === 'header') {
                              gutterClass = "bg-zinc-900/50 text-zinc-600";
                              rowClass = "text-white font-semibold py-0.5";
                              displayPrefix = "#";
                            }

                            return (
                              <div key={lineIdx} className="flex flex-col">
                                
                                <div className={`flex items-center group/line ${line.type === 'header' ? 'bg-zinc-900/50 text-[10px]' : 'bg-zinc-950 hover:bg-zinc-900/20'} ${rowClass}`}>
                                  <div className={`w-10 text-right pr-2 select-none border-r border-zinc-900/80 text-[10px] shrink-0 py-px group-hover/line:bg-zinc-900/20 ${gutterClass}`}>
                                    {line.oldLine || ""}
                                  </div>
                                  <div className={`w-10 text-right pr-2 select-none border-r border-zinc-900/80 text-[10px] shrink-0 py-px group-hover/line:bg-zinc-900/20 ${gutterClass}`}>
                                    {line.newLine || ""}
                                  </div>

                                  <div className="flex-1 pl-3 font-mono whitespace-pre break-all select-text py-px">
                                    <span className="text-zinc-600 select-none inline-block w-3">{displayPrefix}</span>
                                    {line.content}
                                    {reviewResult?.codeBlocks && (() => {
                                      const matchedBlock = reviewResult.codeBlocks.find(
                                        (b) => b.filePath === selectedFile && b.lineNumber === line.newLine
                                      );
                                      if (matchedBlock) {
                                        return (
                                          <span className="ml-2 text-[9px] bg-blue-950/50 text-blue-400/80 px-1.5 py-0.5 rounded font-mono select-none inline-flex items-center gap-1">
                                            <span className="text-blue-500">
                                              {matchedBlock.type === 'function' ? '\u0192' :
                                               matchedBlock.type === 'class' ? 'C' :
                                               matchedBlock.type === 'interface' ? 'I' : 'E'}
                                            </span>
                                            {matchedBlock.name}
                                          </span>
                                        );
                                      }
                                      return null;
                                    })()}
                                  </div>
                                </div>

                                {/* AI COMPILED FEEDBACK FLOAT CARD (Inline card with beautiful visual guidelines) */}
                                {matchedComments.map((comment) => {
                                  const isResolved = resolvedIssues[comment.id];

                                  return (
                                    <div 
                                      key={comment.id}
                                      className="ml-10 sm:ml-20 my-3.5 mr-4 relative font-sans"
                                    >
                                      {/* Architectural Node Guide Joint Connector */}
                                      <div className="absolute -left-6 top-1/2 w-6 h-[1.5px] bg-rose-500/40 select-none" />

                                      {/* Audit Container card */}
                                      <div className="bg-zinc-950 border border-rose-500/30 rounded-lg p-4 shadow-2xl relative overflow-hidden">
                                        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-rose-500/50 to-transparent" />

                                        <div className="flex items-center justify-between mb-2">
                                          <div className="flex items-center gap-2">
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-black uppercase text-white font-mono ${
                                              comment.severity === 'high' ? 'bg-rose-600' : 'bg-amber-600'
                                            }`}>
                                              {comment.severity === 'high' ? 'High Risk' : comment.severity === 'medium' ? 'Medium Warning' : 'Suggestion'}
                                            </span>
                                            <span className="text-[11px] font-bold text-zinc-100 font-mono">
                                              {comment.severity === 'high' ? '🎯 安全红线拦截警告' : '⚡ 性能架构诊断'}
                                            </span>
                                          </div>
                                          
                                          {/* Resolve Toggle Indicator */}
                                          <button 
                                            type="button"
                                            onClick={() => toggleIssueResolution(comment.id)}
                                            className={`text-[10px] sm:text-[11px] font-mono px-2 py-0.5 rounded border flex items-center gap-1.5 transition cursor-pointer ${
                                              isResolved 
                                                ? 'bg-emerald-950/40 border-emerald-800 text-emerald-400'
                                                : 'bg-zinc-950 border-zinc-800 text-zinc-500 hover:text-zinc-300'
                                            }`}
                                          >
                                            {isResolved ? (
                                              <>
                                                <CheckCircle2 className="w-3.5 h-3.5" />
                                                <span>已修复 / Checked</span>
                                              </>
                                            ) : (
                                              <>
                                                <Square className="w-3 h-3 text-zinc-650" />
                                                <span>标记已执行修复</span>
                                              </>
                                            )}
                                          </button>
                                        </div>

                                        <p className={`text-[11px] leading-relaxed text-zinc-300 mb-3.5 whitespace-normal ${isResolved ? 'line-through opacity-50' : ''}`}>
                                          {comment.description}
                                        </p>

                                        {/* Suggested Fix Container */}
                                        <div className="bg-emerald-950/15 border border-emerald-900/45 rounded p-3 text-[11px] font-sans">
                                          <div className="flex justify-between items-center mb-1.5">
                                            <span className="text-[10px] text-emerald-400 uppercase font-mono font-bold tracking-wider">Suggested Rewrite / 修复方案</span>
                                            
                                            <button
                                              onClick={() => copyToClipboard(comment.suggestion, comment.id)}
                                              className="text-[9px] text-zinc-500 hover:text-white flex items-center gap-1 cursor-pointer font-mono"
                                            >
                                              {copiedCodeId === comment.id ? (
                                                <span className="text-emerald-400 font-bold">复制成功</span>
                                              ) : (
                                                <span>[ COPY CODE ]</span>
                                              )}
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
        </AnimatePresence>

      </main>

      {/* FOOTER */}
      <footer className="border-t border-zinc-900 py-6 text-center text-[11px] text-zinc-500 bg-zinc-950 mt-12 shrink-0">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="font-sans">© 2026 AI PR Reviewer Pro. 极简全栈架构设计.</p>
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
