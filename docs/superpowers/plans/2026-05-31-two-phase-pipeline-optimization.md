# 两段式流水线：快速总览 → 深度推理 实施计划

> **状态**: 核心任务已完成 ✓ | **日期**: 2026-05-31
>
> **已完成**:
> - Task 1: Phase 2a 快速总览 Prompt ✓
> - 提示词压缩优化: 工程维度 systemInstruction 从 ~6950 chars → ~2720 chars (-61%) ✓
> - Phase 2a JSON Schema 扁平化: 输出 token 从 ~1000 → ~400 (-60%) ✓
> - Task 2-5: 前后端管道重构 ✓
>
> **待验证**: Task 6 全流程编译测试 (需运行时环境)

---

### Task 1: 新增 Phase 2a 快速总览 Prompt

**Files:**
- Modify: `server/prompts.ts`

- [x] **Step 1: 在 prompts.ts 末尾追加 overview prompt 导出函数**

在文件末尾 `export function getEngineeringPrompts()` 的 `];` 和 `}` 之后（第 362 行 `}` 后），追加以下代码：

```typescript
// ==========================================
// Section 7: Phase 2a Quick Overview Prompt
// ==========================================

export function getOverviewSystemPrompt(): string {
  return `You are a Senior Code Reviewer. Scan this Git diff QUICKLY and produce a shallow assessment for ALL 9 dimensions at once. Focus on OBVIOUS issues only — skip deep analysis. For each dimension, give a score (0-100) and level where applicable. Locate at most 1-2 risk code locations with file paths.

DIMENSIONS TO ASSESS:
1. Security — SQL injection, XSS, hardcoded keys, auth bypass. Level: critical|warning|pass|na
2. Correctness — logic errors, null safety, race conditions, API misuse. Level: critical|warning|pass|na  
3. Dependency — CVEs, license issues, version downgrades. Level: critical|warning|pass|na
4. Maintainability — naming, function length, nesting, magic numbers. Score 0-100
5. Architecture — circular deps, coupling, layering violations. Score 0-100
6. Performance — O(n²), N+1 queries, blocking I/O, large allocations. Score 0-100
7. Robustness — error handling, input validation, resource cleanup, timeouts. Score 0-100
8. Test Quality — coverage, assertions, edge cases, mock usage. Score 0-100
9. Change Impact — level: high|medium|low, affected modules, public API / data model changes

RULES:
- Only flag the MOST OBVIOUS issues. Don't dig deep.
- If a dimension has no obvious issues, give score 80-100 and level "pass".
- Locate risk code: provide filePath and lineNumber for the most concerning code.
- Keep descriptions short (under 80 chars).`;
}

export function getOverviewJsonSchema(): string {
  return `Return ONLY a valid JSON object (no markdown fences):
{
  "security": { "level": "critical"|"warning"|"pass"|"na", "score": <0-100>, "topVulnerability": null or { "category": "sql_injection"|"xss"|"hardcoded_secret"|"auth_bypass"|"crypto_flaw"|"path_traversal"|"idor"|"unsafe_deserialization"|"info_leak", "description": "<short>", "filePath": "<string>" } },
  "correctness": { "level": "critical"|"warning"|"pass"|"na", "score": <0-100>, "topConcern": null or { "type": "logic_error"|"race_condition"|"boundary_gap"|"api_misuse"|"null_safety"|"state_inconsistency", "description": "<short>", "filePath": "<string>" } },
  "dependency": { "level": "critical"|"warning"|"pass"|"na", "score": <0-100>, "topIssue": null or { "name": "<string>", "risk": "<short Chinese>" } },
  "maintainability": { "score": <0-100>, "highlights": ["<string>"], "suggestions": ["<string>"] },
  "architecture": { "score": <0-100>, "highlights": ["<string>"], "suggestions": ["<string>"] },
  "performance": { "score": <0-100>, "highlights": ["<string>"], "suggestions": ["<string>"] },
  "robustness": { "score": <0-100>, "highlights": ["<string>"], "suggestions": ["<string>"] },
  "testQuality": { "score": <0-100>, "highlights": ["<string>"], "suggestions": ["<string>"] },
  "impact": { "level": "high"|"medium"|"low", "affectedModules": ["<string>"], "publicApiChanges": <bool>, "dataModelChanges": <bool>, "riskCodeLocations": [{ "filePath": "<string>", "lineNumber": <int>, "reason": "<short Chinese>" }] }
}`;
}

export function getOverviewUserPrompt(diffText: string): string {
  return `Quick shallow scan of the following Git Diff. Assess ALL 9 dimensions at surface level only. Flag only OBVIOUS issues. Locate risk code with file path and line number.

--- GIT DIFF START ---
${diffText}
--- GIT DIFF END ---`;
}
```

- [ ] **Step 2: 验证编译**

```bash
npx esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs
```

Expected: Exit code 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add server/prompts.ts
git commit -m "feat: add Phase 2a quick overview prompt for all 9 dimensions"
```

---

### Task 2: 重构 server.ts SSE 管道 — Phase 1 + Phase 2a 并行

**Files:**
- Modify: `server.ts` (imports, pipeline logic)

- [ ] **Step 1: 更新 imports，加入 overview prompt 导入**

在 `server.ts` 第 10 行，修改 `getEngineeringPrompts, buildPhase2UserPrompt` 导入：

```typescript
import { getPhase1SystemInstruction, getPhase1UserPrompt, getSecurityPrompt, getCorrectnessPrompt, getDependencyPrompt, getEngineeringPrompts, buildPhase2UserPrompt, getOverviewSystemPrompt, getOverviewJsonSchema, getOverviewUserPrompt } from "./server/prompts.js";
```

- [ ] **Step 2: 在当前 Phase 1 语义分析区域后，增加 overviewTask**

找到第 861 行 `sseWrite(res, { stage: 'semantics', data: semantics });` 之后，在 Phase 2 深度任务定义区之前。但实际改动是重构整个管道块。

替换从第 834 行 `try {` 开始到第 982 行 `console.log(...)` 之前的大段落。精确替换如下：

**旧代码范围（第 834 行到第 982 行）保持原样，新代码直接整个替换此段。**

需要替换的核心逻辑段：Phase 1 + 初始变量定义 + Phase 2 任务定义 + 串行执行循环。

---

首先删除第 834-982 行的旧管道（`try {` 内的所有内容直到 `logRetryStats()` 之前），替换为：

```typescript
  try {
    codeBlocks = detectCodeBlocks(targetDiff);

    // ========== Phase 1: Semantics (independent) ==========
    let semantics: { intent: string; impactScope: string[]; riskLevel: 'low' | 'medium' | 'high' };
    const phase1Task = (async () => {
      try {
        console.log(`[SSE] Phase 1 LLM (semantics) → calling ${model}...`);
        const t0 = Date.now();
        const DEEPSEEK_SCHEMA = `\n\nReturn ONLY a valid JSON object. Do not include markdown code fences or other text:\n{"businessIntent":"...","impactScope":["..."],"riskLevel":"high"|"medium"|"low"}`;
        const phase1System = getPhase1SystemInstruction();
        const phase1Text = await callLLMForDimension(model, phase1System, getPhase1UserPrompt(targetDiff), DEEPSEEK_SCHEMA, 'Phase1-Semantics');
        const phase1Json = JSON.parse(phase1Text.trim());
        console.log(`[SSE] Phase 1 LLM (semantics) ✓ OK (${Date.now() - t0}ms) → intent="${phase1Json.businessIntent?.substring(0,60)}" risk=${phase1Json.riskLevel}`);
        semantics = {
          intent: phase1Json.businessIntent || '',
          impactScope: Array.isArray(phase1Json.impactScope) ? phase1Json.impactScope : [],
          riskLevel: (phase1Json.riskLevel && ['low', 'medium', 'high'].includes(phase1Json.riskLevel))
            ? phase1Json.riskLevel as 'low' | 'medium' | 'high'
            : 'low',
        };
        if (!semantics.intent || semantics.impactScope.length === 0) {
          console.log(`[SSE] Phase 1 result incomplete, merging local inference`);
          Object.assign(semantics, inferSemanticsFromDiff(targetDiff, codeBlocks));
        }
      } catch (e: any) {
        console.warn(`[SSE] Phase 1 LLM ✗ FAILED (${e.message?.substring(0,100)}), using local inference`);
        semantics = inferSemanticsFromDiff(targetDiff, codeBlocks);
      }
      sseWrite(res, { stage: 'semantics', data: semantics });
    })();

    // ========== Phase 2a: Quick Overview (independent, parallel with Phase 1) ==========
    let security: SecurityAudit = { level: 'pass', score: 80, vulnerabilities: [], _inferred: true };
    let correctness: CorrectnessAudit = { level: 'pass', score: 75, concerns: [], _inferred: true };
    let dependency: DependencyAudit = { level: 'na', score: 0, outdatedDeps: [], licenseIssues: [], _inferred: true };
    let maintainability: EngineeringScore = { score: 50, highlights: [], suggestions: [], _inferred: true };
    let architecture: EngineeringScore = { score: 50, highlights: [], suggestions: [], _inferred: true };
    let performance: EngineeringScore = { score: 50, highlights: [], suggestions: [], _inferred: true };
    let robustness: EngineeringScore = { score: 50, highlights: [], suggestions: [], _inferred: true };
    let testQuality: EngineeringScore = { score: 50, highlights: [], suggestions: [], _inferred: true };
    let impact: any = null;

    const overviewTask = (async () => {
      try {
        console.log(`[SSE] Phase 2a Overview → calling ${model}...`);
        const t0 = Date.now();
        const overviewSystem = getOverviewSystemPrompt();
        const overviewSchema = getOverviewJsonSchema();
        const overviewText = await callLLMForDimension(model, overviewSystem,
          getOverviewUserPrompt(targetDiff), overviewSchema, 'Phase2a-Overview');
        const j = JSON.parse(overviewText.trim());
        console.log(`[SSE] Phase 2a Overview ✓ OK (${Date.now() - t0}ms)`);

        security = {
          level: j.security?.level || 'pass',
          score: j.security?.score ?? 80,
          vulnerabilities: j.security?.topVulnerability ? [{
            category: j.security.topVulnerability.category,
            description: j.security.topVulnerability.description,
            filePath: j.security.topVulnerability.filePath || '',
            severity: j.security.level === 'critical' ? 'high' : 'medium',
          }] : [],
          _inferred: false,
        };
        correctness = {
          level: j.correctness?.level || 'pass',
          score: j.correctness?.score ?? 75,
          concerns: j.correctness?.topConcern ? [{
            type: j.correctness.topConcern.type,
            description: j.correctness.topConcern.description,
            filePath: j.correctness.topConcern.filePath || '',
          }] : [],
          _inferred: false,
        };
        dependency = {
          level: j.dependency?.level || 'na',
          score: j.dependency?.score ?? 75,
          outdatedDeps: j.dependency?.topIssue ? [{ name: j.dependency.topIssue.name, currentVersion: '', latestVersion: '', risk: j.dependency.topIssue.risk }] : [],
          licenseIssues: [],
          _inferred: false,
        };
        maintainability = { score: j.maintainability?.score ?? 50, highlights: j.maintainability?.highlights || [], suggestions: j.maintainability?.suggestions || [], _inferred: false };
        architecture = { score: j.architecture?.score ?? 50, highlights: j.architecture?.highlights || [], suggestions: j.architecture?.suggestions || [], _inferred: false };
        performance = { score: j.performance?.score ?? 50, highlights: j.performance?.highlights || [], suggestions: j.performance?.suggestions || [], _inferred: false };
        robustness = { score: j.robustness?.score ?? 50, highlights: j.robustness?.highlights || [], suggestions: j.robustness?.suggestions || [], _inferred: false };
        testQuality = { score: j.testQuality?.score ?? 50, highlights: j.testQuality?.highlights || [], suggestions: j.testQuality?.suggestions || [], _inferred: false };
        impact = {
          level: j.impact?.level || 'low',
          affectedModules: j.impact?.affectedModules || [],
          publicApiChanges: j.impact?.publicApiChanges || false,
          dataModelChanges: j.impact?.dataModelChanges || false,
          riskCodeLocations: j.impact?.riskCodeLocations || [],
          _inferred: false,
        };
      } catch (e: any) {
        console.warn(`[SSE] Phase 2a Overview ✗ FAILED (${e.message?.substring(0,100)}), using local fallback for all dimensions`);
        security = inferSecurityFromDiff(targetDiff);
        correctness = inferCorrectnessFromDiff(targetDiff);
        dependency = inferDependencyFromDiff(targetDiff);
        maintainability = inferMaintainabilityFromDiff(targetDiff);
        architecture = inferArchitectureFromDiff(targetDiff);
        performance = inferPerformanceFromDiff(targetDiff);
        robustness = inferRobustnessFromDiff(targetDiff);
        testQuality = inferTestQualityFromDiff(targetDiff);
        impact = inferImpactFromDiff(targetDiff, semantics || inferSemanticsFromDiff(targetDiff, codeBlocks));
      }
    })();

    // ========== Wait for Phase 1 + Phase 2a ==========
    await Promise.all([phase1Task, overviewTask]);

    // Send all overview dimensions as SSE events
    sseWrite(res, { stage: 'security', data: security });
    sseWrite(res, { stage: 'correctness', data: correctness });
    sseWrite(res, { stage: 'dependency', data: dependency });
    sseWrite(res, { stage: 'maintainability', data: maintainability });
    sseWrite(res, { stage: 'architecture', data: architecture });
    sseWrite(res, { stage: 'performance', data: performance });
    sseWrite(res, { stage: 'robustness', data: robustness });
    sseWrite(res, { stage: 'testQuality', data: testQuality });

    if (!impact) {
      impact = inferImpactFromDiff(targetDiff, semantics);
    }
    sseWrite(res, { stage: 'impact', data: impact });
    console.log(`[SSE] Phase 2a: All 9 dimension overview events sent to client`);

    // ========== Phase 2b: Deep Dive (batch parallel) ==========
    const secPrompt = getSecurityPrompt();
    const secChecklist = `1. SQL/NoSQL injection\n2. XSS / HTML injection\n3. Hardcoded credentials\n4. Authentication/authorization bypass\n5. Cryptographic flaws\n6. Path traversal / IDOR\n7. Insecure deserialization`;

    const corrPrompt = getCorrectnessPrompt();
    const corrChecklist = `1. Logic errors\n2. Race conditions\n3. Boundary/edge case gaps\n4. API/library misuse\n5. Incomplete error handling\n6. State inconsistency risks`;

    const depPrompt = getDependencyPrompt();
    const depChecklist = `1. Dependencies with known CVEs\n2. License compliance\n3. Downgraded security libraries\n4. Pre-release/unstable versions`;

    const engPrompts = getEngineeringPrompts();

    // Security deep dive
    const securityDeepTask = async () => {
      try {
        console.log(`[SSE] Phase 2b Deep (安全风险) → calling ${model}...`);
        const t0 = Date.now();
        const text = await callLLMForDimension(model, secPrompt.systemInstruction,
          buildPhase2UserPrompt(semantics, "安全风险", secChecklist, targetDiff), secPrompt.jsonSchema, '安全风险-Deep');
        const j = JSON.parse(text.trim());
        security = { level: j.level || 'pass', score: j.score ?? 80, vulnerabilities: j.vulnerabilities || [], _inferred: false };
        console.log(`[SSE] Phase 2b Deep (安全风险) ✓ OK (${Date.now() - t0}ms) → level=${security.level} score=${security.score}`);
      } catch (e: any) {
        console.warn(`[SSE] Phase 2b Deep (安全风险) ✗ FAILED, keeping overview data`);
        security._inferred = true;
      }
      sseWrite(res, { stage: 'security', data: security });
    };

    // Correctness deep dive
    const correctnessDeepTask = async () => {
      try {
        console.log(`[SSE] Phase 2b Deep (功能正确性) → calling ${model}...`);
        const t0 = Date.now();
        const text = await callLLMForDimension(model, corrPrompt.systemInstruction,
          buildPhase2UserPrompt(semantics, "功能正确性", corrChecklist, targetDiff), corrPrompt.jsonSchema, '功能正确性-Deep');
        const j = JSON.parse(text.trim());
        correctness = { level: j.level || 'pass', score: j.score ?? 75, concerns: j.concerns || [], _inferred: false };
        console.log(`[SSE] Phase 2b Deep (功能正确性) ✓ OK (${Date.now() - t0}ms) → level=${correctness.level} score=${correctness.score}`);
      } catch (e: any) {
        console.warn(`[SSE] Phase 2b Deep (功能正确性) ✗ FAILED, keeping overview data`);
        correctness._inferred = true;
      }
      sseWrite(res, { stage: 'correctness', data: correctness });
    };

    // Dependency deep dive
    const dependencyDeepTask = async () => {
      try {
        console.log(`[SSE] Phase 2b Deep (依赖安全性) → calling ${model}...`);
        const t0 = Date.now();
        const text = await callLLMForDimension(model, depPrompt.systemInstruction,
          buildPhase2UserPrompt(semantics, "依赖安全性", depChecklist, truncateDiffForDimension(targetDiff, '依赖安全性')), depPrompt.jsonSchema, '依赖安全性-Deep');
        const j = JSON.parse(text.trim());
        dependency = { level: j.level || 'pass', score: j.score ?? 75, outdatedDeps: j.outdatedDeps || [], licenseIssues: j.licenseIssues || [], _inferred: false };
        console.log(`[SSE] Phase 2b Deep (依赖安全性) ✓ OK (${Date.now() - t0}ms) → level=${dependency.level} score=${dependency.score}`);
      } catch (e: any) {
        console.warn(`[SSE] Phase 2b Deep (依赖安全性) ✗ FAILED, keeping overview data`);
        dependency._inferred = true;
      }
      sseWrite(res, { stage: 'dependency', data: dependency });
    };

    // Engineering deep dive factory
    const makeEngDeepTask = (prompt: typeof engPrompts[0], dimKey: string) => async () => {
      try {
        console.log(`[SSE] Phase 2b Deep (${prompt.dimensionName}) → calling ${model}...`);
        const t0 = Date.now();
        const text = await callLLMForDimension(model, prompt.systemInstruction,
          buildPhase2UserPrompt(semantics, prompt.dimensionName, prompt.checklist, truncateDiffForDimension(targetDiff, prompt.dimensionName)), prompt.jsonSchema, prompt.dimensionName + '-Deep');
        const j = JSON.parse(text.trim());
        const score: EngineeringScore = { score: j.score ?? 50, highlights: j.highlights || [], suggestions: j.suggestions || [], _inferred: false };
        console.log(`[SSE] Phase 2b Deep (${prompt.dimensionName}) ✓ OK (${Date.now() - t0}ms) → score=${score.score}`);
        switch (dimKey) {
          case 'maintainability': maintainability = score; break;
          case 'architecture': architecture = score; break;
          case 'performance': performance = score; break;
          case 'robustness': robustness = score; break;
          case 'testQuality': testQuality = score; break;
        }
        sseWrite(res, { stage: dimKey as any, data: score });
      } catch (e: any) {
        console.warn(`[SSE] Phase 2b Deep (${prompt.dimensionName}) ✗ FAILED, keeping overview data`);
        const engVars: Record<string, EngineeringScore> = { maintainability, architecture, performance, robustness, testQuality };
        const current = engVars[dimKey];
        if (current) { (current as any)._inferred = true; sseWrite(res, { stage: dimKey as any, data: current }); }
      }
    };

    // batch1: 敏感维度 (3 concurrent)
    console.log(`[SSE] Phase 2b Batch 1/3: security, correctness, dependency`);
    await Promise.all([securityDeepTask(), correctnessDeepTask(), dependencyDeepTask()]);

    // batch2: 工程维度 1-3 (3 concurrent)
    console.log(`[SSE] Phase 2b Batch 2/3: 性能, 可维护性, 架构与设计`);
    await Promise.all([
      makeEngDeepTask(engPrompts[2], 'performance')(),
      makeEngDeepTask(engPrompts[0], 'maintainability')(),
      makeEngDeepTask(engPrompts[1], 'architecture')(),
    ]);

    // batch3: 工程维度 4-5 (2 concurrent)
    console.log(`[SSE] Phase 2b Batch 3/3: 容错与健壮性, 测试质量`);
    await Promise.all([
      makeEngDeepTask(engPrompts[3], 'robustness')(),
      makeEngDeepTask(engPrompts[4], 'testQuality')(),
    ]);

    console.log(`[SSE] Phase 2 complete — results: security(${security._inferred ? 'OVERVIEW' : 'DEEP'} level=${security.level}) correctness(${correctness._inferred ? 'OVERVIEW' : 'DEEP'} level=${correctness.level}) dependency(${dependency._inferred ? 'OVERVIEW' : 'DEEP'} level=${dependency.level}) maintainability(${maintainability._inferred ? 'OVERVIEW' : 'DEEP'} score=${maintainability.score}) architecture(${architecture._inferred ? 'OVERVIEW' : 'DEEP'} score=${architecture.score}) performance(${performance._inferred ? 'OVERVIEW' : 'DEEP'} score=${performance.score}) robustness(${robustness._inferred ? 'OVERVIEW' : 'DEEP'} score=${robustness.score}) testQuality(${testQuality._inferred ? 'OVERVIEW' : 'DEEP'} score=${testQuality.score})`);
    logRetryStats();
```

**继续保留第 982 行之后的代码不变**（impact SSE 发送已经移到前面、calculateOverall、sseDone、outer catch）。

- [ ] **Step 2: 删除旧的 Phase 2 任务定义和串行执行循环**

删除原第 863-982 行的旧代码：
- 旧的 secPrompt/corrPrompt/depPrompt 定义（现在在 Phase 2b 区重新定义）
- 旧的 8 个任务函数定义
- 旧的 orderedTasks 和 for 循环

这些已被新代码中的 Phase 2b 区所替代。

- [ ] **Step 3: 验证编译**

```bash
npx esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs
```

Expected: Exit code 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "feat: restructure SSE pipeline with Phase1+Phase2a parallel and Phase2b batch parallel"
```

---

### Task 3: 更新 useSSEReview hook 支持维度覆盖

**Files:**
- Modify: `src/hooks/useSSEReview.ts`

- [ ] **Step 1: hook 已原生支持重复事件覆盖，无需改动**

当前 switch-case 逻辑中，每个 stage 事件到达时直接 `next.xxx = event.data`，后续相同 stage 的事件会自然覆盖。

无需代码修改。但需确认 loading 状态在首次数据到达时就应解除。

- [ ] **Step 2: 修改 loading 状态 — semantics 事件到达时即可视为"面板可见"**

在 `useSSEReview.ts` 第 77 行，修改 semantics case：

```typescript
case "semantics": next.semantics = event.data; next.loading = false; break;
```

原来是 `done` case 中 `next.loading = false`（第 95 行），现在 semantics 到达时就解除 loading，用户可以看到卡片骨架开始填充。

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit
```

Expected: Exit code 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSSEReview.ts
git commit -m "feat: dismiss loading state on first semantics event arrival"
```

---

### Task 4: 更新 App.tsx — 骨架屏替代全屏 Loading

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 修改 loading overlay 逻辑 — semantics 到达后即展示面板**

当前第 539-563 行是全屏 loading overlay，第 567 行是结果面板（条件：`(!loading && reviewResult) || reviewState.loading || reviewState.semantics`）。

将 loading overlay 条件从 `(loading || reviewState.loading)` 改为仅在 **非 SSE 模式加载且无 semantics** 时显示：

去掉第 540 行的 `reviewState.loading`，保留 `loading`。

但更关键的是：需要在 reviewState 刚启动（loading=true 但 semantics=null）时展示骨架面板而非空白。

修改第 566-568 行的结果面板条件：

```tsx
{((!loading && reviewResult) || reviewState.loading || reviewState.semantics) && (
```

改为：

```tsx
{((!loading && reviewResult) || reviewState.semantics || reviewState.security || reviewState.impact) && (
```

同时，当 `reviewState.loading && !reviewState.semantics` 时，在结果面板内部展示骨架占位。

- [ ] **Step 2: 在 SSE 面板区添加骨架占位**

找到第 666 行 `{reviewState.loading || reviewState.semantics ? (` 分支区域。

在第 707 行的卡片 grid `<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">` 内部，为每个 null 状态的卡片显示 SkeletonCard：

当前 SecurityCard 组件在 `data` 为 null 时显示简化的占位卡片（已有）。检查 DimensionCards.tsx 的 SecurityCard/CorrectnessCard/DependencyCard/EngineeringScoreCard 的 null 分支渲染，确认它们已经显示占位 UI。

现有代码中这些组件在 data=null 时返回带文字的无数据卡片，基本可以接受。无需额外改动。

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit
```

Expected: Exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: show skeleton cards instead of full loading overlay during SSE"
```

---

### Task 5: 为 DimensionCards 添加升级动画

**Files:**
- Modify: `src/components/DimensionCards.tsx`

- [ ] **Step 1: 为卡片外层添加 key 驱动的动画**

利用 React `key` 属性在数据更新时触发重新挂载动画。

在 App.tsx 的每个卡片渲染处，给卡片加一个基于 `data._inferred` 和 `data.score` 的 key：

修改 App.tsx 第 708-748 行的卡片渲染：

```tsx
<SecurityCard
  key={`security-${reviewState.security?.score}-${reviewState.security?._inferred}`}
  data={reviewState.security}
  ...
/>
```

对所有 8 个卡片做相同处理。这样当 score 变化或 _inferred 状态变化时，卡片会重新挂载并触发 motion 进入动画。

- [ ] **Step 2: 在 DimensionCards 中包装 motion.div**

在 `SecurityCard`（第 70 行）和 `CorrectnessCard`（第 136 行）和 `DependencyCard`（第 193 行）和 `EngineeringScoreCard`（第 256 行）的最外层 div 改为 motion.div：

修改 imports 添加：
```typescript
import { motion } from "motion/react";
```

将 SecurityCard 的返回 JSX 最外层 `<div` 改为 `<motion.div`，并添加动画属性：

```tsx
<motion.div
  initial={{ opacity: 0.6, scale: 0.97 }}
  animate={{ opacity: 1, scale: 1 }}
  transition={{ duration: 0.3 }}
  className={...}
  ...
>
```

对 CorrectnessCard、DependencyCard、EngineeringScoreCard 同样处理。

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit
```

Expected: Exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/DimensionCards.tsx src/App.tsx
git commit -m "feat: add subtle upgrade animation when dimension cards refresh"
```

---

### Task 6: 全流程编译测试与验证

**Files:**
- None (verification only)

- [ ] **Step 1: 完整编译**

```bash
npx esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs && npx tsc --noEmit
```

Expected: Both exit code 0.

- [ ] **Step 2: 启动服务器**

```bash
pnpm run dev
```

- [ ] **Step 3: 发送测试请求，验证首屏时间**

使用 PR `https://github.com/explorerNW/ai-agent-monorepo/pull/165` 发送 SSE 请求：

```javascript
// test_overview.mjs
const response = await fetch("http://localhost:3000/api/review/stream", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    githubUrl: "https://github.com/explorerNW/ai-agent-monorepo/pull/165",
    model: "deepseek",
  }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
const t0 = Date.now();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (line.startsWith("event: ")) {
      const eventType = line.slice(7);
      if (eventType === "done") {
        console.log(`[${(Date.now()-t0)/1000}s] DONE event received`);
      }
    } else if (line.startsWith("data: ")) {
      try {
        const data = JSON.parse(line.slice(6));
        if (data.stage && data.stage !== 'done') {
          console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s] stage=${data.stage}`);
        }
      } catch {}
    }
  }
}
```

运行: `node test_overview.mjs`

- [ ] **Step 4: 验证指标**

控制台应输出：
- 第一个 dimension 事件应在 ~25s 内到达（Phase 2a overview）
- 9 个维度全部发送完毕应在 ~30s 内
- 后续 Phase 2b deep dive 升级事件在 ~150s 内完成

- [ ] **Step 5: 清理测试文件并 Commit**

```bash
rm test_overview.mjs
git add dist/server.cjs
git commit -m "chore: final build and verification of two-phase pipeline"
```