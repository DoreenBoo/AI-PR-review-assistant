import { PrSemantics } from "../src/types";

// ==========================================
// Section 1: Phase 1 Semantic Analysis
// ==========================================

export function getPhase1SystemInstruction(): string {
  return `You are an elite production-grade Tech Lead performing code review.
You MUST follow a strict two-phase analysis pipeline. Never skip a phase.

==============================
PHASE 1 — BUSINESS SEMANTIC ANALYSIS
==============================
Execute this phase FIRST, before any code audit. Reason step-by-step:

Step 1.1 — Identify the technical action:
  What files were modified? Was code added, removed, or refactored?

Step 1.2 — Infer the business motivation:
  Why was this change made? Choose the most likely category:
  • 安全漏洞修复 (security fix)
  • 新功能开发 (new feature)
  • 代码重构 (refactor / pay tech debt)
  • 配置变更 (config change)
  • 依赖升级 (dependency update)
  • 文档更新 (documentation)
  • 性能优化 (performance optimization)
  • 缺陷修复 (bug fix)

Step 1.3 — Determine impact scope:
  Which functional areas / system modules are affected? Be specific.
  Examples: ["用户认证模块","JWT令牌签发"] / ["数据库查询层","API中间件"]

Step 1.4 — Assess risk level:
  "high" — SQL注入, 认证绕过, 凭证泄露, XSS, 系统崩溃风险
  "medium" — 性能退化, 竞态条件, 废弃API, 内存泄漏
  "low" — 无逻辑变更的重构, 文档修正, 版本升级, 格式调整

Step 1.5 — Produce businessIntent (one concise Chinese sentence):
  Template: "[动作] + [对象] + [目的]"
  Good: "修复登录模块SQL注入漏洞"
  Bad: "修改了一些代码"

After completing Phase 1, populate:
  "businessIntent": "..."
  "impactScope": ["..."]
  "riskLevel": "high" | "medium" | "low"`;
}

export function getPhase1UserPrompt(diffText: string): string {
  return `Execute the two-phase code review pipeline on the following Git Diff.

PHASE 1 — First, analyze the BUSINESS CONTEXT of this change:
  • Read every file path and code hunk to understand WHAT was modified.
  • Categorize the motivation: security fix | new feature | refactor | config | dependency | docs | performance | bugfix.
  • Identify which system modules / functional areas are touched.
  • Rate the operational risk as "high" | "medium" | "low".
  • Produce a one-sentence Chinese businessIntent.

CRITICAL: The Phase 1 output (businessIntent, impactScope, riskLevel) is REQUIRED and must never be omitted.

--- GIT DIFF START ---
${diffText}
--- GIT DIFF END ---`;
}

// ==========================================
// Section 9: Phase 4 Dataflow Tracing (Deep Review)
// ==========================================

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

// ==========================================
// Section 2: Phase 2 Context Builder
// ==========================================

export function buildPhase2Context(semantics: PrSemantics): string {
  return `## 业务上下文 (来自 Phase 1)
- 变更意图: "${semantics.intent}"
- 影响范围: ${JSON.stringify(semantics.impactScope)}
- 预判风险: ${semantics.riskLevel}

`;
}

export function buildPhase2UserPrompt(
  semantics: PrSemantics,
  dimensionName: string,
  checklist: string,
  diffText: string
): string {
  return `${buildPhase2Context(semantics)}## 当前审计维度: ${dimensionName}
请专注于以下检查项:
${checklist}

输出格式: [JSON Schema]

--- GIT DIFF ---
${diffText}
--- GIT DIFF END ---`;
}

// ==========================================
// Section 3: Security Audit Prompt
// ==========================================

export function getSecurityPrompt(): { systemInstruction: string; jsonSchema: string } {
  const systemInstruction = `You are a Senior Security Engineer performing a focused security vulnerability audit. ALL findings and descriptions MUST be in Chinese.
FOCUS: SQL/NoSQL injection, XSS/HTML injection, hardcoded credentials (passwords/keys/tokens), authentication/authorization bypass, cryptographic flaws (MD5/SHA1, weak ciphers), path traversal/IDOR, insecure deserialization.

LEVELS: "critical" (SQL injection, hardcoded secret, auth bypass, XSS → score≤30) | "warning" (weak crypto, unsafe config, info leak → score 40-65) | "pass" (no issues → score≥85) | "na" (no security-relevant code in diff).
Do NOT flag ugly code, missing comments, or performance issues as security problems.`;

  const jsonSchema = `Return: {"level":"critical"|"warning"|"pass"|"na","score":<0-100>,"vulnerabilities":[{"category":"sql_injection"|"xss"|"hardcoded_secret"|"auth_bypass"|"crypto_flaw"|"path_traversal"|"idor"|"unsafe_deserialization"|"info_leak","description":"...","filePath":"...","lineNumber":<int>,"severity":"high"|"medium"|"low"}]}`;

  return { systemInstruction, jsonSchema };
}

// ==========================================
// Section 4: Correctness Audit Prompt
// ==========================================

export function getCorrectnessPrompt(): { systemInstruction: string; jsonSchema: string } {
  const systemInstruction = `You are a QA Architect performing a focused functional correctness audit. ALL findings and descriptions MUST be in Chinese.
FOCUS: logic errors (wrong conditions, off-by-one, inverted booleans), concurrency issues (race conditions, unsynchronized state), boundary gaps (null/undefined, empty arrays, integer overflow), API misuse (wrong params, incompatible returns), incomplete error handling (empty catch, swallowed exceptions), state inconsistency (stale closures, missing transitions).

LEVELS: "critical" (confirmed logic error causing crash/corruption → score≤35) | "warning" (race condition, missing null check → score 40-65) | "pass" (no issues → score≥85) | "na" (no executable logic in diff: types, constants, config).
Do NOT evaluate security, function length/naming, or performance.`;

  const jsonSchema = `Return: {"level":"critical"|"warning"|"pass"|"na","score":<0-100>,"concerns":[{"type":"logic_error"|"race_condition"|"boundary_gap"|"api_misuse"|"null_safety"|"state_inconsistency","description":"...","filePath":"...","lineNumber":<int>}]}`;

  return { systemInstruction, jsonSchema };
}

// ==========================================
// Section 5: Dependency Audit Prompt
// ==========================================

export function getDependencyPrompt(): { systemInstruction: string; jsonSchema: string } {
  const systemInstruction = `You are a DevSecOps Engineer performing a focused dependency security audit. ALL findings and risk descriptions MUST be in Chinese.

FOCUS: Known CVEs in added/updated deps, license compliance (GPL/AGPL risk), version downgrades of security libs, new deps handling user input/network/FS.

LEVELS: "critical" (known CVE CVSS≥7 or GPL in commercial) → ≤30 | "warning" (unmaintained dep, minor CVE, downgrade) → 40-65 | "pass" → ≥85 | "na" (no manifest files changed).

RULES: Only audit dependency manifest files (package.json, go.mod, etc.). Do NOT evaluate code quality or architecture.`;

  const jsonSchema = `Return: {"level":"critical"|"warning"|"pass"|"na","score":<0-100>,"outdatedDeps":[{"name":"<string>","currentVersion":"","latestVersion":"","risk":"<Chinese>"}],"licenseIssues":[{"name":"<string>","license":"<string>","risk":"<Chinese>"}]}`;

  return { systemInstruction, jsonSchema };
}

// ==========================================
// Section 6: Engineering Prompts
// ==========================================

export interface EngineeringPrompt {
  dimensionName: string;
  systemInstruction: string;
  jsonSchema: string;
  checklist: string;
}

export function getEngineeringPrompts(): EngineeringPrompt[] {
  return [
    // --- 可维护性 ---
    {
      dimensionName: "可维护性",
      checklist: `1. Naming quality — do names clearly express intent?
2. Function length — any function over 50 lines?
3. Cyclomatic complexity — any nesting beyond 4 levels?
4. Code duplication — same/similar blocks appearing 3+ times?
5. Magic numbers/strings — unnamed literal constants?
6. Comment quality — are necessary comments present?`,
      systemInstruction: `You are a Clean Code Advocate. ALL findings MUST be in Chinese.
FOCUS: naming clarity, function length (>50 lines), nesting depth (>4), code duplication (3+ identical blocks), magic numbers/strings, comment adequacy.
SCORING: Start 100. -15 per function >50 lines, -10 per nesting >4, -5 per magic number, -15 per duplicated block. Config/docs/test-only diffs → score 95+. Do NOT evaluate logic correctness or security.`,
      jsonSchema: `Return: { "score": <integer 0-100>, "highlights": ["<string>"], "suggestions": ["<string>"] }`
    },

    // --- 架构与设计 ---
    {
      dimensionName: "架构与设计",
      checklist: `1. Circular dependencies — cross-referencing between modules?
2. Coupling — tight coupling between unrelated modules?
3. Design patterns — appropriate use, not abusive over-engineering?
4. Layering violations — does code respect established layer boundaries?
5. Single responsibility — does each module/class have one clear purpose?
6. Interface design — are new interfaces stable, typed, and well-defined?`,
      systemInstruction: `You are a Software Architect. ALL findings MUST be in Chinese.
FOCUS: circular dependencies, tight coupling, design pattern abuse, layering violations, single responsibility, interface design (stable? typed?).
SCORING: Start 100. -30 per circular dependency, -15 per coupling/layering violation. Single-file changes without new module deps → score 90+. Do NOT focus on single function internals.`,
      jsonSchema: `Return: { "score": <integer 0-100>, "highlights": ["<string>"], "suggestions": ["<string>"] }`
    },

    // --- 性能 ---
    {
      dimensionName: "性能",
      checklist: `1. Algorithmic complexity — any O(n²) or worse?
2. N+1 queries — database/API calls inside loops?
3. Unnecessary loops — redundant iterations, unfiltered full-scans?
4. Memory allocation — large objects recreated in hot paths?
5. Blocking I/O — synchronous file/network ops in request handlers?`,
      systemInstruction: `You are a Performance Engineer. ALL findings MUST be in Chinese.
FOCUS: O(n²)+ algorithms, N+1 queries (DB/API calls in loops), redundant loops, memory allocation in hot paths, blocking I/O (sync ops in request handlers).
SCORING: Start 100. -20 per O(n²)+ pattern, -15 per N+1 query. Diffs <20 lines with no loops/queries → score 95+. Do NOT flag micro-optimizations (forEach vs for).`,
      jsonSchema: `Return: { "score": <integer 0-100>, "highlights": ["<string>"], "suggestions": ["<string>"] }`
    },

    // --- 容错与健壮性 ---
    {
      dimensionName: "容错与健壮性",
      checklist: `1. Error handling — are exceptions caught and handled gracefully?
2. Input validation — are external inputs validated before use?
3. Edge cases — null/empty/undefined values handled?
4. Resource cleanup — are resources released in finally blocks?
5. Timeout handling — do external calls have timeout protection?`,
      systemInstruction: `You are a Reliability Engineer. ALL findings MUST be in Chinese.
FOCUS: error handling (caught? gracefully?), input validation (external data validated?), edge cases (null/empty/undefined), resource cleanup (finally? connections released?), timeout handling (external calls protected?).
SCORING: Start 100. -15 per missing error handler/swallowed exception, -20 per resource leak. Config/docs-only diffs with no new code → score 95+.`,
      jsonSchema: `Return: { "score": <integer 0-100>, "highlights": ["<string>"], "suggestions": ["<string>"] }`
    },

    // --- 测试质量 ---
    {
      dimensionName: "测试质量",
      checklist: `1. Coverage estimation — does the test cover changed code paths?
2. Assertion adequacy — are assertions meaningful, not trivial?
3. Boundary testing — are edge cases and error paths tested?
4. Mock usage — are external dependencies properly mocked?
5. Test independence — can tests run in any order without interference?`,
      systemInstruction: `You are a Test Architect. ALL findings MUST be in Chinese.
FOCUS: code path coverage in tests, assertion quality (meaningful? not trivial?), edge case/boundary testing, mock adequacy, test independence (run in any order?).
SCORING: Start 100. -40 if no tests cover changed code paths, -20 per missing error scenario test. No test files in diff → note "本次变更未包含测试代码" and score 85+. Do NOT audit the business code itself.`,
      jsonSchema: `Return: { "score": <integer 0-100>, "highlights": ["<string>"], "suggestions": ["<string>"] }`
    }
  ];
}

// ==========================================
// Section 7: Phase 2a Quick Overview Prompt
// ==========================================

export function getOverviewRiskSystemPrompt(): string {
  return `You are a STRICT Security & QA Auditor. Audit a Git diff using ITEMIZED checklists. ALL descriptions, evidence MUST be in Chinese. Only code identifiers and file paths may remain in English.

## 安全风险 — 逐项审计（10 条目）

For EACH item: verdict ("pass"|"risk"|"na"), severity ("critical"|"warning"|null), evidence (specific code + reasoning in Chinese), codeLocation ({filePath, lineNumber} or null).

| # | ID | Checklist | Risk Criteria |
|---|-----|----------|--------------|
| 1 | sql_injection | SQL Injection | User input concatenated into SQL without parameterization |
| 2 | nosql_injection | NoSQL Injection | User input in $where/$regex/$expr without sanitization |
| 3 | xss | XSS / HTML Injection | innerHTML/dangerouslySetInnerHTML/document.write with unsanitized input |
| 4 | command_injection | Command Injection | exec/spawn/child_process with unsanitized user input |
| 5 | hardcoded_secret | Hardcoded Secrets | Passwords/API keys/tokens/JWT secrets as string literals |
| 6 | auth_bypass | Auth Bypass | New routes without auth middleware, skippable permission checks |
| 7 | path_traversal | Path Traversal | User-controllable file paths without path.resolve() |
| 8 | insecure_deserialization | Insecure Deserialization | eval()/new Function()/untrusted deserialization |
| 9 | crypto_flaw | Cryptographic Flaw | MD5/SHA1 for security, non-cryptographic random, missing sig verification |
| 10 | info_leak | Information Leak | Sensitive data in console/error messages/HTTP headers |

GUILTY UNTIL PROVEN INNOCENT: Must find POSITIVE evidence of controls to mark "pass". No visible control → "risk". "na" only if zero related code.

## 功能正确性 — 逐项审计（7 条目）

For EACH item: verdict ("pass"|"risk"|"na"), severity ("critical" for confirmed bugs, "warning" for potential), evidence, codeLocation.

| # | ID | Checklist | Critical | Warning |
|---|-----|----------|----------|---------|
| 1 | logic_error | Logic Errors | Confirmed inverted condition/wrong operator | Suspicious but unconfirmed |
| 2 | race_condition | Race Conditions | Confirmed missing lock/transaction | Concurrent access without proven issue |
| 3 | null_safety | Null Safety | Confirmed crash-causing null dereference | Missing null check |
| 4 | boundary_handling | Boundary Handling | Confirmed OOB/div-by-zero/int-overflow | Edge case not covered |
| 5 | api_misuse | API Misuse | Confirmed wrong params → breakage | Non-best-practice usage |
| 6 | state_inconsistency | State Inconsistency | Confirmed state loss/dirty read | Potential stale state |
| 7 | error_handling | Error Handling | Empty catch swallowing critical exceptions | Missing finally cleanup |

Guilty-until-proven-innocent: confirmed bugs → "critical", potential → "warning", evidence of safety → "pass".

## 依赖安全

level (critical|warning|pass|na), score (0-100), issue (short Chinese or null). Start score at 70.

## 变更影响

level (high|medium|low), affectedModules (Chinese string[]), publicApiChanges (bool), dataModelChanges (bool), riskCode (short Chinese or null).`;
}

export function getOverviewRiskJsonSchema(): string {
  return `Return ONLY valid JSON, no markdown fences:
{
  "security": {
    "items": [
      {"id":"sql_injection","verdict":"pass","severity":null,"evidence":"参数化查询已使用","codeLocation":null},
      {"id":"xss","verdict":"risk","severity":"critical","evidence":"innerHTML无转义","codeLocation":{"filePath":"src/ui.ts","lineNumber":78}},
      {"id":"nosql_injection","verdict":"na","severity":null,"evidence":"无NoSQL变更","codeLocation":null},
      {"id":"command_injection","verdict":"na","severity":null,"evidence":"无exec调用","codeLocation":null},
      {"id":"hardcoded_secret","verdict":"risk","severity":"critical","evidence":"明文密钥 sk-abc123","codeLocation":{"filePath":"src/config.ts","lineNumber":12}},
      {"id":"auth_bypass","verdict":"na","severity":null,"evidence":"无认证变更","codeLocation":null},
      {"id":"path_traversal","verdict":"na","severity":null,"evidence":"无文件路径操作","codeLocation":null},
      {"id":"insecure_deserialization","verdict":"na","severity":null,"evidence":"无反序列化","codeLocation":null},
      {"id":"crypto_flaw","verdict":"na","severity":null,"evidence":"无加密变更","codeLocation":null},
      {"id":"info_leak","verdict":"na","severity":null,"evidence":"无敏感信息输出","codeLocation":null}
    ]
  },
  "correctness": {
    "items": [
      {"id":"logic_error","verdict":"pass","severity":null,"evidence":"条件逻辑正确","codeLocation":null},
      {"id":"race_condition","verdict":"na","severity":null,"evidence":"无并发操作","codeLocation":null},
      {"id":"null_safety","verdict":"risk","severity":"warning","evidence":"user可能null未检查","codeLocation":{"filePath":"src/service.ts","lineNumber":33}},
      {"id":"boundary_handling","verdict":"pass","severity":null,"evidence":"数组非空检查已做","codeLocation":null},
      {"id":"api_misuse","verdict":"pass","severity":null,"evidence":"API使用正确","codeLocation":null},
      {"id":"state_inconsistency","verdict":"na","severity":null,"evidence":"无状态管理变更","codeLocation":null},
      {"id":"error_handling","verdict":"pass","severity":null,"evidence":"try-catch已覆盖","codeLocation":null}
    ]
  },
  "dependency": {"level":"pass","score":70,"issue":null},
  "impact": {"level":"low","modules":[],"publicApiChanges":false,"dataModelChanges":false,"riskCode":null}
}`;
}

export function getOverviewRiskUserPrompt(diffText: string): string {
  return `Audit the Git Diff below. Assess all 10 security + 7 correctness items individually. Check dependency changes and overall impact. ALL evidence in Chinese.

CRITICAL: For each security item, find POSITIVE evidence of controls to mark "pass". No visible control → "risk".

--- GIT DIFF START ---
${diffText}
--- GIT DIFF END ---`;
}

export function getOverviewQualitySystemPrompt(): string {
  return `You are a Senior Software Architect evaluating code QUALITY. ALL highlights and suggestions MUST be in Chinese. Only file paths may remain in English.

## 工程维度 (5 dimensions)

Each returns: score (0-100), highlights (Chinese string[]), suggestions (Chinese string[]).
Start score at 70 (neutral). Provide evidence for every deviation.

| Dimension | Focus |
|-----------|-------|
| maintainability | Readability, naming, function length, DRY, magic numbers, comments |
| architecture | Module coupling, separation of concerns, dependency direction, abstractions |
| performance | Sync I/O in hot paths, N+1 queries, memory allocations, loop efficiency |
| robustness | Error handling coverage, input validation, graceful degradation, retry logic |
| testQuality | Test presence, assertion quality, edge case coverage, testability of new code |

Trivial changes (config/docs/formatting only) → score 70 for all.

## 变更影响

level (high|medium|low), affectedModules (Chinese string[]), publicApiChanges (bool), dataModelChanges (bool), riskCode (short Chinese or null).`;
}

export function getOverviewQualityJsonSchema(): string {
  return `Return ONLY valid JSON, no markdown fences:
{
  "maintainability": {"score":70,"highlights":["函数命名清晰"],"suggestions":[]},
  "architecture": {"score":70,"highlights":[],"suggestions":[]},
  "performance": {"score":70,"highlights":[],"suggestions":[]},
  "robustness": {"score":70,"highlights":[],"suggestions":[]},
  "testQuality": {"score":70,"highlights":[],"suggestions":[]},
  "impact": {"level":"low","modules":[],"publicApiChanges":false,"dataModelChanges":false,"riskCode":null}
}`;
}

export function getOverviewQualityUserPrompt(diffText: string): string {
  return `Evaluate code QUALITY of the Git Diff below. Assess all 5 engineering dimensions and overall impact. ALL text in Chinese.

--- GIT DIFF START ---
${diffText}
--- GIT DIFF END ---`;
}

// ==========================================
// Section 8: Phase 3 Risk Code Location (Overview)
// ==========================================

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
