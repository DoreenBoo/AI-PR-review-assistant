# PR 智能解析功能设计

## 一、目标

基于清洗后的 Diff 内容，实现 PR 变更的深度结构化解析：

1. **PR 元数据提取**：自动获取 PR 标题、描述、作者、创建时间、关联 Issue
2. **代码块边界检测**：正则匹配识别函数/类/接口声明
3. **业务语义提取**：利用 Gemini 输出变更意图、影响范围、风险等级
4. **前端可视化**：元数据面板 + Diff 代码块标记

## 二、技术决策

| 决策点           | 选择               | 理由                                                     |
| ------------- | ---------------- | ------------------------------------------------------ |
| 代码结构分析        | 正则模式匹配           | 轻量无额外依赖，覆盖 JS/TS 常见模式                                  |
| GitHub API 认证 | 可选 GITHUB\_TOKEN | 有 Token 提速率，无 Token 也能跑公开仓库                            |
| 架构集成          | 增强主端点 + 独立辅助端点   | `/api/review` 内嵌元数据/代码块/语义；独立 `/api/pr/metadata` 供按需调用 |
| 前端范围          | 元数据面板 + 代码块标记    | 变更拓扑图后续迭代                                              |

## 三、架构

```
现有流程:
  前端 ──POST /api/review──▶ 后端 ──GitHub diff API──▶ 清洗 ──▶ Gemini 审计 ──▶ 返回

新增模块:
  ┌─ POST /api/pr/metadata ─▶ GitHub REST API ──▶ 返回 PR 标题/描述/作者/Issue
  │
  └─ 嵌入 /api/review 流程:
       ① diff 获取 → ② 清洗 → ③ 正则代码块检测 → ④ Gemini 审计+语义提取
       └─────────────── 新增步骤 ───────────────┘
       
  前端新增:
  ├─ MetadataPanel 组件（PR 标题/作者/关联 Issue）
  └─ Diff 行渲染增加函数/类边界标记
```

## 四、类型定义

### 新增类型（types.ts）

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

### PrReviewResult 扩展（追加字段，不删除原有）

```typescript
export interface PrReviewResult {
  // ... 原有字段不变 ...
  metadata?: PrMetadata;
  codeBlocks?: CodeBlock[];
  semantics?: PrSemantics;
}
```

## 五、模块实现

### 5.1 PR 元数据提取

**函数**: `fetchPrMetadata(owner, repo, pullNumber)` → `PrMetadata`

- 调用 `https://api.github.com/repos/{owner}/{repo}/pulls/{pullNumber}`
- 可选 Bearer Token（`GITHUB_TOKEN` 环境变量）
- 从 PR body 中正则提取 `#issueNumber` 作为关联 Issue
- 超时 10 秒，失败不阻塞

**新端点**: `POST /api/pr/metadata`

```typescript
app.post("/api/pr/metadata", async (req, res) => {
  const url = req.body.githubUrl || req.body.url;
  const parsed = parseGithubPr(url);
  if (!parsed) return res.status(400).json({ error: "Invalid PR URL" });
  try {
    const metadata = await fetchPrMetadata(parsed.owner, parsed.repo, parsed.pullNumber);
    return res.json(metadata);
  } catch (e: any) {
    return res.status(500).json({ error: "Failed to fetch PR metadata", details: e.message });
  }
});
```

**集成到 /api/review**: diff 获取成功后并行拉取（catch 静默忽略），不阻塞审计主流程。

### 5.2 代码块边界检测

**函数**: `detectCodeBlocks(diffText)` → `CodeBlock[]`

正则匹配模式：

- `function foo()` / `async function foo()`
- 类方法简写 `foo() {`
- 箭头函数 `const foo = () =>`
- `class Foo` / `interface Foo`
- `export default/const/function Foo`

遍历策略：仅扫描 `+` 行，通过 `@@` hunk 头维护 `newLineNum`，同文件同行号去重。

### 5.3 业务语义提取

在 Gemini 审计 prompt 的 responseSchema 中追加三个字段，一次调用同时返回：

```typescript
businessIntent: { type: Type.STRING, description: "中文变更意图" },
impactScope: { type: Type.ARRAY, items: Type.STRING, description: "影响范围列表" },
riskLevel: { type: Type.STRING, description: "low | medium | high" },
```

`normalizeReviewResult` 中提取并挂到 `semantics` 字段。

## 六、前端组件

### 6.1 MetadataPanel

- 展示于审计结果上方
- 仅在有 `metadata` 时渲染，无则静默隐藏
- 显示：PR 编号、标题、作者、日期、关联 Issue、风险等级、影响范围
- 风险等级颜色：high=红、medium=黄、low=绿

### 6.2 代码块边界标记

在 diff 行渲染中，命中 `codeBlocks` 时追加小标记：

- `ƒ 函数名`（蓝色，function）
- `C 类名`（蓝色，class）
- `I 接口名`（蓝色，interface）

## 七、修改文件清单

| 文件             | 修改内容                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------- |
| `src/types.ts` | 新增 PrMetadata, CodeBlock, PrSemantics；PrReviewResult 追加可选字段                              |
| `server.ts`    | 新增 fetchPrMetadata(), detectCodeBlocks(), POST /api/pr/metadata；/api/review 内嵌元数据+代码块+语义 |
| `src/App.tsx`  | 新增 MetadataPanel 渲染区；diff 行渲染增加代码块标记                                                     |
| `.env.example` | 追加 GITHUB\_TOKEN 说明                                                                      |

无需新增文件，全部在现有文件中扩展。

## 八、容错设计

- GitHub API 失败 → 元数据为 null，不影响审计结果展示
- 正则匹配无命中 → codeBlocks 为空数组
- Gemini 未输出语义字段 → normalizeReviewResult 提供默认值
- 所有新增功能为可选叠加，不影响现有核心审计流程

