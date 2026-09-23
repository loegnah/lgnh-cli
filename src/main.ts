import { createInterface } from "node:readline/promises";

import {
  DEFAULT_MODEL,
  getConfigPath,
  getOpenRouterModel,
  loadConfig,
  saveConfig,
} from "./config.ts";
import { executeCommit, getStagedDiff, runProjectVerification } from "./git.ts";
import { generateCommitMessage, searchModels } from "./openrouter.ts";

async function runCommit(verify: boolean, edit: boolean): Promise<void> {
  try {
    if (verify) await runProjectVerification();
    const staged = await getStagedDiff();
    if (!staged) {
      console.log("Nothing to commit: working tree clean.");
      return;
    }
    const message = await generateCommitMessage(`${staged.stat}\n\n${staged.diff}`);
    console.log(message);
    await executeCommit(message, edit);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

function showConfig(): void {
  const config = loadConfig();
  const key = config.openrouter?.key;
  console.log(`Config: ${getConfigPath()}`);
  console.log(
    `API key: ${key ? `${key.slice(0, 7)}... (set)` : "(not set — lgnh config set-key <key>)"}`,
  );
  console.log(`Model: ${config.openrouter?.model || DEFAULT_MODEL}`);
}

function showModel(): void {
  console.log(getOpenRouterModel());
}

async function searchAndPick(query?: string): Promise<void> {
  try {
    const models = await searchModels(query);
    const top = models.slice(0, 30);
    if (top.length === 0) {
      console.log("No models found.");
      return;
    }
    top.forEach((m, i) => {
      console.log(
        `${i + 1}. ${m.id} (ctx: ${m.context_length}, $in/out: ${m.promptPrice}/${m.completionPrice})`,
      );
    });
    if (models.length > top.length)
      console.log(`... and ${models.length - top.length} more (refine query)`);
    if (!process.stdin.isTTY) return;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("Select number (Enter to skip): ")).trim();
    rl.close();
    const n = Number(answer);
    if (!answer || !Number.isInteger(n) || n < 1 || n > top.length) return;
    const picked = top[n - 1]!;
    const config = loadConfig();
    saveConfig({ ...config, openrouter: { ...config.openrouter, model: picked.id } });
    console.log(`Model set to ${picked.id}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

function help(): void {
  console.log(`lgnh — git diff based commit messages via OpenRouter
Usage:
  lgnh commit [-e|--edit]        verify, generate message, commit
  lgnh commit-fast [-e|--edit]   skip verification
  lgnh config                    show config path, key status, model
  lgnh config set-key <key>      save OpenRouter API key
  lgnh model                     show current model
  lgnh model <id>                set model directly
  lgnh model search [query]      search models, pick interactively`);
}

const args = process.argv.slice(2);
const edit = args.includes("-e") || args.includes("--edit");
const rest = args.filter((a) => a !== "-e" && a !== "--edit");

if (rest[0] === "commit") {
  await runCommit(true, edit);
} else if (rest[0] === "commit-fast") {
  await runCommit(false, edit);
} else if (rest[0] === "config" && rest[1] === "set-key" && rest[2]) {
  const config = loadConfig();
  saveConfig({ ...config, openrouter: { ...config.openrouter, key: rest[2] } });
  console.log("API key saved.");
} else if (rest[0] === "config") {
  showConfig();
} else if (rest[0] === "model" && rest[1] === "search") {
  await searchAndPick(rest[2]);
} else if (rest[0] === "model" && rest[1]) {
  const config = loadConfig();
  saveConfig({ ...config, openrouter: { ...config.openrouter, model: rest[1] } });
  console.log(`Model set to ${rest[1]}`);
} else if (rest[0] === "model") {
  showModel();
} else {
  help();
}
