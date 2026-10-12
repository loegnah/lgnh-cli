import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_HISTORY = 100;

export function getTranslateHistoryPath(): string {
  if (process.env.LGNH_HISTORY_PATH) return process.env.LGNH_HISTORY_PATH;
  const dir = join(homedir(), ".config", "lgnh");
  mkdirSync(dir, { recursive: true });
  return join(dir, "translate_history.json");
}

export function loadTranslateHistory(): string[] {
  const path = getTranslateHistoryPath();
  if (!existsSync(path)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const history: string[] = [];
    for (let i = parsed.length - 1; i >= 0; i--) {
      const entry = parsed[i];
      if (typeof entry !== "string" || seen.has(entry)) continue;
      seen.add(entry);
      history.unshift(entry);
    }
    return history.slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

export function saveTranslateHistory(history: string[]): void {
  try {
    writeFileSync(getTranslateHistoryPath(), JSON.stringify(history), { mode: 0o600 });
  } catch {
    // History is a convenience; a failed write must not break translation.
  }
}

export function addTranslateHistory(text: string): string[] {
  const trimmed = text.trim();
  const history = loadTranslateHistory();
  if (!trimmed) return history;
  const updated = [...history.filter((entry) => entry !== trimmed), trimmed].slice(-MAX_HISTORY);
  saveTranslateHistory(updated);
  return updated;
}
