# 可恢复提交编排（停写栅栏切片 5）

状态：**设计，尚未实现或验收**。本文件只定义状态机、日志（journal）、恢复算法、门控判据与测试清单；不含源码改动，不放宽任何既有不变量，不授权访问真实用户数据。

上游依据：[持续栅栏设计](20261030_migration_stop_fence.md) §4/§6 切片 5；[栅栏原型](20261031_migration_fence.md)（切片 2）；[配置提交](20261029_migration_configuration_commit.md)；[数据归档](20261029_migration_data_archive.md)；[域名/资金审计](20261029_migration_domain_audit.md)；交接见 `docs/integration/HANDOFF-20261031-KIMI-E77.md` §3/§7、`docs/integration/HANDOFF-20261031-GLM.md` §6.2/§7。

## 1. 范围与非目标

切片 5 把切片 1/2/3 与既有配置事务、数据/账本归档**合成一个可恢复状态机**，只做编排、日志、门控与恢复；不复述各组件职责，也不放宽任何组件的不变量。

| 属于切片 5 | 不属于切片 5（明确不覆盖） |
|---|---|
| 七阶段状态机、journal、恢复算法、失败分类 | **切片 4**：真实 OS 隔离、旧进程停写、写句柄关闭、自动重启拦截、coordinator 死亡后隔离持续 |
| 复用 fence 共享/独占准入、写者清点、配置事务、数据/账本归档 | **Windows 命令面**（原生 Job/受限令牌命令后端）及任何命令执行能力 |
| `activationSupported`/`postActivationRollbackSupported` 的判据枚举（保持 false） | **激活后新增数据回退的实际执行**（只保留只读诊断） |
| 本机 Win11 纯合成环境 `node --test` 可验的编排层 | **生产常开、受保护网络、休眠、安装矩阵、真实 profile** |

不变量（编排层不得新增例外）：

| # | 不变量 | 落实方式 |
|---|---|---|
| I1 | `activationSupported=false`、`postActivationRollbackSupported=false` 恒为常量 | 输出与 gate 镜像均从常量派生，不接受调用方布尔 |
| I2 | **未完成校验的 capture 不得释放围栏** | release 前置条件显式枚举（§3.7、§8），缺一即 `blocked` 并保留 intent |
| I3 | 取消不是回滚 | `signal` 中止只落 `cancelled-fence-held`，回滚必须另有 `rollback` 路径并恢复原字节 |
| I4 | 停止证据不能由终态冒充 | 只认排空观测 + 写者清点 + 既有原操作收据；`stopWriteProvable:false` 恒置 |
| I5 | 日志先行（intent-before-effect） | 每个副作用前先落不可变步骤记录，崩溃后据此判定 |
| I6 | 不绕过授权、无原生 shell 回退、不放宽模型面 | 编排层不新增任何授权/命令/模型入口 |
| I7 | 同一 `operationId` 同一时刻只有一个 owner | 每次副作用前复查 owner 身份（host+pid+startTicks） |
| I8 | 纯合成可测，不依赖 Docker/远程主机 | 依赖注入 + temp home；真实 fence 与真实配置事务在本机跑 |

## 2. 七阶段状态机

```text
inspect -> intent -> drain -> capture -> maintenance -> activate -> release
```

| 阶段 | 前置阶段 | 正常退出条件 | 阻塞态（需人工） | 可跳过 |
|---|---|---|---|---|
| `inspect` | — | 域/写者/计划只读采集完成并落 `operation` + 首条 step | `blocked-inspect` | 否 |
| `intent` | inspect | durable intent 已原子落盘且 owner 已记录 | `blocked-owner` | 否 |
| `drain` | intent | `liveShared===0` 且 exclusive 取得成功 | `blocked-drain` | 否 |
| `capture` | drain | 数据归档与账本归档均 `verify*` 通过 | `blocked-capture` | 否 |
| `maintenance` | capture | 配置事务到达 `maintenance`（或 `validating`）且 `recognized` | `blocked-maintenance` | 否 |
| `activate` | maintenance | 判据全真（本切片永不成立） | `blocked-activation` | 否 |
| `release` | 上述前置 AND | `fence.release()` 后补写 `released` | `blocked-release` | 否 |

合法前向迁移只有上表相邻一步；任一阶段可转入 `blocked-*` 或 `cancelled-fence-held`（intent 之后）。**没有从 `activate` 到 `committed` 的路径**，也没有从任何阻塞态自动恢复的路径。

## 3. 逐阶段定义

### 3.1 `inspect`

| 项 | 定义 |
|---|---|
| 输入 | `{home, operationId, domains:[{name,roots[]}], privateOutput, profilePlan, limits, signal}` |
| 前置条件 | `home` 为 canonical 目录；`privateOutput` 绝对路径、不在 `home` 内、不与任何 domain root 重叠；`operationId` 匹配 `/^[A-Za-z0-9_.-]{1,128}$/` |
| 日志记录 | `operation.private.json`（一次写入，不可变）+ `step-00000.json {phase:'inspect', step:'plan-recorded', evidence:{domainsDigest, profilePlanDigest}}` |
| 幂等规则 | 重入只校验 `operationId`/`domainsDigest`/`profilePlanDigest`；不一致 → `MIGRATION_ORCH_OPERATION_MISMATCH`，绝不覆盖既有记录 |
| 崩溃后恢复 | `operation` 在而首条 step 缺 → 重放只读采集；两者皆缺 → 从零开始；`operation` 校验失败（非普通文件/链接/超限/哈希不符）→ `blocked-inspect`，且**不创建任何 fence 状态** |

写者清点（`inventoryMigrationWriters`）结果只作为 `evidence.writerObservationDigest` 记录；Win11 上必得 `enumeration.mode==='unavailable'`，必须原样记录为 `degraded`，不得折算成"无写者"。

### 3.2 `intent`

| 项 | 定义 |
|---|---|
| 输入 | `{home, operationId, signal}`；复用 `beginMigrationExclusive` 的**意图落盘语义**，但本阶段不取 exclusive |
| 前置条件 | inspect 完成；`readMigrationStartupGate` 为空或为终态（`committed`/`rolled-back`），否则 `MIGRATION_ORCH_GATE_PENDING` |
| 日志记录 | `step-00010 {step:'fence-intent-requested'}` → 落盘 → `step-00011 {step:'fence-intent-persisted', evidence:{intentDigest, owner:{host,pid,startTicks}}}` |
| 幂等规则 | intent 同 id 且 owner 即本进程 → 复用；同 id 而 owner 不同 → `MIGRATION_ORCH_OWNER_UNCERTAIN`（§6 G1）；不同 id 且 owner 存活 → `MIGRATION_FENCE_BUSY` |
| 崩溃后恢复 | 只有 `requested`：读实际 intent；缺失 → 重放；不可解析 → **fail-closed**（§6 G2）标 `blocked-owner`；owner 死亡 → 由接管者重建并重新排空 |

进入 `intent` 之后，任何阶段都不得为"恢复服务"删除 intent；只有 §3.7/§8 的前置成立时才移除。

### 3.3 `drain`

| 项 | 定义 |
|---|---|
| 输入 | `{home, operationId, drainTimeoutMs(默认 60000), pollMs, onShared, signal}` |
| 前置条件 | intent 已持久化（`step-00011`）；exclusive 未建立 |
| 日志记录 | `step-00020 {step:'drain-started', evidence:{deadline}}` → `step-00021 {step:'drain-completed', evidence:{observedHolders, elapsedMs, liveShared:0}}` → `step-00022 {step:'exclusive-acquired', evidence:{ownerIdentity, exclusiveDigest}}` |
| 幂等规则 | 同 id 重入前必须先读 `exclusive` 比对 owner（当前 fence 对同 id 不做 owner 校验，§6 G1）；owner 是本进程才复用，否则拒绝 |
| 崩溃后恢复 | `drain-started` 无 `drain-completed` → intent 仍在（阻断新准入），exclusive 可能缺失；接管者必须验证旧 owner 死亡后**重新排空**，不得复用旧观测，不得把超时当作排空完成 |

排空期间观测到的 holder 只累加计数，不逐条落盘（避免日志膨胀与逐条泄漏 pid）。

### 3.4 `capture`

| 项 | 定义 |
|---|---|
| 输入 | `{inventory(来自 inspectMigrationSources), configurationPlan(status==='ready'), dataArchiveRoot, ledgerArchiveRoot, signal}` |
| 前置条件 | 排空完成 + exclusive 持有（每个子步骤前 `fence.verify()`）；两份归档目录互不重叠且不与源域重叠 |
| 日志记录 | `step-00030 {step:'capture-started'}` → `step-00031 {step:'capture-verified', evidence:{captureManifestSha256, captureCounts, ledgerManifestSha256, ledgerContentDigest}}` |
| 幂等规则 | 已有 `capture-verified` 且重算摘要一致 → 跳过；摘要不符 → `MIGRATION_ORCH_CAPTURE_MISMATCH`，保留旧归档并另建新目录 |
| 崩溃后恢复 | 有 `capture-started` 无 `verified` → 归档可能缺 `capture.private.json`；在新私有目录重跑 `createMigrationDataArchive`/`createMigrationLedgerArchive` 并 `verify*`，**绝不**用半成品进入 `maintenance` |

`crossDomainConsistent:false`/`databaseConsistent:false` 是常量，因此"capture 通过"只表示字节已保存且自洽，**不表示**存在跨域一致点。

### 3.5 `maintenance`

| 项 | 定义 |
|---|---|
| 输入 | `{privateOutput(配置事务目录), changes(before/maintenance/after 字节), phase:'maintenance' \| 'install'}` |
| 前置条件 | capture 已校验；exclusive 持有；六项 attestations 仅记录、不接受为已验证（§7 C6） |
| 日志记录 | 配置事务自有 `event-NNNNN.json` 链；编排只记 `step-00040 {step:'maintenance-started', evidence:{planDigest}}`、`step-00041 {step:'maintenance-installed', evidence:{gatePhase, journalEvents, journalHead}}` |
| 幂等规则 | 复用 `resumeMigrationConfigurationCommit` 的既有幂等（`recognized`/`accepted` 判定）；重复调用返回同一 gate phase |
| 崩溃后恢复 | 先重建 fence（owner 死亡 → 接管），再 `inspectMigrationConfigurationCommit`；`recognized===false` → `blocked-maintenance`，不自动 rollback；配置事务 `recover:true` 只接受原始或日志内 identity |

每个 `onStep` 回调先 `assertFenceHeld`（§6 G7），失败即抛；事务自身的崩溃一致性保证可恢复。

### 3.6 `activate`

| 项 | 定义 |
|---|---|
| 输入 | `{criteria(§7 的固定枚举), verifier(注入; 默认恒拒绝), signal}` |
| 前置条件 | §7 判据全部为真且 verifier 返回 `{allowed:true, evidence}`；默认 `verifier = () => ({allowed:false, code:'MIGRATION_ORCH_ACTIVATION_UNSUPPORTED'})` |
| 日志记录 | `step-00050 {step:'activation-evaluated', evidence:{criteria:[{id,ok}], deniedBy}}`；拒绝时 `step-00051 {step:'activation-refused'}` |
| 幂等规则 | 评估是纯函数 + 只读证据，可重复；判据 id 与顺序固定，结果与 journal 绑定 |
| 崩溃后恢复 | 有 `evaluated` 无 `refused` → 重跑评估；出现任何部分写入 → `blocked-activation` |

本阶段**永不**写 `migration-gate.json` 的 `committed`（配置事务自身也会以 `MIGRATION_POST_ACTIVATION_ROLLBACK_REQUIRED` 拒绝）。

### 3.7 `release`

| 项 | 定义 |
|---|---|
| 输入 | `{home, operationId, preconditions(由 journal 重新推导), signal}` |
| 前置条件（硬性 AND） | ① `step-00021 drain-completed`；② `step-00031 capture-verified` 且两份归档重算摘要一致；③ gate ∈ `rolled-back` 且 `inspectMigrationConfigurationCommit.recognized===true`（原字节已恢复），或 activate 判据全真（本切片永不成立）；④ 写者清点无新增写句柄（Linux best-effort；Windows 记录 `degraded`）；⑤ owner 与 journal 一致 |
| 日志记录 | `step-00060 {step:'release-requested', evidence:{preconditions:[{id,ok}]}}` → `fence.release()` → `step-00061 {step:'released', evidence:{exclusiveGone:true, intentGone:true}}` |
| 幂等规则 | 已 `released` 再请求 → 返回 journal 终态，不再调用 fence；重放 `release` 前先读 `readMigrationFence` |
| 崩溃后恢复 | 有 `release-requested` 无 `released`：exclusive/intent 仍在且 owner 是本进程 → 重放；二者均已移除 → 补写 `released`（记录观测，不假设）；intent 在而 exclusive 不在 → `blocked-release`，**不得**直接删 intent |

## 4. journal schema

### 4.1 目录布局

```text
<privateOutput>/                  owner-only 新建目录（createPrivateMigrationDirectory）
  operation.private.json          不可变操作记录（一次写入）
  step-00000.json … step-000NN.json  不可变 append-only 哈希链（<=1000 条）
```

**不写可变头部/最新指针**：状态一律由链推导，避免第二权威与半写风险（与配置事务用 gate 作可变头部的做法刻意不同）。

### 4.2 操作记录字段

| 字段 | 类型 | 含义 | 校验 |
|---|---|---|---|
| `schemaVersion` | `1` | 版本 | 必须相等 |
| `kind` | `'migration-commit-operation'` | 类型 | 必须相等 |
| `operationId` | string | 单一 id（= fence intent/exclusive = plan.id = gate.operationId） | 正则 + 三方一致 |
| `home` / `privateOutput` | string | canonical 绝对路径 | `realpath` 复核 |
| `domains` / `domainsDigest` | array / sha256 | 显式数据域与物理根（私有） | 重算摘要 |
| `profilePlanDigest` / `profilePlanStatus` | sha256 / string | 就绪的配置计划绑定 | 必须 `ready` |
| `limits` | object | 有界参数（轮询、超时、条数上限） | 白名单键 + 整型范围 |
| `createdAt` / `host` | number / string | 诊断用，不参与判定 | 类型 |
| `activationSupported` / `postActivationRollbackSupported` | `false` / `false` | 常量 | 读到 `true` 即判 `blocked` |

### 4.3 步骤记录字段

| 字段 | 说明 |
|---|---|
| `index` | 0..N，必须连续，`<=1000` |
| `phase` | `inspect` \| `intent` \| `drain` \| `capture` \| `maintenance` \| `activate` \| `release`，链上单调不降 |
| `step` | 固定枚举字符串（§3 各表），未知字符串即 `MIGRATION_ORCH_JOURNAL_INVALID` |
| `previous` | 前一条 `digest`；`index===0` 时为 `operation.private.json` 的 sha256 |
| `operationId` | 与操作记录相等；防止步骤跨操作搬运 |
| `at` | `Date.now()`，仅诊断，不参与恢复判定 |
| `evidence` | 白名单字段、单条 ≤16KiB；不得含凭据、源路径全文或金额明细 |
| `digest` | `sha256(JSON.stringify(去掉 digest 的记录) + '\n')` |

### 4.4 原子写入方式与写入顺序

| 要求 | 做法 |
|---|---|
| 步骤写入 | `writePrivateMigrationFile(dir, name, bytes)`：`open(...,'wx',0o600)` + `writeFile` + `fsync` + 读回哈希校验；无覆盖路径，`EEXIST` → 读回比对后视为已写 |
| 顺序 | 每个副作用：`step(requested)` → 副作用 → `step(completed)`；两条独立不可变记录，从不改写 |
| 操作记录 | 一次写入；重复写必 `EEXIST`，恢复路径改为读回校验 |
| 目录项持久化 | 非 win32 调用等价 `syncDirectory`；Windows 如实记为不支持（与配置事务一致） |
| fence 侧 | 本层不把 `intent.json`/`exclusive.json` 当作权威（它们是覆盖写、非原子，§6 G2），只作阻断新准入的运行时开关；判定一律以 journal 为准 |

### 4.5 `operationId` 与三方绑定

单一 id 由编排生成或由调用方提供并校验，强制 `fence.intent.operationId === fence.exclusive.operationId === plan.id === gate.operationId === operation.operationId`。当前 `prepareMigrationConfigurationCommit` 内部 `randomUUID()` 生成且**不接受外部 id**（§6 G3），因此该绑定是下一波实现的必做项，不是可选优化。

### 4.6 从任一阶段恢复的算法

```text
resumeMigrationCommitOperation({ privateOutput, signal }):
  1  op    <- readAndVerifyOperation(privateOutput)      // 不可变、严格、非链接、<=16KiB
  2  steps <- loadChain(privateOutput)                   // 连续/previous/digest/phase 单调/operationId
  3  state <- deriveState(steps)                          // 末条 step -> 下一步动作与是否终态
  4  if state.terminal: return summarize(state)           // released / blocked-* / cancelled-fence-held
  5  world <- observe(fence: readMigrationFence, gate: readMigrationStartupGate,
                      capture: verifyMigrationDataArchive + verifyMigrationLedgerArchive,
                      commit: inspectMigrationConfigurationCommit)
  6  reconcile(state, world, op):
       world 领先（副作用已发生、无 completed 记录）-> 追加 step(observed-*)（不重做副作用）
       world 落后（无副作用痕迹）                   -> 重放该阶段幂等动作
       矛盾（owner 存活且非本进程 / capture 摘要不符 / gate operationId 不符 /
             第三方编辑 / journal 不可解析）          -> append step(blocked) 且保留 intent
  7  任何副作用动作前：assertOwnerAndFence(op, steps)     // host+pid+startTicks 与 fence 一致
  8  return summarize(deriveState(loadChain(privateOutput)))
```

恢复的不变量：幂等重放；不可变记录永不覆盖；矛盾即停；崩溃永不导致围栏释放；阻塞步骤只能由新证据后的显式新步骤推进。

## 5. 映射表：阶段 → 复用组件 → 需新增

| 阶段 | 复用的既有组件/函数（文件:行） | 需新增（模块/函数） |
|---|---|---|
| `inspect` | `inventoryMigrationWriters` (migration-writer-inventory.mjs:22)、`previewProfileMigration`/`verifyProfileMigrationSources` (profile-migration-plan.mjs:142/103)、`inspectMigrationSources` (migration-snapshot.mjs:37) | `migration-commit-orchestration.mjs`: `inspectMigrationCommitOperation`、`readOperationRecord` |
| `intent` | `beginMigrationExclusive` 意图段 (migration-fence.mjs:106-119)、`readMigrationFence` (:157) | `beginMigrationCommitOperation`、`assertFenceHeld`、`assertOwnerAndFence` |
| `drain` | `beginMigrationExclusive` 排空段 (:120-138)、`acquireMigrationShared` (:71) | `drainPhase`、`reconcileOwnership` |
| `capture` | `createMigrationDataArchive`/`verifyMigrationDataArchive` (migration-data-archive.mjs:29/110)、`createMigrationLedgerArchive`/`verifyMigrationLedgerArchive` (migration-ledger-export.mjs:102/133) | `capturePhase`、`captureEvidence`（两份 manifest 摘要） |
| `maintenance` | `prepareMigrationConfigurationCommit`/`resumeMigrationConfigurationCommit`/`inspectMigrationConfigurationCommit` (migration-configuration-commit.mjs:157/179/198) | `maintenancePhase`、`fenceGuardOnStep` |
| `activate` | `readMigrationStartupGate`/`assertMigrationStartupAllowed` (migration-startup-gate.mjs:5/25) | `evaluateActivationCriteria`、`ACTIVATION_CRITERIA`、`ACTIVATION_SUPPORTED`(=false 常量) |
| `release` | `beginMigrationExclusive(...).release()` (migration-fence.mjs:145-153) | `releasePhase`、`releasePreconditions`、`abandonMigrationIntent`(若采纳 §6 G4) |
| 全程 | `createPrivateMigrationDirectory`/`writePrivateMigrationFile`/`hashPrivateMigrationFile` (migration-private-files.mjs:9/24/33) | `appendStep`、`loadChain`、`deriveState`、`summarizeMigrationCommitOperation` |
| 只读旁证 | `diagnoseMigrationRollbackReadiness` (migration-rollback-readiness.mjs:25)、`auditMigrationRecovery` (migration-recovery-audit.mjs:294) | 仅在回退分支只读调用，**不**用于 `activate` |

## 6. 既有组件与阶段语义的缺口（下一波必做）

| # | 缺口（证据） | 影响 | 建议 |
|---|---|---|---|
| G1 | 同 `operationId` 重入无 owner 校验：fence 只在 id 不同时判存活（migration-fence.mjs:113-117），同 id 直接 `writeFile` 覆盖 `exclusive.json`（:137）；`release` 亦只比对 id（:148） | 两个进程以同一 id 并发恢复时双方 `verify()` 均为 true，可"双双持有"围栏 | fence 增加 `ownerToken` 并在 `verify`/`release` 比对；编排层 §4.6 第 7 步强制 owner 检查作纵深防御 |
| G2 | intent/exclusive 非原子写：直接 `writeFile`（:118/:137）；`readJson` 解析失败返回 `null`（:38），而准入判断用 `if (await readJson(p.intent) \|\| ...)`（:76） | 崩溃留半写 intent 时**新 writer 会被放行**，维护态被静默解除 | 改用 `atomicJson`（temp+rename+目录 fsync，参考 migration-configuration-commit.mjs:28-32）+ `readJsonStrict`（解析失败抛 `MIGRATION_FENCE_INTENT_UNREADABLE`）；编排层对不可解析一律 fail-closed |
| G3 | `prepareMigrationConfigurationCommit` 自生成 id：`const id=randomUUID()`（migration-configuration-commit.mjs:161），gate 与 plan 都用它，无外部 id 入参 | 无法让 fence 与 gate 共用同一 id，"单一 operationId" 不变量只能在实现层事后反推 | 新增可选 `operationId`（校验格式与唯一），缺省仍 `randomUUID` |
| G4 | drain 超时后无法安全撤回 intent：`release()` 要求 exclusive 与 intent 同时匹配（:148），而超时时 exclusive 尚未建立 | 维护态永久卡住，只能靠接管者覆盖；运维只有"删文件"这条危险路径 | 新增 `abandonMigrationIntent(home,{operationId, reason, evidence})`，仅当 journal 无 `capture-verified` 且无 maintenance 发布时允许，否则拒绝 |
| G5 | `migration-startup-gate` 仅 29 行且与 fence 无接线：`assertMigrationStartupAllowed` 只读 gate（:25），唯一调用点 `.dsh-plugin/index.mjs:2253`，且只调用一次 | "读 gate → 建 writer" 竞态在产品路径上**仍未关闭**（关闭它的是 fence 的 `acquireMigrationShared`，无人调用）；已启动 Host 完全不受新 gate 影响 | 本切片**不**改产品入口（否则把编排链拉进发布闭包）；把它列为 §7 C9 的前置证据。未来接线须"取共享准入 → 复查 gate → 才建 writer"，释放语义同 fence |
| G6 | gate 相位与编排七阶段不相交：`phases` 为 prepared/maintenance/installing/validating/committed/rolling-back/rolled-back（migration-startup-gate.mjs:3） | 无法把编排阶段镜像进 gate 而不破坏其严格 schema | gate 只镜像配置事务四态，编排阶段只存在于自己的 journal；`activate` 永不写 `committed` |
| G7 | 配置事务无 fence 校验注入点：`resumeMigrationConfigurationCommit` 只有 `onStep`（:179），无 `guard` | "每次不可逆发布前校验活的排他授权"只能靠 `onStep` 抛错 | 短期用 `onStep` + `assertFenceHeld`（崩溃一致性由事务保证）；中期新增可选 `guard`，在每个 `event()` 前后调用 |
| G8 | capture 与操作无绑定：`capture.private.json`（migration-data-archive.mjs:84）与账本 `archive.private.json`（migration-ledger-export.mjs:125）都不含 `operationId` | 归档可被搬到另一次操作，释放前置的"已验证 capture"失去归属 | 编排 journal 记录两份 manifest 的 sha256 + 目录 realpath 并在恢复时重算；不改两个归档组件的 schema |
| G9 | Windows 写者清点恒不可用：`enumeration.mode='unavailable'`（migration-writer-inventory.mjs:69-73），`stopWriteProvable:false`（:156） | inspect 在 Win11 必然 degraded，"无写者"前提不成立 | 如实记录 `degraded`，任何以"无写者"为前提的判据（§7 C4/C5）在 Windows 一律 false |
| G10 | fence 无 generation/fencing token：`intent.json` 只有 schemaVersion/operationId/pid/startTicks/createdAt（:118） | 无法表达"代际"，跨机/存储端 fencing 无从表达 | 编排用 `operationId`+`startedAt` 作本机单调序；不发明伪 token，跨机留给独立设计 |

## 7. 门控判据：`activationSupported` / `postActivationRollbackSupported` 为何是 false

| # | 判据 | 当前事实 | 翻真所需证据 | 归属 |
|---|---|---|---|---|
| C1 | 切片 4：真实 OS 隔离与旧进程停写 | 不存在 | 专用账户/设备上旧 Host 停写、写句柄关闭、自动重启拦截、coordinator 死亡后隔离持续的实测 | 切片 4（前置） |
| C2 | 跨域一致捕获 | `crossDomainConsistent:false` 常量（data-archive:84、ledger-export:125） | 存储端一致点方法（只读重挂/存储快照）与逐域一致证据 | 新设计 |
| C3 | 数据库一致 | data archive 恒 false；ledger 仅单库 true | 全部 SQLite 在同一停写窗口内各自一致备份 | 新设计 |
| C4 | 写者枚举可用性 | Windows `unavailable`；Linux 部分可读才算 partial | 平台句柄枚举或 OS 控制器的可验证实现 | 切片 4 / Windows 面 |
| C5 | 停止证据 | 只有参与方自愿释放（`liveShared===0`） | 非参与旧写者的强制隔离证据（依赖 C1） | 切片 4 |
| C6 | 六项 attestations（`stopped-hosts,complete-domains,consistent-backups,artifact,permissions,money`） | 只是 plan 里的字符串常量（configuration-commit:169），无任何验证器 | 每项一个可执行验证器 + 与 journal 的证据绑定 | 切片 5+ |
| C7 | 唯一资金权威代际切换 | 无执行器（`router_migration` 只有读取侧） | 权威切换协议 + 双向对账 | 后续 |
| C8 | 激活后最新数据回退 | 只有只读诊断（rollback-readiness:25） | 实际导出 + 双向对账 + 资金 guard 验证 | 后续 |
| C9 | gate 与 fence 产品接线 | 未做（G5） | 产品入口"先取准入再建 writer"并实测竞态 | 切片 5+（需评审） |
| C10 | Windows 原生命令面（与旧入口抑制同源） | 只有 never-started 证据 | 原生 Job/受限令牌实现与实测 | 独立设计 |

**为何切片 4 是前置**：C1、C5 是"非参与写者"的唯一出路，而 `release` 的可信度与 `capture` 的代表性都建立在"磁盘上没有别的写者"之上。没有切片 4，release 只能证明"参与方已退出"，无法证明"没有其他写者"，因此 `activationSupported` 不能翻真。切片 4 是平台/凭据门槛，而本切片的编排、日志与恢复可在本机 Win11 纯合成 home 内完整推进与验证。

## 8. 失败分类与终态

| 失败 | 触发 | 实际状态（fence / gate） | 编排终态 | 允许的下一步 | 禁止 |
|---|---|---|---|---|---|
| `MIGRATION_ORCH_DRAIN_TIMEOUT` | 排空超过 `drainTimeoutMs` | intent 在、exclusive 无 / gate 未变 | `blocked-drain` | 接管者重试排空；或 `abandonMigrationIntent`（仅当无 capture-verified 且无 maintenance 发布） | 直接删 intent 以"恢复服务" |
| `MIGRATION_CAPTURE_*` / `MIGRATION_ORCH_CAPTURE_MISMATCH` | 归档校验失败、源漂移、空间不足、摘要不符 | exclusive 保持 / gate 未变 | `blocked-capture` | 新私有目录重捕获并 `verify*` | 用半成品归档进 `maintenance`；用 capture 反推"已停写" |
| `MIGRATION_COMMIT_*`（SOURCE_CHANGED/BUSY/JOURNAL_INVALID/PHASE_INVALID） | 配置事务失败或并发编辑 | exclusive 保持 / gate 停在 prepared/maintenance/installing/validating | `blocked-maintenance` | `inspectMigrationConfigurationCommit` 判定后走 pre-activation `rollback` 并 `recognized===true` | 把 `validating` 当激活完成；自动 rollback 覆盖第三方编辑 |
| `MIGRATION_ORCH_ACTIVATION_UNSUPPORTED`（verifier 拒绝） | 判据未全真（恒如此） | exclusive 保持 / gate 不写 `committed` | `blocked-activation` | 只能 `rollback` → `release` | 写 `committed`；以任何布尔参数翻真 |
| `signal.aborted`（取消） | 调用方中止 | intent 之后仍持有 | `cancelled-fence-held`（intent 前为 `cancelled`） | 与对应阻塞态同路径处理 | 把取消当回滚；取消即释放围栏 |
| `MIGRATION_FENCE_BUSY` / `MIGRATION_ORCH_OWNER_UNCERTAIN` | 存活的外部 owner | 不改变任何状态 | `blocked-owner` | 人工确认 owner 已死亡后重试 | 抢占存活 owner |

**围栏释放的四个硬前提**（与 §3.7 一致，任一不满足即 `blocked-release` 且保留 intent）：已验证 capture（数据 + 账本归档均 `verify*` 通过）、排空观测（`drain-completed`）、配置终态（`rolled-back` + 原字节恢复 `recognized`，或 activate 判据全真）、owner 一致。**未完成校验的 capture 不得释放围栏；取消不是回滚。**

## 9. 下一波测试清单

| # | 用例 | 类型 | 期望 |
|---|---|---|---|
| 1 | 崩溃注入：`operation` 已写、首条 step 缺失 | 崩溃 | 重放只读 inspect，不创建 fence 状态 |
| 2 | 崩溃注入：`fence-intent-requested` 之后、落盘之前 | 崩溃 | 重放落盘或 fail-closed，不释放 |
| 3 | 崩溃注入：intent 落盘之后、`drain-started` 之前 | 崩溃 | `blocked-drain` 起点，intent 仍在 |
| 4 | 崩溃注入：排空进行中（真实 holder 存活） | 崩溃 | 接管者重新排空，不复用旧观测 |
| 5 | 崩溃注入：exclusive 建立之后、`capture-started` 之前 | 崩溃 | 重放 capture，多建新目录不覆盖半成品 |
| 6 | 崩溃注入：capture 目录半成品（无 `capture.private.json`） | 崩溃 | `blocked-capture`，fence 不释放 |
| 7 | 崩溃注入：`capture-verified` 之后、`maintenance-started` 之前 | 崩溃 | 重放 maintenance，gate 仍非终态 |
| 8 | 崩溃注入：maintenance 的 6 个既有 `onStep` 边界 | 崩溃 | 复用 `tests/fixtures/migration-commit-crash.mjs` 模式，publish 不半激活 |
| 9 | 崩溃注入：`activation-evaluated` 之后、`refused` 之前 | 崩溃 | 重跑评估，仍拒绝 |
| 10 | 崩溃注入：`release-requested` 之后、`fence.release()` 之前 | 崩溃 | 重放 release 且前置重算一致 |
| 11 | 崩溃注入：`fence.release()` 之后、`released` 记录之前 | 崩溃 | 补写 `released`（观测），不二次删除 |
| 12 | 不变量：capture 未 verified + 任一恢复路径 | 不变量 | `readMigrationFence().maintenanceActive===true`，`release` 拒绝 |
| 13 | 不变量：每个终态的 `activationSupported`/`postActivationRollbackSupported` | 不变量 | 恒 `false`；`stopWriteProvable` 恒 `false` |
| 14 | 不变量：取消不释放围栏、不改 gate | 不变量 | `cancelled-fence-held` + intent 仍在 |
| 15 | 不变量：`operationId` 三方一致（fence/gate/plan）在 prepare 前后 | 不变量 | 全部步骤后仍相等（依赖 §6 G3 修复） |
| 16 | 负例：intent 半写（截断 JSON） | 负例 | 新 shared admission 被拒绝（fail-closed）且编排 `blocked-owner` |
| 17 | 负例：两进程同 `operationId` 并发恢复 | 负例 | 只有一个推进，另一个 `MIGRATION_ORCH_OWNER_UNCERTAIN` |
| 18 | 负例：gate `operationId` 与 operation 不同 | 负例 | `blocked`，不写任何配置字节 |
| 19 | 负例：归档被改一个字节 | 负例 | `blocked-capture`，不进入 maintenance |
| 20 | 负例：drain 超时后直接调 `fence.release()` | 负例 | `MIGRATION_FENCE_NOT_HELD`（证明 G4 缺口真实存在） |
| 21 | 负例：gate 停在 `validating` 时请求 activate | 负例 | `blocked-activation`，不写 `committed` |
| 22 | 平台：Linux 写者清点出现写句柄 | 不变量 | 记 advisory 并留证，不阻断 capture（不是停写证明） |
| 23 | 平台：Windows `enumeration.mode==='unavailable'` | 不变量 | 记录 `degraded`，判据 C4/C5 恒 false |

测试落位：`tests/migration-commit-orchestration.native.mjs`（真实子进程崩溃注入）与纯函数评估可拆 `tests/migration-commit-orchestration.test.mjs`；两者都须加入 `npm test` 列表。若编排模块被产品入口导入，还必须加入 `package.json` 的 `files`（`scripts/check-package.mjs` 的 `assertRuntimeClosure`，见 `tests/ci-contract.test.mjs:6`），否则闭包测试失败；本切片默认**保持私有、不接线产品入口**。

## 10. 交付边界

- 本切片的完成定义：设计被接受 → 下一波实现通过 §9 全部用例 → 全量 `npm test` 0 失败 → 台账由主代理同步（本文件不改 `tasks.json`/`behavior-audit.json`）。
- 永不改变：`activationSupported`、`postActivationRollbackSupported`、`stopWriteProvable`、资金 `rollback()` guard、冻结 DS vendor。
- 不在本切片：切片 4（OS 隔离）、Windows 命令面、激活后新增数据回退的实际执行、生产常开与受保护网络。
- 文档边界：本文件是设计与测试契约，不是实现验收证据；任何"编排通过"都不得写成产品迁移能力。

## 11 实现偏差登记
- `operationId` 必须为 UUID v4（gate 读侧限制；主代理已批准）；省略时用 `randomUUID()`（v4），非 v4 一律 `MIGRATION_ORCH_OPERATION_ID_UNSUPPORTED`。
- fence 无 intent-only API：`intent`/`drain`/`exclusive` 三段由一次 `beginMigrationExclusive` 完成；`fence-intent-requested` 是该事务的 intent-before-effect 记录，其余五条为事后观测；从 `blocked-drain` 重试时跳过 `fence-intent-persisted` 以保持 phase 单调不降。
- `resume`/`inspect` 不能仅凭 journal 重算 capture 与 gate：调用方须再次提供私有归档根、配置事务目录与 sqlite 驱动；缺失即 `MIGRATION_ORCH_INPUT_REQUIRED`，不落任何步骤（operation 记录 ≤16KiB 且只在 inspect 写入）。
- owner 一致（§8 硬前提④）= 活 exclusive 的 `operationId` + 链上确有 fence 记录；刻意不比对 journal 所记 pid 的存活（否则合法接管不可能；活外部 owner 已由 fence 的 `OWNER_CONFLICT` 拒绝）。
- §3.7 ⑤ 写者清点只作 advisory 证据（Windows `degraded` 不阻断释放），与 §8 的四硬前提一致；C4/C5 恒 false。
- `blocked-owner` 是 `intent` 阶段的判定名，其余阶段记 `blocked-<phase>`；同一 phase+reason 至多记录一次，已有 `blocked-*` 时不再改记其它阶段的判定，新证据只能以新的前向步骤推进。
- `blocked-inspect` 只由只读 `inspectMigrationCommitOperation` 报告、不落步骤：operation 记录不可校验时无法为其 sha256 锚定 index 0。
- drain 超时不产生任何句柄，围栏侧唯一安全出口是 `abandonMigrationIntent`（任何 exclusive 记录一律拒绝）；编排层不重复实现该语义。
- stale shared claim 的回收沿用 fence 既有语义（死 owner 即 unlink），编排层不改写，只把观测累加进 `observedHolders`。
- 诊断缝 `onBoundary`/`onCommitStep` 仅供真实子进程崩溃注入与状态整形使用，不能改变状态。
- E79 加固：fence 与配置事务的 JSON 原子发布在 `rename` 遇到 `EPERM`/`EACCES`/`EBUSY` 时采用首次尝试加最多 5 次重试、固定间隔 50ms；其他错误立即抛出，耗尽后保留最后一个原始错误。临时文件仍由 `atomicJson` 的 `finally` 清理，重试不改变原子性、严格读或任何激活判据。
