基于《AI-PR-Review-Assistant 业务流程实现文档》，针对**PR变更智能解析**需求的设计方案如下：

&#x20;

### 一、核心业务目标

实现PR变更的深度结构化解析，覆盖：

1. **元数据提取**：自动获取PR标题、描述、作者、创建时间等基础信息
2. **上下文关联**：智能识别关联的Issue和Commit历史
3. **代码变更拓扑**：可视化展示文件/模块级变更关系
4. **业务语义提取**：自动生成变更意图与影响范围描述

### 二、系统架构增强

在现有架构基础上新增三大核心模块：

```
graph TD
    A[前端] --> B[PR解析中间件]
    B --> C{解析引擎}
    C --> D[元数据解析]
    C --> E[代码结构分析]
    C --> F[业务语义提取]
    D --> G[GitHub API]
    E --> H[Tree-sitter AST]
    F --> I[Gemini API]
```

### 三、核心模块实现方案

#### 1. 元数据解析模块

```
interface PrMetadata {
  owner: string;
  repo: string;
  pullNumber: number;
  title: string;
  description: string;
  author: string;
  createdAt: string;
  linkedIssues: { id: string; title: string }[];
  relatedCommits: { sha: string; message: string }[];
}

async function fetchPrMetadata(prUrl: string) {
  const { owner, repo, pullNumber } = parseGithubPr(prUrl);
  const [prRes, issuesRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`),
    fetch(`https://api.github.com/repos/${owner}/${repo}/issues`)
  ]);
  
  return {
    title: prData.title,
    linkedIssues: issuesData.filter(i => prData.body.includes(`#${i.number}`))
  };
}
```

**关键技术**：

- 并行请求优化：`Promise.all`并发获取多源数据
- 智能关联：通过PR描述中的`#IssueID`自动链接Issue

#### 2. 代码结构分析模块

```
interface StructuredDiffLine {
  type: 'add' | 'delete' | 'normal';
  content: string;
  codeBlock?: { type: 'function' | 'class'; name: string };
}

function parseWithAST(code: string) {
  const tree = parser.parse(code);
  const query = new Parser.Query(`
    (function_declaration name: (identifier) @func_name)
    (class_declaration name: (identifier) @class_name)
  `);
  return query.matches(tree.rootNode);
}
```

**关键技术**：

- AST深度解析：使用Tree-sitter识别函数/类定义
- 变更映射：建立代码行与代码块的关联关系

#### 3. 业务语义提取模块

详见 [提示词工程设计文档](./docs/prompt-engineering-design.md)

**设计策略：三层防御体系**

| 层级 | 机制 | 触发条件 |
|------|------|---------|
| Layer 1 | 两阶段分析管线 + 推理链引导 | Gemini 正常可用 |
| Layer 2 | `hasEmptySemantics` 检测 + `inferSemanticsFromDiff()` | Gemini 返回空语义字段 |
| Layer 3 | 纯本地启发式推理 | Gemini 完全不可用（API Key缺失/网络断开/超时） |

**两阶段分析管线**：将 prompt 重构为 `Phase 1: 业务语义分析 → Phase 2: 代码审计` 的强制顺序执行流程。Phase 1 包含 5 步推理链（技术动作 → 业务动机 → 影响范围 → 风险评级 → 意图输出），确保语义字段在 Gemini 的注意力预算最充足时被处理。

**"软约束 + 硬兜底"**：语义字段不加入 schema `required`（避免 Gemini 推断失败时整请求报错），通过自然语言强制声明 + Schema 描述强化（【必填-Phase1】前缀、示例注入、禁止性约束）替代 schema 硬约束，空字段由 `inferSemanticsFromDiff()` 兜底。

**本地推理引擎** `inferSemanticsFromDiff()`：22 项模块关键词映射表（auth→认证模块、middleware→中间件...）、17 项风险正则模式（高危 10 + 中危 7）、基于新增/删除比例的意图推断算法（7 种意图类别），在无 Gemini 时也能生成有意义的语义。

```
async function extractBusinessSemantics(metadata, structuredDiff) {
  // 两阶段提示词: Phase1 语义 → Phase2 审计
  const systemInstruction = "PHASE 1 — BUSINESS SEMANTIC ANALYSIS...\nPHASE 2 — CODE QUALITY AUDIT...";
  const userPrompt = "PHASE 1 — First, analyze the BUSINESS CONTEXT...\nPHASE 2 — Then perform the code audit...\nCRITICAL: Phase 1 output is REQUIRED";

  const response = await geminiClient.generateContent({
    model: "gemini-3.5-flash",
    contents: userPrompt,
    config: {
      systemInstruction,
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: { /* 语义字段排首位 + 【必填-Phase1】描述 */ },
    }
  });

  // 空字段自动回退到本地推理
  const parsed = JSON.parse(response.text);
  if (!parsed.businessIntent || !parsed.impactScope?.length) {
    return inferSemanticsFromDiff(targetDiff, codeBlocks);
  }
  return { intent: parsed.businessIntent, impactScope: parsed.impactScope, riskLevel: parsed.riskLevel };
}
```

**关键技术**：

- 上下文注入：整合元数据 + 结构化Diff
- 低温配置：`temperature=0.1`确保输出稳定性
- 双层锚定：SystemInstruction (how) + UserPrompt (what) 语义一致、结构对应
- 零依赖代理：`undici` ProxyAgent 全局拦截 fetch 支持 HTTPS_PROXY 环境变量

### 四、前端交互增强

新增三大可视化组件：

1. **元数据面板**：展示PR基础信息+关联上下文
2. **变更拓扑图**：使用Force Graph可视化文件依赖关系
3. **智能代码块标识**：在Diff视图中标记函数/类边界

```
<PrMetadataPanel 
  title={metadata.title}
  issues={metadata.linkedIssues}
/>

<ChangeTopologyGraph 
  nodes={structuredDiff.files.map(f => ({ id: f.fileName }))}
  links={detectedDependencies}
/>
```

### 五、业务流程全链路

```
sequenceDiagram
    participant Frontend
    participant Backend
    participant GitHub
    participant Gemini
    
    Frontend->>Backend: 提交PR URL
    Backend->>GitHub: 请求元数据+Diff
    GitHub-->>Backend: 返回原始数据
    Backend->>Backend: 结构化解析Diff
    Backend->>Gemini: 请求语义提取
    Gemini-->>Backend: 返回业务语义
    Backend-->>Frontend: 返回完整解析结果
```

### 六、非功能保障

维度

保障措施

**性能**​

Diff>50KB自动截断，AST解析仅处理新增代码

**准确性**​

行号对齐校验+Gemini输出JSON Schema校验

**扩展性**​

支持动态加载Tree-sitter语言包

**安全**​

GitHub Token环境变量存储+请求频率限制

### 七、部署方案

1. **开发环境**：`npm run dev`启动Vite开发服务器
2. **生产部署**：
   ```
   npm run build  # 构建前端+编译后端
   npm start      # 启动Node服务
   ```
3. **监控**：Prometheus采集`pr_parse_duration_seconds`指标

该方案完全兼容现有MVP架构，新增模块通过函数封装实现，无需重构核心流程，前端通过组件化扩展可视化能力。
