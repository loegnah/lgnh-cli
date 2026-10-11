import { createSignal, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { ClipboardService } from "@opentui/core";
import type { TuiOptions, TuiOutcome } from "./types.ts";
import type { OperationScope } from "./operations.ts";
import { HomeScreen } from "./home.tsx";
import { SCREEN_REGISTRY, type ScreenKey } from "./registry.tsx";

export interface AppProps {
  options: TuiOptions;
  operations: OperationScope;
  clipboard?: ClipboardService;
  onShutdown: (outcome: TuiOutcome) => void;
  suspendRenderer: () => void;
  resumeRenderer: () => void;
}

export type AppScreen = "home" | ScreenKey;

export function App(props: AppProps) {
  const initialScreen: AppScreen = props.options.screen === "home" ? "home" : props.options.screen;
  const mode = props.options.screen === "home" ? "integrated" : "direct";
  const [currentScreen, setCurrentScreen] = createSignal<AppScreen>(initialScreen);

  useKeyboard((e) => {
    if (e.ctrl && (e.name === "c" || e.raw === "\x03")) {
      e.stopPropagation();
      props.onShutdown({ exitCode: 130 });
    }
  });

  const handleNavigate = (next: AppScreen) => {
    if (props.operations.busy) {
      return;
    }
    setCurrentScreen(next);
  };

  return (
    <box width="100%" height="100%" flexDirection="column">
      <Show when={currentScreen() === "home"}>
        <HomeScreen
          onNavigate={(screen) => handleNavigate(screen)}
          onExit={() => props.onShutdown({ exitCode: 0 })}
        />
      </Show>
      <Show when={currentScreen() !== "home"}>
        {SCREEN_REGISTRY[currentScreen() as ScreenKey].render({
          options: props.options,
          mode,
          operations: props.operations,
          clipboard: props.clipboard,
          onComplete: (outcome) => props.onShutdown(outcome),
          onBackToHome: () => handleNavigate("home"),
          suspendRenderer: props.suspendRenderer,
          resumeRenderer: props.resumeRenderer,
        })}
      </Show>
    </box>
  );
}
