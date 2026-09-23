import { DEFAULT_MODEL, getConfigPath, getModel, loadConfig, saveConfig } from "./config.ts";
import { executeCommit, getStagedDiff, runProjectVerification } from "./git.ts";
import { generateCommitMessage } from "./omp.ts";

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
  console.log(`Config: ${getConfigPath()}`);
  console.log(`Model: ${config.model || DEFAULT_MODEL}`);
}

function showModel(): void {
  console.log(getModel());
}

function help(): void {
  console.log(`lgnh — git diff based commit messages via OMP
Usage:
  lgnh commit [-e|--edit]        verify, generate message, commit
  lgnh commit-fast [-e|--edit]   skip verification
  lgnh config                    show config path, model
  lgnh model                     show current model
  lgnh model <id>                set model directly`);
}

const args = process.argv.slice(2);
const edit = args.includes("-e") || args.includes("--edit");
const rest = args.filter((a) => a !== "-e" && a !== "--edit");

if (rest[0] === "commit") {
  await runCommit(true, edit);
} else if (rest[0] === "commit-fast") {
  await runCommit(false, edit);
} else if (rest[0] === "config") {
  showConfig();
} else if (rest[0] === "model" && rest[1]) {
  const config = loadConfig();
  saveConfig({ ...config, model: rest[1] });
  console.log(`Model set to ${rest[1]}`);
} else if (rest[0] === "model") {
  showModel();
} else {
  help();
}
