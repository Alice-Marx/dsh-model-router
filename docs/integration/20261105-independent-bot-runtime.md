# 独立 Bot 运行时：会话库与 agent 循环（起步）

2026-11-05 用户决定（选项 A）：产品要自带**独立的 agent 循环**与**独立的会话库**，不再只依赖
Harness 的 Session 服务。这推翻了此前 `AGENTS.md` 里"不得再挂第二个 agent 循环"的约束——该约束
需要随本次工作一起改写，并把旧的集成路径降级为**可选适配器**，而不是唯一实现。

本文只记录第一批落地与后续顺序。已实现的代码是可运行、有测试的，不是占位：

## 已落地（0.28.0）

### `packages/orchestration/src/bot-session-store.mjs`

Bot 自己拥有的会话库。**不依赖 Harness**，只依赖一个目录。

- 每个 Bot 一个文件，写入用「临时文件 + rename」，崩溃不会留下半个回合
- 有界：单条消息 200k 字符、单会话消息条数可配（≤2000），超限从最旧的丢并置 `truncated`
- 版本化：读到更新的 `schemaVersion` 直接拒绝（`BOT_SESSION_SCHEMA_NEWER`），不做猜测性兼容
- API：`get` / `append(turn?)` / `remove` / `list`（列表只返回计数，不返回消息体）

### `packages/orchestration/src/bot-loop.mjs`

Bot 自己的 agent 循环。provider 与工具分发都是注入的，所以测试能跑完一整轮而不需要网络或宿主。

- 一轮 = 用户输入 → provider → （有工具调用就执行并写回）→ 直到回答 / 取消 / 步数上限
- 上限：`maxSteps` 默认 12、单次最多 8 个工具调用；超限报 `BOT_LOOP_STEP_LIMIT`
- 失败都是显式的：`BOT_LOOP_CANCELLED`、`BOT_LOOP_TOOLS_UNAVAILABLE`、
  `BOT_LOOP_TOOL_CALL_INVALID`、`BOT_LOOP_INPUT_REQUIRED`
- 每轮结束把 `turns` 加一，回答与工具结果都进同一个会话库

### 测试

`tests/bot-runtime-independent.test.mjs` 8 项：会话归属、schema 拒绝、截断标记、单轮回答、
工具往返、取消/缺工具/步数上限、非法工具调用不触达工具、`parseSession` 只保留已知字段。

## 与现有集成的关系（重要）

新运行时是**增量**的：`bot-session-store` 与 `bot-loop` 不会被现有插件挂载，现有 Bot 仍走
Harness Session。两者并存，直到独立运行时具备下面这些能力再切主路径。

## 后续顺序

1. **Provider 适配**：把 MR 的路由与预算接到 `bot-loop` 的 provider 上——每次调用先估价、预占、
   结算，收据写进现有事务账本（不能另起一套账）。
2. **工具桥**：把现有工具目录（远程电脑、官方 CLI、终端）包成 `tools.call`，权限仍由 Bot 授权
   与机器 ceiling 决定，模型不传端点/路径。
3. **记忆与检索**：把 ds-bot 的记忆与长期学习搬到会话库之上，先只读，再写。
4. **界面**：Bot 面板改为读独立会话库；Harness Session 作为可选"镜像"，供习惯原界面的用户使用。
5. **迁移**：一次性把 `state.json` 里的会话索引映射到新库，保留原文件，不做原地覆盖。
6. **约束改写**：`AGENTS.md` 的"唯一 agent 循环"改写为"集成模式下复用 Harness；独立模式使用
   `bot-loop`，二者不得同时为一个 Bot 服务"。

## 风险

- **双写**：切换期若同一 Bot 同时被两条路径服务，会话会出现两个真相。切换必须按 Bot 原子完成，
  且旧路径先置只读。
- **记忆与工具**：`bot-loop` 目前不认识技能、记忆、附件与 MCP；这些是"可用"与"等价"之间的差距。
- **升级**：Harness 升级可能改变 Session 语义；独立运行时反而降低这层耦合，但需要自己承担
  provider 兼容性。
