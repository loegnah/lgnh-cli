import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { addTranslateHistory, getTranslateHistoryPath, loadTranslateHistory } from "./history.ts";

const dirs: string[] = [];

function useTempHistory(): string {
  const dir = mkdtempSync(join(tmpdir(), "lgnh-history-"));
  dirs.push(dir);
  const path = join(dir, "translate_history.json");
  process.env.LGNH_HISTORY_PATH = path;
  return path;
}

afterEach(() => {
  delete process.env.LGNH_HISTORY_PATH;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("getTranslateHistoryPath honors LGNH_HISTORY_PATH", () => {
  const path = useTempHistory();
  expect(getTranslateHistoryPath()).toBe(path);
});

test("loadTranslateHistory returns an empty array when the file is missing or corrupt", () => {
  const path = useTempHistory();
  expect(loadTranslateHistory()).toEqual([]);

  writeFileSync(path, "{ not json");
  expect(loadTranslateHistory()).toEqual([]);

  writeFileSync(path, JSON.stringify({ a: 1 }));
  expect(loadTranslateHistory()).toEqual([]);
});

test("loadTranslateHistory filters non-strings and deduplicates with the last occurrence winning", () => {
  const path = useTempHistory();
  writeFileSync(path, JSON.stringify(["first", 42, "second", "first", null, "second"]));
  expect(loadTranslateHistory()).toEqual(["first", "second"]);
});

test("loadTranslateHistory keeps only the most recent 100 entries", () => {
  const path = useTempHistory();
  writeFileSync(path, JSON.stringify(Array.from({ length: 150 }, (_, i) => `entry-${i}`)));

  const loaded = loadTranslateHistory();
  expect(loaded).toHaveLength(100);
  expect(loaded[0]).toBe("entry-50");
  expect(loaded[99]).toBe("entry-149");
});

test("addTranslateHistory trims, deduplicates to the newest position, caps at 100, and persists", () => {
  const path = useTempHistory();

  expect(addTranslateHistory("  hello  ")).toEqual(["hello"]);
  addTranslateHistory("world");
  addTranslateHistory("hello");
  expect(loadTranslateHistory()).toEqual(["world", "hello"]);

  for (let i = 0; i < 120; i++) addTranslateHistory(`text-${i}`);
  const persisted = JSON.parse(readFileSync(path, "utf-8")) as string[];
  expect(persisted).toHaveLength(100);
  expect(persisted[99]).toBe("text-119");

  expect(addTranslateHistory("   ")).toEqual(persisted);
  expect(statSync(path).mode & 0o777).toBe(0o600);
});
