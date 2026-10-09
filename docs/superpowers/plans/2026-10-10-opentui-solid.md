# OpenTUI + SolidJS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Repository instructions require delegating implementation; the two code slices below have explicit shared contracts.

**Goal:** 통합 홈·번역·커밋·설정 TUI를 만들고 기존 명령과 파이프 사용 및 Bun 단일 바이너리 배포를 유지한다.

**Architecture:** `src/main.ts`는 명령과 TTY 여부를 해석하고 필요할 때만 TUI를 지연 로드한다. UI 독립적인 커밋 workflow와 취소 가능한 프로세스 실행은 CLI와 TUI가 공유한다. 하나의 OpenTUI 렌더러·Solid 루트가 화면 전환과 종료를 소유한다.

**Tech Stack:** TypeScript, Bun, `@opentui/core` 0.5.17, `@opentui/solid` 0.5.17, `solid-js` 1.9.12. 현재 확인한 Bun은 1.4.2이며 Solid의 정확한 peer 버전에 맞춘다.

**Spec:** `docs/superpowers/specs/2026-10-10-opentui-solid-design.md`

## Global Constraints

- TypeScript와 Bun을 유지하며 Zig 코드를 직접 작성하지 않는다.
- 기존 명령과 모델 설정 파일·fallback·프롬프트·Git 실행 순서를 유지한다.
- stdout이 비TTY인 번역은 결과만 stdout에 출력하고, 실패는 stderr와 실패 종료 코드로 전달한다.
- 새 명령어 프레임워크·React·라우터·전역 상태 라이브러리·플러그인·스트리밍·diff 미리보기·영구 대화 기록을 추가하지 않는다.
- 기존 Clack·picocolors·자체 ANSI 입력기를 전환 완료 시 제거한다. 호환 shim을 남기지 않는다.
- 빌드 출력은 `dist/lgnh`, 설정 검증은 임시 `LGNH_CONFIG_PATH`, Git 검증은 임시 저장소와 로컬 bare 원격을 사용한다.
- 각 구현자는 중간 build/lint/typecheck/test/formatter를 실행하지 않는다. 모든 변경이 모인 뒤 통합 담당자가 한 번 검사하고 실제 실행을 검증한다.
- 다른 작업자의 파일을 수정하거나 중간 Git commit을 만들지 않는다. 공유 계약 변경은 통합 담당자가 결정한다.

## Review Focus

- stdin 또는 stdout이 파이프일 때 입력 대기나 TUI 제어 코드가 섞이지 않아야 한다: Task 1의 파이프 smoke.
- 한글·이모지·붙여넣기 편집 중 Enter가 제출하거나 결과 단축키가 문자를 소비하지 않아야 한다: Task 2의 입력 회귀 검사와 PTY smoke.
- 홈의 커밋 화면을 방문하는 것만으로 staging/commit이 일어나지 않아야 한다: Task 2의 임시 저장소 방문 smoke.
- commit 성공 뒤 push 실패를 commit 실패로 오인하거나 자동 재실행하지 않아야 한다: Task 1의 로컬 원격 실패 smoke.
- 외부 편집기의 성공·실패 및 작업 중 Ctrl+C 이후 터미널과 하위 프로세스가 남지 않아야 한다: Task 2의 편집기·종료 smoke와 Task 1의 취소 회귀 검사.

## File Structure and Ownership

- Task 1: `src/main.ts`, `src/git.ts`, `src/omp.ts`, 새 `src/process.ts`, 새 `src/workflows.ts`, 새 `src/process.test.ts`, `bin/lgnh-cli.ts`, `package.json`, `bun.lock`, `tsconfig.json`, 새 `bunfig.toml`, 새 `scripts/build.ts`.
- Task 2: 새 `src/tui/app.tsx`, `src/tui/translate.tsx`, `src/tui/commit.tsx`, `src/tui/settings.tsx`, `src/tui/translate.test.tsx`.
- Task 3 integration owner: `README.md`, 필요 시 공유 계약의 문제를 직접 수정하고 전체 smoke와 최종 검사를 수행한다.
- `src/config.ts`의 설정 형식·동작과 `scripts/deploy.ts` 및 `scripts/setup.ts`의 배포 계약은 유지한다.

## Shared Interfaces

Task 1 implements these in `src/process.ts`:

```ts
export interface ProcessOptions {
  cwd?: string;
  signal?: AbortSignal;
  inherit?: boolean;
}
export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
export function runProcess(args: string[], options?: ProcessOptions): Promise<ProcessResult>;
```

`runProcess`는 shell 문자열을 만들지 않고 `Bun.spawn`에 인자 배열을 전달한다. 기본은 출력 수집, `inherit`는 편집기용 stdio 인계다. 기존 controlling terminal을 보존하고, abort 시 소유한 하위 프로세스 트리를 먼저 종료한 뒤 root를 종료한다. 자식의 종료와 출력 수집이 완료된 뒤 표준 AbortError를 전달한다. 자동 재시도·새 제한 시간·프로세스 풀은 만들지 않는다.

Task 1 implements these in `src/workflows.ts`:

```ts
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
export function runCommitWorkflow(
  options: CommitOptions,
  context?: WorkflowContext,
): Promise<CommitResult>;
export function formatError(error: unknown): string;
```

`ContextTokenBreakdown` is the existing exported type from `src/omp.ts`. Step text has no ANSI. `beforeGit`/`afterGit` wrap commit and push, with restoration in `finally`, so editors, signing and credential prompts own terminal input rather than competing with the TUI. A push failure still leaves a completed commit step and the generated message available to the UI.

Append a final optional `signal?: AbortSignal` to `generateCommitMessage` and `translateText`, after their existing fallback callback. Git APIs become `runProjectVerification(signal?)`, `getStagedDiff(signal?)`, `executeCommit(message, edit?, signal?)`, `executePush(signal?)`, preserving existing return types. Route their actual subprocesses through `runProcess`. LSP references have identified their current callers in `src/main.ts`; migrate all of them, without aliases.

Task 2 implements these in `src/tui/app.tsx`:

```ts
export type TuiOptions =
  | { screen: "home" }
  | { screen: "translate"; interactive: boolean; text?: string }
  | { screen: "commit"; options: CommitOptions };
export interface TuiOutcome {
  exitCode: 0 | 1 | 130;
  stdout?: string;
  stderr?: string;
}
export function runTui(options: TuiOptions): Promise<TuiOutcome>;
```

Task 1 imports only the type statically and dynamically imports `runTui` when both streams are TTY and the selected command needs a screen. `runTui` resolves only after root/renderer/clipboard cleanup. One-shot output is returned for printing outside the renderer. Screen components are named `TranslateScreen`, `CommitScreen`, and `SettingsScreen`; Task 2 owns their internal props and state boundaries.

---

### Task 1: Shared execution, CLI routing, and executable build

**Files:** All Task 1 files listed above.

**Consumes:** Existing Git/OMP/config APIs; the `runTui` interface above.

**Produces:** `runProcess`, `runCommitWorkflow`, `formatError`, optional cancellation parameters, plain CLI compatibility, Solid-aware source and binary launchers.

- [x] Add a focused cancellation regression in `src/process.test.ts`. Run a real Bun wrapper that writes its PID, spawns a long-lived descendant with inherited output pipes and writes that PID. Wait for both startup events, abort, assert standard AbortError rejection and both PIDs are gone. Use an isolated directory and release the watcher in `finally`; no fake process or source-text assertion.
- [x] Implement `runProcess` using Bun spawn, captured/inherited stdio and AbortSignal. Ensure output collection and child exit settle before returning or reporting cancellation.
- [x] Migrate Git subprocesses and OMP execution to this helper and pass the signal through every caller. Preserve verification script precedence, Git diff flags and truncation, OMP arguments/JSON decoding, model-not-found-only fallback and `StepError` detail.
- [x] Extract `runCommitWorkflow` from `src/main.ts:59-135`. Emit the exact events above around the unchanged operation order, preserve clean-tree early exit, and give commit/push terminal ownership through the shared hooks with `finally` restoration.
- [x] Implement `formatError` using `StepError.message` plus detail; ordinary Error uses message and other values use `String`. Do not suppress errors.
- [x] Replace `src/main.ts` with routing and plain output only. Preserve command aliases and flags, detect both streams for TUI eligibility, read stdin only for a translation without argument text, and print `TuiOutcome` after it resolves. NonTTY one-shot translation has no progress on stdout.
- [x] Add exact runtime dependencies 0.5.17/0.5.17/1.9.12 and remove Clack/picocolors. Use Bun installation to resolve the required native and peer packages into `bun.lock`; add no unrelated dependency.
- [x] Add Solid JSX settings, `bunfig.toml` preload, and explicit preload registration before dynamically loading the main entrypoint in `bin/lgnh-cli.ts`. Preserve its Bun shebang and global symlink behavior outside this repository.
- [x] Add `scripts/build.ts` using `Bun.build`, `@opentui/solid/bun-plugin`, Bun target and `compile` output `dist/lgnh`. Check build success. Change the package script to use it; preserve `dev` and `deploy` names and their behavior.
- [x] Report changed files and any interface adjustment to the integration owner. Do not run intermediate checks or commit.

**Verification after integration:**

- Run `bun test src/process.test.ts`; cancellation test passes and its child is gone.
- Run real OMP argument and stdin translations with temporary model config. Assert translated output, exit 0, and no ANSI in redirected stdout. Test empty input gives exit 1 and does not wait for a terminal.
- In a temporary repository, run `commit-fast` with actual OMP; inspect the real commit subject. Run verified commit with a real local check script, test no-change behavior, then use a deliberately failing check script to prove no new commit occurs.
- Push to a temporary local bare remote; verify its HEAD matches the local commit. Remove the remote before the next push attempt to exercise commit-success/push-failure; assert the local commit remains and exactly one commit was added, with failure detail and exit 1.

### Task 2: Integrated Solid terminal application

**Files:** All Task 2 files listed above.

**Consumes:** `runCommitWorkflow`, `WorkflowEvent`, `formatError`, existing config APIs and `translateText(text, onFallback?, signal?)`.

**Produces:** `runTui` and real home/translation/commit/settings screens.

- [x] Write the focused input regression in `src/tui/translate.test.tsx` using Solid `testRender` and Core mock input, not a mocked renderer. Mount the real presentational editor with its normal submission event; paste `한글🙂\n두 번째 줄`, insert and delete an emoji at its boundary without corrupting surrounding Unicode. Assert visible input and exact submitted Unicode text, plain Enter newline without submission, a single Ctrl+Enter submission and shortcut letters remaining input. Enable Kitty keyboard encoding so modified Enter is distinguishable from legacy CR. No test-only translation backend or fake translated-result assertion; actual backend/result display is covered by the real PTY smoke. Use renderer cleanup in `finally`.
- [x] Implement `runTui(options)` with one caller-owned `createCliRenderer`, Solid `render`, initial route, operation AbortController and completion promise. Use the default alternate screen and state-driven rendering; no animation loop.
- [x] Implement the home menu and keyboard focus. Integrated home routes to the three screens and allows returning when idle; direct command mode starts only its requested operation and exits at the established completion point.
- [x] Implement `TranslateScreen` with native textarea, scrollable result and phase-correct shortcuts. Preserve Enter/Shift+Enter newline, Cmd/Ctrl+Enter submit, bracketed paste, `c`/`a`/`q` and Korean action-key variants in result mode. Disable submission while busy and preserve the last successful result if a later operation fails.
- [x] Implement `CommitScreen` with verification/push/editor choices for integrated mode, an explicit start action, step status/elapsed time, token breakdown, model/fallback, message and detailed error. Direct commit starts after mounting; merely visiting the integrated screen does not start a workflow.
- [x] Implement `SettingsScreen` using `loadConfig`, `saveConfig`, `getModel`, `getConfigPath`. Show path/model and allow a model edit; report write failures without replacing the file contract.
- [x] Use Core `createHostClipboard`, `createClipboard` and `createRendererClipboardAdapter` for copy. `writeText` uses the best available destination and its actual result determines success/failure feedback; dispose the service before renderer destruction.
- [x] Wire editor hooks to renderer suspend/resume. Restore in `finally`, including editor failure. Do not render or read keys while the external editor owns the terminal.
- [x] Handle Ctrl+C, application exit signals and renderer errors in one shutdown path. Create the renderer with `exitOnCtrlC: false`, `exitSignals: []` and a typed `onDestroy` callback resolving the completion Promise; own and remove the signal/error listeners. Abort an active operation, wait for it to settle, dispose clipboard, call `renderer.destroy()`, await native `onDestroy` completion, remove listeners, then resolve `TuiOutcome`. Core 0.5.17 has no `renderer.closed`; do not invent a compatibility property. Prevent navigation/duplicate starts while busy; do not roll back completed Git operations.
- [x] Return one-shot text/success or stderr detail only after cleanup; integrated operation failures remain readable within the app. Report changed files without intermediate checks or commits.

**Verification after integration:**

- Run `bun test src/tui/translate.test.tsx`; visible input, submission boundary and mode-specific shortcut assertions pass.
- Launch source and compiled applications in real PTYs. Navigate home, enter each screen and return; visiting commit must leave the temporary repository's index and history unchanged.
- Exercise Korean/emoji typing, cursor movement, deletion, multiline bracketed paste, Enter and modifier submit, terminal resize, result scrolling, copy and next input. Exercise both one-shot `tr` and `tr -i` with real OMP, including direct interactive initial argument text.
- Use a real external editor for `commit -e` in the PTY and observe editor handoff, commit completion and terminal restoration. Exercise editor failure with a real failing editor executable, not a mock API.
- Exit idle and active screens with Ctrl+C; compare terminal flags/cursor/screen state and ensure the direct child is gone. Do not claim OS IME composition was tested merely from injected UTF-8.
- Save a model using a temporary `LGNH_CONFIG_PATH`; inspect the saved JSON and check the plain `model` command returns that value.

### Task 3: Integration proof and documentation

**Files:** `README.md` and shared-contract corrections only when required by exercised behavior.

**Consumes:** Completed Tasks 1 and 2.

**Produces:** Verified end-to-end migration and user-facing installation/use/build documentation.

- [x] Integrate both slices. Run the formatter once, then `bun run lint`, `bun run typecheck`, `bun test` and `bun run package`. Fix reported errors with their owning implementer; do not rerun solely to reconfirm a reported failure.
- [x] Execute the Task 1 and Task 2 smoke scenarios, splitting headless/Git and PTY/UI verification into two independent verification jobs after the code is complete. Verification jobs do not rebuild or rewrite product files; return commands, observed results and precise failures.
- [x] Run a globally symlinked source launcher from an unrelated temporary working directory and execute a copied `dist/lgnh` outside the repository without node_modules. Observe actual home/help and pipe translation behavior, proving source preload and native embedding respectively.
- [x] After smoke proof, update README for the home screen, compatible commands, key bindings, source launcher and Solid-aware build/deploy. Remove throwaway smoke resources and retain only the focused regression checks.
- [x] Perform a fresh whole-change review against the spec, focusing on the five failure classes above. Fix actionable findings, run the covering scenario, then record only exercised verification and any unobserved IME limitation.
- [x] Commit the complete migration with a Conventional Commit after verification. Do not merge or push the development branch automatically.

## Verification evidence

- Bun 1.4.2, macOS arm64: lint and typecheck exited 0; 2 deterministic regression tests passed (15 assertions); Solid-aware standalone build exited 0.
- Actual OMP source/binary translations, pipes, verified/fast commits, no changes, verification failure, local push and push failure preserving the commit passed in isolated repositories.
- Real PTYs: home navigation, Korean/emoji editing and paste, Enter/Shift+Enter, Ctrl+Enter and Command/Super+Enter submit, empty/duplicate submission, copy readback, next/quit, custom model editing, resize, real vi handoff, Git credential prompt, cancellation and outside-repository launch passed. Native Command is `super`, not `meta`; the permanent editor regression covers both submit modifiers.
- Real OMP preserved a 45-line code block, producing overflowing output: PageDown changed the visible rows; End showed `section39` through `section45`. No fake translation response was used.
- A surviving real shell kept the PTY valid for exact terminal-attribute comparison: success (exit 0), missing-OMP failure (exit 1), and idle/active Ctrl+C (exit 130) restored original termios flags, cursor and alternate screen.
- Independent whole-change review completed; the subsequent Command-modifier correction passed the permanent regression and actual PTY smoke. Owned fixtures and clipboard changes were cleaned/restored; no shared remote was pushed.
- Physical operating-system Korean IME composition remains unobserved; committed UTF-8 input and paste are verified.
