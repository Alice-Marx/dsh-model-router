# 停写栅栏切片 4：OS/launcher 隔离适配器

状态：**W06.15 in_progress**。本文交付受控 Windows 进程树与 Linux cgroup v2 两个组件；专用账户、外部自动重启拦截、真实旧 DS/SDK/MR 入口和全数据域停写仍未完成。上游约束见 `20261030_migration_stop_fence.md` §3.2、§4、§6、§7。

## 1. 本轮组件边界

新增 owner-only 低层 API `launchMigrationProcessTree`，以显式受信的 `native/windows-desktop/ProcessJob.cs` 编译产物为 runner，直接从创建时把目标进程及后代纳入 Windows Job。API 不编译 runner、不查 PATH、不经过 shell、不接受命令字符串，也不从产品或模型入口暴露任意进程执行能力。

已证明的范围只能是：

- Job membership 在 `CreateProcess` 时建立，没有先运行后 assign 的窗口；此原生保证由既有 `ProcessJob.cs` 提供。
- 直接子进程正常退出、主动停止 wrapper、或创建 wrapper 的 coordinator 死亡时，Job handle 关闭并终止仍属该 Job 的后代树。
- 只有观察到 wrapper `close`，适配器才返回 `treeStopped:true` 和 `stopEvidence:'windows-job-close'`；停止超时返回 `MIGRATION_OS_QUARANTINE_STOP_UNKNOWN`。

永不由此单独推出：

- 外部服务、计划任务、其他 launcher 或另一个账户不能重启旧入口；
- 同账户恶意进程、未参加受控启动的第三方写者已被约束；
- 所有文件句柄、网络共享、外部服务副作用或全部迁移数据域已停写；
- `activationSupported` / `postActivationRollbackSupported` / `stopWriteProvable` 可以改为 true。

返回对象因此固定携带 `externalRestartBlocked:false`、`persistentExternalExclusion:false`、`stopWriteProvable:false`。

## 2. 输入与信任边界

- 仅 win32；其他平台回答 `MIGRATION_OS_QUARANTINE_UNSUPPORTED`。
- `runner`、`executable`、`cwd` 必须是已存在的绝对路径，经 `realpath`/`lstat` 核对；runner 与 executable 必须是普通非符号链接文件，cwd 必须是普通非符号链接目录。
- `operationId` 使用既有有界 ID 规则；`args` 只能是 0–64 个有界字符串，禁止 NUL，累计请求不超过 64KiB。
- runner 直接 `spawn`，stdio 仅用于一条有界 JSON 请求和诊断尾部；stdout/stderr 均保留有界尾部，不把输出当成停止回执。
- API 是私有组件，不加入产品接线。可信 owner 负责提供经过审查的 runner；测试只用当前仓库源码现场编译的副本和合成 Node worker。

## 3. 状态与失败语义

| 状态/事件 | 可报告事实 | 禁止推断 |
|---|---|---|
| runner 已创建、请求已发送 | 进程受 Job 监督的启动已请求 | 旧 writer 已停、数据可捕获 |
| 主动 `stop()` | 精确终止本 handle 的 wrapper，等待其 close | PID 名匹配、杀其他进程、外部重启已阻断 |
| wrapper close | `treeStopped:true`，`stopEvidence:'windows-job-close'` | 全域 stop-write proof |
| stop 超时 | `MIGRATION_OS_QUARANTINE_STOP_UNKNOWN` | 超时等于已停止或已回滚 |
| coordinator 死亡 | 原生 parent watchdog 终止 Job 树 | 持久阻止其他 launcher 重启 |
| 非 Windows | 明确 unsupported | 以 Node 进程组冒充等价边界 |

`stop()` 幂等等待同一份 close 结果。重复调用不会选择或终止其他进程。适配器不提供 release/activate，也不把取消写成回滚。

## 4. 测试门槛

1. 输入闭集、路径类型、参数数量/长度和平台不支持均 fail-closed。
2. 合成父进程 + 孙进程：主动停止后，延迟写入永不出现，close 结果含原生 Job 停止证据与三个 false 边界字段。
3. 直接子进程正常退出而孙进程仍存活：wrapper close 同样终止孙进程，延迟写入不出现。
4. 真实 coordinator 子进程通过适配器启动 worker 后被 SIGKILL：原生 watchdog 关闭树，延迟写入不出现。
5. 不存在的目标 executable 在启动前由适配器以 `MIGRATION_OS_QUARANTINE_PATH_INVALID` 拒绝，不能产生合成写入。
6. runner 自身无法启动时，同步 `spawn` 异常归一为 `MIGRATION_OS_QUARANTINE_RUNNER_UNAVAILABLE`；异步启动失败则返回 `runnerNotStarted:true`、`treeStopped:false`，均不得伪造 Job 停止回执。

## 5. Linux cgroup v2 组件（E82）

新增 owner-only `launchMigrationLinuxProcessTree` 与同包 Python supervisor。仅 Linux，显式 Python/executable/cwd 绝对路径与有界 argv，禁止 shell。supervisor 在受信 `cgroupRoot` 下创建 `dsh-migration-<operationId>` 专属 cgroup，目标通过 `preexec_fn` 在 exec 前写入自己的 PID，后代自然继承；目标 stdio 使用临时文件避免管道阻塞。

- 主动 stop 向 supervisor 发 SIGTERM；直接子进程退出或 coordinator 身份死亡也触发 `cgroup.kill`。
- 只有 `cgroup.procs` 为空才报告 `treeStopped:true` / `linux-cgroup-v2-kill`，随后显式 rmdir；receipt 缺失或不匹配一律 false。`cgroupRemoved` 单独报告。
- coordinator 身份使用 `/proc/<pid>/stat` startTicks 防 PID 复用。supervisor 自身被 SIGKILL、外部 launcher、其他账户与未知写者仍不受本组件保证。
- 该后端需要可写 cgroup v2 和 `cgroup.kill`，非特权环境不自动放行或降级成普通 process group。

E83 增加非 root 委托合同：`cgroupRoot` 默认 `/sys/fs/cgroup`，也可显式指向其内部 delegated 目录。JS 与 Python 均要求 realpath 不越出 cgroupfs、目录归当前有效用户所有；Python 还要求 supervisor 已位于该根或其后代中，否则 `MIGRATION_LINUX_QUARANTINE_SUPERVISOR_OUTSIDE`。委托方须设置目录与父级 `cgroup.procs` 权限，并让 supervisor 在降权前进入 delegated 根；仅 `systemd-run --uid=nobody -p Delegate=yes` 的 scope 目录仍归 root，不算通过。当前已实测 root 与 `nobody` 两种路径，`nobody` 改用 root 拥有的根会被拒绝。

真实测试覆盖输入闭集、父/孙进程 `/proc/<pid>/cgroup` membership、主动 stop、直接子进程退出、coordinator SIGKILL、延迟写入和 cgroup 残留。能力探测必须创建自有子 cgroup，不能用根目录不存在的 `cgroup.kill` 文件误判平台能力；清理使用显式 rmdir。

## 6. systemd 持久重启栅栏（E84）

新增 `quarantineSystemdLaunchers` / `releaseSystemdLaunchers`，仅处理显式列出的 systemd 单元：操作前逐单元读取真实 fragment 并核对 SHA-256，先 mask 再 stop，确认 mask 链接与 inactive。错误后不自动 unmask；coordinator 死亡不会移除 `/etc/systemd/system/<unit> -> /dev/null`。

- transient 单元的 `systemctl is-enabled` 可恒为 `transient`，因此 mask 状态直接读 `/etc` 或 `/run` 的 `/dev/null` 链接，不能伪用 enabled 文本。
- 回执绑定 `fragmentPath + fragmentSha256`。transient 停止后原 fragment 可删除，解除时若所有受信标准路径均无替代文件，允许仅凭原回执解除 mask；若出现替代文件则重新校验 digest，不匹配即拒绝。
- 解除前置仍为 masked + inactive；活跃单元回答 `MIGRATION_SYSTEMD_RELEASE_BLOCKED`，unmask 不启动旧 writer。
- `declaredRestartBlocked:true` 和 `persistentDeclaredExclusion:true` 只适用于回执内单元；`externalRestartBlocked` / `persistentExternalExclusion` / `stopWriteProvable` 继续 false，未知 launcher 与其他账户不在此组件范围。

真实测试用 `Restart=always` 临时服务先证明主进程死亡会自动重启，再验证 mask+stop 后启动拒绝、心跳不再增长、coordinator SIGKILL 后隔离仍在、活跃状态解除拒绝、fragment 变更在任何 mask/stop 前拒绝。连续复跑后无 mask 链接残留。

## 7. 冻结 DS 旧 writer 负例与隔离（E85）

测试直接导入未修改的冻结 `store.js` / `home-lock.js`，只在测试进程内对 `state.lock` 的 `writeFileSync` 定点注入 EACCES 并 `syncBuiltinESMExports()`，让真实旧代码进入 `lockBroken` 分支；这是故障注入，不宣称只读文件系统实测。合成 home 同时放置 pending migration gate。

断言旧 store 输出 cannot-lock 警告且 `state.json` revision 继续增长，证明旧程序既不服从新 gate，也不能靠占有/破坏其 `state.lock` 停写。随后以 E84 的 fragment 指纹 mask+stop，断言 revision 不再变化且 release 不重启。该证据覆盖真实 DS store 的一个受控旧 writer，不穷尽 SDK/MR、其他进程或全部数据域。

## 8. 旧 MR router-state 负例与隔离（E86）

测试直接调用未修改的 `.dsh-plugin/shared/router-state.mjs` `createRouterState().saveHealth()`，在合成 home 周期增加 `health.syntheticTick`。pending migration gate 下 tick 继续增长，证明旧 MR 不读新 gate；E84 mask+stop 后 tick 停止，release 不重启。依赖闭包按原模块上传并核对 SHA-256，不使用替代 writer 或真实 profile。

该证据覆盖一个旧 MR JSON writer，不能替代 SDK loader、SQLite 权威、其他 MR 后台 writer 或全数据域闭包。

## 9. SDK profile loader 负例与 Windows Job 隔离（E87）

测试在合成 profile 中反复写入退休 bundle，再调用固定 rc.3 `loadProfileDirectory()`，让真实 `dropRetiredBundles()` 每轮重写 manifest 并增加 `syntheticTick`。pending migration gate 下写入继续，证明 loader 不读 gate；E80 Windows Job 停止后 tick 不再变化。最终 manifest 的退休 bundle 为空，确认观察的是实际 SDK 写路径而非模拟副作用。

该证据仅覆盖 profile loader 的一个写路径，不包含 link projection、其他 SDK 服务、模型初始化或全部数据域。

## 10. SQLite 权威写者与 Windows Job 隔离（E88）

测试用真实 `openSqliteRouterState` 在合成 WAL 数据库中持续 `saveHealth()`，pending gate 下 syntheticTick 与 router_meta revision 持续增长。Windows Job 停止后另开只读连接，确认 tick/revision 不再变化，覆盖真实提交与进程/数据库句柄关闭。该证据不代表 Task/outbox、其他 SQLite 连接或全部域已经闭包。

## 11. Task journal/outbox 写者与 Windows Job 隔离（E89）

测试用真实 `openTaskJournal().submitPlan()` 提交唯一合成计划，每次事务创建 Task、attempt、operation 和 outbox，不调用执行器或模型。pending gate 下 outbox 行数继续增长；Windows Job 停止后只读核对行数不再增长，覆盖真实 journal 提交和关闭。该证据不代表正在执行的 Task、远程 Agent 外部效果或其他数据域已经停止。

## 12. 完整切片边界

完整切片 4 仍需执行中 Task/外部操作、其他 DS/SDK/MR 后台 writer、全数据域写句柄关闭、其他 launcher/账户、机器重启与全部域证据。本轮即使上述组件测试全绿，W06.15 仍保持 in_progress，产品门禁不提升。

## 13. 执行中 Task 停止证据

本节只做 E89 §2 中可判定的那一项：执行中 Task。真实 `openTaskJournal()` 提交后由 `claim` / `beginDispatch` / `linkExecution` 让 attempt 处于 `running` 且已进入派遣（effect 未确认），fixture 每 tick 追加 Task、attempt、operation、outbox 与 `task_events` 行；合成 home 同时放置 pending migration gate。

- 停止证据来自观测，不来自终态：`launchMigrationProcessTree().stop()` 回执 `treeStopped:true`、`stopEvidence:'windows-job-close'`，再加 fixture 自身 PID 的 `process.kill(pid,0)` 得 `ESRCH`、heartbeat 文件内容与 mtime 不变。停止后 attempt/operation 仍是 `running`、`finished_ms` 与 `result` 仍为 NULL，即当时没有任何终态行可读。
- `stopWriteProvable` 仍为 false：组件不宣称写级证据。从进程死亡观测点起的 500ms 静默窗口（attempt/outbox 行数、`task_events` 最大 seq、全部 attempt 状态指纹、另一连接观测的 `PRAGMA data_version`）是本测试另行观测，不升级为产品保证。
- 冷恢复走产品路径 `recover()`：attempt 变 `needs-reconciliation`，result 为 `{code:'HOST_INTERRUPTED',outcome:'unknown',cancelRequested:false}`，没有 `possiblyApplied:false`、`notStarted` 或 summary，即效果保守保留。
- 对同一 attempt 补提 `succeeded` / `cancelled` 结案（附伪 stopProof）被 `reconcile` 拒绝，记为 `unknown` + `TASK_STOP_UNCONFIRMED`，证明既不冒充成功，也不冒充取消或回滚。
- `possiblyApplied` 语义由真实 `createRemoteWriteBackend()` 钉住：派遣已发出而未确认 → `unknown` + `stopConfirmed:false` + `possiblyApplied:true`；从未派遣 → `notStarted:true` + `possiblyApplied:false`。

已知边界：journal 没有针对单个执行中 attempt 的进度行 API，增长只能来自新提交的 attempt 与 runner lease 续约；quarantine handle 只暴露 wrapper 的 PID 与关闭，子进程存活必须由 fixture 自报 PID 后另行探测。未覆盖：机器重启矩阵、跨机远程 Agent 真实外部效果、全数据域写句柄、其他 launcher/账户，以及 Linux 真机（本轮 Linux 通道不可用，Linux 侧只有设计与负例）。

## 14. 真实 Agent loopback 外部效果与 Windows Job 隔离（E94）

新增 `migration-remote-effect-quarantine.native.mjs` 与 owned fixture，使用真实 `remote-write`、Host Task service/journal 和经 loopback HTTP 提供服务的真实 Agent。合成 workspace 内不手写目标效果：每次写入都由 Agent `fs_write` 完成，Host 逐项确认前三次成功。第四次真实文件和 Agent succeeded 操作收据已产生后，fixture 确定性保持 Host HTTP 回复，使 Host attempt 保持 running 且效果未确认；合成 home 同时放置 pending migration gate。

- 停止前直接读回四个效果文件，并在 Agent `operations` 表观察到四条 succeeded `fs_write`，排除仅增长 Host journal 或模拟写入。
- `launchMigrationProcessTree().stop()` 返回 `treeStopped:true` / `windows-job-close`；fixture PID 随后为 `ESRCH`。500ms 窗口内，排序文件名与全部内容 SHA-256、Agent 操作状态/结果/完成时间、另一连接的 `PRAGMA data_version`、heartbeat/active 内容与 mtime 均不变。
- Host 冷恢复走产品 `recover()`，第四次 attempt 为 `needs-reconciliation` + `HOST_INTERRUPTED/unknown`，`possiblyApplied` 不被错误清除。真实效果已存在也不允许 Host 把未确认结果写成成功或回滚。

专项连续三轮 1/1，相关 remote-write + in-flight + 新套件组合 18 项、17 通过、0 失败、1 跳过；完整两阶段根回归 1935 项、1851 通过、0 失败、84 跳过。初版两次失败均保留：合成恢复时钟落后于真实 service runner 导致 `TASK_RUNNER_BUSY`；修正后又因停止竞态使目标已结束、`recover()` 返回 0。第四次回复保持屏障用于消除该测试竞态，不改变产品代码。

边界：Host 和 Agent 位于同一受控测试进程，HTTP 仅 loopback；这不是独立 Agent OS 进程、跨机网络、生产账户或机器重启证据。它只补齐真实 Agent 写路径及未确认效果的 Windows 组件证据，`stopWriteProvable`、`activationSupported`、`postActivationRollbackSupported` 继续 false，W06.15 不销项。

## 15. 独立 Agent OS 进程的真实外部效果与 Windows Job 隔离（E95）

E94 的 Host 与 Agent 同处一个受控进程。本节把 Agent 拆成独立 OS 进程：新 fixture 自行创建真实 `Agent`、配对并把 Streamable HTTP 服务监听到 `127.0.0.1:0`，再经 ready 文件交回 `{pid, machineId, token, port}`；Host fixture 以 `spawn(process.execPath)` 启动它，不再在同进程内建 Agent 或 server。写路径仍是真实 `remote-write`、Task service/journal 与 loopback HTTP，目标效果不手写。

- 进程独立性是断言，不是假设：停止前要求 `agentPid !== hostPid` 且两个 PID 都能被 `process.kill(pid,0)` 命中；Job 关闭后要求两个 PID 都变成 `ESRCH`，因此“Job 连带回收 Agent”是被观测的，而不是从 `treeStopped` 推断的。
- 前三次写入仍由 Host 逐项确认；第四次真实文件与 Agent succeeded 收据已存在而 Host 回复被 fixture 屏障保持，attempt 保持 running、效果未确认。
- 停止后的观测不再对刚被杀死的 WAL 库做原地只读打开：把 `agent.sqlite` 与 `agent.sqlite-wal` 复制到一次性目录后读副本，并对 `agent/` 下全部 `agent*` 文件（store、WAL、shm、instance 库与其 journal、lock）做含文件名的 SHA-256 指纹。窗口前后指纹与操作收据必须完全一致，“停止后没有新提交”因此由字节级证据支持，而不只是两条查询结果相等。
- 冷恢复仍走产品 `recover()`：第四次 attempt 为 `needs-reconciliation` + `HOST_INTERRUPTED/unknown`，`possiblyApplied` 不被错误清除。

失败留痕：原地只读打开刚被 Job 杀死的 WAL 库在修复前 5 轮中失败 3 轮（`SQLITE_IOERR_TRUNCATE`），而同一批文件事后由新进程以 readonly / readonly+immutable / readwrite 三种方式打开都正常，因此判定为观测方式与被杀写者遗留 wal-index/shm 状态的交互，不是文件内容或产品回归。修复只替换观测方式，并顺带把断言加强到字节级，未改产品代码；修复后专项连续 6 轮 1/1。

边界：Host 与 Agent 虽是独立 OS 进程，仍同机、同一 Windows Job、仅 loopback；它不是跨机网络、Job 之外的写者、生产账户或机器重启证据。`stopWriteProvable`、`activationSupported`、`postActivationRollbackSupported` 继续 false，W06.15 不销项。
