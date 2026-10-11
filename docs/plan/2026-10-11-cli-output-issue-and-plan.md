# OMP 및 서브프로세스 환경의 CLI 출력 이슈 원인 분석 및 개선 계획

- **일자**: 2026-10-11
- **대상**: `lgnh commit`, `lgnh commit-fast`, `lgnh commit-push`, `lgnh commit-fast-push`, `lgnh tr`
- **관련 파일**: `src/main.ts`, `src/tui/app.tsx`, `src/tui/commit.tsx`, `src/workflows.ts`
- **변경된 결정**: 단발성 명령을 무조건 순차 출력으로 바꾸지 않고, OMP 환경을 자동 감지하여 기존 순차 출력 경로를 선택한다. 일반 터미널의 TUI 기본값은 유지한다. 아래 트리 스타일 개선은 별도 미구현 계획이다.

---

## 1. 현상

OMP, 에디터 내장 터미널, 서브프로세스 실행 환경 등에서 `!lgnh commit`을 실행할 때 이전(OpenTUI 전환 전)과 달리 출력이 깨지거나 중간 진행 과정이 보이지 않고 최종 한 줄만 남거나 빈 화면처럼 보이는 현상 발생.

---

## 2. 근본 원인 분석

### 2.1 대체 화면 버퍼(Alternate Screen Buffer, `\x1b[?1049h` / `\x1b[?1049l`) 전환에 따른 화면 소멸

- OpenTUI(`createCliRenderer`)는 초기화 시 터미널을 **대체 화면 버퍼(Alternate Screen)**로 강제 전환함.
- `lgnh commit` 워크플로우(검증, 스테이징, 토큰 분석, 커밋)가 실행되는 동안 모든 UI와 진행 상태는 대체 화면 버퍼에 그려짐.
- 워크플로우 종료 시 `renderer.destroy()`가 호출되면서 터미널이 **원래 화면 버퍼(`\x1b[?1049l`)로 복귀**함.
- 터미널 표준 규격상 대체 화면 버퍼의 내용은 복귀 즉시 완전히 폐기(discard)됨.
- 복귀 후 `src/main.ts`가 표준 출력으로 내보내는 것은 `outcome.stdout`의 **최종 결과 단 한 줄**뿐이므로 이전 단계의 모든 로그(검증 결과, 토큰 분석, 진행 소요 시간 등)가 터미널 스크롤백에 남지 않음.

### 2.2 2D 캔버스 절대 좌표 Redraw vs 순차 텍스트(Line Stream) 캡처 불일치

- **TUI 이전**: 표준 출력에 줄바꿈(`\n`) 단위로 순차 텍스트를 출력하여, OMP나 서브프로세스 캡처 도구가 파이프/PTY로 라인 단위 로그를 그대로 읽어 채팅창/로그에 기록함.
- **TUI 전환 후**: 전체 화면 크기(예: 80×24)를 2D 캔버스로 잡고 절대 커서 위치 이동(`\x1b[<y>;<x>H`), 줄 지우기(`\x1b[2K`), 박스 테두리 덮어쓰기(`\r`)를 반복 전송함.
- OMP의 서브프로세스 캡처 엔진은 가상 터미널(xterm) 렌더러가 아니므로, 제어 시퀀스를 문자열로 누적 처리하는 과정에서 텍스트가 겹치거나 깨진 특수문자/대량 공백으로 오염됨.

### 2.3 PTY 환경에서의 무조건적인 `tuiEligible` 활성화

- `src/main.ts`의 분기 조건:
  ```ts
  const tuiEligible = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  ```
- OMP의 `!<cmd>` 실행기는 서브프로세스에 가상 터미널(PTY)을 연결하므로 `stdin.isTTY`와 `stdout.isTTY`가 모두 `true`가 됨.
- 이로 인해 단발성 CLI 명령(`lgnh commit`)임에도 대화형 전체 화면 TUI로 강제 분기됨.
- 반면 `lgnh commit | cat`과 같이 표준 출력을 파이프로 연결하여 TTY를 비활성화하면 이미 구현되어 있는 `runCommitPlain`이 동작하여 순차 텍스트가 정상 출력됨.

---

## 3. TUI 전환 이전 버전(`dd78e21`) 출력 스타일 분석

OpenTUI 도입 직전 커밋(`dd78e21`)은 `@clack/prompts`와 `picocolors`를 기반으로 유려한 트리(Tree)형 CLI 출력을 제공했음.

### 3.1 당시 출력 구성 요소 및 시각적 특징

1. **헤더 (Intro)**:
   - `p.intro(pc.bold("lgnh commit"))`
   - 트리 시작 기호(`┌`)와 굵은 텍스트로 명령어 진입을 명확히 알림.
2. **단계별 진행 로그 (Step / Elapsed Time)**:
   - 트리 세로선(`│`)과 단계 불릿(`◆` / `◇`) 사용.
   - 각 단계 완료 시 소요 시간을 딤드 회색(`pc.dim("[0s]")`)으로 우측에 표기.
   - 예: `│  ◆  Verified (check) [0s]`
   - 예: `│  ◆  Staged changes [0s]`
3. **토큰 분석 트리 (Context Metrics)**:
   - 세로 연결선 내부에서 세부 하위 트리(`├─`, `└─`)로 계층 표현.
   - diff, stat, prompt는 노란색(`pc.yellow`), 최종 total은 시안 굵은 글씨(`pc.cyan(pc.bold(...))`)로 강조:
     ```text
     │  Context tokens:
     │    ├─ diff:   1,234 tokens (4,567 chars)
     │    ├─ stat:   120 tokens (450 chars)
     │    ├─ prompt: 890 tokens (3,200 chars)
     │    └─ total:  2,244 tokens
     ```
4. **모델 안내 및 진행 중 알림**:
   - fallback 발생 시 주황색 경고(`pc.warn`), 모델명은 시안(`pc.cyan`) 표기.
   - `│  Generating message... (opencode-go/muse-spark-1.3-contributor)`
   - `│  ◆  Generated message (opencode-go/muse-spark-1.3-contributor) [1s]`
5. **커밋 메시지 박스 (Note)**:
   - `p.note(message, "Commit message")`
   - 생성된 커밋 메시지를 라운드/박스 형태의 하위 블록으로 감싸 한눈에 내용 파악 가능.
     ```text
     │
     ◇  Commit message
     │  feat(scope): summarize change
     │  - concise bullet point
     │
     ```
6. **최종 종료 (Outro)**:
   - `p.outro(pc.green("Committed successfully."))`
   - 트리 종료 기호(`└`)와 녹색 강조로 워크플로우 완결 표시.

### 3.2 이전 출력이 훌륭했던 이유

- **완전한 1차원 라인 스트림(Line Stream)**: 모든 출력이 줄바꿈(`\n`) 단위로 한 줄씩 아래로 흘러감.
- **스크롤백 영구 보존**: 터미널이나 OMP의 스크롤을 올려도 작업 이력이 완전히 보존됨.
- **대체 화면 버퍼 미사용**: 화면 깜빡임, 화면 초기화(`\x1b[2J`), 종료 시 내용 증발 문제가 원천적으로 없음.
- **수려한 가독성**: 트리 룬(`┌`, `│`, `◇`, `◆`, `└`)과 ANSI 컬러 조합으로 전면 TUI 못지않은 세련된 시각적 피드백 제공.

---

## 4. 개선 방향 및 목표 디자인

외부 무거운 라이브러리(`@clack/prompts`)를 다시 추가하지 않고, **자체 경량 ANSI 컬러 및 트리 룬 포맷터**를 구현하여 전환 이전의 세련된 출력을 완벽히 재현함.

### 4.1 CLI 출력 목표 형태 (Preview)

```text
┌  lgnh commit
│
│  ◆  Verified (check) [0s]
│  ◆  Staged changes [0s]
│
│  Context tokens:
│    ├─ diff:   1,420 tokens (5,210 chars)
│    ├─ stat:   110 tokens (420 chars)
│    ├─ prompt: 950 tokens (3,800 chars)
│    └─ total:  2,480 tokens
│
│  Generating message... (opencode-go/muse-spark-1.3-contributor)
│  ◆  Generated message (opencode-go/muse-spark-1.3-contributor) [2s]
│
◇  Commit message ───────────────────────────────────────╮
│  feat(cli): enhance sequential output formatting       │
│                                                        │
│  - restore tree-style aesthetic without full TUI       │
│  - support reliable log capture in omp and subshells   │
╰────────────────────────────────────────────────────────╯
│
│  ◆  Committed [0s]
│
└  Committed successfully.
```

### 4.2 실행 모드 분리 원칙

| 실행 환경 / 옵션                                   | 동작 방식                   | 이유                               |
| -------------------------------------------------- | --------------------------- | ---------------------------------- |
| 일반 터미널, stdin/stdout 모두 TTY                 | 기존 OpenTUI                | 기존 대화형 UX 유지                |
| OMP (비어 있지 않은 `OMPCODE`, 보통 `1`), PTY 포함 | 기존 순차 텍스트 경로       | 화면 재그리기 없이 로그 캡처       |
| stdin 또는 stdout이 비-TTY                         | 기존 순차 텍스트 경로       | 파이프 호환                        |
| `lgnh --plain commit`                              | 순차 텍스트                 | 자동 감지 수동 덮어쓰기            |
| `lgnh --tui commit`                                | 두 스트림이 TTY이면 OpenTUI | OMP에서도 명시적으로 TUI 선택 가능 |

실제 OMP 도구의 PTY 실행에서 두 스트림의 `isTTY=true`, `OMPCODE=1`, `TERM=xterm-256color`를 확인했다. `isTTY`나 `TERM`만으로는 이 환경을 일반 터미널과 구분할 수 없다. 환경변수를 전달하지 않는 다른 캡처 실행기는 이 감지의 대상이 아니며, `--plain`으로 선택할 수 있다. `NO_COLOR`나 Orca 터미널 사용 여부만으로 캡처 환경이라고 판단하지 않는다.

---

## 5. 상세 작업 계획 (Action Plan)

### Step 1. 경량 CLI 스타일링 유틸리티 정의 (`src/ui-style.ts` 또는 `src/main.ts`)

- 의존성 추가 없이 순수 ANSI 이스케이프 코드와 유니코드 트리 룬 정의:
  - 색상: `bold`, `dim`, `cyan`, `green`, `yellow`, `red`
  - 기호: `┌`, `│`, `└`, `◆`, `◇`, `├─`, `└─`
- 터미널 폭에 맞춘 커밋 메시지 박스 포맷터 구현.
- `NO_COLOR` 환경변수 또는 비-TTY 파이프 환경에서는 ANSI 코드를 제거하고 깔끔한 플레인 텍스트로 fallback.

### Step 2. `runCommitPlain` 및 `printWorkflowEvent` 고도화

- `src/main.ts`의 `runCommitPlain`에 Intro(`┌  lgnh <cmd>`) 및 Outro(`└  Committed ...`) 추가.
- `printWorkflowEvent`를 개선하여:
  - 단계 진행/완료/실패 시 `│  ◆  <label> [소요시간]` 형태로 출력.
  - 컨텍스트 토큰 정보 수신 시 하위 트리 및 컬러 강조 적용.
  - 커밋 메시지 수신 시 박스 블록으로 예쁘게 렌더링.

### Step 3. 공통 진입점 자동 감지 (`src/cli.ts`)

- OMP 식별 신호 `OMPCODE`가 비어 있지 않거나 `TERM=dumb`이면 기존 순차 출력 경로를 선택한다.
- 일반 터미널에서는 기존 TUI 기본 동작을 유지한다.
- 명령 앞의 `--plain` / `--tui`를 보조 옵션으로 제공한다. 번역 텍스트와 모델 인자는 출력 옵션으로 오인하지 않는다.
- 공통 판정으로 commit 별칭, 번역, 인자 없는 홈 진입에 일관되게 적용한다.

### Step 4. 빌드 및 검증

- `bun run package`를 통해 `dist/lgnh` 생성.
- 검증 시나리오:
  1. OMP PTY에서 `lgnh commit`: 대체 화면 전환 없이 기존 순차 로그가 남는지 확인.
  2. 일반 터미널 `lgnh`: 대화형 OpenTUI 홈 메뉴가 정상 동작하는지 확인.
  3. 일반 터미널의 기존 TUI 선택 및 `--plain` / `--tui` 덮어쓰기 검증.
  4. 파이프 환경: 명시적 `--tui`도 비-TTY에서 렌더러를 열지 않는지 확인.

### 적용 및 검증 결과

- 공통 자동 감지와 명령 앞의 `--plain` / `--tui`를 구현했다. 트리 스타일 재현은 이번 변경에 포함하지 않았다.
- `bun test`: 7개 통과. `bun run typecheck` 및 `bun run package` 통과.
- 빌드된 실행 파일을 실제 PTY에서 실행: OMP의 commit 별칭 4개 모두 깨끗한 임시 저장소에서 순차 로그로 종료하고 ANSI 커서 제어가 없는 것을 확인했다. 실제 AI 커밋 생성과 push는 이 검증에서 수행하지 않았다.
- OMP PTY에서 `tr 안녕하세요`의 실제 번역 결과 `Hello`와 모델 안내가 순차 출력되는 것을 확인했다. 입력 없는 `tr` / `tr -i`는 오류로 종료하여 EOF 대기를 피한다.
- OMP에서는 인자 없는 실행이 도움말을 출력한다. 일반 터미널의 홈·커밋 화면과 OMP의 `--tui commit`은 TUI가 렌더링되고 SIGINT 종료 시 원래 화면 버퍼로 복귀하는 것을 확인했다.
- 일반 터미널의 `--plain commit`, 비-TTY의 `--tui commit` 모두 순차 출력으로 종료했다.
