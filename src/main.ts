import * as p from "@clack/prompts";
import type { SpinnerResult } from "@clack/prompts";
import pc from "picocolors";

import { DEFAULT_MODEL, getConfigPath, getModel, loadConfig, saveConfig } from "./config.ts";
import { executeCommit, getStagedDiff, runProjectVerification, StepError } from "./git.ts";
import { analyzeContext, generateCommitMessage } from "./omp.ts";

async function runStep<T>(
  s: SpinnerResult,
  startText: string,
  stopText: string | ((val: T) => string),
  fn: () => Promise<T>,
): Promise<T> {
  s.start(startText);
  try {
    const res = await fn();
    s.stop(typeof stopText === "function" ? stopText(res) : stopText);
    return res;
  } catch (err) {
    s.error(pc.red("Failed"));
    throw err;
  }
}

async function runCommit(verify: boolean, edit: boolean): Promise<void> {
  p.intro(verify ? pc.bold("lgnh commit") : pc.bold("lgnh commit-fast"));
  const s = p.spinner();

  try {
    if (verify) {
      await runStep(
        s,
        "Verifying...",
        (targets) =>
          targets.length > 0
            ? `Verified (${pc.dim(targets.join(", "))})`
            : "No verification scripts",
        runProjectVerification,
      );
    }

    const staged = await runStep(
      s,
      "Checking changes...",
      (val) => (val ? "Staged changes" : "No changes to commit"),
      getStagedDiff,
    );

    if (!staged) {
      p.outro(pc.dim("Working tree clean."));
      return;
    }
    const metrics = analyzeContext(staged.stat, staged.diff);
    p.log.info(
      pc.bold("Context tokens:\n") +
        pc.dim("  ├─ diff:   ") +
        pc.yellow(`${metrics.diff.tokens.toLocaleString()} tokens`) +
        pc.dim(` (${metrics.diff.chars.toLocaleString()} chars)\n`) +
        pc.dim("  ├─ stat:   ") +
        pc.yellow(`${metrics.stat.tokens.toLocaleString()} tokens`) +
        pc.dim(` (${metrics.stat.chars.toLocaleString()} chars)\n`) +
        pc.dim("  ├─ prompt: ") +
        pc.yellow(`${metrics.prompt.tokens.toLocaleString()} tokens`) +
        pc.dim(` (${metrics.prompt.chars.toLocaleString()} chars)\n`) +
        pc.dim("  └─ total:  ") +
        pc.cyan(pc.bold(`${metrics.total.tokens.toLocaleString()} tokens`)),
    );

    const model = getModel();
    const message = await runStep(
      s,
      `Generating message... (${pc.cyan(model)})`,
      "Generated message",
      () => generateCommitMessage(`${staged.stat}\n\n${staged.diff}`),
    );

    p.note(message, "Commit message");

    if (edit) {
      p.log.info("Opening editor...");
      await executeCommit(message, true);
      p.outro(pc.green("Committed."));
    } else {
      await runStep(s, "Committing...", "Committed", () => executeCommit(message, false));
      p.outro(pc.green("Committed."));
    }
  } catch (err) {
    if (err instanceof StepError) {
      p.cancel(pc.red(err.message));
      if (err.detail) {
        console.error(`\n${err.detail}\n`);
      }
    } else if (err instanceof Error) {
      p.cancel(pc.red(err.message));
    } else {
      p.cancel(pc.red(String(err)));
    }
    process.exit(1);
  }
}

function showConfig(): void {
  const config = loadConfig();
  console.log(`Config: ${getConfigPath()}`);
  console.log(`Model: ${config.model || DEFAULT_MODEL}`);
}

function showModel(): void {
  console.log(getModel());
}

function help(): void {
  console.log(`lgnh — git diff based commit messages via OMP
Usage:
  lgnh commit [-e|--edit]        verify, generate message, commit
  lgnh commit-fast [-e|--edit]   skip verification
  lgnh config                    show config path, model
  lgnh model                     show current model
  lgnh model <id>                set model directly`);
}

const args = process.argv.slice(2);
const edit = args.includes("-e") || args.includes("--edit");
const rest = args.filter((a) => a !== "-e" && a !== "--edit");

if (rest[0] === "commit") {
  await runCommit(true, edit);
} else if (rest[0] === "commit-fast") {
  await runCommit(false, edit);
} else if (rest[0] === "config") {
  showConfig();
} else if (rest[0] === "model" && rest[1]) {
  const config = loadConfig();
  saveConfig({ ...config, model: rest[1] });
  console.log(`Model set to ${rest[1]}`);
} else if (rest[0] === "model") {
  showModel();
} else {
  help();
}
