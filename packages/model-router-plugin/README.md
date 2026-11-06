# DSH Model Router

[中文](README.zh.md) | English

[![npm version](https://flat.badgen.net/npm/v/@ljwei-stak/dsh-model-router)](https://www.npmjs.com/package/@ljwei-stak/dsh-model-router)

The model-routing workbench for DeepSeek Harness. This package keeps the standard Harness interface and adds a **Model Router / 模型路由** panel. It does not install DS Bot, Bot chat, the Bot library, routines or remote computers.

For the complete Bot workspace with routing, install **`@ljwei-stak/dsh-model-route-bot`** instead. Choose one edition in a profile; both use the same router configuration ID.

## Install

In Harness **Plugins → Add plugin**, enter `@ljwei-stak/dsh-model-router@0.64.0`. Open **模型路由** from the sidebar. Configure provider credentials and models in the standard Harness **Models** settings.

## Use

1. Describe the goal and expected result. Single-task mode selects one route; team mode plans dependent work packages; direct mode uses the exact model you select.
2. Optionally compare local route suggestions or adjust package assignments. Estimates need prices for the exact configured models.
3. Preview execution. Check the model/tool, workspace, permissions, estimated API charges and subscription usage before confirming. Previewing does not call a model.
4. Confirm execution to start the selected model or supported official tool. Use execution records to inspect results, costs, cancellations and supported retries.

**Models** manages route profiles and pricing. **Official tools** detects, installs and opens supported vendor CLIs; each tool uses its own login. **Budget and safety** contains API limits and separate subscription accounting. Installed or logged-in tools still need to pass the selected execution mode's readiness checks.

Model-route execution is read-only. To edit files, select team mode, official-tool collaboration and the explicit file-edit permission, then review the resulting preview. CLI-native execution uses the current user's permissions; an isolated worktree collects changes and does not restrict access outside it.

Close **需要你处理** with its × button; use **显示待处理提醒** in the header to restore it. The current device remembers this preference.

## Switch editions

To use the complete Bot workspace, remove this package entry in Plugin Manager and add **`@ljwei-stak/dsh-model-route-bot`** in the same Harness profile. Keep the existing data directories and reuse your configured Bot directory. The internal router configuration ID is retained; enable one edition at a time.

## License and reference

[MIT](LICENSE). Current source and the full-edition guide: [GitHub](https://github.com/Alice-Marx/dsh-model-router). [Technical documents and release history](https://gitlab.com/Alice_marx/dsh-model-router).
