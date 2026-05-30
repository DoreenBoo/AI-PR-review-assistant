# PR 变更智能解析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于清洗后的 Diff 内容，实现 PR 元数据提取、代码块边界检测、业务语义提取及前端可视化面板。

**Architecture:** 在现有 `/api/review` 流程中嵌入代码块检测和语义提取，并行拉取 GitHub PR 元数据，新增独立 `/api/pr/metadata` 端点。前端新增 MetadataPanel 组件和 diff 行代码块标记，全部在现有文件中扩展，不新增文件。

**Tech Stack:** Express + TypeScript, React + TypeScript, Gemini API, GitHub REST API

---

### Task 1: 扩展类型定义

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: 在 types.ts 末尾追加新接口**

在 `export interface FetchError` 之前插入：

```typescript
export interface PrMetadata {
  owner: string;
  repo: string;
  pullNumber: number;
  title: string;
  description: string;
  author: string;
  createdAt: string;
  linkedIssues: { number: number; title: string }[];
}

export interface CodeBlock {
  type: 'function' | 'class' | 'interface' | 'export';
  name: string;
  filePath: string;
  lineNumber: number;
}

export interface PrSemantics {
  intent: string;
  impactScope: string[];
  riskLevel: 'low' | 'medium' | 'high';
}
```

- [ ] **Step 2: 在 PrReviewResult 末尾追加可选字段**

```typescript
export interface PrReviewResult {
  summary: string;
  badge: string;
  scores: ReviewScore;
  overallScore: number;
  keyFindings: string[];
  comments: ReviewComment[];
  diff: string;
  fetchError?: FetchError;
  metadata?: PrMetadata;
  codeBlocks?: CodeBlock[];
  semantics?: PrSemantics;
}
```

- [ ] **Step 3: 编译验证**

Run: `npx tsc --noEmit --pretty`
Expected: exit code 0, no errors

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat: add PrMetadata, CodeBlock, PrSemantics types and extend PrReviewResult"
```

---

### Task 2: server.ts — fetchPrMetadata 函数

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: 在 `getGeminiClient()` 函数之后、`MOCK_FALLBACK_RESULT` 之前插入**

```typescript
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
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit --pretty`
Expected: exit code 0

- [ ] **Step 3: Commit**

```bash
git add server.ts
git commit -m "feat: add fetchPrMetadata for GitHub PR metadata extraction"
```

---

### Task 3: server.ts — detectCodeBlocks 函数

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: 在 `fetchPrMetadata` 之后插入**

```typescript
function detectCodeBlocks(diffText: string): {
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
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit --pretty`
Expected: exit code 0

- [ ] **Step 3: Commit**

```bash
git add server.ts
git commit -m "feat: add detectCodeBlocks for regex-based code structure detection"
```

---

### Task 4: server.ts — POST /api/pr/metadata 端点

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: 在 `/api/review` 端点之前插入新端点**

```typescript
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
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit --pretty`
Expected: exit code 0

- [ ] **Step 3: Commit**

```bash
git add server.ts
git commit -m "feat: add POST /api/pr/metadata endpoint"
```

---

### Task 5: server.ts — 增强 /api/review 集成元数据、代码块、语义

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: 在 /api/review 函数开头声明 metadataPromise 变量**

在 `const hasPastedDiff = !!diff && diff.trim().length > 0;` 之后插入：

```typescript
let metadataPromise: Promise<any> | null = null;
```

- [ ] **Step 2: 在 /api/review 内 diff 获取成功后启动元数据并行拉取**

在 `if (url && !hasPastedDiff)` 块内，`const { owner, repo, pullNumber } = parsed;` 之后，diffUrls 之前插入：

```typescript
metadataPromise = fetchPrMetadata(owner, repo, pullNumber).catch((e) => {
  console.warn("PR metadata fetch failed (non-blocking):", e.message);
  return null;
});
```

- [ ] **Step 3: 在 `targetDiff = cleanDiffContent(targetDiff);` 之后添加代码块检测**

```typescript
const codeBlocks = detectCodeBlocks(targetDiff);
```

- [ ] **Step 4: 在 Gemini responseSchema 中追加业务语义字段**

在 `overallScore` 之后、`keyFindings` 之前插入：

```typescript
businessIntent: {
  type: Type.STRING,
  description: "一言中文描述本次PR变更的业务意图",
},
impactScope: {
  type: Type.ARRAY,
  items: { type: Type.STRING },
  description: "本次变更可能影响的功能模块/业务范围列表",
},
riskLevel: {
  type: Type.STRING,
  description: "根据变更内容评估的风险等级: low | medium | high",
},
```

- [ ] **Step 5: 在 normalizeReviewResult 之后合并代码块和语义**

在 `const normalizedResult = normalizeReviewResult(parsedJson, targetDiff);` 之后：

```typescript
normalizedResult.codeBlocks = codeBlocks;

if (parsedJson.businessIntent || parsedJson.impactScope || parsedJson.riskLevel) {
  normalizedResult.semantics = {
    intent: parsedJson.businessIntent || '',
    impactScope: Array.isArray(parsedJson.impactScope) ? parsedJson.impactScope : [],
    riskLevel: (parsedJson.riskLevel && ['low', 'medium', 'high'].includes(parsedJson.riskLevel))
      ? parsedJson.riskLevel : 'low',
  };
}
```

- [ ] **Step 6: 合并元数据**

在 Step 5 代码之后：

```typescript
if (metadataPromise) {
  const metadata = await metadataPromise;
  if (metadata) {
    normalizedResult.metadata = metadata;
  }
}
```

- [ ] **Step 7: 在 Gemini 错误 fallback 分支也添加 codeBlocks**

在 `const fallbackResult = { ...MOCK_FALLBACK_RESULT }; fallbackResult.diff = targetDiff;` 之后：

```typescript
fallbackResult.codeBlocks = codeBlocks;
```

- [ ] **Step 8: 编译验证**

Run: `npx tsc --noEmit --pretty`
Expected: exit code 0

- [ ] **Step 9: Commit**

```bash
git add server.ts
git commit -m "feat: integrate metadata, code blocks, and semantics into /api/review"
```

### Task 6: 更新 .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: 追加 GITHUB_TOKEN 配置项**

在文件末尾追加：

```
# GitHub Personal Access Token (optional, for higher API rate limits)
# Without this, public repo access is limited to 60 requests/hour
GITHUB_TOKEN=your_github_personal_access_token_here
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit --pretty`
Expected: exit code 0

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore: add GITHUB_TOKEN to .env.example"
```

---

### Task 7: App.tsx — MetadataPanel 组件

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 在结果区域顶部（fetchError 警告之后、overview_grids 之前）追加 MetadataPanel**

```tsx
{reviewResult.metadata && (
  <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-5 flex flex-col gap-3" id="metadata_panel">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Github className="w-4 h-4 text-emerald-400" />
        <span className="text-xs text-zinc-400 font-mono">
          PR #{reviewResult.metadata.pullNumber}
        </span>
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
      {reviewResult.semantics?.impactScope && reviewResult.semantics.impactScope.length > 0 && (
        <span className="text-zinc-500 ml-2">
          📌 影响范围: {reviewResult.semantics.impactScope.join(' · ')}
        </span>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit --pretty`
Expected: exit code 0

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add MetadataPanel to display PR metadata and semantics"
```

---

### Task 8: App.tsx — diff 行代码块边界标记

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 在 diff 行渲染中追加代码块标记**

在 `{line.content}` 之后（即 `</span>` 之前），追加代码块标记：

```tsx
{matchedComments.map((comment) => {
```

在代码中找到 diff 行渲染位置。定位到 `{line.content}` 所在行的 `</div>` 闭合标签之前插入：

```tsx
{reviewResult?.codeBlocks && (() => {
  const matchedBlock = reviewResult.codeBlocks.find(
    (b) => b.filePath === selectedFile && b.lineNumber === line.newLine
  );
  if (matchedBlock) {
    return (
      <span className="ml-2 text-[9px] bg-blue-950/50 text-blue-400/80 px-1.5 py-0.5 rounded font-mono select-none inline-flex items-center gap-1">
        <span className="text-blue-500">
          {matchedBlock.type === 'function' ? 'ƒ' :
           matchedBlock.type === 'class' ? 'C' :
           matchedBlock.type === 'interface' ? 'I' : 'E'}
        </span>
        {matchedBlock.name}
      </span>
    );
  }
  return null;
})()}
```

具体插入位置：在 `{line.content}` 和 `</div>` 之间：

```tsx
<div className="flex-1 pl-3 font-mono whitespace-pre break-all select-text text-zinc-300">
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
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc --noEmit --pretty`
Expected: exit code 0

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add code block markers (function/class/interface) to diff lines"
```

---

### Task 9: 全量编译验证

**Files:** 无需修改

- [ ] **Step 1: 全量 TypeScript 检查**

Run: `npx tsc --noEmit --pretty`
Expected: exit code 0, no errors

- [ ] **Step 2: 整体验证 Commit**

```bash
git add .
git commit -m "chore: final type check after all PR intelligent parse changes"
```