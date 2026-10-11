import { COMMANDS, helpText } from "./commands/registry.ts";
import type { Command, CommandEnv, CommandInvocation } from "./commands/types.ts";
import type { TuiOptions, TuiOutcome } from "./tui/types.ts";

export type Dispatch =
  | { kind: "command"; command: Command; invocation: CommandInvocation }
  | { kind: "home" }
  | { kind: "help" };

/** Explicit output mode request; `auto` lets the environment decide. */
export type OutputModeRequest = "auto" | "plain" | "tui";

/** Resolved output mode: either the lazily loaded renderer or sequential text. */
export type OutputMode = "plain" | "tui";

// Leading edit and mode flags may precede the command; every other token is the command name.
// Mode flags are consumed before dispatch, while edit flags are forwarded to the command.
const LEADING_FLAGS: Record<string, true> = {
  "-e": true,
  "--edit": true,
  "--plain": true,
  "--tui": true,
};

const MODE_FLAGS: Record<string, OutputMode> = { "--plain": "plain", "--tui": "tui" };

export interface ParsedOutputMode {
  readonly request: OutputModeRequest;
  /** Arguments with the leading mode flags removed; every other token keeps its position. */
  readonly args: string[];
  /** Usage error when both mode flags lead the command, otherwise undefined. */
  readonly error: string | undefined;
}

/**
 * Consumes the leading `--plain` / `--tui` flags. Tokens after the command name are command data
 * (translation text, model ids), so only the region before the command is read.
 */
export function parseOutputMode(args: readonly string[]): ParsedOutputMode {
  let request: OutputModeRequest = "auto";
  let error: string | undefined;
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!Object.hasOwn(LEADING_FLAGS, arg)) {
      rest.push(...args.slice(index));
      break;
    }
    const mode = MODE_FLAGS[arg];
    if (!mode) {
      rest.push(arg);
      continue;
    }
    if (request !== "auto" && request !== mode) error = "--plain and --tui cannot be combined.";
    request = mode;
  }
  return { request, args: rest, error };
}

/**
 * Final mode. Non-TTY streams always get plain output, even with `--tui`; an explicit flag otherwise
 * wins, and `auto` falls back to plain for captured subprocesses.
 *
 * Capture detection: OMP runs `!<cmd>` in a PTY, so both TTY checks pass, and `OMPCODE` is the
 * marker it sets. `TERM=dumb` declares a terminal without the cursor addressing the renderer needs.
 */
export function resolveOutputMode(
  request: OutputModeRequest,
  tuiEligible: boolean,
  env: Readonly<Record<string, string | undefined>>,
): OutputMode {
  if (!tuiEligible) return "plain";
  if (request !== "auto") return request;
  const captured = Boolean(env.OMPCODE) || env.TERM === "dumb";
  return captured ? "plain" : "tui";
}

/**
 * Resolves the dispatch target once. The matched command token is removed from the arguments, and
 * every remaining token (including flag-like or alias-like text) is passed through untouched.
 */
export function resolveDispatch(args: readonly string[], tuiEligible: boolean): Dispatch {
  const index = args.findIndex((arg) => !Object.hasOwn(LEADING_FLAGS, arg));
  const name = index >= 0 ? args[index] : undefined;
  const command = name && COMMANDS.find((candidate) => candidate.names.includes(name));
  if (command && name) {
    return {
      kind: "command",
      command,
      invocation: { name, args: [...args.slice(0, index), ...args.slice(index + 1)] },
    };
  }
  if (args.length === 0 && tuiEligible) return { kind: "home" };
  return { kind: "help" };
}

/**
 * Runs one CLI invocation. Kept separate from process bootstrap so the TUI renderer is loaded only
 * when a screen is actually opened.
 */
export async function runCli(args: readonly string[]): Promise<void> {
  const parsed = parseOutputMode(args);
  if (parsed.error) {
    console.error(parsed.error);
    process.exitCode = 1;
    return;
  }

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const tuiEligible = resolveOutputMode(parsed.request, interactive, process.env) === "tui";

  const env: CommandEnv = {
    tuiEligible,
    async runTui(options: TuiOptions): Promise<void> {
      // Dynamic import is required here: a static import would pull the native renderer into every
      // plain path (help, config, pipes).
      const { runTui } = await import("./tui/runtime.tsx");
      const outcome: TuiOutcome = await runTui(options);
      if (outcome.stdout) {
        process.stdout.write(
          outcome.stdout.endsWith("\n") ? outcome.stdout : `${outcome.stdout}\n`,
        );
      }
      if (outcome.stderr) {
        process.stderr.write(
          outcome.stderr.endsWith("\n") ? outcome.stderr : `${outcome.stderr}\n`,
        );
      }
      process.exitCode = outcome.exitCode;
    },
  };

  const dispatch = resolveDispatch(parsed.args, tuiEligible);
  switch (dispatch.kind) {
    case "command":
      await dispatch.command.run(dispatch.invocation, env);
      return;
    case "home":
      await env.runTui({ screen: "home" });
      return;
    case "help":
      console.log(helpText());
  }
}
