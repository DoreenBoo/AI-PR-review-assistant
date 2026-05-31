# 提示词工程设计文档

## 一、设计总纲

### 1.1 核心命题

Gemini API 在代码审计场景中存在两个典型问题：

| 问题 | 表现 | 根因 |
|------|------|------|
| 语义字段不稳定输出 | `impactScope` 为空数组，`businessIntent` 为空字符串 | 模型将语义分析视为附属任务，注意力资源优先分配给代码审计 |
| 异常路径下语义完全丢失 | 显示"无法确定影响范围" | Fallback 使用硬编码占位值，未利用本地信息推理 |

### 1.2 设计策略

**三层防御体系**：

```
┌─────────────────────────────────────────────────┐
│ Layer 1: Prompt Engineering (Gemini 可用时)       │
│ 两阶段分析管线 → 推理链引导 → 格式锚定 → 示例注入 │
├─────────────────────────────────────────────────┤
│ Layer 2: Code-Level Fallback (Gemini 返回空字段)  │
│ hasEmptySemantics 检测 → inferSemanticsFromDiff() │
├─────────────────────────────────────────────────┤
│ Layer 3: Heuristic Fallback (Gemini 完全不可用)   │
│ 文件路径模块映射 → 风险模式正则 → 变更比例推断     │
└─────────────────────────────────────────────────┘
```

---

## 二、两阶段分析管线 (Two-Phase Pipeline)

### 2.1 设计原理

将原来平铺式的"审计代码 + 顺带语义"的单阶段提示词，重构为**强制分阶段执行**的两阶段管线。核心洞察：**Gemini 按顺序处理指令，先接触的指令会获得更多注意力资源**。

**Phase 1（业务语义分析）排在 Phase 2（代码审计）之前**，确保语义字段在模型"注意力预算"最充足时被处理。

### 2.2 SystemInstruction 结构

```
You are an elite production-grade Tech Lead performing code review.
You MUST follow a strict two-phase analysis pipeline. Never skip a phase.

==============================
PHASE 1 — BUSINESS SEMANTIC ANALYSIS
==============================
Execute this phase FIRST, before any code audit. Reason step-by-step:

Step 1.1 — Identify the technical action
Step 1.2 — Infer the business motivation  (8 categories)
Step 1.3 — Determine impact scope
Step 1.4 — Assess risk level
Step 1.5 — Produce businessIntent (template + examples)

After completing Phase 1, you MUST populate:
  "businessIntent": "..."
  "impactScope": ["...", "..."]
  "riskLevel": "high" | "medium" | "low"

==============================
PHASE 2 — CODE QUALITY AUDIT
==============================
Only after Phase 1 is complete, audit the code for:
  2.1 Security vulnerabilities
  2.2 Code quality issues
  2.3 Scoring (0-100)
  2.4 Output (summary, badge, overallScore, keyFindings, comments)
```

### 2.3 推理链引导 (Chain-of-Thought Anchoring)

Phase 1 使用 **5 步推理链** 替代原来的自由推断：

| 步骤 | 引导内容 | 设计意图 |
|------|---------|---------|
| 1.1 技术动作 | 文件增/删/改的识别 | 建立对 diff 的基本认知 |
| 1.2 业务动机 | 8 种分类枚举 | 提供分类框架，避免随意输出 |
| 1.3 影响范围 | 具体示例 | 约束输出为具体的模块名而非泛化描述 |
| 1.4 风险评级 | 三级标准 + 触发条件 | 规则化评级，减少主观偏差 |
| 1.5 意图输出 | 模板 + Good/Bad 示例 | 格式锚定 + 反面约束 |

### 2.4 UserPrompt 结构

```
Execute the two-phase code review pipeline on the following Git Diff.

PHASE 1 — First, analyze the BUSINESS CONTEXT of this change:
  • Read every file path and code hunk to understand WHAT was modified.
  • Categorize the motivation: security fix | new feature | refactor | ...
  • Identify which system modules / functional areas are touched.
  • Rate the operational risk as "high" | "medium" | "low".
  • Produce a one-sentence Chinese businessIntent.

PHASE 2 — Then perform the full security and code quality audit.

CRITICAL: The Phase 1 output (businessIntent, impactScope, riskLevel) is
REQUIRED and must never be omitted or left empty.

--- GIT DIFF START ---
...
--- GIT DIFF END ---
```

UserPrompt 与 SystemInstruction 形成 **双层锚定**：SystemInstruction 定义方法（how），UserPrompt 定义任务（what），两者语义一致、结构对应。

---

## 三、"软约束 + 硬兜底" 策略

### 3.1 为什么语义字段不在 schema required 中

这是一个 **有意为之的设计权衡**：

| 方案 | 优点 | 风险 |
|------|------|------|
| 加入 `required` | Schema 级强制约束 | Gemini 无法推断语义时 → schema validation error → **整个审计请求失败** |
| 不加入 `required` | 单字段缺失不影响整体 | Gemini 可能跳过语义字段 |

选择不加入 `required`，但通过三层机制弥补约束力：

1. **自然语言强制声明**：SystemInstruction（`You MUST follow a strict two-phase analysis pipeline. Never skip a phase.`）+ UserPrompt（`CRITICAL: The Phase 1 output is REQUIRED`）
2. **Schema 描述强化**：`【必填-Phase1】` 前缀 + 示例注入 + 禁止性约束（`禁止输出空字符串或过于笼统的描述如"修改代码"`）
3. **代码层兜底**：`inferSemanticsFromDiff()` 在 Gemini 输出为空时自动接管

### 3.2 Schema 字段排序优化

语义字段 **提升至 schema properties 首位**（排在 summary 之前），利用 JSON schema 顺序对 LLM 的暗示效应：

```json
{
  "properties": {
    "businessIntent": {...},   // ← 原排第 5，现排第 1
    "impactScope": {...},      // ← 原排第 6，现排第 2
    "riskLevel": {...},        // ← 原排第 7，现排第 3
    "summary": {...},
    ...
  }
}
```

### 3.3 正常路径语义空字段检测

Gemini 成功返回但语义为空时，自动切换为本地推理：

```typescript
const hasEmptySemantics = !parsedSemantics.intent || parsedSemantics.impactScope.length === 0;
normalizedResult.semantics = hasEmptySemantics
  ? inferSemanticsFromDiff(targetDiff, codeBlocks)
  : parsedSemantics;
```

---

## 四、本地启发式语义推理引擎

### 4.1 `inferSemanticsFromDiff()` 架构

当 Gemini 完全不可用时（API Key 缺失、网络断开、超时），使用纯本地推理生成语义：

```
输入: Diff 文本 + detectCodeBlocks 结果
  │
  ├─→ 文件路径提取 (+++ b/, --- a/)
  │     │
  │     └─→ 目录名 → 模块关键词表匹配 → impactScope
  │
  ├─→ 新增/删除行统计
  │     │
  │     └─→ 比例推断 + 新文件/删除文件 → businessIntent
  │
  └─→ + 行高危/中危模式扫描
        │
        └─→ 风险正则匹配 → riskLevel
```

### 4.2 模块关键词映射表 (22 项)

| 文件路径关键词 | 映射为 |
|---------------|--------|
| `auth`, `login` | 认证模块 / 登录模块 |
| `user` | 用户模块 |
| `api` | API接口 |
| `db`, `database` | 数据库 |
| `config` | 系统配置 |
| `router` | 路由层 |
| `middleware` | 中间件 |
| `component` | 前端组件 |
| `util` | 工具函数 |
| `test` | 测试模块 |
| `ci`, `docker` | CI/CD流水线 / 容器部署 |
| `package` | 依赖管理 |
| `migration`, `schema`, `model` | 数据迁移 / 数据模型 |
| `validator` | 校验层 |
| `service`, `controller` | 业务服务层 / 控制器层 |

### 4.3 风险模式正则 (高危 10 项 + 中危 7 项)

**高危模式** (触发即判定 `high`)：
- SQL 注入：`executeRaw()`、`exec(...)`、模板拼接 `${username/password/query/sql}`
- 硬编码凭证：`password = "xxx"`、`apiKey = "xxx"`、`secret = "xxx"`、`token = "xxx"`
- 签名密钥泄露：`jwt.sign(..., "hardcoded_key")`
- XSS：`innerHTML =`、`dangerouslySetInnerHTML`
- 代码注入：`eval()`、`new Function()`

**中危模式** (影响 `medium` 判定)：
- 定时器未管理：`setInterval()`、`setTimeout()`
- 异步复杂度：`new Promise()`、`async function`
- 破坏性操作：`delete obj.prop`、`.remove()`
- 技术债务标记：`TODO`、`FIXME`、`HACK`、`XXX`
- 异常处理：`catch()`、`throw new Error`

### 4.4 意图推断逻辑

基于新增/删除行比例和文件变化模式：

| 条件 | 推断意图 |
|------|---------|
| 删除文件 + 极少新增 | `清理项目中的废弃代码和文件` |
| 新文件 + 极少删除 | `新增N个功能模块` |
| 高危风险模式触发 | `代码变更中存在安全风险项，建议重点审查` |
| 有代码块检测结果 | `更新N处代码逻辑` |
| 新增行 > 删除行 × 2 | `扩展功能实现，新增业务逻辑` |
| 删除行 > 新增行 × 2 | `精简代码结构，移除冗余逻辑` |
| 其他 | `常规代码变更与优化` |

---

## 五、运行时配置

### 5.1 环境变量加载策略

```
优先级 1: .env 文件 → dotenv.config()
优先级 2: .env.example 文件 (fallback)
优先级 3: 系统环境变量 (process.env)
```

### 5.2 网络代理支持

针对 Google API 被阻的环境，使用 `undici` 的 `ProxyAgent` 全局拦截 `fetch`：

```typescript
import { ProxyAgent, setGlobalDispatcher } from "undici";

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
              || process.env.HTTP_PROXY || process.env.http_proxy;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent({ uri: proxyUrl }));
}
```

支持标准 HTTP 代理（CONNECT 隧道转发 HTTPS），配置示例：
```
HTTPS_PROXY="http://127.0.0.1:10809"
```

---

## 六、触发点全景图

语义字段在以下 **3 条路径** 中都会被填充：

```
POST /api/review
  │
  ├─ [正常路径] Gemini 成功
  │     │
  │     ├─ 语义非空 → 使用 Gemini 输出
  │     └─ 语义为空 → hasEmptySemantics → inferSemanticsFromDiff()
  │
  ├─ [异常路径] Gemini catch
  │     └─ inferSemanticsFromDiff()
  │
  └─ [Diff 获取失败] GitHub API 失败
        └─ inferSemanticsFromDiff()
```

**保障**：无论 Gemini 是否可用、API Key 是否配置、网络是否通畅，`businessIntent` / `impactScope` / `riskLevel` 三个字段始终有有意义的值。

---

## 七、提示词压缩策略 (Token Reduction)

### 7.1 背景

在"两段式流水线"架构中，Phase 2b 深度审查阶段共需 **8 次独立 LLM 调用**（3 个关键维度 + 5 个工程维度），每次调用都携带独立的 system instruction。原始设计中，各维度的 system instruction 包含大段冗余文本（FOCUS ONLY ON / BOUNDARY RULES / CROSS-CUTTING），合计约 **7000 字符**，直接拖慢了 TTFT（首次响应延迟）。

### 7.2 三层压缩法

| 策略 | 操作 | 原因 |
|------|------|------|
| 删除冗余 FOCUS 区 | 去掉编号列表式 FOCUS ONLY ON，改为紧凑单行 | 内容与 user prompt 中的 checklist 完全重复 |
| 删除 BOUNDARY RULES | 将关键边界约束（如"不要评估正确性问题"）合并到 FOCUS/SCORING 行末 | 跨维度高度相似，LLM 无需重复读取 |
| 删除 CROSS-CUTTING | 完全移除该区域 | 内容已隐含在 FOCUS/SCORING 中 |

### 7.3 压缩效果

| 维度 | 优化前 | 优化后 | 削减 |
|------|:-----:|:-----:|:----:|
| 安全风险 | ~750 chars | ~450 chars | 40% |
| 功能正确性 | ~650 chars | ~400 chars | 38% |
| 依赖安全性 | ~1700 chars | ~450 chars | 74% |
| 可维护性 | ~900 chars | ~300 chars | 67% |
| 架构与设计 | ~850 chars | ~280 chars | 67% |
| 性能 | ~800 chars | ~280 chars | 65% |
| 容错与健壮性 | ~400 chars | ~280 chars | 30% |
| 测试质量 | ~900 chars | ~280 chars | 69% |
| **合计** | **~6950 chars** | **~2720 chars** | **~61%** |

### 7.4 压缩示例

```
// 压缩前 (可维护性, ~900 chars)
You are a Clean Code Advocate performing a focused maintainability review.

FOCUS ONLY ON:
1. Naming quality — do names clearly express intent?
2. Function length — any function over 50 lines?
3. Cyclomatic complexity — any nesting beyond 4 levels?
4. Code duplication — same/similar blocks appearing 3+ times?
5. Magic numbers/strings — unnamed literal constants?
6. Comment quality — are necessary comments present?

SCORING RULES:
  Start at 100, deduct per issue:
  • -15 per function exceeding 50 lines
  • -10 per nesting level beyond 4
  • -5 per magic number / unnamed literal
  • -15 per duplicated code block (3+ occurrences)

⚠️ BOUNDARY RULES:
  • Do NOT evaluate "the logic might be wrong" — correctness dimension
  • Do NOT treat "using a design pattern" as automatically high maintainability
  • Configuration file formatting changes → na
  • Auto-generated code → na

✅ CROSS-CUTTING:
  • Magic numbers as security thresholds → maintainability issue
  • Deep callback nesting → readability and robustness issue
  • Function name inconsistent with behavior → deceptive naming

// 压缩后 (~300 chars)
You are a Clean Code Advocate. ALL findings MUST be in Chinese.
FOCUS: naming clarity, function length (>50 lines), nesting depth (>4),
code duplication (3+ identical blocks), magic numbers/strings, comment adequacy.
SCORING: Start 100. -15 per function >50 lines, -10 per nesting >4,
-5 per magic number, -15 per duplicated block.
Config/docs/test-only diffs → score 95+. Do NOT evaluate logic correctness or security.
```

### 7.5 Phase 2a 总览 JSON Schema 扁平化

作为补充优化，Phase 2a 快速总览的输出 JSON 同样做了扁平化：

- 3 个关键维度：`topVulnerability` / `topConcern` / `topIssue`（嵌套对象）→ `issue`（单字符串或 null）
- 5 个工程维度：`highlights` + `suggestions`（数组）→ `note`（单字符串或 null）
- `impact` 维度：`affectedModules` + `publicApiChanges` + `dataModelChanges` + `riskCodeLocations` → `modules` + `riskCode`

输出 token 从 **~1000** 降至 **~400**（-60%）。

### 7.6 设计原则总结

| 原则 | 说明 |
|------|------|
| **避免重复** | system prompt 不与 user prompt 的 checklist 重复 |
| **紧凑优先** | 用 `→` 箭头、分号、逗号代替完整句子 |
| **去边界化** | 将"不要做什么"合入 FOCUS 行末，而非独立成段 |
| **一维一行** | 每个维度的 system instruction 控制在 1-3 行内 |