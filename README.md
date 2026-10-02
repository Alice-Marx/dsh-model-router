# Model Router · DeepSeek Harness Desktop

**Version 0.13.0 adds health checks, cost control, subscription-first billing and run history; since 0.12.0 model routing and GAL are separate plugins.** This plugin analyzes a request, gives simpler work to affordable capable models, and reserves stronger routes for difficult work. Compound requests become dependent work packages that supported official vendor tools can execute.

**Since 0.13.0 the npm package is `@ljwei-stak/dsh-model-router`.** The old name `@ljwei-stak/model-router-galgame` ends at 0.13.0 (same content as the new package's 0.13.0) and will get no further updates; to upgrade, remove the old plugin and add the new one ([details](#upgrade-from-ljwei-stakmodel-router-galgame)). **Since 0.12.0 the router package has only the Model Router sidebar entry.** Install the independent [GAL plugin](https://github.com/Alice-Marx/deepseek-harness-galgame) if you also want stories, portraits, music, saves, or free roleplay.

[简体中文说明](README.zh.md) · [Installation guide (Chinese)](INSTALLATION_GUIDE.zh.md) · [Migration guide](MIGRATION.md) · [GAL repository](https://github.com/Alice-Marx/deepseek-harness-galgame)

> **Host compatibility:** both the router 0.13.1 and GAL 0.1.0 target DeepSeek Harness Desktop **0.2.0-rc.1 and 0.2.0-rc.2**. Use the exact installation versions below. Releases use npm's `next` tag while this host is a prerelease; a bare package name or a moving tag is not a version pin.

![Diagram of the local routing plan and official-tool execution](docs/assets/routing-workflow.svg)

*Planning uses the configured Harness model directory and optional user-provided model data. Generating a plan does not start vendor tools or spend model tokens.*

![Router-only 0.12.0 in the official rc.2 runtime](docs/assets/router-only-0.12.0.png)

*Actual isolated rc.2 profile: only the Model Router sidebar is installed; the catalog uses built-in routes without account calls.*

## What the router does

| Area | Available behavior |
| --- | --- |
| **Model Router** | Classifies task type and complexity, splits compound requests into a dependency graph, recommends an exact configured `provider/model` for each work package, and displays quality evidence and estimated cost when available. |
| **Model profiles** | Lets you enter your own 0–100 quality score, USD input/output price per million tokens, specialties, and an optional vendor CLI model name for an exact Harness route. Missing prices remain unknown. |
| **Official tools** | Detects and offers one-click, fixed-source installation for Kimi Code, Claude Code, Codex CLI, MiniMax Code, MiMo Code, Grok Build, and ZCode. Installation and trusted launch readiness are shown separately. |
| **Execution** | Session tools can consult another configured Harness model, run one supported official CLI, or execute dependent work packages with the CLI team runner. |

![Official tools section in an isolated DeepSeek Harness Desktop profile](docs/assets/desktop-official-tools-0.9.0.png)

*Historical capture from version 0.9.0 in an isolated rc.1 profile. Its GAL sidebar belongs to the old combined plugin; router 0.12.0 has no GAL entry. A green launch check proves local entry checks passed, not vendor account authentication or paid-task success.*

## Install the independent plugins

In **DeepSeek Harness Desktop → Plugins → Add plugin**, enter one exact package name:

| What you want | Installation input | Repository |
| --- | --- | --- |
| Model routing and official tools | `@ljwei-stak/dsh-model-router@0.13.1` | [Model Router](https://github.com/Alice-Marx/dsh-model-router) |
| GAL only, or GAL alongside the router | `@ljwei-stak/dsh-galgame@0.1.0` | [DeepSeek Harness GAL](https://github.com/Alice-Marx/deepseek-harness-galgame) |

For npm installation, select the official **HTTPS** source `https://registry.npmjs.org/` if a mirror has not synchronized the exact version. Install, enable, and restart when prompted. Router details should show **0.13.0** and its sidebar **Model Router**; the separate GAL package adds **Gal Module**. Either package can be installed without the other. Global `npm install -g` does not register a plugin in your Desktop profile.

### Upgrade from `@ljwei-stak/model-router-galgame`

The package was renamed in 0.13.0. The old name's last version is also 0.13.0, with identical content, so future updates only come under the new name. The plugin manager cannot update the old entry in place:

1. Remove `@ljwei-stak/model-router-galgame` in the plugin manager (keep profile and application data).
2. Add `@ljwei-stak/dsh-model-router@0.13.1` and restart when prompted.
3. Do not keep both installed: they share the profile entry id `model-router-galgame` and the `model_router_*` tool names. Because the entry id is unchanged, router settings saved in the profile and the run history in `~/.dsh/model-router/state.json` carry over.

### Upgrade from the combined 0.11.x plugin

1. Before upgrading, use the old GAL player's **Export save** for each story progress you want to keep, and back up the Harness profile. A JSON export contains the current story state, not all slots, settings, read history, or local audio.
2. Install `@ljwei-stak/dsh-galgame@0.1.0` in the **same profile**.
3. Remove the old `@ljwei-stak/model-router-galgame` plugin and add `@ljwei-stak/dsh-model-router@0.13.1` (see above). Finish both installations before continuing play; this removes the old combined GAL entry and leaves one entry from the independent GAL plugin.
4. Open the new GAL entry and verify your progress. The standalone plugin retains the old localStorage keys in the same profile. For a different profile or a missing state, select the matching story and import the JSON backup.

The standalone GAL core contains **Echo City: Main Saga** and **Old City Migration: The Unfinished Promise**. Previously separated stories remain in their source archive and are not shipped with either core plugin. See [migration notes](MIGRATION.md) for save limitations and older desktop integrations.

### Install a versioned release archive

Download the `.tgz` attachment from the [router v0.13.0 release](https://github.com/Alice-Marx/dsh-model-router/releases/tag/v0.13.1) or [GAL v0.1.0 release](https://github.com/Alice-Marx/deepseek-harness-galgame/releases/tag/v0.1.0). Enter the downloaded file's absolute path, for example:

```text
D:\Plugins\ljwei-stak-dsh-model-router-0.13.1.tgz
```

Where a checksum sidecar is supplied, compare it with:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'D:\Plugins\ljwei-stak-dsh-model-router-0.13.1.tgz'
```

You can also extract the archive and enter its inner `package` directory, which contains `package.json` and `.dsh-plugin`. The download may be stored on your preferred drive; runtime data location is controlled by the Harness profile. Upgrade through the plugin manager without modifying `app.asar` or bypassing dependency checks.

### Version history

| Version | Intended host | Scope |
| --- | --- | --- |
| **Router 0.13.1** | **0.2.0-rc.1 / 0.2.0-rc.2** | Fixes workbench and `model_router_execute` runs failing with `cannot get property "credentials" without inject`. Exact npm version, `@next` or `@latest`. |
| [Router 0.13.0](https://github.com/Alice-Marx/dsh-model-router/releases/tag/v0.13.0) | 0.2.0-rc.1 / 0.2.0-rc.2 | Health check, cost control, subscription-first billing, run history; runs fail in the Harness (fixed in 0.13.1). |
| **GAL 0.1.0** | **0.2.0-rc.1 / 0.2.0-rc.2** | First standalone GAL package, two core stories. Exact npm version or `@next`. |
| [Router 0.12.0](https://github.com/Alice-Marx/dsh-model-router/releases/tag/v0.12.0) | 0.2.0-rc.1 / 0.2.0-rc.2 | First independent router release (GAL split out). |
| [Combined 0.11.1](https://github.com/Alice-Marx/model-router-galgame/releases/tag/v0.11.1) | 0.2.0-rc.1 / 0.2.0-rc.2 | Historical combined router and GAL package; corrected 0.11.0 release documentation. |
| [Combined 0.11.0](https://github.com/Alice-Marx/model-router-galgame/releases/tag/v0.11.0) | 0.2.0-rc.1 / 0.2.0-rc.2 | Historical GAL player release. |
| 0.10.2 | 0.2.0-rc.1 / 0.2.0-rc.2 | Unpublished local compatibility build. |
| [0.10.1](https://github.com/Alice-Marx/model-router-galgame/releases/tag/v0.10.1) | 0.2.0-rc.1 only | Historical release; rejected on rc.2 by its peer dependency range. |
| [0.9.0](https://github.com/Alice-Marx/model-router-galgame/releases/tag/v0.9.0) | 0.2.0-rc.1 | Historical official Desktop adaptation. |
| 0.8.0 | DSH 0.1.7-rc.2 dependencies | Incompatible with Desktop 0.2.0-rc.1 / rc.2. |
| 0.4.32 | Legacy DSH settings dependency range | Legacy release; do not use it for the current host. |

Configure providers, models, and credentials on Harness's official **Models** page. The router only considers registered routes; its profile editor does not accept API keys.

## Use the Model Router workbench

![Schematic guide to entering a task, generating a plan, and finding its results lower on the page](docs/assets/workbench-usage.svg)

*Operation schematic, not a Desktop screenshot. The generated result appears **below** the model-profile editor, so scroll down after clicking the button.*

1. Open **Model Router** in the sidebar. The top status shows how many providers and routes the official **Model directory** returned. If it is empty, configure a provider and model on Harness's official **Models** page, then click **Refresh** in the workbench's directory card. A route appearing in the directory does **not** prove that its credentials or network connection work.
2. In **Task planning → Task description**, write what you want done and list distinct actions on separate lines for a compound request. Choose **Single task** for one direct recommendation or **Team allocation** for dependent work packages. Team mode decomposes requests that the router classifies as complex; selecting the mode alone does not start a team.
3. The **Estimated budget for this run (USD)** field may show `10`. That is a **$10 estimate target**, based on your supplied prices and estimated tokens; generating the plan itself is local and free. Set it to `0` to remove the estimate constraint. Neither value caps a provider bill or authorizes a model call.
4. Click **Generate route recommendation**. Planning runs locally. Scroll down **past Model pricing and capabilities** to **Route recommendation**. Read the recommended `provider/model`, complexity band, estimated cost or “price needs configuration,” and the **execution channel** badge. In team mode, check each package's objective, difficulty, route, dependencies, verification checklist, and warnings. `Official CLI` means a trusted local launch entry is ready; `Model directory API` means the plan routes through Harness's configured model API.
5. To improve the recommendation, save each exact `provider/model` route's quality score and input/output prices in **USD per million tokens** in the **Model pricing and capabilities** editor, then click **Generate route recommendation** again. Saving a profile invalidates the previous result; a missing price remains unknown. Review the **Official tools** cards below the result for probe, install/repair, and launch-readiness status. ZCode opens its own installer and requires you to complete its directory choice.
6. To run a read-only task directly from the workbench, use **Run from the workbench** (在工作台执行) below the plan. It reuses the task description and planning mode (single task, team allocation, or one chosen model), lets you pick the preset, and takes an absolute workspace path (left empty, the last run's workspace is reused; the path must exist). **Preview execution plan** asks the Host for the same plan `model_router_execute` would use, including the automatic economy downgrade, plus the cost estimate, the budget check, and every reason that needs confirmation (over budget, unsandboxed headless CLI), listed together. Nothing runs until you press **Confirm and run**; the Host re-checks the reasons and refuses if something changed in the meantime. The result appears in the run history.
7. For editable runs or a live second opinion, open an **official Harness session** and request `model_router_consult` for a live second opinion, `model_router_tool_run` for one ready vendor CLI, or `model_router_team_execute` for dependent CLI work packages. You can also use `/router` to request a plan and `/tools` to inspect tools in a session. An editable CLI task requires approval and a clean Git repository; check the vendor run record for the actual model and charge.

For example, enter: “**Plan a complex, three-minute science-fiction short film.** Extract the premise and constraints; design a beat sheet and shot list; review visual continuity and production risks; synthesize a handoff checklist.” Choose **Team allocation**, generate the plan, and inspect which configured routes it assigns to the writing and review packages. This plugin produces a *plan* and can delegate supported CLI tasks; it does **not** render a film or control nine creative applications.

The [full Chinese workbench guide](docs/WORKBENCH_USER_GUIDE.zh.md) walks through the controls, result location, model-profile setup, and session handoff.

## Health check, cost control and quality loop

The workbench shows these at the top. The matching session tools are in parentheses.

1. **Onboarding health check** (`model_router_health`). When you first open the workbench, it checks every official tool in the registry: is it installed, does its version match the pinned version, and is it logged in. Login checks only run cheap status commands with short timeouts, or check that a credential file exists (its contents are never read):

   | Tool | How login is detected | Log in with |
   | --- | --- | --- |
   | Claude Code | `claude auth status --json` | `claude auth login` |
   | Codex | `codex login status` | `codex login` |
   | Gemini CLI | `GEMINI_API_KEY`/`GOOGLE_API_KEY`, or `~/.gemini/oauth_creds.json` | `gemini` |
   | Kimi Code | `KIMI_API_KEY`/`MOONSHOT_API_KEY`, or `~/.kimi-code/credentials/kimi-code.json` (`$KIMI_CODE_HOME`) | `kimi login` |
   | MiMo Code | `MIMO_API_KEY`, or `~/.local/share/mimocode/auth.json` (`$XDG_DATA_HOME`; may hold only provider API keys, so billing stays unknown) | `mimo auth login` |
   | Grok Build | `XAI_API_KEY`, or `~/.grok/auth.json` (`$GROK_HOME`). On Windows with the npm prefix off drive C the plugin runs Grok with `GROK_HOME=<npm prefix>\.model-router-grok`; the health card then names that path | `grok login` (`--device-auth` without a browser); for the relocated home run `$env:GROK_HOME='<path>'; grok login` |
   | MiniMax Code | `MINIMAX_API_KEY`, or the `status` field of the non-secret `~/.minimax/auth/prod/<cn\|global>/mcode-public/auth-state.json` (`$MINIMAX_DATA_DIR`; `authenticated` → logged in, `anonymous` → unknown because a key saved with `mcode set-minimax-key` still works) | `mcode login` |
   | ZCode | Desktop app without a status command → unknown. Only the pinned, signature- and hash-verified 3.14.3 is used; another installed version is reported as such, not as missing | Welcome page → *Connect BigModel / Z.ai*; for GLM Coding Plan pick *编程套餐* in Model settings |

   The file paths come from the published packages (kimi-code 2.1.1, mimocode 0.1.15, grok 1.0.41). A missing file is reported as **unknown**, not logged out, because these CLIs can also authenticate through custom providers or (MiMo) a free anonymous channel. The check never starts a login.
   - **一键安装** (one-click install) reuses the fixed registry installer.
   - **去登录** (log in) shows the login command so you can copy it.
   - Results are cached for 10 minutes. Routing **skips logged-out CLIs immediately** and goes straight to the model-catalog API; before this, Codex took about 14 s to fail and fall back. A tool is not skipped when its API key is configured. If a CLI reports a login error at run time, it is also marked as logged out — but because you were running on its subscription, later steps on that route are **paused and ask** (“订阅登录已失效…未自动改用 API Key”) instead of silently using the API key, also after a restart (`authFailures` in `state.json`), until the CLI runs on its subscription again. The same applies when a profile explicitly sets `billing: "subscription-first"` or `"subscription-only"` and the CLI is logged out. Logged-out CLIs without either signal, and CLIs that are not installed, still go straight to the API.
2. **Visible routing decisions**. Plans show the selected model, preset, difficulty score, estimated cost, and channel (official CLI or API, with a "CLI 未登录" badge when the CLI is logged out). The run history shows each step's actual channel. On fallback it shows the real redacted error: Claude JSON `result`, Codex `turn.failed.error.message`, or a stderr snippet. When `allowManualReassign` is on (the default), you can reassign a step to another configured route and rerun it.
3. **Cost control**. Set daily and monthly budgets (USD, `0` = unlimited) and see meters for today's and this month's spend.
   - Before a run, the estimate is checked against the budget.
   - `model_router_tool_run` is estimated the same way when you name its `provider`/`model` route (without a route the CLI default model has no price, so only an already-exhausted budget pauses it); over budget it returns `paused-budget` until called with `confirmOverBudget: true`.
   - After a run, the actual cost is recorded. CLI-reported cost is used first (Claude `total_cost_usd`, Grok `total_cost_usd` when the server reported a complete cost, MiMo's per-step `cost`); otherwise token usage × your configured prices. Token usage is read from Claude, Codex, Gemini, Grok (`end` event), MiMo (`step-finish` parts) and MiniMax (`exec.result.usage`). Kimi and ZCode do not report usage in their headless output. Without prices, only token counts are kept.
   - `overBudgetAction` decides what happens over budget. `downgrade` (the default) re-plans with the economy preset and pauses if it still doesn't fit. `pause` asks you right away. Continuing from a session requires `confirmOverBudget=true`, which triggers a host approval. When a run needs several approvals (editing files, API-key retry, over budget, unsandboxed CLI), they are listed together in **one** prompt.
   - **Only API-billed spend counts against budgets**: model-catalog API calls, and official CLI calls that use an API key (injected by the plugin, inherited from the environment, or a CLI whose own login is an API key according to the health check).
   - When an official CLI runs on a **subscription login** with no API key (for example Claude Pro/Max, or Codex signed in with ChatGPT), its reported or usage × price figure is shown separately as **订阅参考费用 (subscription reference cost, priced at API rates)** and is **not** counted toward the daily/monthly budget. The cost card and run history show both the budget-counted spend and the reference cost. Tool rows show whether each CLI is on a subscription login or bills an API key.
   - When the login type cannot be detected (CLIs without a status command, CLIs launched by the team runner), it is treated as a subscription login unless a matching API-key environment variable is set.
   - Routed runs follow the [subscription-first rule](#subscription-first-api-key-only-when-the-quota-runs-out) for every provider: the subscription is used first and only quota/rate-limit exhaustion switches the step to an API key, which is then counted.
4. **Presets** (`routingPreset`): 省钱优先 (economy) / 均衡 (balanced, the default) / 效果优先 (quality). Presets tilt the quality/cost/latency weights and move the quality floor a cheaper substitute must clear by ±0.04. Balanced is identical to the previous planner.
5. **Subtask DAG** (`model_router_rerun_step`). Team packages are shown in dependency columns. Every `model_router_execute`, `model_router_team_execute` and `model_router_tool_run` call is recorded with its kind and each step's status (done, fallback, failed, blocked). A team run stops at the first failure, so later steps show as blocked. **重跑此步** (rerun this step) reruns only the failed step and its unfinished downstream steps. Finished steps keep their results and feed the rerun as dependency context.
   - Routed runs: any failed step can be rerun or reassigned.
   - Team runs: **read-only** team runs support single-step rerun through the same signed runner and Harness sandbox. An **editable** (`workspace-write`) team run that **stopped at a failed step** can be continued (**在新工作区续跑**): a fresh isolated worktree is created from the current checkout, the earlier worktree's changes are applied to it first, then the failed step and its unfinished downstream steps run, and the combined patch is integrated as usual. This needs approval, a clean repository still at the run's base commit (otherwise it refuses), and a run recorded by this version (with its base commit). Runs that were already integrated, or wait for manual integration, cannot be rerun step by step, and successful steps of an editable run cannot be reassigned (their changes would be applied twice).
   - Tool runs: a failed `model_router_tool_run` call can be repeated (**重新执行此调用**, packageId `direct`) with the same tool, task, mode and model. It is recorded as a new run linked by `rerunOf`; an editable call starts again from a fresh worktree of the current checkout and needs approval.
6. **Security boundaries**. The workbench card and the plugin settings list each route's readable and writable scope and its sandbox status:
   - Read-only runs write nothing.
   - File-modifying runs use an isolated Git worktree and need host approval.
   - On Linux/macOS, a headless CLI launched directly has no Harness process sandbox. With `confirmUnsandboxedCli` on (the default), you are asked first.
7. **Quality loop** (`model_router_rate`). `reviewMode` can be `off`, `sample` (uses `reviewSampleRate`), or `always`. When on, a stronger configured model reviews cheap-model output, and the verdict is stored with the run. You can rate each result 👍/👎. Ratings add a small shrunk bias (at most ±0.04) to that exact `provider/model`'s quality score for future routing.

**Local data (on by default)**: run history is **saved locally by default**; there is no switch. It is kept in `~/.dsh/model-router/state.json` (or `$DSH_HOME/model-router/state.json`) and contains:
- the health report, subscription quota state (which subscriptions are exhausted until when) and CLIs whose subscription login failed at run time;
- the last 200 runs (routed, team and tool runs), with the **full task text** (up to 20,000 characters) and **each step's answer excerpt** (up to 4,000 characters);
- workspace paths, routing decisions, costs and ratings.

The file never leaves your machine and holds no API keys. If your tasks contain sensitive content, keep this file in mind. Delete it, or its `runs` array, to clear the history.

Several Host processes can share one DSH home: each write takes `state.json.lock`, re-reads the file, applies its change and replaces the file atomically, so concurrent runs are not lost. Subscription quota marks and runtime login failures written by another process take effect on the next call without a restart (the file is re-read when its mtime/size/inode changes), including clears. If the file cannot be parsed, it is kept as `state.json.corrupt-<time>` and the workbench and `model_router_health` (`notices`) show a warning for 7 days; recover history from that backup if needed.

**Known gaps**:
- Kimi and ZCode report no token usage in headless output, so their steps show "subscription login, no usage reported" or "cost unknown".
- ZCode login state stays unknown (no status command); MiniMax is unknown when only an API key or no state file is present. Kimi/MiMo/Grok/MiniMax detection proves only that a credential/state file says so, not that the token is still valid.
- The workbench starts **read-only** runs only; editable runs still start from a session (`model_router_tool_run`, `model_router_team_execute`).
- The UI has passed build checks, unit tests and a headless browser pass with the real client bundle and a mock Host bridge. It has not been verified in a real Harness desktop.

## Subscription first, API key only when the quota runs out

Many vendors sell coding subscriptions besides pay-as-you-go API keys: Claude Pro/Max, ChatGPT plans for Codex, Gemini, Kimi Code, the MiniMax Token Plan, the GLM Coding Plan (Zhipu / Z.ai) and others. The router's rule is:

> **If a subscription is available, use it. Only when that subscription hits its quota or rate limit does the same step switch to the API key.**

**Two kinds of subscription.**

| Kind | How it is recognised | How it runs |
| --- | --- | --- |
| **CLI account login** (`cli-login`) | The route's provider maps to an official CLI (Claude Code, Codex, Gemini CLI, Kimi Code, MiniMax Code, ZCode for GLM…) and the health check finds an account login. | The CLI runs with **all API-key variables removed** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`/`CODEX_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`, `KIMI_API_KEY`/`MOONSHOT_API_KEY`, `MINIMAX_API_KEY`, `ZAI_API_KEY`, …) and no key is injected, so it can only bill the subscription. |
| **Coding-plan key route** (`plan-key`) | A Harness provider whose base URL and key are a coding plan, marked with `subscription: "plan-key"` in its model profile. Provider ids such as `glm-coding-plan`, `kimi-code`, `minimax-token-plan` are recognised automatically; the profile setting always wins. | The plan route is called through the model catalog first. Its `apiRoute` names the pay-as-you-go route used when the plan is exhausted. |

Configure a plan-key route in Harness's **Models** page like any Anthropic- or OpenAI-compatible provider, using the vendor's documented plan endpoint and plan key (the plugin never reads or stores keys):

| Plan | Anthropic-compatible base URL (Claude Code style) | OpenAI-compatible base URL |
| --- | --- | --- |
| GLM Coding Plan | `https://open.bigmodel.cn/api/anthropic` (intl `https://api.z.ai/api/anthropic`) | `https://open.bigmodel.cn/api/coding/paas/v4` (intl `https://api.z.ai/api/coding/paas/v4`) — not the general `/api/paas/v4`, which bills account balance |
| Kimi Code | `https://api.kimi.com/coding/` | `https://api.kimi.com/coding/v1`, model `kimi-for-coding` |
| MiniMax Token Plan | `https://api.minimaxi.com/anthropic` (intl `https://api.minimax.io/anthropic`) | — |

Check each plan's terms first: some vendors (the GLM Coding Plan FAQ, for example) say plan quota applies only inside their supported coding tools, and other API use needs the standard API service. Endpoints and model ids change; verify them in the vendor docs.

**Profile fields** (in “逐模型价格与能力” or `modelProfilesJson`):

```json
[
  { "provider": "glm-coding-plan", "model": "glm-4.6", "subscription": "plan-key",
    "apiRoute": { "provider": "zhipu", "model": "glm-4.6" } },
  { "provider": "anthropic", "model": "claude-sonnet-4-5", "billing": "subscription-first" },
  { "provider": "deepseek", "model": "deepseek-chat", "billing": "api-only" }
]
```

- `billing`: `subscription-first` (default; may be omitted), `api-only` (never use the subscription), or `subscription-only` (never fall back to an API key; the step fails with the reason instead).
- `subscription`: `plan-key`, `cli-login`, or `none` (always API). Omitted means automatic.
- `apiRoute`: only for `plan-key` routes; an exact catalog route. When the router picks that API route directly, it still uses the plan first while the plan has quota.

**Exhaustion detection and switching.** When the subscription attempt fails, its error text is matched against documented vendor messages:

| Vendor | Quota exhausted | Rate limited |
| --- | --- | --- |
| Claude Code | “You've hit your session/weekly/Opus limit · resets 3:45pm” | “Server is temporarily limiting requests”, “Request rejected (429)” |
| Codex | `usage_limit_reached` (`resets_at` / `resets_in_seconds`), “You've hit your usage limit” | `rate_limit_exceeded` |
| Gemini | `RESOURCE_EXHAUSTED`, “Quota exceeded”, “exhausted your daily quota” (`retry in Xs`) | — |
| Kimi Code | 403 “You've reached your 5-hour / weekly (7-day) / monthly usage limit” | “concurrent request limit”, 429 “receiving too many requests”, “engine is currently overloaded” |
| MiniMax | error `2056` “usage limit exceeded” / “Token Plan usage limit reached” | error `2045` |
| GLM | errors `1308`–`1310`, `1316`–`1321` (“Usage limit reached for … will reset at YYYY-MM-DD HH:MM:SS”, “已达到…使用上限”) | errors `1302`, `1305` |
| Any | — | HTTP `429`, “Too Many Requests”, “rate limit” |

On a match the subscription is marked **exhausted until the reported reset time** (`resets_at`, `resets_in_seconds`, `retry in Xs`, GLM's reset timestamp, Claude's “resets 3:45pm”), otherwise for `subscriptionCooldownMinutes` (default 60; rate limits without a time are skipped for 1 minute). The **same step is retried on the API key at once**, and later steps skip the exhausted subscription until it recovers. The run history records the channel (`billing: subscription | api`) and the reason, for example **“订阅额度已用尽（预计 10-2 18:30 恢复），已切换 API Key。”** The state survives restarts (`quota` in `state.json`).

**Other subscription failures do not spend the API key silently.** When the subscription really ran and failed for another reason (timeout, crash, unparsable output, non-zero exit, authentication error, a plan endpoint returning 5xx…), the step is **paused** by default (`onSubscriptionFailure: "ask"`). Run history marks it **等待确认** with the real error, and downstream steps wait (**等待上游确认**). In the run history choose **改用 API 重试** (retry on the API key), **重试订阅** (retry the subscription, e.g. after logging in again) or **取消** (cancel the step and the steps waiting on it). In a session, `model_router_execute` returns `status: "paused-subscription-failure"` with `awaitingConfirmation`; the model asks you and calls `model_router_rerun_step` with `subscriptionChoice: "api" | "subscription" | "cancel"`. `api` raises a host approval prompt. Set `onSubscriptionFailure` (cost card: “订阅调用失败（非额度用尽）时”) to `api` for the old automatic fallback, or `fail` to stop the step without asking. A CLI that is not installed or has no headless adapter was never attempted, so its step still uses the catalog API as before.

If a vendor changes its wording, add patterns in `quotaPatternsJson`, keyed by tool id, provider id or `*`:

```json
{ "kimi-code": { "quota": ["额度已用完"], "rateLimit": ["请求过于频繁"] }, "my-glm-plan": { "quota": ["1308"] } }
```

Invalid regular expressions are ignored and listed in the health check.

**Health check.** The “订阅与 API Key” card (and `model_router_health` → `billing`) lists each provider with its billing mode, subscription source, subscription state (logged in / coding-plan key route / API-key-only login / logged out / **exhausted until X**) and whether an API-key route is available for fallback. Login probes run with API-key variables removed, so a Claude or Codex account login is detected even when an API key is also set.

**Budget.** Subscription runs (CLI login or plan-key route) are shown as subscription reference cost and are not counted; API-key fallback runs are counted against the daily/monthly budget, for every provider.

**Limits.** `model_router_team_execute` and `model_router_tool_run` edit files through the official CLI only, so a quota hit there is recorded (the step shows the reason and later routed steps skip that subscription) but is **not** retried on an API key automatically. Kimi Code and MiniMax Code CLIs have no portable read-only adapter on Linux/macOS, so their subscriptions are used there through plan-key routes.

## How the routing decision is derived

The router is a **deterministic, local heuristic**. It exposes its inputs and decision record. Its quality scores are user estimates, available benchmark data, or catalog hints—not measured success probabilities for your particular task. It does not guarantee a globally optimal assignment.

### 1. Turn the request into a complexity band

The task text contributes length, explicit requirements, domain markers, and code/reasoning/vision signals. Each normalized feature is clipped to `[0, 1]`:

```text
L = clip(character_count / 2200)
R = clip(numbered_or_bulleted_requirements / 8)
D = clip(domain_marker_count / 5)
C = clip(0.10 + 0.30L + 0.18R + 0.28D
         + 0.22·I_code + 0.20·I_reasoning + 0.12·I_vision)
```

The initial bands are `simple` for `C < 0.34`, `balanced` for `0.34 ≤ C < 0.66`, and `complex` above that. Explicit simple requests such as a short translation, and high-stakes action requests such as designing a security-sensitive architecture, have rule-based overrides. These are text signals, not a model's hidden chain of thought.

### 2. Split compound work into a directed acyclic graph

A complex request begins with **analysis** and ends with **synthesis**. Action-like lines, bullets, clauses, or sentences can become up to six explicit execution packages. A request for testing or verification adds a verification package. The `dependsOn` edges put analysis before execution, verification after the relevant execution packages, and synthesis after all required results. Sequential wording such as “then” adds an edge between execution packages. Explicit references become edges to exactly those steps: “依赖第 1 步”, “基于第 2、3 步”, “第 1 步完成后”, “依赖第 1-3 步”, “depends on step 2”, “after steps 1 and 3” (numbers count the listed requirements; forward references are ignored).

```text
analysis ──┬── keyword extraction ────────────┐
           ├── architecture design ──┐        │
           └── security review ──────┴── verification ── synthesis
```

Each package has its own task type, difficulty, quality floor, recommended route, dependencies, and verification checklist. A simple request normally remains one execution package.

### 3. Filter and score only routes you configured

The candidate set comes from the official Harness model directory. A profile overlays an **exact** `provider/model` pair; typing a model name into the editor does not create a usable route. Vision packages require a route that declares image support or has not declared input modalities; if no candidate can take the image package, the plan reports it as unassignable.

The base quality floors are **0.75 / 0.78 / 0.82** for simple / balanced / complex work. For a complex package, the floor becomes `clip(0.82 + 0.12·max(0, criticality − 0.65))`; synthesis has a minimum of **0.84** in a complex plan. Candidates below a floor are excluded if feasible candidates exist. If none meet it, the planner can relax the floor and explicitly marks the constraint as relaxed.

For a feasible candidate `m` and package `i`, the ranking combines normalized quality, price, latency, specialty match, reasoning-effort fit, and risk:

```text
U(i,m) = wq·quality + wc·cost_score + wl·(1 − latency)
       + ws·specialty + we·reasoning_fit − wr·risk
       − criticality·max(0, quality_floor − quality)
       − 0.015·dependency_route_switches
```

The task band changes the weights. For example, simple work gives cost **0.45** and quality **0.28**, while complex work gives quality **0.48** and cost **0.14**. Synthesis shifts further toward quality and reasoning fit. With cache-read/write ratios `r` and `w`, effective input price is `p_eff=(1−r−w)·p_in+r·p_read+w·p_write`. Let `M=max(1,max_candidates(p_eff+p_out))` and let `m_out` be the reasoning effort's output multiplier. Then `cost_score=clip((1−(p_eff+p_out)/(2M))/sqrt(m_out))`. This normalized score is distinct from the USD estimate; a missing price scores zero internally but remains unknown in the public estimate.

| Package difficulty | Quality | Cost | Latency | Specialty | Reasoning | Risk penalty |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Simple | 0.28 | 0.45 | 0.14 | 0.04 | 0.07 | 0.02 |
| Balanced | 0.40 | 0.26 | 0.10 | 0.09 | 0.10 | 0.05 |
| Complex | 0.48 | 0.14 | 0.06 | 0.14 | 0.11 | 0.07 |
| Synthesis | 0.58 | 0.08 | 0.04 | 0.08 | 0.16 | 0.06 |

The planner removes candidates dominated on the compared quality, estimated price, latency, specialty, reasoning fit, and risk dimensions. It retains key cheapest/highest-score/highest-quality options, searches up to **12 candidates per package**, and keeps up to **256 assignment states** at each step. A user-provided estimate budget restricts the search when feasible; otherwise the plan reports an over-budget or infeasible result. This bounded beam search is why the output is repeatable and inspectable, but not a proof of a global optimum.

![Illustration of the quality floor and candidate pruning](docs/assets/candidate-pruning.svg)

*Illustrative candidate plot, not actual model benchmark or price data. A candidate must first clear the package's quality floor when possible; the remaining routes are compared on several dimensions before bounded assignment search.*

### 4. Estimate cost and compare a baseline

User-entered prices are in **USD per million tokens**. For each package, the router estimates input tokens from text length and applies package and reasoning-effort multipliers; it also estimates output and optional cache-read/write tokens. With effective prices, the calculation is:

```text
estimated_package_USD = (
    uncached_input_tokens × input_price
  + cache_read_tokens × cache_read_price
  + cache_write_tokens × cache_write_price
  + output_tokens × output_price
) / 1,000,000

estimated_saving = (all_strong_baseline − routed_estimate)
                 / all_strong_baseline
```

“All strong” means selecting the highest estimated-quality route for each package. If any selected package lacks a trustworthy USD price, the total and saving remain **unknown**, rather than treating the route as free. Savings are also withheld when quality evidence is incomplete. These token counts are planning assumptions: the estimate is neither a provider quote nor a hard billing cap.

### Worked example: cheap extraction, strong design

Suppose the *already configured* model directory contains two demo routes with these **illustrative, user-entered values** (not vendor prices):

| Demo route | Quality | Input USD / 1M | Output USD / 1M | Specialty |
| --- | ---: | ---: | ---: | --- |
| `cheap-provider/Flash Custom` | 0.79 | $0.10 | $0.20 | Summarization |
| `strong-provider/Reasoning Custom` | 0.97 | $5.00 | $25.00 | Reasoning, code |

For the exact example input below, the complexity score is about **0.705** and the plan has six packages: analysis, three explicit execution packages, verification, and synthesis.

```text
请处理项目。
- 请提取关键词
- 请设计复杂系统架构
- 最后验证架构安全性
```

The extraction package is simple: **0.79 ≥ 0.75**, so Flash qualifies and its cost weight is high. The architecture and security work need the stronger Reasoning route. Their dependency edges keep verification and synthesis after the work they inspect.

With zero cache usage and no per-route reasoning-effort options, the estimator uses these package token assumptions (the displayed costs are rounded to six decimals):

| Work package | Route | Estimated input / output tokens | Estimated USD |
| --- | --- | ---: | ---: |
| Analysis | Reasoning | 80 / 495 | $0.012775 |
| Extract keywords | Flash | 96 / 900 | $0.000190 |
| Design architecture | Reasoning | 96 / 1,305 | $0.033105 |
| Verify security requirement | Reasoning | 96 / 1,305 | $0.033105 |
| Independent verification | Reasoning | 92 / 630 | $0.016210 |
| Synthesis | Reasoning | 132 / 1,170 | $0.029910 |

The sum uses unrounded package estimates: **$0.125295**. Assigning all six packages to Reasoning instead estimates **$0.148085**:

```text
($0.148085 − $0.125295) / $0.148085 × 100 = 15.39% estimated saving
```

The numbers demonstrate the calculation, not a promised saving. Different model profiles, prompts, cache behavior, CLI defaults, or actual token usage will change the result. The implementation and a corresponding routing case are in [router.mjs](.dsh-plugin/shared/router.mjs) and [router.test.mjs](tests/router.test.mjs).

## Configure your model routes

Open **Model Router → Model pricing and capabilities**. Choose a route that actually appears on the official Models page, then supply information you have verified or are willing to use as a planning assumption. The stored structure is a JSON array; the visual editor saves it for you. A minimal example is:

```json
[
  {
    "provider": "your-exact-provider-id",
    "model": "your-exact-model-id",
    "quality": 80,
    "pricing": { "input": 0.5, "output": 2.0, "currency": "USD" },
    "specialties": ["code", "summarization"],
    "cliModel": "name-configured-in-that-vendor-cli",
    "execution": "auto"
  }
]
```

`quality` is a personal 0–100 comparison score. `pricing.input` and `.output` are nonnegative USD rates per million tokens; optional `cacheRead` and `cacheWrite` rates are supported. The optional `cliModel` must match the name accepted by that vendor's own CLI, which may differ from the Harness directory ID. MiniMax and MiMo expect `provider/model` for that field. ZCode 3.14.3 cannot switch models per call, so it does not accept `cliModel`.

`execution` chooses how that route runs when it receives a task. `auto` (the default when omitted) and `official` try the vendor headless CLI first and fall back to the Harness model API if the tool is missing or fails. `api` always uses the model directory API.

## Single-model mode

In **Task planning**, choose **指定模型** and pick one configured `provider/model`. The plan assigns that route and does not compare the others. In a Harness session, call `model_router_execute` with the same `provider` and `model` to run the whole task on it, through its official CLI when that route's execution setting allows it.

## Official tools and actual execution

The seven tool cards use a fixed registry. Six install version-pinned official npm packages; ZCode opens a pinned, hash-checked, signed Windows desktop installer where you select the destination directory. On Windows, if MiniMax's npm native dependency cannot install, the plugin checks a pinned official installer script and installs the pinned release under the configured npm global prefix. A changed script fails closed until reviewed in a plugin update. Tool cards support detection, installation or repair, cancellation, and logs; they never accept arbitrary package names or shell commands.

From a Harness session, these plugin tools are available:

| Tool | Purpose |
| --- | --- |
| `model_router_routes` / `model_router_plan` | Show configured routes or generate a local plan. `/router` is the session command for a plan. |
| `model_router_consult` | Ask another configured Harness model for a live second opinion through the model API. This can incur provider charges. |
| `model_router_execute` | Run a routed plan, or one explicit model, through each vendor's headless CLI when enabled. Missing, logged-out, or failed CLIs fall back to the model API (a hung CLI and the processes it started get SIGTERM, then SIGKILL after 5 s; a cancel waits at most 1.5 s; Windows uses `taskkill /T /F`). The task may be up to 64,000 UTF-8 bytes (about 21,000 Chinese or 64,000 English characters) and is checked before any paid call; long tasks and dependency answers are truncated per step so each step's prompt fits. A run that stops on an error after paid steps is still recorded with their cost. Records cost and supports per-step rerun and rating. Read-only. |
| `model_router_health` | Onboarding health check: installed, version, login state per official tool. Logged-out tools are skipped by routing. |
| `model_router_rerun_step` / `model_router_rate` | Rerun (optionally reassign) one failed step of a recorded run, continue an editable team run in a fresh seeded worktree, or repeat a failed tool run; rate a result 👍/👎 to nudge future routing. |
| `model_router_tools` / `model_router_tool_install` | Probe or install a fixed official tool. `/tools` exposes the human command. |
| `model_router_tool_run` | Run one ready vendor CLI in the approved session workspace. Estimated and budget-checked first (`confirmOverBudget`). |
| `model_router_team_execute` | Run dependent work packages through ready vendor CLIs in order; stop on failure or a reported model mismatch. |

Headless assignment uses fixed adapters: Claude Code `claude -p`, Codex `codex exec`, and Gemini CLI `gemini -p` (`@google/gemini-cli@0.62.0`). DeepSeek and other providers without an adapter stay on the model directory API. A configured provider API key is passed only into that process; otherwise the CLI's own logged-in session is used. The plugin does not store keys in model profiles. Editable writes remain on `model_router_tool_run` and `model_router_team_execute`.

Claude Code, Codex, MiMo Code, and Grok Build support read-only and approved editable runs. Kimi Code, MiniMax Code, and ZCode headless modes handle permissions automatically, so the plugin only permits approved editable runs for them in an isolated Git worktree. Editable execution requires a clean Git repository. A successful run applies source changes only after the original checkout remains clean; ignored outputs remain for manual review. The official Harness process sandbox wraps launches, while its Windows ACL backend reports only partial file-effect enforcement.

The planned Harness model ID is not necessarily the vendor CLI's model name. A saved `cliModel`, or temporary `cliModelsJson` keyed by tool or work-package ID, can provide a known vendor CLI name. A package-specific temporary mapping takes priority over a tool mapping, then the saved profile. ZCode uses its configured default model. Most vendor CLIs do not provide a verifiable actual model ID in their results, so inspect vendor run records to confirm which model and price applied. The plugin's sequential CLI team runner is separate from Harness's built-in Agent Teams lifecycle.

## Optional GAL installation

[DeepSeek Harness GAL](https://github.com/Alice-Marx/deepseek-harness-galgame) owns the story player, artwork, free mode, music, preferences, and saves. Install it separately with `@ljwei-stak/dsh-galgame@0.1.0`; its README contains the player tutorial. It does not require the router, and the router does not require its images or story engines.

## Development and verification

Use Node.js **22.19+** and pnpm 10 (pinned through `packageManager`; `corepack enable` picks it up). From a complete source checkout, run:

```powershell
pnpm install --frozen-lockfile --strict-peer-dependencies
npm run build:client
npm test
npm run check:client
npm pack --pack-destination dist
```

pnpm 10 has no `pnpm peers check` command; `--strict-peer-dependencies` makes the install fail on unmet peer dependencies instead. The client must be rebuilt when its source changes; a previously generated bundle does not verify new code. Install the resulting archive through the Desktop plugin manager in a separate test profile to check the router entry and official-tool panel. Test GAL alone and alongside the router using its own repository's instructions. Live sign-in, actual vendor model identity, response quality, and provider billing require the account holder's acceptance checks.

The [0.11.1 release report](https://github.com/Alice-Marx/dsh-model-router/blob/main/PROJECT-TASK-REPORT-2026-10-02-NPM-RELEASE-AND-README-FIX.md) and [rc.2 compatibility report](PROJECT-TASK-REPORT-2026-10-01-RC2-COMPAT.md) preserve the earlier release record. Current split-release results belong in the new project task report; historical test counts do not establish standalone-package compatibility.

For installation failures, include the host and plugin versions, plugin installation details, and redacted logs in a [GitHub issue](https://github.com/Alice-Marx/dsh-model-router/issues).

License: [MIT](LICENSE).
