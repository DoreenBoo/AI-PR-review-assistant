export type AiModel = 'deepseek' | 'gemini';


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

// ==========================================
// Multidimensional Assessment Types (v2.0)
// ==========================================

export type AuditLevel = 'critical' | 'warning' | 'pass' | 'na';

export type OverallLevel = 'block' | 'review' | 'approve';

export interface RiskItem {
  id: string;
  verdict: 'pass' | 'risk' | 'na';
  severity: 'critical' | 'warning' | null;
  evidence: string;
  codeLocation?: { filePath: string; lineNumber: number };
}

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
  items: RiskItem[];
  vulnerabilities: SecurityVulnerability[];
  traces: DataflowTrace[];
  _inferred?: boolean;
  _source?: 'local' | 'overview' | 'deep';
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
  items: RiskItem[];
  concerns: CorrectnessConcern[];
  _inferred?: boolean;
  _source?: 'local' | 'overview' | 'deep';
}

export interface DependencyAudit {
  level: AuditLevel;
  score: number;
  outdatedDeps: { name: string; currentVersion: string; latestVersion?: string; risk: string }[];
  licenseIssues: { name: string; license: string; risk: string }[];
  _inferred?: boolean;
  _source?: 'local' | 'overview' | 'deep';
}

export interface EngineeringScore {
  score: number;
  highlights: string[];
  suggestions: string[];
  _inferred?: boolean;
  _source?: 'local' | 'overview' | 'deep';
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
  riskCodeLocations?: { filePath: string; lineNumber: number; reason: string }[];
  _inferred?: boolean;
  _source?: 'local' | 'overview' | 'deep';
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
  | { stage: 'done'; data: { overallScore: number; overallLevel: OverallLevel; summary: string; badge: string; keyFindings: string[]; comments: ReviewComment[]; diff: string } };
