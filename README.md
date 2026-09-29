# Model Router Galgame

**A model routing and Galgame plugin for DeepSeek Harness Desktop.** It plans which of your configured models should handle a task, gives simpler work to an affordable capable route, and reserves stronger routes for difficult work. Compound requests become dependent work packages that can be run through supported official vendor tools.

[简体中文说明](README.zh.md) · [Installation guide (Chinese)](INSTALLATION_GUIDE.zh.md) · [v0.9.0 release](https://github.com/Alice-Marx/model-router-galgame/releases/tag/v0.9.0) · [npm package](https://www.npmjs.com/package/@ljwei-stak/model-router-galgame/v/0.9.0)

> **Current compatibility:** plugin **0.9.0** targets DeepSeek Harness Desktop **0.2.0-rc.1**. The plugin was installed and its two panels opened in an isolated profile using that Desktop version's runtime. Vendor account sign-in, paid model calls, actual model selection inside each CLI, and billing still need user verification.

![Diagram of the local routing plan and the separate official-tool execution step](docs/assets/routing-workflow.svg)

*Workflow diagram. Planning uses the configured Harness model directory and optional user-provided model data. A plan does not itself start vendor tools or spend tokens.*

## What it does

| Area | Available behavior |
| --- | --- |
| **Model Router** | Classifies task type and complexity, splits compound requests into a dependency graph, recommends an exact configured `provider/model` for each work package, and displays quality evidence and estimated cost when available. |
| **Model profiles** | Lets you enter your own 0–100 quality score, USD input/output price per million tokens, specialties, and an optional vendor CLI model name for an exact Harness route. Missing prices remain unknown. |
| **Official tools** | Detects and offers one-click, fixed-source installation for Kimi Code, Claude Code, Codex CLI, MiniMax Code, MiMo Code, Grok Build, and ZCode. The panel shows installation and trusted launch readiness separately. |
| **Execution** | Session tools can consult another configured Harness model, run one supported official CLI, or execute a sequence of dependent work packages with the CLI team runner. |
| **Gal Module** | A separate sidebar area has an illustrated offline story with choices and three local save slots, plus a free mode that can chat through a model configured on the official Models page or copy a roleplay opening prompt into a Harness session. |

![Official tools section in an isolated DeepSeek Harness Desktop 0.2.0-rc.1 profile](docs/assets/desktop-official-tools-0.9.0.png)

*Desktop capture from an isolated compatibility profile. A green launch check means the local entry point passed the plugin's checks; it does not prove that the vendor account can authenticate or that a paid task will succeed.*

## Install the right version

| Plugin version | Intended host | Install status |
| --- | --- | --- |
| **0.9.0** | **DeepSeek Harness Desktop 0.2.0-rc.1** | Current compatibility candidate, published as the npm `next` tag and a GitHub prerelease. Use the explicit version below. |
| **0.8.0** | DSH 0.1.7-rc.2 dependencies | Incompatible with Desktop 0.2.0-rc.1; the Desktop plugin manager rejects it. |
| **0.4.32** | Legacy `@deepseek-ai/dsh-settings` peer range `^0.1.1-rc.1 \|\| ^0.1.2-rc.1 \|\| ^0.1.5-rc.1` | Still carries npm's `latest` tag as of 2026-09-29. Installing without an explicit version can select this older package; this row does not claim every older Desktop build was tested. |

### Option A: install by package name

1. In DeepSeek Harness Desktop, open **Plugins → Add plugin**.
2. Enter this exact package name, including the version:

   ```text
   @ljwei-stak/model-router-galgame@0.9.0
   ```

3. If the selected mirror cannot reach the package, choose an available **HTTPS** npm source, for example `https://registry.npmjs.org/`.
4. Install and enable the plugin. The sidebar should show **Model Router** and **Gal Module**.

### Option B: install the release archive

Download [`ljwei-stak-model-router-galgame-0.9.0.tgz`](https://github.com/Alice-Marx/model-router-galgame/releases/download/v0.9.0/ljwei-stak-model-router-galgame-0.9.0.tgz) from the [v0.9.0 GitHub release](https://github.com/Alice-Marx/model-router-galgame/releases/tag/v0.9.0), then enter its absolute path in the Desktop **Add plugin** input (for example, `D:\Downloads\ljwei-stak-model-router-galgame-0.9.0.tgz`). On Windows, you can check the downloaded file:

```powershell
Get-FileHash 'D:\Downloads\ljwei-stak-model-router-galgame-0.9.0.tgz' -Algorithm SHA256
```

The published 0.9.0 archive has SHA-256 `FB06ED5527DE256062BB932EF5A35AF8FF9BEB8B6D2B3F635E2F30D0736A8E4B`. Replace the example path with your download path. The npm and GitHub release archives were downloaded and compared byte for byte during publication.

### Build a local archive from source

With Node.js 22.19+ and pnpm installed, run these commands from this repository's root. Check out the verified release tag before building:

```powershell
git checkout v0.9.0
pnpm install --frozen-lockfile
npm run build:client
New-Item -ItemType Directory -Force dist | Out-Null
npm pack --pack-destination dist
```

Install the resulting `.tgz` through the plugin manager. Use the plugin manager for upgrades too; do not modify the Desktop application directory or `app.asar`. See the [installation guide](INSTALLATION_GUIDE.zh.md) for the full Windows checklist, including tool installation outside the C drive.

After enabling the plugin, configure your providers, models, and credentials on Harness's official **Models** page. The router only considers routes present there; its profile editor does not accept API keys.

## Use the Model Router workbench

![Schematic guide to entering a task, generating a plan, and finding its results lower on the page](docs/assets/workbench-usage.svg)

*Operation schematic, not a Desktop screenshot. The generated result appears **below** the model-profile editor, so scroll down after clicking the button.*

1. Open **Model Router** in the sidebar. The top status shows how many providers and routes the official **Model directory** returned. If it is empty, configure a provider and model on Harness's official **Models** page, then click **Refresh** in the workbench's directory card. A route appearing in the directory does **not** prove that its credentials or network connection work.
2. In **Task planning → Task description**, write what you want done and list distinct actions on separate lines for a compound request. Choose **Single task** for one direct recommendation or **Team allocation** for dependent work packages. Team mode decomposes requests that the router classifies as complex; selecting the mode alone does not start a team.
3. The **Estimated budget for this run (USD)** field may show `10`. That is **$10 for planning**, based on your supplied prices and estimated tokens. Set it to `0` to remove the estimate constraint. Neither value caps a provider bill or authorizes a model call.
4. Click **Generate route recommendation**. Planning runs locally. Scroll down **past Model pricing and capabilities** to **Route recommendation**. Read the recommended `provider/model`, complexity band, estimated cost or “price needs configuration,” and the **execution channel** badge. In team mode, check each package's objective, difficulty, route, dependencies, verification checklist, and warnings. `Official CLI` means a trusted local launch entry is ready; `Model directory API` means the plan routes through Harness's configured model API.
5. To improve the recommendation, save each exact `provider/model` route's quality score and input/output prices in **USD per million tokens** in the **Model pricing and capabilities** editor, then click **Generate route recommendation** again. Saving a profile invalidates the previous result; a missing price remains unknown. Review the **Official tools** cards below the result for probe, install/repair, and launch-readiness status. ZCode opens its own installer and requires you to complete its directory choice.
6. To actually ask or run a model, open an **official Harness session** and request `model_router_consult` for a live second opinion, `model_router_tool_run` for one ready vendor CLI, or `model_router_team_execute` for dependent CLI work packages. You can also use `/router` to request a plan and `/tools` to inspect tools in a session. An editable CLI task requires approval and a clean Git repository; check the vendor run record for the actual model and charge.

For example, enter: “**Plan a complex, three-minute science-fiction short film.** Extract the premise and constraints; design a beat sheet and shot list; review visual continuity and production risks; synthesize a handoff checklist.” Choose **Team allocation**, generate the plan, and inspect which configured routes it assigns to the writing and review packages. This plugin produces a *plan* and can delegate supported CLI tasks; it does **not** render a film or control nine creative applications.

The [full Chinese workbench guide](docs/WORKBENCH_USER_GUIDE.zh.md) walks through the controls, result location, model-profile setup, and session handoff.

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

A complex request begins with **analysis** and ends with **synthesis**. Action-like lines, bullets, clauses, or sentences can become up to six explicit execution packages. A request for testing or verification adds a verification package. The `dependsOn` edges put analysis before execution, verification after the relevant execution packages, and synthesis after all required results. Sequential wording such as “then” adds an edge between execution packages.

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
    "cliModel": "name-configured-in-that-vendor-cli"
  }
]
```

`quality` is a personal 0–100 comparison score. `pricing.input` and `.output` are nonnegative USD rates per million tokens; optional `cacheRead` and `cacheWrite` rates are supported. The optional `cliModel` must match the name accepted by that vendor's own CLI, which may differ from the Harness directory ID. MiniMax and MiMo expect `provider/model` for that field. ZCode 3.14.3 cannot switch models per call, so it does not accept `cliModel`.

## Official tools and actual execution

The seven tool cards use a fixed registry. Six install version-pinned official npm packages; ZCode opens a pinned, hash-checked, signed Windows desktop installer where you select the destination directory. On Windows, if MiniMax's npm native dependency cannot install, the plugin checks a pinned official installer script and installs the pinned release under the configured npm global prefix. A changed script fails closed until reviewed in a plugin update. Tool cards support detection, installation or repair, cancellation, and logs; they never accept arbitrary package names or shell commands.

From a Harness session, these plugin tools are available:

| Tool | Purpose |
| --- | --- |
| `model_router_routes` / `model_router_plan` | Show configured routes or generate a local plan. `/router` is the session command for a plan. |
| `model_router_consult` | Ask another configured Harness model for a live second opinion. This can incur provider charges. |
| `model_router_tools` / `model_router_tool_install` | Probe or install a fixed official tool. `/tools` exposes the human command. |
| `model_router_tool_run` | Run one ready vendor CLI in the approved session workspace. |
| `model_router_team_execute` | Run dependent work packages through ready vendor CLIs in order; stop on failure or a reported model mismatch. |

Claude Code, Codex, MiMo Code, and Grok Build support read-only and approved editable runs. Kimi Code, MiniMax Code, and ZCode headless modes handle permissions automatically, so the plugin only permits approved editable runs for them in an isolated Git worktree. Editable execution requires a clean Git repository. A successful run applies source changes only after the original checkout remains clean; ignored outputs remain for manual review. The official Harness process sandbox wraps launches, while its Windows ACL backend reports only partial file-effect enforcement.

The planned Harness model ID is not necessarily the vendor CLI's model name. A saved `cliModel`, or temporary `cliModelsJson` keyed by tool or work-package ID, can provide a known vendor CLI name. A package-specific temporary mapping takes priority over a tool mapping, then the saved profile. ZCode uses its configured default model. Most vendor CLIs do not provide a verifiable actual model ID in their results, so inspect vendor run records to confirm which model and price applied. The plugin's sequential CLI team runner is separate from Harness's built-in Agent Teams lifecycle.

## Gal Module

![Illustration from the Gal story, shown as artwork rather than a Desktop screenshot](aipicture/story-backgrounds/model-city-title.webp)

*Story artwork from the plugin's Gal assets; it is not a capture of the running interface.*

The **Story** tab runs locally: stage backgrounds, characters, dialogue, choices, history, endings, and three local save slots. The **Free** tab uses an official configured model route for in-panel chat, can stop a pending response, or copies the opening prompt into a Harness session. Free-mode replies are real model calls and may incur charges. The plugin does not store provider credentials.

## Verification status and further reading

Version 0.9.0 passed 70 automated tests, a frozen dependency install, client build check, peer dependency check, and an isolated install against the actual Desktop 0.2.0-rc.1 runtime. The isolated UI opened the Model Router and Gal panels, planned demo tasks, and showed local official-tool status. Some CLI installations and trusted-entry checks were exercised without vendor accounts. **These checks do not validate live sign-in, model identity, billable output, or production task quality.** Test those with your own accounts and a disposable Git repository before relying on editable team runs.

The [project task report](PROJECT-TASK-REPORT-2026-09-29.md) records the file roles, completed checks, account tests still needed, and remaining work. See the [migration notes](MIGRATION.md) if you previously used an older desktop integration.
