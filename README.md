# Model Router · DS Bot for DeepSeek Harness

[English](README.md) · [简体中文](README.zh.md)

[![npm version](https://flat.badgen.net/npm/v/@ljwei-stak/dsh-model-router)](https://www.npmjs.com/package/@ljwei-stak/dsh-model-router) [![Listed in the DSH plugin directory](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/alice-marx/dsh-model-router) [![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

One plugin that turns DeepSeek Harness into a Bot team: routing, budgets, official CLIs, remote
computers and a supervision workbench, mounted once inside the Harness you already run.

It is not a second application. There is no extra agent loop, no separate session store and no
other UI shell: every Bot keeps its own DSH Session, memory and interface, and the plugin adds
authority, accounting and control around them.

- **Package**: `@ljwei-stak/dsh-model-router`
- **Version**: 0.27.1
- **Harness**: DeepSeek Harness Desktop 0.2.1-rc.4 / 0.2.1-rc.5
- **Docs, validation reports and full history**: [GitLab archive](https://gitlab.com/Alice_marx/dsh-model-router)

## Install

**Harness Desktop → Plugins → Add plugin**, then enter the exact version:

```
@ljwei-stak/dsh-model-router@0.27.1
```

Upgrading keeps Bot configuration, credentials, session history, budgets and the operation ledger.
The plugin's own update check follows `latest`; prerelease builds ride the `preview` tag.

## What you get

### Bot team on one task system

Every Bot is a persistent identity with its own DSH Session, tools, machine and model binding. Work
is planned into packages, ordered by dependency, then executed with concurrency limits, review,
cancellation, reassignment and recovery. A task, its attempts, its budget reservation and its
receipt live in one transactional ledger, so a retried step cannot run twice or be billed twice.

### Model and tool authority bound per Bot

A Bot's grant is compiled from committed Host state — never from model arguments or role text. The
same model can serve several Bots that keep separate identities. When a bound model is unavailable
the Bot pauses with a named reason instead of silently switching routes. Official CLI runs record
the **requested** model and the model the CLI **actually reported**; a reported reroute fails the
step instead of being accepted.

### Official tools, including dsh-TUI

Thirteen registry entries with fixed install methods (npm, pnpm, vendor scripts, verified
archives): Kimi Code, Claude Code, Codex CLI, MiniMax Code, MiMo Code, Grok Build, Gemini CLI,
OpenCode, Step Code, Pi, Hermes Agent, ZCode CLI, and **dsh-TUI** — the DeepSeek terminal UI, which
DeepSeek providers name as their tool. Probe, version, login state and terminal launch come from
the same registry; nothing installs from a model-supplied URL or command.

Codex runs as a first-class sub-task (`cli/codex`) inside the task system. Claude's read-only step
keeps its normal reading tools, and the Host proves it changed nothing — a run that touches the
workspace fails with `READ_ONLY_RUN_CHANGED_WORKSPACE` instead of being reported as a successful
read.

### Remote computers, and their desktop

Pair a machine running `remote-computer-agent` to get filesystem roots, `shell_exec`, artifacts and
a durable operation record per call. Model-facing remote tools and the human workbench share one
authorization path: a model never supplies an endpoint, executable path, task id or operation id.

**电脑操作** (0.27.0) watches one desktop frame and acts on it. Frame and action are separate owner
calls; every action carries the id of the frame the person actually saw (single use, 15 s), clicks
map back to frame pixels, and each action runs as the chosen Bot under the same machine ceiling and
is recorded as an operation.

### A workbench that answers the first question first

- **需要你处理** — derived from committed state: a paused budget, interrupted spend, a failed check,
  a failed run, a tool that needs login, an unconfirmed remote effect. Healthy state renders
  nothing.
- **演练 (dry run)** — plan and price a run, list what each package *would* call, call nothing.
- **两本账** — API money (settled, reserved, limits, unknown prices) and subscription quota (calls,
  reported tokens) as two books that are never added together.
- **Terminals** — PowerShell/system shell and the registry CLIs, with live output and sessions.

### Routing that states its reasons

Economy / balanced / quality presets, exact model assignment per package, manual reassignment,
historical P90 estimates, dependency-aware search and quality evidence. A preview shows packages,
permissions, required confirmations and estimated cost before anything runs, and the Host rechecks
the plan at start.

## First run

1. Add a model route in Harness's **Models** page, then bind it to a Bot in **Bot 绑定**.
2. Open **模型路由工作台** and read **需要你处理** — it stays empty until something actually needs you.
3. Install the official tools you use; each card shows the exact command and target directory first.
4. To use a remote machine, install `remote-computer-agent` there, pair it with a ceiling of Bots,
   roots and tools, then save its pairing token as a Host-only secret.
5. Grant the Bot the remote tools it should have. A Bot that lacks a tool fails with a named reason
   instead of falling back to something else.

## Security model in one screen

- **Authority comes from committed Host state.** Model arguments carry no tools, machines,
  credentials, endpoints or task identity.
- **Unknown is neither zero nor success.** Unpriced calls stay unknown, unconfirmed remote effects
  stay unknown, and only reconciliation resolves them.
- **A stop is not a confirmation.** A stop request is recorded; a remote operation counts as stopped
  only with its own receipt.
- **Every remote action is an operation.** Duplicate ids return the original result; a changed
  request with an old id is refused.
- **Read-only is proven.** A read-only CLI step that changes the workspace fails.

## Compatibility and limits

Verified: the package installs and boots on 0.2.1-rc.4 and rc.5; the desktop app and packaged build
pass; the test suites pass offline; remote agent operations were exercised against a real machine
over WireGuard.

Not claimed: real-vendor acceptance for every CLI tool, a multi-monitor or DPI matrix for desktop
control, and installer/uninstaller acceptance on macOS. Where a capability is unverified the
interface says so instead of implying support.

## Repository layout

```
.dsh-plugin/               host plugin: authority, tools, workbench RPC, client bundle
modules/bot-runtime/       the Bot runtime (vendored from ds-bot) and its policy scope
packages/                  orchestration, capability broker, funding, tasks, remote execution
apps/integration-client/   product panels rendered inside the Harness sidebar
remote-computer-agent/     machine-side agent (MCP transport, operation ledger)
native/                    Windows desktop and process-job helpers
```

Development, tests and packaging instructions live in the [GitLab archive](https://gitlab.com/Alice_marx/dsh-model-router),
together with each release's validation report.

## License

MIT
