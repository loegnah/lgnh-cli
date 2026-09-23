import { countTokens } from "gpt-tokenizer";

import { getModelCandidates } from "./config.ts";
import { StepError } from "./git.ts";

const COMMIT_SYSTEM_PROMPT = `Generate a git commit message. English only.
Format: <type>(<scope>): <subject> (under 72 chars)
Types: feat, fix, chore, refactor, docs, test, style
Scope: lowercase keyword of changed area
Complex changes: empty line then "- " bullet points
Return raw commit message only, no markdown, no explanations.`;

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

export interface CommitMessageResult {
  message: string;
  resolvedModel: string;
}

export async function generateCommitMessage(
  diffText: string,
  onFallback?: (fromModel: string, toModel: string) => void,
): Promise<CommitMessageResult> {
  const models = getModelCandidates();

  for (const [i, model] of models.entries()) {
    const proc = Bun.spawn(
      [
        "omp",
        "-p",
        "--mode",
        "json",
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

    let rawText = "";
    let resolvedModel = model;

    for (const line of output.trim().split("\n")) {
      if (!line) continue;
      try {
        const data = JSON.parse(line);
        if (data.type === "message_end" && data.message?.role === "assistant") {
          const texts = data.message.content
            ?.filter((c: { type: string; text?: string }) => c.type === "text" && c.text)
            .map((c: { text: string }) => c.text);
          if (texts && texts.length > 0) {
            rawText = texts.join("\n");
          }
          if (data.message.provider && data.message.model) {
            resolvedModel = `${data.message.provider}/${data.message.model}`;
          } else if (data.message.model) {
            resolvedModel = data.message.model;
          }
        }
      } catch {}
    }

    const message = stripFences(rawText || output);
    if (!message) {
      throw new StepError("OMP returned an empty response");
    }
    return { message, resolvedModel };
  }

  throw new StepError("No available models found");
}
