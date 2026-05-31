import { GoogleGenAI } from "@google/genai";

export async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout: number = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function parseGithubPr(urlStr: string) {
  try {
    const url = new URL(urlStr);
    if (!url.hostname.includes("github.com")) return null;

    const pathname = url.pathname.replace(/\/+$/, "");
    const parts = pathname.split("/").filter(Boolean);

    const pullIndex = parts.indexOf("pull");
    if (pullIndex === -1 || !parts[pullIndex + 1]) {
      return null;
    }

    const pullNumber = parts[pullIndex + 1];
    if (!/^\d+$/.test(pullNumber)) {
      return null;
    }

    if (pullIndex >= 2) {
      const owner = parts[pullIndex - 2];
      const repo = parts[pullIndex - 1];
      if (owner && repo) {
        return { owner, repo, pullNumber };
      }
    }

    const match = urlStr.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
    if (match) {
      return {
        owner: match[1],
        repo: match[2],
        pullNumber: match[3],
      };
    }
  } catch (e) {
    return null;
  }
  return null;
}

let aiClient: GoogleGenAI | null = null;
export function getGeminiClient(): GoogleGenAI {
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

export async function fetchPrMetadata(owner: string, repo: string, pullNumber: string): Promise<{
  owner: string; repo: string; pullNumber: number;
  title: string; description: string;
  author: string; createdAt: string;
  linkedIssues: { number: number; title: string }[];
}> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "AI-Studio-PR-Reviewer",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const prUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`;
  const prRes = await fetchWithTimeout(prUrl, { headers }, 10000);
  if (!prRes.ok) {
    throw new Error(`GitHub API responded with status ${prRes.status}`);
  }

  const prData: any = await prRes.json();
  const prNumber = parseInt(pullNumber, 10);

  const issueRefs = [...((prData.body || '') as string).matchAll(/#(\d+)/g)];
  const linkedIssues = issueRefs.map(m => ({ number: parseInt(m[1]), title: '' }));

  return {
    owner,
    repo,
    pullNumber: prNumber,
    title: prData.title || '',
    description: (prData.body || '').substring(0, 2000),
    author: prData.user?.login || '',
    createdAt: prData.created_at || '',
    linkedIssues,
  };
}
