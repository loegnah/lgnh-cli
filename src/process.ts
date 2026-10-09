export interface ProcessOptions {
  cwd?: string;
  signal?: AbortSignal;
  inherit?: boolean;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function descendantPids(rootPid: number): number[] {
  const snapshot = Bun.spawnSync(["ps", "-Ao", "pid=,ppid="]);
  if (snapshot.exitCode !== 0) return [];

  const children = new Map<number, number[]>();
  for (const line of snapshot.stdout.toString().split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid || ppid === undefined || !Number.isInteger(ppid)) continue;
    const siblings = children.get(ppid);
    if (siblings) siblings.push(pid);
    else children.set(ppid, [pid]);
  }

  const descendants: number[] = [];
  const visited = new Set([rootPid]);
  const pending = [rootPid];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (const child of children.get(current) ?? []) {
      if (visited.has(child)) continue;
      visited.add(child);
      descendants.push(child);
      pending.push(child);
    }
  }
  return descendants;
}

export async function runProcess(
  args: string[],
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const { cwd, signal, inherit } = options;
  signal?.throwIfAborted();

  // No `detached` and no spawn `signal`: captured commands keep the session and controlling
  // terminal (Git credential and signing prompts read /dev/tty), and the abort handler must
  // snapshot the descendant tree while the root is still alive — a root that dies first orphans
  // its children, which then keep the captured pipes open and the reads below never settle.
  const proc = Bun.spawn(args, {
    cwd,
    stdin: inherit ? "inherit" : "ignore",
    stdout: inherit ? "inherit" : "pipe",
    stderr: inherit ? "inherit" : "pipe",
  });

  const killTree = signal
    ? () => {
        if (process.platform === "win32") {
          // taskkill /t walks the tree and needs the root alive; it terminates the root as well.
          void Bun.spawn(["taskkill", "/pid", String(proc.pid), "/t", "/f"], {
            stdout: "ignore",
            stderr: "ignore",
          });
          return;
        }
        for (const pid of descendantPids(proc.pid)) {
          try {
            process.kill(pid, "SIGTERM");
          } catch {}
        }
        proc.kill();
      }
    : undefined;

  if (killTree) {
    signal?.addEventListener("abort", killTree, { once: true });
    if (signal?.aborted) killTree();
  }

  try {
    const [stdout, stderr] = await Promise.all([
      proc.stdout instanceof ReadableStream ? new Response(proc.stdout).text() : "",
      proc.stderr instanceof ReadableStream ? new Response(proc.stderr).text() : "",
    ]);
    const exitCode = await proc.exited;
    signal?.throwIfAborted();
    return { stdout, stderr, exitCode };
  } finally {
    if (killTree) signal?.removeEventListener("abort", killTree);
  }
}
