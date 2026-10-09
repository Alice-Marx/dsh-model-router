# Model Router · DeepSeek Harness Desktop

Version: **0.16.2**. See [routing research](docs/ROUTING_RESEARCH.zh.md), [mathematical derivation and experiments](docs/ROUTING_DERIVATION_EXPERIMENTS.zh.md), and the [LiveBench evidence audit and validation protocol](docs/ROUTING_LIVEBENCH_VALIDATION.zh.md). The latest public 2026-06-25 score/cost tables are aggregates; its paired question-quality/cost matrix has not been obtained, and no real routing gain is claimed.

A cost-aware model-routing workbench for **DeepSeek Harness Desktop**. Describe a task, compare your configured models, inspect the plan, and explicitly choose when to execute it.

**0.16.2:** the official-tools update/install button keeps the job started by that click, stays usable while a previous probe is refreshing, and shows a row error when the click cannot start or the probed version does not advance. Installed Claude Code runs `claude update` before the registry npm install. Installed Windows MiniMax runs the official installer.

**0.16.1:** [maturity improvements and validation](docs/ROUTING_MATURITY.zh.md) adds stable feedback cache identity, per-model/task feedback explanations, source-refresh and settings-race protection, and budget gates for unreadable or incomplete cost history. Mechanism tests do not establish real quality–cost gains.

**0.16.0:** [dynamic data and adaptive feedback](docs/ROUTING_ADAPTIVE_LEARNING.zh.md) adds opt-in public benchmark/curated fixed-USD pricing refresh and task-specific, time-decayed, shrinkage-regularized subjective utility. Objective proxy quality floors remain separate. Public sources default off; preferences are shared within one local DSH_HOME and limited to the latest 200 runs. This is not a universal vendor-price scraper or evidence of real quality–cost gains.

Current version: **0.16.2** (`@ljwei-stak/dsh-model-router`). Its declared host compatibility is **DeepSeek Harness Desktop 0.2.0-rc.1 / 0.2.0-rc.2**. The router and [GAL](https://github.com/Alice-Marx/deepseek-harness-galgame) have been independent plugins since 0.12.0.

**0.15.0 changes:** a four-tab workbench with routing advice directly below task planning, protection against stale execution previews, preserved spending totals across history pruning and retries, and a standalone mock UI preview for source development.

[简体中文](README.zh.md) · [Workbench guide (Chinese)](docs/WORKBENCH_USER_GUIDE.zh.md) · [Installation guide (Chinese)](INSTALLATION_GUIDE.zh.md) · [Migration](MIGRATION.md) · [Changelog](CHANGELOG.md)

For self-testing, follow the [desktop acceptance and quality–cost experiment steps (Chinese)](docs/ROUTING_SELFTEST_STEPS.zh.md). Start with an 18-question, three-model pilot and an explicit spending limit. Offline helpers do not collect answers or call models; first-stage selection replay is distinct from end-to-end team execution.

## What is included

| Capability | Current behavior |
| --- | --- |
| Task planning | Local task classification and complexity analysis; single-route recommendation, dependent team work packages, or an explicit configured model. |
| Model configuration | Reads exact `provider/model` routes from Harness; optional user-supplied quality, USD prices, specialties, CLI model names, execution and billing preferences. |
| Routing presets | Economy, balanced and quality-first presets; quality floors, estimated token costs and bounded assignment search. Missing prices stay unknown. |
| Read-only execution | Preview and confirm a routed run from the workbench, or invoke it in an official Harness session. Supported headless CLIs and model-directory API calls return recorded results. |
| Editable CLI execution | One supported official CLI or a sequential CLI team, using approved isolated Git worktrees and conditional patch integration. |
| Official tools | Detect, install/update, check launch readiness and inspect login status for eight registry tools; installation jobs have logs and cancellation. |
| Interactive terminal | PowerShell/system shell and seven CLI targets, including fixed login commands, live output and multiple sessions. |
| Costs and subscriptions | Daily/monthly budget checks, economy downgrade or pause, subscription-first routing, quota cooldown and explicit handling of other subscription failures. |
| History and quality | Per-package results, dependency views, failure details, rerun/reassignment, ratings and optional stronger-model review. |
| Execution boundaries | Shows what each route can read/write and whether its process uses the Harness sandbox. |

Generating a route recommendation is local: it does not start a vendor CLI or make a paid model call. Actual execution can incur charges.

![Local planning and official-tool execution](docs/assets/routing-workflow.svg)

## Install in DeepSeek Harness Desktop

Open **Plugins → Add plugin** and enter:

```text
@ljwei-stak/dsh-model-router@0.16.2
```

Use the official HTTPS npm source `https://registry.npmjs.org/` when a mirror lacks that exact version. Enable the plugin, then fully quit Harness (including its tray process) and restart it. Plugin details should show **0.16.2** and the sidebar should contain **模型路由** (Model Router). A global `npm install -g` alone does not register a Desktop plugin.

You can instead install a local `.tgz` archive or its extracted inner `package` directory through the plugin manager. Both must contain `package.json` and `.dsh-plugin`. See [releases](https://github.com/Alice-Marx/dsh-model-router/releases) for archived builds, or build your own checkout below.

### Upgrade from the old package name

The old name `@ljwei-stak/model-router-galgame` ended at 0.13.0. Remove that plugin entry while retaining your profile/application data, then add `@ljwei-stak/dsh-model-router@0.16.2`. Do not keep both entries installed: they share the internal plugin id `model-router-galgame` and tool names. The retained id lets existing router settings and history carry over.

For the combined 0.11.x package, back up the profile and export the GAL saves you want to preserve before upgrading. Story playback, artwork, music and saves now belong to the independent `@ljwei-stak/dsh-galgame` package. The detailed save limitations are in [MIGRATION.md](MIGRATION.md).

## Use the workbench

The 0.15.0 workbench groups the workflow into four navigation tabs. Its header summarizes registered routes, detected tools and today's recorded API spending.

| Tab | What you do there |
| --- | --- |
| **任务与执行** — Task and execution | Describe the task, select a planning mode, generate advice, preview a read-only run and inspect run history. |
| **模型配置** — Model configuration | Refresh/search the model directory and edit exact-route profiles. |
| **官方工具** — Official tools | Complete onboarding checks, inspect/install tools and use the interactive terminal. |
| **预算与安全** — Budget and security | Set routing/cost/review policies and inspect subscription status and execution boundaries. |

Switching tabs keeps the panels mounted, preserving in-progress installation and terminal state.

![0.15.0 workbench preview: task planning and routing advice](docs/assets/workbench-task-preview.jpg)

*Screenshot from the local UI preview with fixture models, prices, and health data. No real model or Harness connection was used. Expand a work package to inspect its goal, dependencies, and acceptance checks.*

1. Configure providers, models and credentials on Harness's official **Models** page. In **模型配置**, refresh the directory. A listed route does not prove that its credentials, network or model entitlement work.
2. Optionally enter quality and prices for the routes you want compared. Prices are **USD per million tokens**; quality is a user-supplied **0–100** estimate. Leave unknown prices blank rather than entering zero.
3. In **任务与执行**, describe concrete deliverables, constraints and acceptance criteria. Select **单任务** (single recommendation), **团队分工** (dependent packages for sufficiently complex requests), or **指定模型** (one exact route, without comparing others). Team mode alone does not start any team.
4. Set the per-run estimate target; `0` removes that planning constraint. Click **生成路由建议**. The result appears directly below planning. Check the route, complexity, cost, execution channel and each package's dependencies/checklist.
5. For a real read-only run, use **在工作台执行**. Enter an existing absolute workspace path, or reuse the last run's path. Click **预览执行计划**, review the current route and all required confirmations, then explicitly confirm execution. The Host rechecks the plan before starting; changed conditions can require confirmation again.
6. Inspect **执行记录与子任务** for the actual channel, response, failures, cost and ratings. Editable CLI tasks start from an official Harness session using the tools below.

Changing task text, planning mode, profiles, directory or relevant settings invalidates the prior recommendation. Changing execution inputs also discards the pending or completed preview, so execution requires a new preview of the current request. Previewing execution uses current Host state and can differ from a previous local plan.

Example task:

```text
Review this project and prepare an implementation plan.
1. Map the entry points and identify the main UI workflows.
2. Review the interface at wide and narrow widths; list layout problems.
3. Check the execution and billing boundaries.
4. Combine the findings into a prioritized change list with verification steps.
```

The router plans and delegates text/code tasks. It does not itself render videos, generate artwork or control creative applications.

## Session tools

Ask an official Harness session to invoke these tools. Configure the session workspace before tasks that access local files.

| Tool | Purpose |
| --- | --- |
| `model_router_routes` | List configured routes; does not verify account/network availability. |
| `model_router_plan` | Generate a local `single` or `team` plan. |
| `model_router_consult` | Ask one configured model for a live second opinion via the model API. |
| `model_router_execute` | Execute a read-only routed plan, or one explicit `provider`/`model`, with recorded results. |
| `model_router_tools` / `model_router_health` | Inspect installation/readiness or version/login/billing health. |
| `model_router_tool_install` | Install one fixed registry tool from its official source. |
| `model_router_tool_run` | Run one supported CLI in `read-only` or approved `workspace-write` mode. |
| `model_router_team_execute` | Replan among currently executable CLI routes, then run work packages sequentially. |
| `model_router_rerun_step` | Rerun a failed step and its unfinished dependents, resume eligible editable teams, or repeat a failed single-tool run. |
| `model_router_rate` | Record `up`, `down` or `clear` for one stored result. |

Session commands are `/router <task>`, `/tools`, and `/tools install|cancel <tool-id>`.

A local planning request:

```json
{"task":"Review the architecture and prepare a verification checklist","mode":"team","budgetUsd":10}
```

A read-only single-tool request:

```json
{"tool":"codex","task":"Inspect the repository and list UI layout issues; do not edit files","mode":"read-only"}
```

Supply `provider` and `model` together when selecting an exact catalog route. A vendor's CLI model name may differ from its Harness id; use `cliModel` or team `cliModelsJson` only for names verified with that CLI. ZCode uses its own default and cannot switch model per call. Most CLIs do not report a verifiable actual model id; check the vendor run record.

The CLI team runner is the plugin's own sequential dependency executor. It does not control the model selection or lifecycle of Harness's built-in Agent Teams.

## Official tools and execution modes

| Registry id | Tool | Managed single-tool/team modes |
| --- | --- | --- |
| `kimi-code` | Kimi Code | Approved `workspace-write` |
| `claude-code` | Claude Code | `read-only`, approved `workspace-write` |
| `codex` | Codex CLI | `read-only`, approved `workspace-write` |
| `minimax-code` | MiniMax Code | Approved `workspace-write` |
| `mimo-code` | MiMo Code | `read-only`, approved `workspace-write` |
| `grok-build` | Grok Build | `read-only`, approved `workspace-write` |
| `gemini` | Gemini CLI | Routed headless adapter; not the managed single-tool/team runner |
| `zcode` | ZCode | Windows; approved `workspace-write` |

Installers use fixed official npm packages at each vendor's `@latest`, or the official publisher-signed Windows ZCode installer. An installation newer than the reported latest is not downgraded. Latest-version lookups are cached for about 12 hours; unavailable lookups leave the version unknown. New vendor releases are not automatically validated by this project. ZCode's installation window still requires you to choose a directory and finish installation.

Installation, trusted launch readiness, account login and model entitlement are separate checks. An unknown login status is not proof of logout. On Windows, supported managed launch entries are checked against publisher signatures or official npm-tarball attestations; ZCode also records trust for its bundled script per signed build. See [the registry](.dsh-plugin/shared/official-tool-registry.mjs) and [executor](.dsh-plugin/shared/official-tool-executor.mjs) for the exact platform rules.

`model_router_execute` has fixed headless adapters for Claude, Codex and Gemini. Other suppliers use the model-directory API unless a supported subscription route applies. Missing/unusable CLIs can fall back to that API; subscription failures follow the policy below.

Editable execution needs a clean Git repository, Host approval and the Harness process sandbox. Changes are made in an isolated worktree and applied back only after successful execution and a matching clean source workspace. Failed or conflicting integration is reported. Git-ignored outputs need separate review. Read-only CLI flags do not necessarily limit file reads to the workspace; check **安全边界**, especially Codex's broader readable scope.

### Interactive terminal

In **官方工具 → 官方工具终端**, select the shell or an installed CLI, choose interactive/login mode where available, enter an existing absolute directory, and review the startup confirmation. ZCode is a desktop app and is not a terminal target.

These sessions run **outside the Harness sandbox**, with the Host user's login environment, proxies and API-key variables. Commands typed there can read/write files with that user's permissions. Terminal launches are separate from routed execution and its approval/billing policy.

The optional `@lydell/node-pty` dependency supplies a real pseudo terminal. If it cannot load, the card reports pipe mode: full-screen interfaces, resizing and arrow keys may not work. At most four sessions run concurrently, unread sessions expire after about two minutes, and each session lasts at most six hours. Explicitly end sessions when finished; closing the workbench or unloading the plugin also ends them.

The plugin does not persist terminal input/output. It stores session metadata only. With text selected, Ctrl+C copies; otherwise it interrupts. Ctrl+Shift+V pastes.

## Costs, subscriptions and quality

- **Budgets:** per-run planning target plus daily/monthly checks. Over-budget routing can try the economy preset or pause for confirmation. Unknown prices remain unknown. These are local accounting/estimation controls, not a hard provider billing cap.
- **Subscription-first:** the default is to prefer a detected CLI account subscription or a configured coding-plan route. API-key environment variables are removed for CLI subscription attempts. `billing` can be `subscription-first`, `api-only` or `subscription-only`; `subscription` can be `cli-login`, `plan-key` or `none`.
- **Fallback:** detected quota exhaustion/rate limits mark a subscription in cooldown and can retry the routed step on its configured API route, subject to policy and availability. Other attempted subscription failures pause by default (`onSubscriptionFailure: "ask"`): choose API retry, subscription retry or cancel in history. Managed editable/single-tool/team runs do not automatically retry on the API.
- **Accounting:** API costs count toward budgets. Subscription runs display an API-price reference cost separately. Actual usage is taken from CLI-reported amounts or token usage and supplied prices when available; provider bills remain authoritative. Version 0.15.0 retains spending from evicted detailed runs and replaced retry results, so trimming history or retrying a step does not erase earlier charges. Costs already discarded by older versions cannot be reconstructed.
- **Quality and preference:** optional `off`/`sample`/`always` stronger-model review can add paid calls; it is not treated as human feedback. Explicit ratings adjust separate subjective utility for the exact route and task type, using time decay and low-sample shrinkage (default limit ±0.04, configurable up to ±0.1). They do not change objective quality scores or their hard floors; learning can be disabled, ratings withdrawn, or its starting point reset.

Coding-plan keys and endpoints stay in Harness provider settings. A `plan-key` profile may name an exact configured `apiRoute` as its fallback; the profile editor does not accept credentials or arbitrary commands. Vendor plan eligibility and terms must be checked with the vendor.

## How routing works

The planner is a deterministic local heuristic, not a learned guarantee of task success. It:

1. Estimates task type/complexity from the text and splits suitable compound requests into analysis, execution, verification and synthesis packages.
2. Uses only configured routes, overlays exact-route profiles, and filters modality and quality constraints where possible.
3. Compares quality, estimated price, latency, specialties, reasoning fit and risk using the selected preset.
4. Prunes dominated candidates and searches a bounded set of dependent assignments. Constraint relaxation, missing evidence and unassignable packages are reported.

Estimated cost is token usage × supplied USD-per-million prices, including optional cache prices. Quality can come from user profiles, supplied benchmark data or catalog heuristics; catalog hints are not measured success probabilities. A vision route still needs actual input support, and current routed execution is text-oriented rather than a general multimodal asset pipeline.

The implementations are [router.mjs](.dsh-plugin/shared/router.mjs), [harness-plan.mjs](.dsh-plugin/shared/harness-plan.mjs) and [routing-presets.mjs](.dsh-plugin/shared/routing-presets.mjs).

## Data and privacy

Router profiles/preferences are held in the Harness plugin settings. Runtime state is stored in `<DSH_HOME>/model-router/state.json` (default `~/.dsh/model-router/state.json`): health/onboarding, subscription cooldown, ratings, up to 200 recent runs, 50 terminal metadata records and opt-in public data snapshots. Applied rates and data/feedback policy versions are frozen in run records. Preferences are local to that shared DSH_HOME, not authenticated per-user accounts; public data requests do not upload tasks or feedback.

Version 0.15.0 also retains bounded spending aggregates for up to 90 populated calendar dates and 24 months. These contain amounts/counts, not task or response content.

Run history includes task text, output excerpts, route/workspace, failures and costs. Stored task text is capped at 20,000 characters and each answer at 4,000; reruns can therefore depend on truncated stored context. The plugin does not store API keys in model profiles or terminal transcripts. Task execution still sends the selected task/context to the chosen provider or CLI.

State writes use a lock and atomic replacement. Unparseable state is preserved as a `state.json.corrupt-<timestamp>` backup and surfaced as a notice. Back up state/profile data before migrations and avoid sharing unredacted histories or logs.

## Develop from a cloned checkout

The Git clone is a complete source checkout; the npm package is a runtime distribution and excludes client source, scripts, tests and the experiment project.

Requirements: **Node.js 22.19+** and **pnpm 10.34.6** (pinned in `packageManager`). In PowerShell, from the directory containing your clone:

```powershell
cd .\dsh-model-router
pnpm install --frozen-lockfile --strict-peer-dependencies
npm run build:client
npm test
npm run check:client
npm run pack:local
```

If already in the repository, omit the first `cd`. The archive appears in `dist`; install that absolute `.tgz` path through Desktop's plugin manager in a test profile. Do not treat successful unit tests as proof of vendor account access, actual model identity or billing.

To inspect the UI without starting Harness or vendor tools:

```powershell
npm run preview:ui
```

Open [the local preview](http://127.0.0.1:4173). It uses mock models, tools and history, with populated, empty, error, onboarding and delayed-preview scenarios for layout/interaction checks. Simulated execution does not call providers, install tools or start a terminal. This is not Host integration verification. Use `npm run preview:ui -- --port 4174` if the default port is occupied; refreshing picks up client-source edits.

| Location | Role |
| --- | --- |
| `.dsh-plugin/index.mjs` | Host plugin, session tools, settings, execution and remote handlers. |
| `.dsh-plugin/client/` | React workbench source and CSS. |
| `.dsh-plugin/shared/` | Planner, tool registry/runtime, billing, ledger, state and terminal contracts. |
| `.dsh-plugin/client.js` | Generated Desktop client bundle; rebuild after client changes. |
| `scripts/` and `tests/` | Build/package/verification helpers and regression tests. |
| `experiment-plugin/` | Separate research experiment project; not shipped as part of the router plugin. |
| `docs/` and dated reports | User documentation and historical verification records. |

`check:client` rebuilds in memory and compares the generated output with the committed bundle; `prepack` refuses a stale bundle. pnpm 10 has no `pnpm peers check` command: use the strict install above. Unavailable/incompatible host SDK packages may require the installed Harness runtime for local integration testing; [setup-harness-dev.mjs](scripts/setup-harness-dev.mjs) links missing SDK packages from an explicitly supplied Host `node_modules`, and [start-harness-preview.mjs](scripts/start-harness-preview.mjs) starts a separate local web Host profile. These helpers do not replace dependency verification or Desktop acceptance checks.

Legacy compatibility/research files and dated reports are preserved for reference; their presence does not make every older integration an active feature of the current packaged plugin. Releases and synchronization follow [AGENTS.md](AGENTS.md); use versioned packages or verified release tags to reproduce a release.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No routes or planning disabled | Configure Harness Models, refresh the directory and wait for tool detection. |
| Cost unknown | Supply both input/output USD prices for each compared route. |
| CLI installed but not executable | Review launch-readiness reason, platform/mode support and installation source. |
| Login/entitlement still fails | Check the vendor account, CLI login, network and actual model access; installation alone is insufficient. |
| Frontend says Host is older | Fully quit Harness, including the tray process, then restart. |
| Preview differs from old advice | Directory, login, quota or budget state changed; review the new preview. |
| Terminal TUI does not render | Check whether the card reports PTY or pipe fallback. |
| Editable team stopped | Read the failed package and integration state before rerunning or manually reviewing its worktree. |

For issues include host/plugin versions, selected mode, tool status and redacted errors: [issue tracker](https://github.com/Alice-Marx/dsh-model-router/issues).

License: [MIT](LICENSE).
