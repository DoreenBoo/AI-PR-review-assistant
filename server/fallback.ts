import {
  SecurityAudit, CorrectnessAudit, DependencyAudit,
  EngineeringScore, ChangeImpact,
  SecurityVulnerability, CorrectnessConcern, RiskItem
} from "../src/types";

function getFilePaths(diffText: string): string[] {
  const lines = diffText.split('\n');
  const paths: string[] = [];
  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      const p = line.slice(6);
      if (p && p !== '/dev/null') paths.push(p);
    }
  }
  return paths;
}

function getAddedLines(diffText: string): string[] {
  return diffText.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
}

function getRemovedLines(diffText: string): string[] {
  return diffText.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---'));
}

function isBusinessCode(paths: string[]): boolean {
  const nonBusiness = new Set([
    '.json', '.md', '.txt', '.csv', '.yaml', '.yml', '.toml', '.lock',
    '.css', '.scss', '.less', '.svg', '.png', '.jpg', '.gif', '.ico',
    '.gitignore', '.dockerignore', '.editorconfig', '.eslintrc', '.prettierrc',
    'README', 'LICENSE', 'CHANGELOG', 'Dockerfile', 'docker-compose',
  ]);
  for (const p of paths) {
    const lower = p.toLowerCase();
    if (nonBusiness.has(lower)) continue;
    const ext = lower.substring(lower.lastIndexOf('.'));
    if (ext && nonBusiness.has(ext)) continue;
    return true;
  }
  return false;
}

function makeSecurityItems(): RiskItem[] {
  return [
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
}

function updateItem(items: RiskItem[], id: string, severity: 'critical' | 'warning', evidence: string) {
  const item = items.find(i => i.id === id);
  if (item) {
    item.verdict = 'risk';
    item.severity = severity;
    item.evidence = evidence;
  }
}

function calculateFallbackScore(items: RiskItem[]): number {
  let score = 70;
  for (const item of items) {
    if (item.verdict === 'risk') {
      if (item.severity === 'critical') score -= 25;
      else score -= 10;
    }
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function itemLevel(score: number): 'critical' | 'warning' | 'pass' {
  if (score < 40) return 'critical';
  if (score < 65) return 'warning';
  return 'pass';
}

export function inferSecurityFromDiff(diffText: string): SecurityAudit {
  const paths = getFilePaths(diffText);
  if (!isBusinessCode(paths) || diffText.trim().length === 0) {
    const items = makeSecurityItems();
    return { level: 'na', score: 100, items, vulnerabilities: [], traces: [], _inferred: true, _source: 'local' };
  }

  const vulnerabilities: SecurityVulnerability[] = [];
  const items = makeSecurityItems();
  const lines = diffText.split('\n');
  let currentFile = '';
  let currentLineNum = 0;
  let contextLines: string[] = [];

  const highRiskPatterns: { pattern: RegExp; itemId: string; category: SecurityVulnerability['category'] }[] = [
    { pattern: /\.executeRaw\s*\(/i, itemId: 'sql_injection', category: 'sql_injection' },
    { pattern: /\bexec\s*\(\s*['"`]/i, itemId: 'sql_injection', category: 'sql_injection' },
    { pattern: /\$\{.*(?:username|password|query|sql|table)\}/i, itemId: 'sql_injection', category: 'sql_injection' },
    { pattern: /password\s*[=:]\s*['"`][^'"`]{3,}['"`](?!\s*[,;\)]?\s*(?:from|import|require))/i, itemId: 'hardcoded_secret', category: 'hardcoded_secret' },
    { pattern: /api[_-]?key\s*[=:]\s*['"`][^'"`]{8,}['"`]/i, itemId: 'hardcoded_secret', category: 'hardcoded_secret' },
    { pattern: /secret\s*[=:]\s*['"`][^'"`]{4,}['"`]/i, itemId: 'hardcoded_secret', category: 'hardcoded_secret' },
    { pattern: /token\s*[=:]\s*['"`][^'"`]{8,}['"`]/i, itemId: 'hardcoded_secret', category: 'hardcoded_secret' },
    { pattern: /access[_-]?key\s*[=:]\s*['"`][^'"`]{8,}['"`]/i, itemId: 'hardcoded_secret', category: 'hardcoded_secret' },
    { pattern: /jwt\.sign\s*\(\s*[^,)]*,\s*['"`][^'"`]{4,}['"`]/i, itemId: 'hardcoded_secret', category: 'hardcoded_secret' },
    { pattern: /\.innerHTML\s*=/i, itemId: 'xss', category: 'xss' },
    { pattern: /dangerouslySetInnerHTML/i, itemId: 'xss', category: 'xss' },
    { pattern: /document\.write\s*\(/i, itemId: 'xss', category: 'xss' },
    { pattern: /eval\s*\(/i, itemId: 'insecure_deserialization', category: 'xss' },
    { pattern: /\bFunction\s*\(/i, itemId: 'insecure_deserialization', category: 'xss' },
    { pattern: /new\s+Function\s*\(/i, itemId: 'insecure_deserialization', category: 'xss' },
    { pattern: /\$where\s*:/, itemId: 'nosql_injection', category: 'nosql_injection' },
    { pattern: /\$regex\s*:/, itemId: 'nosql_injection', category: 'nosql_injection' },
  ];

  const mediumRiskPatterns: { pattern: RegExp; itemId: string; category: SecurityVulnerability['category'] }[] = [
    { pattern: /console\.(?:log|debug|info)\([^)]*(?:password|secret|token|key|credential)/i, itemId: 'info_leak', category: 'info_leak' },
    { pattern: /md5\s*\(/i, itemId: 'crypto_flaw', category: 'crypto_flaw' },
    { pattern: /sha1\s*\(/i, itemId: 'crypto_flaw', category: 'crypto_flaw' },
    { pattern: /MD5\s*\.?/i, itemId: 'crypto_flaw', category: 'crypto_flaw' },
    { pattern: /\.createHash\s*\(\s*['"`](?:md5|sha1)['"`]\s*\)/i, itemId: 'crypto_flaw', category: 'crypto_flaw' },
  ];

  for (const line of lines) {
    if (line.startsWith('diff --git ') || line.startsWith('+++ b/')) {
      const match = line.match(/b\/(.+)$/);
      currentFile = match ? match[1] : '';
      currentLineNum = 0;
      contextLines = [];
      continue;
    }
    if (line.startsWith('@@ -')) {
      const match = line.match(/\+(\d+)/);
      currentLineNum = match ? parseInt(match[1], 10) - 1 : 0;
      continue;
    }
    if (line.startsWith(' ') || line.startsWith('-')) {
      if (line.startsWith(' ')) currentLineNum++;
      contextLines.push(line);
      if (contextLines.length > 5) contextLines.shift();
      continue;
    }
    if (line.startsWith('+')) {
      currentLineNum++;
      const contentWithoutPrefix = line.slice(1);
      contextLines.push(contentWithoutPrefix);
      if (contextLines.length > 5) contextLines.shift();

      for (const { pattern, itemId, category } of highRiskPatterns) {
        if (pattern.test(line) || pattern.test(contentWithoutPrefix)) {
          const sev = (category === 'sql_injection' || category === 'hardcoded_secret') ? 'critical' as const : 'critical' as const;
          updateItem(items, itemId, sev, `本地检测: ${getChineseDescription(category)}`);
          vulnerabilities.push({
            category,
            description: getChineseDescription(category),
            filePath: currentFile,
            lineNumber: currentLineNum,
            severity: (category === 'sql_injection' || category === 'hardcoded_secret') ? 'high' : 'medium',
          });
          break;
        }
      }

      for (const { pattern, itemId, category } of mediumRiskPatterns) {
        if ((pattern.test(line) || pattern.test(contentWithoutPrefix)) &&
            !vulnerabilities.some(v => v.filePath === currentFile && v.lineNumber === currentLineNum)) {
          updateItem(items, itemId, 'warning', `本地检测: ${getChineseDescription(category)}`);
          vulnerabilities.push({
            category,
            description: getChineseDescription(category),
            filePath: currentFile,
            lineNumber: currentLineNum,
            severity: 'low',
          });
          break;
        }
      }

      const ctx = contextLines.join(' ');
      if ((line.includes('exec(') || line.includes('spawn(')) && (line.includes('req.') || line.includes('${'))) {
        updateItem(items, 'command_injection', 'critical', `本地检测: 可能的命令注入 - ${contentWithoutPrefix.trim()}`);
      }
      if (line.includes('path.join') && (ctx.includes('req.') || ctx.includes('params') || ctx.includes('query'))) {
        updateItem(items, 'path_traversal', 'warning', `本地检测: 用户输入参与文件路径操作 - ${contentWithoutPrefix.trim()}`);
      }
      if (line.includes('fs.readFile') && (ctx.includes('req.') || ctx.includes('params') || ctx.includes('query'))) {
        updateItem(items, 'path_traversal', 'warning', `本地检测: 用户输入参与文件读取 - ${contentWithoutPrefix.trim()}`);
      }
      if (line.includes('JSON.parse') && (ctx.includes('req.body') || ctx.includes('req.params') || ctx.includes('req.query'))) {
        updateItem(items, 'insecure_deserialization', 'warning', `本地检测: 不可信数据反序列化 - ${contentWithoutPrefix.trim()}`);
      }
    }
  }

  const score = calculateFallbackScore(items);
  const level = itemLevel(score);

  return { level, score, items, vulnerabilities, traces: [], _inferred: true, _source: 'local' };
}

export function inferCorrectnessFromDiff(diffText: string): CorrectnessAudit {
  const lines = diffText.split('\n');
  const concerns: CorrectnessConcern[] = [];
  const items: RiskItem[] = [
    { id: 'logic_error', verdict: 'na', severity: null, evidence: '未检测到逻辑错误' },
    { id: 'race_condition', verdict: 'na', severity: null, evidence: '未检测到竞态条件' },
    { id: 'null_safety', verdict: 'na', severity: null, evidence: '未检测到空安全问题' },
    { id: 'boundary_handling', verdict: 'na', severity: null, evidence: '未检测到边界问题' },
    { id: 'api_misuse', verdict: 'na', severity: null, evidence: '未检测到API误用' },
    { id: 'state_inconsistency', verdict: 'na', severity: null, evidence: '未检测到状态不一致' },
    { id: 'error_handling', verdict: 'na', severity: null, evidence: '未检测到错误处理缺陷' },
  ];
  let currentFile = '';
  let currentLineNum = 0;

  const removedReturnIndices: { file: string; line: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('diff --git ')) {
      if (currentFile && removedReturnIndices.length > 0) {
        for (const ri of removedReturnIndices) {
          concerns.push({
            type: 'logic_error',
            description: '删除了return语句，可能导致函数缺少返回值或返回值改变',
            filePath: ri.file,
            lineNumber: ri.line,
          });
        }
        updateItem(items, 'logic_error', 'warning', '删除了return语句');
        removedReturnIndices.length = 0;
      }
      const match = line.match(/b\/(.+)$/);
      currentFile = match ? match[1] : '';
      currentLineNum = 0;
      removedReturnIndices.length = 0;
      continue;
    }
    if (line.startsWith('@@ -')) {
      const match = line.match(/\+(\d+)/);
      currentLineNum = match ? parseInt(match[1], 10) - 1 : 0;
      continue;
    }
    if (line.startsWith(' ')) {
      currentLineNum++;
      continue;
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      if (/\breturn\b/.test(line.slice(1))) {
        removedReturnIndices.push({ file: currentFile, line: currentLineNum });
      }
      continue;
    }

    if (line.startsWith('+')) {
      currentLineNum++;
      const content = line.slice(1);

      if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(content) ||
          (/\bcatch\b/.test(content) && /\{\s*\}/.test(content))) {
        concerns.push({
          type: 'null_safety',
          description: '空的catch块吞没了异常，缺少错误处理逻辑',
          filePath: currentFile,
          lineNumber: currentLineNum,
        });
        updateItem(items, 'error_handling', 'warning', '空的catch块吞没异常');
      }

      if (/(?:parseInt|parseFloat|Number)\s*\([^)]*\)\s*(?!.*(?:isNaN|Number\.isNaN|!isNaN|isFinite|===|!==))/.test(content)) {
        if (/(?:parseInt|parseFloat)\s*\([^)]*\)/.test(content)) {
          concerns.push({
            type: 'boundary_gap',
            description: 'parseInt/parseFloat 未进行 NaN 检查，可能导致运行时产生 NaN 值',
            filePath: currentFile,
            lineNumber: currentLineNum,
          });
          updateItem(items, 'boundary_handling', 'warning', 'parseInt/parseFloat未进行NaN检查');
        }
      }
    }
  }

  if (currentFile && removedReturnIndices.length > 0) {
    for (const ri of removedReturnIndices) {
      concerns.push({
        type: 'logic_error',
        description: '删除了return语句，可能导致函数缺少返回值或返回值改变',
        filePath: ri.file,
        lineNumber: ri.line,
      });
    }
    updateItem(items, 'logic_error', 'warning', '删除了return语句');
    removedReturnIndices.length = 0;
  }

  const score = calculateFallbackScore(items);
  const level = itemLevel(score);

  return { level, score, items, concerns, _inferred: true, _source: 'local' };
}

export function inferDependencyFromDiff(diffText: string): DependencyAudit {
  const paths = getFilePaths(diffText);
  const depManifests = ['package.json', 'go.mod', 'requirements.txt', 'Cargo.toml', 'pom.xml', 'build.gradle', 'Gemfile', 'composer.json'];
  const hasDepManifest = paths.some(p => depManifests.some(dm => p.endsWith(dm)));

  if (!hasDepManifest) {
    return { level: 'na', score: 100, outdatedDeps: [], licenseIssues: [], _inferred: true };
  }

  const addedLines = getAddedLines(diffText);
  const preReleasePattern = /["']\s*[~^]?(?:0\.\d+\.\d+[-.](?:alpha|beta|rc|pre|dev|canary|next|nightly)|\d+\.\d+\.\d+[-.](?:alpha|beta|rc|pre|dev|canary|next|nightly))/i;

  for (const line of addedLines) {
    if (preReleasePattern.test(line)) {
      return {
        level: 'warning',
        score: 55,
        outdatedDeps: [{ name: '依赖版本包含预发布标识', currentVersion: 'pre-release', risk: '预发布版本(alpha/beta/rc)可能包含未修复的Bug或安全漏洞' }],
        licenseIssues: [],
        _inferred: true,
      };
    }
  }

  return { level: 'pass', score: 75, outdatedDeps: [], licenseIssues: [], _inferred: true };
}

export function inferMaintainabilityFromDiff(diffText: string): EngineeringScore {
  const addedLines = getAddedLines(diffText);
  const lines = diffText.split('\n');
  const highlights: string[] = [];
  const suggestions: string[] = [];
  let penalties = 0;

  const funcPatterns = [
    /^\+\s*(?:export\s+)?(?:async\s+)?function\s+\w+/,
    /^\+\s*(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/,
    /^\+\s*(?:export\s+)?(?:static\s+)?(?:async\s+)?\w+\s*\([^)]*\)\s*\{/,
  ];
  let newFuncCount = 0;
  for (const line of addedLines) {
    for (const pat of funcPatterns) {
      if (pat.test(line)) {
        newFuncCount++;
        break;
      }
    }
  }
  if (newFuncCount > 3) {
    penalties += 15;
    suggestions.push(`新增 ${newFuncCount} 个函数定义，建议拆分到多个模块以保持单一职责`);
  }

  let magicCount = 0;
  const magicExclude = new Set(['0', '1', '-1', '2', '10', '100', '1000', 'true', 'false', 'null', 'undefined']);
  for (const line of addedLines) {
    const matches = line.match(/\b(?<!['"`])\d+(?:\,\d{3})*(?:\x2e\d+)?(?!['"`])/g);
    if (matches) {
      for (const m of matches) {
        if (!magicExclude.has(m)) magicCount++;
      }
    }
  }
  if (magicCount > 5) {
    penalties += magicCount > 5 ? (magicCount - 5) * 3 : 0;
    if (magicCount > 5) {
      suggestions.push(`发现 ${magicCount} 个疑似魔法数字，建议提取为命名常量`);
    }
  }

  let deepIndentCount = 0;
  for (const line of addedLines) {
    const indent = line.match(/^\+\s*/)?.[0].length ?? 0;
    if (indent > 16) {
      deepIndentCount++;
    }
  }
  if (deepIndentCount > 10) {
    penalties += 15;
    suggestions.push('代码深层嵌套过多(>4层)，建议提取子函数或使用早返回模式');
  }

  const score = Math.max(30, 100 - penalties);
  if (score >= 85) highlights.push('代码结构清晰，可维护性良好');

  return { score, highlights, suggestions, _inferred: true };
}

export function inferArchitectureFromDiff(diffText: string): EngineeringScore {
  const paths = getFilePaths(diffText);
  const lines = diffText.split('\n');
  const highlights: string[] = [];
  const suggestions: string[] = [];

  const uniqueFiles = [...new Set(paths)];
  let importCount = 0;
  for (const line of lines) {
    if (line.startsWith('+') && /\bimport\b/.test(line)) {
      importCount++;
    }
  }

  if (uniqueFiles.length > 3 && importCount > 5) {
    suggestions.push(`变更涉及 ${uniqueFiles.length} 个文件与 ${importCount} 处导入，建议确认模块间耦合度是否可控`);
    return { score: 65, highlights, suggestions, _inferred: true };
  }

  highlights.push('模块边界清晰，架构变更风险较低');
  return { score: 65, highlights, suggestions, _inferred: true };
}
export function inferPerformanceFromDiff(diffText: string): EngineeringScore {
  const addedLines = getAddedLines(diffText);
  const lines = diffText.split('\n');
  const highlights: string[] = [];
  const suggestions: string[] = [];
  let penalties = 0;

  for (const line of addedLines) {
    if (/\b(?:readFileSync|writeFileSync|existsSync|mkdirSync|rmdirSync|statSync|readdirSync)\s*\(/.test(line)) {
      penalties += 20;
      suggestions.push('检测到同步文件I/O操作，建议替换为异步版本以避免阻塞事件循环');
      break;
    }
  }

  let loopAwaitDetected = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('+') && /\b(for|while|\.forEach|\.map|for\s*\(|for\s+const|for\s+let)\b/.test(line)) {
      for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
        if (lines[j].startsWith('+') && /\bawait\b/.test(lines[j])) {
          loopAwaitDetected = true;
          break;
        }
        if (lines[j].startsWith('+') && lines[j].trim() === '+}' && j > i + 2) {
          break;
        }
      }
    }
    if (loopAwaitDetected) break;
  }
  if (loopAwaitDetected) {
    penalties += 15;
    suggestions.push('检测到循环体内部使用await，可能导致N+1查询或串行等待，建议使用Promise.all并发执行');
  }

  const score = Math.max(30, 100 - penalties);
  if (score >= 85) highlights.push('未发现明显性能问题');

  return { score, highlights, suggestions, _inferred: true };
}

export function inferRobustnessFromDiff(diffText: string): EngineeringScore {
  const addedLines = getAddedLines(diffText);
  const allContent = addedLines.map(l => l.slice(1)).join('\n');
  const highlights: string[] = [];
  const suggestions: string[] = [];

  const hasTryCatch = /\btry\s*\{/.test(allContent);
  const hasFinally = /\bfinally\s*\{/.test(allContent);
  const hasCatch = /\.catch\s*\(/.test(allContent) || /\.catch\s*\b/.test(allContent);

  const newLineCount = addedLines.length;

  if (hasTryCatch && hasFinally) {
    highlights.push('代码包含完整的 try-catch-finally 错误处理链');
    return { score: 70, highlights, suggestions, _inferred: true };
  }

  if (hasTryCatch || hasCatch) {
    if (newLineCount > 20) {
      suggestions.push('新增代码超过20行但缺少finally块，建议补充资源清理逻辑');
    }
    return { score: 55, highlights, suggestions, _inferred: true };
  }

  if (newLineCount > 20) {
    suggestions.push('新增超过20行代码但缺少try-catch或.catch()错误处理，建议补充异常处理');
  }
  return { score: 55, highlights, suggestions, _inferred: true };
}

export function inferImpactFromDiff(diffText: string, semantics: { impactScope: string[]; riskLevel: string }): ChangeImpact {
  const paths = getFilePaths(diffText);
  const lines = diffText.split('\n');

  let publicApiChanges = false;
  let dataModelChanges = false;
  const crossModuleDeps: string[] = [];
  const affectedModules: string[] = [...semantics.impactScope];

  for (const p of paths) {
    if (/\.d\.ts$/.test(p) || /\/types\//i.test(p) || /\/api\//i.test(p)) {
      publicApiChanges = true;
    }
    if (/\/schema\//i.test(p) || /\/model\//i.test(p) || /\/migration\//i.test(p) || /\.sql$/i.test(p)) {
      dataModelChanges = true;
    }
  }

  const importRegex = /^\+\s*import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"`]([^'"`]+)['"`]/;
  for (const line of lines) {
    if (line.startsWith('+')) {
      const match = line.match(importRegex);
      if (match) {
        const modulePath = match[1];
        if (modulePath && !modulePath.startsWith('.') && !crossModuleDeps.includes(modulePath)) {
          crossModuleDeps.push(modulePath);
        }
      }
    }
  }

  const level: ChangeImpact['level'] =
    semantics.riskLevel === 'high' ? 'high' :
    semantics.riskLevel === 'medium' ? 'medium' : 'low';

  return {
    level,
    publicApiChanges,
    dataModelChanges,
    crossModuleDeps,
    affectedModules,
    _inferred: true,
  };
}

export function inferTestQualityFromDiff(diffText: string): EngineeringScore {
  const paths = getFilePaths(diffText);
  const testPatterns = ['.test.', '.spec.', '__tests__', '/test/', '/tests/', '/spec/', '/__mocks__/'];
  const hasTestFiles = paths.some(p => testPatterns.some(pat => p.includes(pat)));

  if (!hasTestFiles) {
    return {
      score: 50,
      highlights: [],
      suggestions: ['本次变更未包含测试代码，建议为新功能或修复补充单元测试'],
      _inferred: true,
    };
  }

  const addedLines = getAddedLines(diffText);
  const hasAssertions = addedLines.some(l => /\b(?:expect|assert|assertThat|assertEquals|test|it|describe)\b/.test(l));
  const hasHappyPath = hasAssertions;
  const hasErrorPath = addedLines.some(l => /\b(?:catch|throw|reject|error|fail|exception)\b/i.test(l));
  const hasMockUsage = addedLines.some(l => /\b(?:mock|stub|spy|jest\.fn|vi\.fn|sinon)\b/i.test(l));

  let score = 70;
  const highlights: string[] = [];
  const suggestions: string[] = [];

  if (hasHappyPath) {
    highlights.push('测试代码包含断言逻辑');
    score += 10;
  } else {
    suggestions.push('测试代码缺少有效断言，建议补充有意义的验证');
    score -= 20;
  }

  if (!hasErrorPath) {
    suggestions.push('测试代码未覆盖异常/错误场景，建议补充边界和异常路径测试');
    score -= 15;
  }

  if (!hasMockUsage) {
    suggestions.push('考虑使用Mock隔离外部依赖，提升测试独立性');
  }

  return {
    score: Math.max(20, Math.min(100, score)),
    highlights,
    suggestions,
    _inferred: true,
  };
}

function getChineseDescription(category: SecurityVulnerability['category']): string {
  const map: Record<string, string> = {
    sql_injection: '检测到可能的SQL注入风险，字符串拼接构建查询语句',
    xss: '检测到可能的XSS/HTML注入风险',
    hardcoded_secret: '检测到硬编码的敏感凭证(密钥/密码/Token)',
    auth_bypass: '检测到可能的认证绕过风险',
    crypto_flaw: '检测到弱加密算法(MD5/SHA1)，不应用于安全场景',
    path_traversal: '检测到可能的路径遍历风险',
    idor: '检测到不安全的直接对象引用',
    unsafe_deserialization: '检测到不安全的反序列化操作',
    info_leak: '检测到可能的信息泄露(日志中输出敏感数据)',
  };
  return map[category] || '安全风险';
}
