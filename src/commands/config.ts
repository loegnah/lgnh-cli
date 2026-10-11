import { DEFAULT_MODEL, getConfigPath, getModel, loadConfig, saveConfig } from "../config.ts";
import type { Command, CommandEnv } from "./types.ts";

function showConfig(): void {
  const config = loadConfig();
  console.log(`Config: ${getConfigPath()}`);
  console.log(`Model: ${config.model || DEFAULT_MODEL}`);
}

export const configCommand: Command = {
  names: ["config"],
  help: "  lgnh config                         show config path, model",
  async run(_args: string[], _env: CommandEnv): Promise<void> {
    showConfig();
  },
};

export const modelCommand: Command = {
  names: ["model"],
  help: [
    "  lgnh model                          show current model",
    "  lgnh model <id>                     set model directly",
  ].join("\n"),
  async run(args: string[], _env: CommandEnv): Promise<void> {
    const at = args.findIndex((a) => a === "model");
    const rest = (at >= 0 ? [...args.slice(0, at), ...args.slice(at + 1)] : args).filter(
      (a) => a !== "-e" && a !== "--edit",
    );
    const targetModel = rest[0];
    if (targetModel) {
      const config = loadConfig();
      saveConfig({ ...config, model: targetModel });
      console.log(`Model set to ${targetModel}`);
    } else {
      console.log(getModel());
    }
  },
};
