import { useState, useCallback, useRef } from "react";
import {
  PrSemantics, SecurityAudit, CorrectnessAudit, DependencyAudit,
  EngineeringScore, ChangeImpact, ReviewComment, SSEEvent,
  RiskItem, DataflowTrace
} from "../types";

interface SSEReviewState {
  loading: boolean;
  progressMessage: string;
  semantics: PrSemantics | null;
  security: SecurityAudit | null;
  correctness: CorrectnessAudit | null;
  dependency: DependencyAudit | null;
  maintainability: EngineeringScore | null;
  architecture: EngineeringScore | null;
  performance: EngineeringScore | null;
  robustness: EngineeringScore | null;
  testQuality: EngineeringScore | null;
  impact: ChangeImpact | null;
  overallScore: number | null;
  overallLevel: string | null;
  summary: string | null;
  badge: string | null;
  keyFindings: string[];
  comments: ReviewComment[];
  rawDiff: string;
  error: string | null;
  riskItems: { security: RiskItem[]; correctness: RiskItem[] };
  dataflowTraces: Record<string, DataflowTrace>;
}

const initialState: SSEReviewState = {
  loading: false, progressMessage: '', semantics: null,
  security: null, correctness: null, dependency: null,
  maintainability: null, architecture: null, performance: null, robustness: null, testQuality: null,
  impact: null,
  overallScore: null, overallLevel: null, summary: null, badge: null,
  keyFindings: [], comments: [],
  rawDiff: "",
  error: null,
  riskItems: { security: [], correctness: [] },
  dataflowTraces: {},
};

export function useSSEReview() {
  const [state, setState] = useState<SSEReviewState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const startReview = useCallback(async (prUrl: string, pastedDiff: string, model: string) => {
    setState({ ...initialState, loading: true, rawDiff: pastedDiff });
    abortRef.current = new AbortController();

    try {
      const response = await fetch("/api/review/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: prUrl, diff: pastedDiff || null, model }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) throw new Error(`Server error: ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event: SSEEvent = JSON.parse(line.slice(6));
              setState(prev => {
                const next = { ...prev };
                const srcPriority: Record<string, number> = { 'local': 0, 'overview': 1, 'deep': 2 };
                const checkPriority = (current: any, incoming: any): boolean => {
                  if (!current) return true;
                  const curSrc = (current._source || 'local') as string;
                  const incSrc = (incoming._source || 'local') as string;
                  return (srcPriority[incSrc] || 0) >= (srcPriority[curSrc] || 0);
                };
                switch (event.stage) {
                  case "progress": next.progressMessage = event.data.message; break;
                  case "diff_ready": next.rawDiff = event.data.diff; break;
                  case "semantics": next.semantics = event.data; next.loading = false; break;
                  case "security": if (checkPriority(prev.security, event.data)) next.security = event.data; break;
                  case "correctness": if (checkPriority(prev.correctness, event.data)) next.correctness = event.data; break;
                  case "dependency": if (checkPriority(prev.dependency, event.data)) next.dependency = event.data; break;
                  case "maintainability": if (checkPriority(prev.maintainability, event.data)) next.maintainability = event.data; break;
                  case "architecture": if (checkPriority(prev.architecture, event.data)) next.architecture = event.data; break;
                  case "performance": if (checkPriority(prev.performance, event.data)) next.performance = event.data; break;
                  case "robustness": if (checkPriority(prev.robustness, event.data)) next.robustness = event.data; break;
                  case "testQuality": if (checkPriority(prev.testQuality, event.data)) next.testQuality = event.data; break;
                  case "impact": if (checkPriority(prev.impact, event.data)) next.impact = event.data; break;
                  case "risk_items": {
                    const { dimension, items } = event.data as { dimension: 'security' | 'correctness'; items: RiskItem[] };
                    next.riskItems = { ...next.riskItems, [dimension]: items };
                    break;
                  }
                  case "dataflow_trace": {
                    const { itemId, trace } = event.data as { itemId: string; trace: DataflowTrace };
                    next.dataflowTraces = { ...next.dataflowTraces, [itemId]: trace };
                    break;
                  }
                  case "done":
                    next.overallScore = event.data.overallScore;
                    next.overallLevel = event.data.overallLevel;
                    next.summary = event.data.summary;
                    next.badge = event.data.badge;
                    next.keyFindings = event.data.keyFindings;
                    if (event.data.comments && event.data.comments.length > 0) {
                      next.comments = [...next.comments, ...event.data.comments];
                    }
                    if (event.data.diff) next.rawDiff = event.data.diff;
                    next.loading = false;
                    next.progressMessage = '审计完成';
                    break;
                }
                return next;
              });
            } catch {
              // skip parse errors in incomplete chunks
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setState(prev => ({ ...prev, loading: false, error: err.message }));
      }
    }
  }, []);

  const cancelReview = useCallback(() => {
    abortRef.current?.abort();
    setState(prev => ({ ...prev, loading: false }));
  }, []);

  return { ...state, startReview, cancelReview };
}
