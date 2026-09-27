import * as p from "@clack/prompts";
import { openSync } from "node:fs";
import { ReadStream } from "node:tty";
import pc from "picocolors";

import { DEFAULT_MODEL, getConfigPath, getModel, loadConfig, saveConfig } from "./config.ts";
import {
  executeCommit,
  executePush,
  getStagedDiff,
  runProjectVerification,
  StepError,
} from "./git.ts";
import { analyzeContext, generateCommitMessage, translateText } from "./omp.ts";

function formatElapsed(start: number): string {
  const sec = Math.floor((performance.now() - start) / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `[${m}m ${s}s]` : `[${s}s]`;
}

async function runStep<T>(
  stopText: string | ((val: T) => string),
  fn: () => Promise<T>,
  startText?: string,
): Promise<T> {
  if (startText) {
    p.log.info(startText);
  }
  const start = performance.now();
  try {
    const res = await fn();
    const elapsed = formatElapsed(start);
    const text = typeof stopText === "function" ? stopText(res) : stopText;
    p.log.step(`${text} ${pc.dim(elapsed)}`);
    return res;
  } catch (err) {
    p.log.error(pc.red("Failed"));
    throw err;
  }
}

function handleError(err: unknown): never {
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

async function runCommit(verify: boolean, edit: boolean, push = false): Promise<void> {
  const cmdName =
    "lgnh " +
    (verify ? (push ? "commit-push" : "commit") : push ? "commit-fast-push" : "commit-fast");
  p.intro(pc.bold(cmdName));

  try {
    if (verify) {
      await runStep(
        (targets) =>
          targets.length > 0
            ? `Verified (${pc.dim(targets.join(", "))})`
            : "No verification scripts",
        runProjectVerification,
      );
    }

    const staged = await runStep(
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

    const initialModel = getModel();
    const { message } = await runStep(
      ({ resolvedModel }) => `Generated message (${pc.cyan(resolvedModel)})`,
      () =>
        generateCommitMessage(`${staged.stat}\n\n${staged.diff}`, (fromModel, toModel) => {
          p.log.warn(`${pc.dim(fromModel)} 모델 없음 → ${pc.cyan(toModel)} 사용`);
          p.log.info(`Generating message... (${pc.cyan(toModel)})`);
        }),
      `Generating message... (${pc.cyan(initialModel)})`,
    );

    p.note(message, "Commit message");

    if (edit) {
      p.log.info("Opening editor...");
      await executeCommit(message, true);
      p.log.step(pc.green("Committed"));
    } else {
      await runStep(pc.green("Committed"), () => executeCommit(message, false));
    }

    if (push) {
      const target = await runStep(
        (dest) => `Pushed to ${pc.cyan(dest)}`,
        executePush,
        "Pushing changes...",
      );
      p.outro(pc.green(`Committed & pushed to ${pc.cyan(target)}`));
    } else {
      p.outro(pc.green("Committed successfully."));
    }
  } catch (err) {
    handleError(err);
  }
}

async function runTranslate(inputArgs: string[]): Promise<void> {
  let text = inputArgs.join(" ").trim();
  const isTty = process.stdout.isTTY;

  if (!text) {
    if (process.stdin.isTTY && isTty) {
      p.intro(pc.bold("lgnh tr"));
      console.log(pc.dim("번역할 텍스트를 입력하거나 붙여넣으세요. (완료: Ctrl+D)\n"));
    }
    text = (await Bun.stdin.text()).trim();
  }

  if (!text) {
    if (isTty) {
      p.cancel("번역할 텍스트가 없습니다.");
    }
    process.exit(1);
  }

  const initialModel = getModel();

  if (isTty) {
    if (inputArgs.length > 0) {
      p.intro(pc.bold("lgnh tr"));
    }
    try {
      const { text: translated } = await runStep(
        ({ resolvedModel }) => `Translated (${pc.cyan(resolvedModel)})`,
        () =>
          translateText(text, (fromModel, toModel) => {
            p.log.warn(`${pc.dim(fromModel)} 모델 없음 → ${pc.cyan(toModel)} 사용`);
            p.log.info(`Translating... (${pc.cyan(toModel)})`);
          }),
        `Translating... (${pc.cyan(initialModel)})`,
      );

      console.log(`\n${translated}\n`);

      const copied = await waitCopyKey();
      if (copied) {
        await copyToClipboard(translated);
        console.log(pc.green("✔ 클립보드에 복사되었습니다."));
      }
    } catch (err) {
      handleError(err);
    }
  } else {
    try {
      const { text: translated } = await translateText(text);
      console.log(translated);
    } catch (err) {
      if (err instanceof StepError) {
        console.error(err.message);
        if (err.detail) console.error(err.detail);
      } else {
        console.error(String(err));
      }
      process.exit(1);
    }
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const cmd =
      process.platform === "darwin"
        ? ["pbcopy"]
        : process.platform === "win32"
          ? ["clip"]
          : Bun.which("wl-copy")
            ? ["wl-copy"]
            : ["xclip", "-selection", "clipboard"];

    const proc = Bun.spawn(cmd, { stdin: "pipe" });
    proc.stdin.write(text);
    proc.stdin.end();
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

async function waitCopyKey(): Promise<boolean> {
  if (!process.stdout.isTTY) return false;

  let stream: ReadStream;
  try {
    const fd = openSync("/dev/tty", "r");
    stream = new ReadStream(fd);
  } catch {
    return false;
  }

  process.stdout.write(pc.dim("  [Enter/c] 복사  [q/Esc] 종료: "));

  return new Promise<boolean>((resolve) => {
    stream.setRawMode(true);
    stream.resume();
    stream.once("data", (chunk: Buffer) => {
      const key = chunk.toString();
      stream.setRawMode(false);
      stream.pause();
      stream.destroy();
      process.stdout.write("\n");

      if (key === "\u0003") {
        process.exit(0);
      }
      if (key === "\r" || key === "\n" || key.toLowerCase() === "c" || key === " ") {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
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
  console.log(`lgnh — developer CLI toolkit via OMP
Usage:
  lgnh commit [-e|--edit]             verify, generate message, commit
  lgnh commit-fast [-e|--edit]        skip verification, commit
  lgnh commit-push [-e|--edit]        verify, commit, and push
  lgnh commit-fast-push [-e|--edit]   skip verification, commit, and push
  lgnh tr [text...]                   translate text (KR ⇄ EN, or multi-line paste)
  lgnh config                         show config path, model
  lgnh model                          show current model
  lgnh model <id>                     set model directly`);
}

const args = process.argv.slice(2);

if (args[0] === "tr" || args[0] === "translate") {
  await runTranslate(args.slice(1));
} else {
  const edit = args.includes("-e") || args.includes("--edit");
  const rest = args.filter((a) => a !== "-e" && a !== "--edit");

  if (rest[0] === "commit") {
    await runCommit(true, edit);
  } else if (rest[0] === "commit-fast") {
    await runCommit(false, edit);
  } else if (rest[0] === "commit-push") {
    await runCommit(true, edit, true);
  } else if (rest[0] === "commit-fast-push") {
    await runCommit(false, edit, true);
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
}
