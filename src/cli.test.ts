import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveDispatch, parseOutputMode, resolveOutputMode } from "./cli.ts";
import { formatCost, formatUsage } from "./omp.ts";

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

test("auto mode follows TTY state and output capture", () => {
  // Ordinary interactive terminal keeps the renderer.
  expect(resolveOutputMode("auto", true, { TERM: "xterm-256color" })).toBe("tui");
  // OMP runs `!<cmd>` in a PTY: both TTY checks pass, so its marker decides.
  expect(resolveOutputMode("auto", true, { OMPCODE: "1", TERM: "xterm-256color" })).toBe("plain");
  // A terminal without cursor addressing cannot host the renderer either.
  expect(resolveOutputMode("auto", true, { TERM: "dumb" })).toBe("plain");
  // Pipes are plain no matter what the environment claims.
  expect(resolveOutputMode("auto", false, { TERM: "xterm-256color" })).toBe("plain");
  expect(resolveOutputMode("tui", false, { TERM: "xterm-256color" })).toBe("plain");
  // Unrelated CI markers are not capture.
  expect(resolveOutputMode("auto", true, { AGENT: "1", CI: "true", OMPCODE: "" })).toBe("tui");
  // Explicit flags beat the environment in both directions.
  expect(resolveOutputMode("plain", true, { TERM: "xterm-256color" })).toBe("plain");
  expect(resolveOutputMode("tui", true, { OMPCODE: "1" })).toBe("tui");
});

test("leading mode flags are consumed and never leak into command arguments", () => {
  const plain = parseOutputMode(["--plain", "commit"]);
  expect(plain.request).toBe("plain");
  expect(plain.args).toEqual(["commit"]);
  expect(plain.error).toBeUndefined();

  // Edit flags keep their position and stay visible to the command.
  const mixed = parseOutputMode(["-e", "--plain", "model", "gpt-x"]);
  expect(mixed.request).toBe("plain");
  expect(mixed.args).toEqual(["-e", "model", "gpt-x"]);

  // Flags after the command token are payload: translation text must survive untouched.
  const payload = parseOutputMode(["tr", "--plain", "--tui"]);
  expect(payload.request).toBe("auto");
  expect(payload.args).toEqual(["tr", "--plain", "--tui"]);
  expect(resolveDispatch(payload.args, true).kind).toBe("command");

  // Contradictory flags are a usage error rather than a silent winner.
  expect(parseOutputMode(["--plain", "--tui", "commit"]).error).toBe(
    "--plain and --tui cannot be combined.",
  );
  expect(parseOutputMode(["--tui", "--tui", "commit"]).error).toBeUndefined();
  expect(parseOutputMode(["--plain"]).args).toEqual([]);
});

test("contradictory mode flags fail before any command runs", async () => {
  const proc = Bun.spawn(["bun", bin, "--plain", "--tui", "config"], {
    cwd: repoRoot,
    env: { ...process.env, OMPCODE: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  expect(await proc.exited, stderr).toBe(1);
  expect(stderr).toContain("--plain and --tui cannot be combined.");
  expect(stdout).not.toContain("Config:");
});

test("formatCost and formatUsage format token counts and variable-scale USD costs", () => {
  expect(formatCost(0)).toBe("$0");
  expect(formatCost(0.03100725)).toBe("$0.031");
  expect(formatCost(0.0012)).toBe("$0.0012");
  expect(formatCost(0.00018)).toBe("$0.00018");

  expect(formatUsage()).toBe("");
  expect(formatUsage({ input: 1200, output: 80, totalTokens: 1280, cost: 0.0012 })).toBe(
    "1,280 tokens (in 1,200 · out 80) · $0.0012",
  );
  expect(formatUsage({ input: 50, output: 10, totalTokens: 60 })).toBe(
    "60 tokens (in 50 · out 10)",
  );
});
