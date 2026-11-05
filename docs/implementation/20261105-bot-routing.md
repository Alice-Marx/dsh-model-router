# Bot 路由实施与验收报告（2026-11-05）

工作区：`F:/everyAI/dsh-model-router-all/dsh-model-router`；分支：`archive/preview6`。本任务接续 StepCode 已留下的路由修改，未丢弃其他代理的工作，未提交、切分分支或发布。

## 完成的生产路径

`bot_route_task` 与 `bot_dispatch` 默认真正派发；`preview:true` 只读。工作台经已认证 owner 的 `botRouting.dispatch` 使用同一服务。返回值分别说明 plan/task/attempt/operation、accepted、settled、outcome；仅有 plan ID、阻塞包或未证实的授权不会伪装成完成。

1. **选择与预览**：从已提交的 Bot 列表、已评估绑定、工具授予和逐机器健康构造候选。支持 DS 原生 id→Bot 对象名册；停用/阻塞的绑定不参与。未知价格仍是 `null`。请求者的 routing preset 同时作用于预览和派发。手工 pin 通过同样的模型、工具、忙闲、机器和 root 条件；总开关关闭时自动及手工派发均拒绝。
2. **调用身份**：模型工具通过 Host 的 `directory.forAgent(actualAgent)` 得到请求者，不能通过参数伪造 requester、origin、session 或 owner。普通模型入口限已提交的 Main；人工入口使用单独认证的 owner context。plan 的 origin 及提交主体一致，worker 仅拥有自己的执行包。
3. **授权确认**：`createWorkerBindingCommitter` 从选中 worker 的已提交逐 root ceiling 派生 scope，校验真实 binding revision。现有较宽 scope 若已经覆盖需求则只确认，不缩窄；`autoGrant.machineTools:false` 仍可用已有授权。新增 scope 仅允许 owner/Main，拒绝多 root 合并产生的工具权限笛卡尔扩张；远端撤销/绑定未确认时不提交任务。Main 自身不重新绑定。预览的 grant.applied 始终为 false。
4. **实际执行**：`bot-turn-read`/`bot-turn-write` 进入真实 Task runner，再向选中 Bot 的真实 SDK Agent `followup(createUserMessage(...))`。路由 reference 先于投递持久化。只认读取了精确来源 marker 的 worker turn，并在该 Session 的 `turn/end` 后完成 flush 才保存终态收据。显式选中的第二机器/root进入计划、target、worker 输入及远程调用校验，不回落到第一台机器。
5. **效果边界**：read 任务通过 worker 的 scoped tools.guard 拒绝写工具。受管 worker turn 拒绝未追踪的嵌套 message_bot/subagent/新 Task 等派发，避免把“子任务已接受”误算为父任务完成；普通 DS 会话的既有权限没有改变。工具失败、混入其他输入、未知远端结果及未确认 stop 不会变成成功。
6. **远端操作**：受管 turn 的 file-write/command 直接复用既有严格远端 backend，而非把子 Task排在同一 Bot 的执行槽后等待自身。保留父 task/attempt，Host 为子操作生成 operation，记录 reference，并复用字节/hash/stop-proof 校验。已有未知操作后阻止再次发起变更，允许观察/取消。桌面、浏览器普通工具仍保持原流程。
7. **结果与恢复**：接受计划后持久化待交付记录，用原请求者的 subject 读取 plan，终态再回投结果。回复投递不确定时不盲目重发。取消仅发出请求；无匹配终态则 needs-reconciliation。重启后的 observer 可以从原 Session 历史匹配同一来源/turn，恢复漏存的终态收据，沿用原 task/attempt/operation，绝不重新投递执行。

资金仍使用主流程已有的逐 Bot model accounting。父会话已将任务关联改为 `markTaskModelRequest`/`taskModelRequest`：各模型调用仍自行进行真实预算 admission，只关联父 task/attempt/operation，不伪造已预留 invoice，不将未知 usage/cost 变为零。

## 已接入的 Host hooks（供总负责人按点核对）

`packages/orchestration/src/product-composition.mjs` 由父会话维护，已按以下接口接入：

- `settingsFor(id)` 返回 `{...row.settings, grant:row.grant, status:row.status}`；`bots()` 可返回原生对象名册。
- `mainBotIds:()=>committedMainIds`；`subjectFor:id=>directory.forBot(id)`；`submitPlan:(subject,request,caller)=>taskService.submitPlan(...)`。
- `bindWorker:createWorkerBindingCommitter({machines:()=>machines,settingsFor,mainBotIds})`；callback context 为 `{owner,requesterBotId,originBotId,signal,grantAllowed}`，确认结果为 `{confirmed:true,applied:boolean,binding}`。
- `executionBackendFor:effect=>effect==='read'?'bot-turn-read':'bot-turn-write'`；`onAccepted:report=>turnBackends.watchPlan(report)`。
- `createBotTurnBackends({ctx,runtime:()=>product.rt,directory,authority,Database,storeFile:storageFile,bindingFor:id=>botSettings.get(id,{publishChange:false}),machines:()=>machines,readPlan:report=>taskService.getPlan(directory.forBot(report.originBotId),{planId:report.planId})})`。
- `readPlan` 的返回形状已实测兼容 TaskService.getPlan：读取顶层 `state` 和 `packages[].targetBotId/state/result.summary`；不要求 UI 投影中被裁剪的结果字段。
- `turnBackends.backends` 加入 Task registry；现有 accounting 入口在正常资金 admission 前调用 `turnBackends.tagModelRequest(options)`。
- remote facade传入 `routedExecution:turnBackends`、`botIdFor:exec=>describeBot(directory.forAgent(exec.agent))`、`routingBotIds:()=>committedMainIds` 及 routines 代理实现的 `routineExecution`。
- busyFor来自真实当前 chat 的运行 turn，避免 Main 在自己的工具调用中等待自身。

父会话维护的契约补充：Bot execution input 为 `{task,machineId?,rootId?}`；`task-contract` 校验 effect/闭合字段/ID；`task-service` 接受 `tracked-bot-turn-v1` 及可信 targetFor 的 location；journal接受精确 `bot-turn` reference，并要求 `bot-turn-ended` 或 `bot-turn-not-sent` stop proof。`managed-tasks` capability 提供 `execution/bot-turn`、retry、observe。schema/持久化开关/React UI由父会话负责。

## 真实 SDK 发现并修复的旧 Task 权限问题

真实 Host 原先的 `bot_task_start` 返回 TOOL_DENIED，虽 worker 已有 managed-tasks。根因是全局 `guardLegacyTools` 扩到所有 `bot_*` 后，把 Task facade 当作 `tool/bot_task_start` 检查；实际已提交权限是 `task/submit`。

修复是在 `task-tools.mjs` 导出精确的八项 `TASK_TOOL_CAPABILITIES` 映射，legacy guard对这些名称调用已有 `task/*` 检查。没有增加 tool alias，没有跳过策略或 Task service admission。回归验证：只有 task权限即可调用相应入口；复制的 Agent、撤销的 submit、未知 bot工具及未授权 library write仍被拒绝。

`tests/fixtures/integration-combined/mock-plugin.mjs` 另保留 browser-open 请求的 machineId，修复离线模型后续 browser_script/close 丢失必填 ID 的 fixture 错误；只忽略 SDK附加的 `<system-reminder>` 用户角色指令更新包，防止其遮蔽真正的测试命令，仍保留末尾 tool-result 的结束语义以防重复执行。浏览器断言与现有成功结果展开形状对齐，并额外检查隔离 Agent数据库的三个操作均为 succeeded。

## 验证

针对性生产/SQLite/策略回归：**136 tests passed，0 failed**，命令如下（没有付费模型）：

```powershell
node --test tests/legacy-policy.test.mjs tests/bot-routing-bindings.test.mjs tests/bot-routing-runtime.test.mjs tests/bot-routing-service.test.mjs tests/bot-routing-tools.test.mjs tests/bot-routing-candidates.test.mjs tests/bot-routing-dispatch.test.mjs tests/bot-routing-mode.test.mjs tests/bot-routing.test.mjs tests/routing-end-to-end.test.mjs tests/remote-computer-tools.test.mjs tests/task-contract.test.mjs tests/task-plan.native.mjs tests/task-plan-journal.native.mjs tests/product-composition.test.mjs tests/bot-routine.test.mjs tests/bot-routine-store.test.mjs
```

其中：`routing-end-to-end.test.mjs` 使用真实 SQLite journal/service、本地文件和 mock backend；`bot-routing-runtime.test.mjs` 使用生产 worker-turn/backend、真实文件工具和持久化状态，但 Session driver/model 是离线协议 fixture。它们不能替代真实 SDK AgentLoop 验收。

真实产品组合验收命令：

```powershell
node scripts/integration-product-default.mjs --host-root F:/everyAI/dsh-model-router-all/DS-Bot/app
```

SDK只读复用 `0.2.1-rc.4` 已安装依赖；每次新建 `tmp/integration/product-default/run-*` 的独立 DSH_HOME/profile/workspace/数据库，禁用外部 fetch并使用离线模型。未触碰用户 DSH profile。

完整 SDK验收 `tmp/integration/product-default/run-szycrv/summary.json`：**passed，exit 0，48 checks，SDK 0.2.1-rc.4，真实外部模型调用 0**。包括路由、旧 N09 Task start/retry/cancel/concurrency、DAG、跨Bot拒绝、CLI scope、隔离真实 Agent文件写/浏览器、资金停用/人工核对、Session轮转/调度及 cold restart。

定点读取该次真实 SQLite证据：一个 routed turn为 succeeded，stopConfirmed=true，toolCalls=1；对应 `bot_routed_deliveries` 为 delivered；两条 worker模型收据均 settled、usageComplete=true，且 task/attempt/operation与该 routed turn完全一致。`readPlan` 返回形状及真实结果返回因此同时被验证。

随后配合父会话新增配对/Main自动授权及 library.search，追加了两类真实断言：配对后不再手工 bind Main，Main立即经真实 AgentLoop读隔离 Agent文件；owner工作台通道独立提交第二个路由计划，且模型和人工两计划均已 delivered。最终补充重跑仍在验收中，结果将补记于此。

## 改动与边界

本代理主要修改 `packages/orchestration/src/bot-routing{,-mode,-candidates,-dispatch,-service,-tools,-runtime}.mjs`、`remote-computer-tools.mjs`，及针对性 `task-tools.mjs`/`.dsh-plugin/shared/legacy-policy.mjs`、`scripts/integration-product-default.mjs` 和离线模型 fixture。保留了主流程的 model-accounting修复、routines实现和其他并行修改。资料库 `bot_library_search` 仅加入 read工具白名单，不涉及 PDF/OCR/RAG。

新测试：

- `tests/bot-routing-bindings.test.mjs`
- `tests/bot-routing-runtime.test.mjs`
- `tests/bot-routing-tools.test.mjs`
- `tests/routing-end-to-end.test.mjs`

修订测试：`bot-routing-candidates.test.mjs`、`bot-routing-dispatch.test.mjs`、`bot-routing-service.test.mjs`、`legacy-policy.test.mjs`；其他上列文件仅执行验证。父会话需确保 test-plan包含新增文件。

当前验收不宣称 group-origin路由、多层受管委派、Electron UI/发布包、所有上游功能逐项 UI通过、真实外部供应商或真实远程电脑通过。远端未知效果的人工核对及不确定回复投递保持显式未决，不自动重放。
