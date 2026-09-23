import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface DeployConfig {
  targetDir: string;
}

function getDeployConfig(): DeployConfig | null {
  const configPath = ".deploy.json";
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as DeployConfig;
  } catch {
    return null;
  }
}

function main() {
  const config = getDeployConfig();
  if (!config?.targetDir) {
    console.error("❌ Deploy path not configured. Run 'bun run setup' first.");
    process.exit(1);
  }

  const source = "dist/lgnh";
  if (!existsSync(source)) {
    console.error(`❌ Build file (${source}) not found.`);
    process.exit(1);
  }

  mkdirSync(config.targetDir, { recursive: true });
  const target = join(config.targetDir, "lgnh");
  copyFileSync(source, target);

  console.log(`✔ Deployed: ${source} -> ${target}`);
}

main();
