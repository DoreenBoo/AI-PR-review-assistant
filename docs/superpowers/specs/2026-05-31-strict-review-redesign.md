# 严格审查方案 v3 设计文档

> 日期: 2026-05-31
> 状态: 设计中
> 目标: 解决审查系统"不够严格、漏报风险代码"问题，重建审查哲学，从"默认安全"转为"有罪推定"视角

---

## 1. 问题陈述

当前 v2 审查系统存在严重的宽松倾向：

| 问题 | 表现 |
|------|------|
| **危险代码被放过** | SQL 注入、XSS 等真实漏洞被标注为 `pass: 85` |
| **提示词引导宽松** | Phase 2 明确要求"只标记最明显的"、无问题给 80-100 |
| **评分虚高** | 起始 100 分，导致多数 PR 高分通过 |
| **审查深度不足** | 笼统的整体评估，缺乏逐风险点检查 |
| **本地兜底简陋** | 纯正则匹配，大量风险模式未覆盖 |

---

## 2. 核心理念转变

```
v2:  代码默认安全 → 发现风险才扣分 → start=100
v3:  安全/正确性默认未知 → 需证据证明安全 → start=70
```

| 维度类别 | 立场 | 逻辑 |
|---------|------|------|
| 安全风险 | **有罪推定** | 找不到安全措施 → 判为 risk |
| 功能正确性 | **有罪推定**（分级） | 确认逻辑错误 → critical，潜在 → warning |
| 工程维度 | **无罪推定** | 无明显问题 → 中性评分，证据驱动 |

---

## 3. 审查维度与风险条目

### 3.1 安全风险（10 条目，有罪推定）

每个条目独立判定：`pass` / `risk(critical)` / `risk(warning)` / `na`

| # | ID | 条目名 | 触发条件 |
|---|-----|--------|---------|
| 1 | `sql_injection` | SQL注入 | 用户输入拼接SQL、动态表名/列名无白名单 |
| 2 | `nosql_injection` | NoSQL注入 | `$where`/`$regex`等操作符接受用户输入 |
| 3 | `xss` | XSS/HTML注入 | `innerHTML`/`dangerouslySetInnerHTML`含用户输入 |
| 4 | `command_injection` | 命令注入 | `exec()`/`spawn()`参数含用户输入 |
| 5 | `hardcoded_secret` | 硬编码密钥 | 密码/API Key/Token/JWT Secret明文 |
| 6 | `auth_bypass` | 认证绕过 | 新路由无认证中间件、权限检查可跳过 |
| 7 | `path_traversal` | 路径遍历 | 用户可控路径未做`path.resolve`规范化 |
| 8 | `insecure_deserialization` | 不安全反序列化 | `eval()`/`new Function()`/反序列化不可信数据 |
| 9 | `crypto_flaw` | 加密缺陷 | MD5/SHA1安全用途、非加密随机数、缺签名验证 |
| 10 | `info_leak` | 信息泄露 | 敏感数据输出到日志/错误消息/HTTP响应头 |

**聚合规则**：任一 `risk(critical)` → 安全=`critical`；无 critical 但有 `risk(warning)` → `warning`；全 pass/na → `pass`

### 3.2 功能正确性（7 条目，分级有罪推定）

| # | ID | 条目名 | critical 触发 | warning 触发 |
|---|-----|--------|-------------|-------------|
| 1 | `logic_error` | 逻辑错误 | 确认的条件反了/运算错误 | 疑似但不确认 |
| 2 | `race_condition` | 竞态条件 | 确认的缺锁/事务保护 | 并发场景未证实 |
| 3 | `null_safety` | 空安全 | 确认必崩null解引用 | 缺null检查但不一定触发 |
| 4 | `boundary_handling` | 边界处理 | 确认数组越界/除零/整数溢出 | 边界未覆盖 |
| 5 | `api_misuse` | API误用 | 确认参数错误致功能异常 | 非最佳实践 |
| 6 | `state_inconsistency` | 状态不一致 | 确认状态丢失/脏读 | 潜在风险 |
| 7 | `error_handling` | 错误处理缺陷 | 空catch吞关键异常 | 缺finally清理 |

**聚合规则**：任一 `critical` → `critical`；无 critical 但有 `warning` → `warning`；全 pass → `pass`

### 3.3 依赖安全与工程维度

维持现有评估结构，不做条目化拆分。但评分公式改为证据驱动（起始 70）。

---

## 4. 评分体系

### 4.1 安全维度评分

| 规则 | 分值 |
|------|------|
| 起始分 | **70** |
| 每条 `risk(critical)` | **-25**（扣至最低 0） |
| 每条 `risk(warning)` | **-10**（扣至最低 0） |
| 每条 `pass`（含正面证据） | **+5**（加至最高 100） |
| `na` 条目 | 不计分 |

**等级映射**：<40 → `critical` / 40-64 → `warning` / ≥65 → `pass`

### 4.2 正确性维度评分

同安全维度公式。

### 4.3 工程维度评分

- 起始 **70** 分
- LLM 列出 `highlights`（+分证据，约 +8~12/条）和 `suggestions`（-分证据，约 -8~15/条）
- 极少变更（纯配置/文档/格式）→ 默认 70
- 取消"从100扣减"和"无问题给80-100"的宽松逻辑

### 4.4 综合评分与门禁

| 条件 | 结论 |
|------|------|
| 安全=`critical` **或** 正确性=`critical` | **BLOCK**，总分 ≤ 39 |
| Phase 3 有 `blocker` 等级行级评论 | **BLOCK** |
| 总分 < 50 | **BLOCK** |
| 总分 50-69 | **REVIEW** |
| 总分 ≥ 70 且无 critical | **APPROVE** |

**加权权重**：正确性 20% / 依赖 10% / 可维护性 15% / 架构 15% / 性能 15% / 容错 15% / 测试 10%

---

## 5. 审查管线

### 5.1 Phase 0 — 预处理（不变）

获取 diff → 清洗 → 检测代码块 → 推送前端

### 5.2 Phase 1 — 业务语义分析（微调）

增强风险预判严格度：任何涉及用户输入、认证逻辑、数据变动的 PR 至少预判 `medium`。

### 5.3 Phase 2 — 逐项审计（核心改造）

将原有的"快速笼统扫描"替换为 **17 条逐项审计**：

- 安全 10 条目 + 正确性 7 条目：每条独立 `pass/risk/na` + `evidence` + `codeLocation`
- 依赖安全 + 5 项工程维度：证据驱动评分（70起）
- 变更影响：维持原结构

**提示词关键变更**：
- 删除"只标记最明显的 / shallow scan"
- 删除"无明显问题时给80-100分和pass级别"
- 改为"对每条规则找正面证据才能pass，找不到安全措施判risk"
- 工程维度允许"无明显问题时给70"

**输出 JSON**：

```json
{
  "security": {
    "items": [
      {
        "id": "sql_injection",
        "verdict": "risk",
        "severity": "critical",
        "evidence": "第45行用户输入直接拼接到SQL查询字符串",
        "codeLocation": { "filePath": "src/login.ts", "lineNumber": 45 }
      }
    ]
  },
  "correctness": { "items": [...] },
  "dependency": { "level": "pass", "score": 70, ... },
  "maintainability": { "score": 62, "highlights": [...], "suggestions": [...] },
  "architecture": { ... },
  "performance": { ... },
  "robustness": { ... },
  "testQuality": { ... },
  "impact": { ... }
}
```

### 5.4 Phase 3 — 风险代码定位（严格化）

**关键变更**：

1. **关联 Phase 2**：Phase 2 的每个 risk 条目必须在 Phase 3 定位到代码
2. **三维扫描**：+ 行（新增）/ - 行（删除的安全控制）/ ~ 上下文
3. **新增 `blocker` 等级**：确认的危险代码，单条即可触发 BLOCK
4. **无限输出**：0-N 条，不设上限，要求宁可多报不漏报
5. **失败告警**：LLM 失败不静默，输出警告展示在风险代码区

**severity 等级**：

| 等级 | 含义 | 阻断规则 |
|------|------|---------|
| `blocker` | 确认危险代码 | 单条即 BLOCK |
| `critical` | 高风险 | 累计 2 条 → BLOCK |
| `high` | 高风险但不确定可利用 | 累计 3 条 → BLOCK |
| `medium` | 中等风险 | 计入评分 |
| `low` | 建议优化 | 仅记录 |

### 5.5 Phase 4 — 数据流追踪 + 深度验证

#### 安全维度：数据流追踪

对 Phase 2 标记为 `risk` 的安全条目，执行完整数据流追踪：

```
SOURCE（输入源） → TRANSFORM（中间处理） → SINK（敏感汇点）
```

**输入**：风险条目 + Phase 3 定位的代码位置 ±30 行上下文

**LLM 任务**：
1. 找到所有外部输入点
2. 追踪输入经过的处理
3. 判断是否到达敏感操作
4. 找到（或确认缺失）安全控制

**输出**：

```json
{
  "itemId": "sql_injection",
  "traced": true,
  "finalVerdict": "confirmed_risk",
  "dataflowPath": [
    { "step": 1, "node": "SOURCE", "code": "const u = req.body.username", "location": "src/login.ts:12" },
    { "step": 2, "node": "TRANSFORM", "code": "const sql = `...${u}`", "location": "src/login.ts:45" },
    { "step": 3, "node": "SINK", "code": "await db.query(sql)", "location": "src/login.ts:47" }
  ],
  "attackScenario": "攻击者在username字段注入 ' OR '1'='1' --",
  "mitigationsFound": []
}
```

**三种结果**：
- `confirmed_risk` → 确认漏洞，severity 不变或升级
- `false_positive` → Phase 2 误报，verdict 降为 pass
- `inconclusive` → 上下文不足，保留 risk + 标注"需人工确认"

**批量调用**：同维度多个 risk 条目合并为一次 LLM 调用，仅在 token 超限时拆分。

**源→汇映射表**：

| 风险条目 | 关注输入源 | 关注敏感汇点 |
|---------|-----------|-------------|
| SQL注入 | req.body/query/params, URL | db.query/execute/raw, knex.raw |
| NoSQL注入 | 同上 | Model.find({$where}), aggregate |
| XSS | 同上 | res.send, innerHTML, dangerouslySetInnerHTML |
| 命令注入 | 同上 | exec, spawn, child_process |
| 硬编码密钥 | （静态扫描） | 字符串字面量含password/apiKey/secret/token |
| 认证绕过 | req.headers/cookies | auth middleware, jwt.verify |
| 路径遍历 | req.query/params | fs.readFile, path.join(userInput) |
| 不安全反序列化 | req.body | JSON.parse, eval, new Function |
| 加密缺陷 | （静态扫描） | md5/sha1安全用途, Math.random |
| 信息泄露 | err.message, res.json, console.log | 输出含password/secret/token/key |

#### 正确性维度：执行路径验证

对 Phase 2 标记 risk 的条目，模拟代码执行路径验证问题是否存在。返回 `confirmed_bug` / `false_positive` / `inconclusive`。

---

## 6. 类型系统

### 6.1 新增类型

```typescript
interface RiskItem {
  id: string;
  verdict: 'pass' | 'risk' | 'na';
  severity: 'critical' | 'warning' | null;
  evidence: string;
  codeLocation?: { filePath: string; lineNumber: number };
}

interface DataflowTrace {
  itemId: string;
  traced: boolean;
  finalVerdict: 'confirmed_risk' | 'false_positive' | 'inconclusive';
  dataflowPath: DataflowNode[];
  attackScenario?: string;
  mitigationsFound: string[];
}

interface DataflowNode {
  step: number;
  node: 'SOURCE' | 'TRANSFORM' | 'SINK';
  code: string;
  location: string;
}
```

### 6.2 修改类型

```typescript
// SecurityAudit: 新增 items[] 和 traces[]
interface SecurityAudit {
  level: AuditLevel;
  score: number;
  items: RiskItem[];
  vulnerabilities: SecurityVulnerability[];  // 兼容保留
  traces: DataflowTrace[];
  _inferred?: boolean;
  _source?: 'local' | 'overview' | 'deep';
}

// CorrectnessAudit: 新增 items[]
interface CorrectnessAudit {
  level: AuditLevel;
  score: number;
  items: RiskItem[];
  concerns: CorrectnessConcern[];  // 兼容保留
  _inferred?: boolean;
  _source?: 'local' | 'overview' | 'deep';
}

// ReviewComment: severity 新增 blocker
interface ReviewComment {
  // ... 现有字段
  severity: 'blocker' | 'critical' | 'high' | 'medium' | 'low';
  linkedRiskItem?: string;
  dataflowTrace?: DataflowTrace;
}
```

### 6.3 新增 SSE 事件

| 事件 | 阶段 | 数据 |
|------|------|------|
| `risk_items` | Phase 2 完成 | `{ dimension, items: RiskItem[] }` |
| `dataflow_trace` | Phase 4 逐条 | `{ itemId, trace: DataflowTrace }` |
| `phase3_failed` | Phase 3 失败 | `{ message }` |

---

## 7. 本地兜底

### 7.1 输出格式对齐

本地推断函数输出新结构（`items: RiskItem[]`），评分从 70 起，所有结果标记 `_inferred: true, _source: 'local'`。

### 7.2 安全兜底新增正则模式

| 新增检测 | 正则模式 | 映射条目 |
|---------|---------|---------|
| NoSQL注入 | `\$where\s*:` / `\$regex\s*:` | `nosql_injection` |
| 命令注入 | `exec/spawn`含变量拼接 | `command_injection` |
| 认证绕过 | 新路由无`auth`/`authenticate`关键字 | `auth_bypass` |
| 路径遍历 | `path.join(*req.`无`resolve` | `path_traversal` |
| 不安全反序列化 | `JSON.parse(*req.`后无schema校验 | `insecure_deserialization` |

### 7.3 正确性兜底新增

- `let/var`共享变量被异步函数修改 → `race_condition` warning
- `.then()`链缺`.catch()` → `error_handling` warning

### 7.4 视觉警告

- 审查进行中 + 当前兜底数据：`⚡ 本地分析中，LLM 复审进行中...`
- 重试全部失败：`⚠️ LLM 审查失败，当前为本地分析结果，不可作为最终依据`

---

## 8. 前端展示

| 组件 | 变更 |
|------|------|
| **DimensionCards** | 安全/正确性卡片可展开，显示逐项条目面板（risk=红/pass=绿/na=灰） |
| **雷达图** | 类型同步，无视觉变更 |
| **风险代码区（新增）** | Phase 3 结果面板，blocker/critical 红框+⛔，带行号跳转 |
| **数据流面板（新增）** | 点击 risk 条目展开，SOURCE→TRANSFORM→SINK 可视化 |
| **审查详情折叠区（新增）** | 综合评分下方，17 条目的完整判定表 |
| **来源标签** | Phase 3 失败时显示 ⚠️"定位未完成" |

### 8.1 SSE 优先级合并

`checkPriority()` 逻辑不变：`local(0) < overview(1) < deep(2)`。Phase 4 数据自动覆盖 Phase 2 数据。

---

## 9. 与现有系统的兼容性

- `vulnerabilities`/`concerns` 字段保留，从 `items[]` 聚合生成
- 现有 SSE 事件（`security`/`correctness` 等）保持语义，数据结构扩展
- V1 端点 (`POST /api/review`) 不受影响
- 前端现有布局不破坏，新增面板在预留区域展开

---

## 10. 风险与注意事项

- **LLM 调用量增加**：Phase 2 输出增大（17 条目 vs 9 维度笼统评估），Phase 4 新增数据流追踪调用。需监控 token 消耗
- **误报可能增加**：有罪推定下，缺乏上下文的代码可能被过度标记。`inconclusive` 结果分流可缓解
- **审查耗时增加**：逐项审计 + 数据流追踪增加处理时间。两阶段 SSE 推送确保用户尽早看到 Phase 2 结果
