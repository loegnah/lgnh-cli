import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveDispatch } from "./cli.ts";

const repoRoot = join(import.meta.dir, "..");
const bin = join(repoRoot, "bin", "lgnh-cli.ts");

test("dispatch resolves the command once and preserves argument boundaries", async () => {
  // Command-like words after the command token are data, not a second command.
  const text = resolveDispatch(["tr", "commit", "push"], false);
  expect(text.kind).toBe("command");
  if (text.kind !== "command") return;
  expect(text.invocation.name).toBe("tr");
  expect(text.invocation.args).toEqual(["commit", "push"]);

  // The leading edit flag survives; the command token alone is removed.
  const flag = resolveDispatch(["-e", "model", "gpt-x"], false);
  expect(flag.kind).toBe("command");
  if (flag.kind !== "command") return;
  expect(flag.invocation.name).toBe("model");
  expect(flag.invocation.args).toEqual(["-e", "gpt-x"]);

  // No args opens the TUI only on a TTY; pipes and unknown commands fall back to help.
  expect(resolveDispatch([], true).kind).toBe("home");
  expect(resolveDispatch([], false).kind).toBe("help");
  expect(resolveDispatch(["does-not-exist"], true).kind).toBe("help");

  // End to end: the model target is not consumed by dispatch, and the flag-before-command form works.
  const dir = mkdtempSync(join(tmpdir(), "lgnh-dispatch-"));
  const configPath = join(dir, "config.json");
  try {
    const proc = Bun.spawn(["bun", bin, "-e", "model", "gpt-x"], {
      cwd: repoRoot,
      env: { ...process.env, LGNH_CONFIG_PATH: configPath },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    expect(exitCode, stderr).toBe(0);
    expect(JSON.parse(readFileSync(configPath, "utf-8"))).toMatchObject({ model: "gpt-x" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
