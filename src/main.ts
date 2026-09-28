import * as p from "@clack/prompts";
import { openSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
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
    p.log.info(startText, { spacing: 0 });
  }
  const start = performance.now();
  try {
    const res = await fn();
    const elapsed = formatElapsed(start);
    const text = typeof stopText === "function" ? stopText(res) : stopText;
    p.log.step(`${text} ${pc.dim(elapsed)}`, { spacing: 0 });
    return res;
  } catch (err) {
    p.log.error(pc.red("Failed"), { spacing: 0 });
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
          p.log.warn(`${pc.dim(fromModel)} unavailable → using ${pc.cyan(toModel)}`);
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
  const isTty = process.stdout.isTTY;
  const args = inputArgs.filter((a) => a !== "-i" && a !== "--interactive");
  const interactive = isTty && args.length !== inputArgs.length;

  if (interactive) {
    p.intro(pc.bold("lgnh tr"));
    console.log(pc.dim("[Enter/Shift+Enter] newline  [Cmd+Enter] translate  [Ctrl+C] exit"));
    let last = "";
    if (args.length > 0) last = await translateOnce(args.join(" "));
    await ttyInput({
      submit: async (text) => {
        try {
          return await translateOnce(text);
        } catch (err) {
          if (err instanceof StepError) p.log.error(pc.red(err.message));
          else p.log.error(pc.red(String(err)));
        }
      },
      initialState: args.length > 0 ? "action" : "input",
      initialLast: last,
    });
    return;
  }

  const given = args.join(" ").trim();

  if (!given && process.stdin.isTTY && isTty) {
    p.intro(pc.bold("lgnh tr"));
    console.log(pc.dim("[Enter/Shift+Enter] newline  [Cmd+Enter] translate  [Ctrl+C] exit"));
    await ttyInput({
      submit: async (text) => {
        try {
          await translateOnce(text);
        } catch (err) {
          if (err instanceof StepError) p.log.error(pc.red(err.message));
          else p.log.error(pc.red(String(err)));
        }
      },
      quitAfterSubmit: true,
    });
    return;
  }

  let text = given;
  if (!text) {
    text = (await Bun.stdin.text()).trim();
  }

  if (!text) {
    if (isTty) {
      p.cancel("No text to translate.");
    }
    process.exit(1);
  }

  if (isTty) {
    if (args.length > 0) {
      p.intro(pc.bold("lgnh tr"));
    }
    try {
      await translateOnce(text);
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

async function translateOnce(text: string): Promise<string> {
  const { text: translated } = await runStep(
    ({ resolvedModel }) => `Translated (${pc.cyan(resolvedModel)})`,
    () =>
      translateText(text, (fromModel, toModel) => {
        p.log.warn(`${pc.dim(fromModel)} unavailable → using ${pc.cyan(toModel)}`, { spacing: 0 });
      }),
    `Translating... (${pc.cyan(getModel())})`,
  );
  console.log(`\n${translated}\n`);
  return translated;
}
function getTtyStream(): ReadStream {
  if (process.platform === "win32") {
    if (process.stdin.isTTY) return process.stdin as ReadStream;
    try {
      return new ReadStream(openSync("CONIN$", "r"));
    } catch {
      return process.stdin as ReadStream;
    }
  }
  try {
    return new ReadStream(openSync("/dev/tty", "r"));
  } catch {
    return process.stdin as ReadStream;
  }
}

function charWidth(char: string): number {
  const code = char.codePointAt(0) || 0;
  if (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f9ff)
  ) {
    return 2;
  }
  return 1;
}

async function ttyInput(options: {
  submit: (text: string) => Promise<string | void>;
  initialState?: "input" | "action";
  initialLast?: string;
  quitAfterSubmit?: boolean;
}): Promise<void> {
  const stream = getTtyStream();
  stream.setRawMode(true);
  process.stdout.write("\x1b[?2004h\x1b[>1u");

  const decoder = new StringDecoder("utf8");
  const prompt = () => process.stdout.write(pc.dim("Enter text:\r\n"));
  const actionPrompt = () => process.stdout.write(pc.dim("[c] copy  [a] next  [Ctrl+C] exit: "));

  const cleanup = () => {
    try {
      stream.setRawMode(false);
    } catch {}
    process.stdout.write("\x1b[<u\x1b[?2004l\r\n");
  };
  const quit = () => {
    cleanup();
    process.exit(0);
  };

  let state: "input" | "action" = options.initialState || "input";
  let last = options.initialLast || "";
  let buffer = "";
  let escape = "";

  const send = async () => {
    const text = buffer;
    buffer = "";
    if (!text.trim()) {
      prompt();
      return;
    }
    process.stdout.write("\r\n");
    stream.setRawMode(false);
    try {
      const res = await options.submit(text);
      if (typeof res === "string") last = res;
    } finally {
      if (options.quitAfterSubmit) {
        cleanup();
        process.exit(0);
      } else {
        stream.setRawMode(true);
        state = "action";
        actionPrompt();
      }
    }
  };

  if (state === "action") {
    actionPrompt();
  } else {
    prompt();
  }

  for await (const chunk of stream) {
    for (const key of decoder.write(chunk)) {
      if (escape) {
        escape += key;
        if (escape === "\x1b[" || escape === "\x1bO") continue;
        const code = key.charCodeAt(0);
        if (escape.startsWith("\x1b[") && (code < 0x40 || code > 0x7e)) continue;
        if (escape.startsWith("\x1bO") && escape.length < 3) continue;

        const sequence = escape;
        escape = "";

        if (state === "input") {
          if (sequence === "\x1b[200~" || sequence === "\x1b[201~") continue;
          if (sequence === "\x1b\r" || sequence === "\x1b\n") {
            await send();
            continue;
          }
          if (sequence === "\x1bOM") {
            buffer += "\n";
            process.stdout.write("\r\n");
            continue;
          }

          let keyId = 0;
          let mod = 1;
          if (sequence.startsWith("\x1b[27;") && sequence.endsWith("~")) {
            const parts = sequence.slice(5, -1).split(";");
            mod = Number(parts[0]) || 1;
            keyId = Number(parts[1]) || 0;
          } else if (sequence.startsWith("\x1b[") && sequence.endsWith("u")) {
            const parts = sequence.slice(2, -1).split(";");
            keyId = Number(parts[0]) || 0;
            mod = Number(parts[1]) || 1;
          }
          if (keyId === 13) {
            const hasCtrl = ((mod - 1) & 4) !== 0;
            const hasSuper = ((mod - 1) & 8) !== 0;
            if (hasSuper || hasCtrl) {
              await send();
            } else {
              buffer += "\n";
              process.stdout.write("\r\n");
            }
            continue;
          }
        } else if (state === "action") {
          let keyId = 0;
          let altKeyId = 0;
          if (sequence.startsWith("\x1b[27;") && sequence.endsWith("~")) {
            const parts = sequence.slice(5, -1).split(";");
            keyId = Number(parts[1]) || 0;
          } else if (sequence.startsWith("\x1b[") && sequence.endsWith("u")) {
            const parts = sequence.slice(2, -1).split(";");
            const sub = (parts[0] || "").split(":");
            keyId = Number(sub[0]) || 0;
            altKeyId = Number(sub[1]) || 0;
          }
          if (keyId === 99 || altKeyId === 99 || keyId === 0x314a || keyId === 0x110e) {
            if (last) {
              const ok = await copyToClipboard(last);
              process.stdout.write("\r\n");
              if (ok) process.stdout.write(pc.green("✔ Copied to clipboard.\r\n"));
            }
            actionPrompt();
            continue;
          }
          if (keyId === 97 || altKeyId === 97 || keyId === 0x3141 || keyId === 0x1106) {
            state = "input";
            buffer = "";
            process.stdout.write("\r\n");
            prompt();
            continue;
          }
          if (keyId === 113 || altKeyId === 113 || keyId === 0x3142 || keyId === 0x1107) {
            quit();
            continue;
          }
        }
      }

      if (key === "\x1b") {
        escape = key;
        continue;
      }

      if (key === "\u0003") {
        quit();
        continue;
      }

      if (state === "action") {
        const lower = key.toLowerCase();
        const isCopy =
          lower === "c" || key === "ㅊ" || key === "\u314a" || key === "\u110e" || key === "\u11be";
        const isNext =
          lower === "a" || key === "ㅁ" || key === "\u3141" || key === "\u1106" || key === "\u11b7";
        const isQuit =
          lower === "q" ||
          key === "ㅂ" ||
          key === "ㅃ" ||
          key === "\u3142" ||
          key === "\u3138" ||
          key === "\u1107" ||
          key === "\u1108" ||
          key === "\u11b8";

        if (isCopy) {
          if (last) {
            const ok = await copyToClipboard(last);
            process.stdout.write("\r\n");
            if (ok) process.stdout.write(pc.green("✔ Copied to clipboard.\r\n"));
          }
          actionPrompt();
          continue;
        }
        if (isNext) {
          state = "input";
          buffer = "";
          process.stdout.write("\r\n");
          prompt();
          continue;
        }
        if (isQuit) {
          quit();
          continue;
        }
        continue;
      }

      if (key === "\r" || key === "\n") {
        buffer += "\n";
        process.stdout.write("\r\n");
        continue;
      }

      if (key === "\u007f" || key === "\b") {
        if (!buffer) continue;
        const chars = [...buffer];
        const lastChar = chars.pop() || "";
        buffer = chars.join("");
        if (lastChar === "\n") {
          continue;
        }
        process.stdout.write("\b \b".repeat(charWidth(lastChar)));
        continue;
      }
      if (key === " " && (!buffer || buffer.endsWith("\n"))) {
        continue;
      }

      buffer += key;
      process.stdout.write(key);
    }
  }

  quit();
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const base64 = Buffer.from(text).toString("base64");
    process.stdout.write(`\x1b]52;c;${base64}\x07`);
  } catch {}

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
  lgnh tr -i                          interactive loop mode
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
