import { DEFAULT_MODEL, getConfigPath, getModel, loadConfig, saveConfig } from "./config.ts";
import { translateText } from "./omp.ts";
import type { TuiOptions, TuiOutcome } from "./tui/app.tsx";
import { formatError, runCommitWorkflow } from "./workflows.ts";
import type { CommitOptions, WorkflowEvent } from "./workflows.ts";

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
          `  ├─ diff:   ${diff.tokens.toLocaleString()} tokens (${diff.chars.toLocaleString()} chars)`,
          `  ├─ stat:   ${stat.tokens.toLocaleString()} tokens (${stat.chars.toLocaleString()} chars)`,
          `  ├─ prompt: ${prompt.tokens.toLocaleString()} tokens (${prompt.chars.toLocaleString()} chars)`,
          `  └─ total:  ${total.tokens.toLocaleString()} tokens`,
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

async function translatePlain(text: string, progress: boolean): Promise<void> {
  try {
    const { text: translated, resolvedModel } = await translateText(text, (fromModel, toModel) => {
      if (progress) console.log(`${fromModel} unavailable → using ${toModel}`);
    });
    if (progress) console.log(`Translated (${resolvedModel})`);
    console.log(progress ? `\n${translated}\n` : translated);
  } catch (err) {
    console.error(formatError(err));
    process.exitCode = 1;
  }
}

async function runTuiAndPrint(options: TuiOptions): Promise<void> {
  // Static import would pull the renderer/native core into every plain path (help, config, pipes).
  const { runTui } = await import("./tui/app.tsx");
  const outcome: TuiOutcome = await runTui(options);
  if (outcome.stdout) {
    process.stdout.write(outcome.stdout.endsWith("\n") ? outcome.stdout : `${outcome.stdout}\n`);
  }
  if (outcome.stderr) {
    process.stderr.write(outcome.stderr.endsWith("\n") ? outcome.stderr : `${outcome.stderr}\n`);
  }
  process.exitCode = outcome.exitCode;
}

function showConfig(): void {
  const config = loadConfig();
  console.log(`Config: ${getConfigPath()}`);
  console.log(`Model: ${config.model || DEFAULT_MODEL}`);
}

function help(): void {
  console.log(`lgnh — developer CLI toolkit via OMP
Usage:
  lgnh commit [-e|--edit]             verify, generate message, commit
  lgnh commit-fast [-e|--edit]        skip verification, commit
  lgnh commit-push [-e|--edit]        verify, commit, and push
  lgnh commit-fast-push [-e|--edit]   skip verification, commit, and push
  lgnh tr [text...]                   translate text (KR ⇄ EN, or multi-line paste)
  lgnh tr -i                          interactive loop mode
  lgnh config                         show config path, model
  lgnh model                          show current model
  lgnh model <id>                     set model directly`);
}

async function runTranslate(inputArgs: string[]): Promise<void> {
  const interactiveFlag = inputArgs.some((a) => a === "-i" || a === "--interactive");
  const text = inputArgs
    .filter((a) => a !== "-i" && a !== "--interactive")
    .join(" ")
    .trim();

  if (tuiEligible) {
    await runTuiAndPrint({
      screen: "translate",
      interactive: interactiveFlag,
      ...(text ? { text } : {}),
    });
    return;
  }

  if (text) {
    await translatePlain(text, Boolean(process.stdout.isTTY));
    return;
  }

  const piped = (await Bun.stdin.text()).trim();
  if (!piped) {
    console.error("No text to translate.");
    process.exitCode = 1;
    return;
  }
  await translatePlain(piped, Boolean(process.stdout.isTTY));
}

const args = process.argv.slice(2);
const tuiEligible = Boolean(process.stdin.isTTY && process.stdout.isTTY);

if (args[0] === "tr" || args[0] === "translate") {
  await runTranslate(args.slice(1));
} else {
  const edit = args.includes("-e") || args.includes("--edit");
  const rest = args.filter((a) => a !== "-e" && a !== "--edit");
  const command = rest[0];

  if (
    command === "commit" ||
    command === "commit-fast" ||
    command === "commit-push" ||
    command === "commit-fast-push"
  ) {
    const options: CommitOptions = {
      verify: command === "commit" || command === "commit-push",
      edit,
      push: command === "commit-push" || command === "commit-fast-push",
    };
    if (tuiEligible) {
      await runTuiAndPrint({ screen: "commit", options });
    } else {
      await runCommitPlain(command, options);
    }
  } else if (command === "config") {
    showConfig();
  } else if (command === "model" && rest[1]) {
    const config = loadConfig();
    saveConfig({ ...config, model: rest[1] });
    console.log(`Model set to ${rest[1]}`);
  } else if (command === "model") {
    console.log(getModel());
  } else if (args.length === 0 && tuiEligible) {
    await runTuiAndPrint({ screen: "home" });
  } else {
    help();
  }
}
