# Grok Bot 可观察工作流对齐与真实 Routine（2026-11-05）

本次的公开需求基线来自 `../PROJECT-STATE.md` 中记录的 2026-11-04 `https://x.ai/bot` 抓取摘要。本轮重新访问受网络/Cloudflare 阻挡，**未取得最新页面**。下表是公开行为到本仓源码/验证的映射，不代表取得 Grok 私有源码、模型、云基础设施或完整商业服务实现。DS Bot 来源、版本及 26 项上游能力的逐文件证据见 `20261105-upstream-parity.md`。

## 公开能力核对

| 可观察行为 | 本仓实际实现 | 可证明范围与边界 |
| --- | --- | --- |
| AI 同事，使用工具交付工作 | Bot 私有 Harness Session、Host 授权工具、`bot-loop.mjs`；上游 `browser/*.js` 的每 Bot 浏览器/登录分区 | 已有实际模型/工具执行路径。某个网站或业务能否完成取决于工具、登录与授权；没有内置所有 SaaS 账户。 |
| 长期上下文、项目接手、需要时找人批准 | 上游 `steward.js`、`parts.js`、`chat-index.js`、`approvals.js`、`requests.js`；产品独立会话存储/运行时切换 | 上游 checkpoint、分段与历史全文索引有真实实现；独立运行时不能与 Harness 同时拥有同一个 Bot。 |
| 多 Bot 并行、持续运行 | 上游 `groups.js` 同一消息多 `@` 并行、`goals.js` 分阶段检查；产品 Task runner/每 Bot 并发上限；上游 `schedules.js` | Host/远程 Agent 必须实际运行。上游定时任务需要 Harness Automation tasks bundle；不把“24/7”解释成提供托管 SLA。 |
| 每 Bot 可观看/接管电脑 | `desktop-sessions.mjs`、`remote-machines.mjs`、产品 DesktopViewer、Agent WebSocket/native full desktop | 接入已配对并按 Bot 授权的 Windows 用户会话，选定屏幕物理像素，真人控制时 fence Bot 输入。仓库不自动购买/创建云 VM，也不保证每 Bot 独占 VM。 |
| 演示一次 → 保存 → 后续回放 | 本文下述 ACK 录制、私有保存、真实桌面回放 | 已实现固定显示器/分辨率的输入与时序回放。布局变化需重新演示；没有声称具备通用视觉理解或自适应任务学习。 |
| 越用越懂、记忆与跨 Bot 学习 | 上游 `memory.js` 的 own/group/team 三作用域、变更历史；`learning.js` 的后台技能/项目规则提议，经用户批准后保存 | 有实际读写、审查、共享技能目录与隐私边界。学习内容是可审查的记忆/技能/规则，不是对模型参数训练的承诺。 |
| Connect the Bots、同群派活和项目交接 | 上游 `groups.js`、`handoffs.js`（未完成工作持久化，长结果落盘，恢复后继续回传）；`goals.js`；产品 Bot routing/Task journal | 上游群与交接是实际运行路径。产品 `bot-handoff.mjs` 的内存防环账本本身不能证明跨重启防环或完成交接；提交计划也不等于任务完成。 |
| 销售、招聘、投放、报销、Bug、Account Health、Chief of Staff | `bot-roles.mjs` 的岗位说明/能力请求；RoleCatalog 展示并复制简报；上游新建 Bot 可填写角色/指令 | 覆盖公开角色名作为模板。不是已连接所有 CRM/广告/报销服务的现成业务机器人；权限仍由 Host 单独决定。 |
| 桌面 + iOS、订阅服务 | 当前产品桌面/插件；固定上游仓包含独立 mobile 项目 | 本产品没有交付自己的 iOS 客户端、App Store 上架或 Grok Premium/企业合同。参考产品定价不是本产品功能或收费依据。 |

## 真实录制、保存、回放

### 数据与浏览器边界

- `bot-routine.mjs` 保留 `click/type/key/scroll/wait` 五动作 API，新增严格验证的 `input`（pointer/key/wheel/text）与 `delayMs`。录制元数据包括屏幕 ID、物理宽高、DPI、坐标系、录制时间和保留的已确认输入数；有鼠标采样时另存 `observedInputs`（原始 ACK 总数）与 `pointerSampleMs:200`。没有 ticket token、配对密钥、端点或可执行路径。
- `apps/integration-client/routine-recorder.mjs` 的 `createAcknowledgedRoutineRecorder` 只有在本桌面会话的发送输入得到成功 ACK 后才增加步骤。未确认输入不能保存；输入失败、ACK 丢失、会话或屏幕变更使整段演示无效。保存前还必须确认释放 held input。
- `RoutineCaptureControls` 放在真实桌面画面旁。开始前必须已取得控制权；结束时等待输入队列、确认 release-input，再调用认证 owner 通道 `routine.save`。保存失败保留草稿，允许单独重试保存。
- 只有 Host 返回带有效 ID、保存时间且内容一致的 routine record 才显示“已保存”；undefined、空确认或内容不符均保留草稿并报告保存尚未确认。
- 输入文字会成为该 Bot 私有 routine 的一部分。界面直接说明固定布局、最多 200 个回放步骤、单次停顿最多 60 秒的边界。
- 连续已确认的 pointer move 按 200 毫秒时间桶采样：保留每段起点与每桶最后一个已确认位置，包括任何按下/抬起、按键、文字或滚轮动作前的精确终点。尾部位置被替换时更新原始时间戳，保留所有非 move 动作的顺序、时间与总时长。200 步限制在采样后计算，绝不截掉 button/key/text；超出限制的非可合并动作使整段录制无效。界面说明采样轨迹不适合精细绘图。

### Host 与执行证据

- `routine-execution.mjs` 的 `createRoutineExecutionService` 验证已提交 subject 对应的 Bot；从该 Bot 私有 store 读取 routine。机器/root 权限由 `machines.desktopSession` 决定，不接受模型提供端点、命令、grant、task/attempt/operation identity。
- Host 每次执行生成 task/attempt；每个输入在发送前写入独立持久化 `routine-executions.json`，生成 operation ID，并记录 session/input ID、步骤、操作类型、发送时间和 ACK。执行日志不重复保存输入文字。
- `routine-session.mjs` 走实际 WebSocket：auth → ready → acquire control → 逐个 input/ACK → release-input/ACK → release control → Host close/stopConfirmed。每 45 秒续同一桌面会话授权，不靠断线重连续租，不自动重传输入。
- 录制的屏幕 ID、分辨率、DPI或坐标系不符时，在任何输入前拒绝；运行中几何变化也会停止。
- `status=succeeded` 只证明所有动作 ACK 与清理确认，不自动证明业务目标已经满足；需要由任务验收或人检查业务结果。
- 明确拒绝且 `possiblyApplied:false` 是 `failed`；已发送但 ACK 丢失/断线，或 native 返回可能已生效，都是 `unknown`。取消已在途输入同样是 unknown；步骤之间取消是 cancelled。停止请求与停止确认分开报告。
- unknown 会阻止同一 Bot/机器上开始新的 routine。Host 重启把未结束执行恢复为 unknown；执行账本损坏会拒绝读取，不当成空历史。只有认证 owner 检查电脑实际结果、填写说明后才能解除阻塞；过去的 unknown 不会改写成成功，也不触发重放。

## 组合层接入契约

协调者负责的文件需要一次性创建服务并复用：

```js
const routineExecution = createRoutineExecutionService({
  machines, store: routineStore, botIdForSubject: describeBot,
})
// 所有下列 action 都在认证 owner product channel 内。
'routine.save': p => routineStore.save(p.botId, p.routine)
'routine.list': p => routineStore.inspect(p.botId)
'routine.run': (p, context) => routineExecution.run({
  subject: taskOwner({ botId: p.botId }), botId: p.botId,
  routineId: p.routineId, machineId: p.machineId, rootId: p.rootId, context,
})
'routine.history': p => routineExecution.history(p.botId)
'routine.cancel': p => routineExecution.cancel(p.botId, p.runId)
'routine.resolve': (p, context) => routineExecution.resolve(p.botId, p.runId, p.note, context)
```

`desktopSession` 的 task/attempt 从可信 Host context 接入，绝不能从 action/model payload 接入。模型 `bot_routine_list/save/run` 只能访问实际 caller-bound Bot，run 复用同一 `routineExecution`，服务缺失时 fail closed，不能退回缺 screenshotId 的 `desktop_*` 映射。

Host dispose 必须先 `await routineExecution.close()`，再关闭 machines/directory。close 先禁止新执行、取消所有活动 routine，再等待每个执行的 native 输入释放、control release、Host close 与最终 journal 写入；重复 close 返回同一完成 Promise。返回 `{stopConfirmed, results, errors}`，缺 ACK 或 close 确认仍保留 unknown，不重放。

桌面流向纯录制器发送以下观察回调，meta 至少包含 id/sessionId/sentAt：

```js
onBeforeInput: (event, meta) => recorder.inputSent(event, meta)
onInputAcknowledged: (event, meta) => recorder.inputAcknowledged(event, meta)
onInputFailure: (event, meta) => recorder.inputFailed(event, meta)
onMetadata: metadata => recorder.metadataChanged(metadata)
// 连接/授权丢失时 recorder.invalidate(code)。
```

`RoutineCaptureControls` 还接收 `sessionId/metadata/mode/connected`、`drainInputs()`、返回原生 ACK 的 `releaseInput()`、`saveRoutine(routine)`。`RoutinesPanel` 使用上述 owner actions 展示真实结果、取消与检查后解除阻塞。

本次执行直接返回真实桌面终态并有私有 journal；没有伪装成已加入通用 Task 后端。如果要将 routine 纳入通用 Task 队列，需要注册会调用该服务的真实 Task backend，并把 Task 的取消与该服务 controller 关联，再把完成/unknown 结果回填 Task journal；仅返回 plan/task ID 不能代替执行。

## 验证

```sh
node --test tests/bot-routine.test.mjs tests/bot-routine-store.test.mjs \
  tests/routine-recorder.test.mjs tests/routine-desktop-workflow.test.mjs \
  tests/routines-panel.integration.test.mjs
```

结果：**34 passed / 0 failed**。实际 WebSocket 测试使用生产 session/execution/recorder/store 模块，native transport 由测试 fixture 模拟；覆盖演示→成功 ACK→私有磁盘保存→重新连接回放的实际输入效果、原五动作兼容、明确拒绝停止、ACK 丢失/应用后断线不重放、在途/步骤间取消、held key 清理、几何不符、同连接续期、Host 中断恢复、日志损坏与跨 Bot 冒用拒绝。采样回归用 605 个 60 Hz 输入确认按钮/按键/文字时间、拖动终点与总时长不变，并用实际 WebSocket 将 455 个输入录为不足 200 步后保存/回放；201 个不可合并输入仍拒绝保存。Host close 测试同时取消两个机器上的执行，确认等待清理和 journal 落盘，缺 ACK/close 时保持 unknown。React/JSDOM 测试实际点击开始/结束，通过认证 product channel 保存到磁盘并核对输入文字；没有保存确认时保留草稿，只重试保存。

测试资料全部写入 `tmp/integration/`；未调用付费模型、连接用户电脑或修改用户 profile。真实 Windows native/Agent 生命周期与产品组合构建由对应协调任务另行报告，不能由该 WebSocket fixture 冒充实机验收。
