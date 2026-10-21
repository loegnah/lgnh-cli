import { formatError } from "../errors.ts";
import { addTranslateHistory } from "../history.ts";
import { formatUsage, translateText } from "../omp.ts";
import type { Command, CommandEnv } from "./types.ts";

async function translatePlain(text: string, progress: boolean): Promise<void> {
  try {
    const {
      text: translated,
      resolvedModel,
      usage,
    } = await translateText(text, (fromModel, toModel) => {
      if (progress) console.log(`${fromModel} unavailable → using ${toModel}`);
    });
    if (progress) {
      const usageText = formatUsage(usage);
      console.log(
        usageText
          ? `Translated (${resolvedModel}) · ${usageText}`
          : `Translated (${resolvedModel})`,
      );
    }
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
    addTranslateHistory(text);
    await translatePlain(text, Boolean(process.stdout.isTTY));
    return;
  }

  // Plain output leaves no editor to fall back on, and an interactive stdin has no EOF: reading it
  // would block forever under output capture (OMP PTY). Ask for arguments or a pipe instead.
  if (process.stdin.isTTY) {
    console.error("No text to translate.");
    process.exitCode = 1;
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
  async run({ args }, env): Promise<void> {
    await runTranslate(args, env);
  },
};
