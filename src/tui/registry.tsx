import type { JSX } from "solid-js";
import type { ClipboardService } from "@opentui/core";
import type { TuiOptions, TuiOutcome } from "./types.ts";
import type { ScreenMode } from "./screens.ts";
import type { OperationScope } from "./operations.ts";
import { TranslateScreen } from "./translate.tsx";
import { PolishScreen } from "./polish.tsx";
import { CommitScreen } from "./commit.tsx";
import { SettingsScreen } from "./settings.tsx";

export type ScreenKey = keyof typeof SCREEN_REGISTRY;

export interface ScreenContext {
  options: TuiOptions;
  mode: ScreenMode;
  operations: OperationScope;
  clipboard?: ClipboardService;
  onComplete: (outcome: TuiOutcome) => void;
  onBackToHome: () => void;
  suspendRenderer: () => void;
  resumeRenderer: () => void;
}

interface ScreenRegistryEntry {
  title: string;
  desc: string;
  shortcuts: string[];
  render: (ctx: ScreenContext) => JSX.Element;
}

export const SCREEN_REGISTRY = {
  translate: {
    title: "Translate (tr)",
    desc: "Bidirectional Korean/English translation",
    shortcuts: ["t"],
    render: (ctx) => (
      <TranslateScreen
        mode={ctx.mode}
        interactive={ctx.options.screen === "translate" ? ctx.options.interactive : true}
        initialText={ctx.options.screen === "translate" ? ctx.options.text : undefined}
        clipboard={ctx.clipboard}
        onComplete={ctx.onComplete}
        onBackToHome={ctx.onBackToHome}
        operations={ctx.operations}
      />
    ),
  },
  polish: {
    title: "Polish (polish)",
    desc: "Rewrite text in natural expression, same language",
    shortcuts: ["p"],
    render: (ctx) => (
      <PolishScreen
        mode={ctx.mode}
        interactive={ctx.options.screen === "polish" ? ctx.options.interactive : true}
        initialText={ctx.options.screen === "polish" ? ctx.options.text : undefined}
        clipboard={ctx.clipboard}
        onComplete={ctx.onComplete}
        onBackToHome={ctx.onBackToHome}
        operations={ctx.operations}
      />
    ),
  },
  commit: {
    title: "Commit (commit)",
    desc: "AI-generated commit message workflow",
    shortcuts: ["c"],
    render: (ctx) => (
      <CommitScreen
        mode={ctx.mode}
        initialOptions={ctx.options.screen === "commit" ? ctx.options.options : undefined}
        onComplete={ctx.onComplete}
        onBackToHome={ctx.onBackToHome}
        operations={ctx.operations}
        suspendRenderer={ctx.suspendRenderer}
        resumeRenderer={ctx.resumeRenderer}
      />
    ),
  },
  settings: {
    title: "Settings (config)",
    desc: "Configure active model and settings",
    shortcuts: ["s"],
    render: (ctx) => <SettingsScreen onBackToHome={ctx.onBackToHome} />,
  },
} satisfies Record<string, ScreenRegistryEntry>;

export const SCREEN_MENU = Object.entries(SCREEN_REGISTRY).map(([key, entry], index) => ({
  ...entry,
  key: key as ScreenKey,
  title: `${index + 1}. ${entry.title}`,
  shortcuts: [String(index + 1), ...entry.shortcuts],
}));
