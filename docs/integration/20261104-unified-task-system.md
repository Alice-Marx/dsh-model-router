# DS Bot × Model Router：统一任务系统的落地对照（2026-11-04）

目标：MR 的路由、预算、官方工具与工作台不再是一套平行系统，而是接进 **同一个任务系统**；
每个 Bot 保留自己的 DSH Session、模型与权限；所有执行都经过授权；既有能力逐项迁入并验收。

本文只做两件事：**说明现在在哪**（带文件锚点）和**下一步做什么**（按依赖排序）。
不做承诺式描述：标 ✅ 的是代码里已经存在并能被测试证明的，标 ⬜ 的是还没有。

---

## 1. 唯一任务系统

| 要求 | 现状 | 锚点 |
| --- | --- | --- |
| 分包、依赖、并发、评审、取消、改派、恢复 | ✅ 已有 `task-service` / `task-contract` / `task-journal` / `task-admission`：计划校验、依赖、并发上限、取消、重试、对账 | `packages/orchestration/src/task-service.mjs`、`task-contract.mjs`、`task-journal.mjs` |
| 任务、执行尝试、预算与收据进事务账本 | ✅ `model-receipt.mjs` 有不可变身份字段与 `state/usage/actualModel/reportedCostUsd/outcome`；`sqlite-router-state.mjs` 提供事务存储 | `packages/orchestration/src/model-receipt.mjs` |
| 防重复执行、重复计费 | ✅ 幂等键 `taskHash` + 原子准入 `atomicAdmission`；预占 `budgetReservations` | `task-contract.mjs`、`funded-router-state.mjs` |
| 工作台执行接入同一任务服务 | ✅ 工作台 `startRun` → `executePreparedWorkbenchRun` → 同一批执行器；演练模式在同一阻塞点短路 | `.dsh-plugin/index.mjs` |
| 官方 CLI 作为**明确子任务**登记 | ⬜ 目前 CLI 调用有收据（`createCliExecution`），但没有以 Task 形式进入 `task-service`，所以依赖/取消/改派不覆盖它 | `packages/orchestration/src/cli-execution.mjs` |

**下一步（1）**：新增 `cli` 后端注册到 `createTaskService({ backends })`，`effect: workspace-write`、`location: local`，
入参只带 `{ toolId, model, prompt }`，命令由 Host 从注册表解析；收据写 `requestedModel` 与 `actualModel` 两列。
验收：同一任务里 CLI 步骤可被取消/重试，且收据能证明"请求模型 ≠ 实际模型"。

---

## 2. 每个 Bot 的模型与权限

| 要求 | 现状 | 锚点 |
| --- | --- | --- |
| 模型与工具按 Bot 绑定 | ✅ `bot-settings` / `bot-policy` / `authority.register(subject,{botId, tools, modelRoutes})` | `packages/orchestration/src/bot-policy.mjs`、`capability-broker/src/authority.mjs` |
| 同模型多角色保持独立身份 | ✅ 主体是 Bot 对象本身，`botId` 唯一；路由只按 `modelRoutes` 放行 | `authority.mjs` `assertModel` |
| 模型不可用时暂停 | ✅ `MODEL_DENIED` 拒绝而不是回落；Bot 绑定变更有 `GRANT_CHANGED` 取消在途租约 | `authority.mjs` |
| CLI 记录请求模型与实际模型 | ✅ 收据有 `model` 与 `actualModel`；⬜ CLI 执行路径尚未在所有分支写入 `actualModel` | `model-receipt.mjs`、`cli-execution.mjs` |
| 普通会话不被 Bot 策略拦截 | ✅ 本轮修好：只有 Bot 会话与已准入帧走策略（`needsBotPolicy`） | `modules/bot-runtime/policy-scope.mjs` |

**下一步（2）**：CLI 执行在退出时用适配层解析出的模型名写 `actualModel`；解析不到就保持 `null` 并在 UI 显示"实际模型未报告"，
绝不拿请求模型顶替。

---

## 3. 远程能力与 CLI 接入方式

| 要求 | 现状 | 锚点 |
| --- | --- | --- |
| 远程能力统一从授权入口调用 | ✅ 模型只能通过工具调用远程；身份、任务号、尝试号由 Host 生成，模型不传 | `packages/orchestration/src/remote-computer-tools.mjs` |
| 操作记录与对账 | ✅ `{operationId,tool,status,result,error}` 记录；未知结果走 reconcile，不自动重放 | 同上、`remote-execution.mjs` |
| 支持 MCP 的 CLI 接专属桥接 | ⬜ 只有 `mcp` 字样的迁移与远程工具名，没有 MCP 客户端桥 | `migration-supporting-domains.mjs`、`remote-machines.mjs` |
| 其余 CLI 由所属 Bot 编排远程准备/读取/验证 | ✅ Bot 已能组合 `fs_read`/`shell_exec`/`artifact_*` 等远程工具完成配套步骤 | `remote-computer-tools.mjs` |

**下一步（3）**：MCP 桥接先做最小闭环——`mcp_servers` 绑定在 Bot 上，工具名固定为 `mcp__<server>__<tool>`，
调用仍走 task/attempt 身份，凭据只从 secretRef 解析，模型不能指定 endpoint。

---

## 4. 功能并集（逐项验收）

清单来自用户要求，证据是代码位置；`tests/capability-union.test.mjs` 会逐条检查证据是否存在，
证据消失即测试失败——这是"逐项兑现"的可执行形式，而不是文档承诺。

| 能力 | 证据 |
| --- | --- |
| 群聊 | `vendor/ds-bot/src/host/groups.js` |
| 长期记忆 | `vendor/ds-bot/src/host/memory.js`、`learning.js` |
| 能力包 | `vendor/ds-bot/src/host/capabilities.js`、`office-skills.js` |
| 语音 | `vendor/ds-bot/src/client/composer.js`（语音输入入口） |
| 侧聊 | `vendor/ds-bot/src/host/side.js`、`btw.js` |
| 计划任务 | `vendor/ds-bot/src/host/schedules.js` |
| 交互视图 | `vendor/ds-bot/src/client/right-panel.js`、`memory-panel.js` |
| 官方工具（12 + dsh-TUI） | `.dsh-plugin/shared/official-tool-registry.mjs` |
| 终端 | `.dsh-plugin/shared/cli-terminal.mjs` |
| 高级路由 | `.dsh-plugin/shared/harness-plan.mjs`、`routing-presets.mjs` |

---

## 5. 顺序

1. **CLI 子任务化**（第 1 节）——它决定"唯一任务系统"是否成立，其余都在它之后。
2. **`actualModel` 全路径写入**（第 2 节）——不写就无法证明没有偷偷换模型。
3. **MCP 桥接最小闭环**（第 3 节）——先一个 server、一种传输，跑通再扩。
4. 逐项验收跑 `tests/capability-union.test.mjs`，任何证据缺失即视为功能并集回退。

---

## 6. 与 OpenBot / dsh-superagent 的对应

- OpenBot 的"一个网关决定并记录所有动作" → 第 1 节的 CLI 子任务化 + 第 3 节的统一授权入口。
- superagent 的"每个工单一个阶段、只记录不执行" → 已落地的工作台演练模式与
  `shared/attention.mjs`、`apps/integration-client/bot-attention.mjs` 两处注意力清单。
