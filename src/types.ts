export type AiModel = 'deepseek' | 'gemini';

export interface ReviewScore {
  security: number;
  readability: number;
  performance: number;
  robustness: number;
}

export interface ReviewComment {
  id: string;
  filePath: string;
  lineNumber: number;
  originalContent: string;
  description: string;
  suggestion: string; // HTML/Markdown formatted code optimization suggestion
  severity: 'high' | 'medium' | 'low';
}

export interface FetchError {
  type: 'network' | 'auth' | 'not_found' | 'other';
  message: string;
  details?: string;
}

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

export interface PrReviewResult {
  summary: string;
  badge: string;
  scores: ReviewScore;
  overallScore: number;
  keyFindings: string[];
  comments: ReviewComment[];
  diff: string; // The original public or pasted patch/diff
  fetchError?: FetchError;
  metadata?: PrMetadata;
  codeBlocks?: CodeBlock[];
  semantics?: PrSemantics;
}
