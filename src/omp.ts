import { getModel } from "./config.ts";

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
      getModel(),
      "--",
      diffText,
    ],
    { stderr: "ignore" },
  );

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`OMP failed with exit code ${exitCode}`);
  }

  const content = stripFences(output);
  if (!content) {
    throw new Error("OMP returned an empty response");
  }

  return content;
}
