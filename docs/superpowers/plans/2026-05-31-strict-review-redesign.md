# 严格审查方案 v3 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将审查系统从"默认安全"（100分起扣）转为"有罪推定"（70分起建）的逐项审计 + 数据流追踪方案

**Architecture:** 核心改动在 server/prompts.ts（Phase 2/3/4 提示词重写）、server.ts（管线重构 + 新评分函数）、src/types.ts（RiskItem/DataflowTrace 新类型）。前端新增逐项审计面板和数据流追踪面板。

**Tech Stack:** TypeScript, React, Express, SSE, DeepSeek API

---

## 前置：验证命令

- TypeScript 检查：`npx tsc --noEmit`
- 构建：`npx vite build`

---

### Task 1: 类型系统升级

**Files:**
- Modify: `src/types.ts:75-105` (SecurityAudit, CorrectnessAudit)
- Modify: `src/types.ts:10-18` (ReviewComment)
- Modify: `src/types.ts:158-172` (SSEEvent)

- [ ] **Step 1: 新增 RiskItem, DataflowTrace, DataflowNode 类型**

在 `src/types.ts` 的 AuditLevel 定义之后（第 68 行之后）插入新类型：

```typescript
// ===== 逐项审计条目 =====
export interface RiskItem {
  id: string;                              // "sql_injection" | "xss" | "logic_error" | ...
  verdict: 'pass' | 'risk' | 'na';
  severity: 'critical' | 'warning' | null;
  evidence: string;
  codeLocation?: { filePath: string; lineNumber: number };
}

// ===== 数据流追踪 =====
export interface DataflowTrace {
  itemId: string;
  traced: boolean;
  finalVerdict: 'confirmed_risk' | 'false_positive' | 'inconclusive';
  dataflowPath: DataflowNode[];
  attackScenario?: string;
  mitigationsFound: string[];
}

export interface DataflowNode {
  step: number;
  node: 'SOURCE' | 'TRANSFORM' | 'SINK';
  code: string;
  location: string;
}
```

- [ ] **Step 2: 修改 SecurityAudit 接口（第 80-86 行）**

替换为：

```typescript
export interface SecurityAudit {
  level: AuditLevel;
  score: number;
  items: RiskItem[];
  vulnerabilities: SecurityVulnerability[];
  traces: DataflowTrace[];
  _inferred?: boolean;
  _source?: 'local' | 'overview' | 'deep';
}
```

- [ ] **Step 3: 修改 CorrectnessAudit 接口（第 95-101 行）**

替换为：

```typescript
export interface CorrectnessAudit {
  level: AuditLevel;
  score: number;
  items: RiskItem[];
  concerns: CorrectnessConcern[];
  _inferred?: boolean;
  _source?: 'local' | 'overview' | 'deep';
}
```

- [ ] **Step 4: 修改 ReviewComment 接口（第 10-18 行）**

替换为：

```typescript
export interface ReviewComment {
  id: string;
  filePath: string;
  lineNumber: number;
  originalContent: string;
  description: string;
  suggestion: string;
  severity: 'blocker' | 'critical' | 'high' | 'medium' | 'low';
  linkedRiskItem?: string;
  dataflowTrace?: DataflowTrace;
}
```

- [ ] **Step 5: 修改 SSEEvent 联合类型（第 158-172 行）**

替换为：

```typescript
export type SSEEvent =
  | { stage: 'progress'; data: { message: string; phase: 'fetch' | 'overview' | 'deep' | 'done' } }
  | { stage: 'diff_ready'; data: { diff: string } }
  | { stage: 'semantics'; data: PrSemantics }
  | { stage: 'security'; data: SecurityAudit }
  | { stage: 'correctness'; data: CorrectnessAudit }
  | { stage: 'dependency'; data: DependencyAudit }
  | { stage: 'maintainability'; data: EngineeringScore }
  | { stage: 'architecture'; data: EngineeringScore }
  | { stage: 'performance'; data: EngineeringScore }
  | { stage: 'robustness'; data: EngineeringScore }
  | { stage: 'testQuality'; data: EngineeringScore }
  | { stage: 'impact'; data: ChangeImpact }
  | { stage: 'risk_items'; data: { dimension: 'security' | 'correctness'; items: RiskItem[] } }
  | { stage: 'dataflow_trace'; data: { itemId: string; trace: DataflowTrace } }
  | { stage: 'phase3_failed'; data: { message: string } }
  | { stage: 'risk_comments'; data: { comments: ReviewComment[] } }
  | { stage: 'done'; data: { overallScore: number; overallLevel: OverallLevel; summary: string; badge: string; keyFindings: string[]; comments: ReviewComment[]; diff: string } };
```

- [ ] **Step 6: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

预期：只有类型未使用警告，无编译错误（server.ts 和 fallback.ts 使用了旧结构，后续 task 修复）

---

### Task 2: 评分工具函数

**Files:**
- Modify: `server.ts:700-739` (calculateOverall)
- Modify: `server.ts` (新增两个辅助函数)

- [ ] **Step 1: 新增 `calculateItemScore` 函数**

在 `calculateOverall` 之前（第 699 行之后）插入：

```typescript
function calculateItemScore(items: { verdict: string; severity?: string | null; evidence?: string }[]): number {
  let score = 70;
  for (const item of items) {
    if (item.verdict === 'risk') {
      if (item.severity === 'critical') score -= 25;
      else score -= 10;
    } else if (item.verdict === 'pass' && item.evidence && item.evidence.trim().length > 0) {
      score += 5;
    }
    // 'na' items do not affect score
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}
```

- [ ] **Step 2: 新增 `itemScoreToLevel` 函数**

```typescript
function itemScoreToLevel(score: number): 'critical' | 'warning' | 'pass' {
  if (score < 40) return 'critical';
  if (score < 65) return 'warning';
  return 'pass';
}
```

- [ ] **Step 3: 修改 `calculateOverall` 函数（第 700-739 行）**

由于安全/正确性的 level 现在由新的 itemScoreToLevel 确定（从 items 计算），且 blocker 逻辑由 Phase 3 驱动，这里只需更新 gating 上限（从 40/35 改为 39）：

```typescript
function calculateOverall(
  security: SecurityAudit,
  correctness: CorrectnessAudit,
  dependency: DependencyAudit,
  maintainability: EngineeringScore,
  architecture: EngineeringScore,
  performance: EngineeringScore,
  robustness: EngineeringScore,
  testQuality: EngineeringScore,
  hasPhase3Blocker: boolean = false
): { overallScore: number; overallLevel: 'block' | 'review' | 'approve' } {
  let rawScore = Math.round(
    correctness.score * 0.20 +
    dependency.score * 0.10 +
    maintainability.score * 0.15 +
    architecture.score * 0.15 +
    performance.score * 0.15 +
    robustness.score * 0.15 +
    testQuality.score * 0.10
  );

  if (security.level === 'critical') {
    rawScore = Math.min(rawScore, 39);
  }
  if (correctness.level === 'critical') {
    rawScore = Math.min(rawScore, 39);
  }

  const overallScore = Math.min(100, Math.max(0, rawScore));

  let overallLevel: 'block' | 'review' | 'approve';
  if (security.level === 'critical' || correctness.level === 'critical' || overallScore < 50 || hasPhase3Blocker) {
    overallLevel = 'block';
  } else if (overallScore < 70) {
    overallLevel = 'review';
  } else {
    overallLevel = 'approve';
  }

  return { overallScore, overallLevel };
}
```

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

预期：无错误。`items` 和 `traces` 字段在其他地方尚不可用，可能需要暂时忽略——后续 task 逐步修复。

---

### Task 3: Phase 2 逐项审计提示词重写

**Files:**
- Modify: `server/prompts.ts:238-269` (getOverviewSystemPrompt, getOverviewJsonSchema, getOverviewUserPrompt)

- [ ] **Step 1: 重写 `getOverviewSystemPrompt`**

将第 238-257 行替换为：

```typescript
export function getOverviewSystemPrompt(): string {
  return `You are a STRICT Senior Code Reviewer. Your task is to audit a Git diff across ALL dimensions using ITEMIZED checklists. ALL descriptions, evidence, and suggestions MUST be in Chinese (Simplified). Only code identifiers, file paths, and technical terms may remain in English.

## 安全风险 — 逐项审计（10 条目）

For EACH item below, provide: verdict ("pass"|"risk"|"na"), severity ("critical"|"warning"|null), evidence (specific code lines and reasoning in Chinese), codeLocation (filePath + lineNumber from diff, or null).

| # | ID | Checklist | Risk Criteria |
|---|-----|----------|--------------|
| 1 | sql_injection | SQL Injection | User input directly concatenated into SQL query strings, dynamic table/column names without whitelist |
| 2 | nosql_injection | NoSQL Injection | User input reaches $where/$regex/$expr operators without sanitization |
| 3 | xss | XSS / HTML Injection | innerHTML, dangerouslySetInnerHTML, or document.write with unsanitized user input |
| 4 | command_injection | Command Injection | exec(), spawn(), or child_process calls with unsanitized user input |
| 5 | hardcoded_secret | Hardcoded Secrets | Passwords, API keys, tokens, JWT secrets, or private keys as string literals |
| 6 | auth_bypass | Auth Bypass | New routes without auth middleware, skippable permission checks, missing CSRF protection |
| 7 | path_traversal | Path Traversal | User-controllable file paths without path.resolve() normalization |
| 8 | insecure_deserialization | Insecure Deserialization | eval(), new Function(), or deserializing untrusted data without validation |
| 9 | crypto_flaw | Cryptographic Flaw | MD5/SHA1 for security purposes, non-cryptographic random, missing signature verification |
| 10 | info_leak | Information Leak | Sensitive data logged to console/error messages/HTTP response headers |

**CRITICAL RULE — GUILTY UNTIL PROVEN INNOCENT:**
- You MUST find POSITIVE evidence of security controls to mark "pass" (e.g., parameterized queries, output escaping, auth middleware present, path.resolve, schema validation).
- If no security control is visible in the diff, verdict MUST be "risk" — do NOT assume the control exists elsewhere.
- "na" ONLY if the diff has zero code related to that risk category.

## 功能正确性 — 逐项审计（7 条目）

For EACH item below, provide: verdict ("pass"|"risk"|"na"), severity ("critical" for confirmed bugs, "warning" for potential risks, null for pass/na), evidence (specific code lines and reasoning in Chinese), codeLocation.

| # | ID | Checklist | Critical (confirmed) | Warning (potential) |
|---|-----|----------|---------------------|-------------------|
| 1 | logic_error | Logic Errors | Confirmed inverted condition/wrong operator/wrong calculation | Suspicious but unconfirmed |
| 2 | race_condition | Race Conditions | Confirmed missing lock/transaction on shared state | Concurrent access without proven issue |
| 3 | null_safety | Null Safety | Confirmed crash-causing null/undefined dereference | Missing null check, may or may not trigger |
| 4 | boundary_handling | Boundary Handling | Confirmed array OOB, division by zero, int overflow | Edge case not covered |
| 5 | api_misuse | API Misuse | Confirmed wrong params causing functional breakage | Non-best-practice usage |
| 6 | state_inconsistency | State Inconsistency | Confirmed state loss / dirty read | Potential stale state risk |
| 7 | error_handling | Error Handling | Empty catch swallowing critical exceptions | Missing finally cleanup |

**RULE:** Apply guilty-until-proven-innocent: confirmed logic errors → "critical", potential risks → "warning", evidence of correctness → "pass".

## 依赖安全

Same as before: level (critical|warning|pass|na), score (0-100), issue description. Start score at 70.

## 工程维度 (5 dimensions)

maintainability, architecture, performance, robustness, testQuality — each returns: score (0-100), highlights (Chinese string array), suggestions (Chinese string array).
- Start score at 70 (neutral).
- Provide evidence for every score deviation from 70.
- Trivial changes (config/docs/formatting only) → score 70.

## 变更影响

level (high|medium|low), affectedModules (string array), publicApiChanges (bool), dataModelChanges (bool), riskCode (short Chinese or null).`;
}
```

- [ ] **Step 2: 重写 `getOverviewJsonSchema`**

将第 259-261 行替换为：

```typescript
export function getOverviewJsonSchema(): string {
  return `Return ONLY a valid JSON object. Do NOT use markdown code fences:
{
  "security": {
    "items": [
      { "id": "sql_injection", "verdict": "pass", "severity": null, "evidence": "参数化查询已使用, 见 line 45", "codeLocation": null },
      { "id": "xss", "verdict": "risk", "severity": "critical", "evidence": "innerHTML直接使用用户输入, 无转义", "codeLocation": { "filePath": "src/ui.ts", "lineNumber": 78 } },
      { "id": "nosql_injection", "verdict": "na", "severity": null, "evidence": "无NoSQL代码变更", "codeLocation": null },
      { "id": "command_injection", "verdict": "na", "severity": null, "evidence": "无exec/spawn调用", "codeLocation": null },
      { "id": "hardcoded_secret", "verdict": "risk", "severity": "critical", "evidence": "明文API密钥: apiKey = \\"sk-abc123\\", 见 line 12", "codeLocation": { "filePath": "src/config.ts", "lineNumber": 12 } },
      { "id": "auth_bypass", "verdict": "na", "severity": null, "evidence": "无认证相关变更", "codeLocation": null },
      { "id": "path_traversal", "verdict": "na", "severity": null, "evidence": "无文件路径操作", "codeLocation": null },
      { "id": "insecure_deserialization", "verdict": "na", "severity": null, "evidence": "无反序列化操作", "codeLocation": null },
      { "id": "crypto_flaw", "verdict": "na", "severity": null, "evidence": "无加密相关变更", "codeLocation": null },
      { "id": "info_leak", "verdict": "na", "severity": null, "evidence": "无敏感信息输出", "codeLocation": null }
    ]
  },
  "correctness": {
    "items": [
      { "id": "logic_error", "verdict": "pass", "severity": null, "evidence": "条件逻辑正确", "codeLocation": null },
      { "id": "race_condition", "verdict": "na", "severity": null, "evidence": "无并发操作", "codeLocation": null },
      { "id": "null_safety", "verdict": "risk", "severity": "warning", "evidence": "user对象可能为null但未检查, 见 line 33", "codeLocation": { "filePath": "src/service.ts", "lineNumber": 33 } },
      { "id": "boundary_handling", "verdict": "pass", "severity": null, "evidence": "数组已做非空检查", "codeLocation": null },
      { "id": "api_misuse", "verdict": "pass", "severity": null, "evidence": "API使用正确", "codeLocation": null },
      { "id": "state_inconsistency", "verdict": "na", "severity": null, "evidence": "无状态管理变更", "codeLocation": null },
      { "id": "error_handling", "verdict": "pass", "severity": null, "evidence": "有try-catch覆盖", "codeLocation": null }
    ]
  },
  "dependency": { "level": "pass", "score": 70, "issue": null },
  "maintainability": { "score": 70, "highlights": ["函数命名清晰"], "suggestions": [] },
  "architecture": { "score": 70, "highlights": [], "suggestions": [] },
  "performance": { "score": 70, "highlights": [], "suggestions": [] },
  "robustness": { "score": 70, "highlights": [], "suggestions": [] },
  "testQuality": { "score": 70, "highlights": [], "suggestions": [] },
  "impact": { "level": "low", "modules": [], "publicApiChanges": false, "dataModelChanges": false, "riskCode": null }
}`;
}
```

- [ ] **Step 3: 重写 `getOverviewUserPrompt`**

将第 263-269 行替换为：

```typescript
export function getOverviewUserPrompt(diffText: string): string {
  return `Complete STRICT itemized audit of the following Git Diff. Assess ALL 10 security items and 7 correctness items individually. For engineering dimensions, provide evidence-driven scores starting from 70.

CRITICAL: For each security item, you MUST find POSITIVE evidence of security controls to mark "pass". If you cannot find evidence in the diff, mark "risk".

--- GIT DIFF START ---
${diffText}
--- GIT DIFF END ---`;
}
```

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

预期：prompts.ts 无错误，server.ts 可能有类型不匹配（后续 task 修复）。

---

### Task 4: Phase 3 风险代码定位提示词强化

**Files:**
- Modify: `server/prompts.ts:275-329` (getRiskLocationSystemPrompt, getRiskLocationJsonSchema, getRiskLocationUserPrompt)

- [ ] **Step 1: 重写 `getRiskLocationSystemPrompt`**

将第 275-295 行替换为：

```typescript
export function getRiskLocationSystemPrompt(): string {
  return `You are a security-focused code auditor performing thorough risk location. Your task is to locate EVERY risky code line in a Git diff and produce improvement suggestions. Be aggressive — false positives are acceptable, false negatives are NOT.

## INSTRUCTIONS
1. Scan the diff for risk in THREE dimensions:
   - NEWLY ADDED lines (starting with "+") — primary risk source
   - DELETED lines (starting with "-") — check if security controls (parameterized queries, input validation, auth checks, error handling) were removed
   - SURROUNDING CONTEXT — lines around additions that may change security boundaries
2. For each risky location, provide ALL fields below.
3. Severity levels:
   - "blocker": Confirmed dangerous code visible from the diff alone that WILL cause security breach or data loss (SQL injection with no sanitization, hardcoded production credentials, auth middleware removed)
   - "critical": High-risk code highly likely to be exploitable (XSS with user input, missing auth on sensitive route, path traversal)
   - "high": High-risk but exploitability uncertain (potential race condition, crypto weakness)
   - "medium": Moderate risk (missing null check that could crash, suboptimal error handling)
   - "low": Minor improvement suggestion (naming, formatting, minor perf)
4. Output ALL findings — do NOT limit to a fixed count. 0 findings ONLY if the diff is truly risk-free.
5. When input includes Phase 2 risk items, you MUST locate code for each risk item. If you cannot locate the code, output a finding with severity "medium" explaining why the location is unclear.

## CRITICAL
- lineNumber MUST be a real number matching the diff hunk headers (look at @@ -a,b +c,d @@ headers; the first added line after the header has lineNumber = c, and each subsequent line increments it).
- All descriptions and suggestions MUST be in Chinese (Simplified).
- Keep descriptions concise (under 120 Chinese characters).
- Suggestions should include actual code when relevant.`;
}
```

- [ ] **Step 2: 重写 `getRiskLocationJsonSchema`**

将第 297-312 行替换为：

```typescript
export function getRiskLocationJsonSchema(): string {
  return `Return ONLY a valid JSON object. Do NOT use markdown code fences:
{
  "comments": [
    {
      "id": "rl_1",
      "filePath": "src/auth.ts",
      "lineNumber": 42,
      "originalContent": "const query = 'SELECT * FROM users WHERE name = \\"' + user + '\\"'",
      "description": "用户输入直接拼接入SQL查询，存在SQL注入风险。攻击者可构造恶意输入绕过认证或窃取全部用户数据。",
      "suggestion": "使用参数化查询：\\nconst query = 'SELECT * FROM users WHERE name = ?';\\nawait db.query(query, [user]);",
      "severity": "blocker",
      "linkedRiskItem": "sql_injection"
    }
  ]
}`;
}
```

- [ ] **Step 3: 重写 `getRiskLocationUserPrompt`**

将第 314-329 行替换为：

```typescript
export function getRiskLocationUserPrompt(diffText: string, semantics: string, phase2RiskSummary?: string): string {
  const riskContext = phase2RiskSummary
    ? `## PHASE 2 RISK ITEMS (must locate each)\n${phase2RiskSummary}\n\n`
    : '';
  return `## BUSINESS CONTEXT
${semantics}

${riskContext}## TASK
Locate ALL risky code lines in the diff below. Be thorough — scan additions, deletions, and surrounding context. Report everything you find.

## RULES
- Do NOT limit output count — report every real risk
- Match line numbers to the NEW file side of diff hunk headers (@@ -old,oldN +newStart,newN @@)
- For deletions: if security-relevant code was removed (auth checks, input validation, error handling), report it
- If Phase 2 flagged risk items above, you MUST locate code for each one

--- GIT DIFF START ---
${diffText}
--- GIT DIFF END ---`;
}
```

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

预期：函数签名变更可能影响 server.ts 调用处（后续修复）。

---

### Task 5: Phase 4 数据流追踪提示词

**Files:**
- Modify: `server/prompts.ts` (在文件末尾新增导出函数)

- [ ] **Step 1: 新增 `getDataflowTraceSystemPrompt`**

在 `prompts.ts` 文件末尾追加：

```typescript
export function getDataflowTraceSystemPrompt(): string {
  return `You are a senior application security researcher performing DATAFLOW TRACING. Your task is to trace the complete path of untrusted data from entry point to sensitive operation, determining whether a security vulnerability actually exists.

## METHODOLOGY

For each risk item, perform this analysis:

1. **SOURCE identification**: Find ALL external data entry points in the provided code context.
   - Web: req.body, req.query, req.params, req.headers, req.cookies, URL parameters
   - File: fs.readFile, file uploads, stream inputs
   - Network: fetch/axios responses, WebSocket messages, message queue consumers

2. **TRANSFORM tracking**: Trace every transformation applied to the input.
   - Validation: schema validation, type checks, allowlisting
   - Sanitization: HTML escaping, SQL escaping, path normalization
   - Encoding: base64 decode, URL decode, JSON parse
   - Obfuscation: concatenation, template strings, object spread

3. **SINK identification**: Determine if data reaches a sensitive operation.
   - SQL: db.query(), db.execute(), knex.raw(), sequelize.query(), .createQueryBuilder()
   - NoSQL: collection.find({ $where: ... }), .aggregate(), Model.find(query)
   - HTML: res.send(), innerHTML=, dangerouslySetInnerHTML, document.write()
   - Command: exec(), spawn(), child_process.exec(), eval(), new Function()
   - File: fs.writeFile(), fs.createWriteStream(), path.join(untrusted, ...)
   - Auth: jwt.verify() without proper options, session assignment without validation

4. **SECURITY CONTROL analysis**: For each point between SOURCE and SINK, check if any control prevents exploitation:
   - Is there parameterized query usage? (for SQL injection)
   - Is there HTML escaping? (for XSS)
   - Is there path.resolve() before file read? (for path traversal)
   - Is there schema validation after deserialization? (for insecure deserialization)

## OUTPUT

For each risk item, produce:
- "traced": boolean — was a complete path found from SOURCE to SINK?
- "finalVerdict": "confirmed_risk" | "false_positive" | "inconclusive"
  - "confirmed_risk": Exploitable path confirmed with no effective controls
  - "false_positive": Security control effectively prevents exploitation
  - "inconclusive": Cannot determine from available context
- "dataflowPath": array of nodes — each step in the flow (SOURCE → TRANSFORM → SINK)
- "attackScenario": string (Chinese) — concrete attack example, only if confirmed_risk
- "mitigationsFound": string[] — any security controls discovered

All descriptions and scenarios MUST be in Chinese.`;
}
```

- [ ] **Step 2: 新增 `getDataflowTraceUserPrompt`**

在 `prompts.ts` 文件末尾追加：

```typescript
export function getDataflowTraceUserPrompt(
  riskItemId: string,
  riskItemLabel: string,
  riskSeverity: string,
  codeLocations: { filePath: string; lineNumber: number; context: string }[],
  fullDiff: string
): string {
  const locationsBlock = codeLocations.map(loc =>
    `### ${loc.filePath}:${loc.lineNumber}\n\`\`\`\n${loc.context}\n\`\`\``
  ).join('\n\n');

  return `## RISK ITEM
- ID: ${riskItemId}
- Label: ${riskItemLabel}
- Severity: ${riskSeverity}

## CODE LOCATIONS TO TRACE
${locationsBlock}

## TASK
For the risk item above, trace the complete dataflow from SOURCE (untrusted input) through TRANSFORMS to SINK (sensitive operation). Determine whether the risk is confirmed, a false positive, or inconclusive.

## FULL DIFF FOR CONTEXT
--- GIT DIFF START ---
${fullDiff}
--- GIT DIFF END ---`;
}
```

- [ ] **Step 3: 新增 `getDataflowTraceJsonSchema`**

在 `prompts.ts` 文件末尾追加：

```typescript
export function getDataflowTraceJsonSchema(): string {
  return `Return ONLY a valid JSON object. Do NOT use markdown code fences:
{
  "itemId": "sql_injection",
  "traced": true,
  "finalVerdict": "confirmed_risk",
  "dataflowPath": [
    { "step": 1, "node": "SOURCE", "code": "const username = req.body.username", "location": "src/login.ts:12" },
    { "step": 2, "node": "TRANSFORM", "code": "const sql = \\"SELECT * FROM users WHERE name='\\" + username + \\"'\\"", "location": "src/login.ts:45" },
    { "step": 3, "node": "SINK", "code": "await db.query(sql)", "location": "src/login.ts:47" }
  ],
  "attackScenario": "攻击者在登录表单的Username字段中注入 ' OR '1'='1' -- ，绕过认证并获取所有用户数据",
  "mitigationsFound": []
}`;
}
```

- [ ] **Step 4: 新增 `getCorrectnessVerifyUserPrompt`**

```typescript
export function getCorrectnessVerifyUserPrompt(
  riskItemId: string,
  riskItemLabel: string,
  riskSeverity: string,
  evidence: string,
  codeLocations: { filePath: string; lineNumber: number; context: string }[],
  fullDiff: string
): string {
  const locationsBlock = codeLocations.map(loc =>
    `### ${loc.filePath}:${loc.lineNumber}\n\`\`\`\n${loc.context}\n\`\`\``
  ).join('\n\n');

  return `## RISK ITEM
- ID: ${riskItemId}
- Label: ${riskItemLabel}
- Severity: ${riskSeverity}
- Phase 2 Evidence: ${evidence}

## CODE LOCATIONS TO VERIFY
${locationsBlock}

## TASK
Simulate the code execution path for the correctness concern above. Determine if this is a confirmed bug, a false positive, or inconclusive.

## FULL DIFF FOR CONTEXT
--- GIT DIFF START ---
${fullDiff}
--- GIT DIFF END ---`;
}
```

- [ ] **Step 5: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

预期：新函数无直接错误。

---

### Task 6: Server Phase 2 管线重构

**Files:**
- Modify: `server.ts:870-998` (Phase 2 overview section)

- [ ] **Step 1: 更新 Phase 2 默认值初始化（第 876-884 行）**

替换为：

```typescript
    sseProgress(res, '正在执行 17 项逐条安全审计...', 'overview');

    let security: SecurityAudit = { level: 'pass', score: 70, items: [], vulnerabilities: [], traces: [], _inferred: true, _source: 'local' };
    let correctness: CorrectnessAudit = { level: 'pass', score: 70, items: [], concerns: [], _inferred: true, _source: 'local' };
    let dependency: DependencyAudit = { level: 'na', score: 70, outdatedDeps: [], licenseIssues: [], _inferred: true, _source: 'local' };
    let maintainability: EngineeringScore = { score: 70, highlights: [], suggestions: [], _inferred: true, _source: 'local' };
    let architecture: EngineeringScore = { score: 70, highlights: [], suggestions: [], _inferred: true, _source: 'local' };
    let performance: EngineeringScore = { score: 70, highlights: [], suggestions: [], _inferred: true, _source: 'local' };
    let robustness: EngineeringScore = { score: 70, highlights: [], suggestions: [], _inferred: true, _source: 'local' };
    let testQuality: EngineeringScore = { score: 70, highlights: [], suggestions: [], _inferred: true, _source: 'local' };
    let impact: any = null;
```

- [ ] **Step 2: 更新 Phase 2 LLM 响应解析（第 896-946 行）**

将 try 块中的解析逻辑替换为：

```typescript
          const overviewText = await callLLMForDimension(model, overviewSystem,
            getOverviewUserPrompt(targetDiff), overviewSchema, 'Phase2-Overview');
          const j = JSON.parse(overviewText.trim());

          const secItems: RiskItem[] = Array.isArray(j.security?.items) ? j.security.items : [];
          const secScore = calculateItemScore(secItems);
          const secLevel = itemScoreToLevel(secScore);

          security = {
            level: secLevel,
            score: secScore,
            items: secItems,
            vulnerabilities: secItems
              .filter((it: RiskItem) => it.verdict === 'risk')
              .map((it: RiskItem) => ({
                category: it.id as any,
                description: it.evidence,
                filePath: it.codeLocation?.filePath || '',
                lineNumber: it.codeLocation?.lineNumber || 0,
                severity: it.severity === 'critical' ? 'high' as const : 'medium' as const,
              })),
            traces: [],
            _inferred: false,
            _source: 'overview',
          };

          const corrItems: RiskItem[] = Array.isArray(j.correctness?.items) ? j.correctness.items : [];
          const corrScore = calculateItemScore(corrItems);
          const corrLevel = itemScoreToLevel(corrScore);

          correctness = {
            level: corrLevel,
            score: corrScore,
            items: corrItems,
            concerns: corrItems
              .filter((it: RiskItem) => it.verdict === 'risk')
              .map((it: RiskItem) => ({
                type: (it.id as any) || 'logic_error',
                description: it.evidence,
                filePath: it.codeLocation?.filePath || '',
                lineNumber: it.codeLocation?.lineNumber || 0,
              })),
            _inferred: false,
            _source: 'overview',
          };

          dependency = {
            level: j.dependency?.level || 'na',
            score: j.dependency?.score ?? 70,
            outdatedDeps: j.dependency?.issue ? [{ name: '', currentVersion: '', latestVersion: '', risk: j.dependency.issue }] : [],
            licenseIssues: [],
            _inferred: false,
            _source: 'overview',
          };
          maintainability = { score: j.maintainability?.score ?? 70, highlights: j.maintainability?.highlights || [], suggestions: j.maintainability?.suggestions || [], _inferred: false, _source: 'overview' };
          architecture = { score: j.architecture?.score ?? 70, highlights: j.architecture?.highlights || [], suggestions: j.architecture?.suggestions || [], _inferred: false, _source: 'overview' };
          performance = { score: j.performance?.score ?? 70, highlights: j.performance?.highlights || [], suggestions: j.performance?.suggestions || [], _inferred: false, _source: 'overview' };
          robustness = { score: j.robustness?.score ?? 70, highlights: j.robustness?.highlights || [], suggestions: j.robustness?.suggestions || [], _inferred: false, _source: 'overview' };
          testQuality = { score: j.testQuality?.score ?? 70, highlights: j.testQuality?.highlights || [], suggestions: j.testQuality?.suggestions || [], _inferred: false, _source: 'overview' };
          impact = {
            level: j.impact?.level || 'low',
            affectedModules: j.impact?.modules || [],
            publicApiChanges: j.impact?.publicApiChanges || false,
            dataModelChanges: j.impact?.dataModelChanges || false,
            riskCodeLocations: j.impact?.riskCode ? [{ filePath: '', lineNumber: 0, reason: j.impact.riskCode }] : [],
            _inferred: false,
            _source: 'overview',
          };
```

- [ ] **Step 3: 更新 SSE 推送以包含 risk_items 事件（在 overviewSucceeded 推送块，第 983 行附近）**

在 `sseWrite(res, { stage: 'security', data: security });` 之前插入 risk_items 事件：

```typescript
      if (overviewSucceeded) {
        sseWrite(res, { stage: 'risk_items', data: { dimension: 'security', items: security.items } });
        sseWrite(res, { stage: 'risk_items', data: { dimension: 'correctness', items: correctness.items } });
        sseWrite(res, { stage: 'security', data: security });
        sseWrite(res, { stage: 'correctness', data: correctness });
        // ... rest unchanged
```

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

预期：需要导入 `RiskItem` 类型。检查 `server.ts` 第 9 行 import，确认已包含 `RiskItem`。

---

### Task 7: Server Phase 3 管线强化

**Files:**
- Modify: `server.ts` Phase 3 section (需要先找到确切行号)
- Modify: `server.ts` 顶部 import

- [ ] **Step 1: 定位 Phase 3 代码段**

查看 `server.ts` 中 `getRiskLocationUserPrompt` 的调用位置，确定 Phase 3 代码段的行范围。

- [ ] **Step 2: 构造 Phase 2 risk 摘要并传入 Phase 3**

在 Phase 3 LLM 调用前，构造 risk 摘要字符串：

```typescript
    let phase3Failed = false;

    const phase2RiskSummary = (() => {
      const risks: string[] = [];
      for (const item of security.items) {
        if (item.verdict === 'risk') risks.push(`[安全] ${item.id}: ${item.evidence} (severity: ${item.severity})`);
      }
      for (const item of correctness.items) {
        if (item.verdict === 'risk') risks.push(`[正确性] ${item.id}: ${item.evidence} (severity: ${item.severity})`);
      }
      return risks.length > 0 ? risks.join('\n') : 'Phase 2 未发现 risk 条目';
    })();
```

- [ ] **Step 3: 更新 `getRiskLocationUserPrompt` 调用**

将原有的两参数调用改为三参数调用：

```typescript
const riskPrompt = getRiskLocationUserPrompt(targetDiff, semanticsStr, phase2RiskSummary);
```

- [ ] **Step 4: 添加 Phase 3 失败处理**

在 Phase 3 的 catch 块中，添加 `phase3Failed = true` 和 SSE 事件推送：

```typescript
  } catch (e: any) {
    phase3Failed = true;
    sseWrite(res, { stage: 'phase3_failed', data: { message: '风险代码定位阶段失败，无法确认新增代码的安全性，请人工审查' } });
    console.warn(`[SSE] Phase 3 (risk location) failed: ${e.message?.substring(0, 100)}`);
  }
```

- [ ] **Step 5: 在 done 事件中传递 phase3Failed 标志**

找到 `sseDone` 调用位置，如果 `overallScore` 和 `overallLevel` 的计算中需要加入 `hasPhase3Blocker`。先收集 Phase 3 的 blocker 计数：

```typescript
    const blockerCount = allComments.filter((c: any) => c.severity === 'blocker').length;
    const hasPhase3Blocker = blockerCount > 0;
```

然后将 `hasPhase3Blocker` 传入 `calculateOverall`。

- [ ] **Step 6: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

预期：Phase 3 相关无错误。

---

### Task 8: Server Phase 4 数据流追踪

**Files:**
- Modify: `server.ts:1022-1166` (Phase 4 deep review section)

- [ ] **Step 1: 导入新 prompt 函数**

在 `server.ts` 顶部 import 中添加：
```typescript
import { ..., getDataflowTraceSystemPrompt, getDataflowTraceUserPrompt, getDataflowTraceJsonSchema, getCorrectnessVerifyUserPrompt } from "./prompts.js";
```

- [ ] **Step 2: 添加数据流追踪任务**

在 Phase 4 的安全深度审查任务（`securityDeepTask`）之前，插入数据流追踪逻辑。在 `securityDeepTask` 定义完成后、`await Promise.all` 之前插入：

```typescript
    // --- 数据流追踪阶段（仅对 Phase 2 的 risk 条目） ---
    const securityRiskItems = security.items.filter(it => it.verdict === 'risk');
    if (securityRiskItems.length > 0) {
      sseProgress(res, `正在对 ${securityRiskItems.length} 个安全风险条目执行数据流追踪...`, 'deep');

      // 提取代码上下文：每个 risk 条目取 codeLocation ±30 行
      const traceInputs = securityRiskItems.map(item => {
        const loc = item.codeLocation;
        if (!loc) return { item, context: '无法定位代码位置' };
        const diffLines = targetDiff.split('\n');
        const contextStart = Math.max(0, loc.lineNumber - 31);
        const contextEnd = Math.min(diffLines.length, loc.lineNumber + 30);
        const context = diffLines.slice(contextStart, contextEnd).join('\n');
        return { item, context };
      });

      const traceSystem = getDataflowTraceSystemPrompt();
      const traceSchema = getDataflowTraceJsonSchema();

      try {
        for (const { item, context } of traceInputs) {
          const traceLabel = SECURITY_ITEM_LABELS[item.id] || item.id;
          const tracePrompt = getDataflowTraceUserPrompt(
            item.id, traceLabel, item.severity || 'warning',
            [{ filePath: item.codeLocation?.filePath || '', lineNumber: item.codeLocation?.lineNumber || 0, context }],
            targetDiff
          );
          const traceText = await callLLMForDimension(model, traceSystem, tracePrompt, traceSchema, `数据流追踪-${item.id}`);
          const traceResult: DataflowTrace = JSON.parse(traceText.trim());
          security.traces.push(traceResult);

          sseWrite(res, { stage: 'dataflow_trace', data: { itemId: item.id, trace: traceResult } });

          // 根据追踪结果更新 item verdict
          if (traceResult.finalVerdict === 'false_positive') {
            item.verdict = 'pass';
            item.severity = null;
            item.evidence = `[数据流追踪纠正] ${traceResult.mitigationsFound.join('; ') || '未找到利用路径'}`;
          } else if (traceResult.finalVerdict === 'confirmed_risk') {
            item.evidence = `[数据流追踪确认] ${traceResult.attackScenario || item.evidence}`;
            if (item.severity === 'warning') item.severity = 'critical';
          }
        }

        // 重新计算安全评分（追踪可能改变了 item 状态）
        security.score = calculateItemScore(security.items);
        security.level = itemScoreToLevel(security.score);
        sseWrite(res, { stage: 'security', data: security });
      } catch (e: any) {
        console.warn(`[SSE] Phase 4 dataflow tracing failed: ${e.message?.substring(0, 100)}`);
      }
    }
```

- [ ] **Step 3: 添加工程量标签映射**

在 `server.ts` 顶部添加安全条目 ID 到中文标签的映射：

```typescript
const SECURITY_ITEM_LABELS: Record<string, string> = {
  sql_injection: 'SQL注入',
  nosql_injection: 'NoSQL注入',
  xss: 'XSS/HTML注入',
  command_injection: '命令注入',
  hardcoded_secret: '硬编码密钥',
  auth_bypass: '认证绕过',
  path_traversal: '路径遍历',
  insecure_deserialization: '不安全反序列化',
  crypto_flaw: '加密缺陷',
  info_leak: '信息泄露',
};
```

- [ ] **Step 4: 更新 Phase 4 深度审查的 scoring**

将 `securityDeepTask` 中的评分逻辑从：

```typescript
security = { level: j.level || 'pass', score: j.score ?? 80, vulnerabilities: j.vulnerabilities || [], _inferred: false, _source: 'deep' };
```

改为使用 items 驱动的评分：

```typescript
// Parse deep review vulnerabilities and merge with existing items
const deepVulns = j.vulnerabilities || [];
const mergedItems = security.items.map(item => {
  const deepMatch = deepVulns.find((v: any) => 
    v.category === item.id || (v.description && v.description.includes(item.id))
  );
  if (deepMatch) {
    return { ...item, evidence: item.evidence + ' | Deep: ' + (deepMatch.description || ''), _source: 'deep' };
  }
  return item;
});
security = { 
  level: itemScoreToLevel(calculateItemScore(mergedItems)), 
  score: calculateItemScore(mergedItems), 
  items: mergedItems, 
  vulnerabilities: deepVulns, 
  traces: security.traces,
  _inferred: false, 
  _source: 'deep' 
};
```

对 `correctnessDeepTask` 做相同改造。

- [ ] **Step 5: 更新工程维度 Phase 4 默认分**

将 `makeEngDeepTask` 中的 `j.score ?? 50` 改为 `j.score ?? 70`。

- [ ] **Step 6: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

---

### Task 9: 本地兜底函数升级

**Files:**
- Modify: `server/fallback.ts`

- [ ] **Step 1: 重写 `inferSecurityFromDiff` 以输出 items 格式**

在当前函数返回值中添加 `items: RiskItem[]`。为 10 个条目各创建初始 `na` 条目，然后根据 regex 匹配结果更新：

```typescript
// 在 fallback.ts 顶部添加导入
import { RiskItem } from "../src/types.js";

// 在 inferSecurityFromDiff 中修改返回值结构
const items: RiskItem[] = [
  { id: 'sql_injection', verdict: 'na', severity: null, evidence: '无SQL操作' },
  { id: 'nosql_injection', verdict: 'na', severity: null, evidence: '无NoSQL操作' },
  { id: 'xss', verdict: 'na', severity: null, evidence: '无HTML输出操作' },
  { id: 'command_injection', verdict: 'na', severity: null, evidence: '无命令执行操作' },
  { id: 'hardcoded_secret', verdict: 'na', severity: null, evidence: '无硬编码密钥' },
  { id: 'auth_bypass', verdict: 'na', severity: null, evidence: '无认证变更' },
  { id: 'path_traversal', verdict: 'na', severity: null, evidence: '无文件路径操作' },
  { id: 'insecure_deserialization', verdict: 'na', severity: null, evidence: '无反序列化操作' },
  { id: 'crypto_flaw', verdict: 'na', severity: null, evidence: '无加密操作' },
  { id: 'info_leak', verdict: 'na', severity: null, evidence: '无敏感信息输出' },
];

// 根据 regex 匹配更新 items...
// 每个匹配到的风险映射到对应条目，verdict='risk', severity 对应原有逻辑

return {
  level,
  score: 70, // 改为从 70 起
  items,
  vulnerabilities: [...], // 保留兼容
  traces: [],
  _inferred: true,
  _source: 'local',
};
```

- [ ] **Step 2: 更新 `inferCorrectnessFromDiff` 同样输出 items**

创建 7 个初始 `na` 条目，匹配填充。

```typescript
const items: RiskItem[] = [
  { id: 'logic_error', verdict: 'na', severity: null, evidence: '未检测到逻辑错误' },
  { id: 'race_condition', verdict: 'na', severity: null, evidence: '未检测到竞态条件' },
  { id: 'null_safety', verdict: 'na', severity: null, evidence: '未检测到空安全问题' },
  { id: 'boundary_handling', verdict: 'na', severity: null, evidence: '未检测到边界问题' },
  { id: 'api_misuse', verdict: 'na', severity: null, evidence: '未检测到API误用' },
  { id: 'state_inconsistency', verdict: 'na', severity: null, evidence: '未检测到状态不一致' },
  { id: 'error_handling', verdict: 'na', severity: null, evidence: '未检测到错误处理缺陷' },
];
```

- [ ] **Step 3: 添加新正则模式**

在 `inferSecurityFromDiff` 中添加：

```typescript
// NoSQL injection
if (line.match(/\$where\s*:/) || line.match(/\$regex\s*:/)) {
  updateItem(items, 'nosql_injection', 'risk', 'critical', `可能的NoSQL注入: ${line.trim()}`);
}
// Command injection
if ((line.includes('exec(') || line.includes('spawn(')) && (line.includes('req.') || line.includes('${'))) {
  updateItem(items, 'command_injection', 'risk', 'critical', `可能的命令注入: ${line.trim()}`);
}
// Auth bypass
if (line.includes('app.') && (line.includes('.get(') || line.includes('.post(') || line.includes('.use(')) && 
    !context.includes('auth') && !context.includes('authenticate') && !context.includes('middleware')) {
  updateItem(items, 'auth_bypass', 'risk', 'warning', `新增路由可能缺少认证: ${line.trim()}`);
}
// Path traversal
if ((line.includes('path.join') || line.includes('fs.readFile') || line.includes('fs.writeFile')) && 
    (line.includes('req.') || line.includes('params') || line.includes('query'))) {
  updateItem(items, 'path_traversal', 'risk', 'warning', `用户输入参与文件路径操作: ${line.trim()}`);
}
// Insecure deserialization
if (line.includes('JSON.parse') && (line.includes('req.body') || line.includes('req.params'))) {
  updateItem(items, 'insecure_deserialization', 'risk', 'warning', `不可信数据反序列化: ${line.trim()}`);
}
```

添加辅助函数 `updateItem`：

```typescript
function updateItem(items: RiskItem[], id: string, verdict: 'risk', severity: 'critical' | 'warning', evidence: string) {
  const item = items.find(i => i.id === id);
  if (item) {
    item.verdict = verdict;
    item.severity = severity;
    item.evidence = evidence;
  }
}
```

- [ ] **Step 4: 更新工程维度兜底评分**

所有 `score: 100/90/80` 等默认值改为从 70 计算。

- [ ] **Step 5: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

预期：fallback.ts 需要导入 RiskItem，其余无错误。

---

### Task 10: 前端 SSE Hook 适配新事件

**Files:**
- Modify: `src/hooks/useSSEReview.ts`

- [ ] **Step 1: 添加新状态字段**

在 `SSEReviewState` 接口中添加：

```typescript
interface SSEReviewState {
  // ... existing fields ...
  phase3Failed: boolean;
  riskItems: { security: RiskItem[]; correctness: RiskItem[] };
  dataflowTraces: Record<string, DataflowTrace>;
}
```

更新 `initialState`：
```typescript
const initialState: SSEReviewState = {
  // ... existing ...
  phase3Failed: false,
  riskItems: { security: [], correctness: [] },
  dataflowTraces: {},
};
```

- [ ] **Step 2: 添加导入**

```typescript
import { ..., RiskItem, DataflowTrace } from "../types";
```

- [ ] **Step 3: 在 switch 中添加新事件处理**

在第 97 行（`case "risk_comments"`）之前插入三条新 case：

```typescript
              case "risk_items": {
                const { dimension, items } = event.data as { dimension: 'security' | 'correctness'; items: RiskItem[] };
                next.riskItems = { ...next.riskItems, [dimension]: items };
                break;
              }
              case "dataflow_trace": {
                const { itemId, trace } = event.data as { itemId: string; trace: DataflowTrace };
                next.dataflowTraces = { ...next.dataflowTraces, [itemId]: trace };
                break;
              }
              case "phase3_failed": {
                next.phase3Failed = true;
                break;
              }
```

- [ ] **Step 4: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

预期：DimensionCards 可能使用了旧的数据结构（后续修复）。

---

### Task 11: 前端 DimensionCards 逐项审计面板

**Files:**
- Modify: `src/components/DimensionCards.tsx`
- Modify: `src/App.tsx` (传递新 props)

- [ ] **Step 1: 更新 DimensionCards 接收新数据**

修改 props 接口以接收 `riskItems` 和 `dataflowTraces`：

```typescript
interface DimensionCardsProps {
  security: SecurityAudit | null;
  correctness: CorrectnessAudit | null;
  // ... other existing props
  riskItems?: { security: RiskItem[]; correctness: RiskItem[] };
  dataflowTraces?: Record<string, DataflowTrace>;
  phase3Failed?: boolean;
}
```

- [ ] **Step 2: 创建 RiskItemPanel 子组件**

在安全/正确性卡片的主体区域，添加可展开的逐项条目面板：

```tsx
function RiskItemPanel({ items, traces, dimLabel }: { 
  items: RiskItem[]; 
  traces?: Record<string, DataflowTrace>;
  dimLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const riskCount = items.filter(i => i.verdict === 'risk').length;
  
  return (
    <div className="mt-3 border-t border-zinc-800/60 pt-3">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200 w-full"
      >
        <span>{expanded ? '▼' : '▶'}</span>
        <span>{dimLabel}逐项审计</span>
        {riskCount > 0 && (
          <span className="text-red-400 font-semibold">{riskCount} risk</span>
        )}
        <span className="text-emerald-400">{items.filter(i => i.verdict === 'pass').length} pass</span>
        <span className="text-zinc-600">{items.filter(i => i.verdict === 'na').length} na</span>
      </button>
      
      {expanded && (
        <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto">
          {items.map(item => (
            <div key={item.id} className={cn(
              "flex items-start gap-2 text-[11px] py-1 px-2 rounded",
              item.verdict === 'risk' && item.severity === 'critical' && "bg-red-950/30 border border-red-800/40",
              item.verdict === 'risk' && item.severity === 'warning' && "bg-yellow-950/30 border border-yellow-800/40",
              item.verdict === 'pass' && "bg-emerald-950/20 border border-emerald-800/30",
              item.verdict === 'na' && "bg-zinc-900/30 border border-zinc-800/30",
            )}>
              <span className={cn(
                "mt-0.5 shrink-0",
                item.verdict === 'risk' && "text-red-400",
                item.verdict === 'pass' && "text-emerald-400",
                item.verdict === 'na' && "text-zinc-600",
              )}>
                {item.verdict === 'risk' ? '✕' : item.verdict === 'pass' ? '✓' : '−'}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-200 font-medium">{ITEM_LABELS[item.id] || item.id}</span>
                  {item.severity && (
                    <span className={cn(
                      "text-[9px] px-1 py-px rounded",
                      item.severity === 'critical' && "text-red-400 bg-red-950/50",
                      item.severity === 'warning' && "text-yellow-400 bg-yellow-950/50",
                    )}>{item.severity}</span>
                  )}
                </div>
                <p className="text-zinc-400 mt-0.5 leading-relaxed">{item.evidence}</p>
                {item.codeLocation && (
                  <p className="text-zinc-600 text-[10px] mt-0.5">{item.codeLocation.filePath}:{item.codeLocation.lineNumber}</p>
                )}
                {traces?.[item.id]?.finalVerdict === 'confirmed_risk' && (
                  <div className="mt-1 p-1.5 bg-red-950/40 border border-red-800/30 rounded text-[10px]">
                    <span className="text-red-400 font-semibold">⛓ 数据流追踪确认:</span>
                    <span className="text-zinc-400 ml-1">{traces[item.id].attackScenario}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 添加条目标签映射**

在文件顶部添加：

```typescript
const ITEM_LABELS: Record<string, string> = {
  sql_injection: 'SQL注入', nosql_injection: 'NoSQL注入', xss: 'XSS',
  command_injection: '命令注入', hardcoded_secret: '硬编码密钥', auth_bypass: '认证绕过',
  path_traversal: '路径遍历', insecure_deserialization: '不安全反序列化',
  crypto_flaw: '加密缺陷', info_leak: '信息泄露',
  logic_error: '逻辑错误', race_condition: '竞态条件', null_safety: '空安全',
  boundary_handling: '边界处理', api_misuse: 'API误用',
  state_inconsistency: '状态不一致', error_handling: '错误处理',
};
```

- [ ] **Step 4: 在安全/正确性卡片中嵌入 RiskItemPanel**

在安全卡片和正确性卡片的渲染中，在评分和等级展示之后插入：

```tsx
{security && riskItems?.security && riskItems.security.length > 0 && (
  <RiskItemPanel items={riskItems.security} traces={dataflowTraces} dimLabel="安全" />
)}
```

- [ ] **Step 5: 在 App.tsx 中传递新数据**

将 `riskItems`、`dataflowTraces`、`phase3Failed` 从 `useSSEReview` 的 state 传递到 `DimensionCards` 组件。

- [ ] **Step 6: Phase 3 failed 警告横幅**

在 DimensionCards 区域顶部，根据 `phase3Failed` 渲染：

```tsx
{phase3Failed && (
  <div className="bg-yellow-950/30 border border-yellow-800/40 rounded-lg px-4 py-2.5 text-yellow-400 text-sm">
    ⚠️ 风险代码定位失败，无法确认新增代码的安全性，请人工审查
  </div>
)}
```

- [ ] **Step 7: 验证 TypeScript 编译**

```bash
npx tsc --noEmit
```

---

### Task 12: 全局集成与构建验证

**Files:**
- Verify: 所有修改过的文件

- [ ] **Step 1: TypeScript 类型检查**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: 修复所有类型错误**

逐一检查 error 输出，修复类型不匹配、缺导入、未定义变量等问题。

- [ ] **Step 3: 构建检查**

```bash
npx vite build
```

- [ ] **Step 4: 功能验证**

```bash
npm run dev
```

手动测试：
1. 粘贴包含 SQL 注入风险的 diff → 验证逐项审计展示 risk 条目
2. 粘贴安全代码 → 验证 pass 条目展示
3. 确认雷达图正常渲染
4. 确认 Phase 3 风险代码定位新 severity 等级正常

---

## 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/types.ts` | 修改 | 新增 RiskItem/DataflowTrace/DataflowNode，修改 SecurityAudit/CorrectnessAudit/ReviewComment/SSEEvent |
| `server.ts` | 修改 | Phase 2 管线重构（items 驱动评分），Phase 3 关联+blocker，Phase 4 数据流追踪，calculateOverall 更新 |
| `server/prompts.ts` | 修改 | Phase 2 逐项审计 prompt，Phase 3 强化 prompt，Phase 4 数据流追踪 prompt |
| `server/fallback.ts` | 修改 | items 格式输出，新增正则模式，评分从 70 起 |
| `src/hooks/useSSEReview.ts` | 修改 | 新增 risk_items/dataflow_trace/phase3_failed 事件处理 |
| `src/components/DimensionCards.tsx` | 修改 | 新增 RiskItemPanel 逐项审计面板，phase3Failed 警告 |
| `src/App.tsx` | 修改 | 传递新 props 到 DimensionCards |
