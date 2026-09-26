# Model Router for DeepSeek Harness

A model-routing plugin for the official **DeepSeek Harness Desktop 0.1.7-rc.2**.

Repository: [Alice-Marx/model-router-galgame](https://github.com/Alice-Marx/model-router-galgame)
The npm package remains `@ljwei-stak/model-router-galgame` to preserve continuity for existing installations.

## What it provides

The plugin reads routes registered in the official DeepSeek Harness model directory. It does not store API keys or create a second provider configuration system. A listed route still needs working credentials and network access for a live call.

The 0.5.1 desktop workspace is designed to appear as **Model Router** in the official sidebar. It shows the configured model catalog, a local route recommendation for a task, and optional Agent Teams work packages. Catalog display and planning do not make a model request. The package's budget and consultation-output settings belong on its detail page in **Plugin Manager**. This 0.5.1 UI path still needs validation in the installed desktop app.

| Tool | Purpose |
| --- | --- |
| `model_router_routes` | Lists routes registered in the official model directory. |
| `model_router_plan` | Recommends a route for a task and can produce work packages for Agent Teams. |
| `model_router_consult` | Sends one independent consultation to a configured alternative model. |

Configure providers, models, and credentials on the official **Models** page before using these tools.

## Agent Teams

The official DeepSeek Harness **Agent Teams** feature owns team lifecycle operations. The router can propose work packages and model choices, while the official tools and UI create teammates, exchange messages, wait for results, and stop teammates.

## Routing behavior

The 0.5.1 design does not automatically replace the model selected for the main session. Inspect a local recommendation in the Model Router workspace or use `model_router_plan` from an agent session. When a second model's opinion is useful, ask the agent to use `model_router_consult`; consultation is an agent tool, not a button that runs automatically when the workspace opens. The user chooses the main-session model in the official interface.

## Install

Install through the official DeepSeek Harness Desktop **Plugin Manager**:

1. Obtain a local `.tgz` package or prepare a local checkout.
2. Add the local directory or `.tgz` from Plugin Manager and enable the plugin there.
3. Configure providers, models, and API keys on the official **Models** page.
4. Open **Model Router** in the sidebar to inspect models, plan a task, and view optional team work packages.
5. Open this package's detail page in **Plugin Manager** to adjust the local planning budget and consultation-output limit.
6. Use `model_router_consult` through an agent session for a live cross-model consultation.

Do not edit the installed DeepSeek Harness application, its `app.asar`, or bundled desktop files. Install, enable, update, and remove the plugin through Plugin Manager.

See the Chinese [installation guide](INSTALLATION_GUIDE.zh.md) and [migration guide](MIGRATION.md) for details.

## Archived legacy integration

The former GAL interface, automatic-update flow, and integration for the earlier desktop target are archived. They are not part of the official DeepSeek Harness Desktop runtime path.

## Development

```powershell
pnpm install --frozen-lockfile
npm run build:client
npm test
npm pack --pack-destination dist
```

Install the resulting `.tgz` through the official Plugin Manager.
