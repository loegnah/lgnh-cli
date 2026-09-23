import { getOpenRouterKey, getOpenRouterModel } from "./config.ts";

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
}

interface ModelsResponse {
  data?: {
    id: string;
    name: string;
    context_length?: number;
    pricing?: { prompt?: string; completion?: string };
  }[];
}

export interface ModelInfo {
  id: string;
  name: string;
  context_length: number;
  promptPrice: string;
  completionPrice: string;
}

const COMMIT_SYSTEM_PROMPT = `Generate a git commit message. English only.
Use a Conventional Commits prefix: feat:, fix:, chore:, refactor:, docs:, test:, style:.
Subject line under 72 characters.
For complex changes only, add an empty line then concise bullet points starting with "- ".
Return only the raw commit message, no backticks, no code fences, no explanations.`;

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```[\w-]*\n?/, "")
    .replace(/\n?```$/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

export async function generateCommitMessage(diffText: string): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getOpenRouterKey()}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model: getOpenRouterModel(),
      messages: [
        { role: "system", content: COMMIT_SYSTEM_PROMPT },
        { role: "user", content: diffText },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter API Error: ${res.status} ${await res.text()}`);
  const data = await (res.json() as Promise<ChatResponse>);
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("OpenRouter API Error: empty response");
  return stripFences(content);
}

export async function searchModels(query?: string): Promise<ModelInfo[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`OpenRouter API Error: ${res.status} ${await res.text()}`);
  const data = await (res.json() as Promise<ModelsResponse>);
  const q = query?.toLowerCase() ?? "";
  return (data.data ?? [])
    .filter((m) => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
    .map((m) => ({
      id: m.id,
      name: m.name,
      context_length: m.context_length ?? 0,
      promptPrice: m.pricing?.prompt ?? "-",
      completionPrice: m.pricing?.completion ?? "-",
    }));
}
