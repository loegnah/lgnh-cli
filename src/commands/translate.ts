import { formatError } from "../errors.ts";
import { translateText } from "../omp.ts";
import type { Command, CommandEnv } from "./types.ts";

async function translatePlain(text: string, progress: boolean): Promise<void> {
  try {
    const { text: translated, resolvedModel } = await translateText(text, (fromModel, toModel) => {
      if (progress) console.log(`${fromModel} unavailable → using ${toModel}`);
    });
    if (progress) console.log(`Translated (${resolvedModel})`);
    console.log(progress ? `\n${translated}\n` : translated);
  } catch (err) {
    console.error(formatError(err));
    process.exitCode = 1;
  }
}

async function runTranslate(inputArgs: string[], env: CommandEnv): Promise<void> {
  const interactiveFlag = inputArgs.some((a) => a === "-i" || a === "--interactive");
  const text = inputArgs
    .filter((a) => a !== "-i" && a !== "--interactive")
    .join(" ")
    .trim();

  if (env.tuiEligible) {
    await env.runTui({
      screen: "translate",
      interactive: interactiveFlag,
      ...(text ? { text } : {}),
    });
    return;
  }

  if (text) {
    await translatePlain(text, Boolean(process.stdout.isTTY));
    return;
  }

  const piped = (await Bun.stdin.text()).trim();
  if (!piped) {
    console.error("No text to translate.");
    process.exitCode = 1;
    return;
  }
  await translatePlain(piped, Boolean(process.stdout.isTTY));
}

export const translateCommand: Command = {
  names: ["tr", "translate"],
  help: [
    "  lgnh tr [text...]                   translate text (KR ⇄ EN, or multi-line paste)",
    "  lgnh tr -i                          interactive loop mode",
  ].join("\n"),
  async run(args: string[], env: CommandEnv): Promise<void> {
    const at = args.findIndex((a) => translateCommand.names.includes(a));
    const inputArgs = at >= 0 ? [...args.slice(0, at), ...args.slice(at + 1)] : args;
    await runTranslate(inputArgs, env);
  },
};
