import type { CommitOptions } from "../workflows/commit.ts";

export type TuiOptions =
  | { screen: "home" }
  | { screen: "translate"; interactive: boolean; text?: string }
  | { screen: "polish"; interactive: boolean; text?: string }
  | { screen: "commit"; options: CommitOptions };

export interface TuiOutcome {
  exitCode: 0 | 1 | 130;
  stdout?: string;
  stderr?: string;
}
