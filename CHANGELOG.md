# Changelog

## 0.14.0 — 2026-10-03

Stable release under the npm `latest` tag. It folds in the 0.14.0-beta.1 – beta.4 prereleases (published under `next` only). **After updating, quit Harness completely (including the tray icon) and start it again**: Harness serves the new workbench UI at once, but the running Host keeps the plugin code it already imported, so the new Host methods are missing until a full restart. The workbench now warns when the Host and client versions differ.

### Added
- **官方工具终端** workbench card: interactive sessions of the system shell (PowerShell on Windows, the login `$SHELL` elsewhere) or an installed official CLI (codex, claude, kimi, mcode, mimo, grok, gemini), in tabs, rendered with xterm.js 6 (bundled into `client.js`). Each CLI also has a fixed **登录** mode (`codex login`, `claude auth login`, …). Sessions start only after a confirmation showing the command, the absolute working directory, and that the terminal runs outside the Harness process sandbox with the user's own CLI login and environment.
- Host session manager (`shared/cli-terminal.mjs`) on the prebuilt N-API `@lydell/node-pty@1.2.0-beta.15` (optional dependency, per-platform binaries, no install scripts), with a pipe fallback and a clear limitation note when the PTY cannot load. Verified on Windows inside Harness Desktop (Electron 44 as Node).
- Typert remote methods `terminalInfo`, `terminalStart`, `terminalRead` (long poll), `terminalWrite`, `terminalResize`, `terminalStop`; every request is validated on both sides (`shared/cli-terminal-protocol.mjs`). The client unwraps both the Host and gateway `{ ok, value }` envelopes, never sends reads or writes for an invalid session id, and clamps resizes into the accepted 10–500 × 3–300 range.
- Session metadata (tool, mode, directory, start/end, duration, exit code, end reason) in `state.json` → `terminalSessions` and in the card's history. Input and output are never logged or stored. Sessions end on tab stop, panel close, plugin unload/reload, Host exit, after about 2 minutes without a reader, or after 6 hours; at most 4 at once.
- `list()` reports `hostVersion`, the plugin version the Host actually loaded. When it differs from the client's version (or is missing), the workbench shows "插件后台版本较旧，请完全退出并重启 Harness（包括托盘图标）后再使用。" and the terminal's 开始 is disabled for missing methods.

### Changed: official tools follow the vendors' latest releases
- The plugin no longer pins Codex, Claude Code, Kimi Code, MiniMax Code, MiMo, Grok Build, Gemini CLI or ZCode versions. One-click installs use `<package>@latest` from `https://registry.npmjs.org/`; the MiniMax Windows fallback runs the official installer script as published; ZCode downloads the newest Windows installer linked from `https://zcode.z.ai/en/docs/install` (HTTPS, `cdn-zcode.z.ai` only, size cap).
- 健康检查 no longer flags installs as "older"/mismatched. Each card shows the installed version and, when available, the latest version with an 有新版本 hint and an 更新到最新版 X button. Latest versions come from the npm registry `<package>/latest` documents and the ZCode download page, cached ~12 h in `model-router/latest-versions.json`; failures are non-fatal (stale value or "最新版本未知"; retried after 30 min). An install newer than the latest release is never downgraded.
- The health card notes that new vendor versions are untested by the plugin. Parsers stay tolerant of output changes.

### Security checks
- Kept (version-independent): Authenticode publisher checks for `codex.exe` (OpenAI OpCo, LLC), `claude.exe` (Anthropic, PBC; plus ≥ 2.1.259 for restricted flags), `ZCode.exe` and the ZCode installer (北京智谱华章科技股份有限公司). The ZCode 3.14.3 version gate is gone: any validly signed build is enabled, with the version read from the signed file.
- Replaced: the per-version hash of ZCode's unsigned `resources/glm/zcode.cjs` became a trust-on-first-use record per (install root, signed build, signer thumbprint) in `model-router/zcode-trust.json`, plus a `.node-bundle-meta.json` entry check. A script that changes under the same signed build is refused; a new signed build re-records it.
- Replaced: the per-version sha256 pins for MiMo `mimo.exe`, Grok `grok.exe(.br)` and MiniMax `cli.js` (these vendors do not sign them) became registry attestation: every code file must equal the file in the official npm tarball for the installed version, whose sha512 comes from registry.npmjs.org (the npm cache is reused when it matches). Results are cached per package@version in `model-router/npm-attestations.json`; the first run of a new version needs network.
- Removed: the hash of MiniMax's official installer script (it now runs as published; only a sanity check that it is the official PowerShell script remains).

### Tests
- `tests/cli-terminal.test.mjs` (protocol, launch resolution, env, manager with a fake PTY, pipe fallback, real PTY on Linux, Host wiring, client transport); `tests/cli-terminal-gateway.test.mjs` with `tests/helpers/typert-gateway.mjs` (the card's real payloads through a copy of Harness's gateway boundary); `tests/latest-versions.test.mjs` (latest lookup with mocked fetch, cache, offline fallback; npm attestation; ZCode/Codex/Claude signer-only acceptance; ZCode first-use record; installer URL validation). Version-pin assertions removed.

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
