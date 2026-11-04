# Model Router · DS Bot（DeepSeek Harness 插件）

[English](README.md) · [简体中文](README.zh.md)

[![npm 版本](https://flat.badgen.net/npm/v/@ljwei-stak/dsh-model-router)](https://www.npmjs.com/package/@ljwei-stak/dsh-model-router) [![已收录于 DSH 插件目录](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/alice-marx/dsh-model-router) [![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

一个插件，把 DeepSeek Harness 变成一支 Bot 团队：路由、预算、官方 CLI、远程电脑与监管工作台，
全部挂在你已经运行的 Harness 里，只挂载一次。

它不是第二个应用：没有额外的 agent 循环、没有独立的会话库、没有另一套界面外壳。每个 Bot 继续使用
自己的 DSH Session、记忆与界面，插件只在这些之外补上授权、记账与控制。

- **包名**：`@ljwei-stak/dsh-model-router`
- **版本**：0.27.1
- **宿主**：DeepSeek Harness Desktop 0.2.1-rc.4 / 0.2.1-rc.5
- **文档、验证报告与完整历史**：[GitLab 归档仓](https://gitlab.com/Alice_marx/dsh-model-router)

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

开发、测试与打包说明见 [GitLab 归档仓](https://gitlab.com/Alice_marx/dsh-model-router)，各版本的
验证报告也在那里。

## 许可

MIT
