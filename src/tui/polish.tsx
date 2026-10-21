import { createSignal, onMount, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { TextareaRenderable } from "@opentui/core";
import { addPolishHistory, loadPolishHistory } from "../history.ts";
import { formatUsage, polishText, type OmpResult } from "../omp.ts";
import { getModel } from "../config.ts";
import { formatError } from "../errors.ts";
import type { PolishScreenProps } from "./screens.ts";

export interface PolishEditorProps {
  focused?: boolean;
  initialValue?: string;
  onSubmit: (text: string) => void;
  onRef?: (el: TextareaRenderable) => void;
  history?: string[];
}

export function PolishEditor(props: PolishEditorProps) {
  let textareaRef: TextareaRenderable | undefined;
  let historyIndex = -1;
  let draft = "";

  const historyList = () => props.history ?? loadPolishHistory();

  function applyText(text: string) {
    textareaRef?.setText(text);
    textareaRef?.gotoBufferEnd();
  }

  const textareaKeyBindings = [
    { name: "return", shift: true, action: "newline" as const },
    { name: "kpenter", shift: true, action: "newline" as const },
    { name: "linefeed", shift: true, action: "newline" as const },
    { name: "return", action: "submit" as const },
    { name: "kpenter", action: "submit" as const },
    { name: "linefeed", action: "submit" as const },
    { name: "return", ctrl: true, action: "submit" as const },
    { name: "return", super: true, action: "submit" as const },
    { name: "kpenter", ctrl: true, action: "submit" as const },
    { name: "kpenter", super: true, action: "submit" as const },
    { name: "linefeed", ctrl: true, action: "submit" as const },
    { name: "linefeed", super: true, action: "submit" as const },
  ];

  function handleSubmit() {
    const text = textareaRef?.plainText ?? "";
    if (!text.trim()) return;
    historyIndex = -1;
    draft = "";
    props.onSubmit(text);
  }

  useKeyboard((e) => {
    if (props.focused === false || e.ctrl || e.meta || e.super || e.shift) return;

    if (e.name === "up") {
      const list = historyList();
      if (list.length === 0 || !textareaRef) return;
      const currentText = textareaRef.plainText;

      // Empty editor (or still at the draft): start from the most recent entry.
      if (currentText.trim() === "") {
        draft = currentText;
        historyIndex = list.length - 1;
        applyText(list[historyIndex]!);
        e.preventDefault();
        return;
      }

      // Unmodified recalled entry: step back through history.
      if (historyIndex !== -1 && currentText === list[historyIndex]) {
        if (historyIndex > 0) {
          historyIndex--;
          applyText(list[historyIndex]!);
        }
        e.preventDefault();
        return;
      }

      // User edited the recalled entry: hand arrow keys back to the textarea.
      historyIndex = -1;
      return;
    }

    if (e.name === "down") {
      if (historyIndex === -1 || !textareaRef) return;
      const list = historyList();
      const currentText = textareaRef.plainText;

      if (currentText === list[historyIndex]) {
        e.preventDefault();
        if (historyIndex < list.length - 1) {
          historyIndex++;
          applyText(list[historyIndex]!);
        } else {
          historyIndex = -1;
          applyText(draft);
        }
        return;
      }

      historyIndex = -1;
      return;
    }
  });

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
      placeholder="Enter text to polish... (Enter to submit, Shift+Enter for newline)"
      placeholderColor="#666666"
    />
  );
}

export function PolishScreen(props: PolishScreenProps) {
  let textareaRef: TextareaRenderable | undefined;

  const [phase, setPhase] = createSignal<"input" | "polishing" | "result">("input");
  const [result, setResult] = createSignal<OmpResult | null>(null);
  const [lastSuccessfulResult, setLastSuccessfulResult] = createSignal<OmpResult | null>(null);
  const [fallbackNotice, setFallbackNotice] = createSignal<{ from: string; to: string } | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [copyFeedback, setCopyFeedback] = createSignal<string | null>(null);
  const [history, setHistory] = createSignal<string[]>(props.history ?? loadPolishHistory());

  async function executePolish(text: string) {
    if (phase() !== "input" || props.operations.busy) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    setHistory(addPolishHistory(trimmed));

    setPhase("polishing");
    setErrorMessage(null);
    setCopyFeedback(null);
    setFallbackNotice(null);

    try {
      await props.operations.run(async (signal) => {
        try {
          const res = await polishText(
            trimmed,
            (fromModel, toModel) => {
              setFallbackNotice({ from: fromModel, to: toModel });
            },
            signal,
          );
          setResult(res);
          setLastSuccessfulResult(res);

          if (props.mode === "direct" && !props.interactive) {
            props.onComplete({ exitCode: 0, stdout: `${res.text}\n` });
            return;
          }
          setPhase("result");
        } catch (err: unknown) {
          if (signal.aborted) return;
          const formatted = formatError(err);
          setErrorMessage(formatted);

          if (props.mode === "direct" && !props.interactive) {
            props.onComplete({ exitCode: 1, stderr: formatted });
            return;
          }
          setPhase("result");
        }
      });
    } catch {
      // Ignored if cancelled
    }
  }

  onMount(() => {
    if (props.initialText && props.initialText.trim()) {
      executePolish(props.initialText);
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
    <box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <text fg="cyan">LGNH Polish</text>
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
        border={["top"]}
        borderStyle="single"
        borderColor={phase() === "input" ? "cyan" : "#444444"}
        title=" Input Text "
        titleColor={phase() === "input" ? "cyan" : "#888888"}
        flexDirection="column"
        minHeight={5}
        flexGrow={phase() === "input" ? 1 : 0}
        marginBottom={1}
      >
        <PolishEditor
          focused={phase() === "input"}
          initialValue={props.initialText || ""}
          history={history()}
          onSubmit={executePolish}
          onRef={(el) => {
            textareaRef = el;
          }}
        />
      </box>

      {/* Polishing Indicator */}
      <Show when={phase() === "polishing"}>
        <box marginY={1}>
          <text fg="yellow">Polishing with {getModel()}...</text>
        </box>
      </Show>

      {/* Error display */}
      <Show when={errorMessage()}>
        <box
          border={["top"]}
          borderStyle="single"
          borderColor="red"
          title=" Error "
          titleColor="red"
          marginBottom={1}
        >
          <text fg="red">{errorMessage()}</text>
        </box>
      </Show>

      {/* Result Display */}
      <Show when={phase() === "result" && (result() || lastSuccessfulResult())}>
        <box
          border={["top"]}
          borderStyle="single"
          borderColor="green"
          title={` Result (${(result() || lastSuccessfulResult())?.resolvedModel || "Polished"}${formatUsage((result() || lastSuccessfulResult())?.usage) ? ` · ${formatUsage((result() || lastSuccessfulResult())?.usage)}` : ""}) `}
          titleColor="green"
          flexDirection="column"
          flexGrow={1}
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
      <box marginTop="auto" border={["top"]} borderStyle="single" borderColor="#333333">
        <Show
          when={phase() === "result"}
          fallback={
            <text fg="#666666">
              [Shift+Enter] Newline [Enter] Polish [Esc]{" "}
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
