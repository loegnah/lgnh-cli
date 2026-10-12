import { render } from "@opentui/solid";
import {
  createCliRenderer,
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
} from "@opentui/core";
import { formatError } from "../errors.ts";
import type { TuiOptions, TuiOutcome } from "./types.ts";
import { OperationScope } from "./operations.ts";
import { App } from "./app.tsx";

export async function runTui(options: TuiOptions): Promise<TuiOutcome> {
  const { promise: closedPromise, resolve: closedResolve } = Promise.withResolvers<void>();
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    exitSignals: [],
    onDestroy: closedResolve,
    useMouse: false,
  });

  const hostClipboard = createHostClipboard();
  const terminalClipboard = createRendererClipboardAdapter(renderer);
  const clipboard = createClipboard({ host: hostClipboard, terminal: terminalClipboard });

  const { promise: outcomePromise, resolve: resolveOutcome } = Promise.withResolvers<TuiOutcome>();

  let isShuttingDown = false;
  const operations = new OperationScope();

  async function shutdown(outcome: TuiOutcome) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    await operations.cancel();

    try {
      await clipboard.dispose();
    } catch {
      // Ignored during cleanup
    }

    const hasRawMode = typeof process.stdin.setRawMode === "function";
    const originalSetRawMode = hasRawMode ? process.stdin.setRawMode.bind(process.stdin) : null;
    if (hasRawMode) {
      process.stdin.setRawMode = () => process.stdin;
    }

    renderer.destroy();
    await closedPromise;
    removeProcessListeners();

    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1004l\x1b[?1006l");
    }

    if (process.stdin.isTTY) {
      await Bun.sleep(15);
      try {
        while (process.stdin.read() !== null) {}
      } catch {
        // Ignored
      }
    }

    if (originalSetRawMode) {
      process.stdin.setRawMode = originalSetRawMode;
      try {
        originalSetRawMode(false);
      } catch {
        // Ignored
      }
    }
    try {
      process.stdin.pause();
      // OpenTUI leaves stdin in raw mode with a referenced uv_tty_t handle; without
      // unref the event loop never drains and the process hangs after runTui resolves.
      process.stdin.unref?.();
    } catch {
      // Ignored
    }
    resolveOutcome(outcome);
  }

  const handleInterrupt = () => {
    void shutdown({ exitCode: 130 });
  };
  const errorHandler = ({ error }: { error: unknown }) => {
    void shutdown({ exitCode: 1, stderr: formatError(error) });
  };

  process.on("SIGINT", handleInterrupt);
  process.on("SIGTERM", handleInterrupt);
  process.on("SIGHUP", handleInterrupt);
  renderer.on("render:error", errorHandler);
  renderer.on("handler:error", errorHandler);

  function removeProcessListeners() {
    process.removeListener("SIGINT", handleInterrupt);
    process.removeListener("SIGTERM", handleInterrupt);
    process.removeListener("SIGHUP", handleInterrupt);
    renderer.removeListener("render:error", errorHandler);
    renderer.removeListener("handler:error", errorHandler);
  }

  try {
    await render(
      () => (
        <App
          options={options}
          operations={operations}
          clipboard={clipboard}
          onShutdown={(outcome) => {
            void shutdown(outcome);
          }}
          suspendRenderer={() => {
            renderer.suspend();
            if (process.stdout.isTTY) {
              process.stdout.write("\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1004l\x1b[?1006l");
            }
          }}
          resumeRenderer={() => renderer.resume()}
        />
      ),
      renderer,
    );
  } catch (error) {
    await shutdown({ exitCode: 1, stderr: formatError(error) });
  }

  return outcomePromise;
}
