#!/usr/bin/env bun
// A globally symlinked launcher runs outside this repository, where bunfig.toml is not read, so the
// Solid runtime transform must be registered before the app (and its lazily imported TUI) loads.
// This is the typed equivalent of `@opentui/solid/preload` (which ships no declaration file).
// It cannot be a static import: a compiled executable already carries transformed JSX and must not
// evaluate or embed the Babel transform.
if (!Bun.isStandaloneExecutable) {
  const { ensureSolidTransformPlugin } = await import("@opentui/solid/bun-plugin");
  ensureSolidTransformPlugin();
}

await import("../src/main.ts");
