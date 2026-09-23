import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { $ } from "bun";

interface PackageJson {
  scripts?: Record<string, string>;
}

const MAX_DIFF_CHARS = 40 * 1024;

export async function runProjectVerification(): Promise<void> {
  const root = (await $`git rev-parse --show-toplevel`.text()).trim();
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return;
  const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const scripts = pkg.scripts ?? {};
  const targets = scripts.check ? ["check"] : ["lint", "typecheck"].filter((s) => scripts[s]);
  for (const t of targets) {
    const code = await $`bun run ${t}`.cwd(root).nothrow();
    if (code.exitCode !== 0) {
      console.error(`Verification failed: bun run ${t}`);
      process.exit(1);
    }
  }
}

export async function getStagedDiff(): Promise<{ diff: string; stat: string } | null> {
  await $`git add -A`.nothrow().quiet();
  const status = (await $`git status -s`.text()).trim();
  if (!status) return null;
  const proc = Bun.spawn(
    [
      "git",
      "diff",
      "--cached",
      "--",
      ".",
      ":(exclude)*lock*",
      ":(exclude)*.min.*",
      ":(exclude)*.map",
    ],
    { stdout: "pipe" },
  );
  let diff = await new Response(proc.stdout).text();
  if (diff.length > MAX_DIFF_CHARS)
    diff = diff.slice(0, MAX_DIFF_CHARS) + "\n[diff truncated for length]";
  const stat = await $`git diff --cached --stat`.text();
  return { diff, stat };
}

export async function executeCommit(message: string, edit?: boolean): Promise<void> {
  const args = edit ? ["commit", "-e", "-m", message] : ["commit", "-m", message];
  const proc = Bun.spawn(["git", ...args], { stdio: ["inherit", "inherit", "inherit"] });
  const code = await proc.exited;
  if (code !== 0) process.exit(code);
}
