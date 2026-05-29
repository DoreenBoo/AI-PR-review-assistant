import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "15mb" }));

// Helper to parse GitHub Pull Request URLs
function parseGithubPr(urlStr: string) {
  try {
    const url = new URL(urlStr);
    if (!url.hostname.includes("github.com")) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    // Standard public PR URL format: github.com/owner/repo/pull/number
    const pullIndex = parts.indexOf("pull");
    if (pullIndex !== -1 && parts[pullIndex + 1]) {
      return {
        owner: parts[pullIndex - 2],
        repo: parts[pullIndex - 1],
        pullNumber: parts[pullIndex + 1],
      };
    }
  } catch (e) {
    return null;
  }
  return null;
}

// Lazy load Gemini client to avoid crashes on startup if key is missing
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY environment variable is not defined. Please configure it in Settings > Secrets."
    );
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// AI PR Review endpoint
app.post("/api/review", async (req, res): Promise<any> => {
  const { url, diff } = req.body;
  let targetDiff = diff || "";

  // If a URL was provided, try fetching the diff from GitHub
  if (url && !targetDiff) {
    const parsed = parseGithubPr(url);
    if (!parsed) {
      return res.status(400).json({
        error: "Invalid GitHub Pull Request URL. Format: https://github.com/owner/repo/pull/1",
      });
    }

    const { owner, repo, pullNumber } = parsed;
    // Download the raw diff format directly from GitHub's raw diff host or fallback
    const diffUrls = [
      `https://patch-diff.githubusercontent.com/raw/${owner}/${repo}/pull/${pullNumber}.diff`,
      `https://github.com/` + `${owner}/${repo}/pull/${pullNumber}.diff`,
    ];

    let fetchError = "";
    for (const dUrl of diffUrls) {
      try {
        const fetchRes = await fetch(dUrl, {
          headers: {
            "Accept": "text/plain",
            "User-Agent": "AI-Studio-PR-Reviewer",
          },
        });
        if (fetchRes.ok) {
          targetDiff = await fetchRes.text();
          break;
        } else {
          fetchError = `GitHub responded with status ${fetchRes.status}: ${fetchRes.statusText}`;
        }
      } catch (e: any) {
        fetchError = e.message;
      }
    }

    if (!targetDiff) {
      return res.status(502).json({
        error: `Could not fetch diff from GitHub (${fetchError}). Please verify the repository is public or try pasting the diff manually.`,
      });
    }
  }

  if (!targetDiff || targetDiff.trim().length === 0) {
    return res.status(400).json({
      error: "No Git Diff provided or fetched. Please paste a valid diff or a public GitHub PR URL.",
    });
  }

  // Cap diff length to prevent token overflows (e.g., max 50KB to keep it responsive)
  const isDiffTruncated = targetDiff.length > 60000;
  if (isDiffTruncated) {
    targetDiff = targetDiff.substring(0, 60000) + "\n\n... (diff truncated for token limit) ...";
  }

  try {
    const client = getGeminiClient();

    const systemInstruction = `You are an elite, production-grade Tech Lead and Security Code Auditor.
Your singular objective is to review code changes (Git diffs) and output a highly actionable, structured audit response in formal Chinese.

For each significant issue (such as SQL Injections, security hazards, leaked credentials, rendering loops, infinite re-renders in hooks, memory leaks, deep callback nesting, or bad complexity), you MUST generate an inline comment pointing out:
- filePath: The exact path of the file as written in the git diff (e.g., 'src/auth.ts').
- lineNumber: An approximate 1-based target line number in the new file where the issue/line resides.
- originalContent: A unique line of code from the added lines in the diff (marked with '+') that is causing the issue.
- description: Explanation of the direct risk or issue in a professional tech tone.
- suggestion: A direct code block suggestion demonstrating how to rewrite the code safely/elegantly.
- severity: 'high' (critical security / crash bug), 'medium' (performance or strong design smell), or 'low' (stylistic/readability).

Rate the entire diff performance overall across 4 metrics (0-100): security, readability, performance, robustness. Be realistic: code with severe vulnerability gets security = 0. Output a concise summary and 3 key takeaways.`;

    const userPrompt = `Please audit this Git Diff and provide a comprehensive review in JSON format matching the schema rules:
    
--- GIT DIFF START ---
${targetDiff}
--- GIT DIFF END ---`;

    const response = await client.models.generateContent({
      model: "gemini-3.5-flash",
      contents: userPrompt,
      config: {
        systemInstruction,
        temperature: 0.2, // Keep it highly objective and consistent
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.STRING,
              description: "A professional one-sentence Chinese summary of what this code changes and its quality status.",
            },
            badge: {
              type: Type.STRING,
              description: "A short highlight category for the PR, e.g., '安全风险修复', '重构升级', '内存泄露修复', '依赖升级'.",
            },
            scores: {
              type: Type.OBJECT,
              properties: {
                security: { type: Type.INTEGER, description: "代码安全性评分 (0-100)" },
                readability: { type: Type.INTEGER, description: "代码可读性评分 (0-100)" },
                performance: { type: Type.INTEGER, description: "代码性能表现评分 (0-100)" },
                robustness: { type: Type.INTEGER, description: "代码健壮性评分 (0-100)" },
              },
              required: ["security", "readability", "performance", "robustness"],
            },
            overallScore: {
              type: Type.INTEGER,
              description: "总体质量综合评分 (0-100).",
            },
            keyFindings: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "2至3个核心发现、漏洞或建议的列表",
            },
            comments: {
              type: Type.ARRAY,
              description: "所有发现的问题与重构批注列表",
              items: {
                type: Type.OBJECT,
                properties: {
                  filePath: { type: Type.STRING, description: "代码文件路径" },
                  lineNumber: { type: Type.INTEGER, description: "在修改后的代码中的行号" },
                  originalContent: { type: Type.STRING, description: "出问题的原行代码，用于前端精确定位" },
                  description: { type: Type.STRING, description: "问题深度剖析与安全风险诊断" },
                  suggestion: { type: Type.STRING, description: "优化或重构后的完整 Markdown 代码块建议" },
                  severity: { type: Type.STRING, description: "严重级别: high | medium | low" },
                },
                required: ["filePath", "lineNumber", "originalContent", "description", "suggestion", "severity"],
              },
            },
          },
          required: ["summary", "badge", "scores", "overallScore", "keyFindings", "comments"],
        },
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("No response received from Gemini model.");
    }

    const result = JSON.parse(text.trim());
    // Attach the original or fetched diff to the response
    result.diff = targetDiff;
    return res.json(result);
  } catch (error: any) {
    console.error("AI Review Backend Error:", error);
    return res.status(500).json({
      error: error.message || "Failed to process the AI PR Review.",
    });
  }
});

// Configure serving for Vite/Production
async function initServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite Development Middleware Mounted.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Static Production Distribution Mounted.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening at http://localhost:${PORT}`);
  });
}

initServer();
