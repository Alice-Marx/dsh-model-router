# Model Router · DS Bot（DeepSeek Harness 插件）

[English](README.md) · [简体中文](README.zh.md)

[![npm version](https://flat.badgen.net/npm/v/@ljwei-stak/dsh-model-router)](https://www.npmjs.com/package/@ljwei-stak/dsh-model-router) [![dshfind](https://dshfind.com/api/badge/Alice-Marx/dsh-model-router?lang=en)](https://dshfind.com/en/plugins/Alice-Marx/dsh-model-router?ref=badge) [![dshfind](https://dshfind.com/api/badge/Alice-Marx/dsh-model-router?metric=downloads&lang=en)](https://dshfind.com/en/plugins/Alice-Marx/dsh-model-router?ref=badge) [![Listed in the DSH plugin directory](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/alice-marx/dsh-model-router) [![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[![dshfind](https://dshfind.com/api/card/Alice-Marx/dsh-model-router?lang=en)](https://dshfind.com/en/plugins/Alice-Marx/dsh-model-router?ref=badge)

只想看发布说明？点 **Watch → Custom → Releases**（不必 Watching 全部动态）。

一个插件，把 DeepSeek Harness 变成一支 Bot 团队：路由、预算、官方 CLI、远程电脑与监管工作台，
全部挂在你已经运行的 Harness 里，只挂载一次。

它不是第二个应用：没有额外的 agent 循环、没有独立的会话库、没有另一套界面外壳。每个 Bot 继续使用
自己的 DSH Session、记忆与界面，插件只在这些之外补上授权、记账与控制。

- **包名**：`@ljwei-stak/dsh-model-router`
- **版本**：0.27.1
- **宿主**：DeepSeek Harness Desktop 0.2.1-rc.4 / 0.2.1-rc.5

## 安装

**Harness Desktop → 插件 → 添加插件**，填入精确版本：

```
@ljwei-stak/dsh-model-router@0.27.1
```

升级会保留 Bot 配置、凭据、会话历史、预算与操作账本。插件自带的「检查更新」跟随 `latest`；
预发布版走 `preview` 标签。

## 你会得到什么

### 一支 Bot 团队，跑在唯一一套任务系统上

每个 Bot 都是持久身份，拥有自己的 DSH Session、工具、机器与模型绑定。工作被拆成工作包，按依赖排序，
再以并发上限、评审、取消、改派与恢复执行。任务、执行尝试、预算预占与收据都存在同一份事务账本里，
所以重试的步骤不会执行两次，也不会重复计费。

### 模型与工具权限按 Bot 绑定

Bot 的授权由已提交的宿主状态编译而来 —— 不来自模型参数，也不来自角色文本。同一个模型可以服务多个
Bot，各自保持独立身份。绑定的模型不可用时，Bot 会带着明确原因暂停，而不是悄悄换一条路线。官方 CLI
执行会同时记录**请求模型**与 CLI **实际回报的模型**；一旦报告了改道，这一步直接判失败，不会默默接受。

### 官方工具，含 dsh-TUI

十三个注册表条目，安装方式固定（npm、pnpm、厂商脚本、经校验的发行包）：Kimi Code、Claude Code、
Codex CLI、MiniMax Code、MiMo Code、Grok Build、Gemini CLI、OpenCode、Step Code、Pi、Hermes
Agent、ZCode CLI，以及 **dsh-TUI** —— DeepSeek 的终端界面，DeepSeek 供应商把它认作自己的工具。
探测、版本、登录状态与终端启动都来自同一张注册表；任何安装都不会使用模型给出的 URL 或命令。

Codex 以一等子任务（`cli/codex`）进入任务系统。Claude 的只读步骤保留它正常的读取工具，由宿主证明
它没有改动任何文件 —— 一旦动了工作区，这一步以 `READ_ONLY_RUN_CHANGED_WORKSPACE` 失败，而不是被
当作"读取成功"。

### 远程电脑，以及它的桌面

在目标机器上运行 `remote-computer-agent` 并配对，就得到文件系统根目录、`shell_exec`、产物下载，
以及每次调用的持久操作记录。模型侧的远程工具与人类工作台共用同一条授权路径：模型永远不提供端点、
可执行路径、任务号或操作号。

**电脑操作**（0.27.0）让你看一帧桌面画面并在这一帧上操作。取帧与动作是两个独立的 owner 调用；每个
动作必须带上"人真正看到的那一帧"的编号（一次性、15 秒），点击坐标会换算回原图像素，每个动作都以
所选 Bot 的身份、在同一台机器的 ceiling 下执行，并记为一次操作。

### 先回答"现在需要我吗"的工作台

- **需要你处理** —— 从已提交状态推导：预算暂停、中断未核验的费用、体检失败、执行失败、需要登录的
  工具、未确认的远程效果。健康时什么都不渲染。
- **演练（dry run）** —— 完整规划并计价，列出每个工作包**本应**调用什么，但什么都不调用。
- **两本账** —— API 费用（已结算、预占、上限、未知单价）与订阅额度（调用次数、已报告 token）分成
  两本账，永远不相加。
- **终端** —— PowerShell／系统 shell 与注册表里的 CLI，实时输出、多会话。

### 会说清理由的路由

省钱优先／均衡／效果优先三种方案，可按工作包指定确切模型，可手动改派，带历史 P90 估计、依赖感知
搜索与质量证据。执行前先给出预览：工作包、权限、需要的确认与预估费用；真正启动时宿主会重新校验计划。

## 第一次使用

1. 在 Harness 的**模型**页添加一条模型路线，然后在**Bot 绑定**里绑定给某个 Bot。
2. 打开**模型路由工作台**，看**需要你处理** —— 没有真正需要你的事时它是空的。
3. 安装你要用的官方工具；每张卡片会先显示实际执行命令与目标目录。
4. 要用远程电脑，就在那台机器上安装 `remote-computer-agent`，用 Bot／根目录／工具组成 ceiling 配对，
   再把配对凭据保存为宿主专用秘密。
5. 给 Bot 授予它该有的远程工具。缺少某个工具的 Bot 会带着明确原因失败，而不是回退到别的东西。

## 远程电脑使用教程

这一节把"让某个 Bot 用上一台真电脑"从头走一遍：目标机器装 Agent → 配对 → 只授予该做的事 →
在聊天或工作台里使用。

### 1. 三个部分怎么配合

```
你的机器（DSH 宿主）                目标机器（Agent）                  某个 Bot
┌──────────────────────┐   授权票   ┌─────────────────────────┐   工具   ┌──────────────┐
│ 机器目录 / ceiling    │ ────────► │ <agent-host>:9701 /mcp      │ ◄─────── │ session-…    │
│ 宿主专用凭据 secretRef│           │ 根目录、ceiling、操作账本 │  调用    │ 授权 grant   │
└──────────────────────┘           └─────────────────────────┘          └──────────────┘
```

- **Agent** 跑在目标机器上，拥有文件系统根目录、操作账本和所有副作用。
- **宿主**（你的 Harness）保存这台机器的配对凭据，每次调用签发一张短期票，并持有 Bot 的授权。
- **Bot** 只能使用"它自己的授权"和"机器 ceiling"同时允许的工具。模型永远不提供端点、路径或任务号。

### 2. 准备目标机器

| 要求 | 说明 |
| --- | --- |
| 系统 | Windows 10/11（x64）或 Linux（x64/arm64）。桌面相关工具仅 Windows。 |
| Node.js | **22.19 或更高**（推荐 24.x）。用 `node -v` 确认。 |
| 账号 | 普通账号即可，但建议用专用低权账号。想用桌面控制就不要把它装成 Session 0 的服务。 |
| 网络 | 宿主能访问：WireGuard/Tailscale 内网地址，或 HTTPS。内网 IP 本身不代表可信，需要你显式声明隧道。 |
| 磁盘 | 为每个要暴露的根目录准备一个工作目录，例如 `D:\workspaces\project`。 |

### 3. 安装 Agent

**Windows**

```powershell
powershell -File deploy/remote-agent/install-windows.ps1 `
  -SourceRoot . -Prefix D:\dsh-agent -AuthorizedRoot D:\workspaces\project
```

**Linux**

```sh
sh deploy/remote-agent/install-linux.sh ./source ./dsh-agent /srv/workspaces/project
```

安装器会把 Agent 复制到带版本号的目录，执行 `npm ci` 与构建，然后初始化 `config.json`。
它**不会**改动 Node、防火墙、VPN 或任何系统服务。

目标机器上没有源码？把 Agent 目录（`package.json`、`package-lock.json`、`build.mjs`、`src/`）
复制过去，自行执行 `npm ci && npm run build`，再运行
`node dist/cli.mjs init <config.json> <授权根目录>`。

### 4. 配置 `config.json`

```json
{
  "dataDir": "D:\\dsh-agent\\data",
  "roots": { "project": "D:\\workspaces\\project" },
  "isolation": "application",
  "network": {
    "mode": "wireguard",
    "host": "<agent-host>",
    "port": 9701,
    "protectedTunnel": true,
    "allowedHosts": ["<agent-host>:9701"]
  },
  "executables": { "node": "D:\\Program Files\\nodejs\\node.exe" },
  "windowsJobRunner": "D:\\dsh-agent\\native\\dsh-process-job.exe",
  "desktop": {
    "pipeName": "dsh-desktop-<host>",
    "secretFile": "D:\\dsh-agent\\desktop.secret"
  },
  "browserOrigins": []
}
```

| 字段 | 含义 |
| --- | --- |
| `roots` | Agent 可触碰的根目录 id。工具收到的路径都相对于其中之一；穿越、ADS、符号链接逃逸都会被拒。 |
| `network.mode` | `loopback`（默认）、`wireguard`、`tailscale`、`cloudflare-tunnel`、`public-tls`。 |
| `network.host` | 必须是**该机器上真实存在**的地址（绑定网卡）。通配地址会被拒。 |
| `network.protectedTunnel` | 你显式声明"该地址只能经私有隧道访问"。非环回地址走明文 HTTP 时必须为 true。 |
| `network.allowedHosts` | 允许出现在 `Host` 头里的精确 `host:port`。 |
| `windowsJobRunner` | Job Object 启动器。Windows 上没有它，`shell_exec` 会明确失败，而不是假装隔离。 |
| `desktop` | 桌面助手的管道名与密钥。没有它，五个 `desktop_*` 工具不会暴露。 |

### 5. 与宿主配对

先写 ceiling —— 任何客户端最多能要到的东西：

```json
{
  "botIds": ["<bot-session-id>"],
  "roots": ["project"],
  "tools": ["machine_ping", "fs_list", "fs_read", "fs_write", "shell_exec",
            "operation_status", "operation_cancel", "artifact_stat", "artifact_read",
            "desktop_screenshot", "desktop_click", "desktop_type", "desktop_key", "desktop_scroll"]
}
```

```bash
node dist/cli.mjs pair config.json host-office-pc ceiling.json
```

它会**只显示一次**几个值：

```json
{ "clientId": "host-office-pc",
  "token": "……43 位……",
  "machineId": "machine-…",
  "secretRef": "remote-agent/machine-…/host-office-pc" }
```

- `token` 只放进**宿主专用秘密**，别的地方都不要放：不要贴进聊天、配置文件、模型参数或 URL。
- `machineId` 是这台机器在宿主目录里的身份。
- 同一个 id 再次 `pair` 会按设计失败；要换 token 用 `rotate`，要停用用 `revoke`。

### 6. 让 Agent 常驻

**Windows** —— 放进交互会话里跑，桌面助手才能挂上：

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

**Linux** —— 用 `deploy/remote-agent/remote-agent.service.example` 作模板。

从宿主侧验证：`curl -i http://<agent-host>:9701/mcp` 必须是 **401**（活着且要鉴权），
既不是 200，也不是连接被拒。

### 7. 在工作台登记这台机器

**远程电脑 → 添加或重新配对电脑**，顺序很重要：

1. **保存宿主专用凭据** —— 名称用 `REMOTE_AGENT_OFFICE_PC`（大写字母、数字、下划线），
   粘贴 43 位的 token。结果会得到 `ds-secret/REMOTE_AGENT_OFFICE_PC`。
2. **配对表单**：
   - 电脑名称：随便起一个好认的，例如 `office-pc · Win11`
   - Agent machineId：`pair` 打印的那个 `machineId`
   - Agent 地址：`http://<agent-host>:9701`
   - 凭据 secretRef：`ds-secret/REMOTE_AGENT_OFFICE_PC`
   - 已配对根目录 ID：`project`
   - 用于核验的 Bot：这台机器归属的 Bot
   - ☑ 受保护隧道 —— 私有地址走明文 HTTP 必须勾
3. 点 **核验并配对**，再去 **官方工具 · 体检 → 重新体检**，列表里应出现这台机器。

### 8. 给 Bot 授权

机器绑定说明"这台机器能提供什么"，Bot 授权说明"这个 Bot 能用到什么"。**两者都包含**某个工具，
调用才会成功。

| 工具 | 作用 | 备注 |
| --- | --- | --- |
| `machine_ping` | Agent 健康、系统、能力 | 安全默认项 |
| `fs_list` / `fs_read` | 在根目录内列目录与读文件 | 只读 |
| `fs_write` | 带 `expectedHash` 的原子写入 | 会改文件；`null` 表示只新建 |
| `shell_exec` | 固定可执行 id 或允许的解释器，只能传 argv | Windows 需要 `windowsJobRunner` |
| `cli_probe_v1` / `cli_task_v1` | 带版本的容器/CLI 后端 | 只有存在容器配置时可用 |
| `operation_status` / `operation_cancel` | 对账或停止一次操作 | 停止请求不是停止确认 |
| `artifact_stat` / `artifact_read` | 读取有上限的产物 | 大输出落在这里 |
| `worktree_create` / `worktree_diff` / `worktree_integrate` | 隔离 Git 工作树与补丁整合 | 目标机要装 Git |
| `browser_*` | 带允许来源的 Playwright 上下文 | 浏览器是否存在靠探测，不靠假设 |
| `desktop_screenshot` / `desktop_click` / `desktop_type` / `desktop_key` / `desktop_scroll` | 交互桌面 | 需要交互会话里的桌面助手 |

从最小开始：`machine_ping` + `fs_list` + `fs_read`。确实需要时再加 `fs_write` 与 `shell_exec`，
并且只给一个 Bot，不要给 Main。

### 9. 实际使用

聊天里直接说：「读一下 `project/README.md`」「把测试跑一遍」「打开内部 wiki 总结一下」。
Bot 会挑工具，宿主为这一次调用签发授权，过程进记录。

工作台里：

- **远程电脑 → 电脑操作**：选机器和 Bot，点 **截取当前画面**，然后点画面（就是真的点击），
  或者用按键行、文本框、滚轮按钮。每个动作都绑定它来自的那一帧编号；帧过期就重新截一帧。
- **任务 / 运行记录**：每次调用都有操作号、状态与产物。未知结果在那里对账，绝不盲目重放。

### 10. 排错

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `401` / `AUTH_INVALID` | token 不对、过期或被截断 | 用 `rotate` 重新签发，粘贴完整 43 位 |
| `TLS_REQUIRED` | 私有地址走明文 HTTP 但没声明隧道 | 勾选 **受保护隧道** 后重新配对 |
| `BIND_INTERFACE_NOT_FOUND` | `network.host` 不是该机器上的地址 | 用 `ipconfig` / `ip addr` 显示的隧道 IP |
| 连接被拒 | Agent 没跑，或绑在别的地址 | 看 `netstat`，必须监听在那个精确地址 |
| `MACHINE_BOT_DENIED` | Bot 授权或机器 ceiling 缺工具/根目录 | 两边都补上，再保存绑定 |
| `MACHINE_GRANT_CHANGED` | 调用途中 ceiling 变了 | 重新执行一次，新修订生效 |
| `INVALID_MACHINE_SECRET` | 秘密名称或 token 形状不对 | `REMOTE_AGENT_*` + 43 位 token |
| `OPERATION_CONFLICT` | 同一操作号配了不同请求 | 用新的操作号，不要复用 |
| `FRAME_UNAVAILABLE` | 桌面助手没跑、会话锁屏、UAC 安全桌面 | 解锁机器，重启 `dsh-desktop-helper` |
| `OUTCOME_UNKNOWN` | 操作中途进程退出 | 用 `operation_status` 对账，不要重放 |

### 11. 运维

- **换 token**：`node dist/cli.mjs rotate config.json <clientId>`，然后更新宿主秘密。
- **停用**：`node dist/cli.mjs revoke config.json <clientId>`，然后在工作台归档这台机器。
- **升级**：停 Agent → 对账未完成操作 → 备份 `data/` 与 `config.json` → 新版本装到并列目录 →
  启动器指向新版本 → 启动。
- **卸载**：停任务 → 删版本目录 → 只有在撤销配对之后，才删配置与数据。

### 12. Agent 不承诺什么

根目录是**应用层边界**，不是操作系统沙箱：给了 shell 就等于给了该账号本身的权限。要真正的边界，
请用专用系统账号或容器配置。桌面控制需要未锁屏的交互会话，而且一帧截图不是视频流。

## 一屏看懂安全模型

- **授权只来自已提交的宿主状态。** 模型参数不携带工具、机器、凭据、端点或任务身份。
- **未知既不是零，也不是成功。** 缺单价的调用保持未知，未确认的远程效果保持未知，只有对账能解决。
- **停止请求不等于停止确认。** 停止请求会被记录；远程操作只有在拿到自己的收据后，才算已停止。
- **每个远程动作都是一次操作。** 重复的操作号返回原结果；改了请求却沿用旧操作号会被拒绝。
- **只读是被证明的。** 只读的 CLI 步骤若改动了工作区，即判失败。

## 兼容性与边界

已验证：包能在 0.2.1-rc.4 与 rc.5 上安装并启动；桌面应用与打包构建通过；测试套件离线通过；远程
Agent 的操作在真实机器上经 WireGuard 实测过。

未声称：每个 CLI 工具的厂商侧验收、桌面控制的多显示器／DPI 矩阵、macOS 上的安装与卸载验收。能力
未经核验时，界面会直接说明，而不是暗示支持。

## 仓库结构

```
.dsh-plugin/               宿主插件：授权、工具、工作台 RPC、客户端 bundle
modules/bot-runtime/       Bot 运行时（由 ds-bot 同步而来）与其策略作用域
packages/                  编排、能力代理、资金、任务、远程执行
apps/integration-client/   渲染在 Harness 侧栏里的产品面板
remote-computer-agent/     机器侧 Agent（MCP 传输、操作账本）
native/                    Windows 桌面与进程 Job 助手
```

验证报告也在那里。

## 许可

MIT
