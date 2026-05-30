# 多维度代码质量评估体系 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 PR 审计从 4 维度单次 LLM 调用升级为 9 维度多轮并行 SSE 流式评估，前端展示雷达图+卡片混合布局。

**Architecture:** Phase 1 语义分析（串行）→ Phase 2 8 维度并行 LLM 调用 → 每完成一个 SSE 推送 → Stage 3 本地加权汇总。新增 `server/prompts.ts` 和 `server/fallback.ts` 解耦 960 行的 server.ts。前端新增 `RadarChart`、`DimensionCards` 组件，使用 fetch + ReadableStream 消费 SSE 流。

**Tech Stack:** TypeScript, Express, React 19, SVG, Tailwind CSS, @google/genai, DeepSeek API

**Files to create:**
- `server/prompts.ts` — 8 维度 System Instruction + User Prompt 构建函数
- `server/fallback.ts` — 8 个 inferXxxFromDiff() 本地兜底函数  
- `src/components/RadarChart.tsx` — SVG 雷达图组件
- `src/components/DimensionCards.tsx` — 敏感维度+工程维度卡片组件
- `src/hooks/useSSEReview.ts` — SSE 客户端 hook

**Files to modify:**
- `src/types.ts` — 扩展为 9 维度类型系统
- `server.ts` — 导出 detectCodeBlocks/inferSemanticsFromDiff，新增 /api/review/stream endpoint
- `src/App.tsx` — 集成新 Dashboard 布局

---

## Task 1: 扩展类型系统

**Files:** Modify `src/types.ts` (在 PrReviewResult 接口后追加)

- [ ] **Step 1: 添加多维度类型定义**

```typescript
// ========== 多维度评估 v2.0 ==========
export type AuditLevel = 'critical' | 'warning' | 'pass' | 'na';
export type OverallLevel = 'block' | 'review' | 'approve';

export interface SecurityVulnerability { category: string; description: string; filePath: string; lineNumber: number; severity: 'high' | 'medium' | 'low'; }
export interface SecurityAudit { level: AuditLevel; score: number; vulnerabilities: SecurityVulnerability[]; _inferred?: boolean; }
export interface CorrectnessConcern { type: 'logic_error' | 'race_condition' | 'boundary_gap' | 'api_misuse' | 'null_safety' | 'state_inconsistency'; description: string; filePath: string; lineNumber: number; }
export interface CorrectnessAudit { level: AuditLevel; score: number; concerns: CorrectnessConcern[]; _inferred?: boolean; }
export interface DependencyAudit { level: AuditLevel; score: number; outdatedDeps: { name: string; currentVersion: string; latestVersion?: string; risk: string }[]; licenseIssues: { name: string; license: string; risk: string }[]; _inferred?: boolean; }
export interface EngineeringScore { score: number; highlights: string[]; suggestions: string[]; _inferred?: boolean; }
export interface ReviewScoresV2 { maintainability: EngineeringScore; architecture: EngineeringScore; performance: EngineeringScore; robustness: EngineeringScore; testQuality: EngineeringScore; }
export interface ChangeImpact { level: 'high' | 'medium' | 'low'; publicApiChanges: boolean; dataModelChanges: boolean; crossModuleDeps: string[]; affectedModules: string[]; _inferred?: boolean; }
export interface PrReviewResultV2 { semantics: PrSemantics; security: SecurityAudit; correctness: CorrectnessAudit; dependency: DependencyAudit; scores: ReviewScoresV2; impact: ChangeImpact; overallScore: number; overallLevel: OverallLevel; summary: string; badge: string; keyFindings: string[]; comments: ReviewComment[]; diff: string; fetchError?: FetchError; metadata?: PrMetadata; codeBlocks?: CodeBlock[]; }
export type SSEEvent = { stage: 'semantics'; data: PrSemantics } | { stage: 'security'; data: SecurityAudit } | { stage: 'correctness'; data: CorrectnessAudit } | { stage: 'dependency'; data: DependencyAudit } | { stage: 'maintainability'; data: EngineeringScore } | { stage: 'architecture'; data: EngineeringScore } | { stage: 'performance'; data: EngineeringScore } | { stage: 'robustness'; data: EngineeringScore } | { stage: 'testQuality'; data: EngineeringScore } | { stage: 'impact'; data: ChangeImpact } | { stage: 'done'; data: { overallScore: number; overallLevel: OverallLevel; summary: string; badge: string; keyFindings: string[]; comments: ReviewComment[] } };
```

- [ ] **Step 2: 验证 `npx tsc --noEmit` 通过**
- [ ] **Step 3: Commit** `git commit -m "feat(types): add 9-dimension quality assessment type system"`

---

## Task 2: 创建提示词构建模块

**Files:** Create `server/prompts.ts`

提示词设计参考 Spec 第五节。需要输出以下导出：

- [ ] **Step 1: 导出 `getPhase1SystemInstruction()`** — 沿用现有 server.ts 第 725-793 行的 systemInstruction，提取为独立函数
- [ ] **Step 2: 导出 `getPhase1UserPrompt(diffText)`** — 沿用 server.ts 第 795-810 行的 userPrompt
- [ ] **Step 3: 导出 `buildPhase2Context(semantics)`, `buildPhase2UserPrompt(semantics, dimensionName, checklist, diffText)`** — 构建 Phase 2 上下文前缀
- [ ] **Step 4: 导出 `getSecurityPrompt()`** — 角色 Senior Security Engineer，7 项检查点，精确边界声明（参考 Spec 5.3），返回 `{ systemInstruction, jsonSchema }`
- [ ] **Step 5: 导出 `getCorrectnessPrompt()`** — 角色 QA Architect，6 项检查点，精确边界声明
- [ ] **Step 6: 导出 `getDependencyPrompt()`** — 角色 DevSecOps Engineer，4 项检查点，精确边界声明
- [ ] **Step 7: 导出 `getEngineeringPrompts(): EngineeringPrompt[]`** — 返回 5 个维度（可维护性/架构/性能/容错/测试质量），每个含 systemInstruction + jsonSchema + checklist
- [ ] **Step 8: 验证 `npx tsc --noEmit`**
- [ ] **Step 9: Commit** `git commit -m "feat(prompts): add 8-dimension prompt builders with boundary rules"`

> **实现要点**: 每个维度的 `systemInstruction` 必须包含 Spec 5.3 中的精确边界声明（`⚠️ 边界声明:` + `✅ 交叉场景仍需关注:`），不能用笼统的"不关心XX"替代。

---

## Task 3: 创建本地兜底引擎

**Files:** Create `server/fallback.ts`

- [ ] **Step 1: 添加辅助函数** `getFilePaths(diffText)`, `getAddedLines(diffText)`, `getRemovedLines(diffText)`
- [ ] **Step 2: 导出 `inferSecurityFromDiff(diffText): SecurityAudit`** — 沿用现有高危/中危正则（10+7），返回带 `_inferred: true` 的结果
- [ ] **Step 3: 导出 `inferCorrectnessFromDiff(diffText): CorrectnessAudit`** — 检测空catch块、类型转换未处理NaN、删除return
- [ ] **Step 4: 导出 `inferDependencyFromDiff(diffText): DependencyAudit`** — 检测 package.json/go.mod diff，提取预发布版本标记
- [ ] **Step 5: 导出 5 个工程维度兜底**:
  - `inferMaintainabilityFromDiff` — 长函数/深层嵌套/魔法数字
  - `inferArchitectureFromDiff` — import 模式/文件数量
  - `inferPerformanceFromDiff` — 同步IO/循环await
  - `inferRobustnessFromDiff` — try-catch/Promise catch 覆盖
  - `inferTestQualityFromDiff` — 测试文件存在性与比例
- [ ] **Step 6: 导出 `inferImpactFromDiff(diffText, semantics): ChangeImpact`** — 基于文件路径判断公共API/数据模型变更
- [ ] **Step 7: 验证 `npx tsc --noEmit`**
- [ ] **Step 8: Commit** `git commit -m "feat(fallback): add 8 inference functions for local heuristic fallback"`

---

## Task 4: 后端 SSE 管道编排

**Files:** Modify `server.ts`

- [ ] **Step 1: 导出共享函数** — 将 `detectCodeBlocks` 和 `inferSemanticsFromDiff` 改为 `export function`
- [ ] **Step 2: 修正 `server/fallback.ts` 导入** — `import { detectCodeBlocks } from "./server"`
- [ ] **Step 3: 添加导入** — 顶部引入 prompts.ts 和 fallback.ts 的导出
- [ ] **Step 4: 添加 SSE 辅助函数**:
  ```typescript
  function sseWrite(res: Response, event: SSEEvent): void {
    res.write(`event: dimension\ndata: ${JSON.stringify(event)}\n\n`);
  }
  function sseDone(res: Response, data: SSEEvent['data'] & { overallScore: number; ... }): void {
    res.write(`event: done\ndata: ${JSON.stringify(data)}\n\n`);
    res.end();
  }
  ```
- [ ] **Step 5: 添加 `calculateOverall()`** — 加权汇总算法（Spec 4.6 节）：
  - 敏感维度 critical 一票否决（security → score≤40，correctness → score≤35）
  - 加权公式: correctness×0.20 + dependency×0.10 + maintainability×0.15 + architecture×0.15 + performance×0.15 + robustness×0.15 + testQuality×0.10
  - overallLevel: critical → block, <50 → block, <70 → review, ≥70 → approve
- [ ] **Step 6: 添加 `callLLMForDimension(model, systemInstruction, userPrompt, jsonSchema)`** — 根据 model 参数路由到 DeepSeek 或 Gemini
- [ ] **Step 7: 新增 `POST /api/review/stream` endpoint** — 实现三阶段管道:
  1. **Stage 0**: Diff 获取（复用现有逻辑）
  2. **Stage 1**: `callLLMForDimension` → Phase 1 语义 → `sseWrite('semantics', ...)`
  3. **Stage 2**: `Promise.allSettled` 并发 8 个 LLM 调用，每个包装 try/catch（失败走 fallback），完成即 `sseWrite`
  4. **Stage 3**: 本地计算 impact + 加权汇总 → `sseDone`

  关键代码骨架:
  ```typescript
  app.post("/api/review/stream", async (req, res) => {
    // ... Stage 0 diff获取 (与现有 /api/review 相同)
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    try {
      // Stage 1
      const phase1Json = JSON.parse(await callLLMForDimension(model, getPhase1SystemInstruction() + deepseekSchema, getPhase1UserPrompt(targetDiff)));
      const semantics = { intent: phase1Json.businessIntent || '', impactScope: phase1Json.impactScope || [], riskLevel: phase1Json.riskLevel || 'low' };
      if (!semantics.intent || !semantics.impactScope.length) Object.assign(semantics, inferSemanticsFromDiff(targetDiff, codeBlocks));
      sseWrite(res, { stage: 'semantics', data: semantics });

      // Stage 2 - 并发 8 calls (模式示例)
      const securityTask = (async () => {
        try {
          const { systemInstruction, jsonSchema } = getSecurityPrompt();
          const text = await callLLMForDimension(model, systemInstruction, buildPhase2UserPrompt(semantics, "安全风险", checklist, targetDiff), jsonSchema);
          const j = JSON.parse(text.trim());
          const data: SecurityAudit = { level: j.level || 'pass', score: j.score ?? 80, vulnerabilities: j.vulnerabilities || [] };
          sseWrite(res, { stage: 'security', data });
          return data;
        } catch { const d = inferSecurityFromDiff(targetDiff); sseWrite(res, { stage: 'security', data: d }); return d; }
      })();
      // ... 同样模式 × 7
      const results = await Promise.allSettled([securityTask, correctnessTask, dependencyTask, ...engineeringTasks]);

      // Stage 3
      const impact = inferImpactFromDiff(targetDiff, semantics);
      sseWrite(res, { stage: 'impact', data: impact });
      const { overallScore, overallLevel } = calculateOverall(...);
      sseDone(res, { overallScore, overallLevel, summary, badge, keyFindings, comments });
    } catch (e) { res.end(); }
  });
  ```

- [ ] **Step 8: 验证 `npx tsc --noEmit`** — 逐一解决类型错误
- [ ] **Step 9: 手动测试** `curl -X POST http://localhost:3000/api/review/stream -H "Content-Type: application/json" -d '{"diff":"...","model":"deepseek"}'` 验证 SSE 流
- [ ] **Step 10: Commit** `git commit -m "feat(server): add SSE streaming endpoint for multi-dimension review"`

---

## Task 5: 创建 SSE 客户端 Hook

**Files:** Create `src/hooks/useSSEReview.ts`

- [ ] **Step 1: 实现 `useSSEReview()` hook**

  核心逻辑:
  1. 状态: `SSEReviewState` 包含所有 9 维度字段（初始 null）+ loading/error
  2. `startReview(prUrl, pastedDiff, model)` → fetch POST /api/review/stream → ReadableStream 读取
  3. 手动解析 SSE 文本流（按 `\n\n` 分割，提取 `data:` 行，JSON.parse）
  4. 通过 `setState` 逐个 patch 状态字段（user functional update 保证不丢事件）
  5. `cancelReview()` → AbortController.abort()

  类型定义:
  ```typescript
  interface SSEReviewState {
    loading: boolean; semantics: PrSemantics | null;
    security: SecurityAudit | null; correctness: CorrectnessAudit | null; dependency: DependencyAudit | null;
    maintainability: EngineeringScore | null; architecture: EngineeringScore | null;
    performance: EngineeringScore | null; robustness: EngineeringScore | null; testQuality: EngineeringScore | null;
    impact: ChangeImpact | null;
    overallScore: number | null; overallLevel: string | null; summary: string | null; badge: string | null;
    keyFindings: string[]; comments: ReviewComment[]; error: string | null;
  }
  ```

- [ ] **Step 2: 验证 `npx tsc --noEmit`**
- [ ] **Step 3: Commit** `git commit -m "feat(hook): add SSE streaming review hook"`

---

## Task 6: 创建雷达图组件

**Files:** Create `src/components/RadarChart.tsx`

- [ ] **Step 1: 实现 SVG 雷达图**

  Props: 8 个维度数据 + overallScore + highlightedDimension
  核心实现:
  - 8 轴等角分布（每轴 45°），中心 (130,130)，半径 85
  - 3 层背景六边形（30%/60%/100% 刻度）
  - 根据各维度 score 计算数据点 `polarToCartesian(angle, score/100*R)`
  - 数据多边形 `fill="rgba(16,185,129,0.08)" stroke="#10b981"`
  - highlight: 悬浮维度时该轴点放大(r=5)，其余半透明；未加载维度(r=0)灰色
  - 中央叠加 overallScore 大数字
  - 外围 8 个文字标签

- [ ] **Step 2: 验证 `npx tsc --noEmit`**
- [ ] **Step 3: Commit** `git commit -m "feat(component): add SVG radar chart component"`

---

## Task 7: 创建维度卡片组件

**Files:** Create `src/components/DimensionCards.tsx`

- [ ] **Step 1: 实现卡片组件集**

  导出:
  - `SkeletonCard` — 加载态骨架（shimmer pulse 动画）
  - `SecurityCard` — 左边框色(红/橙/绿) + 等级Badge + 漏洞简述 + 展开详情
  - `CorrectnessCard` — 同结构，显示 concerns 列表
  - `DependencyCard` — 同结构，显示过期依赖/许可证
  - `EngineeringScoreCard` — 显示分数 + highlights + suggestions，无等级Badge
  - `InferredBadge` — 🔍 + hover title="本地启发式分析"

  交互:
  - onMouseEnter → parent callback 设置 highlightedDimension
  - onClick → parent callback 切换 expanded 状态
  - expanded 时在卡片下方展开详情列表

- [ ] **Step 2: 验证 `npx tsc --noEmit`**
- [ ] **Step 3: Commit** `git commit -m "feat(component): add dimension card components with expand/collapse"`

---

## Task 8: 集成到 App.tsx

**Files:** Modify `src/App.tsx`

- [ ] **Step 1: 添加导入** — RadarChart, DimensionCards, useSSEReview, 新类型
- [ ] **Step 2: 替换审核面板区域**

  在现有的 `{reviewResult && ...}` 区块中，将左侧栏的 4 维度进度条替换为新 Dashboard:

  新布局结构（替换原 `lg:col-span-4` 的 sidebar）:
  ```tsx
  <aside className="lg:col-span-5 flex flex-col gap-4">
    {/* 顶部结论栏 */}
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 flex items-center gap-4">
      <div className="w-1 h-10 bg-gradient-to-b from-rose-500 via-amber-500 to-emerald-500 rounded-full" />
      <div className="flex-1">
        <div className="text-[9px] text-zinc-500 uppercase font-bold">审计结论</div>
        <div className="text-xs text-white font-bold mt-0.5">{reviewState.summary}</div>
      </div>
      <div className="text-center">
        <div className={`text-3xl font-black ${overallScoreColor}`}>{reviewState.overallScore}</div>
        <LevelBadge level={reviewState.overallLevel} />
      </div>
    </div>

    {/* 三栏: 敏感维度 | 雷达图 | 工程维度 */}
    <div className="flex items-start gap-3">
      {/* 左: 敏感维度 */}
      <div className="flex flex-col gap-2 w-[160px] shrink-0">
        <SecurityCard data={reviewState.security} highlighted={highlighted === 'security'} onHover={setHighlighted} onClick={toggleExpand} expanded={expanded === 'security'} />
        <CorrectnessCard data={reviewState.correctness} ... />
        <DependencyCard data={reviewState.dependency} ... />
      </div>
      {/* 中: 雷达图 */}
      <RadarChart {...reviewState} highlightedDimension={highlighted} />
      {/* 右: 工程维度 */}
      <div className="flex flex-col gap-1.5 w-[160px] shrink-0">
        <EngineeringScoreCard label="可维护性" data={reviewState.maintainability} dim="maintainability" ... />
        ... 其他 4 个
      </div>
    </div>

    {/* 底: 变更影响 */}
    <ImpactBar data={reviewState.impact} />

    {/* 关键发现 */}
    <KeyFindingsList findings={reviewState.keyFindings} />
  </aside>
  ```

- [ ] **Step 3: 保留 Diff 文件区** — 右侧 `lg:col-span-7` 的 Diff Explorer 保持不变
- [ ] **Step 4: 保留现有兼容性** — 保留现有的 `handleStartReview`（非 SSE 模式）和 MOCK_REVIEW_RESULT（演示数据），新增 SSE 模式作为可选
- [ ] **Step 5: 更新演示数据** — `MOCK_REVIEW_RESULT` 使用 `PrReviewResultV2` 结构，填充 9 维度数据
- [ ] **Step 6: 验证 `npx tsc --noEmit` + `npm run dev` 浏览器测试**
- [ ] **Step 7: Commit** `git commit -m "feat(ui): integrate radar chart + dimension cards dashboard"`

---

## Task 9: 联调打磨

**Files:** Modify `server.ts`, `src/App.tsx`

- [ ] **Step 1: SSE 超时/断连处理** — 添加 heartbeat 注释行，前端检测 15s 无数据则重连
- [ ] **Step 2: 移动端响应式** — 三栏布局在 `lg` 以下折叠为单列堆叠，雷达图缩小
- [ ] **Step 3: 本地推断标记渲染** — 检查 `_inferred` 字段，卡片显示 🔍，雷达图数据点虚线
- [ ] **Step 4: 现有功能回归** — 验证旧的 `/api/review` endpoint 仍然正常工作，演示数据正常
- [ ] **Step 5: 验证 `npx tsc --noEmit` + 全流程手动测试**
- [ ] **Step 6: Commit** `git commit -m "chore: polish SSE flow, responsive layout, inferred markers"`

---

## Final Verification

- [ ] Run `npx tsc --noEmit` — zero errors
- [ ] Run `npm run dev` — server starts, frontend renders
- [ ] Test with demo data — 9 维度卡片 + 雷达图正确渲染
- [ ] Test with `POST /api/review/stream` — SSE 流正常推送
- [ ] Test with paste diff — 两个 endpoint 均正常
- [ ] Test model switch — DeepSeek / Gemini 均正常
