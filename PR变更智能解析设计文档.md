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

```
async function extractBusinessSemantics(metadata, structuredDiff) {
  const prompt = `
    基于PR信息提取变更意图：
    标题：${metadata.title}
    描述：${metadata.description}
    变更文件：${structuredDiff.files.map(f => f.fileName).join(', ')}
    输出JSON格式：{ "intent": "一句话描述", "impactScope": ["影响点1", "影响点2"] }
  `;
  
  const response = await geminiClient.generateContent({
    model: "gemini-3.5-flash",
    contents: prompt,
    config: { temperature: 0.1, responseMimeType: "application/json" }
  });
  return JSON.parse(response.text);
}
```

**关键技术**：

- 上下文注入：整合元数据+结构化Diff
- 低温配置：`temperature=0.1`确保输出稳定性

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
