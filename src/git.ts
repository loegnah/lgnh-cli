import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { $ } from "bun";

interface PackageJson {
  scripts?: Record<string, string>;
}

const MAX_DIFF_CHARS = 40 * 1024;

export class StepError extends Error {
  constructor(
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
  }
}

export async function runProjectVerification(): Promise<string[]> {
  const root = (await $`git rev-parse --show-toplevel`.quiet().text()).trim();
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return [];
  const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const scripts = pkg.scripts ?? {};
  const targets = scripts.check ? ["check"] : ["lint", "typecheck"].filter((s) => scripts[s]);
  for (const t of targets) {
    const res = await $`bun run ${t}`.cwd(root).nothrow().quiet();
    if (res.exitCode !== 0) {
      const detail = [res.stdout.toString(), res.stderr.toString()]
        .filter(Boolean)
        .join("\n")
        .trim();
      throw new StepError(`Verification failed: bun run ${t}`, detail);
    }
  }
  return targets;
}

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

export async function getStagedDiff(): Promise<{ diff: string; stat: string } | null> {
  await $`git add -A`.nothrow().quiet();
  const status = (await $`git status -s`.quiet().text()).trim();
  if (!status) return null;
  const proc = Bun.spawn(
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
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new StepError("Failed to get staged diff", stderr.trim() || undefined);
  }
  let diff = stripDiffMetadata(stdout);
  if (diff.length > MAX_DIFF_CHARS)
    diff = diff.slice(0, MAX_DIFF_CHARS) + "\n[diff truncated for length]";
  const stat = await $`git diff --cached --stat`.quiet().text();
  return { diff, stat };
}

export async function executeCommit(message: string, edit?: boolean): Promise<void> {
  const args = edit ? ["commit", "-e", "-m", message] : ["commit", "-m", message];
  if (edit) {
    const proc = Bun.spawn(["git", ...args], { stdio: ["inherit", "inherit", "inherit"] });
    const code = await proc.exited;
    if (code !== 0) {
      throw new StepError(`Git commit failed (exit code ${code})`);
    }
    return;
  }

  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    const detail = (stderr || stdout).trim();
    throw new StepError("Git commit failed", detail);
  }
}

export async function executePush(): Promise<string> {
  const proc = Bun.spawn(["git", "push"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    const detail = (stderr || stdout).trim();
    throw new StepError("Git push failed", detail);
  }
  const upstream = (await $`git rev-parse --abbrev-ref @{u}`.nothrow().quiet().text()).trim();
  if (upstream) return upstream;
  return (await $`git rev-parse --abbrev-ref HEAD`.quiet().text()).trim();
}
