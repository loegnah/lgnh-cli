import { commitCommand } from "./commands/commit.ts";
import { configCommand, modelCommand } from "./commands/config.ts";
import { translateCommand } from "./commands/translate.ts";
import type { Command } from "./commands/types.ts";
import type { TuiOptions, TuiOutcome } from "./tui/app.tsx";

const tuiEligible = Boolean(process.stdin.isTTY && process.stdout.isTTY);

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

const COMMANDS: Command[] = [commitCommand, translateCommand, configCommand, modelCommand];

function help(): void {
  console.log(`lgnh — developer CLI toolkit via OMP
Usage:
${COMMANDS.map((cmd) => cmd.help).join("\n")}`);
}

const args = process.argv.slice(2);
// Flags may precede the command (`lgnh -e commit`); match on the first non-flag arg.
const name = args.find((a) => a !== "-e" && a !== "--edit");
const command = name ? COMMANDS.find((cmd) => cmd.names.includes(name)) : undefined;

if (command) {
  await command.run(args, { tuiEligible, runTui: runTuiAndPrint });
} else if (args.length === 0 && tuiEligible) {
  await runTuiAndPrint({ screen: "home" });
} else {
  help();
}
