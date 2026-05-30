# 多维度代码质量评估体系 — 设计规格说明

> 版本: v1.0 | 日期: 2026-05-30 | 状态: Draft

---

## 一、设计总纲

### 1.1 动机

当前质量评估体系存在设计断层：`quality-assessment-standards.md` 定义了 6 个核心评估维度，但提示词和类型系统仅实现了 4 个维度（security / readability / performance / robustness）。功能正确性、架构与设计、测试质量三个维度的评估标准已书面定义但未落地。同时，单次 prompt 评估所有维度导致各维度评估深度不足。

### 1.2 升级策略

**全面升级**（补齐断层 + 深化分层 + 拓展新维度），从 4 维单次调用 → 9 维多轮并行调用。

### 1.3 设计决策汇总

| 决策项 | 选择 |
|--------|------|
| 升级范围 | 全面升级（补齐断层 + 深化分层 + 拓展新维度） |
| 评估架构 | 混合结构：敏感维度分层判定 + 工程维度数值评分 |
| 提示词策略 | 多轮串行调用（Phase 1 语义 → Phase 2 并行审计） |
| 评估维度 | 9 维度（3 敏感 + 5 工程 + 1 元数据） |
| 前端布局 | 雷达图 + 卡片混合 + SSE 流式渐进加载 |
| 后端编排 | 混合管道（Phase 1 串行 → Phase 2 5 调用并行，每完成一个 SSE 推送） |

---

## 二、评估维度清单

### 2.1 敏感维度（分层判定：critical / warning / pass / na）

| # | 维度 | 评估重点 | LLM 角色 | 输出 |
|---|------|---------|----------|------|
| 1 | 安全风险 | SQL/XSS注入、凭证硬编码、认证绕过、加密缺陷、路径遍历 | Senior Security Engineer | `SecurityAudit` |
| 2 | 功能正确性 | 逻辑错误、并发竞态、边界缺失、API误用、空值安全 | QA Architect | `CorrectnessAudit` |
| 3 | 依赖安全性 | 过时依赖CVE、许可证合规、供应链风险 | DevSecOps Engineer | `DependencyAudit` |

### 2.2 工程维度（0-100 数值评分）

| # | 维度 | 评估重点 | LLM 角色 | 输出 |
|---|------|---------|----------|------|
| 4 | 可维护性 | 命名质量、函数长度、圈复杂度、代码重复、注释 | Clean Code Advocate | `EngineeringScore` |
| 5 | 架构与设计 | 循环依赖、耦合度、设计模式合理性、分层清晰度 | Software Architect | `EngineeringScore` |
| 6 | 性能 | 算法复杂度、N+1查询、不必要循环、内存分配 | Performance Engineer | `EngineeringScore` |
| 7 | 容错与健壮性 | 错误处理、输入校验、边界条件、资源释放、超时 | Reliability Engineer | `EngineeringScore` |
| 8 | 测试质量 | 覆盖率感估、断言充分性、边界覆盖、Mock合理性 | Test Architect | `EngineeringScore` |

### 2.3 元数据维度（不参与总分）

| # | 维度 | 评估重点 | 输出 |
|---|------|---------|------|
| 9 | 变更影响范围 | 公共API影响、数据模型变更、跨模块依赖 | `ChangeImpact` |

---

## 三、整体架构与数据流

```
POST /api/review/stream (SSE)

┌────────────────────────────────────────────┐
│  Stage 0: Diff 获取 & 预处理 ( ~1s )        │
│  GitHub PR URL → fetch diff → clean        │
│  → detectCodeBlocks → validate             │
└──────────────────┬─────────────────────────┘
                   ▼
┌────────────────────────────────────────────┐
│  Stage 1: Phase 1 语义分析 ( 串行, ~2-3s )  │
│  LLM call → businessIntent / impactScope   │
│  / riskLevel                               │
│  ── SSE #1 → "语义分析" ──                  │
└──────────────────┬─────────────────────────┘
                   ▼
┌────────────────────────────────────────────┐
│  Stage 2: 并行审计 ( 8 calls 同时发出 )      │
│                                            │
│  安全风险 ←─┐                               │
│  功能正确性 ←┤                               │
│  依赖安全性 ←┼─ 8 个独立 LLM 调用             │
│  可维护性   ←┤  每完成一个 → SSE 推送         │
│  架构设计   ←┤                               │
│  性能       ←┤                               │
│  容错健壮   ←┤                               │
│  测试质量   ←┘                               │
│                                            │
│  变更影响 = 本地计算（基于 Phase 1 + diff）    │
└──────────────────┬─────────────────────────┘
                   ▼
┌────────────────────────────────────────────┐
│  Stage 3: 汇总 ( 本地计算, ~0.1s )          │
│  加权评分 → overallScore → overallLevel    │
│  SSE #final → "完成"                        │
└────────────────────────────────────────────┘
```

### 3.1 SSE 事件协议

```
event: dimension
data: {"stage":"semantics","data":{ businessIntent, impactScope, riskLevel }}

event: dimension
data: {"stage":"security","data":{ level, score, vulnerabilities:[] }}

... (其他 7 个维度类似)

event: dimension
data: {"stage":"impact","data":{ level, publicApiChanges, ... }}

event: done
data: {"overallScore":48,"overallLevel":"block","summary":"...","badge":"...","keyFindings":[],"comments":[]}
```

### 3.2 容错设计

- 任何并行调用失败 → 对应维度的 `inferXxxFromDiff()` 本地兜底
- 本地兜底结果附加 `_inferred: true` 标记
- 不影响其他维度正常推送
- Phase 1 语义分析也沿用现有的三层防御体系兜底

---

## 四、数据模型 & TypeScript 类型

### 4.1 分层判定等级

```typescript
type AuditLevel = 'critical' | 'warning' | 'pass' | 'na';
```

### 4.2 敏感维度类型

```typescript
interface SecurityVulnerability {
  category: string;           // "sql_injection" | "xss" | "hardcoded_secret" | ...
  description: string;
  filePath: string;
  lineNumber: number;
  severity: 'high' | 'medium' | 'low';
}

interface SecurityAudit {
  level: AuditLevel;
  score: number;
  vulnerabilities: SecurityVulnerability[];
  _inferred?: boolean;
}

interface CorrectnessConcern {
  type: 'logic_error' | 'race_condition' | 'boundary_gap' | 'api_misuse' | 'null_safety' | 'state_inconsistency';
  description: string;
  filePath: string;
  lineNumber: number;
}

interface CorrectnessAudit {
  level: AuditLevel;
  score: number;
  concerns: CorrectnessConcern[];
  _inferred?: boolean;
}

interface DependencyAudit {
  level: AuditLevel;
  score: number;
  outdatedDeps: { name: string; currentVersion: string; latestVersion?: string; risk: string }[];
  licenseIssues: { name: string; license: string; risk: string }[];
  _inferred?: boolean;
}
```

### 4.3 工程维度类型

```typescript
interface EngineeringScore {
  score: number;              // 0-100
  highlights: string[];       // 做得好的方面
  suggestions: string[];      // 改进建议
  _inferred?: boolean;
}

interface ReviewScores {
  maintainability: EngineeringScore;
  architecture: EngineeringScore;
  performance: EngineeringScore;
  robustness: EngineeringScore;
  testQuality: EngineeringScore;
}
```

### 4.4 元数据类型

```typescript
interface ChangeImpact {
  level: 'high' | 'medium' | 'low';
  publicApiChanges: boolean;
  dataModelChanges: boolean;
  crossModuleDeps: string[];
  affectedModules: string[];
}

// 保留现有类型
interface PrSemantics {
  intent: string;
  impactScope: string[];
  riskLevel: 'low' | 'medium' | 'high';
}
```

### 4.5 顶层汇总

```typescript
interface PrReviewResult {
  // Phase 1 语义
  semantics: PrSemantics;

  // 敏感维度
  security: SecurityAudit;
  correctness: CorrectnessAudit;
  dependency: DependencyAudit;

  // 工程维度
  scores: ReviewScores;

  // 变更影响
  impact: ChangeImpact;

  // 汇总
  overallScore: number;
  overallLevel: 'block' | 'review' | 'approve';
  summary: string;
  badge: string;
  keyFindings: string[];

  // 原有字段保留（向后兼容）
  comments: ReviewComment[];
  diff: string;
  fetchError?: FetchError;
  metadata?: PrMetadata;
  codeBlocks?: CodeBlock[];
}
```

### 4.6 加权汇总算法

```typescript
// overallScore 计算:
//   安全红线一票否决: security.level === 'critical' → overallScore = min(rawScore, 40)
//   加权公式:
//     correctness.score  × 0.20
//   + dependency.score    × 0.10
//   + maintainability     × 0.15
//   + architecture         × 0.15
//   + performance          × 0.15
//   + robustness           × 0.15
//   + testQuality          × 0.10
//   (security.score 作为独立约束系数，非简单加权)

// overallLevel:
//   security.level === 'critical'  → 'block'
//   correctness.level === 'critical' → 'block'
//   overallScore < 50  → 'block'
//   overallScore < 70  → 'review'
//   overallScore ≥ 70  → 'approve'
```

---

## 五、提示词工程设计

### 5.1 System Instruction 统一模板

```yaml
[角色锚定] — 1句角色声明
[维度聚焦] — 3-5条核心检查项
[判定标准] — 分层/评分的明确规则
[精确边界声明] — 该管什么、不该管什么、交叉场景如何处理
[输出约束] — JSON Schema
```

### 5.2 User Prompt 统一结构

```
## 业务上下文 (来自 Phase 1)
- 变更意图: "{businessIntent}"
- 影响范围: {impactScope}
- 预判风险: {riskLevel}

## 当前审计维度: {dimension_name}
请专注于以下检查项:
[维度聚焦的 3-5 条 Checklist]

输出格式: [JSON Schema]

--- GIT DIFF ---
${targetDiff}
```

### 5.3 各维度精确边界声明

#### 安全风险

```
⚠️ 边界声明:
  • 不要因为"代码写得丑"而判定不安全
  • 不要评估加密函数的性能开销（那是性能维度的职责）
  • 不要评估"异常处理是否完整"——除非缺失的错误处理会导致信息泄露
  • 如果一段代码"看起来危险但实际安全"（如已做输入校验的 eval），请说明原因并标记 pass
  • 不要把"缺少注释"当作安全问题

✅ 交叉场景仍需关注:
  • 使用弱哈希(MD5/SHA1)存储密码 → 既是安全也是最佳实践
  • 日志中打印用户Token/Session → 信息泄露，属于安全范畴
  • 不安全的反序列化 → 即使"功能上能跑"，也属于安全红线
```

#### 功能正确性

```
⚠️ 边界声明:
  • 不要评估"这样做是否安全"——安全风险有独立审计
  • 不要评估函数是否太长、命名是否糟糕——那是可维护性维度
  • 不要评估"这个循环是否影响性能"——那是性能维度
  • 如果代码逻辑正确但实现方式不优雅，标记 correctness 问题而非判定为 critical
  • 新增文件且无可执行逻辑（如纯类型定义/常量）→ 标记 na

✅ 交叉场景仍需关注:
  • 错误处理直接吞掉异常(空catch) → 既是功能缺陷也是健壮性问题
  • 类型转换丢失精度（如 parseInt 未处理 NaN）→ 可能导致运行时语义错误
  • if/else 分支缺失覆盖 → 逻辑不完整
```

#### 依赖安全性

```
⚠️ 边界声明:
  • 不要审计依赖包本身的代码质量（你只能看到 package.json / go.mod 的 diff）
  • 不要把"引入新依赖"本身视为风险（只评估该依赖的已知漏洞/许可证）
  • 不要评估"是否应该自己实现而非引入依赖"——那是架构维度的职责
  • 如果 diff 中不涉及任何依赖声明文件的变更 → 直接标记 na

✅ 交叉场景仍需关注:
  • 降级一个安全相关库（如从 bcrypt 5.x 降到 3.x）→ 属于依赖安全
  • 移除唯一的类型检查依赖（如删除 @types/*）→ 可能影响下游代码质量
  • 引入 GPL/AGPL 许可证依赖到商业项目 → 合规风险
```

#### 可维护性

```
⚠️ 边界声明:
  • 不要因为"逻辑可能不对"而扣分——那是功能正确性维度
  • 不要把"使用了设计模式"等同于高可维护性——滥用模式反而扣分
  • 不要评估注释的"技术准确性"，只评估"该注释的地方有没有注释"
  • 配置文件的格式调整（如 .json /.yaml 缩进）→ 标记 na
  • 自动生成代码（如 protobuf 生成的 .ts）→ 标记 na

✅ 交叉场景仍需关注:
  • 魔法数字用于安全阈值（如 `if (attempts > 3)`）→ 属于可维护性问题
  • 过深的回调嵌套（callback hell）→ 既是可读性也是健壮性问题
  • 函数名与行为不一致（如 `getUser` 实际做了写操作）→ 欺骗性命名
```

#### 架构与设计

```
⚠️ 边界声明:
  • 不要关注单个函数内部的实现细节——那是可维护性维度
  • 不要把"没有使用你偏好的框架/范式"视为架构问题
  • 不要在 diff 只涉及 1-2 个文件时强行找出架构问题
  • 如果变更属于"在现有架构内增加功能"且没有引入新模块依赖 → 标记 na

✅ 交叉场景仍需关注:
  • 新增的类违反了已有的分层约定（如 Controller 直接操作数据库）→ 架构违规
  • 双向依赖 / 循环引用 → 即使功能正常也是架构红线
  • 新模块的接口设计过于脆弱（如返回裸 Object 而非 typed DTO）→ 接口设计缺陷
```

#### 性能

```
⚠️ 边界声明:
  • 不要在变更行数 < 20 行且无循环/查询时强行挑性能问题
  • 不要把"使用了 forEach 而非 for 循环"视为性能问题（微优化不是你的职责）
  • 不评估异步操作本身的延迟（你无法判断网络/IO延迟），只评估"是否有不必要的串行等待"
  • 纯前端样式变更 / 文档变更 → 标记 na

✅ 交叉场景仍需关注:
  • 在循环内发起数据库查询（N+1）→ 性能问题
  • 大对象在循环内重复创建 → 既是性能也是内存问题
  • 同步阻塞操作（fs.readFileSync 在请求处理中）→ 性能红线
```

#### 容错与健壮性

```
⚠️ 边界声明:
  • 不要把"缺少重试机制"视为必选项——只有关键的外部调用才需要
  • 不要评估错误消息的用户友好度——那是产品层面
  • 不要把 try-catch 覆盖了过宽的范围视为问题（除非它吞掉了应该向上抛出的异常）
  • 纯工具函数（无副作用、纯计算）→ 可降低健壮性要求

✅ 交叉场景仍需关注:
  • 资源未在 finally 中释放 → 既是健壮性也是性能问题
  • 输入校验直接使用断言(assert)而非显式检查 → 生产环境可能被跳过
  • Promise 未捕获 rejection → 可能导致 Node 进程崩溃
```

#### 测试质量

```
⚠️ 边界声明:
  • 不要评估被测试的业务代码质量——那是其他维度的职责
  • 不要把"测试文件命名不规范"视为主要扣分项
  • 如果 diff 中不包含任何测试文件（*.test.* / *.spec.* / __tests__/）→ 标记 na 并注明"本次变更未包含测试代码"
  • 不要假设"没写测试 = 测试不足"——只在存在测试代码时评估测试代码的质量

✅ 交叉场景仍需关注:
  • 测试用例只验证 happy path 且无异常场景覆盖 → 测试不充分
  • 测试依赖外部网络/数据库且无 mock → 测试不可靠
  • 断言使用 `expect(true).toBe(true)` 等无效断言 → 伪测试
```

---

## 六、本地启发式兜底引擎

### 6.1 兜底触发矩阵

| 场景 | 触发条件 | 处理策略 |
|------|---------|---------|
| LLM 返回空/解析失败 | `hasEmpty*` 检测 | 对应维度 `inferXxxFromDiff()` |
| LLM 超时 | AbortError | 降级为本地推理 |
| API Key 未配置 | 预检拦截 | 全部维度走本地推理 |
| 部分维度失败 | 并行调用中个别 reject | 失败维度本地兜底，成功维度正常使用 |

### 6.2 各维度本地推理算法摘要

#### 安全风险 `inferSecurityFromDiff()`
沿用户已有的高/中危正则匹配（10高危 + 7中危），新增扫描 package.json diff 中安全相关依赖变更。

#### 功能正确性 `inferCorrectnessFromDiff()`
检测空catch块、类型转换未处理NaN/null、修改条件分支但未新增测试。

#### 依赖安全性 `inferDependencyFromDiff()`
仅当 diff 包含依赖声明文件变更时生效。提取新增/升级/降级的依赖名和版本号。

#### 可维护性 `inferMaintainabilityFromDiff()`
检测新增函数>50行、>4层嵌套、魔法数字、3+次重复代码块。

#### 架构与设计 `inferArchitectureFromDiff()`
基于 import/require 语句检测文件间依赖关系和潜在循环引用。

#### 性能 `inferPerformanceFromDiff()`
检测循环内await、同步文件操作、大数组操作无分页。

#### 容错性 `inferRobustnessFromDiff()`
检测try-catch覆盖率、finally块存在性、输入参数校验。

#### 测试质量 `inferTestQualityFromDiff()`
检测测试文件变更和测试代码与业务代码比例。

所有本地兜底结果附加 `_inferred: true` 标记。前端渲染时在该维度显示 🔍 标记 + hover提示"本地启发式分析"。雷达图中对应数据点使用虚线代替实线。

---

## 七、前端设计

### 7.1 整体布局

```
┌─────────────────────────────────────────────────┐
│  Header（保持现有）                               │
├─────────────────────────────────────────────────┤
│  模型选择 + 审计触发按钮（保持现有）                │
├─────────────────────────────────────────────────┤
│  审计结论栏（顶部横幅）                            │
│  ┌─────────────────────────────────────────┐    │
│  │ ■ 阻断 · 发现3项高危 │ 48/100 │ BLOCKED │    │
│  └─────────────────────────────────────────┘    │
├──────────┬──────────────────┬───────────────────┤
│ 敏感维度  │                  │   工程维度           │
│ ┌───────┐│   SVG 雷达图      │ ┌───┐ ┌───┐       │
│ │安全风险 ││   (8轴 + 数据点)   │ │可维│ │架构│       │
│ │CRITICAL││                  │ │护性│ │设计│       │
│ └───────┘│   中央: 综合评分   │ └───┘ └───┘       │
│ ┌───────┐│                  │ ┌───┐ ┌───┐       │
│ │功能正确 ││                  │ │性能│ │容错│       │
│ │WARNING ││                  │ └───┘ └───┘       │
│ └───────┘│                  │ ┌──────┐          │
│ ┌───────┐│                  │ │测试质量│          │
│ │依赖安全 ││                  │ └──────┘          │
│ │PASS   ││                  │                   │
│ └───────┘│                  │                    │
├──────────┴──────────────────┴───────────────────┤
│  变更影响条                                       │
│  📌 中影响 · 认证模块 · API层 · 数据库           │
├─────────────────────────────────────────────────┤
│  下方：依旧保留 Diff 文件区域 + 评论卡片            │
└─────────────────────────────────────────────────┘
```

### 7.2 SSE 渐进加载

- 后端每完成一个维度 → SSE推送 `event: dimension` → 前端对应卡片从骨架变为点亮
- 未到达的维度显示灰色骨架框 + shimmer 脉冲动画
- 雷达图区域显示脉动圆圈；数据点逐个渐出
- 加载顺序: Phase 1 语义 → 8维度任意顺序到达 → 汇总

### 7.3 交互行为

- **Hover 卡片** → 雷达图对应轴线/数据点高亮变粗，其他维度半透明
- **Click 敏感维度卡片** → 雷达图下方展开漏洞/缺陷列表
- **Click 工程维度卡片** → 展开该维度的亮点和改进建议
- **🔍 标记** → 本地推断的维度，卡片右上角显示标记，hover提示"本地启发式分析"

---

## 八、实现顺序

```
Phase A: 基础设施
  ├── types.ts 扩展 (ReviewScore → 9维度类型 + SSEEvent)
  ├── server.ts SSE 基础框架 (/api/review/stream endpoint)
  └── 无破坏性变更，现有 /api/review 保持不变

Phase B: 后端管道
  ├── 8 个独立 System Instruction 函数 + 边界声明
  ├── 混合管道编排 (Phase1串行 → Phase2并行 via Promise.allSettled)
  ├── SSE write 事件流
  ├── 8 个 inferXxxFromDiff() 本地兜底函数
  └── 加权汇总算法

Phase C: 前端渲染
  ├── EventSource SSE 客户端 hook
  ├── SVG 雷达图组件 (用 useMemo 动态构建)
  ├── 骨架加载 + shimmer/pulse 动画
  ├── hover/click 交互 (维度详情展开)
  └── 本地推断标记渲染

Phase D: 联调打磨
  ├── 各维度卡片不同状态样式
  ├── 移动端响应式
  ├── SSE 超时/断连重试
  └── 演示数据更新为 9 维度结构
```

### 迁移策略

- 现有 `POST /api/review` 保持不变，新增 `POST /api/review/stream`（SSE endpoint）
- 前端通过 `useSSE` 开关控制，未启用时回退现有模式
- Demo 数据（`MOCK_REVIEW_RESULT`、`MOCK_FALLBACK_RESULT`）更新为 9 维结构

---

## 九、开放问题

1. **依赖安全维度的 CVE 查询**：LLM 知识截止日期限制，是否需要接入 npm audit / GitHub Advisory API 做实时查询？
2. **移动端雷达图**：小屏幕上雷达图+三栏布局是否需要折叠为单列？
3. **DeepSeek vs Gemini 维度的提示词差异**：DeepSeek 使用 `response_format: json_object`，Gemini 使用 `responseSchema`，需分别为两个模型准备输出约束
