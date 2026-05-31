import type { Response as ExpressResponse } from "express";
import { SSEEvent } from "../src/types.js";

export function sseWrite(res: ExpressResponse, event: SSEEvent): void {
  res.write(`event: dimension\ndata: ${JSON.stringify(event)}\n\n`);
}

export function sseDone(
  res: ExpressResponse,
  data: { overallScore: number; overallLevel: string; summary: string; badge: string; keyFindings: string[]; comments: any[] }
): void {
  res.write(`event: done\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
}
