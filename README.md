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

## Remote computer tutorial

This walks through giving a Bot a real computer: install the agent on that machine, pair it, grant
exactly what the Bot may do, then use it from chat or from the workbench.

### 1. How the three parts fit

```
your machine (DSH Host)            the target machine (Agent)          the Bot
┌──────────────────────┐   grant   ┌─────────────────────────┐   tools  ┌──────────────┐
│ machine catalog      │ ────────► │ 10.0.0.2:9701 /mcp      │ ◄─────── │ session-…    │
│ ceiling, secretRef   │  ticket   │ roots, ceiling, ledger  │  call    │ grant        │
└──────────────────────┘           └─────────────────────────┘          └──────────────┘
```

- The **Agent** runs on the target machine and owns the filesystem roots, the operation ledger and
  every side effect.
- The **Host** (your Harness) stores the machine's pairing secret, issues a short-lived grant per
  call, and keeps the Bot's authority.
- The **Bot** may only use tools that both its own grant and the machine ceiling allow. A model
  never supplies an endpoint, path or task id.

### 2. Prepare the machine

| Requirement | Detail |
| --- | --- |
| OS | Windows 10/11 (x64) or Linux (x64/arm64). Desktop tools are Windows-only. |
| Node.js | **22.19 or newer** (24.x recommended). Check with `node -v`. |
| Account | A normal account is enough; a dedicated low-privilege account is better. Do not run it as a Session 0 service if you want desktop control. |
| Network | Reachable from your Harness: a WireGuard/Tailscale private address, or HTTPS. A private IP is not trusted by itself — you attest the tunnel. |
| Disk | A workspace directory for each root you expose, e.g. `D:\dsh-workspaces\project`. |

### 3. Install the agent

**Windows**

```powershell
powershell -File deploy/remote-agent/install-windows.ps1 `
  -SourceRoot . -Prefix D:\dsh-agent -AuthorizedRoot D:\dsh-workspaces\project
```

**Linux**

```sh
sh deploy/remote-agent/install-linux.sh ./source ./dsh-agent /srv/dsh-workspaces/project
```

The installer copies the agent into a versioned directory, runs `npm ci` and the build, then
initializes `config.json`. It does **not** touch Node, the firewall, the VPN or any service.

No checkout on the target? Copy the agent folder (`package.json`, `package-lock.json`, `build.mjs`,
`src/`), run `npm ci && npm run build`, then
`node dist/cli.mjs init <config.json> <authorized-root>`.

### 4. Configure `config.json`

```json
{
  "dataDir": "D:\\dsh-agent\\data",
  "roots": { "project": "D:\\dsh-workspaces\\project" },
  "isolation": "application",
  "network": {
    "mode": "wireguard",
    "host": "10.0.0.2",
    "port": 9701,
    "protectedTunnel": true,
    "allowedHosts": ["10.0.0.2:9701"]
  },
  "executables": { "node": "D:\\Program Files\\nodejs\\node.exe" },
  "windowsJobRunner": "D:\\dsh-agent\\native\\dsh-process-job.exe",
  "desktop": {
    "pipeName": "dsh-desktop-10-0-0-2",
    "secretFile": "D:\\dsh-agent\\desktop.secret"
  },
  "browserOrigins": []
}
```

| Field | Meaning |
| --- | --- |
| `roots` | Root ids the agent may touch. Tool paths are relative to one of them; traversal, ADS and symlink escapes are rejected. |
| `network.mode` | `loopback` (default), `wireguard`, `tailscale`, `cloudflare-tunnel`, `public-tls`. |
| `network.host` | Must be an address that **exists on that machine** (bind interface). Wildcards are rejected. |
| `network.protectedTunnel` | Your explicit attestation that the address is reachable only over a private tunnel. Required for plain HTTP on a non-loopback address. |
| `network.allowedHosts` | Exact `host:port` accepted in the `Host` header. |
| `windowsJobRunner` | Job Object launcher. Without it Windows `shell_exec` fails explicitly instead of pretending to isolate. |
| `desktop` | Pipe name and secret for the interactive desktop helper. Without it the five `desktop_*` tools are not exposed. |

### 5. Pair the Host

Write a ceiling — the most any client may ever ask for:

```json
{
  "botIds": ["session-a57565e5-64a8-473b-b529-3da6e98fd359"],
  "roots": ["project"],
  "tools": ["machine_ping", "fs_list", "fs_read", "fs_write", "shell_exec",
            "operation_status", "operation_cancel", "artifact_stat", "artifact_read",
            "desktop_screenshot", "desktop_click", "desktop_type", "desktop_key", "desktop_scroll"]
}
```

```bash
node dist/cli.mjs pair config.json host-office-pc ceiling.json
```

It prints three values **once**:

```json
{ "clientId": "host-office-pc",
  "token": "…43 characters…",
  "machineId": "machine-…",
  "secretRef": "remote-agent/machine-…/host-office-pc" }
```

- `token` goes into a **Host-only secret** and nowhere else. Never paste it into a chat, a config
  file, a model argument or a URL.
- `machineId` identifies the machine in the Host catalog.
- Re-running `pair` with an existing id fails by design; use `rotate` to reissue, `revoke` to
  disable.

### 6. Keep the agent running

**Windows** — run it in the interactive session so the desktop helper can attach:

```bat
@echo off
cd /d D:\dsh-agent
"D:\Program Files\nodejs\node.exe" dist\cli.mjs serve D:\dsh-agent\config.json >> D:\dsh-agent\agent.log 2>&1
```

```bat
schtasks /create /f /tn dsh-remote-agent /tr D:\dsh-agent\start.cmd /sc onlogon /it
schtasks /run /tn dsh-remote-agent
netsh advfirewall firewall add rule name=dsh-remote-agent dir=in action=allow ^
  protocol=TCP localport=9701 remoteip=10.0.0.0/24
```

**Linux** — use `deploy/remote-agent/remote-agent.service.example` as the template.

Check from the Host side: `curl -i http://10.0.0.2:9701/mcp` must answer **401** (alive and
authenticated), never 200 and never a connection refusal.

### 7. Register the machine in the workbench

**远程电脑 → 添加或重新配对电脑**, in this order:

1. **保存宿主专用凭据** — name it `REMOTE_AGENT_OFFICE_PC` (uppercase letters, digits, underscores)
   and paste the 43-character token. The result is `ds-secret/REMOTE_AGENT_OFFICE_PC`.
2. **Pairing form**:
   - 电脑名称: anything readable, e.g. `office-pc · Win11`
   - Agent machineId: the `machineId` printed by `pair`
   - Agent 地址: `http://10.0.0.2:9701`
   - 凭据 secretRef: `ds-secret/REMOTE_AGENT_OFFICE_PC`
   - 已配对根目录 ID: `project`
   - 用于核验的 Bot: the Bot that will own this machine
   - ☑ 受保护隧道 — required for plain HTTP on a private address
3. Click **核验并配对**, then **官方工具 · 体检 → 重新体检**; the machine should be listed.

### 8. Grant the Bot its tools

A machine binding lists what the machine offers; the Bot's own grant lists what that Bot may use.
Both must contain a tool before a call succeeds.

| Tool | Does | Notes |
| --- | --- | --- |
| `machine_ping` | Agent health, OS, capabilities | Safe default |
| `fs_list` / `fs_read` | List and read inside a root | Read-only |
| `fs_write` | Atomic write with `expectedHash` | Mutating; `null` means create-only |
| `shell_exec` | Fixed executable id or allowed interpreter, argv only | Needs `windowsJobRunner` on Windows |
| `cli_probe_v1` / `cli_task_v1` | Versioned container/CLI backends | Only when a container profile exists |
| `operation_status` / `operation_cancel` | Reconcile or stop an operation | A stop is not a confirmation |
| `artifact_stat` / `artifact_read` | Read bounded output artifacts | Large output lands here |
| `worktree_create` / `worktree_diff` / `worktree_integrate` | Isolated Git worktree and patch integration | Requires Git on the target |
| `browser_*` | Playwright contexts with allowed origins | Browser presence is probed, not assumed |
| `desktop_screenshot` / `desktop_click` / `desktop_type` / `desktop_key` / `desktop_scroll` | Interactive desktop | Needs the helper in the interactive session |

Start narrow: `machine_ping` + `fs_list` + `fs_read`. Add `fs_write` and `shell_exec` only when the
job needs them, and give them to one Bot rather than to Main.

### 9. Use it

From chat, ask the Bot directly: "read `project/README.md`", "run the tests", "open the internal wiki
and summarise it". The Bot picks a tool, the Host issues a grant for that one call, and the record
is kept.

From the workbench:

- **远程电脑 → 电脑操作**: pick the machine and the Bot, click **截取当前画面**, then click the
  picture (that is a real click), or use the key row, the text box and the scroll buttons. Every
  action is stamped with the frame id it came from; if the frame expired, take another one.
- **任务 / 运行记录**: each call shows its operation id, status and artifact. Unknown outcomes are
  reconciled there and never retried blindly.

### 10. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `401` / `AUTH_INVALID` | Wrong, old or truncated token | Reissue with `rotate`, paste all 43 characters |
| `TLS_REQUIRED` | Plain HTTP on a private address without attestation | Tick **受保护隧道** and re-pair |
| `BIND_INTERFACE_NOT_FOUND` | `network.host` is not an address on that machine | Use the IP `ipconfig` / `ip addr` shows for the tunnel |
| Connection refused | Agent not running, or bound elsewhere | Check `netstat`; it must listen on the exact address |
| `MACHINE_BOT_DENIED` | Bot grant or machine ceiling lacks the tool or root | Add it to both, re-save the binding |
| `MACHINE_GRANT_CHANGED` | Ceiling changed mid-call | Re-run the action; the new revision applies |
| `INVALID_MACHINE_SECRET` | Secret name or token shape is wrong | `REMOTE_AGENT_*` plus a 43-character token |
| `OPERATION_CONFLICT` | Same operation id with a different request | Use a new operation; never reuse ids |
| `FRAME_UNAVAILABLE` | Desktop helper not running, session locked, or UAC secure desktop | Unlock the machine, restart `dsh-desktop-helper` |
| `OUTCOME_UNKNOWN` | Process died mid-operation | Reconcile with `operation_status`; do not replay |

### 11. Operate it

- **Rotate**: `node dist/cli.mjs rotate config.json <clientId>`, then update the Host secret.
- **Revoke**: `node dist/cli.mjs revoke config.json <clientId>`, then archive the machine.
- **Upgrade**: stop the agent, reconcile active operations, back up `data/` and `config.json`, install
  the new version alongside, point the launcher at it, start again.
- **Uninstall**: stop tasks, remove the version directory, and delete config and data only after the
  pairing is revoked.

### 12. What the agent does not promise

Roots are an application-level boundary, not an OS sandbox: a shell grant carries the account's own
permissions. For a real boundary use a dedicated OS account or a container profile. Desktop control
needs an unlocked interactive session, and one screenshot is not a video stream.

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
