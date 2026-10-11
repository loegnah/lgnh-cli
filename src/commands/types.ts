import type { TuiOptions } from "../tui/app.tsx";

export interface CommandEnv {
  tuiEligible: boolean;
  runTui(options: TuiOptions): Promise<void>;
}

export interface Command {
  names: string[];
  help: string;
  run(args: string[], env: CommandEnv): Promise<void>;
}
