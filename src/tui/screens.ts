import type { ClipboardService } from "@opentui/core";
import type { CommitOptions } from "../workflows/commit.ts";
import type { TuiOutcome } from "./types.ts";
import type { OperationScope } from "./operations.ts";

export type ScreenMode = "integrated" | "direct";

export interface ScreenProps {
  mode: ScreenMode;
  onComplete: (outcome: TuiOutcome) => void;
  onBackToHome: () => void;
  operations: OperationScope;
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
