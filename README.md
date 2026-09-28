# Model Router Galgame for DeepSeek Harness

Desktop plugin for the official **DeepSeek Harness 0.1.7-rc.2**. Version **0.8.0** is available as the npm `next` candidate and a GitHub prerelease; npm `latest` remains 0.4.32. Real-account and Desktop acceptance is still pending. The npm package name is `@ljwei-stak/model-router-galgame`.

## Features

- **Model Router** sidebar panel: reads the official configured model catalog, estimates task complexity and cost, recommends routes, and decomposes team tasks into dependent work packages. Planning is local and does not call a model.
- **Official tools** panel: probes Kimi Code, Claude Code, Codex, MiniMax Code, MiMo Code, Grok Build, and ZCode. The first six use fixed npm packages; ZCode downloads a pinned, hash-checked, signed desktop installer and opens its directory picker. Installation state and launch readiness are displayed separately. No arbitrary package or command can be supplied through the panel.
- **Model tools**: `model_router_routes`, `model_router_plan`, `model_router_consult`, `model_router_tools`, `model_router_tool_install`, `model_router_tool_run`, and `model_router_team_execute`. `/router` and `/tools` are also available in sessions.
- **Gal Module** sidebar panel: illustrated, offline story mode with choices and local save slots; free mode can chat through a model configured in the official Models page, stop a pending reply, or copy the opening prompt to an official session. The plugin does not store provider credentials.

`model_router_tool_run` has fixed launch adapters for all seven official tools. Claude Code, Codex, MiMo Code, and Grok Build support read-only and editable modes. Kimi Code, MiniMax Code, and ZCode headless modes auto-handle tool permissions, so the plugin offers them only for approved editable runs in an isolated Git worktree. Every launch is wrapped by the official Harness process sandbox; its Windows ACL backend reports partial file-effect enforcement. Source changes are applied to the original checkout only after the CLI succeeds and the original checkout is still clean. Git-ignored outputs stay in the isolated worktree and make the result `integration-pending`. `model_router_team_execute` routes dependent work packages among ready adapters. Harness model directory IDs are not generally interchangeable with vendor CLI model names: team runs request planned IDs only for Claude Code and Codex, and use the configured CLI default for Kimi, MiniMax, MiMo, Grok, and ZCode. Verify the actual model in vendor run records. The budget is an estimate, not a billing limit.

For an individual `model_router_tool_run`, supply a configured Harness `provider` and `model` route plus `cliModel` when you know the exact name configured in that vendor CLI. MiniMax and MiMo expect `provider/model` for `cliModel`. ZCode 3.14.3 cannot switch models per call.

For team runs, list separate requirements or action sentences in the task to obtain up to six concrete execution work packages. `model_router_team_execute` accepts optional `cliModelsJson`, a JSON object keyed by official tool ID or work package ID; a package binding takes priority. Format example: `{"minimax-code":"minimax/your-configured-model"}`; replace that value with the actual name configured in your MiniMax CLI. The plugin validates name syntax before starting any work package.

The seven adapters are wired against fixed versions, but **0.8.0 has not yet passed real-account Desktop execution checks**. Installation or launch readiness does not prove that credentials work. The official Harness Agent Teams lifecycle remains under Harness control; this plugin's CLI team runner is a separate sequential workflow.

## Install and use

1. Build a local package with `npm run build:client` and `npm pack --pack-destination dist`.
2. Install and enable the `.tgz` in the official Desktop **Plugin Manager**.
3. Configure providers, models, and credentials on the official **Models** page.
4. Open **Model Router** for the catalog, plan, and tool installer; open **Gal Module** for story or free mode.
5. In an official session, use `model_router_consult` for a live second opinion, `model_router_tool_run` for one supported CLI, or `model_router_team_execute` for sequential work packages. Editable CLI work needs a clean Git repository and the Host tool approval.

Do not edit the DeepSeek Harness installation or `app.asar`. Update this plugin through Plugin Manager. See [installation details](INSTALLATION_GUIDE.zh.md) and [migration notes](MIGRATION.md).

## Development

```powershell
pnpm install --frozen-lockfile
npm run build:client
npm pack --pack-destination dist
```

Publishing to npm and GitHub is deferred until the plugin and required real-account flows are verified. The [project task report](PROJECT-TASK-REPORT-2026-09-28.md) tracks completed work, file roles, verification steps, and remaining tasks.
