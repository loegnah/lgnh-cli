import { formatError } from "../errors.ts";
import { addPolishHistory } from "../history.ts";
import { polishText } from "../omp.ts";
import type { Command, CommandEnv } from "./types.ts";

async function polishPlain(text: string, progress: boolean): Promise<void> {
  try {
    const { text: polished, resolvedModel } = await polishText(text, (fromModel, toModel) => {
      if (progress) console.log(`${fromModel} unavailable → using ${toModel}`);
    });
    if (progress) console.log(`Polished (${resolvedModel})`);
    console.log(progress ? `\n${polished}\n` : polished);
  } catch (err) {
    console.error(formatError(err));
    process.exitCode = 1;
  }
}

async function runPolish(inputArgs: string[], env: CommandEnv): Promise<void> {
  const interactiveFlag = inputArgs.some((a) => a === "-i" || a === "--interactive");
  const text = inputArgs
    .filter((a) => a !== "-i" && a !== "--interactive")
    .join(" ")
    .trim();

  if (env.tuiEligible) {
    await env.runTui({
      screen: "polish",
      interactive: interactiveFlag,
      ...(text ? { text } : {}),
    });
    return;
  }

  if (text) {
    addPolishHistory(text);
    await polishPlain(text, Boolean(process.stdout.isTTY));
    return;
  }

  // Plain output leaves no editor to fall back on, and an interactive stdin has no EOF: reading it
  // would block forever under output capture (OMP PTY). Ask for arguments or a pipe instead.
  if (process.stdin.isTTY) {
    console.error("No text to polish.");
    process.exitCode = 1;
    return;
  }

  const piped = (await Bun.stdin.text()).trim();
  if (!piped) {
    console.error("No text to polish.");
    process.exitCode = 1;
    return;
  }
  await polishPlain(piped, Boolean(process.stdout.isTTY));
}

export const polishCommand: Command = {
  names: ["polish", "pl"],
  help: [
    "  lgnh polish [text...]               polish text in place (same language, natural expression)",
    "  lgnh polish -i                      interactive loop mode",
  ].join("\n"),
  async run({ args }, env): Promise<void> {
    await runPolish(args, env);
  },
};
