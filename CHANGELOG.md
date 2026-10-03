# Changelog

## 0.14.0-beta.1 — unreleased (branch `feat/cli-terminal`)

Branch build for testing; not published to npm.

### Added
- **官方工具终端** workbench card: interactive sessions of the system shell (PowerShell on Windows) or an installed official CLI (codex, claude, kimi, mcode, mimo, grok, gemini), in tabs, rendered with xterm.js 6 (bundled into `client.js`). Each CLI also has a fixed **登录** mode (`codex login`, `claude auth login`, …). Sessions start only after a confirmation showing the command, the absolute working directory, and that the terminal runs outside the Harness process sandbox with the user's own CLI login and environment.
- Host session manager (`shared/cli-terminal.mjs`) on the prebuilt N-API `@lydell/node-pty@1.2.0-beta.15` (new optional dependency, per-platform binaries, no install scripts), with a pipe fallback and a clear limitation note when the PTY cannot load. Verified on Windows inside Harness Desktop (Electron 44 as Node, pnpm 11 install).
- Typert remote methods `terminalInfo`, `terminalStart`, `terminalRead` (long poll), `terminalWrite`, `terminalResize`, `terminalStop`; every request is validated on both sides (`shared/cli-terminal-protocol.mjs`).
- Session metadata (tool, mode, directory, start/end, duration, exit code, end reason) in `state.json` → `terminalSessions` and in the card's history. Input and output are never logged or stored.
- Sessions end on tab stop, panel close, plugin unload/reload, Host exit, after about 2 minutes without a reader, or after 6 hours; at most 4 at once.

## 0.13.3 — 2026-10-03

Bug-fix release for DeepSeek Harness Desktop 0.2.0-rc.1 / 0.2.0-rc.2, published under the npm `next` and `latest` tags.

**After updating, quit Harness completely (including the tray icon) and start it again.** A live patch reload does not replace plugin code that the running Host has already imported.

### Fixed
- On Harness Desktop for Windows, every official CLI run that went through the Harness process sandbox exited 0 with no output, so the step paused with "Codex 未返回完整成功终态和回答" and no model was called. The sandbox runner is started as `DeepSeek Harness.exe …/runner.js`, which needs `ELECTRON_RUN_AS_NODE=1`; the plugin's minimal CLI environment dropped it, so the executable started the desktop app instead, lost the single-instance lock and quit. The runner now gets that variable whenever it is the Electron executable.
- Codex cannot start inside the Harness Windows sandbox at all: it must write `CODEX_HOME` (`~/.codex`) and the sandbox denies those writes (`failed to initialize in-process app-server client: … (os error 5)`). On Windows, Codex now skips the Harness sandbox and starts directly with its own `--sandbox read-only`. This is the launch the "不经沙箱启动 CLI" confirmation already describes.
- A CLI that exits without writing anything to stdout or stderr is now reported as such, for example "Codex 退出码 0，无任何输出（stdout 与 stderr 均为空）。", instead of a generic "incomplete answer" message.

## 0.13.2 — 2026-10-03

Bug-fix release for DeepSeek Harness Desktop 0.2.0-rc.1 / 0.2.0-rc.2, published under the npm `next` and `latest` tags.

### Fixed
- Codex runs through the signed Windows runner failed in any workspace that is not a Git repository (for example a plain project folder chosen in the workbench). The step paused with "Codex 未返回完整成功终态和回答" and no model call was made. Codex 0.157.1 refuses such directories unless `--skip-git-repo-check` is passed (`Not inside a trusted directory and --skip-git-repo-check was not specified.`). The flag was only in the portable adapter; the signed runner now passes it too. Read-only runs stay confined by `--sandbox read-only` and the Harness process sandbox.
- When Codex exits without a successful turn, the error now names the cause: an untrusted directory, or no JSON events at all (with the last CLI output line). The pause detail no longer comes out empty when stderr is empty but stdout has output.

## 0.13.1 — 2026-10-03

Bug-fix release for DeepSeek Harness Desktop 0.2.0-rc.1 / 0.2.0-rc.2, published under the npm `next` and `latest` tags.

### Fixed
- Workbench runs ("在工作台执行": preview, then confirm), `model_router_execute` and step reruns failed in the Harness with `cannot get property "credentials" without inject`. The executor read `ctx?.credentials`, which is not in the plugin's `inject` list; Cordis throws for every non-injected `ctx.<service>` read, and optional chaining does not help. Optional services are now read through `ctx.get(name)`, as the Harness itself does, so nothing new is required at load time. The run never started, so no model was called and nothing was billed. The failed run stays in history with that error.
- The source-only npm update helper (not shipped in the package) reads `connection`, `desktopProfiles` and `desktopPnpm` the same safe way.

### Tests
- Test mocks for Host code paths now enforce `inject` like Cordis (`tests/helpers/strict-ctx.mjs`).
- New `tests/cordis-inject.test.mjs` runs the workbench preview and run, `executeConfiguredAssignment` and a step rerun in a real Cordis plugin context with the Host `inject` list and sibling-provided services, with and without a `credentials` service. It also scans Host sources for `ctx.<name>` reads of non-injected services.

## 0.13.0 — 2026-10-03

Prerelease for DeepSeek Harness Desktop 0.2.0-rc.1 / 0.2.0-rc.2, published under the npm `next` tag. Merges PR #1 and PR #2.

### Package renamed
- The npm package is now **`@ljwei-stak/dsh-model-router`**. The last version under the old name `@ljwei-stak/model-router-galgame` is 0.13.0, with the same content as `@ljwei-stak/dsh-model-router@0.13.0`; the old name will get no further updates. Upgrade by removing the old plugin and adding the new one; do not install both.
- The profile entry id, panel id, settings namespace and Cordis plugin name stay `model-router-galgame`, and state stays in `~/.dsh/model-router/`, so saved settings and run history carry over. See [MIGRATION.md](MIGRATION.md).

### Official CLI execution (PR #1)
- Assigned work packages run through the official vendor CLIs (Claude Code, Codex, Gemini CLI, Kimi Code, MiniMax Code, MiMo Code, Grok Build) with headless adapters; failures fall back to the Harness model catalog API.
- `model_router_execute` can pin a single `provider`/`model` (direct mode) instead of comparing routes.
- Claude instructions stay positional; Codex reconnect notices are no longer treated as failures.

### Health check, routing visibility and cost control (PR #2)
- **Health check** (`model_router_health`, onboarding banner): install state, pinned version and login state per CLI. Uses read-only status commands (`claude auth status`, `codex login status`) or the presence of credential/state files (Gemini, Kimi, MiMo, Grok, MiniMax `auth-state.json`); credentials are never read. Logged-out CLIs are skipped immediately.
- **Routing decisions** carry the vendor's sanitized error, difficulty, estimated cost and channel per package; manual reassignment.
- **Cost control**: daily/monthly budgets, pre-run estimates (also for `model_router_tool_run`), actual cost from CLI-reported cost or token usage × configured price (Claude, Codex, Gemini, Grok, MiMo, MiniMax), auto-downgrade or pause when over budget.
- **Presets**: cheapest / balanced / best quality.
- **Subscription-first billing** for every vendor: CLI account logins and coding-plan key routes are used first; quota exhaustion or rate limits switch to the API key until the vendor's reset time; other subscription failures pause and ask (retry subscription / use API / cancel). Only API-billed spend counts toward budgets.
- **Run history and DAG**: every execute / team / tool run is recorded locally with status per step; single-step rerun (read-only teams), continuation of a failed editable team run in a fresh worktree seeded with earlier changes, and rerun of failed tool calls.
- **Workbench run launcher**: start a read-only run from the workbench with plan preview, cost estimate and one confirmation listing every reason.
- **Security boundaries**: per-route read/write scope and sandbox status; one combined approval prompt for file writes, API-key fallback, over-budget and unsandboxed CLI starts.
- **Quality loop**: optional stronger-model review (off / sample / always) and 👍/👎 ratings with bounded influence.
- Multi-process safe state (`state.json.lock`, merged writes); quota and auth marks from other processes apply without restart; corrupted state is backed up and reported.
- Windows: CRLF-safe client build check, Grok `GROK_HOME` login hint, ZCode unverified-version notice.

### Known limitations
- The workbench launcher starts read-only runs only; editable runs start from a session.
- Kimi and ZCode headless output reports no token usage; ZCode login state stays unknown; only ZCode 3.14.3 is verified.
- Not yet verified end to end inside the Harness Desktop UI.

## 0.12.0

First independent router release; GAL moved to `@ljwei-stak/dsh-galgame`.
