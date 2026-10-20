import { createSignal, onMount, Show, For } from "solid-js";
import { styleText } from "node:util";
import { useKeyboard } from "@opentui/solid";
import {
  runCommitWorkflow,
  type CommitOptions,
  type CommitStep,
  type WorkflowEvent,
} from "../workflows/commit.ts";
import { formatError } from "../errors.ts";
import type { ContextTokenBreakdown } from "../omp.ts";
import { getModel } from "../config.ts";
import type { CommitScreenProps } from "./screens.ts";

interface StepInfo {
  step: CommitStep;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  elapsedMs?: number;
  message?: string;
}

const STEP_LABELS: Record<CommitStep, string> = {
  verify: "Verify project",
  stage: "Stage changes",
  generate: "Generate commit message",
  commit: "Commit changes",
  push: "Push to remote",
};

function formatCommitStdout(message: string, resolvedModel: string, pushTarget?: string): string {
  const [subject = "", ...rest] = message.trim().split("\n");
  const body = rest
    .join("\n")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => `  ${styleText("gray", line)}`)
    .join("\n");

  const header = `${styleText(["green", "bold"], "✔ Committed")} ${styleText("dim", `(${resolvedModel})`)}`;
  const formattedSubject = styleText(["cyan", "bold"], subject);
  const formattedPush = pushTarget
    ? `\n\n${styleText(["green", "bold"], "✔ Pushed")} ${styleText("dim", `to ${pushTarget}`)}`
    : "";

  return `${header}\n\n${formattedSubject}${body ? `\n\n${body}` : ""}${formattedPush}\n`;
}

export function CommitScreen(props: CommitScreenProps) {
  const [verify, setVerify] = createSignal(props.initialOptions?.verify ?? true);
  const [push, setPush] = createSignal(props.initialOptions?.push ?? false);
  const [edit, setEdit] = createSignal(props.initialOptions?.edit ?? false);

  const [isRunning, setIsRunning] = createSignal(false);
  const [isDone, setIsDone] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [tokenBreakdown, setTokenBreakdown] = createSignal<ContextTokenBreakdown | null>(null);
  const [fallback, setFallback] = createSignal<{ fromModel: string; toModel: string } | null>(null);
  const [commitMsg, setCommitMsg] = createSignal<string | null>(null);
  const [resolvedModel, setResolvedModel] = createSignal<string | null>(null);
  const [pushTarget, setPushTarget] = createSignal<string | null>(null);
  const [cleanTree, setCleanTree] = createSignal(false);
  const [stepList, setStepList] = createSignal<StepInfo[]>([]);

  async function startWorkflow() {
    if (isRunning() || props.operations.busy) return;

    const currentOptions: CommitOptions = {
      verify: verify(),
      push: push(),
      edit: edit(),
    };

    const initialSteps: StepInfo[] = [];
    if (currentOptions.verify) {
      initialSteps.push({ step: "verify", label: STEP_LABELS.verify, status: "pending" });
    }
    initialSteps.push({ step: "stage", label: STEP_LABELS.stage, status: "pending" });
    initialSteps.push({ step: "generate", label: STEP_LABELS.generate, status: "pending" });
    initialSteps.push({ step: "commit", label: STEP_LABELS.commit, status: "pending" });
    if (currentOptions.push) {
      initialSteps.push({ step: "push", label: STEP_LABELS.push, status: "pending" });
    }
    setStepList(initialSteps);

    setIsRunning(true);
    setErrorMessage(null);
    setIsDone(false);
    setCleanTree(false);

    const handleEvent = (event: WorkflowEvent) => {
      if (event.type === "step") {
        setStepList((prev) =>
          prev.map((s) =>
            s.step === event.step
              ? {
                  ...s,
                  status: event.status,
                  elapsedMs: event.elapsedMs ?? s.elapsedMs,
                  message: event.message ?? s.message,
                }
              : s,
          ),
        );
      } else if (event.type === "context") {
        setTokenBreakdown(event.metrics);
      } else if (event.type === "fallback") {
        setFallback({ fromModel: event.fromModel, toModel: event.toModel });
      } else if (event.type === "message") {
        setCommitMsg(event.message);
        setResolvedModel(event.resolvedModel);
      }
    };

    try {
      await props.operations.run(async (signal) => {
        try {
          const result = await runCommitWorkflow(currentOptions, {
            signal,
            onEvent: handleEvent,
            beforeGit: async () => {
              props.suspendRenderer();
            },
            afterGit: async () => {
              props.resumeRenderer();
            },
          });

          setIsDone(true);

          if (!result.changed) {
            setCleanTree(true);
            if (props.mode === "direct") {
              props.onComplete({
                exitCode: 0,
                stdout: "Nothing to commit, working tree clean.\n",
              });
              return;
            }
          } else {
            if (result.pushTarget) {
              setPushTarget(result.pushTarget);
            }
            if (props.mode === "direct") {
              props.onComplete({
                exitCode: 0,
                stdout: formatCommitStdout(result.message, result.resolvedModel, result.pushTarget),
              });
              return;
            }
          }
        } catch (err: unknown) {
          if (signal.aborted) return;
          const formatted = formatError(err);
          setErrorMessage(formatted);

          if (props.mode === "direct") {
            props.onComplete({ exitCode: 1, stderr: formatted });
            return;
          }
        }
      });
    } catch {
      // Ignored during cancellation or external abort
    } finally {
      setIsRunning(false);
    }
  }

  onMount(() => {
    if (props.mode === "direct") {
      startWorkflow();
    }
  });

  useKeyboard((e) => {
    if (isRunning() || props.operations.busy) return;

    if (e.name === "escape" || e.name === "q") {
      if (props.mode === "integrated") {
        props.onBackToHome();
      } else {
        props.onComplete({ exitCode: 0 });
      }
      return;
    }

    if (props.mode === "integrated" && !isDone()) {
      if (e.name === "v") {
        setVerify(!verify());
      } else if (e.name === "p") {
        setPush(!push());
      } else if (e.name === "e") {
        setEdit(!edit());
      } else if (e.name === "return" || e.name === "c" || e.name === "s") {
        startWorkflow();
      }
    } else if (props.mode === "integrated" && isDone()) {
      if (e.name === "r") {
        startWorkflow();
      }
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <text fg="cyan">LGNH Commit</text>
        <text fg="#888888">Model: {getModel()}</text>
      </box>

      {/* Options Bar */}
      <box
        borderStyle="rounded"
        borderColor="#444444"
        title="Workflow Options"
        flexDirection="row"
        padding={1}
        marginBottom={1}
      >
        <text fg={verify() ? "green" : "#666666"} marginRight={3}>
          [v] Verify: {verify() ? "ON" : "OFF"}
        </text>
        <text fg={push() ? "green" : "#666666"} marginRight={3}>
          [p] Push: {push() ? "ON" : "OFF"}
        </text>
        <text fg={edit() ? "green" : "#666666"}>[e] Edit message: {edit() ? "ON" : "OFF"}</text>
      </box>

      {/* Steps List */}
      <Show when={stepList().length > 0}>
        <box
          borderStyle="rounded"
          borderColor="cyan"
          title="Workflow Steps"
          flexDirection="column"
          padding={1}
          marginBottom={1}
        >
          <For each={stepList()}>
            {(s) => {
              const icon = () => {
                if (s.status === "done") return "✔";
                if (s.status === "failed") return "✖";
                if (s.status === "running") return "◐";
                return "○";
              };
              const color = () => {
                if (s.status === "done") return "green";
                if (s.status === "failed") return "red";
                if (s.status === "running") return "yellow";
                return "#666666";
              };
              return (
                <box flexDirection="row" marginY={0}>
                  <text fg={color()}>{icon()} </text>
                  <text fg={s.status === "pending" ? "#888888" : "white"}>{s.label}</text>
                  <Show when={s.elapsedMs !== undefined}>
                    <text fg="#666666"> ({Math.round(s.elapsedMs ?? 0)}ms)</text>
                  </Show>
                  <Show when={s.message}>
                    <text fg="#888888"> — {s.message}</text>
                  </Show>
                </box>
              );
            }}
          </For>
        </box>
      </Show>

      {/* Token breakdown */}
      <Show when={tokenBreakdown()}>
        <box
          borderStyle="rounded"
          borderColor="#444444"
          title="Context Tokens"
          flexDirection="column"
          padding={1}
          marginBottom={1}
        >
          <text fg="#888888">
            Prompt: {Math.round(tokenBreakdown()?.prompt.tokens ?? 0)} tokens (
            {Math.round(tokenBreakdown()?.prompt.chars ?? 0)} chars) | Stat:{" "}
            {Math.round(tokenBreakdown()?.stat.tokens ?? 0)} tokens (
            {Math.round(tokenBreakdown()?.stat.chars ?? 0)} chars)
          </text>
          <text fg="#888888">
            Diff: {Math.round(tokenBreakdown()?.diff.tokens ?? 0)} tokens (
            {Math.round(tokenBreakdown()?.diff.chars ?? 0)} chars) | Total:{" "}
            {Math.round(tokenBreakdown()?.total.tokens ?? 0)} tokens (
            {Math.round(tokenBreakdown()?.total.chars ?? 0)} chars)
          </text>
        </box>
      </Show>

      {/* Fallback Notice */}
      <Show when={fallback()}>
        <box marginBottom={1}>
          <text fg="yellow">
            ⚠ {fallback()?.fromModel} unavailable → using {fallback()?.toModel}
          </text>
        </box>
      </Show>

      {/* Commit Message Box */}
      <Show when={commitMsg()}>
        <box
          borderStyle="rounded"
          borderColor="green"
          title={`Generated Commit (${resolvedModel() || "model"})`}
          titleColor="green"
          flexDirection="column"
          padding={1}
          marginBottom={1}
        >
          <text fg="white">{commitMsg()}</text>
        </box>
      </Show>

      {/* Clean Tree Message */}
      <Show when={cleanTree()}>
        <box marginBottom={1}>
          <text fg="green">✔ Nothing to commit, working tree clean.</text>
        </box>
      </Show>

      {/* Push Target */}
      <Show when={pushTarget()}>
        <box marginBottom={1}>
          <text fg="green">✔ Pushed to {pushTarget()}</text>
        </box>
      </Show>

      {/* Error display */}
      <Show when={errorMessage()}>
        <box
          borderStyle="rounded"
          borderColor="red"
          title="Workflow Error"
          titleColor="red"
          padding={1}
          marginBottom={1}
        >
          <text fg="red">{errorMessage()}</text>
        </box>
      </Show>

      {/* Footer */}
      <box marginTop="auto">
        <Show
          when={isRunning()}
          fallback={
            <Show
              when={isDone()}
              fallback={
                <text fg="#666666">
                  {props.mode === "integrated"
                    ? "[Enter/c] Start Commit  [v/p/e] Toggle Options  [Esc/q] Home"
                    : "[Esc/q] Exit"}
                </text>
              }
            >
              <text fg="#666666">
                {props.mode === "integrated"
                  ? "[r] Run Again  [Esc/q] Home  [Ctrl+C] Exit"
                  : "[Esc/q] Exit"}
              </text>
            </Show>
          }
        >
          <text fg="yellow">Running workflow... [Ctrl+C] Cancel</text>
        </Show>
      </box>
    </box>
  );
}
