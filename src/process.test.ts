import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runProcess } from "./process.ts";

function readPid(path: string): number | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const pid = Number(readFileSync(path, "utf-8"));
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

// Orphaned descendants are reparented and reaped asynchronously by the kernel, so liveness is
// polled: the awaited condition is the process disappearing, not a duration.
async function isGone(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await Bun.sleep(10);
  }
  return false;
}

test("runProcess aborts the process group so descendants die and captured output settles", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lgnh-process-"));
  const wrapperPidFile = join(dir, "wrapper.pid");
  const descendantPidFile = join(dir, "descendant.pid");
  const controller = new AbortController();
  let watcher: FSWatcher | undefined;
  let pending: Promise<unknown> | undefined;

  try {
    const started = new Promise<[number, number]>((resolve, reject) => {
      watcher = watch(dir, () => {
        const wrapperPid = readPid(wrapperPidFile);
        const descendantPid = readPid(descendantPidFile);
        if (wrapperPid !== undefined && descendantPid !== undefined) {
          resolve([wrapperPid, descendantPid]);
        }
      });
      watcher.on("error", reject);
    });

    // The wrapper hands the captured pipes to a long-lived descendant: if only the direct child is
    // killed, those pipes stay open and runProcess never settles.
    const wrapper = `
      Bun.write(${JSON.stringify(wrapperPidFile)}, String(process.pid));
      const descendant = Bun.spawn(["bun", "-e", "setInterval(() => {}, 1000)"], {
        stdout: "inherit",
        stderr: "inherit",
      });
      Bun.write(${JSON.stringify(descendantPidFile)}, String(descendant.pid));
      await descendant.exited;
    `;
    pending = runProcess(["bun", "-e", wrapper], { signal: controller.signal });

    const [wrapperPid, descendantPid] = await started;
    controller.abort();

    const error = await pending.then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(error).toHaveProperty("name", "AbortError");
    expect(await isGone(wrapperPid)).toBe(true);
    expect(await isGone(descendantPid)).toBe(true);
  } finally {
    controller.abort();
    if (pending) await pending.catch(() => {});
    watcher?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
