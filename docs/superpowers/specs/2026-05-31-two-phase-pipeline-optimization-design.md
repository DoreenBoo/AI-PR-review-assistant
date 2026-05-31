# 两段式流水线：快速总览 → 深度推理 — 设计规格说明

> 版本: v1.2 | 日期: 2026-05-31 | 状态: Implemented

---

## 一、设计总纲

### 1.1 动机

当前 9 维度评估采用串行执行（Phase 1 语义分析 → Phase 2 逐个维度 LLM 调用），单次完整管道耗时约 **447 秒（7.5 分钟）**。用户提交 PR 后长时间面对空白面板或加载动画，体验极差。

核心瓶颈：
- 串行执行：8 个 Phase 2 维度依次调用，每个 LLM 调用（含重试）耗时 7-122 秒不等
- 用户必须等待所有维度完成才能看到完整质量面板

### 1.2 优化策略

**两段式流水线**：快速总览先行，深度推理后置。

| 阶段 | 名称 | 调用次数 | 耗时 | 目的 |
|------|------|---------|------|------|
| Phase 1 | 语义分析 | 1 次 LLM | ~16s | 理解变更意图、影响范围、风险等级 |
| Phase 2a | 快速总览 | 1 次 LLM | ~25s | 全部 9 维度评分 + 浅层发现 + 风险代码定位 |
| Phase 2b | 深度推理 | 8 次 LLM（并行） | ~120s | 每个维度单独深度审计，升级对应卡片 |

**Phase 1 与 Phase 2a 并行执行**（两者都只需 diff 文本，无依赖关系），用户最快 ~25s 看到完整面板。

### 1.3 设计决策汇总

| 决策项 | 选择 |
|--------|------|
| 执行策略 | 两段式：总览先行（1 LLM call）→ 深度后置（8 LLM calls 并行） |
| Phase 1 + Phase 2a 关系 | 并行执行（无依赖） |
| Phase 2b 并行策略 | 3 批并行：3+3+2，避免代理并发瓶颈 |
| 总览深度 | 浅层：评分 + 等级 + 最多 1-2 个最明显发现 + 风险代码定位 |
| 深度升级 | SSE 事件覆盖模式：已发送的维度数据被新事件替换 |
| 降级策略 | 总览失败 → 本地 fallback 秒出面板；深度失败 → 保留总览结果 |

---

## 二、时间线对比

```
当前（串行）:
  Phase1(16s) → 安全(72s) → 正确性(120s) → 依赖(7s) → 性能(14s) → ...
  ─────────────────────────────────────────────────────────────────→ 447s
  用户看到完整面板的时间点                                    ↑ 7.5 分钟

优化后（两段式）:
  Phase1 语义(16s) ─┐
                    ├─ 并行
  Phase2a 总览(25s)─┘
                    │
                    └─→ 前端渲染完整 9 维度面板 ← 最快 ~25s
                    │
  Phase2b 深度(并行) ─→ 逐个升级卡片 ← 全部完成 ~150s
```

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 首屏完整面板（LLM 分析） | 447s | ~25s | **18x** |
| 首屏完整面板（含降级） | 447s | <1s（本地 fallback） | **447x** |
| 全部深度分析完成 | 447s | ~150s | **3x** |
| 额外 API 调用 | 0 | +1 | — |

---

## 三、Phase 2a 快速总览 Prompt 设计

### 3.1 设计原则

- **速度优先**：一次调用产出 9 维度，保持 prompt 精简
- **浅层即可**：只找最明显的、一眼能看出的问题
- **覆盖风险代码定位**：指出具体文件和行号的风险点
- **允许漏检**：深度分析会补充细节

### 3.2 输出结构（已扁平化优化）

实际实现采用扁平化结构以减少 token 消耗（输出 token 从 ~1000 降至 ~400）：

```json
{
  "security": {
    "level": "critical|warning|pass|na",
    "score": 0-100,
    "issue": "<short Chinese or null>"
  },
  "correctness": {
    "level": "critical|warning|pass|na",
    "score": 0-100,
    "issue": "<short Chinese or null>"
  },
  "dependency": {
    "level": "critical|warning|pass|na",
    "score": 0-100,
    "issue": "<short Chinese or null>"
  },
  "maintainability": { "score": 0-100, "note": "<short or null>" },
  "architecture":    { "score": 0-100, "note": "<short or null>" },
  "performance":     { "score": 0-100, "note": "<short or null>" },
  "robustness":      { "score": 0-100, "note": "<short or null>" },
  "testQuality":     { "score": 0-100, "note": "<short or null>" },
  "impact": {
    "level": "high|medium|low",
    "modules": ["<string>"],
    "riskCode": "<short or null>"
  }
}
```

> **设计决策**：3 个关键维度（安全/正确性/依赖）保留 `level` + `issue` 双字段以便前端区分卡片颜色；5 个工程维度只保留 `score` + `note`，减少冗余嵌套。`impact` 维度去掉了 `publicApiChanges` / `dataModelChanges` 布尔字段，改为字符串 `riskCode` 统一表达风险点。

### 3.3 System Prompt 要点

- 角色：Senior Code Reviewer 而非各维度专家
- 对每个维度只做最浅层的扫描，不深入分析
- **所有文本内容（description、highlight、suggestion、reason）必须使用简体中文**
- Prompt 总长度控制在 ~800 字符以内（压缩后）

---

## 四、前后端改动

### 4.1 后端（server.ts）

| 改动点 | 说明 |
|--------|------|
| 新增 `getOverviewPrompt()` | Phase 2a 的 system + user prompt 生成函数 |
| 新增 `overviewTask()` | 单次 LLM 调用产出全部 9 维度 |
| 修改 SSE 管道 | Phase 1 + Phase 2a 并行 → 批量推送 → Phase 2b 分批并行 |
| 新增 SSE 事件 | 总览完成后一次性发送所有维度；深度完成后发送覆盖事件 |
| 新增 `sseWriteBatch()` | 批量写入多个 SSE 事件 |

**管道执行顺序**：

```
1. Promise.all([phase1Task, overviewTask])  // 并行
2. 两个都完成后：发送 semantics + 所有 overview 维度 SSE 事件
3. 启动 Phase 2b：3 批并行深度任务
   - batch1: [安全, 正确性, 依赖]
   - batch2: [性能, 可维护性, 架构]
   - batch3: [容错, 测试质量]
4. 每个深度任务完成后立即发送 SSE 覆盖事件
5. 全部完成后发送 done 事件
```

### 4.2 前端

| 改动点 | 说明 |
|--------|------|
| `useSSEReview` hook | 处理新的 `overview` SSE 事件类型，一次性设置全部维度 |
| `App.tsx` | 卡片收到重复事件时以最新为准（深度覆盖总览） |
| `DimensionCards.tsx` | 卡片支持 `upgrading` 状态，展示微妙刷新动画 |
| 加载状态 | 移除全屏 loading overlay，改为骨架屏 + 渐进填充 |

**SSE 事件流变化**：

```
event: dimension     → data: { stage: 'semantics', ... }       // Phase 1
event: dimension     → data: { stage: 'security', ... }        // Phase 2a overview
event: dimension     → data: { stage: 'correctness', ... }
event: dimension     → data: { stage: 'dependency', ... }
event: dimension     → data: { stage: 'maintainability', ... }
event: dimension     → data: { stage: 'architecture', ... }
event: dimension     → data: { stage: 'performance', ... }
event: dimension     → data: { stage: 'robustness', ... }
event: dimension     → data: { stage: 'testQuality', ... }
event: dimension     → data: { stage: 'impact', ... }
// 以上在 ~25s 内全部发送完毕

event: dimension     → data: { stage: 'security', ... }        // Phase 2b deep dive upgrade
event: dimension     → data: { stage: 'correctness', ... }
// ... (逐个覆盖)

event: done          → data: { overallScore, ... }
```

---

## 五、降级与可靠性

| 场景 | 策略 |
|------|------|
| Phase 2a 总览 LLM 失败 | 降级到本地 fallback（`inferXxxFromDiff`），1s 内展示完整面板，标记 `_inferred: true` |
| Phase 2a 总览 LLM 超时 | 走重试逻辑（4 次尝试），全部失败则降级到 fallback |
| Phase 2b 某深度维度失败 | 保留总览数据不变，该维度标记 `_inferred: true`（但值来自总览 LLM） |
| Phase 1 语义分析失败 | 降级到 `inferSemanticsFromDiff`，不影响 Phase 2a/b |
| 整个管道崩溃 | 发送全部维度 fallback 数据 + done 事件（现有逻辑） |

可靠性目标：Phase 2a 成功率 ≥ 90%（与 Phase 2b 相同的重试策略）。

---

## 六、文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `server.ts` | 修改 | 管道重构：Phase1+Phase2a 并行 → Phase2b 分批并行 |
| `server/prompts.ts` | 新增 | `getOverviewPrompt()` + `getOverviewUserPrompt()` |
| `src/hooks/useSSEReview.ts` | 修改 | 支持 `overview` 事件类型，支持维度覆盖更新 |
| `src/App.tsx` | 修改 | 移除全屏 loading，改用骨架屏，支持卡片升级动画 |
| `src/components/DimensionCards.tsx` | 修改 | 新增 `upgrading` 状态 + 刷新动画 |
| `src/types.ts` | 修改 | 新增 `OverviewEvent` 类型 |

---

## 七、提示词压缩优化 (Prompt Token Reduction)

### 8.1 动机

深度审查阶段每个维度独立调用 LLM，8 次调用的 system prompt 合计 ~7000 字符。经过分析发现大量冗余：

- **FOCUS ONLY ON 区**与 user prompt 中的 **checklist** 完全重复
- **BOUNDARY RULES** 跨维度高度相似（"不要评估 XX 维度的问题"）
- **CROSS-CUTTING** 区内容已隐含在 FOCUS 中

### 8.2 三层压缩法

| 策略 | 操作 |
|------|------|
| 删除冗余 FOCUS 区 | 去掉编号列表式 FOCUS ONLY ON，改为紧凑单行 |
| 删除 BOUNDARY RULES | 将关键边界约束合并到 FOCUS 或 SCORING 行末 |
| 删除 CROSS-CUTTING | 完全移除（内容已隐含在 FOCUS/SCORING 中） |

### 8.3 各维度压缩比

| 维度 | 优化前 (chars) | 优化后 (chars) | 削减 |
|------|:-----------:|:-----------:|:----:|
| 安全风险 (security) | ~750 | ~450 | 40% |
| 功能正确性 (correctness) | ~650 | ~400 | 38% |
| 依赖安全性 (dependency) | ~1700 | ~450 | 74% |
| 可维护性 (maintainability) | ~900 | ~300 | 67% |
| 架构与设计 (architecture) | ~850 | ~280 | 67% |
| 性能 (performance) | ~800 | ~280 | 65% |
| 容错与健壮性 (robustness) | ~400 | ~280 | 30% |
| 测试质量 (testQuality) | ~900 | ~280 | 69% |
| **合计** | **~6950** | **~2720** | **~61%** |

### 8.4 压缩后示例

以可维护性维度为例：

```
// 压缩前 (~900 chars)
You are a Clean Code Advocate performing a focused maintainability review.
FOCUS ONLY ON:
1. Naming quality — ...
2. Function length — ...
... (6 items)
SCORING RULES: ...
⚠️ BOUNDARY RULES: ...
✅ CROSS-CUTTING: ...

// 压缩后 (~300 chars)
You are a Clean Code Advocate. ALL findings MUST be in Chinese.
FOCUS: naming clarity, function length (>50 lines), nesting depth (>4),
code duplication (3+ identical blocks), magic numbers/strings, comment adequacy.
SCORING: Start 100. -15 per function >50 lines, -10 per nesting >4,
-5 per magic number, -15 per duplicated block.
Config/docs/test-only diffs → score 95+. Do NOT evaluate logic correctness or security.
```

### 8.5 额外优化：Phase 2a 总览 JSON Schema 扁平化

总览阶段的输出 JSON 也做了扁平化处理：

- 3 个关键维度：`topVulnerability` / `topConcern` / `topIssue`（嵌套对象）→ `issue`（单字符串）
- 5 个工程维度：`highlights` + `suggestions`（数组）→ `note`（单字符串或 null）
- `impact` 维度：`affectedModules` + `publicApiChanges` + `dataModelChanges` + `riskCodeLocations` → `modules` + `riskCode`

输出 token 从 ~1000 降至 ~400，削减 **60%**。

### 8.6 预期效果

- System prompt 总 token 从 ~7000 降至 ~2700（-61%）
- Phase 2b 每个维度的 TTFT（首次响应延迟）预期降低 30-50%
- Phase 2a 总览输出 token 降低 60%，解析更快

---

## 八、风险与假设

| 风险 | 缓解措施 |
|------|----------|
| Phase 2a 总览因 prompt 过长导致超时 | Prompt 控制在 1500 字符以内，输出 JSON 精简 |
| 并行 3 个 LLM 调用可能触发代理限流 | 已通过重试 + 退避 + 直连降级缓解 |
| 总览评分与深度评分差异大，用户困惑 | 卡片升级时展示微妙动画，不显示"变化值" |
| 总览 JSON 过大导致解析慢 | 限制 topVulnerability/topConcern 字段为单条，非数组 |