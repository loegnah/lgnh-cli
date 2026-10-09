# lgnh

OpenTUI + Solid terminal app for Git commit messages and Korean ↔ English translation via OMP.

## Installation

Source execution requires Bun 1.3+ and `omp` on PATH. The launcher registers Solid's JSX transform even when linked from another working directory.

```bash
# Install dependencies
bun install

# Link globally for terminal use
ln -s $(pwd)/bin/lgnh-cli.ts ~/.local/bin/lgnh
# or
ln -s $(pwd)/bin/lgnh-cli.ts /usr/local/bin/lgnh
```

## Usage

```bash
# Interactive home (when stdin and stdout are TTY)
lgnh                    # Translation / Commit / Settings

# Config & model
lgnh config          # view config path and current model
lgnh model           # view current model
lgnh model <id>      # change model (default: @commit)
# Translation
lgnh tr                 # multi-line input; Enter/Shift+Enter newline, Cmd/Ctrl+Enter translate
lgnh tr -i              # repeat translation; result shortcuts: [c] copy, [a] next, [q] exit
lgnh tr -i [text...]    # translate the initial arguments, then stay interactive
lgnh tr [text...]       # translate once and print the result after terminal restoration
echo "text" | lgnh tr   # pipe support for CLI workflows

# Run in any git repository
lgnh commit             # verify project (lint/typecheck), generate message, commit
lgnh commit-fast        # skip verification, generate message, commit
lgnh commit-push        # verify project, generate message, commit, and push
lgnh commit-fast-push   # skip verification, commit, and push
lgnh commit -e          # edit generated message before committing
```

Screens entered from home return to the menu with Esc. Visiting Commit does not stage or commit anything: select verification, push and editor options, then explicitly start the workflow. Settings uses the existing config file and model format.

Translation result shortcuts also accept `ㅊ` (copy), `ㅁ` (next), and `ㅂ` (quit); these characters remain ordinary text while editing. Results support keyboard scrolling. Ctrl+C cancels the active subprocess operation and restores the terminal; completed Git changes are not rolled back. Git editors and credential prompts temporarily take ownership of the terminal.

When either stream is non-TTY, commands use plain output instead of a renderer. Redirected translation stdout contains only the result; errors go to stderr with a nonzero exit code.

## Development and build

```bash
bun run dev             # run the source TUI
bun run lint
bun run typecheck
bun test

bun run package         # Solid-aware standalone build → dist/lgnh
./dist/lgnh             # no Bun or node_modules required; omp must remain on PATH

bun run setup           # configure the deployment directory
bun run deploy          # build and copy to the configured directory
```

OpenTUI's native library and assets are embedded in the standalone executable. No Zig toolchain is needed.
