import { createSignal, onMount, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { TextareaRenderable, ClipboardService } from "@opentui/core";
import { translateText } from "../omp.ts";
import { getModel } from "../config.ts";
import { formatError } from "../workflows.ts";
import type { TuiOutcome } from "./app.tsx";

export interface TranslateScreenProps {
  mode: "integrated" | "direct";
  interactive: boolean;
  initialText?: string;
  clipboard?: ClipboardService;
  onComplete: (outcome: TuiOutcome) => void;
  onBackToHome: () => void;
  setBusy: (busy: boolean) => void;
  registerOperation: (controller: AbortController, promise: Promise<void>) => void;
}

export interface TranslateEditorProps {
  focused?: boolean;
  initialValue?: string;
  onSubmit: (text: string) => void;
  onRef?: (el: TextareaRenderable) => void;
}

export function TranslateEditor(props: TranslateEditorProps) {
  let textareaRef: TextareaRenderable | undefined;

  const textareaKeyBindings = [
    { name: "return", ctrl: true, action: "submit" as const },
    { name: "return", super: true, action: "submit" as const },
    { name: "kpenter", ctrl: true, action: "submit" as const },
    { name: "kpenter", super: true, action: "submit" as const },
    { name: "linefeed", ctrl: true, action: "submit" as const },
    { name: "linefeed", super: true, action: "submit" as const },
    { name: "return", shift: true, action: "newline" as const },
    { name: "return", action: "newline" as const },
  ];

  function handleSubmit() {
    const text = textareaRef?.plainText ?? "";
    if (!text.trim()) return;
    props.onSubmit(text);
  }

  return (
    <textarea
      ref={(el) => {
        textareaRef = el;
        props.onRef?.(el);
      }}
      focused={props.focused ?? true}
      keyBindings={textareaKeyBindings}
      onSubmit={handleSubmit}
      initialValue={props.initialValue || ""}
      placeholder="Enter text to translate... (Cmd+Enter or Ctrl+Enter to submit)"
      placeholderColor="#666666"
    />
  );
}

export function TranslateScreen(props: TranslateScreenProps) {
  let textareaRef: TextareaRenderable | undefined;

  const [phase, setPhase] = createSignal<"input" | "translating" | "result">("input");
  const [result, setResult] = createSignal<{ text: string; resolvedModel: string } | null>(null);
  const [lastSuccessfulResult, setLastSuccessfulResult] = createSignal<{
    text: string;
    resolvedModel: string;
  } | null>(null);
  const [fallbackNotice, setFallbackNotice] = createSignal<{ from: string; to: string } | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [copyFeedback, setCopyFeedback] = createSignal<string | null>(null);

  async function executeTranslation(text: string) {
    if (phase() !== "input") return;
    const trimmed = text.trim();
    if (!trimmed) return;

    setPhase("translating");
    props.setBusy(true);
    setErrorMessage(null);
    setCopyFeedback(null);
    setFallbackNotice(null);

    const controller = new AbortController();

    const operation = (async () => {
      try {
        const res = await translateText(
          trimmed,
          (fromModel, toModel) => {
            setFallbackNotice({ from: fromModel, to: toModel });
          },
          controller.signal,
        );
        setResult(res);
        setLastSuccessfulResult(res);

        if (props.mode === "direct" && !props.interactive) {
          props.onComplete({ exitCode: 0, stdout: res.text });
          return;
        }
        setPhase("result");
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        const formatted = formatError(err);
        setErrorMessage(formatted);

        if (props.mode === "direct" && !props.interactive) {
          props.onComplete({ exitCode: 1, stderr: formatted });
          return;
        }
        setPhase("result");
      } finally {
        props.setBusy(false);
      }
    })();

    props.registerOperation(controller, operation);
    await operation;
  }

  onMount(() => {
    if (props.initialText && props.initialText.trim()) {
      executeTranslation(props.initialText);
    }
  });

  useKeyboard((e) => {
    // Escape in input phase
    if (phase() === "input" && e.name === "escape") {
      e.preventDefault();
      if (props.mode === "integrated") {
        props.onBackToHome();
      } else {
        props.onComplete({ exitCode: 0 });
      }
      return;
    }

    // Result phase actions only
    if (phase() !== "result") return;

    if (e.name === "escape") {
      e.preventDefault();
      if (props.mode === "integrated") {
        props.onBackToHome();
      } else {
        props.onComplete({ exitCode: 0 });
      }
      return;
    }

    if (e.ctrl || e.meta || e.super) return;

    const ch = (e.raw || e.name || "").toLowerCase();
    const isCopy =
      ch === "c" || ch === "ㅊ" || ch === "\u314a" || ch === "\u110e" || ch === "\u11be";
    const isNext =
      ch === "a" || ch === "ㅁ" || ch === "\u3141" || ch === "\u1106" || ch === "\u11b7";
    const isQuit =
      ch === "q" ||
      ch === "ㅂ" ||
      ch === "ㅃ" ||
      ch === "\u3142" ||
      ch === "\u3138" ||
      ch === "\u1107" ||
      ch === "\u1108" ||
      ch === "\u11b8";

    if (isCopy) {
      e.preventDefault();
      const textToCopy = result()?.text || lastSuccessfulResult()?.text;
      if (textToCopy && props.clipboard) {
        props.clipboard
          .writeText(textToCopy, { destination: "best-available" })
          .then((res) => {
            const ok = res.host.status === "written" || res.terminal.status === "attempted";
            setCopyFeedback(ok ? "✔ Copied to clipboard." : "✖ Failed to copy to clipboard.");
          })
          .catch(() => {
            setCopyFeedback("✖ Failed to copy to clipboard.");
          });
      }
      return;
    }

    if (isNext) {
      e.preventDefault();
      setPhase("input");
      setCopyFeedback(null);
      setErrorMessage(null);
      if (textareaRef) {
        textareaRef.clear();
        textareaRef.focus();
      }
      return;
    }

    if (isQuit) {
      e.preventDefault();
      if (props.mode === "integrated") {
        props.onBackToHome();
      } else {
        props.onComplete({ exitCode: 0 });
      }
      return;
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <text fg="cyan">LGNH Translate</text>
        <text fg="#888888">Model: {getModel()}</text>
      </box>

      {/* Fallback notice */}
      <Show when={fallbackNotice()}>
        <box marginBottom={1}>
          <text fg="yellow">
            ⚠ {fallbackNotice()?.from} unavailable → using {fallbackNotice()?.to}
          </text>
        </box>
      </Show>

      {/* Input Box */}
      <box
        borderStyle="rounded"
        borderColor={phase() === "input" ? "cyan" : "#444444"}
        title="Input Text"
        titleColor={phase() === "input" ? "cyan" : "#888888"}
        flexDirection="column"
        minHeight={5}
        flexGrow={phase() === "input" ? 1 : 0}
        padding={1}
        marginBottom={1}
      >
        <TranslateEditor
          focused={phase() === "input"}
          initialValue={props.initialText || ""}
          onSubmit={executeTranslation}
          onRef={(el) => {
            textareaRef = el;
          }}
        />
      </box>

      {/* Translating Indicator */}
      <Show when={phase() === "translating"}>
        <box marginY={1}>
          <text fg="yellow">Translating with {getModel()}...</text>
        </box>
      </Show>

      {/* Error display */}
      <Show when={errorMessage()}>
        <box
          borderStyle="rounded"
          borderColor="red"
          title="Error"
          titleColor="red"
          padding={1}
          marginBottom={1}
        >
          <text fg="red">{errorMessage()}</text>
        </box>
      </Show>

      {/* Result Display */}
      <Show when={phase() === "result" && (result() || lastSuccessfulResult())}>
        <box
          borderStyle="rounded"
          borderColor="green"
          title={`Result (${(result() || lastSuccessfulResult())?.resolvedModel || "Translated"})`}
          titleColor="green"
          flexDirection="column"
          flexGrow={1}
          padding={1}
          marginBottom={1}
        >
          <scrollbox focused={phase() === "result"} flexGrow={1}>
            <text>{(result() || lastSuccessfulResult())?.text}</text>
          </scrollbox>
          <Show when={copyFeedback()}>
            <box marginTop={1}>
              <text fg={copyFeedback()?.startsWith("✔") ? "green" : "red"}>{copyFeedback()}</text>
            </box>
          </Show>
        </box>
      </Show>

      {/* Footer Shortcuts */}
      <box marginTop="auto">
        <Show
          when={phase() === "result"}
          fallback={
            <text fg="#666666">
              [Enter/Shift+Enter] Newline [Cmd/Ctrl+Enter] Translate [Esc]{" "}
              {props.mode === "integrated" ? "Home" : "Exit"} [Ctrl+C] Exit
            </text>
          }
        >
          <text fg="#666666">
            [c/ㅊ] Copy [a/ㅁ] Next [q/ㅂ] {props.mode === "integrated" ? "Home" : "Exit"} [Esc]{" "}
            {props.mode === "integrated" ? "Home" : "Exit"} [Ctrl+C] Exit
          </text>
        </Show>
      </box>
    </box>
  );
}
