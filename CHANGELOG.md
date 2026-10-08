# Changelog

## 0.16.1 — 2026-10-08

Stable maturity patch under the npm `latest` tag. Fully quit Harness, including the tray process, and restart after upgrading. Existing 0.16.0 artifacts remain unchanged.

- Separate stable feedback evidence identity from hourly decay invalidation; expose bounded per-route/domain observed feedback diagnostics and exclusion reasons without changing objective quality floors.
- Remove superseded personalization, reject invalid/missing usage costs instead of treating them as free, and retain immutable historical charges.
- Recover interrupted public refresh leases, propagate overall timeout/cancellation, isolate source changes, sanitize public status, and reproject in-flight responses against current settings.
- Guard settings/rating submissions, preserve newer drafts, await summary refresh, fix paused-result Hook order, and surface retained-but-unverified summaries.
- Never steal live state locks; detach committed state, roll back rejected updates, preserve unsupported schemas and unique corrupt backups, and prevent incomplete charge history from passing configured budgets.
- Package the maturity derivations, regression reproduction and remaining limits in `docs/ROUTING_MATURITY.zh.md`. Release validation: 622 tests passed, 3 conditional skips, client/preview checks passed. No paid calls, real-user ledger changes or real quality-cost benefit claim.

## 0.16.0 — 2026-10-05

Stable release under the npm `latest` tag. Fully quit Harness, including the tray process, and restart after upgrading so both the Host and client load the new version. Public data refresh is opt-in; enabling it does not authorize paid model exploration.

- Add opt-in versioned public LiveBench/curated pricing snapshots with TTL, failure backoff, last-good fallback and atomic cross-process promotion; explicit manual prices win. Freeze each run's applied rates and data/policy versions, and disable cleared sources immediately without deleting recoverable snapshots.
- Replace production review/rating quality bias with task-specific, time-decayed, shrinkage-regularized subjective utility. Preserve objective proxy quality floors; expose learning controls/reset and the local DSH_HOME / last-200-runs scope. Agent rating tools require approval; Desktop ratings bind to the displayed result timestamp.
- Require explicit score scale for dynamic benchmark mirrors and exact benchmark model identity; expose optional benchmarkModel mapping without claiming verified execution effort. Add controlled synthetic adaptation and Host/Client integration tests; no paid exploration, real-user result collection, universal official pricing scraper or actual quality-cost benefit claim.

- Use estimated per-package token cost against a fixed reference pricing scale, not the most expensive configured route; an irrelevant expensive model no longer rescales existing preferences. Remove the model-name-specific synthesis bonus.
- Protect least-cost known-price candidates before truncating pools. Disable local Pareto pruning for dependency-coupled tasks, where route identity changes later handoff penalties.
- Solve retained candidate spaces of at most 4,096 combinations exactly; larger spaces use bounded beam search with a protected affordable prefix. Expose exact/approximate search, candidate truncation and the surrogate-objective scope instead of claiming global answer-quality optimality.
- Correct repeated quality-bias application for unknown models. Explain that benchmark/manual scores and quality floors are not calibrated correctness probabilities.
- Preserve explicit/derived benchmark provenance, exclude image-ineligible savings baselines, and use unrounded totals for budget gates. Report quality filtering, Pareto pruning, and candidate truncation separately.
- Add independent exhaustive-oracle tests and a label-matrix offline evaluation tool with validation-selected single-model baselines, random routing, hindsight Oracle, actual recorded costs and rare-expert recall. No paid model calls or real quality-improvement claim.
- Audit the official LiveBench 2026-06-25 aggregate score/cost release with pinned source hashes, complete-coverage checks and descriptive static Pareto profiles. Add continuous-score, domain-stratified whole-group paired bootstrap tooling and document the missing latest per-question cost/quality matrix. Aggregates are not replayed as question outcomes; no real routing-benefit claim or production routing change.

Validation: 558 tests, with 555 passed, 3 existing platform-condition skips and no failures. Strict frozen-lockfile installation, generated-client check and actual-component mock-preview compilation passed. Nine controlled synthetic adaptation checks passed; these are mechanism tests, not real model quality-cost gains. Real paid model calls, user-result collection, execution-effort validation and Harness Desktop end-to-end acceptance were not part of this verification. Research artifacts are in the complete GitHub source checkout, not the npm runtime package; historical experiments retain their original development-version identifiers.

## 0.15.0 — 2026-10-03

- Reorganize the workbench into task/execution, model configuration, official tools, and budget/security pages. Keep panels mounted so drafts, installation polling, and terminal sessions survive navigation; add keyboard tab navigation and panel-width responsive layouts.
- Show local routing results immediately after task planning, with expandable work-package details and human-readable dependency names.
- Discard pending execution previews when their inputs change, and confirm only the request that was actually previewed. Invalidate local plans when model profiles or routing settings change externally.
- Preserve API spending, unknown-call counts, and subscription reference costs when detailed history is pruned or a step is retried. Retain 200 detailed runs plus bounded calendar aggregates; previously discarded costs cannot be recovered.
- Add `npm run preview:ui`: a localhost-only preview of the actual client with in-memory fixtures, five normal/error/empty/onboarding/delayed scenarios, and no real model calls or terminal processes.
- Rewrite the English/Chinese README, installation instructions, and workbench guide around the current capabilities, source setup, execution boundaries, and local-data behavior. Include the guide and a clearly labeled simulated UI screenshot in the package.

Validation: 220 tests passed, with 3 existing Windows-specific skips; the generated client and packaged file bytes were checked. Browser preview checks cover navigation, narrow panels, validation, draft persistence, and stale-preview rejection. Real vendor accounts, paid CLI calls, and Harness Desktop end-to-end execution were not exercised in this release's validation.

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
