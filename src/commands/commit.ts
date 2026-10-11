import { formatError } from "../errors.ts";
import { runCommitWorkflow } from "../workflows.ts";
import type { CommitOptions, WorkflowEvent } from "../workflows.ts";
import type { Command, CommandEnv } from "./types.ts";

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

export const commitCommand: Command = {
  names: ["commit", "commit-fast", "commit-push", "commit-fast-push"],
  help: [
    "  lgnh commit [-e|--edit]             verify, generate message, commit",
    "  lgnh commit-fast [-e|--edit]        skip verification, commit",
    "  lgnh commit-push [-e|--edit]        verify, commit, and push",
    "  lgnh commit-fast-push [-e|--edit]   skip verification, commit, and push",
  ].join("\n"),
  async run(args: string[], env: CommandEnv): Promise<void> {
    const commandName = args.find((a) => commitCommand.names.includes(a)) ?? "commit";
    const edit = args.includes("-e") || args.includes("--edit");
    const options: CommitOptions = {
      verify: !commandName.includes("fast"),
      edit,
      push: commandName.includes("push"),
    };
    if (env.tuiEligible) {
      await env.runTui({ screen: "commit", options });
    } else {
      await runCommitPlain(commandName, options);
    }
  },
};
