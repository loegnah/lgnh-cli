import { formatError } from "../errors.ts";
import { runCommitWorkflow } from "../workflows/commit.ts";
import type { CommitOptions, WorkflowEvent } from "../workflows/commit.ts";
import type { Command } from "./types.ts";

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `[${m}m ${s}s]` : `[${s}s]`;
}

function printWorkflowEvent(event: WorkflowEvent): void {
  switch (event.type) {
    case "step": {
      if (event.status === "running") {
        if (event.message) console.log(event.message);
        return;
      }
      if (event.status === "failed") {
        console.log("Failed");
        return;
      }
      const elapsed = event.elapsedMs === undefined ? "" : ` ${formatElapsed(event.elapsedMs)}`;
      console.log(`${event.message ?? event.step}${elapsed}`);
      return;
    }
    case "context": {
      const { diff, stat, prompt, total } = event.metrics;
      console.log(
        [
          "Context tokens:",
          `  ├─ diff:   ${Math.round(diff.tokens).toLocaleString()} tokens (${Math.round(diff.chars).toLocaleString()} chars)`,
          `  ├─ stat:   ${Math.round(stat.tokens).toLocaleString()} tokens (${Math.round(stat.chars).toLocaleString()} chars)`,
          `  ├─ prompt: ${Math.round(prompt.tokens).toLocaleString()} tokens (${Math.round(prompt.chars).toLocaleString()} chars)`,
          `  └─ total:  ${Math.round(total.tokens).toLocaleString()} tokens`,
        ].join("\n"),
      );
      return;
    }
    case "fallback":
      console.log(`${event.fromModel} unavailable → using ${event.toModel}`);
      console.log(`Generating message... (${event.toModel})`);
      return;
    case "message":
      console.log(`\nCommit message:\n${event.message}\n`);
      return;
  }
}

async function runCommitPlain(name: string, options: CommitOptions): Promise<void> {
  console.log(`lgnh ${name}`);
  try {
    const result = await runCommitWorkflow(options, { onEvent: printWorkflowEvent });
    if (!result.changed) {
      console.log("Working tree clean.");
      return;
    }
    console.log(
      result.pushTarget ? `Committed & pushed to ${result.pushTarget}` : "Committed successfully.",
    );
  } catch (err) {
    console.error(formatError(err));
    process.exitCode = 1;
  }
}

// Each alias maps to its exact workflow options — the dispatcher guarantees `name` is one of the keys.
const COMMIT_MODES: Record<string, Pick<CommitOptions, "verify" | "push">> = {
  commit: { verify: true, push: false },
  "commit-fast": { verify: false, push: false },
  "commit-push": { verify: true, push: true },
  "commit-fast-push": { verify: false, push: true },
};

export const commitCommand: Command = {
  names: Object.keys(COMMIT_MODES),
  help: [
    "  lgnh commit [-e|--edit]             verify, generate message, commit",
    "  lgnh commit-fast [-e|--edit]        skip verification, commit",
    "  lgnh commit-push [-e|--edit]        verify, commit, and push",
    "  lgnh commit-fast-push [-e|--edit]   skip verification, commit, and push",
  ].join("\n"),
  async run({ name, args }, env): Promise<void> {
    const mode = COMMIT_MODES[name]!;
    const options: CommitOptions = {
      ...mode,
      edit: args.includes("-e") || args.includes("--edit"),
    };
    if (env.tuiEligible) {
      await env.runTui({ screen: "commit", options });
    } else {
      await runCommitPlain(name, options);
    }
  },
};
