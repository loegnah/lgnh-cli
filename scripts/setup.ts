import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const DEFAULT_DEPLOY_PATH = ".agents/bin";

export function resolveDeployPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return join(homedir(), DEFAULT_DEPLOY_PATH);
  }
  if (trimmed.startsWith("~/")) {
    return join(homedir(), trimmed.slice(2));
  }
  if (trimmed === "~") {
    return homedir();
  }
  if (isAbsolute(trimmed)) {
    return resolve(trimmed);
  }
  return join(homedir(), trimmed);
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("Configure deployment target directory.");
  console.log("Paths are resolved relative to your home directory (~).");
  console.log("Example: '.agents/bin' -> '~/.agents/bin'\n");

  const answer = await rl.question("Enter deploy directory [default: ~/.agents/bin]: ");
  rl.close();

  const resolved = resolveDeployPath(answer);
  const config = { targetDir: resolved };
  writeFileSync(".deploy.json", JSON.stringify(config, null, 2) + "\n");

  console.log(`\n✔ Deploy path saved: ${resolved}`);
  console.log("Run 'bun run deploy' to build and copy the binary.");
}

if (import.meta.main) {
  main();
}
