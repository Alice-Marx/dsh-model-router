# 状态权威与丢窗口

> 这份文档回答一个问题：**某个状态坏了、丢了、看起来不对时，谁是真相。**
> 写法照抄 `Agents-Anywhere/docs/server-architecture.md:21-61` 的那张表，因为那张表是三个参考实现里唯一把"丢失后果"写清楚的。
> 读代码遇到 `task_runner` / `router_meta` / `router_runs` / `orchestration.sqlite` 时先看这里。

## 1. 权威表

一个 Host 的持久状态只有一个文件：`<home>/orchestration.sqlite`（`sqlite-router-state.mjs:33` 打开，`task-journal.mjs:23-48` 在同一连接上建表）。同一文件里有两套互不覆盖的 schema：任务账本（`user_version = 5`，由 `task-journal.mjs` 写）与路由账本（`router_meta.schema_version`，由 `sqlite-router-state.mjs` 校验）。**这不是两个数据库，是一份文件里两套版本号**——看到 `user_version` 和 `schema_version` 数字不同不是 bug。

| 状态 | 权威 | 持久化 | 丢了会怎样 |
| --- | --- | --- | --- |
| 任务与尝试身份（`tasks`/`packages`/`attempts`/`operations`） | 账本行本身 | WAL + `synchronous=FULL`（`task-journal.mjs:47`） | 任务消失。没有第二处可重建，只能从备份恢复 |
| 任务终态与结果（`attempts.state`/`result`） | 账本行 | 同上 | 已完成的结论丢失；`finish` 之前崩溃则停在 `running`，由下一次 `recover` 转 `needs-reconciliation` |
| 派发意图（`task_dispatch_fences`、`task_execution_refs`、`task_outbox`） | 账本行 | 同上 | **不能**靠结果里的 `stopConfirmed` 反推。只有 `dispatch.state='closed'` 这一行能证明回调从未进入（`task-journal.mjs:79-84`） |
| 运行器租约（`task_runner`） | 账本行 | 同上；`leaseClock:'db'` 时到期判断也用账本时钟 | 租约过期 → 另一个 Host 可领取 → 旧 runner 的 `fence` 失败 → 它必须停下（`task-service.mjs` 的 `stopRunner`），不是继续跑 |
| 幂等收据（`task_commands`） | 账本行 | 同上 | 重放保护消失；同一个 `requestKey` 会被当作新请求。**注意**：`task_commands` 不存结果，重放时返回实时视图，这是刻意的（`PLUGIN-GAPS.md` §"不是问题"） |
| 计划状态（`task_plans.state`） | **派生态**，由成员任务推导（`refreshPlans`） | 落库但可重算 | 与成员不一致时以成员为准：下一次写事务会重算（`task-journal.mjs` 的候选查询包含 `t.updated_ms > p.updated_ms` 的计划） |
| 预算预留与运行记录（`router_runs`/`router_holds`） | 账本行 | 同上 | 预留丢失 = 预算可被超发；`router_meta.revision` 与这两张表在同一事务里重写 |
| 资金投影（`funding`） | 账本行 + `router_model_calls` | 同上 | 投影可由 receipt 重建（`createFundingProjection`）；**模型调用收据是唯一钱账**，投影不是 |
| 路由元数据（`router_meta`） | 账本行（单行） | 同上 | 配置丢失；`revision` 单调递增用于 CAS，丢失会破坏版本比较 |
| 任务事件（`task_events`） | 账本行 | 同上 | 时间线与归因丢失；**这是观察记录，不是状态真相** |
| 运行器事件（内存环形缓冲 32 条） | 进程内 | **无持久化** | 重启即失。`service.state().events` 只用于当次诊断；要长期追因得看 `task_events` |
| 客户端投影（`.dsh-plugin/client.js` 运行时状态） | 进程内 | 无 | 重载即失，只能重读宿主 |
| 打开的数据库连接、待重试的写、`pump` 队列 | 进程内 | 无 | 进程崩溃即失；任务状态留在账本里，由 `recover` 收敛 |

## 2. 丢窗口（明确写出来，不假装没有）

1. **`finish` 之前的崩溃**：尝试停在 `running`。下一次 `start()` 的 `recover` 会把它转成 `needs-reconciliation`，**不会**自动重试——因为不知道副作用有没有落地。
2. **`finish` 成功但 `recover` 之前进程没了**：与 1 完全相同，靠下一次 `recover`。
3. **`claimRunner` 写成功、心跳还没续上就崩溃**：租约在 `runnerTtlMs`（生产 10 秒）内仍然有效，别的 Host 领不到；这段时间提交的任务是 `ready`，不是丢失。
4. **两个 Host 同时写**：SQLite 单写者，第二个等 `busy_timeout=5000` 加 `writeTransaction` 的有界重试（`write-retry.mjs`）。超过 `writeDeadlineMs`（默认 10 秒）才报 `SQLITE_BUSY`，错误里带 `deadlineMs`。**没有任何一刻允许两个写者同时提交。**
5. **租约时钟**：生产用账本时钟（`leaseClock:'db'`），所以系统时间跳变不会让活租约被判过期。测试夹具默认用注入时钟（`'app'`）以便模拟过期——这是**唯一**一处测试与生产语义不同，改动它必须同时改本文件。
6. **`router_meta` 与 `router_runs` 的重写**：每次提交在同一事务里整体重写（`sqlite-router-state.mjs` 的 `write`）。中途崩溃 → 事务回滚 → 旧 `revision` 与旧行仍在。没有"半新半旧"的窗口。
7. **资金投影**：由 receipt 推导，可在任意时刻重建。`modelCall` 收据一旦落库不可改（`router_model_calls` 无更新路径）。

## 3. 谁能看到什么

- 模型看不到任务账本。所有读取都经过 `task/read`、`task/cancel`、`task/retry`、`task/reconcile` 能力判定（`task-service.mjs:38` 的 `owner()`）。
- 客户端只读产品动作返回的投影（`task-product.mjs`），不直接打开数据库。
- `service.state()` 是给看门狗与诊断用的只读视图，**不是**对外契约；它含 `running/stopReason/restarts/events`。

## 4. 改这张表之前

任何新增持久状态，先回答三个问题再写代码：

1. 它是**真相**还是**派生态**？派生态必须能从真相重算，且要写明重算入口。
2. 它丢了以后，用户会看到什么？把这句话写进本表第 4 列。
3. 它需要新的窗口声明吗（半写、跨进程、跨时钟）？需要就加进 §2。

参考实现里的写法：`Agents-Anywhere/docs/server-architecture.md:21-61`（权威表 + 两个丢窗口）、`OpenBot/docs/architecture.md:229-241`（"四件事永远由部署决定"）、`OpenMausBot/docs/decision-model.md:147-149`（写-only 密钥的回报口径）。
