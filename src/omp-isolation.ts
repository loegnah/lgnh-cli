import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG = `memory:
  backend: off
autolearn:
  enabled: false
advisor:
  enabled: false
compaction:
  enabled: false
magicKeywords:
  enabled: false
autoResume: false
`;

const EXTENSION = `export default function (omp) {
  let request;
  omp.on("before_agent_start", (event) => {
    request = JSON.parse(Buffer.from(event.prompt, "base64").toString("utf8"));
    omp.setActiveTools([]);
    // An empty system prompt prevents OMP's automatic date/cwd reminder.
    return { systemPrompt: [] };
  });
  omp.on("context", () => ({
    messages: [
      { role: "developer", content: request.instructions, timestamp: 0 },
      { role: "user", content: request.input, timestamp: 0 }
    ]
  }));
}`;

export function ensureIsolationFiles(dir: string): { configPath: string; extensionPath: string } {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const paths = { configPath: join(dir, "config.yml"), extensionPath: join(dir, "isolation.js") };
  for (const [path, content] of [
    [paths.configPath, CONFIG],
    [paths.extensionPath, EXTENSION],
  ] as const) {
    try {
      if (readFileSync(path, "utf8") === content) continue;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }

    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, content, { mode: 0o600 });
      renameSync(temporaryPath, path);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }
  return paths;
}
