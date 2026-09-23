import { countTokens } from "gpt-tokenizer";

import { getModelCandidates } from "./config.ts";
import { StepError } from "./git.ts";

const COMMIT_SYSTEM_PROMPT = `Generate a git commit message. English only.
Use a Conventional Commits prefix: feat:, fix:, chore:, refactor:, docs:, test:, style:.
Subject line under 72 characters.
For complex changes only, add an empty line then concise bullet points starting with "- ".
Return only the raw commit message, no backticks, no code fences, no explanations.`;

export interface ContextItemMetrics {
  tokens: number;
  chars: number;
}

export interface ContextTokenBreakdown {
  prompt: ContextItemMetrics;
  stat: ContextItemMetrics;
  diff: ContextItemMetrics;
  total: ContextItemMetrics;
}

export function analyzeContext(stat: string, diff: string): ContextTokenBreakdown {
  const promptTokens = countTokens(COMMIT_SYSTEM_PROMPT);
  const statTokens = countTokens(stat);
  const diffTokens = countTokens(diff);

  const fullPrompt = `${COMMIT_SYSTEM_PROMPT}\n\n${stat}\n\n${diff}`;
  const totalTokens = countTokens(fullPrompt);

  return {
    prompt: { tokens: promptTokens, chars: COMMIT_SYSTEM_PROMPT.length },
    stat: { tokens: statTokens, chars: stat.length },
    diff: { tokens: diffTokens, chars: diff.length },
    total: { tokens: totalTokens, chars: fullPrompt.length },
  };
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```[\w-]*\n?/, "")
    .replace(/\n?```$/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

export async function generateCommitMessage(
  diffText: string,
  onFallback?: (fromModel: string, toModel: string) => void,
): Promise<string> {
  const models = getModelCandidates();

  for (const [i, model] of models.entries()) {
    const proc = Bun.spawn(
      [
        "omp",
        "-p",
        "--no-tools",
        "--no-skills",
        "--no-rules",
        "--no-extensions",
        "--no-session",
        "--no-title",
        "--system-prompt",
        COMMIT_SYSTEM_PROMPT,
        "--model",
        model,
        "--",
        diffText,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );

    const [output, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      const isNotFound = /model .* not found/i.test(stderr);
      const nextModel = models[i + 1];
      if (isNotFound && nextModel !== undefined) {
        onFallback?.(model, nextModel);
        continue;
      }

      throw new StepError(`OMP failed (exit code ${exitCode})`, stderr.trim() || undefined);
    }

    const content = stripFences(output);
    if (!content) {
      throw new StepError("OMP returned an empty response");
    }
    return content;
  }

  throw new StepError("No available models found");
}
