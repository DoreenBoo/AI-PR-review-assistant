import { useState, useCallback, useRef } from "react";
import {
  PrSemantics, SecurityAudit, CorrectnessAudit, DependencyAudit,
  EngineeringScore, ChangeImpact, ReviewComment, SSEEvent
} from "../types";

interface SSEReviewState {
  loading: boolean;
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
  error: string | null;
}

const initialState: SSEReviewState = {
  loading: false, semantics: null,
  security: null, correctness: null, dependency: null,
  maintainability: null, architecture: null, performance: null, robustness: null, testQuality: null,
  impact: null,
  overallScore: null, overallLevel: null, summary: null, badge: null,
  keyFindings: [], comments: [],
  error: null,
};

export function useSSEReview() {
  const [state, setState] = useState<SSEReviewState>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const startReview = useCallback(async (prUrl: string, pastedDiff: string, model: string) => {
    setState({ ...initialState, loading: true });
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
                switch (event.stage) {
                  case "semantics": next.semantics = event.data; break;
                  case "security": next.security = event.data; break;
                  case "correctness": next.correctness = event.data; break;
                  case "dependency": next.dependency = event.data; break;
                  case "maintainability": next.maintainability = event.data; break;
                  case "architecture": next.architecture = event.data; break;
                  case "performance": next.performance = event.data; break;
                  case "robustness": next.robustness = event.data; break;
                  case "testQuality": next.testQuality = event.data; break;
                  case "impact": next.impact = event.data; break;
                  case "done":
                    next.overallScore = event.data.overallScore;
                    next.overallLevel = event.data.overallLevel;
                    next.summary = event.data.summary;
                    next.badge = event.data.badge;
                    next.keyFindings = event.data.keyFindings;
                    next.comments = event.data.comments;
                    next.loading = false;
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
