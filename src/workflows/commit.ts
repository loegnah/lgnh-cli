import { getModel } from "../config.ts";
import { formatError } from "../errors.ts";
import { executeCommit, executePush, getStagedDiff } from "../git.ts";
import { analyzeContext, generateCommitMessage } from "../omp.ts";
import type { ContextTokenBreakdown } from "../omp.ts";
import { runProjectVerification } from "./verification.ts";

export interface CommitOptions {
  verify: boolean;
  edit: boolean;
  push: boolean;
}

export type CommitStep = "verify" | "stage" | "generate" | "commit" | "push";

export type WorkflowEvent =
  | {
      type: "step";
      step: CommitStep;
      status: "running" | "done" | "failed";
      elapsedMs?: number;
      message?: string;
    }
  | { type: "context"; metrics: ContextTokenBreakdown }
  | { type: "fallback"; fromModel: string; toModel: string }
  | { type: "message"; message: string; resolvedModel: string };

export interface WorkflowContext {
  signal?: AbortSignal;
  onEvent?: (event: WorkflowEvent) => void;
  beforeGit?: () => void | Promise<void>;
  afterGit?: () => void | Promise<void>;
}

export type CommitResult =
  | { changed: false }
  | { changed: true; message: string; resolvedModel: string; pushTarget?: string };

export async function runCommitWorkflow(
  options: CommitOptions,
  context: WorkflowContext = {},
): Promise<CommitResult> {
  const { signal, onEvent } = context;
  const emit = (event: WorkflowEvent) => onEvent?.(event);

  const runStep = async <T>(
    name: CommitStep,
    fn: () => Promise<T>,
    messages: { running?: string; done?: (value: T) => string } = {},
  ): Promise<T> => {
    const start = performance.now();
    emit({
      type: "step",
      step: name,
      status: "running",
      ...(messages.running ? { message: messages.running } : {}),
    });
    const ownsTerminal = name === "commit" || name === "push";
    try {
      if (ownsTerminal) await context.beforeGit?.();
      const value = await fn();
      const done = messages.done?.(value);
      emit({
        type: "step",
        step: name,
        status: "done",
        elapsedMs: Math.round(performance.now() - start),
        ...(done ? { message: done } : {}),
      });
      return value;
    } catch (err) {
      emit({
        type: "step",
        step: name,
        status: "failed",
        elapsedMs: Math.round(performance.now() - start),
        message: formatError(err),
      });
      throw err;
    } finally {
      if (ownsTerminal) await context.afterGit?.();
    }
  };

  if (options.verify) {
    await runStep("verify", () => runProjectVerification(signal), {
      done: (targets) =>
        targets.length > 0 ? `Verified (${targets.join(", ")})` : "No verification scripts",
    });
  }

  const staged = await runStep("stage", () => getStagedDiff(signal), {
    done: (value) => (value ? "Staged changes" : "No changes to commit"),
  });

  if (!staged) return { changed: false };

  const metrics = analyzeContext(staged.stat, staged.diff);
  emit({ type: "context", metrics });

  const initialModel = getModel();
  const { message, resolvedModel } = await runStep(
    "generate",
    () =>
      generateCommitMessage(
        `${staged.stat}\n\n${staged.diff}`,
        (fromModel, toModel) => emit({ type: "fallback", fromModel, toModel }),
        signal,
      ),
    {
      running: `Generating message... (${initialModel})`,
      done: (value) => `Generated message (${value.resolvedModel})`,
    },
  );

  emit({ type: "message", message, resolvedModel });

  await runStep("commit", () => executeCommit(message, options.edit, signal), {
    running: options.edit ? "Opening editor..." : undefined,
    done: () => "Committed",
  });

  if (!options.push) return { changed: true, message, resolvedModel };

  const pushTarget = await runStep("push", () => executePush(signal), {
    running: "Pushing changes...",
    done: (target) => `Pushed to ${target}`,
  });
  return { changed: true, message, resolvedModel, pushTarget };
}
