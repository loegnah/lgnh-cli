import { createSignal, Show } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { loadConfig, saveConfig, getModel, getConfigPath } from "../config.ts";

export interface SettingsScreenProps {
  onBackToHome: () => void;
}

export function SettingsScreen(props: SettingsScreenProps) {
  const configPath = getConfigPath();
  const [currentModel, setCurrentModel] = createSignal(getModel());
  const [inputValue, setInputValue] = createSignal(getModel());
  const [status, setStatus] = createSignal<{ type: "success" | "error"; message: string } | null>(
    null,
  );

  function handleSave(modelToSave: string) {
    const trimmed = modelToSave.trim();
    if (!trimmed) {
      setStatus({ type: "error", message: "Model cannot be empty." });
      return;
    }
    try {
      const cfg = loadConfig();
      saveConfig({ ...cfg, model: trimmed });
      setCurrentModel(getModel());
      setInputValue(trimmed);
      setStatus({ type: "success", message: `✔ Saved model: ${trimmed}` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({
        type: "error",
        message: `✖ Failed to save config: ${message}`,
      });
    }
  }

  useKeyboard((e) => {
    if (e.name === "escape") {
      e.preventDefault();
      props.onBackToHome();
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <text fg="cyan">LGNH Settings</text>
        <text fg="#888888">Configuration</text>
      </box>

      {/* Path info */}
      <box marginBottom={1} flexDirection="column">
        <text fg="#888888">Config file path:</text>
        <text fg="white">{configPath}</text>
      </box>

      {/* Current Model */}
      <box marginBottom={1} flexDirection="row">
        <text fg="#888888">Active Model: </text>
        <text fg="green">{currentModel()}</text>
      </box>

      {/* Custom input */}
      <box
        borderStyle="rounded"
        borderColor="cyan"
        title="Custom Model ID"
        flexDirection="column"
        padding={1}
        marginBottom={1}
      >
        <input
          focused
          value={inputValue()}
          onInput={(val) => setInputValue(val)}
          onSubmit={() => handleSave(inputValue())}
          placeholder="Enter model name (e.g. @commit, gpt-4o)..."
        />
      </box>

      {/* Status feedback */}
      <Show when={status()}>
        <box marginBottom={1}>
          <text fg={status()?.type === "success" ? "green" : "red"}>{status()?.message}</text>
        </box>
      </Show>

      {/* Footer */}
      <box marginTop="auto">
        <text fg="#666666">[Enter] Save custom model [Esc] Back to Home</text>
      </box>
    </box>
  );
}
