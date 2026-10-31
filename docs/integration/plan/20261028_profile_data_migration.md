# 配置、数据迁移与回退实施设计（2026-10-28）

本文件是 W03.4 / W06.3、T48 / T49 的施工设计。§14 记录已实现并做离线验证的第1步兼容入口，**完整迁移与回退工具尚未实现或验收**。没有读取或修改真实用户 profile，也没有执行用户数据迁移或真实模型请求。当前工程状态以仓库内 docs/integration/HANDOFF-20261028.md 顶端为准，E40–E44 的历史证据不改写。§1 保留施工前审查发现，最新兼容入口进展见 §14。

## 1. 已有能力与必须补齐的缺口

| 领域 | 已有实现 | 本次必须补齐 |
|---|---|---|
| DS 数据域 | `modules/bot-runtime/index.mjs` 调用同一份冻结 `createRuntime`；默认仍是 `<DSH_HOME>/bot`，Bot/群/记忆格式未重建 | 公开安装入口没有把旧 DS runtime config 传给 `startBotProduct`，自定义 `home/workspace` 等尚不能保真迁移 |
| MR 主入口 | 包名保留 `@ljwei-stak/dsh-model-router`，Cordis id 仍为 `model-router-galgame` | 不能只删除 `ds-bot` bundle；需保留搜索插件、用户 patch、模型/预算偏好与启动来源 |
| DS 搜索 | 冻结 `ds-bot/cordis.patch.yml` 插入 `bot`、`web-search-auto`，并把 `web` 配为 `searchProvider:auto, fetchProvider:http` | 根 bundle 目前只插 MR。须提供统一包内的搜索子入口并真实挂到 SDK loader；迁移旧 search 覆写与 disabled 状态 |
| 金额权威 | `sqlite-router-state.mjs` 已做旧 JSON 备份、prepared/marker/active 切换、故障恢复、最新金额回退；schema4 与 Task 原子准入已验证 | 不重写金额算法。补全 profile 级停写/提交日志、全域对账、Task/plan/receipt 导出和位置移动协议 |
| 回退 | `rollback()` 导出最新资金快照而非恢复过时备份，拒绝 holds 与活动任务，旧 JSON writer 拒绝 version4 marker | 现有安全终态查询仅允许 succeeded/failed/cancelled，DAG blocked 终态会被长期拒绝；需在完整导出新任务后细化。不是让 active/unknown 通过 |
| 数据搬家 | 固定上游 `app/src/import.mjs` 有只读源导入、Session 复制与模型行挑选思路 | 此代码不在迁入的 297 文件内，且只找默认 bot home、提前写凭据/模型设置、分批替换 Sessions、删除 agents/workspaceId；不能直接当本工程幂等/回退迁移器 |

现有 `router_migration.source`、`backup` 是绝对路径，启动会核对 `source === legacyFile`。因此不能先在临时路径激活资金库，再把整个目录改名到最终位置；也不能把已激活库直接复制到另一个 `DSH_HOME` 后声称可用。需要稳定最终位置或显式位置移动协议。

## 2. 迁移的两个明确模式

1. **原位切换 `in-place`**：保留现有 DSH home、实际 DS bot home、工作目录和所有用户数据路径，只切换选定 profile 的入口与配置，按既有组件切换资金权威。默认不搬 Bot/Session，不重建 ID。先在完整隔离副本实现和验收；真实路径必须由用户明确选择，不能自动扫描后就写默认 home。
2. **只读源导入 `copy-import`**：源目录只读，目标是新产品选定的新数据位置，生成独立数据世代；适用于可选 Desktop 或新 Web 部署。目标原有数据不可默默覆盖。源与目标不能相同、嵌套，或经 junction/symlink 指向同一位置。旧来源仍保持原字节；切换后只运行新目标，不能把两个独立安装当成同一资金权威。

两种模式都保留完整方案，不把“配置未自动推导”变成永久禁用旧能力的理由。原位切换不擅自搬数据；只读导入允许在新目标写受控映射，原路径/原值必须保留于私有清单，并证明引用仍解析到正确内容。

若目标已有不同 Bot/群/Session，默认给冲突清单并拒绝覆盖。相同源指纹、相同 ID 与相同内容可幂等确认；不自动改 ID 来躲避冲突。合并独立用户数据不是本次可无损推断的操作，可选择另一个空目标，但不能删除任何一侧。

## 3. 实际 rc.3 配置语义

已读取 `@deepseek-ai/dsh-app-boot@0.2.1-rc.3/lib/index.js`，以下是实现约束：

- profile 是目录，其 `package.json` 的 `dsh.profile.bundles` 是有序列表；每个 bundle 的 `dsh.bundle.patch` 可为字符串或有序数组。先组合 bundle，再 profile 的 `cordis.patch.yml`，最后是 launcher 的 `--patch` 与参数层。
- 非 insert patch 按 id 找行；`config` **整体替换**，不是深度合并。`name` 是对既有名字的断言，不能用于重命名；断言不匹配会跳过整个 patch。递归 group/include 也要纳入最终入口清点。
- `!!js` 用 `LOADER_EXPRESSION_SCHEMA` 保留为表达式节点，激活时才求值。预览不能执行用户表达式、import 插件或发网络请求。
- `loadProfile()` 会初始化、规范化并移除 link projections；`loadProfileDirectory()` 也可能调用 `dropRetiredBundles()` 写 manifest。**不可直接拿它们对源 profile 做只读预览**。读取源文件后在受控暂存副本使用 SDK resolver，最终使用 SDK 的纯 `composeEntries` 复核；不另写近似的 patch 合并器。
- SDK 会协调已安装依赖与 bundle 列表。必须验证新 profile 以后安装无关插件时不会重新启用旧 `ds-bot`，客户端 scope 也不能再次发现旧 DS client。只删除一行 bundle 字符串不足以证明这一点。

迁移输入应显式包含：选定 profile、DSH home、原 launcher working directory、安装锚点、附加 patch 列表与来源包内容指纹。缺失的动态层标为 `needs-launch-context`，不猜测其最终值。公开报告只列层级/条数/摘要，私有预览保留原文。

## 4. Runtime config 与搜索的兼容接线

### 4.1 保真接入

建议新增外层 `packages/orchestration/src/bot-runtime-config.mjs`，并在根 `Config` 加 `botRuntime`，由 `apply()` 一次读取并传入 `startBotProduct(...,{runtimeConfig})`。先用本机 Schemastery 做 schema smoke，使用其实际可用的保真对象能力，不假定存在 `.passthrough()` 等 API。

冻结 runtime 的已使用配置应逐项登记，包括 `home/workspace/mainName/mainRole`、`checkRatio`、`memory/memoryReview/memoryReviewDelayMs`、`browser/browserHeadless/browserPlugin/browserPluginApi/browserComplete`、`playwrightUrl/browserExecutablePath`、`github`、`diagnosticsFile`、`textOnlyModels/ocrModel`、handoff 与时间参数。以代码中的安装函数为准，避免把内部 Session 的 `config.model/provider/content` 误收成顶级 runtime 参数。未知扩展字段原样传给同一冻结 runtime，保存原文和来源，不能静默丢弃；不把字段保留本身说成它的新语义已验证。未来库版本或需要新授权的绑定另走明确拒绝/补齐路径。

`updateCheck:false` 仍由外层强制，防止再次安装独立 DS bundle。旧 `updateRegistry` 等偏好记录于迁移报告，并转到统一更新/安装来源；不恢复第二个 DS updater，不接管上游 appId、签名或更新 feed。

### 4.2 路径不能“顺手修正”

`createRuntime` 对 `config.home` 直接采用给定值，默认才用 `<DSH_HOME>/bot`；`folders` 对 DSH home 有自己的展开规则。必须按冻结代码和原启动 cwd 解析旧值，不能把所有 `~`/相对路径都按 profile 目录重新解释。原位迁移应证明新旧有效路径指向同一对象；复制导入则明确记录 old→new 映射。

迁移保留 Bot 各自 `workDir`、workspace 引用和权限，不批量改成一个新目录。当前托管后端使用组合指定的 managed read-workspace，这与旧 Bot 自己工作目录不是同一项；兑现按 Bot 的执行位置属于后续执行 facade，不能凭配置复制就宣称已验收。

### 4.3 搜索入口必须真实可加载

建议新增薄适配入口 `modules/bot-runtime/web-search.mjs`，外层引用冻结 `vendor/ds-bot/web-search.js`；根 exports 暴露 `./web-search`，逐文件加入 package files，根 bundle 挂 `web-search-auto` 到新包子路径。冻结源码不改。

迁移时从**旧最终有效配置**取得搜索状态与 `web` 配置；旧 `web-search-auto` 的 name 断言转成新路径，保留 disabled、配置和用户对 `searchProvider/fetchProvider` 的覆写。不能用新 bundle 默认 `auto` 覆盖用户选定的 exa/perplexity/其他 provider，也不能只关 auto 而让 `web` 继续引用不存在的 provider。已有禁用 auto 的异常组合应被诊断出来，不擅自换 provider 或用密钥测试。

实际 rc.3 loader 测试要断言：只有一个 Bot runtime/资金 writer；新 auto provider 真正登记；旧客户端未装载；有效搜索配置保持；禁用/替换 provider 的行为正确。只核对导出文件存在不够。

## 5. 数据分域与对账清单

| 域 | 策略与证明 |
|---|---|
| DS `state.json` | 保留 Bot/群 ID、Main 集合、模型、角色、权限、capabilities、Session/历史分段/群成员关联；不通过 UI 重新建 Bot。冻结 store 会做历史规范化，需区分允许的增补与身份丢失 |
| DS memory/side chat/parts | 整个实际 bot home 的持久数据清点，含私有/群/团队记忆、journal、archive、聊天索引和旁路会话资料；每个作用域的数量、字节摘要与 owner 映射前后对账 |
| SDK Sessions/附件 | 保留 SDK 原生日志格式与 Session ID，核对当前、旧 parts、群 Sessions 及 fork/subagent 引用。不能只复制 `bot.sessionId` 当前一条；优先完整迁入选定数据集的 Sessions/附件，或用 SDK 查询得到完整引用闭包 |
| DS usage.sqlite | 保留 auxiliary 调用与已删除 Bot 的计量，不简单删库重建。虽部分来自 Session 派生，纯 metered 行无法从日志重建；与新来源收据分开保存，显示覆盖/未插桩边界，不制造新费用行 |
| DS secrets/MCP/skill/pack/connector | 原值和 scope 保存在私有备份/目标，不能写入公开报告。机器配对只保留 secretRef，不导出 Token 到模型。需要系统凭据库的不可复制项做显式待重连，不伪造已可用 |
| MR JSON/SQLite | 复用 `inspectRouterState`、原资金 writer、预占、费用/订阅档案与未知标志。归属不明的历史仍 unassigned，不能猜归到 Main 或重复分到每个 Bot |
| 新 Task/plan/receipt | 保留 task/package/attempt/operation/request-key、依赖边、outbox、执行引用、reconciliation、events、原始 receipt identity 和核对记录；不因迁移清空去重墓碑或改目标 hash |
| workspace/产物/浏览器 profile | 原位只保留路径，不改源码和工作树。复制模式单列 workspace 策略，内容冲突拒绝覆盖；浏览器需关闭再复制 profile；cookies/秘密不进诊断。未知目录默认清点，不能无声跳过 |
| 程序/依赖 | 不把 `node_modules` 当跨平台数据包；保留原 lockfile/安装来源/内容指纹并按平台重建。开发链接需记录真实程序目标，不能直接塞进 npm/Release |

账务对账至少比较：逐日/逐月 API 额、known/unknown 数量、active/interrupted holds、原归档、订阅调用与已知/未知 token、Bot/账户/项目归属及 unassigned。数值未知保持 null，不能改为 0；DS usage 不是 MR 已结算美元的第二个来源。

## 6. 模型、能力与预算迁移

旧 Bot 的 provider/model、角色、颜色、会话身份都直接保留。新 binding 使用相同 Bot ID，草稿列出原配置、确定映射与缺失项，不能把同模型 Bot 合并。官方工具映射须符合已核验的厂商/精确模型目录，不从一个名字猜 CLI 版本、入口或计费渠道。

有足够显式证据的原设置可经 owner migration context 编译为 binding；未确认的能力不扩权，缺 pricing、请求上界、账户 scope 或可信 CLI entry 的项要在导入向导中一次补齐。界面保留原聊天与高级入口，给出准确的阻塞字段和下一步，不能让用户重建整个团队或长期以“未配置所以全禁”当完成。完成定义仍要求这些路径真正可用。

特别注意预算语义：旧 MR 的全局 0 表示未设上限，新 Bot/账户的 0 是禁止付费。迁移清单必须用 `amount/unbounded/unconfigured` 三种内部状态区分，不把旧 0 直接写成新 0，也不把未知当 unbounded。正的全局额度不能逐 Bot/逐 provider 复制后扩大总额度；应保留一个共享全局限制，在同一资金 CAS 回调覆盖全部来源，再叠加各 Bot/账户/项目限制。`assessFundingAdmission` 已支持项目日/月检查，但当前 UI/绑定映射不等于已有跨 provider 全局限制。

若 schema1 不能表示合法的 legacy-inherited/unbounded，先设计显式 schema2/迁移 provenance 与 UI，再开放自动编译；不能用任意 USD 1、1e9 或旧 `confirmOverBudget` 来模拟。无可靠价格时可以保存精确模型草稿并由用户确认，不用一次真实模型调用猜账单。

## 7. 事务边界与停写

建议新增外层 `profile-migration.mjs` 与 `migration-snapshot.mjs`，提供 owner/CLI 专用 `inspect → plan → prepare → commit/recover → export/rollback`。模型工具不接收任意 migration path 或 SQL。

### 7.1 只读预览

输入是用户选择的路径或隔离副本。枚举所有共享该实际 bot home/资金文件的 profile 和 launcher；多 profile 共用数据时不能只改一份就宣称无双 writer。未知 include、动态 home 或外部路径进入需补齐清单，不执行它们。验证 JSON/YAML、SDK/Session 格式、源包/当前程序版本、未来数据库版本、剩余空间、路径大小写与文件身份。

私有 plan 包含每个源文件的原始摘要、目标/暂存/备份位置、前后有效配置、路径映射、完整对账基线、操作阶段和程序内容指纹。公开预览只给数量、相对名、摘要与有行动指引的错误，不输出配置值、机器端点或凭据。

### 7.2 不能用“锁文件不存在”代替停写证明

停止新模型调用/Task/schedule/自动记忆 review，等待或明确取消活动工作；未知停止或 holds 仍在时不切换。核对所有相关 Host/agent PID、锁 owner/token、runner 和异步队列已关闭，SQLite 连接已释放。**不自动杀陌生进程、不删除活锁**。

原位模式可按规范取得 DS home lock、旧 JSON writer lock 和迁移锁，固定排序避免死锁；只读源导入不得为了拿锁而写源。后者要求离线源/受控一致快照或可核实的旧 Host 停止回执，再做前后两次文件清点；两次 hash 相同只是辅助检测，不能在未知活动 writer 情况下宣称跨域一致。

### 7.3 跨文件提交不冒充数据库事务

默认 Node rename 不能原子替换多个 profile 文件，也不能在 Windows 原子替换非空数据目录。原位方案采用持久迁移日志、启动门控和明确的唯一激活点：

1. 备份所有计划会改的配置与持久数据，落盘校验后记录 `prepared`。备份错误时不改源。
2. 写入已预览的维护配置：显式禁用所有旧 DS/MR mutator 入口；旧程序也识别其 disabled。此时旧 JSON 尚未切换权威，崩溃可按日志恢复原配置。
3. 更新目标包引用与 bundle/搜索配置。新插件在所有 DS/资金/Task 初始化前检查 migration gate；pending 时 fail-closed，明确提示用恢复工具，不旁路到旧 JSON writer。
4. 在最终稳定数据路径完成既有 MR 迁移、全域对账和新库/receipt 版本核对，仍不派发工作。
5. 安装最终配置并以 CAS 核对每一文件仍是已计划的 before/maintenance/after 状态。最后一次原子写入 gate 的 `committed` 状态作为激活点；任何未完成阶段都不可启动一半的新 runtime。
6. 在隔离副本做健康验证，读取旧 Bot/群/Session/搜索及账务。生产启动保持用户原计划任务策略；本轮试验只用离线 provider，不因“健康检查”触发真实推理。

旧 SDK/插件不认识新 gate，因此步骤2与真实停写不可省。对不能证明会禁用所有旧 mutator 的动态配置拒绝 apply，不把写一个 marker 当成足够保障。

日志每步先持久意图、再操作、再持久结果；恢复仅接受计划记载的文件身份/hash，出现第三种内容则 `MIGRATION_SOURCE_CHANGED`，保留全部文件供核对，不覆盖用户改动。

### 7.4 数据位置改变

只读复制优先在新应用自己的 `<container>/generations/<id>` **最终稳定绝对目录**构建，所有数据库 source/backup 与 runtime 路径以该位置创建，最后只原子切换本应用数据位置指针。不能先迁移后重命名世代目录。

已激活的 SQLite 搬家需单独维护协议：停源 authority、保留完整快照、核对新目标路径与全部 bytes、显式 rebind source/backup/epoch 和派生投影、隔离旧句柄，再激活新位置。既有 `checkMarker/activeAuthority` 仍是防线，不应直接关闭检查或把 source 路径简单替换成任意新路径。只读源导入不能暗中把原源库置 inactive，应在迁移模式/操作权属中清楚区分。

任何会引入旧 reader 无法理解的定位/authority/gate 语义，都要给出 reader 矩阵并同步升级数据库版本与 journal/finance 白名单，让旧程序拒绝；不能默认 schema4 可无限复用。未来版本拒绝测试同步顺延，禁止顺手降版本。

## 8. 备份、导出与回退

备份是私有数据，不放 repo/Git/npm/飞书。Unix 目录0700、敏感文件0600；Windows 明确授予迁移用户/所选运行账户，禁止仅依赖 POSIX mode。保留 ACL/可恢复权限摘要，禁止放宽为 Everyone。拷贝/恢复前校验 realpath、链接/reparse 和文件身份；数据链接默认不跟随到未选择根。workspace 中的合法外链可以保留引用并列出，不擅自复制其外部内容。

SQLite 用已停止连接后的全库快照，或原生一致 backup API；不只复制有 WAL 写入的主文件。复制必须覆盖同库的资金、Task、Bot settings、账户和机器目录，禁止只捞部分表后说完整备份。源 JSON 原字节和当前兼容导出是两个不同产物，均保留。

两条回退路径：

- **激活前回退**：按阶段日志只恢复尚未产生新业务数据的配置；金额 prepared/marker-written 等状态由原组件恢复，不能手工删新表重来。
- **激活后回退**：先停新 writer，处理或保留 unknown/holds，导出最新全部 Task/plan/attempt/op/commands/events/receipt/账户/机器/新 DS 数据与全库快照，核对后才调用现有资金 `rollback()` 生成旧可读的**最新金额**，再切程序/配置。不能把 pre-sqlite 旧备份覆盖新费用。

`rollback()` 的安全终态应统一定义：blocked 等已证明不执行且有导出的终态不能永远挡回退；ready/admitting/running/cancelling/waiting-budget/needs-reconciliation 或未结 holds 仍需明确取消/核对，不能改字符串绕过。完整新任务导出需有 schema版本、源字节摘要、原 ID 与去重墓碑；旧程序不支持的新域以只读档案保留，重新升级时导入仍保持命令幂等。

只读源导入的回退不写原来源：可切回兼容程序继续使用新目标，或产生另一个已对账的 legacy-compatible 目标。原来源只证明导入时点，不能让旧程序直接用旧金额忽略导入后的支出。

## 9. 建议文件与接口

| 文件/接口（拟新增或扩展） | 职责 |
|---|---|
| `bot-runtime-config.mjs` | 完整 runtime 配置 schema、有效路径解析、旧→新保真转换；不得发请求/读密钥 |
| 根 `Config/apply`、`modules/bot-runtime/web-search.mjs`、exports/patch/files | 默认产品实际配置接线与统一 auto 搜索，保持 MR id，拒绝重复运行时 |
| `profile-migration.mjs` | 只读 inspect/plan、CAS/停写/阶段机、启动 gate、resume/rollback 编排 |
| `migration-snapshot.mjs` | 有界文件清点/稳定身份/私有备份/全域对账/一致 SQLite snapshot/完整导出 |
| `scripts/integration-migrate-profile.mjs` | 默认 preview；显式选路径后 `prepare/apply/recover/export/rollback`。参数为受约束操作，不拼 shell，不接受模型任意命令 |
| `sqlite-router-state.mjs` | 只扩必要的维护/位置移动与导出接口，保持唯一金额 writer；不重做已有预算算法 |
| 安装器/数据位置 launcher | 暂存新程序、核对摘要、选择当前世代、未完成迁移不可启动；程序与数据回退分开 |

建议 plan 记录 `schemaVersion/id/mode/programDigest/sourceFingerprints/targetFingerprints/effectiveConfigHash/dataIdentityMap/phase/reconciliation/export`。包含秘密的原文与绝对路径只存私有备份；公开 evidence 只保存可移植相对源码路径、git blob、计数、模式、失败位置与限制。

## 10. 按依赖实施，不把全部问题塞进一次提交

1. **兼容入口先行**：runtime config + 搜索子入口 + 真实 SDK loader 小 fixture；不迁生产数据。覆盖自定义 home 与关闭 memory/browser、搜索改 provider/禁用、MR配置完整保留。
2. **只读 inventory/plan**：真实 SDK YAML表达式与 patch 语义；custom home、多 profile、附加 launcher层、未来版本、链接和冲突识别；预览对源树 hash 为0变化。
3. **完整备份/导出与对账**：先做含未知金额、订阅、parts/群/附件、MCP/秘密引用的合成数据集，完成源/目标双向计数和完整新任务导出。
4. **维护 gate 与可恢复提交**：原位隔离副本全过程，新增阶段崩溃 fixture，用真实子进程退出验证恢复；校验旧 writer 阻断和并发 CAS。
5. **只读复制/数据位置**：最终稳定世代与专属 launcher 指针；另外验证已激活 SQL 搬家，不复用错误绝对路径。不可与上一步隐式合并。
6. **新绑定向导与全局预算兼容**：确定字段自动编译，待补字段一次显示；加入共享全局限制、防零语义误变和旧归档重新归属。实际可用性与旧高级入口合并验收。
7. **产品宿主与三机演练**：旧组合→迁移→默认单插件→冷启动→新增离线任务/收据→导出→回退→再导入；最后再做干净安装/旧安装升级与真实用户选择路径的运行验证。

## 11. 必须有的测试矩阵

- config：相对/绝对/custom home、带空格中文路径、DSH_HOME、不同启动cwd、原有 model/MR 设置、同模型多Bot；完整 config 替换、name断言、嵌套group/include、`!!js` 保留及预览不求值；未知格式不丢原文。
- load：legacy DS+MR、只DS、只MR、已统一、旧包别名、重复bundle、明确禁用Bot/搜索；只加载一个runtime/client/writer，auto搜索真实登记，安装无关插件后不重新启用旧bundle。
- identity：Bot/群/Session/历史parts/旁路/记忆/附件/能力/秘密引用前后相等；二次导入不添新ID/receipt/费用；相同ID不同内容拒绝覆盖。
- money：已知非零/未知/中断hold/订阅未知token/裁剪归档/unassigned；旧全局0与正额度；不同Bot/不同provider不扩大额度；新writer只一份。
- crash：每个文件替换前后、prepared、marker-written、active、gate-commit、rollback-prepared、rollback-file-written、位置指针切换与导出中断；重复resume幂等且不丢前后数据。
- conflict：源用户中途编辑、第二migrator/旧Host、活PID/活锁、陈旧锁、数据库busy/磁盘满/权限不足、backup篡改、路径替换/junction、目标源嵌套和Windows大小写别名。
- rollback：激活后新增Task/plan/receipt与DS记忆，再回退/升级，金额与IDs不回到旧时点；blocked安全终态与unknown不混淆；未来程序/库版本显式拒绝。
- real Host：加载现有模型/角色/群/历史与搜索；冷启动保留；来源收据/金额/订阅视图对账。离线fixture通过后仍不等于真实模型推理或生产安装通过。

每步按交接七项同步 evidence/台账/行为/进度/执行单/生成STATUS及校验；本设计本身不改步骤完成状态。涉及主入口闭包的新 `.mjs` 必须逐文件加入 package files，新增测试进入根或明确的原生探针/CI。

## 12. 可自主决策与真正缺少的条件

可自主确定：保持MR id与原ID；单runtime与单资金writer；新增外层配置/搜索shim；纯SDK组合语义；原始备份与最新导出分开；默认preview、阶段日志/CAS/启动gate；无模型/无生产写入的合成fixtures和三机隔离演练。无需为这些常规实现重复索要发布授权。

实际还需用户或目标环境给出：真实要迁的 profile/源与目标数据位置及原启动上下文；不可推导的新费用/能力授权；活跃任务停止/unknown核对材料；系统凭据重连与旧安装载体。当前可以先把全部可自动实现和验证的工具完成，并给一份具体私有预览，再让用户做最终必要选择，不能用这些条件让整个工程停在空方案。

Win10/Win11 解锁测试桌面已由用户确认并按 E44 基础验证，不能再次列为未知。真实模型推理仍由用户执行；完成工程后的 GitHub/npm 发布已有授权，迁移设计不重复申请，也不把授权解释为现在即可发稳定版。

## 13. 本轮审查来源

- 工程：`.dsh-plugin/index.mjs`、`cordis.patch.yml`、`package.json`、`modules/bot-runtime/index.mjs`、`product-composition.mjs`、`sqlite-router-state.mjs`、`router-state.mjs`、`funding-projection.mjs`、`funding-admission.mjs`、`funding-accounts.mjs`、`bot-settings.mjs` 与相应原生迁移测试。
- 冻结 DS：`index.js`、`cordis.patch.yml`、README配置/数据目录、`src/host/store.js`、`home-lock.js`、`folders.js`、`memory.js`、`secrets.js`、`usage.js`；另只读参考固定源码树的 `app/src/import.mjs`、`copy-tree.mjs` 与 import 测试。
- 本机固定 SDK：`@deepseek-ai/dsh-app-boot@0.2.1-rc.3/lib/index.js` 的 profile层、YAML表达式、patch/composeEntries、loadProfile与插件协调实现；`dsh-home-paths` 路径实现。没有修改SDK或冻结源。

## 14. 第1步兼容入口施工记录（2026-10-28）

本轮仅实现 §10.1，不把 T48/T49 或整个 W03.4/W06 标 completed；无真实 profile、真实推理或外网搜索。

- 新增 `packages/orchestration/src/bot-runtime-config.mjs`，使用当前 Schemastery 的真实 object/union/any API。已知字段验证类型，未列字段由其实际 object resolver 原样保留；`textOnlyModels` 显式取消 array 的隐式默认，避免补写旧配置。路径不展开/重定位，API 函数不调用，`updateCheck` 在外层强制 false。
- 根 `Config.botRuntime` 是非 volatile 配置，经 `apply()` 传入既有 `startBotProduct`/冻结 runtime。原 MR 配置仍在根级，Cordis id、任务与执行授权、模型选择和资金算法未改。
- 新增薄搜索入口 `modules/bot-runtime/web-search.mjs` 与精确 `./web-search` export，根 bundle 实际插入 `web-search-auto` 并给 web 默认 auto/http；较后的用户覆写/disabled 保持 SDK 语义。公开文件逐个加入 files，补 `dsh-web` peer/dev 依赖，根 test 登记两套专属测试。
- `node --test tests/bot-runtime-config.test.mjs tests/product-web-search.test.mjs`：13 项专属检查；真实 rc.3 boot/Include/Loader 与真实 WebRuntime 加载新入口，验证 auto、用户配置、禁用、失配 name 断言、整体 config 替换、错误组合显式拒绝与 `!!js` 预览不求值。现有工作树未重装依赖时仅为 frozen web import 复用固定 fixture resolver；干净安装使用新增 dev 依赖。
- `node scripts/integration-web-search-config.mjs`（npm 别名 `integration:probe-web-search-config`）：真实固定 rc.3 宿主，6/6 检查通过；custom home/workspace、Main 名称/角色、memory/browser=false、MR 模型/预算与未知字段均保留；只一个产品入口、auto 真正登记、统一更新不可绕过；冷启动保留原 Main/Session，改 provider+禁用 auto 后只命中本地 fixture。真实模型 0、外网搜索 0、本地 fixture 搜索 1。最新隔离运行 `tmp/integration/web-search-config/run-h1fpbQ/summary.json`。

本轮没有运行根回归、默认 Host 探针或客户端构建，避免与并行桌面实现竞争；锁文件由主会话统一更新。台账、证据与最终交付状态由主会话审阅后登记。旧 DS bundle/同 id patch 的迁移重写仍属后续阶段；不能把该兼容入口当成已安全移除并存旧 writer 的迁移器。

## 15. 兼容入口复核与历史组合 fixture 修复（2026-10-28）

复核确认：历史 `runCombinedHost` 曾同时挂冻结 `ds-bot` 与统一 MR bundle；新 bundle 补齐搜索后，两层都插入 `web-search-auto`，这份 fixture 不再表示它原本要测的“旧 DS runtime + MR body”。生产 runtime/schema/search 薄入口不需要以吞重复注册的方式修复。

`scripts/integration-combined-host.mjs` 新增只用于历史并存探针的 `legacyCombinedProfile()`：保留冻结 DS bundle，改为显式插入 MR 公共入口且 `botProduct:false`；默认产品仍由原完整统一 bundle 和其专属探针验收。对应离线 model fixture 只增加实际 Loader 搜索入口/SDK provider 的诊断字段；combined 探针据此断言恰好一个冻结 auto entry/provider，并在 summary 明确 `fixtureComposition: frozen-ds-bundle-plus-explicit-mr-entry`。这是测试组合的边界修正，不是生产迁移器。

- 原13项兼容检查复跑全部通过；新增一项历史组合/未去重生产层的断言后，两套专属测试为 **14/14、0失败**。
- 配置实际 rc.3 宿主探针仍 **6/6**，真实模型0、外网搜索0、本地 fixture 搜索1；最新结果：`tmp/integration/web-search-config/run-IR6QNa/summary.json`。
- 不带 Task/远程/桌面操作的历史 combined 实际 rc.3 宿主探针 **10/10**，真实模型0；12次 adapter dispatch（其中2次 auxiliary）全是离线替身；最新结果：`tmp/integration/combined-host/run-XCK4dJ/summary.json`。

新增断言同时确认：把真实旧DS和统一bundle直接叠加时，SDK组合结果仍有两条 auto entry。没有在生产入口、配置组合器或 provider 注册中偷偷去重；真实迁移的停写、旧 bundle/patch 重写、预算与备份/回退缺口仍按前文推进。本轮未改 package/锁/CI/台账/根进度，未跑全根或默认产品回归，也没有重建客户端/Agent。

## 16. 只读 profile 配置预览/变换规划层（2026-10-28）

本轮新增 `packages/orchestration/src/profile-migration-plan.mjs` 与 `tests/profile-migration-plan.test.mjs`，只生成 PRIVATE plan，不 apply、不调用包管理器、不加载插件、不停 writer、不做用户数据备份/搬移/回退。与数据 inventory、CLI 的合流由主会话处理；本轮未改其他入口、package、锁或台账。

入口为 `await previewProfileMigration(options)`；另导出 `summarizeProfileMigration(plan)` 与 `await verifyProfileMigrationSources(plan)`。显式输入选定的绝对 `profileDir/dshHome/launchCwd`、按源 manifest 顺序的 `orderedBundleLayers: [{packageName,packageDir}]`、明确的 `launcherLayers: [{path}|{patches,label?}]`（没有也必须传 `[]`）和目标 `targetBundleLayer`。没有保存 workspace 时，调用方须显式给旧的相关 `launchEnvironment`，`{}` 表示已确认没有该环境覆盖；模块不读取当前进程环境猜旧路径。非 auto 搜索选择须提供 `availableSearchProviderIds` 作为宿主 registry 清单，缺失为 needs-launch-context，不发搜索请求验证。可选 `expectedSources` 复核前一次预览；`targetDependencySpec` 只代表明确选择的安装来源，最终安装核验仍未实现。

Host 可显式传 `intent:'install-unified-product'` 规划在没有 DS/MR 入口的源配置中新装统一产品；默认仍为严格 `migration`，空入口源返回 NO_PRODUCT_ENTRY。新装模式若看到既有 DS/MR 入口则 INSTALL_SOURCE_NOT_EMPTY，不能把迁移伪装为空源安装。private plan 的 intent/sourceState、proposal.intent/targetArtifact.intent 与公开 summary.intent 都明确记录所选模式；该模式只说明配置里没有对应入口，不证明用户数据 home 为空，更不激活产品。

新装模式先按真实 SDK 组合“原有 bundle层→目标 bundle层→原 profile/home/launcher层”，保存 installCandidate；因此新增 MR 后重新匹配的 orphan patch 使用其**最终有效** config/disabled，再形成兼容尾层，不用空配置覆盖。ORPHAN_ROUTER_SETTINGS_REACTIVATED warning 要求用户复核这些重新生效的设置。旧 `bot` orphan 只保留原patch并发 ORPHAN_LEGACY_BOT_PATCH warning，不猜成新 botRuntime；原本不匹配的旧搜索 name 断言也不偷偷改成新路径。新 BotRuntime 的 home/workspace/环境要求、动态目标条件与其他入口保留规则仍全部适用。

源 manifest/patch 用稳定文件 descriptor 分块读取，原文/摘要/文件 identity 留在私有 plan。默认上限：单文件2MiB、合计16MiB、来源256、数据节点50000、深度64；`limits` 只能下调。计数包含读取失败的来源请求；解析/组合前限制深度、循环数据和过大的 inline launcher 层。读取后检查 descriptor 的 stat 与路径 realpath/identity，完成前再有界复核每个源的 bytes/identity；原本不存在的 profile/home patch 也验证没有新出现。越界文件链接不读取内容。该检查仍不等于跨域一致快照或停写证明。

没有调用会写源 profile 的 `loadProfile*`。组合直接使用真实 SDK `composeEntries`；YAML 使用固定 SDK 所依赖的 js-yaml，以 SDK 内部 `JSON_SCHEMA.extend(JsExpr)` 同一读入 dialect 解析捕获字节，`!!js` 只保留 `{__jsExpr}`。已与真实 `loadOverlayPatches` 的 AST、相对插件名锚定结果逐项对照。注意 SDK 导出的 `LOADER_EXPRESSION_SCHEMA` 是 JSON Schema 元数据，不是可供 js-yaml load 使用的 YAML Schema 实例。这样既保留 SDK 语义，也不绕过 descriptor/字节上限重新无界读取源文件。

私有 plan 保存 `effectiveBefore`、完整原始源与有序层，以及 proposal 的新 manifest、改写 user layers、`compatibility-final` 尾层、最终有效 entries。旧 DS 最终有效 config 折入同一 MR id 的 `botRuntime`；原 MR 设置保留，独立 product 开关修改明确出现在目标配置。搜索旧 name 断言换成统一子入口，原 disabled、provider、fetch 与整份 web config 保留。旧 DS bundle/依赖移除及所选目标版本仅作为建议，源码不改。必须把完整目标层（含尾层）交给未来提交器，不能只替换 manifest：`requiresTrailingLayer/requiresInstallerVerification` 均为 true。

unknown include、动态 name/id/group/runtime 配置、缺失 launcher 和未确认环境均返回 needs-launch-context。动态 disabled 只在 Bot/MR/search/web 目标或其祖先上要求明确上下文；完全不改的非目标行保留原表达式 AST，不判断其启用状态。私有 proposal 的 `preservedDynamicDisabled` 用完整 entry 摘要多重集合证明这些行 before/after 相等；不一致即 TARGET_COMPOSITION_CONFLICT，不能为了 ready 偷偷改启用。重复入口/运行时、禁用 auto 却仍选择 auto、已知缺失 provider、额外的旧 DS/MR bundle 插件、不能无损迁移的 group isolation/作用域等明确阻塞，不丢弃它们来产出 ready。透明嵌套 group 使用 SDK 递归语义；父 group 禁用的 DS runtime 变成 `botProduct:false`，父 group 禁用的 MR entry 在最终 MR root 上保持 disabled，不能被搬出 group 后重新激活。

公开输出只能调用 summary：字段固定，status/code/severity/action 使用词表，摘要只接受SHA256格式，计数有界；即便载入的私有 plan 被改入其他字符串，也不把路径、表达式、配置值或错误原文反射到公开输出。

`node --test tests/profile-migration-plan.test.mjs`：最新 **29/29、0失败、0跳过**（初版21项通过后，补3项动态 disabled 边界和5项显式安装规划检查）。覆盖源字节不变、旧/MR配置与路径、group和禁用继承、整 config 替换/name断言、`!!js`不执行、SDK AST对照、home/launcher层序、搜索禁用与provider、include/动态名、重复/不支持bundle、源变化/缺失文件出现、二次预览确定性、链接边界、各读取上限以及被篡改私有plan的公开摘要。disabled 用例含10个无关SDK样式条目和无关父子group的 throw 哨兵：ready且12条完整entry/AST逐项保持；四类目标及其祖先的动态disabled仍needs-launch-context；动态id/name/group仍阻塞。安装用例覆盖空入口源的显式授权、其他bundle/AST保留、MR orphan整体替换/禁用、旧Bot orphan不折入、动态目标与缺环境仍阻塞、已有产品不能按空源安装。文件 symlink 权限不足时会显式 `t.skip`；本机此轮实际执行通过。这些修正只使用合成fixtures，子代理没有读取真实profile或主会话私有预览。

仍未交付：最终可恢复配置提交、停写证明与 writer gate、全域私有备份/新任务导出、资金与位置移动、安装器应用/升级和激活后的回退。T48/T49/W03.4/W06 的完整验收状态由主会话依赖全部证据判断，本层通过不替代这些门禁。
