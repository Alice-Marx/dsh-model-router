# Changelog

## 0.13.0 — 2026-10-03

Prerelease for DeepSeek Harness Desktop 0.2.0-rc.1 / 0.2.0-rc.2, published under the npm `next` tag. Merges PR #1 and PR #2.

### Package renamed
- The npm package is now **`@ljwei-stak/dsh-model-router`**. `@ljwei-stak/model-router-galgame` stops at 0.12.0 and is no longer updated. Upgrade by removing the old plugin and adding the new one; do not install both.
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
