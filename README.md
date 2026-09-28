# Model Router Galgame for DeepSeek Harness

Desktop plugin for the official **DeepSeek Harness 0.1.7-rc.2**. The current local build is **0.7.0, unpublished**. The npm package name remains `@ljwei-stak/model-router-galgame`.

## Features

- **Model Router** sidebar panel: reads the official configured model catalog, estimates task complexity and cost, recommends routes, and decomposes team tasks into dependent work packages. Planning is local and does not call a model.
- **Official CLI tools** panel: probes six vendor tools and offers one-click npm installation from fixed package/version entries, with progress, cancellation, a fresh version probe, and separate trusted launch-entry readiness. No arbitrary package or command can be supplied through the panel.
- **Model tools**: `model_router_routes`, `model_router_plan`, `model_router_consult`, `model_router_tools`, `model_router_tool_install`, `model_router_tool_run`, and `model_router_team_execute`. `/router` and `/tools` are also available in sessions.
- **Gal Module** sidebar panel: illustrated, offline story mode with choices and local save slots; free mode can chat through a model configured in the official Models page, stop a pending reply, or copy the opening prompt to an official session. The plugin does not store provider credentials.

`model_router_tool_run` can invoke verified **Claude Code** or **Codex** CLI entry points for read-only work. Every launch is wrapped by the official Harness process sandbox; its Windows ACL backend reports partial file-effect enforcement. Editable work runs in an isolated Git worktree and applies its patch to the original checkout only after the CLI succeeds, the original checkout is still clean, and no Git-ignored artifacts would be silently left behind. `model_router_team_execute` chooses among configured routes whose CLI launch entry is actually ready, requests the planned model ID, and runs dependent packages in order. The actual model should be checked in the vendor's run record. Its budget is an estimate, not a billing limit.

All six tools can be installed from the panel. On Windows, Kimi Code, MiniMax Code, MiMo Code, and Grok Build are **not yet supported for unattended task execution** because their permissions, workspace confinement, or machine-readable completion have not been verified for the pinned versions. An installed CLI is therefore distinct from a runnable CLI in the panel and route plan. The official Harness Agent Teams lifecycle remains under Harness control; this plugin's CLI team runner is a separate sequential workflow.

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
