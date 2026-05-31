import { SecurityAudit, CorrectnessAudit, DependencyAudit, EngineeringScore } from "../src/types.js";
import { callDeepSeekAPI } from "./deepseek.js";
import { getGeminiClient } from "./github.js";

export function calculateOverall(
  security: SecurityAudit,
  correctness: CorrectnessAudit,
  dependency: DependencyAudit,
  maintainability: EngineeringScore,
  architecture: EngineeringScore,
  performance: EngineeringScore,
  robustness: EngineeringScore,
  testQuality: EngineeringScore
): { overallScore: number; overallLevel: 'block' | 'review' | 'approve' } {
  let rawScore = Math.round(
    correctness.score * 0.20 +
    dependency.score * 0.10 +
    maintainability.score * 0.15 +
    architecture.score * 0.15 +
    performance.score * 0.15 +
    robustness.score * 0.15 +
    testQuality.score * 0.10
  );

  if (security.level === 'critical') {
    rawScore = Math.min(rawScore, 40);
  }
  if (correctness.level === 'critical') {
    rawScore = Math.min(rawScore, 35);
  }

  const overallScore = Math.min(100, Math.max(0, rawScore));

  let overallLevel: 'block' | 'review' | 'approve';
  if (security.level === 'critical' || correctness.level === 'critical' || overallScore < 50) {
    overallLevel = 'block';
  } else if (overallScore < 70) {
    overallLevel = 'review';
  } else {
    overallLevel = 'approve';
  }

  return { overallScore, overallLevel };
}

export async function callLLMForDimension(
  model: string,
  systemInstruction: string,
  userPrompt: string,
  jsonSchemaInstruction: string
): Promise<string> {
  if (model === 'deepseek') {
    const fullSystem = systemInstruction + '\n\n' + jsonSchemaInstruction;
    return callDeepSeekAPI(fullSystem, userPrompt);
  } else {
    const client = getGeminiClient();
    const response = await client.models.generateContent({
      model: "gemini-3.5-flash",
      contents: userPrompt,
      config: {
        systemInstruction,
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });
    if (!response.text) throw new Error("Empty response from Gemini API");
    return response.text;
  }
}
