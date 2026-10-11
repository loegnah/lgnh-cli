import type { ClipboardService } from "@opentui/core";
import type { CommitOptions } from "../workflows.ts";
import type { TuiOutcome } from "./app.tsx";

export type ScreenMode = "integrated" | "direct";

export interface ScreenProps {
  mode: ScreenMode;
  onComplete: (outcome: TuiOutcome) => void;
  onBackToHome: () => void;
  setBusy: (busy: boolean) => void;
  registerOperation: (controller: AbortController, promise: Promise<void>) => void;
}

export interface CommitScreenProps extends ScreenProps {
  initialOptions?: CommitOptions;
  suspendRenderer: () => void;
  resumeRenderer: () => void;
}

export interface TranslateScreenProps extends ScreenProps {
  interactive: boolean;
  initialText?: string;
  clipboard?: ClipboardService;
}
