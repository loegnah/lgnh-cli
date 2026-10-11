import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { StepError } from "../errors.ts";
import { runProcess } from "../process.ts";

interface PackageJson {
  scripts?: Record<string, string>;
}

export async function runProjectVerification(signal?: AbortSignal): Promise<string[]> {
  const root = await runProcess(["git", "rev-parse", "--show-toplevel"], { signal });
  if (root.exitCode !== 0) {
    throw new StepError(root.stderr.trim() || "Failed to resolve the Git project root");
  }
  const projectRoot = root.stdout.trim();
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return [];
  const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const scripts = pkg.scripts ?? {};
  const targets = scripts.check ? ["check"] : ["lint", "typecheck"].filter((s) => scripts[s]);
  for (const t of targets) {
    const res = await runProcess(["bun", "run", t], { cwd: projectRoot, signal });
    if (res.exitCode !== 0) {
      const detail = [res.stdout, res.stderr].filter(Boolean).join("\n").trim();
      throw new StepError(`Verification failed: bun run ${t}`, detail);
    }
  }
  return targets;
}
