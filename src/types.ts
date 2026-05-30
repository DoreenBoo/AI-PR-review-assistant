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

// ==========================================
// Multidimensional Assessment Types (v2.0)
// ==========================================

export type AuditLevel = 'critical' | 'warning' | 'pass' | 'na';

export type OverallLevel = 'block' | 'review' | 'approve';

export interface SecurityVulnerability {
  category: string;
  description: string;
  filePath: string;
  lineNumber: number;
  severity: 'high' | 'medium' | 'low';
}

export interface SecurityAudit {
  level: AuditLevel;
  score: number;
  vulnerabilities: SecurityVulnerability[];
  _inferred?: boolean;
}

export interface CorrectnessConcern {
  type: 'logic_error' | 'race_condition' | 'boundary_gap' | 'api_misuse' | 'null_safety' | 'state_inconsistency';
  description: string;
  filePath: string;
  lineNumber: number;
}

export interface CorrectnessAudit {
  level: AuditLevel;
  score: number;
  concerns: CorrectnessConcern[];
  _inferred?: boolean;
}

export interface DependencyAudit {
  level: AuditLevel;
  score: number;
  outdatedDeps: { name: string; currentVersion: string; latestVersion?: string; risk: string }[];
  licenseIssues: { name: string; license: string; risk: string }[];
  _inferred?: boolean;
}

export interface EngineeringScore {
  score: number;
  highlights: string[];
  suggestions: string[];
  _inferred?: boolean;
}

export interface ReviewScoresV2 {
  maintainability: EngineeringScore;
  architecture: EngineeringScore;
  performance: EngineeringScore;
  robustness: EngineeringScore;
  testQuality: EngineeringScore;
}

export interface ChangeImpact {
  level: 'high' | 'medium' | 'low';
  publicApiChanges: boolean;
  dataModelChanges: boolean;
  crossModuleDeps: string[];
  affectedModules: string[];
  _inferred?: boolean;
}

export interface PrReviewResultV2 {
  semantics: PrSemantics;
  security: SecurityAudit;
  correctness: CorrectnessAudit;
  dependency: DependencyAudit;
  scores: ReviewScoresV2;
  impact: ChangeImpact;
  overallScore: number;
  overallLevel: OverallLevel;
  summary: string;
  badge: string;
  keyFindings: string[];
  comments: ReviewComment[];
  diff: string;
  fetchError?: FetchError;
  metadata?: PrMetadata;
  codeBlocks?: CodeBlock[];
}

export type SSEEvent =
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
  | { stage: 'done'; data: { overallScore: number; overallLevel: OverallLevel; summary: string; badge: string; keyFindings: string[]; comments: ReviewComment[] } };
