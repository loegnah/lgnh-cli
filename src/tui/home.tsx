import { createSignal, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { getModel } from "../config.ts";
import { SCREEN_MENU, type ScreenKey } from "./registry.tsx";

export interface HomeScreenProps {
  onNavigate: (screen: ScreenKey) => void;
  onExit: () => void;
}

interface MenuItem {
  key: ScreenKey | "exit";
  title: string;
  desc: string;
}

export function HomeScreen(props: HomeScreenProps) {
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const exitShortcut = String(SCREEN_MENU.length + 1);
  const menuItems: MenuItem[] = [
    ...SCREEN_MENU.map((entry) => ({
      key: entry.key,
      title: entry.title,
      desc: entry.desc,
    })),
    {
      key: "exit",
      title: `${exitShortcut}. Exit`,
      desc: "Quit LGNH application",
    },
  ];

  useKeyboard((e) => {
    if (e.ctrl || e.meta || e.super) return;
    e.preventDefault();
    if (e.name === "up" || e.name === "k") {
      setSelectedIndex((prev) => (prev - 1 + menuItems.length) % menuItems.length);
    } else if (e.name === "down" || e.name === "j") {
      setSelectedIndex((prev) => (prev + 1) % menuItems.length);
    } else if (e.name === "return") {
      const item = menuItems[selectedIndex()];
      if (item && item.key === "exit") {
        props.onExit();
      } else if (item && item.key !== "exit") {
        props.onNavigate(item.key);
      }
    } else if (e.name === exitShortcut || e.name === "q" || e.name === "escape") {
      props.onExit();
    } else {
      const matched = SCREEN_MENU.find((entry) => entry.shortcuts.includes(e.name));
      if (matched) {
        props.onNavigate(matched.key);
      }
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
        <For each={menuItems}>
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
          [↑/↓ / j/k] Navigate [Enter] Select [1-{exitShortcut} /{" "}
          {SCREEN_MENU.map((entry) => entry.shortcuts[1]).join("/")}] Quick Select [q/Esc] Exit
        </text>
      </box>
    </box>
  );
}
