import { StepError } from "./errors.ts";
import { runProcess } from "./process.ts";

const MAX_DIFF_CHARS = 40 * 1024;

function stripDiffMetadata(raw: string): string {
  return raw
    .split("\n")
    .filter(
      (line) =>
        !/^(?:index [0-9a-f]|(?:new|deleted|old) (?:file )?mode|similarity index)/.test(line),
    )
    .join("\n")
    .trim();
}

export async function getStagedDiff(
  signal?: AbortSignal,
): Promise<{ diff: string; stat: string } | null> {
  await runProcess(["git", "add", "-A"], { signal });
  const statusRes = await runProcess(["git", "status", "-s"], { signal });
  if (statusRes.exitCode !== 0) {
    throw new StepError(statusRes.stderr.trim() || "git status failed");
  }
  if (!statusRes.stdout.trim()) return null;
  const res = await runProcess(
    [
      "git",
      "diff",
      "--cached",
      "-U1",
      "--ignore-all-space",
      "--ignore-blank-lines",
      "--",
      ".",
      ":(exclude)*lock*",
      ":(exclude)*.min.*",
      ":(exclude)*.map",
    ],
    { signal },
  );
  if (res.exitCode !== 0) {
    throw new StepError("Failed to get staged diff", res.stderr.trim() || undefined);
  }
  let diff = stripDiffMetadata(res.stdout);
  if (diff.length > MAX_DIFF_CHARS)
    diff = diff.slice(0, MAX_DIFF_CHARS) + "\n[diff truncated for length]";
  const stat = (await runProcess(["git", "diff", "--cached", "--stat"], { signal })).stdout;
  return { diff, stat };
}

export async function executeCommit(
  message: string,
  edit?: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const args = edit ? ["commit", "-e", "-m", message] : ["commit", "-m", message];
  if (edit) {
    const proc = await runProcess(["git", ...args], { inherit: true, signal });
    if (proc.exitCode !== 0) {
      throw new StepError(`Git commit failed (exit code ${proc.exitCode})`);
    }
    return;
  }

  const proc = await runProcess(["git", ...args], { signal });
  if (proc.exitCode !== 0) {
    const detail = (proc.stderr || proc.stdout).trim();
    throw new StepError("Git commit failed", detail);
  }
}

export async function executePush(signal?: AbortSignal): Promise<string> {
  const proc = await runProcess(["git", "push"], { signal });
  if (proc.exitCode !== 0) {
    const detail = (proc.stderr || proc.stdout).trim();
    throw new StepError("Git push failed", detail);
  }
  const upstream = (
    await runProcess(["git", "rev-parse", "--abbrev-ref", "@{u}"], { signal })
  ).stdout.trim();
  if (upstream) return upstream;
  return (await runProcess(["git", "rev-parse", "--abbrev-ref", "HEAD"], { signal })).stdout.trim();
}
