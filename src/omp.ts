import { getModel } from "./config.ts";
import { StepError } from "./git.ts";

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
    { stdout: "pipe", stderr: "pipe" },
  );

  const [output, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new StepError(
      `AI 커밋 메시지 생성 실패 (OMP 종료 코드: ${exitCode})`,
      stderr.trim() || undefined,
    );
  }

  const content = stripFences(output);
  if (!content) {
    throw new StepError("AI 커밋 메시지 생성 실패: OMP에서 빈 응답을 반환했습니다.");
  }
  return content;
}
