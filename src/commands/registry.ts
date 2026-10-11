import { commitCommand } from "./commit.ts";
import { configCommand, modelCommand } from "./config.ts";
import { translateCommand } from "./translate.ts";
import type { Command } from "./types.ts";

// Single place that lists the CLI's commands. Registering a new command is one entry here.
export const COMMANDS: readonly Command[] = [
  commitCommand,
  translateCommand,
  configCommand,
  modelCommand,
];

export function helpText(): string {
  return `lgnh — developer CLI toolkit via OMP
Usage:
${COMMANDS.map((command) => command.help).join("\n")}`;
}
