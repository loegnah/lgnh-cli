import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface LgnhConfig {
  openrouter?: {
    key?: string;
    model?: string;
  };
}

export const DEFAULT_MODEL = "google/gemini-2.5-flash";

export function getConfigPath(): string {
  if (process.env.LGNH_CONFIG_PATH) return process.env.LGNH_CONFIG_PATH;
  const dir = join(homedir(), ".config", "lgnh");
  mkdirSync(dir, { recursive: true });
  return join(dir, "config.json");
}

export function loadConfig(): LgnhConfig {
  const path = getConfigPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as LgnhConfig;
  } catch {
    console.warn(`Warning: failed to parse config at ${path}, using defaults.`);
    return {};
  }
}

export function saveConfig(config: LgnhConfig): void {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export function getOpenRouterKey(): string {
  const key = loadConfig().openrouter?.key;
  if (!key) {
    console.error("OpenRouter API key is not set.\nRun: lgnh config set-key <key>");
    process.exit(1);
  }
  return key;
}

export function getOpenRouterModel(): string {
  return loadConfig().openrouter?.model || DEFAULT_MODEL;
}
