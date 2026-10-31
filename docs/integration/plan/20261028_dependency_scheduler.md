# 依赖调度器实施设计（2026-10-28）

接续 HANDOFF-20261028 §7.1-A，复用 parseTaskPlan/validateTaskPlan，不改冻结 DS 或 SDK。实现前已复现 §8 十组基线：根 1399/1396/3 skip、默认实际宿主 28 项、资金 33 项、文档 25 项及其他指定探针通过。全部采用离线模型 fixture。

## 存储与兼容

journal user_version 升为 3，原 tasks/packages/attempts/operations/outbox 结构保留。新增 task_plans、task_plan_packages（逻辑包到原 task/package 的映射）、task_package_deps、task_workspace_locks。0/1/2 旧库同事务补表后升级；资金连接兼容版本 3。高版本原样拒绝，不降级。单任务 API 的形状和幂等规则保留。

submitPlan 在一笔 journal 事务内建立计划、全部包/attempt/operation/outbox 和依赖边；复用 task_commands 的 (owner_bot, request_key)，plan 类型命令锚定首包。canonical plan hash 约束重复投递；同 plan id 不可用另一份内容替换。计划自身 owner 与每个目标 Bot 分开，包按目标 Bot 的授权、并发与资金执行。

## 调度、失败与重试

ready 与 claim 均查所有前置包 succeeded，后者是最终数据库门控，不能靠服务层过滤。失败/取消/blocked/skipped 向从未派发的后继传播 DEPENDENCY_FAILED；独立分支继续。所有状态更新、传播、计划聚合位于同一 journal 事务。ready/get 为只读。

聚合保留包计数及未知状态，不以部分成功冒充全部成功。显式重试仍是原有新 attempt，不自动复跑后继；依赖未成功不得重试包。计划取消后不能以 retry 恢复其包。超时/恢复/核对也刷新聚合。

## 取消与写锁

取消包遍历其下游，未派发包 skipped，已运行包 cancelling。取消计划遍历全部包（包括独立分支）。服务对取消集合里的实际 active controllers 发中止。未确认停止的包保留 needs-reconciliation，父计划仍 cancelling 并标明需核对；仅确认所有包终止后为 cancelled。

按 Host 固定的 (machineId, workspaceId) 在 claim 事务获取独占写锁；同根写任务不能并发，独立 workspace 可并发，read 无需写锁。已确认终态释放；cancelling/needs-reconciliation、崩溃恢复均保留锁直到可信核对完成。直接 journal 测试仅验证锁协议；服务注册依旧拒绝写 backend，不开放写 facade。

## 服务与授权

服务增加 submitPlan/getPlan/cancelPlan；Host 决定每个 effect 的 backend，不由计划携带路径、URL 或凭据。planTargetsFor 默认只有提交者；默认产品仅已提交 Main 的实际私聊可选当前目录中的 Bot，Worker/群会话仅自己。拥有者操作通过已认证通道，按所选 Bot 主体准入。提交时逐包校验目标白名单、目标真实主体及 backend 能力，派发前再校验；origin Bot 必须是实际提交主体，Session 由实际 Agent 元数据盖章，模型不能改成别的 Session 或隐藏来源。只读 MR 是默认计划 backend。

增加计划工具与 owner 只读投影/取消入口，并更新 scoped 工具映射。保留旧 bot_task_start 与 MR 串行入口的语义。

拥有者重投已存在计划时，先按原 key 与 canonical hash 查询原命令，不依赖旧 Agent Session 仍在线或仍在当前目录；这只是返回原身份，不触发重新准入/派发。新计划仍校验已提交 Bot/私聊归属。模型工具路径仍必须由真实 Agent 元数据绑定当前 Session，不能通过同样的 JSON 参数取得 owner 重投权限。

## 验证与范围

原生覆盖旧库升级、拒绝未来库、事务回滚、幂等冲突、依赖就绪、失败/独立分支、跨 Bot 授权、取消树、未知停止、重启、写锁及只读并发。默认真实 rc.3 宿主追加计划成功/失败独立分支/取消断言，所有模型为离线 fixture。

T09/T12 仅记录已验证范围；T11 写 facade 与实际工作树退出证据仍未具备。Task claim/outbox 与资金仍是两个连接，不在本改动中声称同事务准入。另案先写设计，再改资金状态机。所有发布操作保持未授权状态。
