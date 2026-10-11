import { createSignal, Show, For } from "solid-js";
import { render, useKeyboard } from "@opentui/solid";
import {
  createCliRenderer,
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
} from "@opentui/core";
import { type CommitOptions, formatError } from "../workflows.ts";
import { getModel } from "../config.ts";
import { TranslateScreen } from "./translate.tsx";
import { CommitScreen } from "./commit.tsx";
import { SettingsScreen } from "./settings.tsx";

export type TuiOptions =
  | { screen: "home" }
  | { screen: "translate"; interactive: boolean; text?: string }
  | { screen: "commit"; options: CommitOptions };

export interface TuiOutcome {
  exitCode: 0 | 1 | 130;
  stdout?: string;
  stderr?: string;
}

interface MenuItem {
  key: "translate" | "commit" | "settings" | "exit";
  title: string;
  desc: string;
}

function HomeScreen(props: {
  onNavigate: (screen: "translate" | "commit" | "settings") => void;
  onExit: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const MENU_ITEMS: MenuItem[] = [
    {
      key: "translate",
      title: "1. Translate (tr)",
      desc: "Bidirectional Korean/English translation",
    },
    {
      key: "commit",
      title: "2. Commit (commit)",
      desc: "AI-generated commit message workflow",
    },
    {
      key: "settings",
      title: "3. Settings (config)",
      desc: "Configure active model and settings",
    },
    {
      key: "exit",
      title: "4. Exit",
      desc: "Quit LGNH application",
    },
  ];

  useKeyboard((e) => {
    if (e.ctrl || e.meta || e.super) return;
    e.preventDefault();
    if (e.name === "up" || e.name === "k") {
      setSelectedIndex((prev) => (prev - 1 + MENU_ITEMS.length) % MENU_ITEMS.length);
    } else if (e.name === "down" || e.name === "j") {
      setSelectedIndex((prev) => (prev + 1) % MENU_ITEMS.length);
    } else if (e.name === "return") {
      const item = MENU_ITEMS[selectedIndex()];
      if (item && item.key === "exit") {
        props.onExit();
      } else if (item && item.key !== "exit") {
        props.onNavigate(item.key);
      }
    } else if (e.name === "1" || e.name === "t") {
      props.onNavigate("translate");
    } else if (e.name === "2" || e.name === "c") {
      props.onNavigate("commit");
    } else if (e.name === "3" || e.name === "s") {
      props.onNavigate("settings");
    } else if (e.name === "4" || e.name === "q" || e.name === "escape") {
      props.onExit();
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      {/* Title */}
      <box flexDirection="column" alignItems="center" marginY={1}>
        <text fg="cyan">=== LGNH Terminal App ===</text>
        <text fg="#888888">Active Model: {getModel()}</text>
      </box>

      {/* Menu Box */}
      <box
        borderStyle="rounded"
        borderColor="cyan"
        title="Main Menu"
        flexDirection="column"
        padding={1}
        marginY={1}
      >
        <For each={MENU_ITEMS}>
          {(item, idx) => {
            const isSelected = () => selectedIndex() === idx();
            return (
              <box
                flexDirection="row"
                paddingY={0}
                backgroundColor={isSelected() ? "cyan" : undefined}
              >
                <text fg={isSelected() ? "black" : "white"}>
                  {isSelected() ? " > " : "   "}
                  {item.title}
                </text>
                <text fg={isSelected() ? "black" : "#666666"} marginLeft={2}>
                  — {item.desc}
                </text>
              </box>
            );
          }}
        </For>
      </box>

      {/* Footer */}
      <box marginTop="auto">
        <text fg="#666666">
          [↑/↓ / j/k] Navigate [Enter] Select [1-4 / t/c/s] Quick Select [q/Esc] Exit
        </text>
      </box>
    </box>
  );
}

export async function runTui(options: TuiOptions): Promise<TuiOutcome> {
  const { promise: closedPromise, resolve: closedResolve } = Promise.withResolvers<void>();
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    exitSignals: [],
    onDestroy: closedResolve,
  });

  const hostClipboard = createHostClipboard();
  const terminalClipboard = createRendererClipboardAdapter(renderer);
  const clipboard = createClipboard({ host: hostClipboard, terminal: terminalClipboard });

  const { promise: outcomePromise, resolve: resolveOutcome } = Promise.withResolvers<TuiOutcome>();

  let isShuttingDown = false;
  let activeAbortController: AbortController | null = null;
  let activeOperationPromise: Promise<void> | null = null;

  async function shutdown(outcome: TuiOutcome) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    if (activeAbortController && !activeAbortController.signal.aborted) {
      activeAbortController.abort();
    }

    if (activeOperationPromise) {
      try {
        await activeOperationPromise;
      } catch {
        // Ignored during shutdown settlement
      }
    }

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
      process.stdout.write("\x1b[?1004l");
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
    } catch {
      // Ignored
    }
    resolveOutcome(outcome);
  }

  const handleInterrupt = () => shutdown({ exitCode: 130 });
  const errorHandler = ({ error }: { error: unknown }) =>
    shutdown({ exitCode: 1, stderr: formatError(error) });

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

  function App() {
    const initialScreen = options.screen === "home" ? "home" : options.screen;
    const mode = options.screen === "home" ? "integrated" : "direct";
    const [currentScreen, setCurrentScreen] = createSignal<
      "home" | "translate" | "commit" | "settings"
    >(initialScreen);
    const [isBusy, setIsBusy] = createSignal(false);

    useKeyboard((e) => {
      if (e.ctrl && (e.name === "c" || e.raw === "\x03")) {
        e.stopPropagation();
        shutdown({ exitCode: 130 });
      }
    });

    const handleNavigate = (next: "home" | "translate" | "commit" | "settings") => {
      if (isBusy()) return;
      setCurrentScreen(next);
    };

    const registerOperation = (controller: AbortController, promise: Promise<void>) => {
      activeAbortController = controller;
      activeOperationPromise = promise;
      promise.finally(() => {
        if (activeAbortController === controller) {
          activeAbortController = null;
        }
        if (activeOperationPromise === promise) {
          activeOperationPromise = null;
        }
      });
    };

    return (
      <box width="100%" height="100%" flexDirection="column">
        <Show when={currentScreen() === "home"}>
          <HomeScreen onNavigate={handleNavigate} onExit={() => shutdown({ exitCode: 0 })} />
        </Show>
        <Show when={currentScreen() === "translate"}>
          <TranslateScreen
            mode={mode}
            interactive={options.screen === "translate" ? options.interactive : true}
            initialText={options.screen === "translate" ? options.text : undefined}
            clipboard={clipboard}
            onComplete={(outcome) => shutdown(outcome)}
            onBackToHome={() => handleNavigate("home")}
            setBusy={setIsBusy}
            registerOperation={registerOperation}
          />
        </Show>
        <Show when={currentScreen() === "commit"}>
          <CommitScreen
            mode={mode}
            initialOptions={options.screen === "commit" ? options.options : undefined}
            onComplete={(outcome) => shutdown(outcome)}
            onBackToHome={() => handleNavigate("home")}
            setBusy={setIsBusy}
            registerOperation={registerOperation}
            suspendRenderer={() => renderer.suspend()}
            resumeRenderer={() => renderer.resume()}
          />
        </Show>
        <Show when={currentScreen() === "settings"}>
          <SettingsScreen onBackToHome={() => handleNavigate("home")} />
        </Show>
      </box>
    );
  }

  try {
    await render(() => <App />, renderer);
  } catch (error) {
    await shutdown({ exitCode: 1, stderr: formatError(error) });
  }

  return outcomePromise;
}
