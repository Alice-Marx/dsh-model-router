# Task/outbox 与资金原子准入设计（2026-10-28，已实现并验证）

当前实现对应 schema4：资金 owner 的 `openTaskJournal()` 借用同一个原生连接，Host-only 准入帧通过 AsyncLocalStorage/WeakMap 传递，默认固定 MR/CLI backend 强制采用。原生 20 项（含 6 个真实子进程退出位置）、根 1435/1432 pass/3 skip、默认真实 rc.3 宿主 36 项、既有 journal/资金相关 85 项和资金探针 33 项通过。新公开证据见 `../evidence/20261028_atomic_task_admission.json`。下方“当前”问题描述为设计前状态。

## 问题与决策

当前 journal 与资金库虽然使用同一 SQLite 文件，但各自持有连接。Task claim 已置 running、标记 outbox delivered 后，backend 才创建资金运行及预占。窗口内进程退出会留下需要核对的 Task，现状 fail-closed，却不能称为原子准入。依赖调度器没有消除这个窗口。

选择交接 §5.4 的**共享连接**方案，保持资金 `update()` 为唯一金额写入者。两阶段提交会引入第二份提交状态、补偿与不可确认回退，还会扩大 unknown 的组合数量；当前单文件、单 runner、同步原生 SQLite 足以在一笔事务中提交两类状态。

仅共享连接本身仍不够：MR run ID 是 backend 准备时产生，CLI 也在 facade 内建收据。不能在 claim 时猜 run ID 或把估算预占另记一次。因此还需一个明确的“待准入”阶段与 Host-only 事务桥，而不是在原有 claim 外包一个名义上的 transaction。

## 连接与事务所有权

1. 资金库为连接生命周期的唯一 owner；journal 借用同一个已完成迁移的句柄。借用接口只供 Host 代码，不通过 RPC/模型参数暴露。原组件独立运行/测试可继续使用自有连接。
2. journal close 不关闭借用连接；产品先停止 Task runner 和 active work，再关闭财务 owner。启动失败按同样顺序释放。需要测试 close/reject/重复 dispose 与启动竞争。
3. 财务 CAS 回调依旧只计算候选值。事务开始后校验资金 epoch/revision、Task runner generation、当前 attempt/operation、目标 hash、取消与 deadline，再写 Task 状态和资金持有。事务内不 await，不请求模型、不启动进程。
4. Task 与资金任一写失败都回滚全部数据，包括执行引用、outbox 和资金派生投影。journal 在已有事务内使用保存点或明确的同步内部方法，不能另开顶层 BEGIN。

## 待准入与实际派发

1. 入队仍只创建任务和未投递 outbox；待依赖/资源/预算的包不应提前占用所有资金。
2. 声明需要财务原子准入的固定 backend 先领取 `admitting` 状态，绑定原 attempt/operation 和 runner generation，并占用服务并发槽。此时不标 outbox delivered，也不允许 beforeRequest。
3. backend 生成实际运行引用后，checkpoint 将引用交给私有 Host 准入帧，不能从 wire 数据建立该帧。此阶段尚不得触发付费请求。固定 MR/CLI 的调用顺序必须分别审计，不能假设任意 backend 都符合这个约束。
4. 原 MR/CLI 预占算法通过时，财务 update 的同一个原生事务核对引用、操作和预占，随后将 Task/attempt/operation 置 running、写执行引用、消耗 outbox 并写入原资金运行/预占/来源行。仍然只有原账本一份金额。
5. 请求前沿用 journal.assertDispatch 和 authority 租约校验；未完成原子提交不能派发。范围 unknown/预算拒绝时 Task 转 waiting-budget 或确定失败，outbox 未投递，不产生一个假执行账单。
6. 取消 admitting 包必须中止准备阶段并禁止其后提交；已经原子准入的包走当前 cancelling/unknown/原收据核对路径。写锁保留到可信停止，不能在 `close()` 或请求断开时直接释放。

## 恢复与兼容

- 崩溃在原子事务提交前：数据库中只能留下 admitting + 未投递 outbox、无匹配资金持有。在资金 epoch、共享连接和所有证明均有效时，才可恢复原 operation 到 ready；不得新增 attempt。任何矛盾保留 needs-reconciliation。
- 崩溃在提交后：Task、执行引用、outbox 与预占必须同时存在；按原 operation 核对，不能自动再发请求。已投递请求有无外部效果仍是独立的 unknown 问题，不能因数据库原子性声称外部 exactly-once。
- 需升级 journal 读者版本并同时更新财务 user_version 白名单，让旧版本拒绝新的 admitting 语义。迁移不改已有 task/attempt/operation ID。
- 已存在的 ready 包可采用新准入；原 running/cancelling/needs-reconciliation 包仍按原收据恢复。原子桥不改变现有目标 hash 或偷偷改绑旧任务。
- 独立组件及不接资金的受控只读 backend 可保留原 claim 路径，但默认产品涉及资金的 MR/CLI 必须声明并验证原子合同，不能用静默回退掩盖接线失败。

## 动手前必须落实的验证

- 共享句柄/借用 close、嵌套事务失败、旧库迁移及未来版本拒绝。
- 在 admitting、引用准备、财务写中、事务提交后分别用真实子进程退出，检查 Task/outbox/run/hold/receipt 全有或全无。
- 并发预算竞争仍只批准一次；取消/撤权/期限/runner 换代在提交前后均有效；CAS 重算不重复执行副作用。
- 依赖图、显式重试、unknown-stop 写锁、计划恢复与旧串行入口不回归。
- 当前回归成本：journal/依赖/核对联合 52 项、资金 33 项、默认宿主 35 项、根 1415 项，以及严格受管与 legacy-policy 宿主；测试数字后续增加时据实记录。

验收边界：本阶段证明共享 SQLite 的原子提交与进程退出恢复，不等于外部 provider exactly-once、物理断电、生产迁移或真实模型推理验收。显式 MR 重试保留同一账单/run ID，并以新 attempt/operation 更新当前 marker；历史 attempt 的执行引用仍保持原值。借用 close 顺序、取消/撤权/期限、CAS 冲突、预算竞争和旧 schema3 身份保留已有原生覆盖。完整工程和发布门禁继续按主方案推进；用户已有工程全部完成后的发布授权。
