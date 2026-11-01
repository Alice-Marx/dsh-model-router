# 一体化工程进度

## 2026-11-01：E128 T02 单一产品入口与宽窄 UI 验收闭合

[E128](evidence/20261101_single_product_ui.json) 在默认单插件 Host 完成 44 项自检后，使用真实浏览器验证：DS Bot/群与 Bot 绑定、任务、远程电脑、费用、高级工作台同侧栏，MR 高级任务规划/配置/工具/预算可达。原始 **1440×900 宽屏**和 **390 CSS px 窄屏** PNG 已入库，窄屏重排无可见横向溢出。T02 以 integration 级别 passed，正式为 **0/20、24/63、M0 11/12**。无产品代码变化，最近完整根回归为 E127 的 1980/1892/0/88，`check:client` OK。0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261101-E128.md](HANDOFF-20261101-E128.md)。

## 2026-11-01：E127 T04 同模型 Bot 私有状态与目录隔离闭合

[E127](evidence/20261101_bot_workspace_privacy.json) 实测先发现跨 Bot 目录读取真实缺陷，随后在组合层新增真实路径读取守卫：`read/read_image/glob/grep` 仅限当前 Session 工作区，junction/symlink 逃逸拒绝；真实 `pwsh` 调用以 `BOT_NATIVE_EXECUTION_DENIED` 拒绝，不能绕过。两个同模型非 Main Bot 的记忆、Session 轮换、私有目录、每 operation CLI profile 与既有 Task/机器/收据边界均通过。默认产品 **44/44**；完整根回归 **1980 项：1892 通过、0 失败、88 跳过**，`check:client` OK；新模块已纳入 npm 文件清单。T04 以 integration 级别 passed，正式为 **0/20、23/63、M0 11/12**。这不是独立 OS 账户沙箱，T25 另验。0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261101-E127.md](HANDOFF-20261101-E127.md)。

## 2026-11-01：E126 T03 严格模型不可用与恢复验收闭合

[E126](evidence/20261101_strict_model_recovery.json) 在默认产品真实调用边界注入离线缺密钥故障：原路线错误明确、零 Provider stream、零回退；首字节前异常按 unknown 保守阻断，经显式零费用 fixture 对账及凭据恢复后，新的原模型调用成功。既有未配置/不匹配/路由移除与恢复证据保持。默认产品完整探针 **42 项检查通过**，0 真实模型推理。T03 以 integration 级别 passed，正式为 **0/20、22/63、M0 11/12**。无产品代码变化，最近完整根回归仍为 E120 的 1977/1892/0/83，本轮未重跑全量。未推送/发布。当前交接为 [HANDOFF-20261101-E126.md](HANDOFF-20261101-E126.md)。

## 2026-11-01：E125 T05 白名单与旧入口越权验收闭合

[E125](evidence/20261101_legacy_authorization_acceptance.json) 复验真实 legacy-policy Host：12 个未授权旧工具（含执行/重跑）均在执行前拒绝，23 个 RPC receiver 均拒绝未认证调用；伪造 botId、PTC 路线/主体替换与跨 Bot Task/legacy rerun 均 fail-closed，合法 routes 只投影绑定模型。权限套件 **26/26**，0 真实模型推理。T05 以 integration 级别 passed，正式为 **0/20、21/63、M0 11/12**。无产品代码变化，最近完整根回归仍为 E120 的 1977/1892/0/83，本轮未重跑全量。未推送/发布。当前交接为 [HANDOFF-20261101-E125.md](HANDOFF-20261101-E125.md)。

## 2026-11-01：E124 T06 Main 无群端到端验收闭合

[E124](evidence/20261101_main_workflow_acceptance.json) 在真实 rc.3 Host 补齐分析→实现→评审→汇总：Main 私聊派给三个独立 Bot，各自保持精确模型绑定；分析/实现写文件，评审读实现并写评审，结果经真实交换返回；Main 在原私聊读回三份产物完成汇总，字节逐项核对。完整 Host **20 项检查通过**，含既有重启/replay 门禁，0 真实模型推理。T06 以 integration 级别 passed，正式为 **0/20、20/63、M0 11/12**。W07 场景已齐但 W05/W06 依赖未完成，W08 也不能提前 completed。无产品代码变化，最近完整根回归仍为 E120 的 1977/1892/0/83，本轮未重跑全量。未推送/发布。当前交接为 [HANDOFF-20261101-E124.md](HANDOFF-20261101-E124.md)。

## 2026-11-01：E123 T12 混合 CLI／远程命令整树取消验收闭合

[E123](evidence/20261101_mixed_command_tree_cancellation.json) 新增同一真实 Task 计划的混合场景：离线 CLI 原生父子进程与 Linux Docker 远程命令并行，整树取消后两个运行包均 cancelled、原 attempt 各一次，join 为 skipped。CLI 的 `native-tree` 证明及 `/proc` 父子 PID 结束核对通过；远程 `container-supervisor` 证明及单原 operation 保持。未确认停止仍 cancelling 且禁止重试。Ubuntu 相关组合 **34/34**，Windows **28 通过、0 失败、6 个 Linux-only 跳过**。T12 以 integration 级别 passed，正式为 **0/20、19/63、M0 11/12**；W08 场景已齐但需先闭合 W07/T06。无产品代码变化，最近完整根回归仍为 E120 的 1977/1892/0/83，本轮未重跑全量。0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261101-E123.md](HANDOFF-20261101-E123.md)。

## 2026-11-01：E122 T07 同一派活重复投递验收闭合

[E122](evidence/20261101_assignment_replay_acceptance.json) 在真实 rc.3 Host 分离验证 UI HTTP 重发、独立重复 `message_bot` 和真实重启后的 replay：三者均返回原回执或当前 Task，不重复 worker 投递。冷启动重复 `bot_task_start` 保留当前 Task/operation，原提交与显式重试形成的两个 attempt 不增加，后端调用为零。T07 以 integration 级别 passed，正式为 **0/20、18/63、M0 11/12**。无产品代码变化，最近完整根回归仍为 E120 的 1977/1892/0/83，本轮未重跑全量。0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261101-E122.md](HANDOFF-20261101-E122.md)。

## 2026-11-01：E121 T24 命令参数、超时与输出边界验收闭合

[E121](evidence/20261101_command_output_acceptance.json) 复验真实 argv 与进程监督：空格、Unicode、换行参数保持离散，不经 shell 拼接；超时终止自有进程树并准确报告状态，输出限 8 MiB 并使用有界 artifact。相关组合 **47 项：42 通过、0 失败、5 个 Windows Docker 腿跳过**，既有 Linux 容器证据覆盖对应路径。T24 以 integration 级别 passed，正式为 **0/20、17/63、M0 11/12**。无产品代码变化，最近完整根回归仍为 E120 的 1977/1892/0/83，本轮未重跑全量。0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261101-E121.md](HANDOFF-20261101-E121.md)。

## 2026-11-01：E120 T23 文件与 artifact 边界验收闭合

[E120](evidence/20261101_artifact_download_acceptance.json) 新增授权 `machine.artifact`：先 stat 再完整读取，核对大小和 SHA-256，限 1 MiB；缺失映射 `ARTIFACT_DOWNLOAD_EXPIRED`，其他 Bot 不能读取。产品 UI 使用同一 Bot 作用域，只展示已核验下载链接，不回显内容；过期/未授权均明确拒绝。相关组合 **28/28**；完整两阶段根回归 **1977 项：1892 通过、0 失败、83 跳过**，客户端已重建且 `check:client` OK。T23 以 integration 级别 passed，正式为 **0/20、16/63、M0 11/12**。未推送/发布，当前交接为 [HANDOFF-20261101-E120.md](HANDOFF-20261101-E120.md)。

## 2026-11-01：E119 T22 写文件并发与中断验收闭合

[E119](evidence/20261101_write_crash_consistency.json) 在真实 `fs_write` 的 rename 前后分别 `exit(86)`：前者保留旧完整文件，后者得到新完整文件，不出现半写内容；重启后原 operation 均为 `OUTCOME_UNKNOWN`、result 为 NULL，不生成成功回执。专项连续三轮通过，相关组合 **17/17**；完整两阶段根回归 **1976 项：1891 通过、0 失败、83 跳过**，`check:client` OK。T22 以 integration 级别 passed，正式为 **0/20、15/63、M0 11/12**。这证明进程中断，不冒充物理断电测试。未推送/发布，当前交接为 [HANDOFF-20261101-E119.md](HANDOFF-20261101-E119.md)。

## 2026-11-01：E118 T21 外部修改与哈希冲突验收闭合

[E118](evidence/20261101_external_hash_conflict.json) 复验真实 CAS：外部修改导致 `FILE_CHANGED` 时原字节不变；即使哈希匹配也返回 `OVERWRITE_UNSUPPORTED`，不强制替换，外部创建者获胜。真实停止回执与 create-only/dedup 语义保持。相关组合 **56 项：24 通过、0 失败、32 个 Linux-only 跳过**，既有 Linux 证据覆盖。T21 以 integration 级别 passed，正式为 **0/20、14/63、M0 11/12**。无产品代码变化，最近全量根回归为 E116 的 1974 项、0 失败，未推送/发布。当前交接为 [HANDOFF-20261101-E118.md](HANDOFF-20261101-E118.md)。

## 2026-11-01：E117 T20 文件路径逃逸验收闭合

[E117](evidence/20261101_path_escape_acceptance.json) 复验真实 Agent：`../`、绝对路径、Windows 盘符/UNC、ADS、symlink/junction 与私有 hardlink 均在读写前拒绝；公开兄弟路径和控制数据保护不受影响。相关组合 **38 项：37 通过、0 失败、1 跳过**，既有三平台证据覆盖 Linux 描述符腿。T20 以 integration 级别 passed，正式为 **0/20、13/63、M0 11/12**。这不是同账户恶意进程 OS 沙箱结论。无产品代码变化，最近全量根回归为 E116 的 1974 项、0 失败，未推送/发布。当前交接为 [HANDOFF-20261101-E117.md](HANDOFF-20261101-E117.md)。

## 2026-11-01：E116 T19 产品与协议不兼容验收闭合

[E116](evidence/20261101_protocol_compatibility.json) 新增 API major=2 与 MCP 不兼容处理：分别返回 `MACHINE_VERSION_UNSUPPORTED` / `MACHINE_MCP_VERSION_UNSUPPORTED`，携带要求版本和实际值；call 包装保留指引文本与 details。每个协商只请求一次，无 operation，已有有效机器记录不受损。发现并补齐根回归遗漏的 `remote-machines.native.mjs` 注册，最终全量 **1974 项：1889 通过、0 失败、83 跳过**，`check:client` OK。T19 以 integration 级别 passed，正式为 **0/20、12/63、M0 11/12**。未推送/发布，当前交接为 [HANDOFF-20261101-E116.md](HANDOFF-20261101-E116.md)。

## 2026-11-01：E115 T18 网络边界验收闭合

[E115](evidence/20261101_network_boundary_acceptance.json) 复验非法 Origin/Host、通配绑定、非保护 HTTP、代理信任、HTTPS CA 与 mTLS；新增真实跨域 302：重定向被拒绝，目标端点零命中，Authorization/请求体不转发，operation 为零。相关组合 **28/28**；完整两阶段根回归 **1962 项：1877 通过、0 失败、83 跳过**，`check:client` OK。T18 以 integration 级别 passed，正式为 **0/20、11/63、M0 11/12**。生产隧道部署仍是独立门禁，未推送/发布。当前交接为 [HANDOFF-20261101-E115.md](HANDOFF-20261101-E115.md)。

## 2026-11-01：E114 T17 授权撤销与配置变化验收闭合

[E114](evidence/20261101_grant_revocation_acceptance.json) 复验 **49/49**：旧 grant/审批/预览不能启动新动作；在途请求取消或保持 unknown，迟到成功不能越权；只允许显式新授权的只读对账。机器 revision CAS 与 roots-generation 变化 fail-closed，主体身份不能冒充。T17 以 integration 级别 passed，正式为 **0/20、10/63、M0 11/12**。无产品代码变化，最近全量根回归为 E113 的 1961 项、0 失败，0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261101-E114.md](HANDOFF-20261101-E114.md)。

## 2026-11-01：E113 T16 凭据失败与诊断脱敏闭合

[E113](evidence/20261101_machine_secret_redaction.json) 修复真实泄漏：`resolveSecret` 抛出含端点/token 的错误时，`openRemoteMachines` 原样外传，可能进入模型消息。现统一为 `MACHINE_SECRET_UNAVAILABLE`，配对/吊销共用脱敏读取。新增测试断言零工具动作、零 operation，错误文本/公开投影/SQLite 均无 token；既有 401、审计脱敏与 host-only secret UI 证据覆盖其余判据。相关组合 **36/36**；完整两阶段根回归 **1961 项：1876 通过、0 失败、83 跳过**，`check:client` OK。T16 以 integration 级别 passed，正式为 **0/20、9/63、M0 11/12**。未推送/发布，当前交接为 [HANDOFF-20261101-E113.md](HANDOFF-20261101-E113.md)。

## 2026-11-01：E112 T15 agent 去重与产物清理验收闭合

[E112](evidence/20261101_operation_dedup_cleanup.json) 新增真实产品场景：成功写入后删除目标文件，再提交同一请求，仍返回原 succeeded Task/operation，`fs_write` 与 operation 都保持一次，文件不重建；不同摘要继续冲突。remote-write **15/15**、journal **29/29**；完整两阶段根回归 **1960 项：1875 通过、0 失败、83 跳过**，`check:client` OK。T15 以 integration 级别 passed，正式为 **0/20、8/63、M0 11/12**。去重不等于恢复或回滚产物，未推送/发布。当前交接为 [HANDOFF-20261101-E112.md](HANDOFF-20261101-E112.md)。

## 2026-11-01：E111 T14 真实远程断网与重连验收闭合

[E111](evidence/20261101_remote_network_reconnect.json) 新增真实独立 Agent 断网测试：文件与 succeeded 收据先落盘，再 SIGKILL Agent 并切断 Host 回复，Host 为 needs-reconciliation/unknown；正常 Agent 同 dataDir 重启后重新配对新端口，只读对账原 operation 为 succeeded，`fs_write` 仍恰好一次、操作库仍一行、文件不变。专项连续三轮通过，相关组合 **15/15**；完整两阶段根回归 **1959 项：1874 通过、0 失败、87 跳过**，`check:client` OK。T14 以 integration 级别 passed，正式为 **0/20、7/63、M0 11/12**。两次 fixture 等待与 revision 错误已留痕修正，未改产品行为。未推送/发布，当前交接为 [HANDOFF-20261101-E111.md](HANDOFF-20261101-E111.md)。

## 2026-11-01：E110 T13 Host 崩溃与重启验收闭合

[E110](evidence/20261101_host_crash_recovery_acceptance.json) 复验真实断进程恢复：派发前/后和收据落盘边界均保留原 attempt/operation，unknown 不重放；已提交收据恢复成功且无第二次模型调用或重复发票，产物不丢，默认 Host 冷启动重建身份/授权/机器绑定。恢复相关 **67 项全绿**（journal 按标准 `integration-task-probe` 驱动入口 29/29）。T13 以 integration 级别 passed，正式为 **0/20、6/63、M0 11/12**；W08 仍待 T12。首轮直接运行 journal 的驱动入口错误已留痕，未计为产品失败。无产品代码变化，最近全量根回归为 E108 的 1958 项、0 失败，未推送/发布。当前交接为 [HANDOFF-20261101-E110.md](HANDOFF-20261101-E110.md)。

## 2026-11-01：E109 T11 工作区写入互斥验收闭合

[E109](evidence/20261101_workspace_mutex_acceptance.json) 复验真实 Agent 与 journal：同一物理根/别名的第二个写任务被拒，独立根和读取继续；真实终态写收据释放根并允许后继，unknown 保留至原操作对账。相关组合 **44 项：40 通过、0 失败、4 个 Linux 专项跳过**，既有三平台证据覆盖对应路径。T11 以 integration 级别 passed，正式为 **0/20、5/63、M0 11/12**；W08 仍待 T12。无产品代码变化，最近全量根回归为 E108 的 1958 项、0 失败，0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261101-E109.md](HANDOFF-20261101-E109.md)。

## 2026-11-01：E108 T10 并发限额压测验收闭合

[E108](evidence/20261101_concurrency_load_acceptance.json) 新增真实 service/journal 压测：24 个包跨两个 Bot，单 Bot 并发上限 2、服务/机器活动上限 4。连续三轮确认 ready/running 等待可见，所有包最终 succeeded，每个原 attempt 只执行一次、后端恰好调用 24 次，无丢任务、重复派发或忙循环。相关组合 **29/29**；完整两阶段根回归 **1958 项：1873 通过、0 失败、87 跳过**，`check:client` OK。T10 以 integration 级别 passed，正式为 **0/20、4/63、M0 11/12**；W08 仍待 T12。初版 fixture 使用不符合合同的工作区写后端而被拒绝，改为真实 read 压测，工作区互斥仍由 T11 专证。未推送/发布，当前交接为 [HANDOFF-20261101-E108.md](HANDOFF-20261101-E108.md)。

## 2026-11-01：E107 T09 依赖失败与独立分支验收闭合

[E107](evidence/20261101_dependency_failure_acceptance.json) 汇总并复核 E105/E106 的当前产品证据：失败直接/传递下游 blocked，合法独立只读与跨 Bot 分支 succeeded，父任务 failed 而非误报成功；实际默认 Host 保留旧串行 managed Task 语义，真实 remote-write 只阻塞依赖后代，冷恢复保留依赖边和原身份。T09 全部判据已满足，以 integration 级别 passed；正式为 **0/20、3/63、M0 11/12**。T10 压测、T12 混合 CLI/远程命令树仍未完成，W08 继续 in_progress。本轮无产品代码变化，最近全量根回归仍为 E104 的 1957 项、0 失败，0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261101-E107.md](HANDOFF-20261101-E107.md)。

## 2026-11-01：E106 W07.2 与 T08 非法计划验收闭合

[E106](evidence/20261101_planner_plan_validation.json) 复跑实际 rc.3 默认 Host 离线 Planner 探针：真实 `bot_task_plan_start` 完成目标 Bot 依赖派发、成功/失败/整树取消、重复投递、越权拒绝和冷恢复，全部检查通过，0 真实模型推理。非法计划套件 **5/5**：环路、自/悬空/重复依赖、重复包 id、未知 Bot、可执行路径/MCP/秘密、非法 effect 与未知字段均在执行前拒绝。W07.2 因此 completed，T08 以 integration 级别 passed；W07/T06 不自动通过。正式为 **0/20、2/63、M0 11/12**，实施步骤 **58/67**。本轮无产品代码变化，最近全量根回归仍为 E104 的 1957 项、0 失败，未推送/发布。当前交接为 [HANDOFF-20261101-E106.md](HANDOFF-20261101-E106.md)。

## 2026-11-01：E105 W08.5 依赖调度步骤闭合

[E105](evidence/20261101_dag_dependency_acceptance.json) 复验当前产品既有场景 **28/28**：失败及传递下游 blocked、独立分支和跨 Bot 分支 succeeded；整树取消中止所有运行分支、跳过等待 join 并等待清理；真实 remote-write 验证已应用效果不回滚、未启动后代不写入。另有 unknown 保持 cancelling、原操作对账后释放锁、冷恢复依赖边不丢等证据。W08.5 因此标为 completed；这只是实施步骤闭合，W08 整包和关联场景不自动通过，正式仍 **0/20、1/63、M0 11/12**。本轮无产品代码改动，最近全量根回归仍为 E104 的 1957 项、0 失败，0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261101-E105.md](HANDOFF-20261101-E105.md)。

## 2026-11-01：E104 Windows 计划任务适配器与本机权限未验

[E104](evidence/20261101_migration_windows_launcher_quarantine.json) 新增计划任务 XML 指纹绑定的 Disable/Stop/Enable 适配器及真实 AtLogOn writer 用例。两次唯一合成任务注册均被 `0x80070005` 拒绝，显式当前用户 + Limited/Interactive principal 也失败；未提权、未改系统权限、未触碰现有任务。最终套件 **4 项：1 通过、0 失败、3 跳过**，真实 writer 与指纹负例均记未验而非通过；完整两阶段根回归 **1957 项：1872 通过、0 失败、87 跳过**，`check:client` OK。

Windows launcher 实机闭包仍开放，适配器需在获授权的 Windows 测试机复验。三标志仍 false，W06.15 仍 in_progress，门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261101-E104.md](HANDOFF-20261101-E104.md)。

## 2026-11-01：E103 受限 unknown 文件效果对账

[E103](evidence/20261101_migration_remote_file_reconciliation.json) 新增显式对账：重算原 operation 的 client/Bot/Task/attempt/tool/args 摘要，要求已吊销 client 与 unknown fs_write，并独立读取实际文件与原始 content 全字节比对。证明只写独立 `migration_operation_resolutions`，原 operation 保持 unknown；drain 每次重验当前文件，篡改、错误参数或错误摘要继续阻断。真实 E102 崩溃场景先两次 UNRESOLVED，再经显式对账恢复 capture，未伪造 Agent 成功回执。组合 **40 项：39 通过、0 失败、1 跳过**；完整两阶段根回归 **1953 项：1871 通过、0 失败、84 跳过**，`check:client` OK。

该证明不自动结算 Host Task，不是跨域或全域对账；三标志仍 false，W06.15 仍 in_progress，门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261101-E103.md](HANDOFF-20261101-E103.md)。

## 2026-11-01：E102 真实崩溃后的 unknown 原效果负例

[E102](evidence/20261101_migration_remote_unknown_effect.json) 在真实文件落盘后 SIGKILL Agent 与 Host，再以正常 Agent 恢复同一 dataDir，产品把原 operation 标为 `unknown` / `OUTCOME_UNKNOWN`、result 为 NULL。完整 orchestration 两次均 `MIGRATION_REMOTE_OPERATION_UNRESOLVED`，没有 capture，第二次不重复扩展同一 blocked 判定，原收据保持 unknown；文件存在不能自动结案。专项连续三轮通过，组合 **37 项：36 通过、0 失败、1 跳过**；完整两阶段根回归 **1950 项：1868 通过、0 失败、84 跳过**，`check:client` OK。首次重启失败为旧 fixture 重复 pair 同一 client 的主键冲突，改用专用恢复 fixture 后通过，未改产品行为。

unknown 的独立原效果对账仍未实现，本例只证明 fail-closed。三标志仍 false，W06.15 仍 in_progress，门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261101-E102.md](HANDOFF-20261101-E102.md)。

## 2026-11-01：E101 真实已落盘效果的 drain 证据

[E101](evidence/20261101_migration_remote_effect_drain.json) 用真实独立 Agent 与外部 Host 执行 `slow.txt` 写入：夹具在产品原 `execute()` 完成后才设置收据屏障，因此文件真实落盘而 operation 仍 running。完整 orchestration 吊销 client 后以 `MIGRATION_REMOTE_OPERATION_ACTIVE` 阻断，没有 capture；文件存在也不能冒充结算。释放后原 Agent/Host 均 succeeded，resume 才写唯一 drain completed 并进入 capture。专项连续三轮通过，组合 **36 项：35 通过、0 失败、1 跳过**；完整两阶段根回归 **1949 项：1867 通过、0 失败、84 跳过**，`check:client` OK。仅改测试与 owned fixture，未改产品行为。

这是声明 Agent 的一个真实文件效果，不是未知写者、跨机生产或全域 OS 句柄闭包。三标志仍 false，W06.15 仍 in_progress，门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261101-E101.md](HANDOFF-20261101-E101.md)。

## 2026-11-01：E100 声明 Agent 未决操作结算接入 drain

[E100](evidence/20261101_migration_remote_operation_drain.json) 新增只读 `assertMigrationRemoteOperationsSettled`：核验 config/machine/client 且要求已吊销，原 Agent `operations` 中 `admitted/running/cancel_pending` 阻断为 ACTIVE，`unknown` 阻断为 UNRESOLVED；只有原收据 succeeded/failed/cancelled 才完成。drain 在吊销后追加 `remote-operation-drain-requested/completed`，缺失或失败不得 capture，恢复不重复 request。真实 Store 覆盖 running→cancelled、unknown 阻断和未吊销拒绝；crash 13 用真实 `exit(86)` 验证恢复。组合 **35 项：34 通过、0 失败、1 跳过**；完整两阶段根回归 **1948 项：1866 通过、0 失败、84 跳过**，`check:client` OK。

这只是声明 Agent 原操作状态门，不是跨域一致点或全域停写；尚未以延迟物理写入验证效果层 drain。三标志仍 false，W06.15 仍 in_progress，门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261101-E100.md](HANDOFF-20261101-E100.md)。

## 2026-11-01：E99 声明 client 吊销接入 drain 哈希链

[E99](evidence/20261101_migration_remote_client_drain.json) 将 E98 适配器接入提交编排：不可变 operation 绑定 `remoteClients` 与摘要，`exclusive-acquired` 后依次写 `remote-revoke-requested`、真实吊销并读回、`remote-revoke-completed`，再允许 capture。未确认吊销记 `blocked-drain` 且无 `capture-started`；恢复不重复 request，真实子进程 `exit(86)` 后由同一 drain 完成。默认路径另以完整 orchestration 吊销真实 Agent 验证，非仅测试回调。组合 **31 项：30 通过、0 失败、1 跳过**；完整两阶段根回归 **1943 项：1861 通过、0 失败、84 跳过**，`check:client` OK。

这只建立声明 client 的 drain 顺序，不证明在途效果或全域停写；activation/rollback 仍 false，W06.15 仍 in_progress，门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261101-E99.md](HANDOFF-20261101-E99.md)。

## 2026-11-01：E98 可重入的声明 client 吊销适配器

[E98](evidence/20261101_migration_remote_client_recovery.json) 新增 `quarantineMigrationRemoteClients`：预检全部 config/machine/client 身份，真实 CLI 吊销后读回 Agent SQLite 的持久 revoked 状态，config 摘要保持一致才记 completed；失败保留当前目标、completed 和原始 cause。真实测试覆盖成功与重入跳过、离线重试、双 Agent 第二项失败后仅恢复未确认项、身份 mismatch 零副作用。专项连续三轮 **4/4**，与 E97 组合 **5/5**；完整两阶段根回归 **1941 项：1857 通过、0 失败、84 跳过**，`check:client` OK。首轮 3 项失败根因为 Windows 不能直接 spawn `.mjs` 的 `EFTYPE`，已增加显式受信 Node runtime，失败留痕。

组件只证明声明 client 的持久授权排除，尚未被迁移 drain 调用，不停止在途效果或覆盖其他 client/机器/OS 写者；`stopWriteProvable` 等三标志仍 false，W06.15 仍 in_progress，门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261101-E98.md](HANDOFF-20261101-E98.md)。

## 2026-11-01：E97 声明 pairing client 的授权栅栏

[E97](evidence/20261101_migration_remote_client_quarantine.json) 复用真实 Agent 本地 `dsh-remote-agent revoke` 原语，验证 E96 的 Job 外写入缺口可按声明 client 关闭：第一次真实外部写入完成后吊销 `host`，Agent 进程仍存活；吊销前已签发但尚未执行的 fs_write grant 再调用得到 HTTP 401 / `AUTH_INVALID`，另一个全新 Host 持旧 pairing secret 也无法重新配对。两条路径均无目标文件、无新 operation，原 succeeded 收据不变。专项连续三轮 1/1，与 E96 及 remote-auth 组合 **12/12**；完整两阶段根回归 **1937 项：1853 通过、0 失败、84 跳过**，`check:client` OK。首次等待失败是测试把文本 stack 误按 JSON 读取，修正后通过，未改产品代码。

证据仅覆盖声明 Agent dataDir/clientId 的授权准入，不停止吊销前已在执行的效果，不覆盖其他 client/机器或直接 OS 写者；本地 CLI 尚未接入远程部署和迁移编排，恢复/rotate 未验。`stopWriteProvable`、`activationSupported`、`postActivationRollbackSupported` 仍 false，W06.15 仍 in_progress，门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261101-E97.md](HANDOFF-20261101-E97.md)。

## 2026-10-31：E96 Job 之外的 Agent 与 Job 级停止边界负例

[E96](evidence/20261031_migration_remote_effect_outside_job.json) 把 Agent 放到 Windows Job 之外（由测试进程直接 spawn），Job 内的 Host 通过真实 remote-write 与 loopback HTTP 完成四次写入后，`stop()` 回 `treeStopped:true`/`windows-job-close`、Host PID 为 `ESRCH`，而 Job 外的 Agent 仍存活。随后一个从未进入该 Job 的 Host 重新配对同一台机器并提交任务：`succeeded`、Agent 出现第五条真实收据、`outside-effect.txt` 真实落盘；被杀死 Host 的中断 attempt 仍为 `needs-reconciliation` + `HOST_INTERRUPTED/unknown`，不被后来的效果结案。这是 Job 级停止不足的负例证据，正是 `stopWriteProvable` 保持 false 的原因。

同源缺陷清理：首次完整两阶段回归有 1 项失败（`migration-sqlite-quarantine` 对刚被杀的 WAL 库原地只读打开，`SQLITE_IOERR_TRUNCATE`），与 E95 已诊断的同一类；因此把 `migration-task-journal-quarantine`、`migration-task-inflight-quarantine` 的同类观测一并改为副本快照 + 含名字节指纹，并把 in-flight 的 pinned observer 移到停止前打开。新专项连续三轮 1/1，三套加固件连续三轮各 7 项（4 通过 / 3 跳过），相关组合 **19 项：18 通过、0 失败、1 跳过**，最终两阶段根回归 phase one 1587/1583/0/4 与 phase two 349/269/0/80 合计 **1936 项：1852 通过、0 失败、84 跳过**。

这仍只是同机、仅 loopback 的边界证据，不是跨机网络、生产账户或机器重启；也**不**设计全域栅栏（机器级 fence、凭据吊销、跨 Job 监管）。`stopWriteProvable`、`activationSupported`、`postActivationRollbackSupported` 仍 false，W06.15 仍 in_progress，门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261031-E96.md](HANDOFF-20261031-E96.md)。
## 2026-10-31：E95 独立 Agent 进程的真实外部效果停止证据

[E95](evidence/20261031_migration_remote_effect_process_quarantine.json) 把 Agent 从 Host 进程拆出为独立 OS 进程：新 fixture 自建真实 `Agent`、配对并在 `127.0.0.1:0` 提供 Streamable HTTP，Host 仍以真实 `remote-write` 与 Task service/journal 经 loopback 调用；停止前断言 `agentPid !== hostPid` 且两个 PID 都存活。第四次真实文件与 Agent succeeded 收据存在而 Host 回复被屏障保持时，Windows Job 关闭后两个 PID 都 `ESRCH`，500ms 内 `agent/` 全部 store/WAL/shm/instance/journal/lock 的含名摘要、项目文件摘要、操作收据、heartbeat/active 内容与 mtime 均不变；冷恢复仍为 `needs-reconciliation` + `HOST_INTERRUPTED/unknown`，不清除 `possiblyApplied`。

观测改为“副本快照 + 字节指纹”后专项连续 6 轮 1/1；相关组合 **18 项：17 通过、0 失败、1 跳过**；两阶段根回归 phase one 1587/1583/0/4 与 phase two 348/268/0/80 合计 **1935 项：1851 通过、0 失败、84 跳过**。修复前对刚被 Job 杀死的 WAL 库做原地只读打开在 5 轮中失败 3 轮（`SQLITE_IOERR_TRUNCATE`），而同一批文件事后由新进程打开正常，故只替换观测方式、未改产品代码，失败如实留痕。

这仍只是同机、同一 Windows Job 内的独立进程证据，不是跨机网络、Job 之外的写者、生产账户、机器重启或全域停写；`stopWriteProvable`、`activationSupported`、`postActivationRollbackSupported` 仍 false，W06.15 仍 in_progress，门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261031-E95.md](HANDOFF-20261031-E95.md)。

## 2026-10-31：E94 真实 Agent loopback 外部效果停止证据

[E94](evidence/20261031_migration_remote_effect_quarantine.json) 以真实 `remote-write`、Task service/journal 和 loopback HTTP Agent 连续完成四次合成文件写入；第四次 Agent 操作已成功但 Host 回复被确定性保持。Windows Job 停止后，500ms 内全部文件内容摘要、Agent 操作/收据与 `data_version`、heartbeat/active 内容及 mtime 均不变；冷恢复保持 `needs-reconciliation` + `HOST_INTERRUPTED/unknown`，不把已存在效果误判为成功或回滚。专项连续三轮 1/1，相关组合 **18 项：17 通过、0 失败、1 跳过**；完整两阶段根回归 **1935 项：1851 通过、0 失败、84 跳过**，`check:client` OK。初版合成恢复时钟与停止竞态两次失败均留痕，未改产品代码。

这只覆盖同进程 loopback Agent 的 Windows 组件证据，不是独立 Agent 进程、跨机网络、机器重启或全域停写。W06.15 仍 in_progress，门禁仍 **0/20、1/63、M0 11/12**，三个能力标志仍 false，0 真实模型推理，未推送/发布。当前交接为 [HANDOFF-20261031-E94.md](HANDOFF-20261031-E94.md)。

## 2026-10-31：E93 累计源码与证据本地检查点

[E93](evidence/20261031_reproducible_checkpoint.json) 清理四个已确认临时产物，将累计一体化源码、测试、部署组件与证据提交为本地检查点 `cf56c388034835e878d47c60eadef89a9d936575`；695 个文件变更，提交后工作树干净，差异格式检查通过。`check:client` 与 `integration:check` 通过；完整两阶段根回归合计 **1934 项：1850 通过、0 失败、84 跳过**。这是本地检查点而非干净检出复现或成熟发布，未推送/发布，0 真实模型推理。门禁仍 **0/20、1/63、M0 11/12**，真实迁移激活、全域停写、激活后回退和生产验收仍开放。当前交接为 [HANDOFF-20261031-E93.md](HANDOFF-20261031-E93.md)。

## 2026-10-31：E92 C9 产品 gate→writer 原子准入

[E92](evidence/20261031_product_migration_admission.json) 将共享准入接入 `startBotProduct`：`openProductFunding` 前先 `acquireMigrationShared` 并再次 `assertMigrationStartupAllowed`，writer 整个生命周期持有，启动失败与 dispose 均释放。存活组合 drain 超时，pending gate 拒绝创建并释放，关闭后独占成功。fence 与 atomic-rename 纳入发布清单。两项产品测试通过，完整两阶段根回归合计 **1934 项：1850 通过、0 失败、84 跳过**；`check:client` OK、文档 26/26。

C9 只约束参与 fence 的新 writer，不停止旧非参与进程，不证明全域停写，也不开启激活。W06.15 外部旧入口、机器重启和生产验收仍开放，门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未提交/推送/发布。当前交接为 [HANDOFF-20261031-E92.md](HANDOFF-20261031-E92.md)。

## 2026-10-31：E91 dsh-superagent 思路对齐与 Task 阶段投影

[E91](evidence/20261031_superagent_alignment.json) 对照只读研究原型，将 Trigger→Eval→Ticket→Assignment 映射到现有请求→准入→Task→attempt，将 Effects 对齐到 outbox/dispatch fence，不重写既有幂等、单一写者、提交后执行、unknown/reconcile 和 stopProof 边界。新增 `taskStage` 计算字段：working/queued、working、working/cancelling、working/budget 与 person/reconciliation、person/blocked、person/failed、person/review、idle；不凭文本猜 person/delivery 或 person/answer，未知状态抛 `TASK_STAGE_INVALID`。

4 条测试通过，含真实 journal queued→running→succeeded 投影。首次根回归因发布清单缺 `task-stage.mjs` 失败 1 项，补齐后完整两阶段合计 **1932 项：1848 通过、0 失败、84 跳过**；`check:client` OK、文档 26/26。后续 Source 接入沿用同一 Task 工作流，UI 优先展示 person/*。产品门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未提交/推送/发布。当前交接为 [HANDOFF-20261031-E91.md](HANDOFF-20261031-E91.md)。

## 2026-10-31：E90 执行中 Task 停止证据与 Windows Job 关闭

[E90](evidence/20261031_migration_task_inflight_quarantine.json) 用真实 journal 的 `submit`/`claim`/`beginDispatch`/`linkExecution` 把 attempt 停在 `running` 且效果未确认，pending gate 下 attempt/outbox 行与 `task_events` 最大 seq 持续增长（1→4、1→4、3→12）；Windows Job 停止后 fixture PID 观测到 `ESRCH`，500ms 内行数、attempt 状态指纹、另一连接读到的 `PRAGMA data_version` 与 heartbeat 内容/mtime 均不变，而停止时 attempt/operation 仍 `running`、`result` 与 `finished_ms` 为 NULL——停止证据来自 OS 边界加观测窗口，不来自终态行。冷恢复走产品 `recover()` 得 `needs-reconciliation` + `HOST_INTERRUPTED/unknown`，补提 succeeded/cancelled 被 `TASK_STOP_UNCONFIRMED` 拒绝；`possiblyApplied` 语义由真实 `createRemoteWriteBackend()` 钉住。新套件 **3 项：2 通过、0 失败、1 跳过**；本机组合 **12 项：9 通过、0 失败、3 跳过**；根回归 **1928 项：1841 通过、3 失败、84 跳过**，`check:client` OK、文档四件套 26/26。3 项失败即已知的并发就绪超时（remote-auth 27.5s、remote-command 28.0s、remote-write 26.3s，均为约 25s 就绪窗口），三文件单跑 **32 项：27 通过、0 失败、5 跳过**；按预期 1928 项与 84 跳过相符，但**预期 0 失败未达成**，如实记录、不宣称已修。

这只是**单个执行中 attempt** 的停止证据，不是完整 Task 取消，也不是停写证明：`stopWriteProvable`、`activationSupported`、`postActivationRollbackSupported` 仍为 false。未覆盖机器重启矩阵、远程 Agent 真实外部效果、全数据域写句柄、其他 launcher/账户与 Linux 真机（本轮 Fedora SSH 握手超时，Linux 侧只有设计与负例），PID 复用未做 startTicks 级校验；夹具写的 `migration-gate.json` 只是最小合成文件，因此该断言证明的是这些 writer 不读 gate，而非与 gate schema 交互。W06.15 仍 in_progress。门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未提交/推送/发布。

## 2026-10-31：E89 Task journal/outbox 写者与 Windows Job 关闭

[E89](evidence/20261031_migration_task_journal_quarantine.json) 使用真实 `openTaskJournal().submitPlan()` 提交唯一合成计划，每次事务创建 Task、attempt、operation 和 outbox，不调用执行器或模型。pending gate 下 outbox 继续增长；Windows Job 停止后只读核对 500ms 无新行，覆盖真实 journal 提交和关闭。新套件连续 3 轮均 **2 项：1 通过、0 失败、1 跳过**；本机组合 **116 项：96 通过、0 失败、20 跳过**；根回归 **1925 项：1842 通过、0 失败、83 跳过**，`check:client` OK、文档 26/26。

仅新建 journal 行已验，执行中 Task、远程外部效果、未知收据、其他 writer 和全域停写未验，W06.15 仍 in_progress。门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未提交/推送/发布。当前交接为 [HANDOFF-20261031-E89.md](HANDOFF-20261031-E89.md)。

## 2026-10-31：E88 SQLite WAL 写者与 Windows Job 句柄关闭

[E88](evidence/20261031_migration_sqlite_quarantine.json) 使用真实 `openSqliteRouterState` 在合成 WAL 库中持续 `saveHealth()`，pending gate 下 syntheticTick 与 `router_meta` revision 增长；Windows Job 停止后另开只读连接，500ms 内 tick/revision 不再变化，覆盖真实提交与数据库句柄关闭。新套件连续 3 轮均 **2 项：1 通过、0 失败、1 跳过**；本机组合 **114 项：95 通过、0 失败、19 跳过**；根回归 **1923 项：1841 通过、0 失败、82 跳过**，`check:client` OK、文档 26/26。

仅一个 SQLite writer/连接已验，Task/outbox、其他连接、外部 writer 和全域停写未验，W06.15 仍 in_progress。门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未提交/推送/发布。当前交接为 [HANDOFF-20261031-E88.md](HANDOFF-20261031-E88.md)。

## 2026-10-31：E87 SDK profile loader 负例与 Windows Job 隔离

[E87](evidence/20261031_migration_sdk_loader_quarantine.json) 使用固定 rc.3 `loadProfileDirectory()` 的真实 `dropRetiredBundles()` 写路径：合成 profile 每轮重新写入退休 bundle，pending gate 下 syntheticTick 继续增长，Windows Job 停止后 tick 和 manifest 不再变化。最终 bundle 列表为空，排除模拟写入。新套件连续 3 轮均 **2 项：1 通过、0 失败、1 跳过**；本机组合 **112 项：94 通过、0 失败、18 跳过**；根回归 **1921 项：1837 通过、3 失败、81 跳过**，3 个既有远程超时单跑 **32 项：27 通过、0 失败、5 跳过**。

仅 SDK 退休 bundle 路径已验，link projection、其他 SDK 服务、模型初始化、其他后台 writer 和全域停写未验，W06.15 仍 in_progress。门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未提交/推送/发布。当前交接为 [HANDOFF-20261031-E87.md](HANDOFF-20261031-E87.md)。

## 2026-10-31：E86 旧 MR router-state 负例与 systemd 停止证据

[E86](evidence/20261031_migration_legacy_mr_quarantine.json) 直接执行未修改旧 `createRouterState().saveHealth()`，pending migration gate 下合成 tick 继续增长，E84 mask+stop 后 tick 停止，release 不重启。远程连续 3 轮及最终轮均 **2 项：1 通过、0 失败、1 跳过**，无 mask 残留；本机组合 **110 项：93 通过、0 失败、17 跳过**。根回归 **1919 项：1836 通过、3 失败、80 跳过**，3 项均为既有 remote-auth/remote-command/remote-write 就绪超时，三文件单跑 **32 项：27 通过、0 失败、5 跳过**，不据此宣称永久修复。

本轮仅覆盖旧 MR JSON writer，SDK loader、SQLite、其他后台 writer、机器重启与全域停写未验，W06.15 仍 in_progress。门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未提交/推送/发布。当前交接为 [HANDOFF-20261031-E86.md](HANDOFF-20261031-E86.md)。

## 2026-10-31：E85 冻结 DS lockBroken 负例与 systemd 停止证据

[E85](evidence/20261031_migration_legacy_ds_quarantine.json) 直接执行未修改冻结 `store.js/home-lock.js`：仅测试进程对 `state.lock` 写入定点注入 EACCES，真实进入 `lockBroken`，在 pending migration gate 下 revision 继续增长，证明 gate 和破坏 state.lock 都不能停写。E84 fragment 指纹 mask+stop 后 revision 停止，release 不重启。远程连续 3 轮及最终轮均 **2 项：1 通过、0 失败、1 跳过**，无 mask 残留；本机组合 **108 项：92 通过、0 失败、16 跳过**；根回归 **1917 项：1838 通过、0 失败、79 跳过**，`check:client` OK、文档 26/26。

夹具的 mkdir 参数、目录/symlink 被当成其他 Host、unref 退出及等待毫秒 NaN 均留痕修正；lockBroken 明确定性为故障注入而非只读文件系统实测。仅一个受控 DS store writer 已验，SDK/MR、其他 launcher、机器重启与全域停写未验，W06.15 仍 in_progress。门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未提交/推送/发布。当前交接为 [HANDOFF-20261031-E85.md](HANDOFF-20261031-E85.md)。

## 2026-10-31：E84 systemd 显式单元持久重启栅栏

[E84](evidence/20261031_migration_systemd_quarantine.json) 新增 fragment 指纹绑定的 systemd 隔离适配器：先 mask 并直接核验 `/dev/null` 链接，再 stop 等 inactive；回执绑定 `fragmentPath+SHA-256`，transient 删除 fragment 后仅在无替代文件且 masked+inactive 时允许解除，替换文件重新校验。coordinator 死亡保留 mask，错误不自动 unmask，活跃解除拒绝，release 永不启动旧 writer。调查修正 transient is-enabled 不可靠、卸载 is-active exit 4、fragment 删除和活跃测试重建四处问题。

真实 `Restart=always` 服务先以新 MainPID 证明自动重启，再验证 mask+stop 后启动拒绝与心跳停止、coordinator SIGKILL 保持、活跃解除拒绝和 fragment 负例零副作用。连续 3 轮及最终轮均 **5 项：4 通过、0 失败、1 跳过**，无 mask 残留；本机组合 **106 项：91 通过、0 失败、15 跳过**。第一次后台根日志无汇总判无效，完整前台重跑 **1915 项：1837 通过、0 失败、78 跳过**；`check:client` OK、文档 26/26。仅显式 systemd 单元已验，其他 launcher、真实旧入口、机器重启和全域停写未验，W06.15 仍 in_progress。门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未提交/推送/发布。当前交接为 [HANDOFF-20261031-E84.md](HANDOFF-20261031-E84.md)。

## 2026-10-31：E83 Linux delegated cgroup 非 root 实测

[E83](evidence/20261031_migration_delegated_cgroup.json) 将 E82 Linux 后端扩展为显式 `cgroupRoot`：JS/Python 均要求 realpath 不越出 cgroupfs 且目录归当前有效用户所有，Python 另以 `/proc/self/cgroup` 强制 supervisor 已位于 delegated 根或后代中。调查保留三段失败：systemd scope 仅 Delegate=yes 仍 root 拥有、测试隐式全局 crypto 在清空环境缺失、根外 supervisor 即使补父级 procs 仍因共同祖先权限触发 preexec_fn 失败。最终模型是委托方配置目录与父级 procs，并先让 supervisor 进入 delegated 根再降权；没有永久账户、服务或 sudo 规则。

root 与 `nobody` 均完成同一套件，nobody 连续 3 轮及最终轮均 **5 项：4 通过、0 失败、1 跳过**，主动停止、直接子进程退出、coordinator SIGKILL、父/孙 membership 均通过，root-owned cgroup 负例明确拒绝；无本轮残留，远程/本地 SHA-256 一致。本机相关组合 **101 项：90 通过、0 失败、11 跳过**；最终根回归 **1910 项：1836 通过、0 失败、74 跳过**，`check:client` OK、文档 26/26。W06.15 仍 in_progress：永久服务/权限模型、外部重启、真实旧入口、supervisor SIGKILL 与全域停写未验。门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未提交/推送/发布。当前交接为 [HANDOFF-20261031-E83.md](HANDOFF-20261031-E83.md)。

## 2026-10-31：E82 停写栅栏切片 4——Linux cgroup v2 受控进程树

[E82](evidence/20261031_migration_linux_quarantine.json) 在授权 Ubuntu 测试目标落地 Linux 后端：Python supervisor 创建 operation 专属 cgroup v2，目标在 preexec/exec 前加入，后代继承；主动 stop、目标退出、coordinator 死亡均执行 `cgroup.kill`，只有 `cgroup.procs` 为空才报告 `treeStopped:true`/`linux-cgroup-v2-kill` 并显式 rmdir。coordinator 用 `/proc` startTicks 防复用，目标 stdio 用临时文件防管道阻塞，绝对路径/闭集 argv/禁 shell。父与孙进程均有 `/proc/<pid>/cgroup` membership 直接断言。所有结果保持 `externalRestartBlocked:false`、`persistentExternalExclusion:false`、`stopWriteProvable:false`。

远程连续 3 轮及最终轮均 **5 项：4 通过、0 失败、1 跳过**，覆盖主动停止、直接子进程退出回收后代、coordinator SIGKILL 和延迟写入；生产模块/测试 SHA-256 与本地一致，最终无本轮 cgroup 残留。首次根 cgroup.kill 能力误判全跳过及 fs.rm 留下空 capability 目录均留痕修正。本机相关组合 **101 项：90 通过、0 失败、11 跳过**；最终根回归 **1910 项：1836 通过、0 失败、74 跳过**，`check:client` OK、文档 26/26。W06.15 仍 in_progress：专用非 root 权限模型、外部重启、真实旧入口、机器重启与全域停写未验，supervisor 自身 SIGKILL 未测。门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未提交/推送/发布。当前交接为 [HANDOFF-20261031-E82.md](HANDOFF-20261031-E82.md)。

## 2026-10-31：E81 配置事务 Windows ctime 稳定性修复

[E81](evidence/20261031_migration_file_stability.json) 定位并修复 E79 遗留的 `MIGRATION_COMMIT_SOURCE_CHANGED` 假阳性。先补无路径/无内容的 field/observation 诊断；24 轮未复现不当作修复，真实 hardlink 探针第 70 次捕获 open 前仅 ctimeNs 延迟变化，dev/ino/size/mtimeNs/nlink 均不变。初版只取 opened ctime 基线在第 1588 次 after-read 再失败，明确判为不充分。最终仅对 **Win32 + read-stable + ctimeNs** 做最多 2 次、间隔 10ms 的完整重读，重新通过全部元数据与内容复核；其他字段、阶段和 POSIX 漂移绝不重试，并新增 nlink 全区间复核。

确定性用例 **5/5**，最终真实探针 **5000 次 0 不稳定图像**，12 路配置事务全部 12/12，相关组合 **96 项：89 通过、0 失败、7 跳过**；最终根回归 **1905 项：1835 通过、0 失败、70 跳过**，`check:client` OK、文档 26/26。所有非复现、根因复现和初版失败均留证。修复仅是私有配置事务的 Windows 元数据时序适配，不是停写证明；W06.15 外部隔离、Linux 实机、激活和生产迁移仍开放，门禁仍 **0/20、1/63、M0 11/12**。0 真实模型推理，未提交/推送/发布。当前交接为 [HANDOFF-20261031-E81.md](HANDOFF-20261031-E81.md)。

## 2026-10-31：E80 停写栅栏切片 4——受控 Windows 进程树组件（W06.15 仍在进行）

[E80](evidence/20261031_migration_os_quarantine.json) 新建 W06.15 并落地[切片 4 组件设计](plan/20261031_migration_os_quarantine.md)：`launchMigrationProcessTree` 以显式受信 runner 复用既有 `ProcessJob.cs`，绝对路径 + 闭集有界 argv、禁止 PATH/shell，从 CreateProcess 起纳入 Job。主动 stop 只终止本 handle wrapper 并等待原 close；直接子进程退出与真实 coordinator SIGKILL 同样由原生 Job/watchdog 回收后代。仅 close 产生 `treeStopped:true`/`windows-job-close`，超时为 `MIGRATION_OS_QUARANTINE_STOP_UNKNOWN`；同步 `EFTYPE` 归一为 `RUNNER_UNAVAILABLE`，异步未启动不伪造回执。所有结果恒带 `externalRestartBlocked:false`、`persistentExternalExclusion:false`、`stopWriteProvable:false`，无 release/activate。

新套件连续 3 轮均为 **7 项：6 通过、0 失败、1 跳过**；八套相关组合 **75 项：68 通过、0 失败、7 跳过**；最终根回归 **1900 项：1830 通过、0 失败、70 跳过**，`check:client` OK、文档四件套 26/26。开发期一次错误的 126 测试预期和一次真实同步 `EFTYPE` 缺陷均保留记录、修复后复验。**这只是合成父/孙进程与 coordinator 的 Windows Job 组件证据**：专用账户、外部服务/计划任务/其他 launcher 重启拦截、真实旧 DS/SDK/MR、未知写者、网络共享、机器重启、Linux 与全域停写均未验，W06.15 保持 in_progress。门禁仍 **0/20、1/63、M0 11/12**，0 真实模型推理，未提交/推送/发布。当前交接为 [HANDOFF-20261031-E80.md](HANDOFF-20261031-E80.md)。

## 2026-10-31：E79 原子 JSON rename 有界重试（停写栅栏切片 5 加固）

[E79](evidence/20261031_migration_atomic_rename.json) 闭合 E78 遗留的 Windows `temp→migration-gate.json` / fence 原子发布瞬时失败：新增内部 `renameMigrationFile`，仅对 `EPERM/EACCES/EBUSY` 做首次尝试加最多 5 次重试、固定间隔 50ms；其他错误立即抛出，耗尽保留最后原始错误。临时文件写入、fsync、关闭、finally 清理、非 Windows 目录 sync 与严格读不变。两个编排套件和原生 crash loop 的测试侧 EPERM 兜底已删除，新增 4 条确定性用例覆盖三类瞬时码、第六次成功、六次耗尽与 ENOENT 不重试。

修复前 6 轮配置事务采样共 72 项、5 失败，其中 3 个目标 rename EPERM、2 个独立 `MIGRATION_COMMIT_SOURCE_CHANGED`；修复后 8 轮共 96 项，0 个 rename 错误，7 轮 12/12，另 1 轮仍保留 `SOURCE_CHANGED`。后者在改动前后均出现，本轮未修、未放宽、未用重试掩盖，已列为独立后续诊断项。七套相关套件 **64 项：63 通过、0 失败、1 跳过**；最终根回归 **1893 项：1824 通过、0 失败、69 跳过**，`check:client` OK、文档四件套 26/26。E78 的三个远程就绪超时本轮未复现，但未改对应路径，不宣称永久修复；Linux case 22 仍未验。门禁仍 **0/20、1/63、M0 11/12**，无产品接线或激活路径，0 真实模型推理，未提交/推送/发布。当前交接为 [HANDOFF-20261031-E79.md](HANDOFF-20261031-E79.md)。

## 2026-10-31：E78 停写栅栏切片 5——可恢复提交编排与门控判据（activation 保持 false）

[E78](evidence/20261031_migration_commit_orchestration.json) 落地[切片 5 设计](plan/20261031_migration_commit_orchestration.md)：`migration-commit-orchestration` 用一条**哈希链 journal**（每条记录带前一条 digest，改写/重排即 `MIGRATION_ORCH_CHAIN_INVALID`）串起 inspect→intent→drain→capture→maintenance→activate→release 七阶段，只前进不回退；恢复按 journal 重算阶段并仅向前推进，同一 phase+reason 只记一次，取消保留围栏（`cancelled-fence-held`）。**激活只评估不授予**：C1–C5 由活围栏、已验 capture 与启动 gate 现算，任一不真即 `blocked-activation` 并写 `activation-refused`，gate 永不写 `committed`，结果恒带 `activationSupported:false`／`postActivationRollbackSupported:false`／`stopWriteProvable:false`；围栏四硬前提（数据与账本 capture 均 verify、drain-completed、gate 终态、owner 一致）不满足即 `blocked-release` 且保留 intent。本波同时闭合三处**既有**栅栏缺口（本次才闭合，不是既往已验）：intent 原子写（临时文件 + fsync + rename + 目录 sync，截断 intent 不再被读成"无维护状态"，G1）、坏 JSON fail-closed 不再放行（G2）、同一 `operationId` 不再双 owner 且败者不能释放（G4）；`abandonMigrationIntent` 成为排空超时的唯一安全出口（`fence.release()` 回答 `MIGRATION_FENCE_NOT_HELD`）。配置事务新增可选显式 `operationId` 并三方绑定（fence/plan/gate），受 gate 读侧限制**收窄为 UUID v4**（主代理批准），非 v4 一律 `MIGRATION_ORCH_OPERATION_ID_UNSUPPORTED`。

验证：六套相关用例合跑 **60 项：59 通过、0 失败、1 跳过**（栅栏 7/7、栅栏硬化 9/9、配置事务 12/12、编排原生 15/15＝11 个真实子进程崩溃点 + case 16/17/20/N1、编排纯函数 11 通过+1 跳过、ci-contract 5/5；回退就绪 6/6 单列、不计入这 60）；跳过项是 §9 case 22（Linux 写句柄仅 advisory），**Linux 腿本会话未跑**（DSH 配置的 Fedora 主机 SSH 握手超时），不得视为已验。 栅栏两套的 `waitFile` 早返回竞态已根因定位并**在测试侧修复**（夹具只写 ACQUIRED 或错误码、`writeFile` 先建空文件、旧 `waitFile` 读到空文件即返回；改为等 trim 非空、超时仍 15s），**非产品缺陷、非本切片引入**：`tests/migration-fence.native.mjs` 5d96ddb2 → f211feab、`tests/migration-fence-hardening.native.mjs` d5b9d77e → b1b763a2，夹具未改仍 54b27026；E74 的历史 blob 按原样保留、不改写。设计文档第 5 行原有两处 `../HANDOFF-*.md` 链接会越出 `plan/` 而违反文档测试，已改为代码路径写法（只改链接形式，设计语义与 §11 未动），文档四件套 **26/26**（含文档 3/3）。根回归 **1889 项：1817 通过、3 失败、69 跳过**，3 项失败即既有并发就绪抖动（remote-auth 的 fixture HTTPS 超时、remote-command／remote-write 的 `TASK_RUNNER_UNAVAILABLE`，约 25s 就绪超时），三文件单跑 **32 项：27 通过、0 失败、5 跳过** 全绿；`integration:check` 32R/40F/63T/20W 有效，`integration:report` 重生成 STATUS.txt。首次合并六套时曾因 Windows 瞬时 EPERM（`migration-gate.json` rename）失败 1 项，该文件单跑 12/12 两次不复现、第二次合跑全绿——如实记录未改写。编排模块**未接线任何产品入口**（设计缺口 G5/C9），无激活→提交路径，不读写真实用户数据；坏 intent.json 故意不可经 API 撤回（fail-closed，需人工看字节）。整体仍为 **0/20 整包、1/63 场景、M0 11/12**；切片 4（OS 隔离）、激活后新增数据回退、生产常开仍开放，组件证据不等于产品迁移能力。0 真实模型推理，未提交/推送/发布。

## 2026-10-31：E77 combined-host 容器命令端到端验收

**当前详细交接以 [HANDOFF-20261031-KIMI-E77.md](HANDOFF-20261031-KIMI-E77.md) 为准。**

[E77](evidence/20261031_command_combined_host.json) 闭合 E76 的默认产品命令场景缺口：`grantFor` 现在只在 workspace-write 且同时具备 status/cancel 的授权中发布 `remote/container_command_v1`，实际 AgentLoop 不再遭遇后端已注册但能力未编译的 `TOOL_DENIED`。Win11 非容器路径返回 never-started、`possiblyApplied:false`、确认停止且无锁；Ubuntu 固定镜像真实 Docker 返回 exitCode 0、确认停止且原 operation 仅一次。两平台默认产品检查均 42 项通过。

首次授权缺口、结果投影断言修正、远程精简 fixture 缺文件和一次 Windows EPERM 均保留；改用新的完整源码目录及既有隔离依赖后取得上述结果。最终本机根回归 **1853 项：1785 通过、0 失败、68 跳过**，check:client 与 integration:check 通过。远程不是干净安装/生产部署，Windows OS 隔离命令、停写切片 4/5、真实推理与完整验收仍未完成。整体仍为 0/20 整包、1/63 场景 passed、M0 11/12，未提交/推送/发布。

## 2026-10-31：E76 容器命令 Task 后端产品注册（设计门 5）

[E76](evidence/20261031_command_product_registration.json) 完成[命令 facade 设计](plan/20261030_remote_command_task_facade.md)最后一道门：`product-composition` 将 `createRemoteCommandBackend` 与 remote-write 并列组合并发布双目录条目（命令条目标注"仅别名 argv"）；`parseTaskPlan` 的 workspace-write 计划接受 `{backend:'remote-command',input:{machineId,rootId,workspaceRelativePath,argv,timeoutMs}}` 执行形状（归一化输出保留真实后端并按各自解析器复验；read 效果、跨后端与畸形输入拒绝——开发中栈追踪暴露了归一化返回处**第二处**硬编码 remote-write 站点并修复）；产品任务投影增量携带 `exitCode`/`notStarted`；模型侧 `bot_task_plan_start` 描述文档化命令形状与边界（operator 批准别名、仅容器、无路径/端点/秘密、绝不原生 shell）；发布文件清单补上新模块（由闭包测试抓出，非人工）。

验证：Ubuntu（真实 Docker）**21/21**（命令 8 含计划用例与真容器派发 + UI 8 含两条新命令收据用例 + 合同 5）；Win10 **21 项 0 失败/5 跳过**；本机根回归 **1853 项：1785 通过、0 失败、68 跳过** + check:client OK。首跑 2 项失败（括号笔误、清单缺模块）修复重跑并记录。combined-host 端到端命令场景、更宽的模型面开放策略、Windows OS 边界与切片 4/5 仍开放。0 真实模型推理，未提交/推送/发布。

## 2026-10-31：E75 停写栅栏切片 3——只读最新回退准备诊断

[E75](evidence/20261031_migration_rollback_readiness.json) 落地[停写栅栏设计](plan/20261030_migration_stop_fence.md)第 6 节切片 3：`diagnoseMigrationRollbackReadiness` 以**只读**方式（query_only、诊断前后文件字节不变有断言）回答"最新新世代数据现在能否交接回退"——活跃任务（ready/admitting/running/cancelling/waiting-budget）、`needs-reconciliation`、可重试 `blocked`、attempts 可证已启动的 `skipped`、未决操作、未投递 outbox、开放 hold 各为独立阻断码（有界 ID 列表）；**not-started skipped（started_ms 空 + notStarted 证据）仅提示不阻断**；归档绑定要求账本归档通过校验**且**其私有导出文档与活库当前导出一致（校验器返回脱敏摘要不含 digest，故直接比对私有导出；归档后改库回答 `BACKUP_BINDING_STALE`）。结果恒带 `postActivationRollbackSupported:false` 与 `moneyRollbackGuardUntouched:true`，现有 `sqlite-router-state` 资金 `rollback()` guard 一字未动。

合成 journal/router 库 + 真实账本归档 6 项用例：Ubuntu **6/6**、Win10 **6/6**、本机根回归 **1850 项：1782 通过、0 失败、68 跳过**，套件注册进 `npm test`/CI。开发中发现并修复：归档目录与源库同目录被拒（fixture 分离 data/archive）、校验器脱敏摘要导致绑定重设计、两处 fixture 缺陷、Ubuntu 首跑依赖闭包未传全（补传重跑）——全部记入证据。切片 4/5、跨域捕获绑定与激活仍开放。0 真实模型推理，未提交/推送/发布。

## 2026-10-31：E74 停写栅栏切片 2——单机共享准入与迁移独占栅栏原型

[E74](evidence/20261031_migration_fence.json) 落地[切片 2](plan/20261031_migration_fence.md)（synthetic homes、仅协议参与方）：**共享准入**在 guard 互斥（声明目录 + 属主身份 + 死属主/自身残留回收 + 移除重试）下原子完成"查 intent/exclusive → 建声明"，关闭"读 gate → 建 writer"间隙；**协调者独占**先持久 intent（仅此一步即阻断一切新准入，且跨协调者死亡存活），排空观察存活共享持有者，再于 guard 内复查无新声明且 intent 属己后取独占声明；释放属主校验。**崩溃接管**：存活外来协调者（有无独占声明皆然）一律 `MIGRATION_FENCE_BUSY`，可证死亡者的 intent 持续阻断直到接管者验证死亡、回收陈旧声明并重跑排空。Linux 声明携带 /proc 起始 tick 身份（PID 复用安全），Windows 原型仅 pid 身份（如实记录）。

真实子进程用例 7 项（准入/释放、intent 拒新+排空、late-acquire 竞态关闭、并发协调者、SIGKILL 崩溃接管、属主校验释放、输入界限）：Ubuntu **7/7**、Win10 **7/7**、本机根回归 **1844 项：1776 通过、0 失败、68 跳过**，套件注册进 `npm test`/CI。开发中四个真实缺陷（测试自设排空死锁、Windows guard 自残留死锁、intent 断言竞态、exited 监听竞态）逐个复现修复重跑并记入证据。仅协议参与方、同机、非内核写栅栏；切片 3/4/5 与产品接线仍开放，`activationSupported` 保持 false。0 真实模型推理，未提交/推送/发布。

## 2026-10-31：E73 停写栅栏切片 1——私有只读写者/域清点

[E73](evidence/20261031_migration_writer_inventory.json) 落地[停写栅栏设计](plan/20261030_migration_stop_fence.md)第 6 节切片 1：`inventoryMigrationWriters` 只接受**显式声明**的数据域（闭集合同、绝对路径、有界），对每个声明根解析 `dev:ino` 物理身份（别名/重叠声明收敛）；Linux 真实扫描 `/proc/<pid>/fd`+`cwd`/`exe`，按内核 `fdinfo` 八进制 flags 分类句柄**写访问**，访问者带 `/proc` stat 字段 22 起始 tick（PID 复用安全身份）、comm 与命令行；**调用进程自身同样上报**（无自排除）；描述符不可读的进程计为枚举缺口（`WRITER_ENUMERATION_PARTIAL`）而绝不当作无写者；非 Linux 平台如实报告枚举能力缺口。结果永远携带 `stopWriteProvable:false`——清点是诊断，不是停写证明，`activationSupported` 保持 false。

9 项原生用例（真实子进程写/读句柄持有者、cwd 访问、符号链接声明同身份、调用者自报、死亡清除、闭集输入、缺失根诊断、能力缺口）：Ubuntu **9 项 8 通过/0 失败/1 跳过**（真实 /proc），Win10 **4 通过/5 跳过**，本机根回归 **1837 项：1769 通过、0 失败、68 跳过**，套件注册进 `npm test`/CI。切片 2（单机准入/独占栅栏原型）、3（回退就绪诊断）、4（OS 隔离适配器）、5（可恢复提交编排）与激活仍开放。0 真实模型推理，未提交/推送/发布。

## 2026-10-31：E72 版本化容器命令 Task 后端

[E72](evidence/20261031_remote_command_facade.json) 按[设计文档](plan/20261030_remote_command_task_facade.md)落地命令 facade 的组件层（[CODEX](HANDOFF-20261030-CODEX.md) P0#4 / [KIMI](HANDOFF-20261030-KIMI.md) §7.3）。**Agent 侧**：独立变更类目工具 `container_command_v1`——非容器 Agent 把操作落成 never-started（`notStarted/stopConfirmed/possiblyApplied:false`）而非抛错（抛错会让 admitted 操作悬置、Task 永久 unknown），全链无原生回退；argv 是唯一输入形态；admission 工具清单显式纳入。**Host 侧**：`parseRemoteTaskCommand` 闭集合同（机器/根/工作区相对目录/1..64 有界非秘密 argv/1000..600000ms 截止），script/env/endpoint/cwd 一律拒绝；`createRemoteCommandBackend` 镜像 remote-file 纪律（派发前 journal checkpoint、有界轮询、原操作身份与严格监督者停止证据校验、丢回复 unknown+仅观察对账、未发出派发落 never-started）；**取消**请求原 cancel 后在容忍真实 docker 拆卸的有界窗口内观察原操作到终态再取收据，不足则 unknown——绝不伪造停止。task-service/task-journal/remote-machines 相应扩展（write→fs_write、command→container_command_v1 映射与按后端的授权工具检查）。

新增 `tests/remote-command-tasks.native.mjs` 7 项注册进 `npm test`/CI。真实 Docker（Ubuntu + 固定摘要镜像 + E71 operator 授权夹具）**21/21**（命令 7 + write 14 不回退）；Win10 **21 项 0 失败/5 显式跳过**；本机根回归 **1828 项：1765 通过、0 失败、63 跳过**。首跑 5 个真实失败（admission 工具清单、成功语义断言、竞态断言、漏调取消、5s 窗口 vs 真实拆卸、0700 夹具 vs 65532 写入——后者正是 E71 授权合同）逐项修复重跑并记入证据。产品 Task/UI 注册（设计门 5）、Windows OS 边界与模型 shell 门控复核仍开放。0 真实模型推理，未提交/推送/发布。

## 2026-10-31：E71 真实工作区权限与跨 dataDir 根协调

[E71](evidence/20261031_workspace_permissions.json) 落地 [CODEX 交接](HANDOFF-20261030-CODEX.md) P0#3 剩余两半（[设计](plan/20261031_workspace_permissions.md)）。**权限边界**（真机 Docker 探针，Ubuntu 6.8 内核 + 固定 node 镜像）：worker 以 65532:65532、全能力丢弃运行——operator 授权根可读写；0600 所有者私有文件与 0700 私有子树一律 `EACCES` fail-closed；对他人文件 `chmod`/`chown` 得 `EPERM` 无提权；worker 建档归属 uid 65532。Agent 永不 chmod/chown 用户数据，夹具只准备自己的树。**跨 dataDir 协调**（产品代码）：`WorkspacePin.capture` 在 Linux 对目录 `dev:ino` 取 `/tmp/dsh-agent-root-locks` 独占声明（别名同 inode 同声明），沿用 controller-lock 的 PID 存活 + fstat/lstat 身份纪律回收可证死亡持有者；同进程嵌套捕获引用计数（容器 shell 重锚不自死锁）；声明目录不可用时**可观测降级**为原单库语义而非破坏既有工作区。冲突对外仍是 `WORKSPACE_BUSY`。

新增 `tests/workspace-root-lock.native.mjs` 4 例（跨进程互斥+击杀回收、别名同声明、嵌套不自锁、释放后可再持有）注册进 `npm test`/CI。Ubuntu **17/17**、Win10 **17 项 0 失败/4 跳过**、本机根回归 **1821 项：1763 通过、0 失败、58 跳过**。组授权、跨用户声明目录、Windows 目录声明与托管所有权工具化仍开放。0 真实模型推理，未提交/推送/发布。

## 2026-10-30：E70 CLI native-peer 监督器硬化

[E70](evidence/20261030_cli_peer_hardening.json) 收口 [KIMI 交接](HANDOFF-20261030-KIMI.md) §6.2 四项遗留（[设计](plan/20261030_cli_peer_hardening.md)），E61 原子 Job 准入、watchdog、framing 与身份校验不动：stdin 中继改为**有界队列 + 专用排水线程**——真实不读取子进程触发 `input-stalled` 停止帧、Job 树 137 终止且 `treeStopped` 证据保留，管道破裂仅结束排水、优雅 `exited` 帧不丢（否决了同步句柄上 `WriteLineAsync().Wait()` 的伪异步方案）；`OwnStream` 先转移句柄所有权再构造 `FileStream` 消除双关闭窗口；`CreateProcess` 携带 `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`（**0x00020002**——错误常量 0x20001 在两台真机以 ERROR_NOT_SUPPORTED 复现并修正）限定子进程只继承管道端 + 私有可继承 stderr 副本；helper 死亡矩阵补 `preCreate` 对称三阶段，legacy gate JSON 不可解析时按原始字节恢复 PID/FILETIME 精确回收。

真实夹具：Win11/W10 各 **16/16**（含 160×60KB 灌入不读取 worker、中继写竞态快速退出两例新生产用例），Ubuntu 16 显式跳过，本机根回归 **1817 项：1763 通过、0 失败、54 跳过**。仍是 Job 进程收容而非账户/AppContainer/文件系统边界，恶意同用户进程不在范围；CLI 真实推理、完整远程位置与完整写 facade 保持开放。0 真实模型推理，未提交/推送/发布。

## 2026-10-30：E69 Linux fs_write 描述符固定发布接入

[E69](evidence/20261030_pinned_write_agent_wiring.json) 按[接线设计](plan/20261030_pinned_write_agent.md)把 E67 复核后的 pinned 组件接入 Linux `fs_write`（[CODEX 交接](HANDOFF-20261030-CODEX.md) P0#2 主体）：参数校验、目标解析与在途互斥不变后按平台分流——Linux 经 `pinnedCreateNewFile` 发布，其他平台逐字节保留原 rename 路径。契约保持：现有目标 + `expectedHash:null` → `TARGET_EXISTS` 映射公共 `FILE_CHANGED`；匹配哈希的覆写请求 → `OVERWRITE_UNSUPPORTED` 501 不回退旧路径；哈希失配与目标缺失保持 `FILE_CHANGED`、`FILE_TOO_LARGE` 保留。准入 `WorkspacePin` 的真实根即 pinned 根，`pinnedWritePolicy` 在组件每个相位复查授权、保护路径与根身份；发布后策略拒绝 → `PINNED_WRITE_UNVERIFIED` → Agent `unknown` 保留锁、无停止证明；发布前取消 `possiblyApplied:false`、发布后取消保守 true + 形状校验 digest，全部走既有 E66 汇总与停止收据机制。

新增 Linux-only Agent 专项 6 项（精确字节/0600/单链接、现有目标与覆写拒绝、驻留期父目录替换 fail-closed、外部创建者获胜、发布后策略失败 unknown+对账释放、发布后取消含 digest），组件套件与新 Agent 套件均注册进 `npm test`/CI；既有"最终发布前取消"屏障按发布路径重锚而不放宽任何 E66 断言。三平台：Ubuntu 专项联合 **71/71**（首跑 4 个真实失败：CAS 契约、夹具作用域与笔误——逐项修复重跑，未静默）；Win10 **71 项 0 失败/32 显式跳过**（首跑因 fixture 缺 `pinned-write.ts` 构建失败——补传重跑）；本机根回归 **1814 项：1760 通过、0 失败、54 跳过**。覆写、外部写者 CAS、mount/安全标签约束、Windows 描述符语义、权限与跨 dataDir 协调仍开放。0 真实模型推理，未提交/推送/发布。

## 2026-10-30：E68 持久工作区 roots-generation 绑定与失效

[E68](evidence/20261030_workspace_roots_generation.json) 落地 [CODEX 交接](HANDOFF-20261030-CODEX.md) P0#3 的世代部分（[设计](plan/20261030_workspace_roots_generation.md)）：`rootsGeneration` 对排序后的 rootId→路径映射做确定性摘要并持久化到 Store meta；同配置重启不设任何栅栏，配置在两次运行之间变化时按 legacy 栅栏同一活性谓词把未结算 admission 全部栅栏化，新变更操作对任意根返回 `WORKSPACE_RECOVERY_REQUIRED`，纯读取不受影响，审计行记录变化；被栅操作按既有停止证据路径结算后栅栏自然失效、不自动回滚。admission 新增 `roots_generation` 列仅作审计，重放仍以物理身份冲突检查为准；`machine_ping` 暴露摘要作为 Host 预览失效钩子（当前 Host 忽略未知字段，行为不变）。

新增 `tests/workspace-generation.native.mjs` 5 项并注册进 `npm test`/CI。三平台验证：本机根回归 **1781 项：1759 通过、0 失败、22 跳过**；Ubuntu 与 Win10 fixture 各覆盖 5 个变更源文件（SHA-256 逐项校验、不跑 prepare）后专项联合 **38/38，0 失败、0 跳过**。跨 dataDir 协调、容器 UID65532 真实所有权、外部写者 CAS、pinned-write Agent 接线和 Host 侧摘要呈现仍开放。0 真实模型推理，未提交/推送/发布。

## 2026-10-30：E67 pinned-write 交接后编辑的真机复核

[E67](evidence/20261030_pinned_write_recheck.json) 复核 [KIMI 交接](HANDOFF-20261030-KIMI.md) §7.1 的 pinned-write 草稿三个真实失败（nlink 早观测 ×1、symlink ENOTDIR 分类 ×2）。交接后发现工作树在 E64 Ubuntu 验证与 E66 交接之后又被编辑过且未复验：`pinned-write.ts`（四个发布前取消点补 `possiblyApplied:false`、link 后首观测改走 published guard）与 `agent.ts`（`WorkspacePin` 流入 `write`、`published:true` 归入 unknown、`pinnedCreateNewFile` 仅 import 未调用）。逐点核对均在 `link()` 之前、旧写路径无 `published` 错误，分类不变。

按既有纪律在 Ubuntu fixture（复用依赖、不跑 prepare、仅覆盖 5 个源文件并逐项 SHA-256 校验）复跑专项：**27/27，0 失败、0 跳过，exit 0**，日志 SHA-256 三方一致；三个历史失败用例全绿。本机 Windows 守卫 1 通过/26 显式跳过；E66 联合 67/67 与完整根回归 **1776 项：1754 通过、0 失败、22 跳过** 证明半接线 plumbing 行为中性。组件仍未接入 Agent `fs_write`，接线检查点（[plan](plan/20261030_pinned_write_agent.md)）保持独立门控，套件尚未注册进根/CI；外部写者 CAS、已有文件覆盖禁用、权限/世代和 Windows 描述符语义边界不变。0 真实模型推理，未提交/推送/发布。

## 2026-10-30：E66 发布前取消的无目标效果证明

**当前详细交接以 [HANDOFF-20261030-KIMI.md](HANDOFF-20261030-KIMI.md) 为准。**

[E66](evidence/20261030_write_cancel_effects.json) 将 `fs_write` 的三个发布前取消点显式归类为 `possiblyApplied:false`，仅在原写入和清理结束、独立停止收据绑定完整后才向 Host 投影。普通失败、未知结果和真实 rename 后的取消仍保守为 true，内容/digest 不回滚；裸 false 没有独立证明时仍是 unknown。进入写入前、最终发布前读取和真实发布后三个确定性屏障均覆盖，原 E64 断言未放宽。

Win11、Win10、Ubuntu 的 workspace8 + stop-proof59 联合专项各 **67/67，0 失败、0 跳过**；远程复用 E64 fixture 并只覆盖三个源文件。本机完整根回归 **1776 项：1754 通过、0 失败、22 跳过**，E64 的唯一 workspace 失败已按根因修复。远程结果不是全仓或干净安装验收。停止不等于回滚，false 只表示本 Agent 未执行目标发布，不解决外部写者 CAS、parent/leaf 固定或完整文件隔离。

整体仍为 **0/20 整包、1/63 场景 passed、M0 11/12**。冻结 vendor/SDK 和真实 profile 未改，0 新真实模型推理，未提交/推送/发布；后续继续路径固定、权限/世代、完整 facade、迁移和实机门禁。

## 2026-10-30：E65 stop-proof 自动回归注册

[E65](evidence/20261030_stop_proof_regression.json) 将既有 11 项 `task-retry-stop-evidence` 纳入 `npm test` 和 Windows/Ubuntu CI，并移除重复的 CLI native-peer CI 步骤。六套 E64 专项保持 **59/59**，CI/闭包检查 6/6。注册后的首次根运行为 1774 项、1749 通过、3 失败、22 跳过：一项是随后由 E66 修复的 workspace 效果分类，另两项是高负载下 15 秒 CLI 控制帧等待超时。仅把 fixture 等待上限调整为 45 秒后，CLI 专项 13/13；没有修改产品断言或借注册销项。

## 2026-10-30：E64 绑定原操作的停止证明与重试门控

[E64](evidence/20261030_bound_stop_proof.json) 完成**组件范围**核验：Host 不再信任裸 `notStarted` / `notDispatched` 或未绑定停止标签；持久派发 fence 封住迟到回调，CLI 原资金收据与独立 Agent 写入停止收据绑定 task、attempt、operation 和执行引用。缺证据的旧终态及已排队旧重试保持待核对，投影不能把原始布尔值提升为可信停止，UI 只按 Host 确认开放重试。停止不等于回滚，失败写入仍保守保留 `possiblyApplied: true`。

Win11、Win10、Ubuntu 六个完整专项各 **59/59，0 失败、0 跳过**；两远程机复用已验证的 E63 隔离目录，运行前逐项核对 **52 个源文件**。最终九文件快照与全部 **53 个 sourceGitBlobs**（含生成客户端）逐项登记；客户端已重建为 2063296 字节并通过检查，journal 正确探针 29/29。第一次远程包漏带动态引用的面板，两机各 2 项 UI 失败；Win10 旧转发器编码失败、此前本机失败和错误 journal 入口都保留，没有把它们改写为通过。

**本机全量仍未通过**：`npm test` 1763 项中 1740 通过、1 失败、22 跳过；唯一失败是既有 `workspace-agent.native.mjs` 对取消前无效果收据的断言，期望 `possiblyApplied: false` 而实现保守返回 true。E64 未修改该测试或降低语义，后续需单独限定范围修复。新增 stop-proof 专项尚未进入根测试入口，需另项补齐自动回归。远程未复跑整仓，组件结果不代表实际模型、OS 隔离、完整产品或发布验收。

状态保持 **0/20 整包、1/63 场景 passed、M0 11/12**，W08.5/W11.2 与相关场景保持 partial/in_progress。冻结源、SDK 和真实 profile 未改，0 新真实推理，未暂存、提交、推送或发布。

## 2026-10-30：E63 产品面板刷新顺序与失联保护

产品面板按请求顺序保留最新快照，旧请求、卸载组件或已替换 API 的异步结果不能覆盖新宿主状态。读取失败或动作响应丢失时保留旧视图并禁用操作；动作前已在途的旧读取不能解除禁用，后续读取成功才能恢复，不自动重发动作。宿主仍负责实际授权和重试安全。

[E63](evidence/20261030_product_refresh_order.json)：真实 React 面板在合成 API/JSDOM 中的 7 项专项在 Win11、Win10、Ubuntu 各通过；本机已有 UI 8 项及客户端构建 1 项通过。单一客户端 bundle 已重新生成（2063017 字节）并通过 `npm run check:client`；新专项通过独立 npm 入口及安装隔离 fixture 依赖的 CI 作业执行。远程机器逐项核对 3 个测试源文件，未复跑整仓或真实桌面。

UI 保护不代表后端安全。后续审查已发现 CLI 停止未确认但旧版本可能记录 failed 并允许重试，Host 账本与原收据修复正在进行；远程目录固定首测失败也仍在修复。T53 保持 partial，整包和真实生产验收均未完成。

## 2026-10-30：E62 远程取消停止证据

Agent 取消响应不再仅凭终态宣称外部进程已停止：shell、桌面、浏览器、worktree 等必须有原操作收据中的严格布尔停止或未启动证据；缺失、伪真值或非终态返回未确认。成功的进程内文件写入仅在其跟踪任务和控制器退出后沿用确认；无证据的失败保守处理。原收据和工作区锁不会因这个响应被改写或释放，旧原生命令等无停止凭据的终态会显示未确认。

[E62](evidence/20261030_operation_cancel_evidence.json)：新增原生 5 项在 Win11、Win10 和 Ubuntu 各通过，远程验证 18 个同源文件的 SHA-256；本机取消/远程写联合 19/19，根回归 1759 项中 1737 通过、22 跳过、0 失败。新测试已加入项目测试与 CI。本次根测试入口同时包含 CLI Job 专项，耗时与并发敏感性继续关注；此前 E61 的超时记录保留。

范围仍是 Agent 收据组件，不能据此宣称完整命令 Task 或 OS 隔离完成。远程命令容器专用协议、迁移回退诊断及 Linux 文件创建草稿正在分别研发；草稿 Linux 首测 3 失败仍在修复。无真实产品模型请求，用户 profile 未写入，整包与产品验收状态不变。

远程命令 Task 的版本化协议、防原生降级、原操作收据和产品开放门槛已整理为[实施设计](plan/20261030_remote_command_task_facade.md)；设计不代表这些功能已接线或验收。

多 Host 迁移还需持续准入与排他、旧入口的 OS/存储隔离和跨机 fencing；[停写设计](plan/20261030_migration_stop_fence.md)记录了冻结 DS 的锁失败仍可写、现有启动 gate 的检查间隙，以及激活后必须保留最新数据的回退条件。目前这些仅为设计，完整激活仍关闭。

## 2026-10-30：远程文件创建草稿 Linux 首测

StepCode 已交付独立的 Linux 目录描述符固定新文件创建草稿；**尚未接入产品，尚未通过平台验证**。隔离 Ubuntu 24.04 / Node 22.22.1 对五个源文件逐项核对 SHA-256 后首测 27 项，24 通过、3 失败：结果中的硬链接计数与最终状态不符，两个符号链接拒绝用例收到的 Linux 错误码不同于断言。已安排修复；不得把此次结果记为通过。该草稿只做不覆盖的新文件创建，不解决已有文件的外部写者 CAS，目录移动和保护路径仍有不可由 fd 单独消除的竞态。

台账状态不变：20 个整包中 13 个进行中、7 个 planned；63 个场景为 1 passed、52 partial、10 not_run。已记录子步骤中 46 completed、9 in_progress、1 planned；这些计数不等于工时百分比。其他产品入口、迁移、实机验收和正式发布仍待完成。

## 2026-10-30：恢复施工，CLI Windows 原生 Job 与发布闭包

用户要求继续由 GPT 统筹，上次交接停工状态已结束。交接后新增的未提交 CLI 修改经独立审查并继续补齐；[E61 证据](evidence/20261030_cli_native_peer_job.json)记录 Job 原子纳入、实际创建者死亡、UTF-8、能力探测失败与回收。Win11/Win10 同源专项各 13/13；本机包含既有桥接的 `npm run test:cli-native` 16/16。实际安装 Codex 0.163.0 的无推理协议 13/13 再次通过，两个 HTTP 尝试均由本地测试端点拒绝。

修复 npm 清单遗漏 Windows/Linux 原生辅助脚本，并为子进程资源增加闭包负例检查；测试包解包后 Windows 探测成功，此次跳过打包生命周期脚本，不能作为正式发布验收。首次将新死亡竞态测试与全量套件并发运行时有两项等待超时；测试独立放入 Windows CI 和 `test:cli-native` 后，Win11 全量复跑 1744 项、1722 通过、22 跳过、0 失败。首次远程结果转发因本机 GBK 输出失败，改 UTF-8 后重跑成功；两次失败均保留在 E61。

W11.2 仍 in_progress、T33 仍 partial；0/20 整包、M0 11/12 不变。CLI Job 属于进程回收，不是 Windows 账户或文件系统隔离；测试时的环境探测不能保证后续所有目标可启动。Linux 目录描述符固定组件正由 StepCode 开发，尚未验收或接入；外部写者 CAS、完整迁移/安装/产品验收与发布仍待完成。未对真实用户 profile 写入，产品模型请求 0。

## 2026-10-30：E58–E60 阶段收束与正式交接

**当前状态以 [HANDOFF-20261030-CODEX.md](HANDOFF-20261030-CODEX.md) 为准**；给接手人的短提示词为 [HANDOFF-PROMPT-20261030.md](HANDOFF-PROMPT-20261030.md)。下方旧数字/旧任务是历史，不能覆盖当前交接。

新增 [E58](evidence/20261030_workspace_admission_mount.json)、[E59](evidence/20261030_windows_job_creation.json)、[E60](evidence/20261030_installed_cli_protocol.json)：实际根准入/未知锁/独立读写与 Linux 已验证挂载、Agent Windows Job 原子创建/真实父进程死亡/UTF-8、官方 Codex0.163.0 真实 MCP 无推理正常回收。W10.2/W15.3/W11.3 组件完成；W08.5 历史 planned 校正为 in_progress，W11.2 广义“真实入口/模型/位置”收回 in_progress，实际未验范围保留。

**962 源逐一一致、冻结297不变；三机根1743/0失败**（Windows1721通过/22跳过，Ubuntu1690通过/53跳过）。workspace31（Windows30通过/1Linux-only跳过），Windows Job11两Windows通过/Linux明确跳过，真实Linux容器29含7次Agent死亡，真实安装CLI13每机通过。原Agent12/ownership9/remoteWrite14/迁移175/默认Host40/语义8/gate7/资金33/client2061889及本机固定pnpm10.34.6 frozen/strict通过。产品0真实推理；CLI启动HTTP两次由本地403 sink明确拒绝，未冒充真实模型/账单验收。

仍 **0/20整包，1passed/52partial/10not_run，M0 11/12**。CLI native-peer.ps1 的独立旧Job创建窗口、file leaf/parent固定、工作区权限/世代、完整Task命令/浏览器/桌面facade、真实推理与账单、完整迁移/激活后回退、生产休眠、DPI/Session/安装/性能/发布继续交由下一位。E53旧咨询超时未解释。desktop/手动MR移除/web延期保持，未动真实profile，未提交发布。

用户最新AGENTS授权StepCode/Step Plan研发，覆盖历史GPT-only。5次工具代理启动3次完成、2次执行器命令审批解析失败；CLI一次固定命令重试成功。没有把执行器故障说成额度耗尽；开发调用与产品0推理分列。源码阶段已结束，按用户要求交接后停止继续施工；没有后台编码代理继续改源。


## 2026-10-29：Agent内核生命周期互斥与委派方式更新

[E57](evidence/20261029_agent_controller_ownership.json)：旧PID方案在三机各复现1个预期失败：两个失效PID读者能同时取得控制权。改为独立私有SQLite连接终生持有BEGIN IMMEDIATE，与业务库分离；第二控制器在清票据/改operation前即被内核锁拒绝。真实SIGKILL后可接管，仅删除同inode的PID文件，保留外来替换，启动异常释放全部所有权，admin连接不夺锁。W09.7组件完成。

945源一致含冻结297，新增原生 **9/9** 每机通过，含6并发启动；三机根 **1696/0失败**（Windows1680通过/16跳过、Ubuntu1659通过/37跳过），迁移175、实际Linux容器24/7次Agent死亡、原Agent12/远程写14/默认Host40/语义8/gate7/资金33/client与固定pnpm10.34.6 frozen/strict均通过。使用E56新签且未过期的合成TLS，校验保持。

**最新用户AGENTS取代旧GPT-only偏好**：GPT拆分调度，优先Step Plan且不设人为预算上限，其次GLM；Kimi先opencodego Go，确认限额才转Kimi Plan，实际通道须汇报。直连API只算文字，真实工具任务走agent_run.py并限定路径。该设计审阅Step Plan3次为空正文/length、GLM1次读取超时，没有假称返回或执行。产品验证仍0真实推理；开发模型调用与产品收据单列。下一具体模块以StepCode工具代理委派，源码/合成测试权限明确，parent通常依据报告整合，必要时作集成核验。

实际根别名/父子互斥、描述符/挂载固定、权限和所有Git/native入口、完整command Task facade继续；旧版本不认识新内核信号量，混版本安装仍需停写维护协议。个人desktop/手动卸载/web延期不变，完整迁移/安装/其余主方案仍未完成，**0/20包、1passed/52partial/10not_run、M0 11/12**。未提交发布，完成后GitHub/npm授权持续有效；E53旧超时未解释。


## 2026-10-29：Linux远程命令容器与独立截止监督器

[E56](evidence/20261029_remote_container_commands.json)：显式container-only配置接入Agent原operation协议，禁止回落native。固定摘要镜像、不拉取；仅工作区和只读固定监督代码挂载，网络关闭、根只读、资源/日志/输出有界。可信PID1仅SETUID/SETGID，调用程序65532且有效cap为0、清空附加组与环境；独立绝对截止时间在Agent死亡后仍停止后代，程序不能SIGSTOP监督器。原容器身份/创建与启动意图/收据事务/观察核对、撤权与仅清理所属停止容器均验证。W10进入in_progress，W10.1组件完成。

Ubuntu真实容器 **24/24**，含 **7个真实Agent进程退出**；941源一致含冻结297，三机根 **1687/0失败**（Windows1671通过/16跳过，Ubuntu1650通过/37跳过；其中新增13为未启用/不支持容器的明确顶层跳过）。迁移175、Agent原12、远程写14、默认真实Host40、语义Host8、启动gate7、资金33、客户端及本机固定pnpm10.34.6 frozen/strict通过。Docker CAP_规范名、缺CAP_KILL的截止退出及直接构建器兼容问题已按真实失败修正并重验。

**Bot shell工具仍未开放**：工作区权限/所有权/锁与路径固定、防并发替换、全部Git/native入口、完整command Task facade及Windows OS隔离继续。仅同构建冷恢复，监督器跨世代升级需原controller/安装回退协议；尾日志始终标记可能裁剪。完整迁移/停写/元数据/激活后回退、安装与其他主方案范围仍在施工。个人desktop/手动卸载/web延期不变，0新真实模型、未提交发布；总体 **0/20包、1passed/52partial/10not_run、M0 11/12**，完成后发布授权有效。E53旧咨询超时仍未解释。


## 2026-10-29：保存记忆与能力/秘密引用审计

[E55](evidence/20261029_migration_supporting_domains.json)：新增27项（独立24+捕获集成3）。复用冻结纯解析器核对Bot/群/团队记忆、主题索引、Session快照、摘要、review游标、原日志/历史归档和空目录；pending/torn/未知文件明确需恢复或复核，不自动修理。原能力包展开、Bot附件、stdio审批与秘密引用/空范围保持，连接器仅观察保存配置/凭据是否存在，绝不冒充登录验收。W06.10组件完成，T47转partial。

934源逐一相同（含冻结297），三机迁移 **175/175**、根 **1670/0失败**（Windows1667通过/3跳过、Ubuntu1646通过/24跳过）。真实rc.3语义宿主 **8/8**：原生remember生成2条不同记忆/主题/2日志，原owner API保存附加能力，冷重启与捕获后审计身份/内容保持；默认宿主40、启动gate7、远程写14、资金33、客户端与本机固定pnpm10.34.6 frozen/strict通过。初始fixture两条相同文本被正确去重，已改成不同文本验证，没有放宽原实现。

本阶段未重新分析或改动真实desktop副本/原数据，E52私有概览仍只代表当时选定域；手动MR卸载保留、web延期。剩余完整存储/外部能力/OS元数据、真实路径/全Host停写/一致备份/资金位置/完整激活和激活后最新数据回退、执行隔离/安装与主方案全量验收继续；applySupported=false。E53首次咨询超时仍未解释。总体 **0/20包、1passed/52partial/10not_run、M0 11/12**，0新真实模型调用、未提交发布，完成后GitHub/npm授权持续有效。


## 2026-10-29：受控远程文件写入进入Task

[E54](evidence/20261029_remote_write_tasks.json)：真实Agent写入接入默认Bot工具/计划/Task/工作区锁，必须显式write/status/cancel授权、相对路径和旧SHA/null新建，UTF-8上限8192字节。原Task/attempt/operation先持久化，去重不重写；缺收据保留unknown与写锁，冷恢复/新只读status授权只核对原操作。取消树跳过未启动后继，已写文件的事实保留并在UI显示停止/可能效果/摘要，不把取消显示为回滚。W09.6组件完成。

新增原生 **14/14** 与UI **8/8**（新增2），相关原生联合 **122/122**。930源逐一核对含冻结297，三机根 **1643/0失败**（Windows1640通过/3跳过、Ubuntu1619通过/24跳过），迁移148、默认真实rc.3宿主 **40/40**、语义宿主7、启动gate7、资金33与客户端字节检查通过；本机固定pnpm10.34.6 frozen/strict通过。journal升5，资金marker仍4；文件IO没有伪造模型账单。E53首次咨询超时仍为历史未解释问题。

完整命令/浏览器/桌面Task facade、原生CLI写模式与OS隔离、完整迁移/停写/OS元数据/激活后回退、安装与其余全量验收继续；原MR可执行工具仍受守卫拒绝。真实desktop不动、手动卸载保留、web延期，0新真实模型调用、未提交发布。总体仍 **0/20包、1passed/51partial/11not_run、M0 11/12**，完成后GitHub/npm授权持续有效。


## 2026-10-29：可恢复配置阶段与启动维护门控

[E53](evidence/20261029_migration_configuration_commit.json)：新增12项，含每机24个真实进程退出位置；私有原字节/意图/身份/摘要日志、跨进程锁、无覆盖发布与激活前回退通过。并发用户内容保留，未知inode/第三种内容/破坏日志/链接/活锁明确拒绝。新产品公开apply在资金/Task/Bot写入前检查维护gate，支持DSH_HOME正规junction别名；真实rc.3宿主 **7/7** 验证pending拒启动、旧Loader禁用入口、原配置回退及Main/Session身份冷恢复。安装阶段停在validating，activationSupported=false，不以布尔值冒充完整激活。W06.9组件完成。

926源字节逐一核对（冻结297不变），三机迁移 **148/148**、根 **1627/0失败**：Windows各1624通过/3跳过，Ubuntu1603通过/24跳过；默认宿主36、语义宿主7、资金33、客户端和本机固定pnpm10.34.6 frozen/strict均通过。**首次本机MR咨询超时保留为未解释稳定性线索**，原样新fixture重跑36通过，两远程36也通过；没有声称已修复其原因。

未操作真实desktop配置/数据、未停用户应用/安装，旧MR手动卸载和web延期保持。剩余完整域/OS元数据、所有旧Host/共享launcher真实停写、一致备份/程序/资金/位置/完整激活与激活后最新数据回退、安装/执行/全量产品验收继续。仅启动gate进入runtime文件闭包，事务组件仍为开发owner工具。0新真实模型请求、未提交/发布。整体仍 **0/20包、1passed/50partial/12not_run、M0 11/12**。三GPT子代理额度不足后由主GPT接管；完成后GitHub/npm授权持续有效。


## 2026-10-29：工作区注册表与保存引用核对

[E52](evidence/20261029_migration_workspace_audit.json)：新增10项纯SDK工作区检查与1项捕获集成检查，三机迁移 **136/136**，真实隔离rc.3宿主各 **7/7**。复用现有固定workspaceDomainSpec/version2，保留ID/顺序/标题/时间/路径/Session归属和归档置顶顺序、已删除默认ID；检查重复/丢引用/冲突，pending和bootstrap需恢复证据，未知字段/表仍原样保留。仅对已保存cwd字符串核对，不查原文件系统或猜测别名。W06.8组件完成。

919源文件逐一相同（含冻结297），完整根 **1615/0失败**：两Windows各1612通过/3跳过，Ubuntu1591通过/24跳过；客户端及本机固定pnpm10.34.6 frozen/strict通过，本阶段未改依赖。E51截断帧修复和历史证据保持原样。

实际desktop**既有私有副本**的选定Session/附件/资金/工作区审计已通过、无额外问题代码，并再次核对捕获；原数据目录没有被本次分析访问/写入，未停应用/安装/切配置，旧MR手动移除保留，web延期。只读本机被忽略的 tmp/integration/auth-20261028/desktop-domain-audit.json 可定位安全概览，完整plan/audit禁止读入模型或公开上传。

这不等于完整迁移：requiresCompleteDomainReview=true、requiresStopProof=true、applySupported=false。其余memory/连接器/存储域闭包、真实路径/OS元数据、数据库一致性与跨域停写、可恢复应用/位置/回退和产品安装验收仍未完成；旧rollback守卫保持。总体仍 **0/20包、1passed/50partial/12not_run、M0 11/12**，无新真实推理/提交/发布。完成后GitHub/npm发布授权持续有效。


## 2026-10-29：私有副本引用与资金语义审计

[E51](evidence/20261029_migration_domain_audit.json)：新增48项（Session15/资金18/数据域15），三机迁移 **125/125**、真实隔离rc.3宿主各 **6/6** 通过。纯固定SDK catalog在限额Worker内校验历代Session、帧边界/尾行/次序/地址/历史子证据、Bot/Main/Agent/part与附件引用、秘密scope；未知扩展保持原数据。原资金投影保留零/未配置全局预算、unknown/未分配归属、预占/尝试/90日展示外原始日历、完整SQL任务资金表和独立DS usage。旧JSON旁未激活SQL不自动接管。

首次远程复跑发现旧Node接受截断后续Zstd帧（两机各1失败），已保留失败记录，并按RFC8878补独立完整帧边界和窗口/内容限额；最终915源文件逐一相同（含冻结297）。完整根 **1604/0失败**：两Windows各1601通过/3跳过，Ubuntu1580通过/24跳过；三机客户端、本机固定pnpm10.34.6 frozen/strict通过。精确catalog仅新增开发依赖，未改SDK/冻结源。W06.7组件步骤完成。

用户选定desktop的**既有私有副本**已审计与再次核对，尚有WORKSPACE_REGISTRY_REQUIRED；不访问原目录、不写原数据、不停应用、不安装/切配置，保持手动移除旧MR，web延期。仅从被忽略元信息 tmp/integration/auth-20261028/desktop-domain-audit.json 定位安全OVERVIEW；完整私有审计/plan不可读入模型或公开归档/上传。文件缺失的usage不证明历史调用/花费为0。

当前仅审计组件：requiresCompleteDomainReview=true、requiresStopProof=true、applySupported=false。下一项工作区注册表与其余域闭包，再做一致备份/跨域停写、可恢复应用/位置与回退；原ACL/ADS/ownership/xattrs等仍待实施，旧rollback守卫未放宽。总体仍 **0/20包、1passed/50partial/12not_run、M0 11/12**；无新真实推理/提交/发布，完成后GitHub/npm授权持续有效。


## 2026-10-29：选定数据私有捕获与desktop副本

[E50](evidence/20261029_migration_data_archive.json)：新增12项文件捕获/核对检查三机通过，迁移相关 **77/77**。逐文件保留选定目录主数据流、空目录与完整配置规划，复制前/中/后校验源，落盘读回、相对结构内容对账；目标重叠/链接/硬链接/漂移/取消/篡改显式拒绝。只读验证不再访问原始路径，因此之后源合法变化或路径失效不影响已保存副本。Windows递归owner-only ACL和Unix私有权限实测通过。

已刷新用户选定的 **desktop** 私有预览并完成选定数据捕获、再次核对；保留手动卸载旧MR的状态，没有安装、停应用、切配置或写源数据。web延期。真实路径、数据内容/计数/摘要、配置值和私有副本全部留在本机受限目录；接手只读取本机被忽略的元信息文件 tmp/integration/auth-20261028/desktop-data-capture.json 定位安全概览，不能把完整私有plan或数据读入模型/公开证据/远程机。

905源文件（含冻结297）三机字节一致；完整根 **1556/0失败**：两Windows各1553通过/3跳过，Ubuntu1532通过/24跳过；三机客户端及本机固定pnpm10.34.6 frozen/strict通过。W06.6组件步骤完成。

这仍是选定主数据流捕获：crossDomainConsistent=false、databaseConsistent=false、requiresStopProof=true、applySupported=false、permissionsRestored=false。原始SQLite/WAL副本不能代替一致在线备份；全部引用/资金/usage语义、其他域覆盖、原ACL/NTFS附加流/ownership/xattrs、跨域停写、可恢复应用/恢复/位置与回退继续施工，未改旧rollback守卫。整体仍 **0/20包、1passed/50partial/12not_run、M0 11/12**，未推理/提交/发布。完成后的GitHub/npm授权持续有效。


## 2026-10-29：单账本一致备份与完整私有导出

[E49](evidence/20261029_migration_ledger_archive.json)：新增14项实际SQLite备份/导出检查在三机全通过，连同E48迁移检查为 **65/65**。完整保留Task/plan/依赖/attempt/operation/outbox、去重/引用/核对/事件/锁、原始收据、holds和资金历史；不通过UI裁剪投影导出。WAL已提交数据进入独立备份，其他连接未提交数据不混入。整数/二进制/rowid/扩展表与SQL结构保真；取消、未来版本、限额、外键错误和篡改显式拒绝。完成清单只在文件校验和重新导出对照后写入，Windows/Unix私有权限已实测。

901源文件（含冻结297）三机字节一致；完整根 **1544/0失败**：两Windows各1541通过/3跳过，Ubuntu1520通过/24跳过。三机客户端、本机固定pnpm10.34.6 frozen/strict及冻结源检查通过。全部使用隔离合成数据，没有对真实desktop数据做备份/修改，没有新真实推理或发布。

W06.5组件步骤完成，完整迁移继续进行。该组件仅保证**单个数据库一致性**，crossDomainConsistent=false、requiresStopProof=true、applySupported=false；尚未接入公开安装器/CLI备份入口。完整跨域私有备份、Bot/Session/秘密/usage/资金语义对账、停写gate、可恢复应用/位置移动与回退仍待实施；旧blocked/skipped回退守卫没有放宽。数据库内原绝对路径与epoch保留，不能把这份备份直接当新位置的已激活权威。

整体仍 **0/20包、1passed/50partial/12not_run、M0 11/12**。用户选定desktop及手动卸载MR状态继续保留；web延期。下一步按迁移设计§10.3完成其余数据域备份/引用与资金对账，再做阶段提交与崩溃恢复。E45–E48是各自历史时点证据，不改写其数字；完成后GitHub/npm发布已有授权。


## 2026-10-29：desktop只读预览与三机迁移工具验证

[E48](evidence/20261029_profile_migration_preview.json)：配置规划29、选定数据清点14、私有CLI8，共 **51/51** 在Win11、Win10、Ubuntu全部通过。真实SDK组合保留原配置/路径/搜索与未改动表达式；显式区分既有产品迁移和空入口新装，卸载残留MR设置会提示复核。私有输出先收紧ACL，公开输出只有摘要。

用户本轮选定 **desktop**，明确旧MR是手动移除；已保留该卸载，完成私有新装只读预览，未安装、切换配置、写真实数据或停止现有程序。web延期，未预览。私有报告不进入Git/npm/公开证据/远程测试机。

三机当前 **896源文件字节核对**（含冻结297），完整根 **1530/0失败**：两Windows各1527通过/3跳过，Ubuntu1506通过/24跳过；三机客户端检查通过。系统Corepack缓存不可读，改用任务私有缓存的固定pnpm10.34.6后frozen/strict通过，没有依赖变更。E45–E47运行时/GUI/资金与宿主证据保留原检查点，未重复声称本轮重跑。

W03.5与W06.4组件步骤完成，W03.4/W06.3继续in_progress；整体仍 **0/20包、1passed/50partial/12not_run、M0 11/12**。下一步完整私有备份/新任务导出与对账，再做停写gate、可恢复应用、位置/回退与绑定预算兼容。当前preview-ready仅代表预览结束，applySupported=false；开发CLI尚未接入发布安装器。新验证0真实模型请求，未提交/发布，完成后GitHub/npm授权有效。


## 2026-10-28：helper全局仲裁、私有路径与配置兼容

[E45](evidence/20261028_desktop_arbitration_stop.json)：协议2、原生全局租约/取消墓碑、独立控制通道与Agent取消/撤权/close已实现。Win10当前100%与Win11当前150%各 **19项真实专用窗口检查通过**，含按钮/键/滚轮、两个Agent、在途部分输入取消和撤权、兄弟继续及15.1秒截图过期。停止均获确认，排空UI后未见迟到输入；截图已看，进程和临时任务清理通过。缺收据仍unknown，不重放输入。

[E46](evidence/20261028_remote_private_paths.json)：授权根中的Agent数据与桌面密钥被文件/列表/写入/Git树API保护，覆盖未来文件、真实路径、硬链接和扫描限额；三机各8项通过。这是API边界，同账户shell/OS隔离仍未完成。

[E47](evidence/20261028_runtime_config_search.json)：botRuntime配置与统一auto搜索入口接线，14项专属检查、三机真实rc.3宿主各6项与历史组合10项通过；保留custom home、Main/Session、禁用项及搜索覆写。旧bundle和数据完整迁移/回退仍待实施，正在继续只读预览层。

完整根 **1479项/0失败**：两Windows各1476通过/3跳过，Ubuntu1455通过/24跳过；远程原生63（Linux62通过/1平台跳过）、原Agent12、资金33、默认宿主各36和客户端检查通过。矩阵884源字节相同，随后仅测试窗口隐藏闪烁光标，双Windows19项重验；生产运行时没有改变。strict依赖和冻结297文件通过。

0/20包完成，场景仍1passed/50partial/12not_run，M0仍11/12。125%多屏、状态/托盘实测、完整授权facade、迁移与隔离、安装发布等仍保留。新验证0真实模型请求；未提交/推送/发布，完成后发布授权持续有效。


## 2026-10-28：两台 Windows 真实桌面基础验收

[E44](evidence/20261028_dual_windows_desktop.json)：按用户提供的解锁交互桌面条件，Win10 LTSC build19044/Session1/96DPI（100%）和 Win11/Session2/144DPI（150%）各 **8 项真实检查通过**：限定测试窗口截图、named-pipe Token/ACL、点击、中文输入、跨 Bot 互斥、已消费截图和错误 Session 拒绝。两张截图已亲眼核对，仅含测试窗口；fixture/helper已退出，Win10的临时计划任务已删除。

W16进入in_progress，当前100%/150%基础子步骤完成；T29由not_run转partial。当前63场景 **1passed/50partial/12not_run**，0/20包完成，M0仍11/12。根最近E43三机1446均0失败；本轮只补真实GUI探针，未改运行时代码。

125%、跨屏/分辨率/DPI切换、锁屏/UAC/RDP、暂停/撤销/跨Agent互斥与完整桌面授权facade/安装仍未完成。GDI窗口后端已验证，未声称WindowsGraphicsCapture或其他应用渲染通过。接下来先补helper全局桌面仲裁和有效输入效果/停止验证，同时保留完整配置迁移与所有主方案未完范围。无新真实推理、提交或发布。


## 2026-10-28：凭据轮换与慢请求竞态已关闭

[E43](evidence/20261028_auth_rotation_body_race.json)：请求体读取后及执行管理动作前重新鉴权，Store 拒绝旧 revision 的缓存 client 行，MCP tools/list 核对实时 grant；旧慢请求不能撤销新票据。另补系统时间回退时的有限冷却。对前一实现负向复现 **4 个预期失败**，修复后鉴权 **10/10**。

最终三机当前源 **865 文件**逐一核对，远程原生 **44/44**、根 **1446/0失败**（Windows各1443通过/3跳过，Ubuntu1423通过/23跳过）、资金33、默认真实rc.3宿主各36与客户端字节检查通过；本机原Agent12通过。本阶段0真实模型请求，尚未提交/推送/发布，整体0包complete，场景仍1passed/49partial/13not_run。

**新用户条件**：用户已明确 Win10 和 Win11 都可提供登录、解锁的交互桌面和专门可见测试窗口。后续可做两机真实helper验收，不再重复问可用性；只操作测试窗口。此为可用性确认，不是已经通过桌面验收。完整迁移/回退、写执行隔离/混合树、安装升级与其他全量范围继续保留。下一步先利用可用桌面跑现有真实helper探针，再推进 W03.4/W06 完整迁移。


## 2026-10-28：当前源码三机复跑与客户端字节一致

[E42](evidence/20261028_atomic_auth_three_platforms.json)：两台远程机逐文件核对 **864 个源文件**（含冻结 DS 297 文件）。Win11 Node24.20.0、Win10 Node24.18.0、Ubuntu Node22.22.1 的完整根套件均 **1443 项/0 失败**；两台 Windows 各 **1440 pass/3 skip**，Ubuntu **1420 pass/23 skip**。远程原子/调度/鉴权原生 **41/41**，资金 **33/33**，默认真实 rc.3 宿主各 **36/36**。

修复跨安装目录的真实构建差异：esbuild 曾把复用依赖的 realpath 写入注释，改为保留项目内链接路径，并加本地目录/外部链接目录实测对比。现在三机客户端字节一致（2061256 bytes）；所有新鉴权也拒绝“存在但为空”的 Origin。Windows 远程测试由 Node 直接写 UTF-8 TAP，保留先前失败记录。

仍是复用隔离依赖和离线模型/CLI factory，不是干净安装、实际 CLI 推理、生产网络/休眠或真实桌面验收。T59 保持 partial；当前场景 1 passed/49 partial/13 not_run，0/20 包完成，M0 11/12。所有改动未提交/推送/发布。下一项：W03.4/W06 完整配置与数据迁移设计和回退验证，然后继续全部剩余施工包。


## 2026-10-28：公网鉴权抗滥用本机验证完成

[E41](evidence/20261028_remote_auth_abuse.json) 已实现匿名来源/全局配额、真实 clientId/revision 请求限额、固定长度摘要比较、429/Retry-After 与限流审计抑制，补齐精确代理/Host/Origin 和真实 HTTPS/mTLS 验证。合法客户端在同一代理/来源遭匿名猜测时仍可用；本地轮换立即废止旧配对与票据。

最新根 **1442/1439 pass/0 fail/3 skip**，安全原生 **7/7**、原 agent **12/12**、Host 机器 **8/8**、默认真实宿主 **36/36**，严格固定依赖与客户端检查通过。T59 从 not_run 转 partial，当前63场景 **1 passed/49 partial/13 not_run**；整体验收/发布仍未完成。本轮0真实新推理，未提交/推送/发布。

接下来同步当前源码到已授权 Ubuntu/Win10 测试目录并复跑原子准入与鉴权。当前仅本机真实TCP/HTTPS；公网/VPN/Tunnel生产、负载、全量迁移/OS隔离/混合执行/真实桌面与推理验收均保留。限流状态为有界进程内记录，冷启动重置；不宣称分布式拒绝服务防护。


## 2026-10-28：Task/outbox 与资金原子准入已实现

共享资金连接、journal schema4、admitting 阶段与 Host-only 准入帧已接入默认 MR/CLI。Task/attempt/operation、执行引用、outbox 和原资金 run/hold 在一笔原生事务提交；CLI 准入收据同事务。提交前崩溃仅在无派发证明成立时恢复原 operation，提交后保留 needs-reconciliation，禁止自动重发。撤权、取消、期限、CAS 与预算竞争已有验证。

最新证据 [E40](evidence/20261028_atomic_task_admission.json)：根 **1435/1432 pass/0 fail/3 skip**，原子原生 **20/20**（6 个真实进程退出位置），journal/资金/核对 **85/85**，资金探针 **33/33**，默认真实 rc.3 宿主 **36/36**，strict managed/legacy-policy、固定依赖、客户端和冻结 DS 297 文件均通过。本阶段 0 真实模型请求；没有提交、推送或发布。W06 进入 in_progress，局部步骤完成；整体仍 0/20 包完成，63 场景仍 1 passed/48 partial/14 not_run，M0 11/12。

下一项继续 T59 公网鉴权/抗滥用，然后三机复跑、完整迁移/隔离/执行与实机矩阵。完整方案全部保留；不把数据库原子性当外部 exactly-once 或产品全部验收。下方旧的“原子准入待实施”与 schema3/1415/35 等描述是历史检查点，当前以本节和 E40 为准。


## 2026-10-28：完成后的 GitHub / npm 发布授权

用户明确要求“全部弄好了就上传 GitHub 和 npm”。此为完整工程完成后的发布授权：完成方案全部实现及必要验证后，直接执行对应 Git 提交、推送、发布与 npm 发包，并核对标签、CI、版本和最终产物字节；不再重复索要同一授权。此前交接中的“提交/推送/发布前另行询问”要求由本条取代。该授权不表示当前工程已完成，也不放宽冻结基线、真实推理、验收或稳定版门禁。当前仍有原子准入、T59 和实机/安装等未完范围，尚未提交或发布。

## 2026-10-28：依赖调度器、取消树与资源锁检查点

**同日最终补测**：拥有者冷启动/原 Agent 已解绑后的 canonical 命令重投改为只返回原操作，不重建目标目录、不重新派发；模型入口的真实 Session 绑定及新计划的伪造来源拒绝保留。新增 [冷重放最终证据](evidence/20261028_dependency_scheduler_cold_replay.json)（E39），保留前一 E38 证据不改写。当前最终数字为：根 **1415/1412 通过/0 失败/3 跳过**，调度原生 **14/14**，journal/调度/核对 **52/52**，身份/UI 联合 **36/36**，默认宿主 **35/35**。下方 1414/34 等是本日稍早检查点。20 个最新源 blob 再次逐个核对；资金 33、strict/客户端/冻结源码结论不变。

用户已授权接续 Step 交接，先完整复现 §8 十组基线，再实施 [调度器设计](plan/20261028_dependency_scheduler.md)。本节优先于下方历史暂停/未接线描述。

- journal 升到 schema 3，旧库同事务补表并保留原任务身份；资金连接同步兼容版本 3。计划、全部包/attempt/operation/outbox 与依赖边一次提交，重复 key 返回原身份，非法目标整笔回滚。
- ready 和 claim 同时验证前置均 succeeded；失败阻塞未派发下游，独立分支继续，父计划不误报全部成功。单包和原 MR 串行路径回归通过。
- 取消计划中止全部活动分支，未启动包 skipped；未知停止保留父计划 cancelling 和原 operation 核对。写锁按 Host machine/workspace 获取，cancelling/崩溃未知时保留；仅可信终态释放。写 facade 仍拒绝，未声称真实写工作区验收。
- 默认产品接入计划 start/status/cancel 工具、owner 提交/取消、持久计划投影及任务页。真实 Agent 为 Session 盖章；仅已提交 Main 的私聊可跨 Bot 派包，Worker 不可越权；已完成 Worker 包不能取消 Planner 随后运行的包。
- 最终验证：根 **1414 项，1411 通过、0 失败、3 跳过**；新调度器原生 **13/13**，journal/调度/核对联合 **51/51**，身份/界面针对性联合 **35/35**；默认真实 rc.3 宿主 **34/34**；资金 **33/33**；strict 固定依赖、客户端、冻结 DS 297 文件及 strict managed/legacy-policy 宿主均通过。本轮 0 真实模型请求。
- 新证据 [依赖调度器](evidence/20261028_dependency_scheduler.json) 记录 20 个逐个复核的 git hash-object、回归和限制；E38 同步行为审计。T09/T11 由 not_run 转 partial，T12 追加计划取消证据，全部施工包仍未 completed。按交接约定，T11 真实写退出未验，W08.5 保持 planned 并挂证据；W07.2 保持 in_progress。STATUS 用 report 命令生成。
- 下一项已先写 [Task/资金原子准入设计](plan/20261028_atomic_task_admission.md)：选择共享连接 + 明确 admitting 阶段 + Host-only 事务桥。**设计尚未实现**，当前两个连接的崩溃窗口仍在，不能写成原子准入已通过。T59、真实 CLI/远程/桌面/安装发布条件及其余施工包继续保留。

全部改动未提交、未推送、未发布；证据为本机隔离环境和离线模型 fixture，不替代生产部署、实际推理或跨平台新验收。

## 2026-10-27：用户要求暂停并转交

已停止施工；详见 [本轮完整交接](HANDOFF-20261027-GPT.md)，包含代码清单、验证时点、尚未测试的最后改动、复跑入口及剩余全部范围。代码全部保留在未提交工作树，未推送/发布。

后续新增了资金范围投影/准入、订阅次数持久统计、Bot 设置组件、MR 咨询原账单关联，以及 CLI 归档防重放；这些组件的本地测试结果及中途失败/修复都在交接报告中如实列明。最近根回归 1340 项、1337 通过、3 跳过，早于最后的 funding-accounts、deferred-router-state 和 committed Bot 快照接口改动，不能代表停工时全工作树通过。新资金阶段尚未登记公开 evidence/CI，默认产品仍是诊断资金路径，Task/资金页面接线未完成。没有新增产品 passed 场景或完成施工包；M0 仍 9/12。

更新日期：2026-10-27。当前阶段：**M0 基线与兼容**。研发分支：`feat/bot-integration`。

## 目标与已确认约束

按 [方案1.1](plan/20261026_master_plan.md) 完成 Main 私聊派活、两仓功能并集、按 Bot 绑定模型/官方工具、Linux 与 Windows 远程电脑，以及迁移、安装和发布。分期仅安排先后，不缩减最终范围。实际模型调用仅使用 GPT。

## 2026-10-27：CLI Task 执行组件、同账本收据与长任务租约

- 新增固定Codex只读backend及 `probe/prepare/start/observe/cancel/collect/reconcile`。任务参数仅含文本；入口摘要/版本、模型、工作区、计费、价格、角色和能力形成目标版本，排队后变更会拒绝旧任务。Task引用先持久保存，预占与`cli`来源收据由同一SQLite MR写入；`turn/start`前再次检查Task fence及授权。
- 取消等待会话清理和原生停止；无停止证据、配置模型不匹配或缺API账单保留unknown及原预占。订阅不伪造API美元金额，未知token不改0；缓存输入计数拆开，避免重复累计。订阅每日准入从持久来源表读取，资金运行归档后也不能重置额度。
- 已验证CLI收据已提交但Task完成写失败时，新runner按原attempt/operation核对恢复；不创建新请求、不重复写钱。旧工作包入口拒绝重放CLI任务。Task总期限上限两小时，执行租约短期续签，撤权仍然中止；这不是两小时墙钟压力测试。
- Linux三机复跑发现实际Unix socket路径超长失败，已修复为0700短私有socket目录，保留原签名及PID/创建时间/UID/祖先校验，并验证正常退出后目录清理。

三机分别通过：CLI Task/资金组件8项、原生CLI桥3项、Task29项、资金27项，以及真实rc.3 MR受管执行/重跑/预算/取消/中断恢复。CLI组件使用明确的离线协议替身；真实0.163.0非推理桥为独立证据。没有新增模型推理。见[CLI执行组件证据](evidence/20261027_m5_cli_execution.json)及[组件合同](../../packages/cli-runtime/README.md)。

完整回归仍为1339项（1336通过、0失败、3跳过）。实际工作树npm包237个文件、110个运行时依赖闭包通过，已去掉冗余目录声明并保留全部逐文件源码；尚未提交，因此没有Git字节/发布验证或新CI运行结论。默认产品Task/资金接线、单事务准入、其余CLI、远程执行和OS worker仍在进行，W11.2未宣告完成；行为记录22组，M0和完整工程均未完成。

## 2026-10-27：产品机器页、秘密引用与按 Bot 远程授权

- 默认产品入口已接入持久机器目录，支持拥有者保存宿主专用凭据、核验 machineId/API major、secretRef 配对、按 Bot/根目录/工具授予、ping、受控读测试、撤销及停止状态核对。秘密仍使用原 DS 库及脱敏器，机器元数据不保存 Token；保留 `REMOTE_AGENT_*` 名称空间，秘密界面和 Bot 的 `request_secret` 均不能将控制凭据交给 Bot shell。
- 工种 Bot 通过真实 AgentLoop 调用 `remote_computer_read/list/ping`，身份来自实际 SDK Agent 对象，不能从参数冒充。根目录、工具与配置 revision 在派发前重查，授权变化能中止静默请求；远程控制面按 client/Bot 撤销短期票据，已运行进程会实际停止，兄弟 Bot 的票据不受影响。
- 离线撤销立即阻止宿主新调用，将远程停止保留为“未确认”，跨重启继续显示；拥有者可重试确认，确认不会恢复授权。不同宿主连接的撤销结果按 request_id 写回，迟到成功不能覆盖较新的未确认记录。
- 宿主机器目录具有独立版本。生命周期新增基于已提交 DS 快照的授权刷新，允许同一 DS revision 下变更宿主能力，同时保留原 DS 同版本内容冲突、Session 归属及撤权 fence。
- better-sqlite3 13.0.3 进入产品固定依赖，pnpm 仅允许该包原生构建；CI 增加产品 addon 构建与机器 Host 探针。客户端已重新生成并校验。当前 Task/费用投影仍明确 blocked；远程写入、CLI、浏览器及桌面 Task facade 继续施工。

| 环境 | 机器 Host 原生 | Agent 原生 | 默认真实宿主组合 | 本轮真实模型调用 |
|---|---:|---:|---:|---:|
| 本机 Win11 / Node24.20.0 | 8/8 | 12/12 | 9项通过 | 0 |
| 远程 Ubuntu / Node22.22.1 | 8/8 | 12/12 | 9项通过 | 0 |
| 远程 Win10 LTSC / Node24.18.0 | 8/8 | 12/12 | 9项通过 | 0 |

本机完整回归1339项：1336通过、0失败、3跳过；资金原生27/27、strict固定依赖和客户端检查通过。两台远程机使用新的隔离源码目录及既有已验证原生依赖，**不构成干净安装、跨机 VPN/TLS 或生产部署验收**。证据见[产品机器接入](evidence/20261027_m4_product_machines.json)。W09.2完成，生产与网络部署另列W09.3继续；完整20包仍未完成，M0仍9/12，无新增产品场景passed。

交接环境判断已复核：两台测试机可达；本机另有可用Codex0.163.0，其独立profile、真实CLI孙进程MCP、准确配置模型、伪造拒绝、撤权和Windows Job停止已在无推理模式通过，无需为了旧PATH上的0.157.1改协议。实际响应模型/真实GPT工作流仍未验收。此前一次CLI turn已分派但超时、usage及厂商请求数未知；本次0次新推理不能冲销该未知结果。所有改动保留在未提交工作树，未推送或发布。

## 2026-10-27：验收场景证据归集与台账语义厘清

- 对全部 63 个验收场景做了证据清点，并把已有真实证据的 10 个场景挂上证据与精确说明（T03 严格模型不可用、T04 同模型多 Bot 私有状态、T05 白名单与旧入口越权、T06 Main 无群端到端、T07 重复投递、T10 并发限额、T13 Host 崩溃重启、T15 agent 去重冲突、T32 CLI 精确模型身份、T55 兼容 facade）。每条都写明"已验证到哪一层、还剩什么"，未超出证据覆盖范围提升状态。
- 同时把 4 个真缺口显式记入台账而不是留空：T08 的环路/悬空依赖/重复 id 拒绝、T09 依赖失败与独立分支、T11 工作区写入互斥、T12 的整任务树取消——共同依赖尚未实现的依赖调度器（W07.2/W08.5）；T11 还依赖尚未放行的写执行 facade。
- **台账语义厘清（重要）**：校验器要求施工包只有在**全部验收场景 passed** 时才能标 completed，且非 M0 施工包完成还要求 M0 四个门禁全部完成。因此 W04/W05 等包即便交付物已验证，也必须保持 in_progress 直到产品级验收通过——施工包完成度不能代替产品验收，这与 statusMeaning 的声明一致。
- 施工包子步骤同步：W02.5（CLI 配置隔离/bridge 试验）凭 cli-runtime、cli-execution 与默认产品三项证据完成；W04.1、W05.1、W05.2、W07.1、W08.1–W08.4 完成并挂证据；W07.2/W08.5 记为 planned 并写明缺口。M0 记录子步骤 11/12。
- 证据清点第二轮：再把 12 个场景挂上已有证据（T02/T39/T41/T44/T45/T46/T51/T53/T56/T61/T62 及前述批次），累计 1 passed / 45 partial / 17 not_run。剩余 17 个 not_run 已逐条定性：4 个依赖未实现的依赖调度器，其余分别需要第二台机器、真实桌面/PTY、真实 CLI 入口、安装发布授权或公网暴露面验收。

## 2026-10-27：未确认收据的 owner 人工核对路径

- 未确认收据（已分派但无厂商账单）会让其 Bot 与所在资金范围 fail-closed：`assessFundingAdmission` 见到 unknown 即拒绝后续准入，且中断执行留下的预占同时贡献估算金额与 unknown 计数。本轮补上 owner 侧的人工核对路径。
- `sqlite-router-state.mjs` 新增 `resolveUnknownPackage`：同一个 CAS 事务内按 owner 决定处理未确认工作包——`attest` 记厂商确认金额、`waive` 按零费用放行（均需留痕说明），并释放中断执行的预占；解决记录写在 run 自身，提交摘要链即审计链，不引入第二个资金写入方。活动中的预占一律拒绝由核对解决；跨 Bot 越权在所有权校验处即被拒；同一工作包只能解决一次。
- 组合层新增 owner 动作 `usage.resolve`（仅资金权威可用时注册）与 usage 分区扩展：`unresolved` 列出可核对的未确认工作包，逐条收据附 `resolution`（kind/costUsd/note/resolvedAt）；已确认收据与支出汇总对齐，未确认金额不再重复计入。
- 验证（本机 Win11/Node24.20.0，真实模型请求 0）：新增原生套件 `tests/unknown-receipt-resolution.native.mjs` **7/7** 并进入 `npm test`；默认产品探针 **26/26**（新增"owner 经真实 owner 动作解决未确认收据；waive 在 run 上留痕且 Bot 恢复支出"，断言跨 Bot 越权与同 Bot 重复解决均被拒、unknownCount 归零、收据与汇总一致）；完整回归 1392 项、1389 通过、0 失败、3 跳过。

复现与限制见 [N09 Task/CLI 默认产品证据](evidence/20261027_m10_task_cli_default_product.json)（已同步 26 项检查、17 个源 blob 与新回归数字）。客户端费用页已提供核对入口（必填说明 + 可选厂商金额 + 两个门控动作，收据行显示解决标签），出厂 bundle 已重建并校验。仍开放：被保留策略淘汰的 run 折叠进归档后不可单独核对、Task/outbox 与资金单事务准入（需共享连接或两阶段提交）、jsdom 测试骨架无法模拟文本输入（React 先于 DOM 加载），输入交互语义由真实宿主探针与原生套件覆盖。绑定 maxConcurrentTasks 已兑现。

## 2026-10-27：Task/CLI 接入默认产品（N09）

- 默认产品 boot 在同库打开 Task journal（共享 `orchestration.sqlite`），创建一个 Task Service（`within` 即共享策略的执行上下文），注册有界 `bot_task_start/status/cancel/retry/reconcile` 工具并在 dispose 与 boot 失败链中释放；read-model `tasks` 分区按 Bot 分页持久 journal 并附后端目录；owner 动作 `task.cancel/retry/reconcile` 运行在归属 Bot 自身主体上，授权来自 Bot 已提交授予而非浏览器会话。
- **后端设计定论**：目标契约按类型固定（`mr-api`、`codex-read`），执行目标、模型与资金在运行期从提交 Bot 的绑定解析——绑定变更不改写已持久 target hash，旧任务重试/核对仍可准入，每个 Bot 按自己的配置价格计费；绑定是授予与资金唯一来源，服务层不重复模型校验。CLI 后端仅在宿主声明安装核验入口（executable/sha256/version）与已核验 CLI 模型身份时存在，未配置时目录不暴露 codex 工具/模式/cliModels。
- runner 租约 10s + 心跳续约；崩溃未释放租约的旧宿主阻塞新宿主认领直至租约到期，boot 有界等待（12s）后 fail-closed，不丢弃全部托管任务。
- 验证（本机 Win11/Node24.20.0，真实模型请求 0）：默认产品探针 **25/25**（新增 7 项 N09 检查）；`snapshotSections` 六分区全部 available（tasks 由 blocked 转 available）；完整回归 1385 项、1382 通过、0 失败、3 跳过；组合套件 10/10；闭包 20/20（files 252 项）；combined-host `--tasks` 9/9、`--legacy-policy` 通过；finance 33/33；product-host 4/4；remote-machines 通过；`integration:check` 有效；`check:client` OK。
- 修复三处真实宿主暴露的问题：组合未导入 `dirname` 致宿主在任何服务打开前中止；探针原经 Bot AgentLoop 驱动核对，但未确认收据 fail-closed 该 Bot 模型回合，恢复改走真实 owner 动作；收据/汇总一致性改为已确认收据与支出合计对齐、未确认金额单独断言为 unknown。

复现与限制见 [N09 Task/CLI 默认产品证据](evidence/20261027_m10_task_cli_default_product.json)；E20 观察与 W11.2/W08 台账已更新。剩余缺口：初始 Task/outbox 与资金单事务准入、缺收据人工核对 UI（Bot 在 owner 解决前不可再花费）、Task runner 每 Bot 同时仅一个任务、真实 codex 入口需宿主安装核验决策、三机复跑。

## 2026-10-27：MR 咨询关联原运行收据（N08）

- 默认产品的 Bot 经真实 owner 动作配好资金范围与 Main/Worker 绑定后，worker 的 MR 咨询走统一准入：**恰好一条关联收据**（source `mr-api`，usage 11/5 未被重复计），逐来源收据总额与 funding 汇总一致——MR 运行与 Bot 侧不再双记账。
- 修复三处真实宿主暴露的接线缺陷：(1) 咨询的模型调用不带 sessionId，factory 的身份解析改经策略的可信上下文（ALS 执行帧）；(2) 组合的 accountStream 包装层在记账前把 MR 执行帧内的直接调用标记为托管，关联原运行发票；(3) 组合向 ctx 提供 `botFunding`，MR 咨询路径经同一绑定投影路线，运行包携带绑定价格而非未知费用包（此前未知费用使后续准入全部 `MODEL_WAITING_BUDGET`）。
- 验证（本机 Win11/Node24.20.0，真实模型请求 0）：默认组合探针 **17/17**（新增“MR 咨询恰好一条关联收据、收据与资金汇总一致”）；针对性测试 12/12；完整回归 1382 项、1379 通过、0 失败、3 跳过。

复现与限制见 [N08 MR 咨询收据证据](evidence/20261027_m9_mr_consult_receipts.json)；E20 观察已更新。N09（Task/CLI 默认接线，即任务 7）随后：仅单包咨询路径已在产品探针覆盖，executor/team/rerun 的 MR 路径、订阅模式 Bot 绑定与三机复跑仍未完成。

## 2026-10-27：usage 只读投影接入默认产品（N07）

- `product-composition.mjs` 新增 usage 提供器：按已提交 Bot 经 `store.modelCalls` 游标分页读取持久收据，逐条金额用共享 `actualCost` 计算（用量/价格未知保持 null，仅未运行才为 0）；summary 汇总 apiUsd/reservedUsd/unknownCount 与订阅日/月调用次数（全部来自唯一 SQLite 权威的 funding 投影）。read-model 六分区中五个 available（bindings/botBindings/fundingAccounts/machines/usage），tasks 仍按设计 blocked。
- 客户端来源标签统一为收据词表（bot/aux/mr-api/cli/review），与投影层一致；出厂 bundle 重建为 2,055,661 字节，`build:client`/`check:client` 通过。
- 验证（本机 Win11/Node24.20.0，真实模型请求 0）：默认组合探针 **15/15**——新增"usage 投影显示逐来源收据、精确模型与资金汇总，未知金额保持 null"（断言存在 bot 会话与 aux 辅助两类收据、金额 >0 或 null、billing=api、summary.apiUsd>0 且 unknownCount/reservedUsd 为数值）；完整回归 1382 项、1379 通过、0 失败、3 跳过；UI/组合测试 11/11。

复现与限制见 [N07 usage 投影证据](evidence/20261027_m8_usage_projection.json)；E20 观察已更新。N08 待办：探针补 MR 咨询不双记账、辅助调用独立记账、unknown/撤销/冷启动收据断言；N09（Task/CLI 默认接线，即任务 7）随后。

## 2026-10-27：默认产品统一资金准入（N06b）

- 默认产品的 Bot 模型调用全面走统一准入：`grantFor` 委托 `botSettings.grantFor()`（未配置/模型不匹配/不完整 → 无模型授权，fail-closed）；`onCommitted/onSuspended` 立即发布/撤销授权到 directory 并刷新 lifecycle；账户变更联动重评全部绑定（资金范围目录跟随账户状态）；`bindingFunding` 把绑定映射为记账策略（API：价格/请求上界/日月预算 + 账户限额；订阅：日/月调用次数）；`accountStream` 从诊断装饰器切换为 `createModelAccounting()`，store 为同一 SQLite 权威——Bot 会话与辅助调用不再游离在预算之外。
- 真实宿主暴露并修复三处集成缺陷：(1) Bot runtime 报 `bot-session`/`bot-auxiliary` 来源而收据 schema 是封闭词表（`bot`/`aux`/`mr-api`/`cli`/`review`），辅助调用被 `INVALID_MODEL_RECEIPT` 拒绝——组合层做显式词表适配，未知来源 fail-closed；(2) SDK AgentLoop 传**冻结请求**（signal 不可写），先触发 `MODEL_CANCELLATION_BOUNDARY_REQUIRED`、后因未指定 maxTokens 被误判为需钳制而触发 `MODEL_OUTPUT_BOUNDARY_REQUIRED`——改为可变请求照旧携带合并租约信号、冻结请求由租约信号门控迭代（quiet provider 仍被撤权/过期中断，清理时归还迭代器），钳制仅在请求显式超界时要求；(3) bot-settings 的 compiledGrant 从目录 capabilities 取工具而目录初始为空，授予缺 `model/infer`——目录提供 model-inference/mr-routing 两个能力（精确对应默认产品面）。
- 验证（本机 Win11/Node24.20.0，真实模型请求 0）：默认组合探针 **14/14**——未配置 Main 保持 blocked；owner 经真实动作启用资金范围并配置 Main/Worker 绑定后才发合成回合；worker 执行获准 MR 路由；派活回传保持；未认证快照 401；快照返回真实 Bot/编译授权/精确模型路线/本机机器条目/资金范围目录；owner 经真实 Gateway 读高级账本而写操作被拒；机器配对与 Bot 域 MCP 读取经真实 AgentLoop；撤销使远端票据失效；**禁用资金范围后下一回合零 provider 分派且绑定转 blocked**；冷启动重建身份。model-accounting 原生 **14/14**（新增冻结请求准入 + 租约门控 quiet provider 回归）；完整回归 1382 项、1379 通过、0 失败、3 跳过。

复现与限制见 [N06b 统一准入证据](evidence/20261027_m7_bot_funding_admission.json)；E20 观察已更新。N07 待办：usage 只读投影（per-source 收据/预算/预占/未知计数）与费用页面、配置表单接入客户端；N08 待办：探针补 MR 咨询不双记账、辅助独立记账、unknown/撤销/冷启动收据断言；N09（Task/CLI 默认接线）随后。`inputBoundFor` 暂返回配置的请求上界，按模型 context window 派生保守上界为后续。

## 2026-10-27：Bot 绑定与资金账户配置面接入（N06a）

- `product-composition.mjs` 在产品宿主 boot 打开 `openBotSettings()` 与 `openFundingAccounts()`（同一 SQLite 的组件表；boot 失败链与 dispose 均按序关闭）；`settingsCatalog` 提供可信绑定目录：路线模型、**本机机器条目**（启用绑定强制要求 workspaceRef，没有本机条目则无法启用）与已启用资金范围；工具/能力目录随各自 facade 落地。
- read-model 新增 `botBindings` 与 `fundingAccounts` 分区；owner 动作 `binding.save`（Bot 设置 CAS 提交）与 `funding.account.save`（资金策略 CAS 提交）仅在组件可用时注册，未配置绑定保持 blocked 而不伪造可执行。
- **边界（重要）**：本阶段只接配置面——授予编译仍走路线目录、模型调用仍走诊断装饰器；`onCommitted/onSuspended` 是刻意的不发布记录器。切换到 bot-settings 授予 + model-accounting 准入是 N06b（原子切换：grantFor 委托、授权发布/撤销、pricingFor、accountStream 替换 + 探针先配置），已把设计与待决问题写进 `EXECUTION-20261027.md`；半途停留会令默认产品不可用，禁止分批合并。
- 验证（本机 Win11/Node24.20.0）：默认组合探针 **11/11**（新增"owner 资金策略与 Bot 绑定保存走真实 owner 动作、未配置绑定保持 blocked"）；针对性测试 36/36；完整回归 1382 项、1379 通过、0 失败、3 跳过；files 闭包 241 项、闭包测试 20/20。期间修复一次内联脚本把 119 个绝对路径误写入 package.json files 的问题（已剔除并按相对路径闭包补齐真正缺失的 bot-settings/funding-accounts）。
- 新原生资金套件（funding-accounts、funding-projection、bot-settings、cli-execution、funded-router-state）已注册进 `npm test`，直接 import 根生产依赖 better-sqlite3，无需 `DSH_TASK_DRIVER`，CI 随完整套件覆盖。

复现与限制见 [N06a 配置面证据](evidence/20261027_m6_configuration_surface.json)；E20 观察已更新。

## 2026-10-27：默认入口唯一资金权威与远程机器启动接线（N05）

- `apply()` 同步段先安装 `createDeferredRouterState()` 等待态 facade（早期 MR 调用等待而非回退 JSON 双写）；产品 boot 打开 `openProductFunding()`（原 JSON 账本备份/迁移 + funded 适配）与 `openRemoteMachines()`（同一 SQLite 的组件表）后再 resolve；启动失败 reject 且按序清理，不泄漏半初始化状态。dispose 顺序：product → machine secrets → machines → funding → authority。
- 修复三处回归：(1) `grantFor` 在机器目录已关闭时抛 `MACHINE_DIRECTORY_CLOSED`，改为不可用时授予无机器权限（DS lifecycle 不再被挂起）；(2) `package.json` files 缺少 8 个 Host 入口闭包模块（deferred/funded/funding-admission/funding-projection/model-receipt/product-funding/sqlite-router-state/task-contract），已按闭包补齐至 239 项；(3) 默认探针与组合启动竞态（资金/机器权威先于 DS 通道就绪），已在两次启动后等待产品通道。
- 验证（本机 Win11/Node24.20.0）：`integration-product-default.mjs` **10/10 通过**——Main 经原 DS 工具创建工种 Bot、工种执行获准 MR 路由、派活回传、未认证快照在连接准入层被拒、快照返回真实 Bot 与编译授权、owner 经真实 Gateway 读高级账本而写操作被拒、未接入区块返回可执行阻塞原因、owner secretRef 配对 + Bot 域真实 MCP 读取经真实 AgentLoop、撤销移除授权并使远端票据失效、冷启动重建身份。`integration-remote-machines.mjs` 通过；联合原生资金套件 68/68（需 `DSH_TASK_DRIVER`）；完整回归 1346 项、1343 通过、0 失败、3 跳过；`integration:check` 与客户端 `--check` 通过。
- 快照分区：bindings/machines = available，tasks/usage = blocked（按设计，服务接入前不伪造数据）。模型准入仍是诊断装饰器——逐来源收据与预算准入随 N06 统一资金钩子落地。

复现与限制见 [默认资金与机器证据](evidence/20261027_m5_default_funding_machines.json)；E20 观察已更新。N06 待办：Bot 设置/账户目录/模型资金钩子接入默认产品（bot-settings、funding-accounts 已实现且有原生测试，尚未接入默认授予与准入）。

## 2026-10-27：出厂默认单插件组合（DS 运行时 + MR 合一）

- `apply()` 现在在同一个 cordis 插件入口内组合 `startBotProduct`：同步段创建共享 authority/directory/policy 并在第一个 await 前提供 `botIntegrationPolicy`（所有旧工具/命令/RPC 接收器在调用时解析同一策略），随后在有界初始路线快照后创建 DS 运行时。轻量直接 `apply()` 调用方（无 Cordis 表面或 DS 服务的测试上下文）保持旧 MR 行为；配置项 `botProduct`（默认 true）允许隔离组合显式退出。
- 授予编译：每个 Bot 获得固定只读 MR 面（routes/plan/consult + command/router + model/infer）加其**已配置的精确 provider/model**；未配置模型不获得任何模型授权（严格暂停，不静默切换）。路线目录必须取原始目录——经策略过滤的视图在执行上下文外会拒绝，曾导致全部 Bot 无模型授权（已修复并记入证据）。
- 客户端收敛为单一出厂 bundle：`.dsh-plugin/client.js` 由 `apps/integration-client/index.jsx` 生成（DS 界面 + MR 面板 + 产品导航），`build-client` 委托产品生成器，重复的 apps bundle 在字节一致验证后移除；GAL 防护从“大小代理”改为内容级检查（标识禁则 + 嵌入图片载荷上限 + 生成器输入路径检查）。
- 发布清单携带完整运行时闭包（230 项）：bot-runtime 模块、vendor DS 宿主/共享源（逐文件）、orchestration 原语；`npm run check:client`、产品源码 297 文件、product-client `--check`（2,045,678 字节、118 输入）通过。
- 真实 rc.3 宿主默认组合探针 7 项检查通过：Main 经原 DS 工具创建工种 Bot、工种执行获准 MR 路由、派活与回传保持、未认证产品快照在连接准入层被拒、快照返回真实 Bot 与编译后授权及精确模型路线、未接入区块返回可执行阻塞原因、新进程重建稳定身份。隔离 fixture 组合探针（product-host）与 combined-host legacy-policy 9 项检查不回归。
- 完整回归 1335 项：1332 通过、0 失败、3 跳过（新增 6 项组合单元测试与默认组合探针）；CI 新增“出厂默认单插件组合”步骤。

复现与限制见 [默认组合证据](evidence/20261027_m1_default_composition.json)，行为入口记录增至 20 组（E20 为本轮新增）。W03.3（默认入口组合）标记 completed，W03.4（用户配置迁移与旧安装升级）保持 in_progress。

仍未完成：诊断装饰器不计费（逐来源收据随 SQLite 资金权威落地）、Task/机器/用量投影 intentionally blocked、默认用户配置迁移、Ubuntu/Win10 复跑、Electron 载体与真实模型推理。

## 2026-10-27：迁入DS运行时、统一模型收据、CLI桥接与远程agent（工作树盘点检查点）

- 盘点未提交工作树并逐项验证：`modules/bot-runtime`（冻结 DS 迁入）、`packages/cli-runtime`、`packages/capability-broker/src/cli-*`、`remote-computer-agent`、`native/windows-desktop`、`deploy/remote-agent`、`apps/integration-client` 与 `model-accounting`/`model-receipt` 均已实现且通过对应检查。本检查点补齐证据、台账与 CI 注册，不改产品默认入口，未宣称默认组合完成。
- DS 迁入：`vendor/ds-bot` 全部 297 个文件与冻结提交 `de55888a93983fc51c94f7d22bc94b4f8293205d` 的 Git blob 和 SHA-256 逐一相符，无未登记文件；保留 LICENSE/UPSTREAM_LICENSE/UPSTREAM_NOTICE。产品 factory 只从可信已提交配置编译授权，保存成功后才更新真实 Session/Agent 归属；未认证通道不能读取名册或调用动作。
- 真实 rc.3 宿主组合：迁入 Main 经原 DS `create_bot` 创建工种 Bot、工种 Bot 执行获准 MR 路由、原 DS 派活与结果回传保持、新进程从持久状态重建稳定身份与记账钩子；accountStream 是明确标注的离线诊断装饰器，不发生真实扣费。
- 迁入上游套件：vendor 内 1062 项测试 1061 通过、1 跳过、0 失败；产品客户端单一 bundle 2,045,678 字节、118 个输入，包含全部 DS 界面与 MR 高级面板，与工作树字节一致。
- 前台模型收据：Bot 会话与辅助调用在调度前完成准入、预占与结算，按来源（bot/aux/mr-api/cli/review）各结算一次收据；预算拒绝不触达 provider 也不写收据；缺收据保持 unknown 并阻塞下次计费调用；撤权中止进行中的 provider 信号并拒绝迟到成功；订阅调用 USD 保持 0。原生资金检查 27 项通过（19 项 SQLite 状态 + 8 项模型记账）。
- CLI 运行时与桥接：环境不继承凭据、全局 home、PATH 影射或 Node 注入；请求/报告/验证映射分别记录且配置模型不一致即拒绝；原生 peer 取消真实子进程树并确认包含；私有签名 bootstrap 拒绝同用户无关 peer，真实孙进程 MCP 连接只列获准工具、伪造参数被拒、撤权后桥接失效；租约续期不能复活过期或已释放租约。
- 远程电脑 agent：11 项原生检查（配对/轮换/撤销、路径逃逸、原子 CAS、重启未知、真实 argv、超时杀进程树、撤权停子进程、四种网络模式、Streamable HTTP、远程 worktree 条件合入、缺 helper 显式失败）；浏览器 5 项隔离检查；Win11 交互桌面 8 项检查（ACL 命名管道、真实 Unicode SendInput、跨 Bot 租约、过期截图、错误会话）。
- 本机 codex-cli 0.157.1 的 `app-server` 启动后立即退出（拒绝在临时 home 创建 PATH 别名；隔离 home 下 sqlite state 初始化失败），真实 CLI 入口探针在本环境受阻。适配器按 0.163.0 验证过的 app-server 协议编写，记为环境限制而非代码缺陷；是否适配 0.157.1 的 daemon/proxy 模式留作明确决策。
- 预算等待自动到期：`task-journal` 新增 `expire` 扫描，runner 启动与每次心跳续期时把超过总 deadline 的 `waiting-budget` 任务置为 `failed`/`BUDGET_WAIT_EXPIRED`（单事务、带事件、不新增 attempt）；显式重试/取消语义不变，到期后重试仍按 `TASK_DEADLINE` 拒绝。原生 Task 检查 26→28 项全部通过。
- 测试与 CI：4 个新测试文件进入 `npm test`；新增 6 个 CI 探针步骤（产品源码字节、客户端 bundle、原生 CLI 桥、远程 agent、迁入上游套件、真实产品宿主），integration-host 超时 15→25 分钟；为恢复浏览器探针安装了 `remote-computer-agent` 声明的 playwright 1.64.1 可选依赖与 chromium（仅本机 node_modules）。

| 环境 | 完整回归 | 通过 | 失败 | 跳过 | 原生资金 | 原生CLI桥 | 远程agent | 原生Task |
|---|---:|---:|---:|---:|---|---|---|---|
| 本机 Win11 / Node24.20.0 | 1329 | 1326 | 0 | 3 | 27通过 | 3通过 | 11通过 | 28通过 |

复现与限制见 [DS迁入证据](evidence/20261027_m1_bot_runtime.json)、[模型收据证据](evidence/20261027_m0_model_accounting.json)、[CLI运行时证据](evidence/20261027_m0_cli_runtime.json)、[远程agent证据](evidence/20261027_m0_remote_agent.json)、[预算等待到期证据](evidence/20261027_m0_budget_wait_expiry.json)。行为入口记录增至 19 组（E15–E19 为本轮新增）。

本次仅本机 Win11 复跑；Ubuntu 与 Win10 三机复跑、真实 codex 入口、产品默认组合与配置迁移、单事务 Task/资金准入、缺收据人工核对 UI、机器页与生产部署均未完成。预算等待自动到期已落地（journal 扫描 + 心跳驱动，28 项 Task 原生检查通过），等待/到期状态的产品 UI 展示仍属既有任务卡标签，无专项验收。新增 T16/T17/T18/T20/T21/T22/T23/T24/T26/T27/T28/T31/T32/T33 为 partial，T01/T05/T12 补充证据；没有新增 passed；M0 记录子步骤仍为 9/12（W01.4/W02.5/W02.7 未结），W03/W09/W11/W15 已按已验证基础转入 in_progress。

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
| G1 宿主/会话 | rc.3真实Session/AgentLoop、浏览器UI、三机自动创建/群成员/换段/删除/冷启动，Gateway正向调用；迁入产品factory真实宿主组合、1062项上游套件、产品客户端bundle | MCP/search/审批/schedule、锁接管/热重载等完整生命周期；默认产品配置迁移、任务预算与部署拓扑 |
| G2 权限边界 | 自动提交快照/多Session主体；旧入口/Gateway；Task入场前关联、请求前fence、原收据只读核对与撤权；实际PTC及Linux合成容器；前台Bot/辅助逐来源收据与租约续期；远程agent逃逸/CAS/撤权与Win11桌面ACL | 单事务Task/outbox/资金准入、缺收据人工核对UI、默认入口迁移、完整审批、原生CLI与真正DSH OS worker；Win11沙箱ACL受阻 |
| G3 CLI/bridge | Codex独立配置实际解析；真实MCP子进程按授权列/调工具、撤权与取消；私有签名bootstrap、原生peer孙进程MCP限定与原生进程树取消 | 真实CLI入口（本机codex 0.157.1受阻）、真实CLI模型身份、远程路径与产品执行接入 |
| G4 安装/存储 | 三机原生驱动、SQLite MR单写切换/CAS预算/原始备份/最新账本回退及进程退出恢复；playwright恢复与桌面helper真实SendInput；deploy安装器已生成 | Electron ABI、PTY、干净安装/升级/卸载、默认产品迁移与真实部署 |

已登记并使用两台真实测试目标，但生产常开宿主和产品agent尚未部署。SSH可达不能替代产品配对/鉴权、WireGuard拓扑或笔记本休眠验收。现有Windows测试的3个跳过项涉及PTY或进程树，不能计为通过。

## 下一步

1. **N09（Task/CLI 默认接线，即任务7）已完成**（见上方 N09 检查点与 [证据](evidence/20261027_m10_task_cli_default_product.json)）：默认产品组合 boot 内的 Task Service、tasks 分区、owner 任务动作与受宿主入口门控的 CLI 后端均已接线并验证；backend 设计问题已按“目标契约按类型固定 + 运行期从绑定解析”定论。剩余仅工程性缺口：初始 Task/outbox 与资金单事务准入、缺收据人工核对 UI（Bot 在 owner 解决前不可再花费）、Task runner 每 Bot 同时仅一个任务、真实 codex 入口（需宿主安装核验决策）、三机复跑。
2. 继续W02/G2：初始Task/outbox与资金同事务准入（journal 与 funding store 为独立 SQLite 连接，原子化需共享连接或两阶段提交并留痕）；再接默认产品组合与配置迁移、真正DSH OS worker。缺收据人工核对已端到端落地并经默认探针与原生套件验证，绑定 maxConcurrentTasks 已兑现（默认单任务、二任务绑定并发且可取消）。预算等待自动到期已落地，等待/到期状态的产品展示沿用任务卡标签。
3. 继续W02/G3：真实codex入口需先做版本决策（本机0.157.1 app-server不可用：适配其daemon/proxy模式，或取得经验证的0.163.0入口）；然后补CLI模型身份、远程CLI位置与产品执行facade。
4. 远程agent产品化：机器页、secretRef配对、Bot机器授权与生产部署已完成并经默认探针验证（N05/N06b）；以已有真实测试目标验证常开部署与休眠拓扑（W02.7），并在Ubuntu/Win10复跑本轮新增套件（本检查点仅本机Win11）。
5. G1–G4达到所需证据后进入M1默认组合：单一插件入口加载bot-runtime产品，保留MR兼容facade，完成用户配置迁移。

T63（便携方案文档）已在document级通过；T01/T05/T12/T13/T16/T17/T18/T20/T21/T22/T23/T24/T25/T26/T27/T28/T31/T32/T33/T38/T40/T48/T49/T57为partial，其余产品场景尚未验收。M0已完成9/12个记录子步骤；W01/W02及四个总门禁仍未完成，W03/W09/W11/W15按已验证基础转入in_progress，不换算为整个项目的完成比例。

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
node scripts/integration-product-source.mjs
node scripts/integration-product-client.mjs --check
node scripts/integration-product-upstream-tests.mjs
node scripts/integration-product-host.mjs
node scripts/integration-finance-probe.mjs
node scripts/integration-cli-native.mjs
node scripts/integration-remote-agent.mjs
node scripts/integration-remote-agent-browser.mjs
node scripts/integration-remote-agent-desktop.mjs
```

真实codex入口探针需要安装验证过的原生入口：`node scripts/integration-cli-runtime.mjs --entry <codex.exe> --version <semver>`；本机0.157.1不可用，未纳入默认复现路径。

SQLite探针需要先在隔离的 `tmp/integration/probes/sqlite` 安装锁定的13.0.3驱动，命令见证据文件；不修改用户DSH数据。源文件静态清单中的Git blob来自冻结提交，不依赖本机换行符。

本机Corepack pnpm启动器曾报缓存目录错误，本轮改用项目既有 `tmp/pnpm-10.34.6/package/bin/pnpm.cjs` 执行固定版本安装，未修改全局Node、pnpm或代理配置。其他环境使用正常的pnpm 10.34.6入口。

完整测试宿主最初的严格peer检查发现遥测依赖选到不兼容的API1.10.0；已仅在独立测试fixture内锁为1.9.0并通过frozen/strict/offline安装。pnpm顶层不暴露全部peer包导致的测试解析问题通过公共package.json解析锚点解决，没有修改DSH或冻结DS源码。复现完整套件的方法见[测试宿主说明](../../tests/fixtures/integration-host/README.md)。

组合宿主的隔离、离线适配器和浏览器检查方式见[组合fixture说明](../../tests/fixtures/integration-combined/README.md)。CI新增Ubuntu/Node22与Windows/Node24组合宿主及原生数据库检查。远程机的连接凭据、实际目录和完整日志均不提交。

## 接手规则

先读本页和 `tasks.json`，再运行进度检查；不要重新做已留证据的基线验证，除非依赖、源码或环境变化。任务步骤完成不代表对应产品T场景完整通过。把新增证据、失败、限制和下一步同步记录在本目录，不能只留在聊天里。**跨会话/跨代理交接先读 [2026-10-28 详细交接文档](HANDOFF-20261028.md)（13 章：架构地图、资金链路不变量、剩余工作含依赖调度器实施设计、复跑命令、踩坑与同步规则），其次 [`HANDOFF.md`](HANDOFF.md)。**
