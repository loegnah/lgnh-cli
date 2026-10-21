import { commitCommand } from "./commit.ts";
import { configCommand, modelCommand } from "./config.ts";
import { fileServerCommand } from "./file-server.ts";
import { translateCommand } from "./translate.ts";
import { polishCommand } from "./polish.ts";
import type { Command } from "./types.ts";

// Single place that lists the CLI's commands. Registering a new command is one entry here.
export const COMMANDS: readonly Command[] = [
  commitCommand,
  translateCommand,
  polishCommand,
  fileServerCommand,
  configCommand,
  modelCommand,
];

export function helpText(): string {
  return `lgnh — developer CLI toolkit via OMP
Usage:
  lgnh [--plain | --tui] [command] [args...]
${COMMANDS.map((command) => command.help).join("\n")}
Output: a renderer opens only on a TTY outside output capture (OMP); the mode flags override that
selection, but never open a renderer on non-TTY streams. Put them before the command.`;
}
