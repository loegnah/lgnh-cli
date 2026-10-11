import { COMMANDS, helpText } from "./commands/registry.ts";
import type { Command, CommandEnv, CommandInvocation } from "./commands/types.ts";
import type { TuiOptions, TuiOutcome } from "./tui/types.ts";

export type Dispatch =
  | { kind: "command"; command: Command; invocation: CommandInvocation }
  | { kind: "home" }
  | { kind: "help" };

// Only the leading edit flag may precede the command; every other token is the command name.
const LEADING_FLAGS: Record<string, true> = { "-e": true, "--edit": true };

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
  const tuiEligible = Boolean(process.stdin.isTTY && process.stdout.isTTY);

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

  const dispatch = resolveDispatch(args, tuiEligible);
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
