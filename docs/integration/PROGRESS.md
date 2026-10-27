# 一体化工程进度

更新日期：2026-10-27。当前阶段：**M0 基线与兼容**。研发分支：`feat/bot-integration`。

## 目标与已确认约束

按 [方案1.1](plan/20261026_master_plan.md) 完成 Main 私聊派活、两仓功能并集、按 Bot 绑定模型/官方工具、Linux 与 Windows 远程电脑，以及迁移、安装和发布。分期仅安排先后，不缩减最终范围。实际模型调用仅使用 GPT。

## 2026-10-27：MR资金权威切换到SQLite

- 严格`--tasks`宿主现在将MR运行账、预占和金额/订阅档案交给同一SQLite权威；原预算/归档算法与业务方法复用，默认用户profile不自动迁移。run/hold/档案/revision原子提交，纯回调才可在CAS冲突后重算，非纯回调只执行一次并拒绝冲突。
- 切换保存原始JSON校验备份，原路径用version4标记让旧写入器拒绝；标记前中断重读旧权威最新数据，标记后恢复必须匹配候选/备份。回退导出SQLite最新收据，拒绝未结预占和非终态Task，旧epoch不能重新写入。
- 新增19项原生资金检查：真实连接/子进程预算竞争、归档/订阅未知token保真、迁移三个阶段和回退两个阶段的实际进程退出、未来版本/源标记/备份异常，以及默认15秒过期+死亡检查恢复。既有26项Task检查继续通过，工程检查80项。
- 三机实际MR执行/重跑/预算等待/取消和冷启动均使用SQLite资金权威，核对仍不重复请求或写账；真实模型请求0。固定strict依赖和客户端检查通过。

| 环境 | 完整回归 | 通过 | 失败 | 跳过 | 资金原生 | Task原生 |
|---|---:|---:|---:|---:|---:|---:|
| 本机 Win11 / Node24.20.0 | 1311 | 1308 | 0 | 3 | 19通过 | 26通过 |
| 远程 Win10 LTSC / Node24.18.0 | 1311 | 1308 | 0 | 3 | 19通过 | 26通过 |
| 远程 Ubuntu24.04 / Node22.22.1 | 1311 | 1288 | 0 | 23 | 19通过 | 26通过 |

复现与限制见[资金切换合同](20261027_sqlite_finance.md)，数据和代码摘要见[本轮证据](evidence/20261027_m0_sqlite_finance.json)。CI增加两平台原生资金检查，既有真实组合步骤改用新权威。

当前仅为受控home的MR资金切换；前台Bot/辅助模型、初始Task/outbox与资金的单事务准入、逐来源receipt、默认产品迁移/UI、完整DAG及CLI/OS/远程边界仍未完成。新增T48/T49 partial，无新增passed；M0仍9/12。

## 2026-10-27：入场前关联、预算等待与收据核对

- 实际MR执行器及记录步骤重跑新增宿主接缝：创建预占/请求模型前先提交runId与Task/attempt/operation/target关联；初始、检查点、最终记录带同一marker。每次模型请求再检查当前SQLite generation、attempt、取消和deadline。
- 新增可复用的固定API backend和`bot_task_reconcile`。请求只带Task引用与幂等键，真实Agent决定归属；只读原账本，完整收据/已释放预占可恢复原结果，缺失/未知费用继续阻塞。核对不创建新attempt、调用模型或再次记账，撤权后迟到成功拒绝。
- 实际MR预算拒绝进入waiting-budget，0模型分派且原运行/收据不变；支持显式重试或取消，原期限不延长。预算等待自动到期与产品UI仍待完善。
- schema2保留schema1已有任务、身份和outbox，未来版本拒绝覆盖。9项新增合同检查通过；原生journal/service累计26项，工程检查80项。
- 三机真实宿主同时在“请求在途”和“非零合成收据已存、Task完成未存”两处强制中断。新宿主分别保留未知预占和恢复原结果；观察期间0次模型分派，原资金记录未变化。实际模型请求0。

| 环境 | 完整回归 | 通过 | 失败 | 跳过 | 原生Task检查 |
|---|---:|---:|---:|---:|---:|
| 本机 Win11 / Node24.20.0 | 1311 | 1308 | 0 | 3 | 26通过 |
| 远程 Win10 LTSC / Node24.18.0 | 1311 | 1308 | 0 | 3 | 26通过 |
| 远程 Ubuntu24.04 / Node22.22.1 | 1311 | 1288 | 0 | 23 | 26通过 |

固定strict依赖与客户端检查通过。复现、已知格式差异及限制见[收据核对合同](20261027_receipt_reconciliation.md)，平台/代码摘要见[证据](evidence/20261027_m0_receipt_reconciliation.json)。CI现有两平台Task/组合步骤覆盖新增内容。

MR仍是费用与预占单写权威，SQLite仅存关联和证明摘要；统一SQLite资金迁移、前台Bot/辅助模型准入、人工核对UI、默认配置迁移、完整DAG、CLI与实际OS/远程边界仍未完成。新增T38/T40 partial，没有新增passed；M0仍9/12。

## 2026-10-27：持久任务与旧运行归属

- 新增闭合Task合同、原生SQLite journal、generation租约/outbox和有界只读runner。真实Agent对象决定Bot归属，输入不能覆盖执行者或模型/机器；相同请求去重，重跑生成新attempt/operation，保留原输入、目标与总期限。
- 严格宿主接入`bot_task_start/status/cancel/retry`，实际调用原MR执行器及`rerunRecordedStep`。原run必须存在Task→Bot关联；跨Bot或无归属的旧run拒绝。费用仍由原MR账本写入，Task仅保存引用，没有宣称统一资金迁移。
- 取消保持cancelling直到实际执行体清理结束；未启动attempt记skipped。新宿主接管后，旧running/cancelling保留operation并进入needs-reconciliation，不自动重放，同时阻止该Bot继续提交或重跑。核对解除API/UI仍待实现。
- Ubuntu第一次中断用了SIGTERM，得到正常cancelled；已明确区分正常退出与崩溃，崩溃测试改为仅SIGKILL自身创建的进程组，并在三机重新验证。没有通过接受错误状态来放宽断言。
- 新增5项合同检查进入根套件，17项真实原生检查单独执行；工程检查累计71项。三机固定strict安装、完整回归和客户端检查通过，真实模型请求0。

| 环境 | 总数 | 通过 | 失败 | 跳过 | 原生Task检查 |
|---|---:|---:|---:|---:|---:|
| 本机 Win11 / Node24.20.0 | 1302 | 1299 | 0 | 3 | 17通过 |
| 远程 Win10 LTSC / Node24.18.0 | 1302 | 1299 | 0 | 3 | 17通过 |
| 远程 Ubuntu24.04 / Node22.22.1 | 1302 | 1279 | 0 | 23 | 17通过 |

实现、复现与后续顺序见[任务合同](20261027_managed_tasks.md)，平台和代码摘要见[本轮证据](evidence/20261027_m0_managed_tasks.json)。CI两平台增加原生Task suite和真实MR执行/取消/宿主崩溃步骤。新增T12/T13 partial，没有新增产品passed；M0仍9/12子步骤。

当前只是单包只读执行基础。完整DAG/审批/核对、统一预算/receipt与跨库中断、默认产品迁移、CLI私有引导、真实进程树取消、远程agent及DSH OS worker仍未完成。原有Windows边界失败与PTC partial不变。

## 2026-10-27：DS自动生命周期与真实Gateway

- 用冻结DS公开导出的`createRuntime`组合严格宿主，在启动时提供权限服务，不修改DS/SDK源码。`load/save/refresh/resolveAgent`外层适配器自动维护活动私聊、群成员Session与稳定Bot主体；换段解绑旧Agent，删除撤销全部身份，冷启动从保存状态重建。
- 保存必须真正写入，等待成功提交后才应用捕获的归属。未保存的后续内存变更不获权；保存/读取失败、已加载后的提交文件缺失均收紧权限；旧修订不回滚，冲突修订/跨Bot重新归属拒绝；关闭后的迟到保存不重新授予权限。
- 严格组合通过既有9项Main/工种/派活/用量/重启检查，以及5项自动生命周期、2项冷启动检查。实际群成员Session、DS自身文件夹换段与删除均经原运行时执行，没有测试代码手动补绑定。
- 真实HTTP/Gateway另通过3项检查：已登录owner获准方法成功、未获准方法拒绝、缺认证不能取得owner权限。cookie和临时URL不入库、不归档。
- 新增12项针对检查，工程检查累计66项。三机固定strict依赖、完整回归与客户端检查通过，真实模型请求0。生命周期只使用固定模型/有限MR能力的隔离组合，尚未迁移用户默认入口。

| 环境 | 总数 | 通过 | 失败 | 跳过 |
|---|---:|---:|---:|---:|
| 本机 Win11 / Node24.20.0 | 1297 | 1294 | 0 | 3 |
| 远程 Win10 LTSC / Node24.18.0 | 1297 | 1294 | 0 | 3 |
| 远程 Ubuntu24.04 / Node22.22.1 | 1297 | 1274 | 0 | 23 |

实现与复现见[自动生命周期说明](20261027_ds_lifecycle.md)，平台及代码摘要见[本轮证据](evidence/20261027_m0_ds_lifecycle.json)。CI两平台保留原检查，新增`--lifecycle`严格组合与Gateway步骤。

锁接管/只读宿主、调度和Capabilities全生命周期、热重载、完整中断矩阵仍待验证；执行/重跑归属、持久Task/预算/receipt、CLI私有引导、真正DSH OS worker与Windows边界仍未完成。Win11原生PTC ACL受阻和普通PTC的partial文件隔离没有改写。M0仍9/12个记录子步骤，四个总门禁未结项，没有新增产品场景passed。

## 2026-10-27：稳定主体与旧入口权限接入

- MR源码新增可选`botIntegrationPolicy`权限接缝，覆盖13个旧工具、两条命令、23个RPC接收器。严格profile配置`requireBotPolicy: true`后，服务缺失/无效或单调guard不可用会拒绝；默认旧profile保持既有行为。
- 稳定Bot主体可绑定多个真实Agent/Session；JSON复制身份不取得权限。解绑单个Session不影响同Bot其他会话；改授权作用于全部绑定，退休移除所有绑定。
- 真实三机组合宿主通过6项检查：有效参数下拒绝12个未授权旧工具；获准路由工具正常；隐藏未授权schema；真实命令规划可用/安装命令拒绝；23个RPC接收器无认证上下文时拒绝；同Bot第二个真实Session同步撤权，Main不受影响。
- 模型目录按当前主体过滤，MR嵌套调用保留主体；辅助调用只认已登记Session元数据。修复“构造模型流后、首次读取前撤权”的准入竞态；尚不宣称静默辅助provider等待中的主动取消已完成。
- 新增12项针对检查，工程检查累计54项通过。三机固定strict依赖、完整回归与客户端检查通过，实际模型请求为0。

| 环境 | 总数 | 通过 | 失败 | 跳过 |
|---|---:|---:|---:|---:|
| 本机 Win11 / Node24.20.0 | 1285 | 1282 | 0 | 3 |
| 远程 Win10 LTSC / Node24.18.0 | 1285 | 1282 | 0 | 3 |
| 远程 Ubuntu24.04 / Node22.22.1 | 1285 | 1262 | 0 | 23 |

远程两机还继续通过前一轮7项实际PTC工具检查；其partial文件隔离和Win11原生ACL阻塞均未改写。代码/证据见[入口接入说明](20261027_legacy_policy.md)、[实测记录](evidence/20261027_m0_legacy_policy.json)。CI两平台组合任务加入`--legacy-policy`。

本段记录的062df18临时fixture由可信宿主手动绑定Session，自动生命周期和Gateway正向调用当时待接；本页上方的新检查点已加入独立严格组合。Bot的CLI/团队/重跑/安装等路径仍需Execution facade完成程序身份、原运行归属、审批、预算和收据后开放；严格RPC后台启动等待持久Task租约。没有删减这些最终功能。CLI私有引导与真正DSH OS worker尚未完成。

## 2026-10-27：授权内核、真实 PTC 与 MCP 桥

- 新增实验授权内核，以宿主对象身份绑定准确模型、工具、任务、attempt、机器、工作区和本地/远程位置。短期租约有数量/时间限制，改授权、撤权、过期和关闭会中止合作式处理器并拒绝迟到成功结果。
- 使用正式 MCP SDK 的真实客户端与子进程验证 legacy/modern 协议、按 Bot 列工具、拒绝伪造身份与越权调用、撤权、取消和正常关闭；新增13项检查全部通过。
- 远程 Ubuntu 和 Win10 的真实 Node PTC 均通过7项工具约束检查，接入的就是上述共享内核；两机仍能读取另一 Bot 的合成文件，均报告 partial enforcement。本机 Win11 在 workspace-write 原生沙箱的 ACL 设置阶段返回 Win32 5，保留为受阻。
- 独立 Linux 容器实验拒绝读取另一 Bot 的合成文件，同时允许读写自己的工作区；固定镜像摘要、非 root、只读根目录、无网络/额外 capabilities。尚未把真正的 DSH worker 接入该容器。
- 本机 Codex0.163.0 实际解析两个独立 `CODEX_HOME` 的 MCP 配置，原用户配置保持原字节。它尚未通过 Codex 启动本次桥，也未验证真实推理或 CLI 模型身份。
- 修正离线 fixture 的辅助记忆复查输出为上游期望的 `{"changes":[]}`；没有修改 DS 或 SDK。
- 严格固定依赖、完整 MR 套件与客户端检查在三机通过。工程检查现为42项；全部实际模型请求为0。

| 环境 | 总数 | 通过 | 失败 | 跳过 |
|---|---:|---:|---:|---:|
| 本机 Win11 / Node24.20.0 | 1273 | 1270 | 0 | 3 |
| 远程 Win10 LTSC / Node24.18.0 | 1273 | 1270 | 0 | 3 |
| 远程 Ubuntu24.04 / Node22.22.1 | 1273 | 1250 | 0 | 23 |

证据：[PTC/OS边界](evidence/20261027_m0_security.json)、[授权/桥/CLI](evidence/20261027_m0_broker_bridge.json)、[回归](evidence/20261027_security_project_checks.json)。实现边界与复现见[实验契约](20261027_security_bridge.md)。CI 的 Ubuntu 组合宿主加入真实PTC和固定容器实验；Windows保留组合/原生检查，Win11失败没有改写为通过。

上述实现尚未进入产品默认路径。普通 DS Bot 仍可见13个旧 MR 工具；稳定 Bot/Session 主体映射、旧RPC/命令/重跑入口、预算/账本、CLI孙进程私有引导与真正的OS worker仍需实施。W02.5/G3推进到in_progress，M0仍为9/12子步骤，四个总门禁均未完成。T05/T25/T33新增partial依据，没有新增产品场景passed。

## 2026-10-27：组合宿主与实机验证

- 使用官方 `dsh` CLI，在独立 profile 中实际挂载 DS 与 MR，没有修改 DSH 或冻结 DS 源码。
- 9项组合检查通过：Main/工种 Bot 的真实 Session 与 AgentLoop、Main 工具创建 Bot、工种 Bot 调用 MR 路由工具、派活与结果回传、按 Bot 归属的用量，以及新宿主进程恢复身份/模型/消息历史。
- 本机浏览器已检查 Main/工种私聊、DS 用量、经典模式中的 MR 工作台和两边共享的模型目录；[截图与边界](evidence/20261027_m0_combined_host.json)已保存。
- 用户授权的 Ubuntu 与 Win10 已用于隔离实机测试。两机的组合宿主、工具/模型拦截探针、SQLite 原生加载/WAL/事务/中断恢复和客户端检查均通过。
- 新增2项环境隔离检查；工程检查现为29项。以下是本检查点完整 MR 套件的结果，跳过项没有计为通过：

| 环境 | Node | 总数 | 通过 | 失败 | 跳过 |
|---|---|---:|---:|---:|---:|
| 本机 Win11 x64 | 24.20.0 | 1260 | 1257 | 0 | 3 |
| 远程 Win10 LTSC x64 | 24.18.0 | 1260 | 1257 | 0 | 3 |
| 远程 Ubuntu 24.04 x64 | 22.22.1 | 1260 | 1237 | 0 | 23 |

证据：[远程平台](evidence/20261027_m0_remote_platforms.json)、[本轮工程检查](evidence/20261027_project_checks.json)、[六个入口的部分行为审查](behavior-audit.json)。Ubuntu 的额外跳过主要是既有 Windows 专项测试；没有据此宣称对应能力已在 Linux 验收。

发现的关键缺口：普通 DS Bot 能看到13个旧 MR 工具；记忆复查还有 AgentLoop 之外的模型调用；DS 用量和 MR 费用仍由各自旧账本管理。它们分别进入统一授权、模型准入与账本迁移，不能把同宿主能运行当成这些功能已完成。详见 [M0 验证结论](M0_FINDINGS.md)。

首次传输到 Ubuntu 的 DS 工作树带入 Windows 换行，冻结源码检查在启动前拒绝；已从原冻结 Git 对象新建干净测试副本后通过，没有放宽检查。实际机器端点与凭据只留在本机，项目仅记录测试别名。

## 2026-10-26 启动检查点

- 方案、来源材料和评审处理记录已放入项目，全部本地文档引用为相对路径。
- 建立32项需求、40组功能、63个验收场景、20个施工包的机器可读台账。
- MR 冻结在 `de82df4e737954ba0458d597ea82f9a6666c1a9b`，DS 冻结在 `de55888a93983fc51c94f7d22bc94b4f8293205d`；没有跟随上游 HEAD。
- 40组功能已登记：39组映射到既有源码，远程电脑组明确为新建；提取37个静态工具注册，逐入口的完整行为审查仍在进行。
- MR 固定依赖安装通过；全套1231项测试：1228通过、0失败、3跳过；客户端生成物检查通过。
- DS 的53项核心测试通过后，进一步用锁定的完整rc.3测试宿主运行全部1062项测试：1061通过、0失败、1跳过；测试入口与独立依赖锁已保存。这是单元/UI组件兼容验证，不是整应用或真实推理验收。
- 真实 Cordis/DSH 工具注册表探针通过：按 Agent 隐藏和阻止直接调用、兄弟 Agent 不受影响、guard不能被允许钩子覆盖、嵌套dispatch仍受限、撤销后恢复。
- better-sqlite3 13.0.3在当前Windows/Node24环境加载，WAL、回滚、双连接预占冲突、幂等与进程中断后重开探针通过。
- 真实LLM Runtime探针验证了模型调用前拒绝、会话归属和用量观察；只分派离线假适配器，没有真实模型请求。
- 本轮新增27项工程检查通过；修改后完整MR套件1258项中1255通过、0失败、3跳过，客户端检查通过。CI已加入任务依赖、范围和证据路径检查。

证据入口：[原始基线](evidence/20261026_m0_baseline.json)、[DS全套兼容](evidence/20261026_m0_ds_full.json)、[本轮工程检查](evidence/20261026_project_checks.json)。任务状态及证据由 `npm run integration:check` 检查。

## 当前未通过的门禁

| 门禁 | 已有依据 | 仍需验证 |
|---|---|---|
| G1 宿主/会话 | rc.3真实Session/AgentLoop、浏览器UI、三机自动创建/群成员/换段/删除/冷启动，Gateway正向调用 | MCP/search/审批/schedule、锁接管/热重载等完整生命周期；默认产品配置迁移、任务预算与部署拓扑 |
| G2 权限边界 | 自动提交快照/多Session主体；旧入口/Gateway；Task入场前关联、请求前fence、原收据只读核对与撤权；实际PTC及Linux合成容器 | 默认入口迁移、完整审批/统一预算/receipt、原生CLI与真正DSH OS worker；Win11沙箱ACL受阻 |
| G3 CLI/bridge | Codex独立配置实际解析；真实MCP子进程按授权列/调工具、撤权与取消 | CLI孙进程私有引导、真实CLI模型身份、远程路径、原生进程树取消与产品执行接入 |
| G4 安装/存储 | 三机原生驱动、SQLite MR单写切换/CAS预算/原始备份/最新账本回退及进程退出恢复 | Electron ABI、PTY、GUI helper、默认产品迁移、干净安装/升级/卸载 |

已登记并使用两台真实测试目标，但生产常开宿主和产品agent尚未部署。SSH可达不能替代产品配对/鉴权、WireGuard拓扑或笔记本休眠验收。现有Windows测试的3个跳过项涉及PTY或进程树，不能计为通过。

## 下一步

1. 继续W01逐入口行为核对：已有十四组部分记录，含严格生命周期/Gateway、Task、收据与SQLite资金切换；完整40组功能审查未结束。
2. 继续W02/G2前台Bot/辅助调用的SQLite准入与逐来源receipt、初始Task/outbox/资金同事务及完整中断矩阵；缺收据人工核对、预算等待到期/UI仍待补齐，再接默认配置迁移与真正DSH OS worker。
3. 继续W02/G3 CLI孙进程私有引导、CLI模型身份、原生进程树取消与远程路径契约；补齐G1其余生命周期。
4. 以已有真实测试目标验证常开部署与休眠拓扑；冻结Bot/任务/授权/收据契约。
5. G1–G4达到所需证据后进入M1，迁入DS Bot运行时并保留MR兼容入口。

T63（便携方案文档）已在document级通过；T01/T05/T12/T13/T25/T33/T38/T40/T48/T49/T57为partial，其余产品场景尚未验收。M0已完成9/12个记录子步骤；W01/W02及四个总门禁仍未完成，不换算为整个项目的完成比例。

## 复现与环境说明

```sh
npm run integration:status
npm run integration:check
npm run test:integration
node scripts/integration-host-probe.mjs
node scripts/integration-sqlite-probe.mjs
node scripts/integration-inventory.mjs --ds-root tmp/integration/upstream/ds-bot-frozen
node scripts/integration-host-probe.mjs --llm
node scripts/integration-combined-host.mjs --ds-root tmp/integration/upstream/ds-bot-frozen --host-root tests/fixtures/integration-host
```

SQLite探针需要先在隔离的 `tmp/integration/probes/sqlite` 安装锁定的13.0.3驱动，命令见证据文件；不修改用户DSH数据。源文件静态清单中的Git blob来自冻结提交，不依赖本机换行符。

本机Corepack pnpm启动器曾报缓存目录错误，本轮改用项目既有 `tmp/pnpm-10.34.6/package/bin/pnpm.cjs` 执行固定版本安装，未修改全局Node、pnpm或代理配置。其他环境使用正常的pnpm 10.34.6入口。

完整测试宿主最初的严格peer检查发现遥测依赖选到不兼容的API1.10.0；已仅在独立测试fixture内锁为1.9.0并通过frozen/strict/offline安装。pnpm顶层不暴露全部peer包导致的测试解析问题通过公共package.json解析锚点解决，没有修改DSH或冻结DS源码。复现完整套件的方法见[测试宿主说明](../../tests/fixtures/integration-host/README.md)。

组合宿主的隔离、离线适配器和浏览器检查方式见[组合fixture说明](../../tests/fixtures/integration-combined/README.md)。CI新增Ubuntu/Node22与Windows/Node24组合宿主及原生数据库检查。远程机的连接凭据、实际目录和完整日志均不提交。

## 接手规则

先读本页和 `tasks.json`，再运行进度检查；不要重新做已留证据的基线验证，除非依赖、源码或环境变化。任务步骤完成不代表对应产品T场景完整通过。把新增证据、失败、限制和下一步同步记录在本目录，不能只留在聊天里。
