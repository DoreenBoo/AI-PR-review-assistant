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

export interface PrReviewResult {
  summary: string;
  badge: string;
  scores: ReviewScore;
  overallScore: number;
  keyFindings: string[];
  comments: ReviewComment[];
  diff: string; // The original public or pasted patch/diff
}
