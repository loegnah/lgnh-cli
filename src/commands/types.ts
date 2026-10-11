import type { TuiOptions } from "../tui/types.ts";

/** Resolved once by the dispatcher: the matched command name plus its arguments (command token removed). */
export interface CommandInvocation {
  readonly name: string;
  readonly args: string[];
}

export interface CommandEnv {
  readonly tuiEligible: boolean;
  runTui(options: TuiOptions): Promise<void>;
}

export interface Command {
  readonly names: readonly string[];
  readonly help: string;
  run(invocation: CommandInvocation, env: CommandEnv): Promise<void>;
}
