import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_HISTORY = 100;

export function getTranslateHistoryPath(): string {
  return getHistoryPath("translate_history.json", "LGNH_HISTORY_PATH");
}

export function getPolishHistoryPath(): string {
  return getHistoryPath("polish_history.json", "LGNH_POLISH_HISTORY_PATH");
}

function getHistoryPath(filename: string, envVar: string): string {
  const override = process.env[envVar];
  if (override) return override;
  const dir = join(homedir(), ".config", "lgnh");
  mkdirSync(dir, { recursive: true });
  return join(dir, filename);
}

export function loadTranslateHistory(): string[] {
  return loadHistoryFrom(getTranslateHistoryPath());
}

export function loadPolishHistory(): string[] {
  return loadHistoryFrom(getPolishHistoryPath());
}

function loadHistoryFrom(path: string): string[] {
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
  saveHistoryTo(getTranslateHistoryPath(), history);
}

export function savePolishHistory(history: string[]): void {
  saveHistoryTo(getPolishHistoryPath(), history);
}

function saveHistoryTo(path: string, history: string[]): void {
  try {
    writeFileSync(path, JSON.stringify(history), { mode: 0o600 });
  } catch {
    // History is a convenience; a failed write must not break the feature.
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

export function addPolishHistory(text: string): string[] {
  const trimmed = text.trim();
  const history = loadPolishHistory();
  if (!trimmed) return history;
  const updated = [...history.filter((entry) => entry !== trimmed), trimmed].slice(-MAX_HISTORY);
  savePolishHistory(updated);
  return updated;
}
