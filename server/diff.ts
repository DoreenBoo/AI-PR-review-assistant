export function decodeGitOctalEscapes(diffText: string): string {
  return diffText.replace(
    /"([^"]*\\[0-7]{3}[^"]*)"/g,
    (match) => {
      const inner = match.slice(1, -1);
      const bytes: number[] = [];
      let i = 0;
      while (i < inner.length) {
        if (inner[i] === '\\' && /^[0-7]{3}$/.test(inner.slice(i + 1, i + 4))) {
          bytes.push(parseInt(inner.slice(i + 1, i + 4), 8));
          i += 4;
        } else {
          bytes.push(inner.charCodeAt(i));
          i++;
        }
      }
      const decoder = new TextDecoder('utf-8');
      return '"' + decoder.decode(new Uint8Array(bytes)) + '"';
    }
  );
}

export function detectCodeBlocks(diffText: string): {
  type: 'function' | 'class' | 'interface' | 'export';
  name: string;
  filePath: string;
  lineNumber: number;
}[] {
  const blocks: {
    type: 'function' | 'class' | 'interface' | 'export';
    name: string;
    filePath: string;
    lineNumber: number;
  }[] = [];
  const lines = diffText.split('\n');
  let currentFile = '';
  let newLineNum = 0;

  const patterns: { type: 'function' | 'class' | 'interface' | 'export'; regex: RegExp }[] = [
    { type: 'function',  regex: /^\+\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/ },
    { type: 'function',  regex: /^\+\s*(?:export\s+)?(?:static\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{?\s*$/ },
    { type: 'function',  regex: /^\+\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/ },
    { type: 'class',     regex: /^\+\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/ },
    { type: 'interface', regex: /^\+\s*(?:export\s+)?interface\s+(\w+)/ },
    { type: 'export',    regex: /^\+\s*export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/ },
  ];

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/b\/(.+)$/);
      currentFile = match ? match[1] : '';
      newLineNum = 0;
      continue;
    }

    if (line.startsWith('@@ -')) {
      const match = line.match(/\+(\d+)/);
      newLineNum = match ? parseInt(match[1], 10) - 1 : 0;
      continue;
    }

    if (!currentFile) continue;

    if (line.startsWith('+')) {
      newLineNum++;
      for (const p of patterns) {
        const match = line.match(p.regex);
        if (match) {
          const dup = blocks.find(b => b.filePath === currentFile && b.lineNumber === newLineNum);
          if (!dup) {
            blocks.push({ type: p.type, name: match[1], filePath: currentFile, lineNumber: newLineNum });
            break;
          }
        }
      }
    } else if (line.startsWith(' ')) {
      newLineNum++;
    }
  }

  return blocks;
}

export function inferSemanticsFromDiff(diffText: string, codeBlocks: ReturnType<typeof detectCodeBlocks>): {
  intent: string;
  impactScope: string[];
  riskLevel: 'low' | 'medium' | 'high';
} {
  const lines = diffText.split('\n');

  const filePaths: string[] = [];
  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      const p = line.slice(6);
      if (p && p !== '/dev/null') filePaths.push(p);
    } else if (line.startsWith('--- a/')) {
      const p = line.slice(6);
      if (p && p !== '/dev/null' && !filePaths.includes(p)) filePaths.push(p);
    }
  }

  const dirNames = [...new Set(filePaths.map(p => {
    const parts = p.split('/');
    if (parts.length >= 3) return parts.slice(1, 3).join('/');
    if (parts.length >= 2) return parts[0];
    return p.replace(/\.[^.]+$/, '');
  }))];

  const moduleKeywords: Record<string, string> = {
    'auth': '认证模块',
    'login': '登录模块',
    'user': '用户模块',
    'api': 'API接口',
    'db': '数据库',
    'database': '数据库',
    'config': '系统配置',
    'router': '路由层',
    'middleware': '中间件',
    'component': '前端组件',
    'util': '工具函数',
    'test': '测试模块',
    'ci': 'CI/CD流水线',
    'docker': '容器部署',
    'package': '依赖管理',
    'migration': '数据迁移',
    'schema': '数据模型',
    'validator': '校验层',
    'service': '业务服务层',
    'controller': '控制器层',
    'model': '数据模型层',
  };

  const impactScope: string[] = [];
  for (const dir of dirNames) {
    for (const [key, label] of Object.entries(moduleKeywords)) {
      if (dir.toLowerCase().includes(key) && !impactScope.includes(label)) {
        impactScope.push(label);
      }
    }
  }
  if (impactScope.length === 0 && filePaths.length > 0) {
    const sample = filePaths[0].split('/');
    if (sample.length >= 2) impactScope.push(sample[0]);
    else impactScope.push(filePaths[0].replace(/\.[^.]+$/, ''));
  }

  const addedCount = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
  const removedCount = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;

  let riskLevel: 'low' | 'medium' | 'high' = 'low';

  const highRiskPatterns = [
    /\.executeRaw\s*\(/i, /\bexec\s*\(\s*['"]/i,
    /password\s*[=:]\s*['"][^'"]+['"](?!\s*$)/i,
    /api[_-]?key\s*[=:]\s*['"][^'"]+['"]/i,
    /secret\s*[=:]\s*['"][^'"]+['"]/i,
    /token\s*[=:]\s*['"][^'"]+['"]/i,
    /jwt\.sign\s*\([^)]*['"][^'"]+['"]/i,
    /innerHTML\s*=/i, /dangerouslySetInnerHTML/i,
    /eval\s*\(/i, /Function\s*\(/i,
    /\$\{.*(?:username|password|query|sql)\}/i,
  ];

  const mediumRiskPatterns = [
    /setInterval\s*\(/, /setTimeout\s*\(/,
    /new\s+Promise\s*\(/, /async\s+function/,
    /delete\s+\w+\.\w+/, /\.remove\(\)/,
    /TODO|FIXME|HACK|XXX/,
    /\.catch\s*\(/, /throw\s+new\s+Error/,
  ];

  for (const line of lines) {
    if (line.startsWith('+')) {
      for (const pattern of highRiskPatterns) {
        if (pattern.test(line)) {
          riskLevel = 'high';
          break;
        }
      }
      if (riskLevel === 'high') break;

      for (const pattern of mediumRiskPatterns) {
        if (pattern.test(line)) {
          riskLevel = 'medium';
        }
      }
    }
  }

  const newFiles = filePaths.filter(p => !lines.some(l => l.startsWith('--- a/' + p)));
  const deletedFiles = lines.filter(l => l.startsWith('--- a/') && lines.some(l2 => l2.startsWith('+++ b//dev/null'))).length;

  let intent = '';
  if (deletedFiles > 0 && addedCount < 3) {
    intent = '清理项目中的废弃代码和文件';
  } else if (newFiles.length > 0 && removedCount < 3) {
    intent = `新增${newFiles.length > 1 ? '多' : ''}个功能模块`;
  } else if (riskLevel === 'high') {
    intent = '代码变更中存在安全风险项，建议重点审查';
  } else if (codeBlocks.length > 0) {
    intent = `更新${codeBlocks.length}处代码逻辑`;
  } else if (addedCount > removedCount * 2) {
    intent = '扩展功能实现，新增业务逻辑';
  } else if (removedCount > addedCount * 2) {
    intent = '精简代码结构，移除冗余逻辑';
  } else {
    intent = '常规代码变更与优化';
  }

  return { intent, impactScope, riskLevel };
}
