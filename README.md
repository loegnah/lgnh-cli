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
lgnh tr                 # multi-line input; Shift+Enter newline, Enter translate
lgnh tr -i              # repeat translation; result shortcuts: [c] copy, [a] next, [q] exit
lgnh tr -i [text...]    # translate the initial arguments, then stay interactive
lgnh tr [text...]       # translate once and print the result after terminal restoration
echo "text" | lgnh tr   # pipe support for CLI workflows
# Polish (same language, natural expression)
lgnh polish                 # multi-line input; Shift+Enter newline, Enter polish
lgnh polish -i              # repeat; result shortcuts: [c] copy, [a] next, [q] exit
lgnh polish -i [text...]    # polish the initial arguments, then stay interactive
lgnh polish [text...]       # polish once and print the result after terminal restoration
echo "text" | lgnh polish   # pipe support for CLI workflows

# Run in any git repository
lgnh commit             # verify project (lint/typecheck), generate message, commit
lgnh commit-fast        # skip verification, generate message, commit
lgnh commit-push        # verify project, generate message, commit, and push
lgnh commit-fast-push   # skip verification, commit, and push
lgnh commit -e          # edit generated message before committing

# Output mode (automatic by default)
lgnh --plain commit     # force sequential output
lgnh --tui commit       # request TUI on a TTY, including inside OMP

# Share a directory over HTTP
lgnh file-server                    # serve the current directory on port 13131
lgnh file-server ./dist -p 8080     # serve another directory on another port
```

Screens entered from home return to the menu with Esc. Visiting Commit does not stage or commit anything: select verification, push and editor options, then explicitly start the workflow. Settings uses the existing config file and model format.

Translation result shortcuts also accept `ㅊ` (copy), `ㅁ` (next), and `ㅂ` (quit); these characters remain ordinary text while editing. Results support keyboard scrolling. Ctrl+C cancels the active subprocess operation and restores the terminal; completed Git changes are not rolled back. Git editors and credential prompts temporarily take ownership of the terminal.

`file-server` runs in the console (no terminal screen) and binds `0.0.0.0`, printing the local and LAN URLs; Ctrl+C stops it. Browsers get a directory listing with view and download links plus drag-and-drop/multi-file upload, while scripts can use `curl -T file.txt http://<host>:13131/sub/file.txt`. Uploads never overwrite an existing file: the name becomes `file (1).txt`. Requests that resolve outside the served directory are refused.

When either stream is non-TTY, commands use plain output instead of a renderer. OMP subprocesses (identified by a non-empty `OMPCODE`) also automatically use plain output, even when connected through a PTY; `TERM=dumb` uses plain output too. Ordinary interactive terminals keep the TUI. Leading `--plain` / `--tui` flags override automatic selection, but `--tui` never opens a renderer on non-TTY streams. Put these flags before the command so translation text and model arguments remain literal. In plain mode, translation needs text arguments or piped input; `tr` without input reports an error instead of waiting on a captured TTY. Redirected translation stdout contains only the result; errors go to stderr with a nonzero exit code.

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

## Extending the toolkit

- `src/main.ts` only bootstraps the process. `src/cli.ts` resolves one command invocation and chooses plain output or the lazily loaded TUI.
- Define CLI commands in `src/commands/` and register them in `src/commands/registry.ts`. Handlers receive `{ name, args }`; the dispatcher removes only the matched command token. Command aliases and help stay with their definitions.
- Add terminal screens to `src/tui/registry.tsx`. Screen keys, home menu entries, numeric shortcuts and the exit number are derived from this registry. Add a `TuiOptions` variant in `src/tui/types.ts` only when the screen also needs a direct CLI entry.
- `src/tui/app.tsx` owns navigation; `src/tui/runtime.tsx` owns renderer, clipboard, signals and terminal restoration. Screens use the shared `OperationScope.run(signal => ...)` for exclusive work; shutdown aborts and awaits the active operation before disposing the terminal.
- Put UI-independent execution in `src/workflows/`. Commit orchestration lives in `commit.ts`; project script discovery and verification live in `verification.ts`. CLI handlers and terminal screens call the same workflow instead of implementing it twice.
