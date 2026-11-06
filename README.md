# DSH Bot · Model Router

[English](README.md) · [简体中文](README.zh.md)

[![npm version](https://flat.badgen.net/npm/v/@ljwei-stak/dsh-model-router)](https://www.npmjs.com/package/@ljwei-stak/dsh-model-router) [![dshfind](https://dshfind.com/api/badge/Alice-Marx/dsh-model-router?lang=en)](https://dshfind.com/en/plugins/Alice-Marx/dsh-model-router?ref=badge) [![dshfind](https://dshfind.com/api/badge/Alice-Marx/dsh-model-router?metric=downloads&lang=en)](https://dshfind.com/en/plugins/Alice-Marx/dsh-model-router?ref=badge) [![Listed in the DSH plugin directory](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/alice-marx/dsh-model-router) [![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[![dshfind](https://dshfind.com/api/card/Alice-Marx/dsh-model-router?lang=en)](https://dshfind.com/en/plugins/Alice-Marx/dsh-model-router?ref=badge)

**Current release: 0.63.4 · Windows Agent: 0.1.1.**

One DeepSeek Harness plugin combines long-lived Bot conversations, groups, memory and browser work with model routing, managed tasks, private Bot files, and an independently implemented Windows remote desktop. Configure each Bot's exact model, tools and machine access; a Main Bot can then route and dispatch work to an eligible worker.

**Start here:** [Install](#install) · [First Bot](#quick-evaluation) · [Daily work](#daily-work) · [Connect a computer](#computers) · [Routines](#routines) · [Bot routing](#bot-routing) · [Private library](#library) · [Model workbench](#workbench) · [Math reference](#costs) · [Troubleshooting](#troubleshooting).

![DSH Bot workspace](https://gitlab.com/Alice_marx/dsh-model-router/-/raw/main/docs/assets/workspace-0.63.1-light.png)

<a id="capabilities"></a>

## Included workflows

| Area | What you can use |
| --- | --- |
| Bot conversations | Named Bots with their own model, role, working folder, private conversation and permission settings; side chat, questions and approval cards. |
| Team work | Groups, parallel mentions, staged group goals, Bot-to-Bot handoffs and retained results. |
| Context and memory | Conversation checkpoints/parts and search; Bot/group/team memories, change history, and reviewable learned-skill/project-rule proposals. |
| Browser and documents | Per-Bot browser partitions and page tools, Office file reading/previews, connectors and secret-entry cards; avatar library and team appearance settings. |
| Scheduling | Upstream scheduled-task integration when the Host's Automation tasks service is enabled; continued work requires the Host and relevant Agent to stay running. |
| Bot routing | Saved economy/balanced/quality policy, committed model/tool/machine candidates, preview with refusal reasons, and actual worker-task dispatch. |
| Remote computer | A paired Windows desktop, watch/control handoff, keyboard/mouse/text input, monitor selection and enlarged viewing. |
| Routines | Demonstrate acknowledged inputs, save per Bot, replay through the real desktop session, inspect results and reconcile unknown effects. |
| Private library | Per-Bot folders, binary upload/download, text editing, name filtering and private text search from the page or granted Bot tools. |
| Model workbench | Local model-route planning, dependent work packages, official CLI detection/installation/terminal, execution history and separate API/subscription accounting. |

<a id="install"></a>

## Install

Install `@ljwei-stak/dsh-model-router@0.63.4` from npm in Harness Desktop, or import the matching release archive.

1. In Harness Desktop, open **Plugins → Add plugin** and enter `@ljwei-stak/dsh-model-router@0.63.4`, or import the matching release `.tgz`. For an extracted archive, choose its inner `package` directory containing `package.json` and `.dsh-plugin`.
2. Enable the plugin, then **fully quit Harness, including its tray process**, and restart. Closing only the window may leave the old Host running.
3. Check the loaded package version and open the Bot workspace/product navigation. Provider credentials and models are configured in Harness's official **Models** settings.

With the DSH CLI, install the exact release with:

```powershell
dsh plugin --profile desktop add @ljwei-stak/dsh-model-router@0.63.4
```

A global `npm install -g` alone does not register the plugin. The package name remains `@ljwei-stak/dsh-model-router`; its internal plugin ID remains `model-router-galgame` for retained settings. Remove duplicate old package entries before adding a replacement. GAL is a separate plugin.

<a id="quick-evaluation"></a>

## First Bot and first task

1. Add a provider/model in Harness **Models**, then create or select a Bot and choose an exact configured model.
2. Open **Bot bindings / Bot 绑定**. Review the Bot's tools, working folder, machine permissions and funding settings. A role description does not grant permissions.
3. Mark your coordinating Bot as Main using the Bot settings. Configure worker Bots with the models and tools they should actually use.
4. Send a small task with a concrete output and acceptance check. Inspect the task state and the output; an accepted plan ID means work was submitted, not completed.
5. For computer work, complete the pairing steps below. For delegation, enable [Bot routing](#bot-routing) and first preview the candidate decision.

Integration mode reuses Harness Sessions. The optional independent runtime has its own session store and must be switched explicitly; one Bot must have only one active runtime owner. Group conversations, memories, browsers and long-lived context come from the pinned upstream runtime, not from a placeholder capability list.

Windows computer setup: [download Agent 0.1.1 for Windows x64](https://github.com/Alice-Marx/dsh-model-router/releases/download/v0.63.3/dsh-remote-agent-0.1.1-windows-x64.zip), extract it and run `start.cmd`.

<a id="daily-work"></a>

## Chat, groups, memory, browsers and schedules

| What you want to do | Operation |
| --- | --- |
| Talk to a Bot | Create/select the Bot in the sidebar, choose its model and role in Bot settings, then send a message. Review question and approval cards before continuing an operation. |
| Work with a group | Create a group from the chat picker with the required Bots. In group settings choose members/admin, who answers, the working folder and shared instructions; use `@` to select respondents. |
| Keep and find context | Search conversations from the sidebar; use conversation parts/checkpoints to manage long work. Open the Bot/group/team memory entry to review, edit or remove retained memories and inspect changes. Review skill/project-rule learning proposals before accepting them. |
| Use a browser or document | Open the selected Bot's browser pane for its pages and browser workflow. Attach supported Office documents for reading/preview. Configure available connectors and enter credentials through the supplied secret-entry cards. Avatar choices are managed separately from the file library. |
| Schedule work | When the Host enables its Automation tasks service, open schedules in Bot settings or the schedule page, choose the target Bot/group, task text and a supported timing rule, then save. Check the next-run state; Host and relevant Agent must remain running. |

<a id="computers"></a>

## Connect your Windows or cloud computer

### On the computer being controlled

1. Prepare your own Windows x64 computer/cloud PC and sign into its desktop. Keep the interactive user session available while using desktop capture/control.
2. Extract the **entire** `DSH-RemoteAgent-windows-x64-…zip` into a directory you will retain. The complete bundle includes Node, production dependencies, `dist`, setup/launch files and native helpers. Copying only `start.cmd` or one executable is insufficient.
3. Double-click **`start.cmd`**. In the setup wizard choose the workspace directory, the concrete local/private VPN address to listen on, port (default `9701`), and the Agent base URL reachable from the Harness computer.
4. For another machine, first configure your WireGuard/Tailscale network or a protected tunnel. Confirm the private-tunnel option only for a network you have actually configured. Loopback is suitable for local use or a separately configured SSH forwarding path.
5. Decide whether to enable **`hostManagedBots`**. Explicitly enabling it lets this trusted authenticated Host authorize current/future team Bots within the paired root/tool ceiling. Disabling it requires fixed allowed Bot IDs. It does not give models the pairing secret or remove root/tool restrictions.
6. Choose any optional command/browser permissions. Setup registers Agent and desktop-helper tasks for the current signed-in user, without storing a Windows password. It displays the installation path and creates **`private/pairing.private.json`** there. Rerunning setup preserves existing configuration and credentials.

### In Harness

1. Open **Remote computers / 远程电脑 → Add computer** and import the generated **`private/pairing.private.json`** from the installed Agent directory.
2. The import fills the endpoint, machine/client identity, `rootIds`, tools and tunnel setting. Review them, choose the Bot requested by the form, then pair/probe. Keep this file private: it contains the Host pairing credential; do not publish it in Git or issue reports.
3. Review **Bot bindings** and the computer's grants. Watching needs screenshot permission; takeover and routine replay need the permitted desktop input tools and write mode. Root IDs such as `project` identify the configured remote workspace, not a path supplied by a model.
4. In a Bot's right-hand **Computer operations / 电脑操作** tab, or the computer page, select the machine/monitor and click **Connect desktop / 连接桌面**. Start in **Watch / 仅观看**.
5. Click **Take control / 取得控制权** and wait for the control acknowledgement before using mouse, keyboard, wheel or text entry. Human control fences that Bot's conflicting desktop automation. Click **Watch / 仅观看** to release control and held input.
6. Use **Enlarge / 放大** for the application-filling viewer, or double-click while watching; **Close enlargement / 关闭放大** returns to the panel. Disconnect when finished and inspect any unconfirmed-stop message.

The desktop engine uses **Windows GDI capture → JPEG → WebSocket** with native input acknowledgements. It is an independent implementation, not the RustDesk protocol. The live viewer shows measured frame rate; no fixed 30 FPS, RustDesk performance equivalence, secure-desktop capture or universal network throughput is promised. Agent reachability alone does not prove that the signed-in desktop helper is available.

<a id="routines"></a>

## Demonstrate, save and replay a routine

1. Connect the desktop, take control, restore the application to a known starting screen, enter a routine name and click **Start recording / 开始录制**.
2. Demonstrate the workflow. Only inputs acknowledged by that desktop session enter the recording. Consecutive mouse motion is sampled into **200 ms** waypoints; button/key/text/wheel ordering and the final position before those actions are retained.
3. Click **Finish and save / 结束并保存**. The client drains input, confirms held-input release, and saves to that Bot's private routine store. Typed text is included in the saved routine. Missing save confirmation retains a draft instead of showing success.
4. Open **Routines / 例行任务**, select the Bot/computer and restore the starting screen. Run the saved routine and inspect its actual result and stopped step.
5. The recording is limited to **200 retained steps**, with at most **60 seconds** between retained actions. Replay checks the exact display ID, physical dimensions, coordinate system and recorded DPI. Changed layout/application state still requires a new demonstration; sampled pointer motion is unsuitable for fine drawing.

This is bounded coordinate-and-timing playback, not universal visual learning. Replay acquires control, waits for every native input ACK, renews authorization and releases input/control on completion, failure or cancellation. An explicit refusal stops further steps. A sent input with a lost ACK, a disconnect, or an interrupted Host is **unknown**, because its effect may already have happened.

Unknown executions block another routine on that Bot/computer. Inspect the real desktop, determine how far the work got, restore an appropriate starting state and enter your inspection note before unblocking. Inspection does not rewrite the old outcome as success or automatically rerun it. A stop request is not a stop confirmation, and successful input ACKs do not by themselves prove the business objective was met.

<a id="bot-routing"></a>

## Route work between Bots

1. Configure the Main and worker Bots' exact models, official tools and machine/workspace grants first.
2. On **Tasks / 任务 → Bot routing / Bot 路由**, enable routing and choose **Economy / 省钱优先**, **Balanced / 均衡**, or **Quality / 效果优先**. Save settings using the supplied controls.
3. Enter a task, choose automatic routing or a pinned Bot, and specify a machine/root and read/write/desktop/browser need when applicable. **Preview routing / 预览路由** shows the chosen candidate, missing conditions/refusal reasons and any proposed binding.
4. Select **Create task with this route / 按此路由创建任务** for real dispatch. Optional automatic computer authorization remains bounded by the committed machine ceiling and the requesting Main Bot's delegation rights.
5. A Main Bot can call **`bot_route_task`** or its **`bot_dispatch`** alias. Both dispatch by default. Explicit **`preview:true`** only previews and does not create a task or grant permissions. Inspect actual plan/task state with `bot_task_plan_status` and check the deliverable before reporting completion.

Candidates come from committed Bot model/tool/machine state, including availability and any configured price/quality evidence. A Bot name or prompt cannot grant an endpoint, executable, credential or operation identity. Each worker model request has its own budget admission and receipt linked to the parent task; admitting a task is not blanket approval for every later model request.

<a id="library"></a>

## Use the Bot's private file library

Open **Library / 资料库**, select a Bot and a folder. Upload local files, create/open folders, edit supported text files and download files; the name filter narrows the current directory. For contents, enter a literal query and click **Search text / 搜索文本**. Results show path, line and text; click a path to open and select the matching line, then explicitly Save any edit to that file.

Binary upload/download preserves file bytes and accepts up to **16 MiB per file**. Text reading/editing is limited to **1 MiB per file**. Case-insensitive text search uses up to 256 query characters, scans at most 500 entries/eight directory levels in the selected Bot's library, and returns at most 50 matching lines from eligible text files. The granted `bot_library_search` tool uses the same backend and the actual calling Bot's own library. Same-name uploads are refused.

The library is that Bot's private file area, distinct from the upstream avatar library and the remote machine's workspace. Uploading a PDF or Office file does not promise automatic OCR, semantic indexing or retrieval over every binary format. Models access private files through their granted library tools, not by choosing another Bot's ID.

<a id="workbench"></a>
<a id="official-tools"></a>
<a id="session-tools"></a>
<a id="team-lifecycle"></a>
<a id="architecture"></a>

## Model workbench, tools and execution boundaries

Open **Advanced workbench / 高级工作台** for model-route planning, exact-route profiles, official tools, terminals, dependent work packages and API/subscription accounting. Configure provider credentials in Harness Models and vendor CLI logins in their own tools. Detection or installation does not prove login, entitlement or a managed execution mode is available.

Close the **Needs your attention / 需要你处理** panel with its top-right **×**. The choice is remembered on this device, including after restarting. Use **显示待处理提醒** at the top of the workbench to show it again; task records remain available in history and cost pages.

Planning and candidate previews are local. Execution may send task/context to the selected provider or CLI and incur charges. Model routing selects a model route; Bot routing selects a configured Bot and dispatches its actual worker task. The two workflows share committed Host authority and accounting rather than accepting authority from model parameters.

The official-tool registry includes Kimi Code, Claude Code, Codex, MiniMax Code, MiMo Code, Grok Build, Gemini, OpenCode, StepCode, Pi, Hermes, ZCode and DSH TUI. Availability depends on the selected platform and supported execution mode shown by the workbench. An interactive terminal uses the current OS user's permissions. An explicitly chosen vendor-native editable process is outside the Harness process sandbox; a worktree collects edits but does not restrict OS access.

Tasks retain task/attempt/operation identity, results and unknown-effect evidence. Follow the task's status and acceptance check; do not infer completion from a generated plan, an installation method, a successful permission check or a method name. API money/reservations and subscription calls/reported tokens are separate books. Missing usage remains unknown.

1. In **Model configuration**, refresh the configured routes and enter any known prices, quality evidence, billing preference and CLI model mapping. Keep unknown values empty.
2. In **Task and execution**, enter the task and choose a single route, a dependent team, or manual per-package assignments. Generate recommendations, inspect the preview and confirm the actual execution you want.
3. In **Official tools**, detect/install the required CLI and check its available modes and login. Use the interactive terminal when appropriate; configured access to a CLI does not imply every model has a managed runner.
4. In **Budget and security** and the usage page, configure API limits/subscription preferences and inspect receipts. Follow running work in the task/history view; cancel, retry or reconcile from its recorded state.

The following cost and routing reference describes the **model-route workbench**. Bot selection and desktop routine playback are separate workflows.

<a id="costs"></a>

## Costs, subscriptions and quality

- **API budgets:** per-run planning targets and daily/monthly monetary checks apply to API-billed execution. Admission atomically checks recorded API spending plus other API reservations, then reserves the new API estimate. Unknown API prices, costs or reservations under a finite limit require explicit confirmation. Later API calls recheck fresh spending and holds. Confirmed subscriptions do not consume API money or fail only because its budget is full or its price is missing. Switching a subscription to API is a new monetary admission: estimate the actual API route, obtain any required confirmation, and reserve atomically before the call. Local estimates are not a hard provider billing cap.
- **Checkpoints and interruption:** routed executions, retries/reassignment, official teams, single-tool runs and session consultations use the durable lifecycle. Optional reviews and quality upgrades reserve extra capacity before another call. Before a quality upgrade starts, the first receipt and the pending additional attempt are saved, so interruption cannot erase the first charge or imply the second attempt was free. The UI displays actual spending and reservations separately; a reservation is not an invoice. Confirmed dead owners retain interrupted holds and unknown usage evidence until reconciled; elapsed time alone does not free them, and no call is automatically replayed.
- **Subscription-first:** the default is to prefer a detected CLI account subscription or a configured coding-plan route. API-key environment variables are removed for CLI subscription attempts. `billing` can be `subscription-first`, `api-only` or `subscription-only`; `subscription` can be `cli-login`, `plan-key` or `none`.
- **Fallback:** detected quota exhaustion/rate limits mark a subscription in cooldown and can retry the routed step on its configured API route, subject to policy and availability. Other attempted subscription failures pause by default (`onSubscriptionFailure: "ask"`): choose API retry, subscription retry or cancel in history. A subscription-to-API route change must pass a fresh estimate and reservation check for the actual API route. A missing price or exceeded finite budget requires the applicable confirmation; without it, the API call stops. Managed editable/single-tool/team runs do not automatically retry on the API.
- **Subscription usage:** record daily/monthly calls, reported input/output/cache tokens and unknown/incomplete-usage counts, with provider/tool/model groups. Missing counters are not zero. A subscription-to-API attempt keeps the subscription usage receipt as well as the API financial result. Historical reference-dollar fields may remain in old records, but current subscription statistics do not convert them to money or fabricate missing token data. Token counts do not establish a vendor subscription allowance, remaining quota or percentage.
- **API accounting:** valid CLI-reported money, including zero, takes precedence for API-billed results. Otherwise token-based CLI cost requires complete usage and an actual reported model matching configured pricing or an explicit CLI mapping. Unknown or mismatched identity keeps API cost unknown; the recommended price does not prove actual cost. A CLI using an API key still belongs to API accounting. Provider bills remain authoritative. Replaced retry receipts and evicted history retain prior accounting.
- **Quality and preference:** optional `off`/`sample`/`always` stronger-model review can add paid calls; it is not treated as human feedback. Explicit ratings adjust separate subjective utility for the exact route and task type, using time decay and low-sample shrinkage (default limit ±0.04, configurable up to ±0.1). They do not change objective quality scores or their hard floors; learning can be disabled, ratings withdrawn, or its starting point reset.

Coding-plan keys and endpoints stay in Harness provider settings. A `plan-key` profile may name an exact configured `apiRoute` as its fallback; the profile editor does not accept credentials or arbitrary commands. Vendor plan eligibility and terms must be checked with the vendor.

### Actual cost versus planning estimate

The formula below applies to API-billed results. Algorithmic route-price comparisons are planning inputs; they do not turn a subscription into an API bill. The execution preview separates API money from estimated subscription tokens.

For API-billed results, a valid CLI-reported USD amount, including explicit zero, wins over token-price calculation. Otherwise, token-based CLI accounting requires complete normalized usage, known nonnegative prices, and a reported actual model matching the priced route or its explicit CLI mapping:

<!-- formula:actual-cost -->
```math
C_a = \frac{I_u p_i+O p_o+R p_r+W p_w}{10^6}
```

$`C_a`$ is `actualUsd`; $`I_u`$, $`O`$, $`R`$, and $`W`$ correspond to `inputTokens`, `outputTokens`, `cacheReadTokens`, and `cacheWriteTokens`. $`p_i`$, $`p_o`$, $`p_r`$, and $`p_w`$ are the matching input, output, cache-read and cache-write prices in USD per million tokens.

These ledger counters are disjoint after adapter normalization; do not add cached tokens to an inclusive input count. Missing optional cache prices use the input price. Incomplete usage, absent prices or unknown/unmatched identity keep the amount `null`, not zero. Complete terminal evidence can survive a failed/cancelled/timed-out run; partial events are marked `usageIncomplete`.

For example, a complete API result with 1,000 uncached input tokens at \$1/million and 500 output tokens at \$5/million costs \$0.0035. A subscription result instead records the reported tokens and call count; it is not converted to API money. A provider-reported \$0 for an API attempt is explicit evidence for that attempt, not proof that earlier unknown attempts were free. Actual provider bills are authoritative. Official-team mode does not automatically fall back to API, but a vendor CLI using its own API credentials still incurs API-billed usage.

<a id="routing"></a>

## How routing works

Manual assignment: after planning, choose algorithm recommendations or select an API model / official tool for each package. See the [manual assignment guide](docs/MANUAL_TASK_ASSIGNMENT.zh.md).

The planner is a deterministic local heuristic, not a trained success predictor. It classifies text, estimates complexity, creates suitable analysis/execution/verification/synthesis packages, discovers exact configured routes, overlays profiles, and applies capability/quality constraints. An explicit route bypasses comparison with other routes. Catalog quality/latency/risk hints are experimental priors, not measured success probabilities or live vendor quotes. Execution is currently text-oriented; a vision label does not establish an end-to-end multimodal pipeline.

### Token and price estimate

Without matching resource evidence, base input tokens are $`\max(80,\lceil n/3.7\rceil)`$, then adjusted by package-stage multipliers. Base output is 900, adjusted by stage/reasoning effort, with minimum 220. Here $`n`$ is the JavaScript `text.length` value. This is a text-length heuristic, not a vendor tokenizer. Sufficient matching, complete history replaces these heuristics with empirical P90 resource estimates, without applying effort or stage multipliers again. Let $`I`$ be total estimated input, $`R`$/$`W`$ the cached-read/write portions, $`O`$ output, and prices USD per million tokens:

<!-- formula:planning-cost -->
```math
C = \frac{(I-R-W)p_i+O p_o+R p_r+W p_w}{10^6}
```

<!-- formula:cost-utility -->
```math
U_c = \frac{1}{1+C/\max(C_{\mathrm{ref}},10^{-12})}
```

$`U_c`$ is `costUtility`. The price symbols are the same as above. $`C_{\mathrm{ref}}`$ uses fixed reference prices (input 1, output 5, cache read/write 1 USD/million), not a vendor offer. Fixed scaling prevents an unrelated expensive candidate from flattening all cost penalties. Unknown prices produce a public estimate of `null` and cost utility 0. Internal unconstrained search uses a cost sentinel of 0, but finite-budget assignment excludes unknown-price candidates; the sentinel never means free execution.

### Candidate objective and quality floors

With normalized quality $`q`$ and normalized latency, specialty, reasoning-fit and risk proxies:

<!-- formula:latency-utility -->
```math
L = \begin{cases}
\dfrac{1}{1+t/10\,000}, & t\text{ known}, \\
1-\min(1,\max(0,\ell e_\ell)), & \text{otherwise}.
\end{cases}
```

<!-- formula:candidate-utility -->
```math
u = w_q q+w_c U_c+w_\ell L+w_s s+w_r r-w_k k-\alpha\max(0,f-q)+\Delta_p
```

<!-- formula:assignment-score -->
```math
S = \sum_{j=1}^{n}u_j - 0.015\sum_{(i,j)\in E}\mathbf{1}[\rho_i\ne\rho_j]
```

$`L`$ is latency utility: $`t`$ is the matching historical P90 duration in milliseconds; otherwise $`\ell`$ is the latency proxy and $`e_\ell`$ its effort multiplier. In the utility formula, $`s`$/$`r`$/$`k`$ are specialty/reasoning-fit/risk, $`f`$ is the quality floor, $`\alpha`$ is criticality, and $`\Delta_p`$ is the bounded `preferenceAdjustment`; the $`w`$ terms are the corresponding weights. $`S`$ is `assignmentScore`; $`E`$ contains dependency edges, and $`\rho_j`$ is package $`j`$'s `provider/model` route. The indicator is 1 when routes differ, otherwise 0.

Quality first uses sufficient matching objective task evidence, then falls back to task-category LiveBench, overall LiveBench, and profile/catalog estimates. Model and effort are compared jointly only when at least two API efforts have usable task evidence; observed duration can replace the latency proxy. Public-data refresh is opt-in. Human ratings affect only the bounded `preferenceAdjustment`; they cannot increase objective quality or satisfy its floor.

| Package basis | Quality | Cost | Latency | Specialty | Reasoning | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| Simple | 0.28 | 0.45 | 0.14 | 0.04 | 0.07 | 0.02 |
| Balanced | 0.40 | 0.26 | 0.10 | 0.09 | 0.10 | 0.05 |
| Complex | 0.48 | 0.14 | 0.06 | 0.14 | 0.11 | 0.07 |
| Synthesis | 0.58 | 0.08 | 0.04 | 0.08 | 0.16 | 0.06 |

Base quality floors are **0.75 / 0.78 / 0.82** for simple/balanced/complex tasks; critical complex packages raise the floor, and complex synthesis is at least 0.84. The economy preset multiplies quality/cost/latency weights by 0.75/1.6/1.1 and lowers the floor by 0.04. Quality-first multiplies quality/cost/specialty/reasoning by 1.35/0.5/1.2/1.2 and raises the floor by 0.04. Tilted weights are renormalized to the original total; adjusted floors are clamped to [0.5, 0.97]. Balanced applies no tilt.

### Candidate pruning and assignment search

1. Prefer candidates meeting each package's floor. If none qualify, retain up to three highest-quality fallbacks and report relaxation.
2. Keep at most **12 candidates per package**, including anchors for lowest known cost, greatest utility and highest quality. Local Pareto pruning is disabled when dependencies exist, because route identity affects handoffs.
3. Validate unique package IDs and topological dependency order. Search the retained Cartesian space exactly when its size is at most **4,096**; otherwise use **beam width 256**. Search compresses dominated prefixes sharing the same future dependency boundary and ranks them using optimistic future handoffs. Remaining minimum costs prune infeasible prefixes; the beam protects the cheapest feasible prefix under a finite budget.
4. Compare assignments lexicographically: fewer relaxed packages, smaller quality shortfall, higher utility, lower cost, fewer route switches, then stable route order. Minimum-cost mode compares cost before utility. Each dependency crossing a `provider/model` route subtracts 0.015 from utility.
5. Report search metadata and feasibility. When a positive budget has no feasible assignment, a minimum-cost alternative can still be returned with `budgetFeasible: false`. A displayed plan is not proof that the budget is satisfied.

“Exact” applies only to the retained candidate space and proxy objective. Candidate caps and beam pruning prevent a guarantee of global optimality over all configured models; use the preview to inspect the selected route and any relaxed quality floor.

See the [algorithm optimization guide](docs/ROUTING_ALGORITHM_OPTIMIZATION.zh.md) for evidence import, fallback rules, effort handling, and optional JSON validation with escalation. Escalation defaults to off and permits at most one additional ordinary API request after billing and budget checks.

<a id="data"></a>

## Data and privacy

Harness owns provider credentials and authenticated sessions. Router state/receipts live under `<DSH_HOME>/model-router/`; the product also keeps committed Bot bindings, task records, private libraries and routine/run journals there. The upstream Bot home retains conversations, memory, browser state and related team files according to its configured location. Remote Agent state and pairing credentials remain in the installed computer's directory.

Task/context sent to a provider or CLI follows that service's account and billing terms. Saved routines contain the demonstrated text. Treat pairing exports, histories, logs and private files as private data. Back up application state before changing runtime owners or downgrading; do not erase receipts or uncertain-operation journals to bypass a blocked run.

<a id="troubleshooting"></a>

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Old UI/version after an update | Fully quit the tray Host, confirm the installed package path/version and restart. |
| No route or no eligible worker | Exact configured model, allowed tools, machine/root permissions, current availability and the preview refusal reason. |
| `TOOL_DENIED` or a blocked task | Read the actual committed Bot grant and requested operation; do not broaden a model-supplied identity or assume a role prompt grants access. |
| Agent online but no desktop | Current signed-in Windows session, both installed tasks, full-desktop helper and its native logs. |
| Agent cannot be reached | Correct reachable base URL/port and already configured private VPN/tunnel; importing a pairing file does not create that network. |
| Chief connects but a new worker cannot | Check the Agent pairing Bot-ID/`hostManagedBots` ceiling, then save that worker's computer/tool grant. A fixed allowlist does not automatically include new Bots. |
| Watch works but takeover is disabled | All required desktop input tools, write-mode grant and current control ownership. |
| Routine reports display changed | Restore the recorded monitor/resolution/DPI or record a new routine; match the application layout as well. |
| Unknown effect or unconfirmed stop | Inspect the real computer and the execution record before resolving; do not blindly replay or delete the journal. |
| Library file is refused | Binary transfer limit is 16 MiB per file; text editing/reading limit is 1 MiB; same-name uploads are refused. |
| API/subscription amount unknown | Inspect actual model identity, price and provider usage evidence; missing counters are not zero. |

[Update history (GitLab)](https://gitlab.com/Alice_marx/dsh-model-router/-/blob/main/CHANGELOG.md) · [Source build guide (GitLab)](https://gitlab.com/Alice_marx/dsh-model-router/-/blob/main/docs/DEVELOPMENT.md) · [MIT license](LICENSE)
