# 2026-10-27 恢复施工执行单

## 2026-10-31：E77 默认产品容器命令场景

[E77](evidence/20261031_command_combined_host.json) 修复 E76 之后的授权编译遗漏：`grantFor` 仅在 write/status/cancel 同时具备的绑定中编译容器命令能力。默认产品 AgentLoop 现在真实提交命令，Win11 非容器 never-started 无原生回退，Ubuntu 真 Docker exitCode 0 且停止确认，两个平台均 42 项检查通过。首次 `TOOL_DENIED`、投影断言和远程依赖失败均如实保留，未靠绕过授权或改任务合同销项。

本机最终根回归 1853 项、1785 通过、0 失败、68 跳过，check:client/integration:check 通过。停写切片 4/5、Windows OS 隔离命令、生产迁移/部署和完整产品验收继续。0 新真实推理、未提交或发布。

## 2026-10-30：E65–E66 自动回归与取消效果分类

[E65](evidence/20261030_stop_proof_regression.json) 把 E64 的 11 项停止来源/重试 fence 检查注册到根测试和 CI，六套专项 59/59、CI/闭包 6/6。首次注册根运行另有 2 项 CLI 高负载控制帧超时，fixture 有界等待提高到 45 秒后专项 13/13；保留原始失败，不改产品语义。

[E66](evidence/20261030_write_cancel_effects.json) 只给三个明确的 rename 前取消点分类 `possiblyApplied:false`；其他失败和发布后取消继续为 true。Host 只有核验独立 stop receipt 才接受 false，裸 false 保持 unknown。三机 workspace+stop-proof 联合各 67/67，本机根 1776 项、1754 通过、0 失败、22 跳过。停止与回滚仍严格分离，外部写者 CAS 和完整路径固定未由此关闭。

后续按授权继续 parent/leaf 固定、权限/世代、完整命令 facade、迁移/停写和实机门禁。0/20 整包、1/63、M0 11/12 不变，0 新真实推理、未提交或发布。

## 2026-10-30：E64 可信停止来源闭包

[E64](evidence/20261030_bound_stop_proof.json) 在九个源/测试文件内关闭裸标记和旧收据升级为可信停止的路径：Host 持久 dispatch fence、CLI 原资金收据绑定、Agent 独立落盘的进程内写入停止收据、远程原 operation 核对及保守 Task/plan/UI 投影。六个完整套件三机各 59/59；远程 52 源逐项一致，53 个最终 sourceGitBlobs 单独登记。客户端派生产物按实际面板重新生成并检查，journal 原生驱动探针 29/29。

首次远程包漏带 panels.jsx，两机各 2 个 UI 失败；旧 Win10 转发编码失败没有被记为独立的远程测试 exit。原始失败、修正包与原始字节日志及退出元数据都保留。本机根回归 1763 项：1740 pass、1 fail、22 skip，失败仍是既有 workspace-agent 取消收据的保守 possiblyApplied 断言，不在 E64 内改测试。错误的 journal 直接运行入口单列保留，改用原探针后 29/29。

仅接受 E64 的来源绑定组件，不接受完整产品；0/20 整包、1/63 passed、M0 11/12 不变。后续独立范围先补 stop-proof 回归入口并处理取消前无效果证明，再继续路径固定、命令 facade、迁移/停写、实机与发布门禁。没有真实模型或 profile 写入，没有暂存/提交/推送/发布。

## 2026-10-30：E63 产品面板快照顺序

[E63](evidence/20261030_product_refresh_order.json)：旧快照或旧实例不能覆盖新状态，读取失败/动作响应丢失时旧视图可见但操作关闭，直到新的读取成功；不自动重发。Win11、Win10、Ubuntu 真实 React/JSDOM 专项各 7/7，本机既有 UI 8/8、客户端生成校验通过。完整真实桌面和 Host 重试安全未由此验收。

## 2026-10-30：E62 取消停止证据

[E62](evidence/20261030_operation_cancel_evidence.json)：远程 Agent 的取消响应要求原操作收据提供严格布尔停止/未启动证据，终态不再自动证明外部进程停止；原收据与工作区锁保持。三机专项各 5/5，18 源 SHA 一致，本机取消/远程写联合 19/19、根 1759 项 1737 通过/22 跳过/0 失败。无证据的旧外部终态现在返回未确认，是有意的保守收紧。

后续继续容器不可降级协议、Linux 文件路径安全、迁移一致备份/回退和产品全场景验收。终态验证不等于 OS 隔离，也不解决外部写者的严格 CAS。

## 2026-10-30：恢复施工与 E61

用户要求 GPT 继续统筹，原交接停工状态已结束。CLI Windows 监督器 Job 原子创建、真实创建者死亡及受控能力探测在 Win11/Win10 同源专项各 13/13；本机完整 CLI 入口 16/16、全量根回归 1744 项中 1722 通过/22 跳过/0 失败。新增 npm 原生脚本闭包检查，测试包提取后 Windows 探测通过；安装版 Codex 0.163.0 无推理协议 13/13 再次通过。首次全量并发加入竞态测试时两项等待超时，改独立 Windows CI 和 npm 专项后复跑；远程输出编码错误也已记录并在 UTF-8 下重跑。详情见 [E61](evidence/20261030_cli_native_peer_job.json)。

下一步继续验证并整合 Linux 新建文件描述符固定方案；该工作仍在开发，不能视为已接入或解决对外部写者的严格 CAS。完整模型推理/账单、产品隔离、迁移与安装及整包验收继续待办，W11.2/T33 状态未关闭。冻结 vendor 与真实 desktop profile 保持原样，未发布。

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


> E45–E47：三机根1479/0失败、默认36/配置6通过；双Windows实际19项，各自清理通过。helper全局仲裁/可确认停止、私有路径API与配置搜索兼容已验证；完整迁移只读预览继续，OS/桌面状态/安装与全量门禁保留。

> E44：两机真实GUI基础8项分别通过（Win10 100%、Win11 150%），仅fixture窗口；清理验证通过。T29 partial，当前1/50/12，W16 in_progress；其余会话/DPI/停止/安装与完整迁移继续，不发布。

> E43最新：三机根1446/0失败，Windows1443通过/3跳过、Ubuntu1423通过/23跳过，源865/原生44/鉴权10/默认36通过。用户确认Win10及Win11解锁测试桌面可用，下一步真实helper和完整迁移；不提前发布。

> E42最终：三机根1443均0失败；Windows1440通过/3跳过、Ubuntu1420通过/23跳过，原生41/资金33/默认36和客户端字节一致。新源864文件逐一校验，复用依赖非干净安装。下一项W03.4/W06完整迁移。

> E41：公网鉴权本机组件通过，根1442/1439 pass/3 skip、安全7、Agent12、机器8、默认36。T59 partial，当前49 partial/13 not_run；下一项Ubuntu/Win10当前源码复跑，再完整剩余范围。

> 最新 E40：原子准入已实现，schema4；根1435/1432 pass/3 skip、原子20、默认36、journal/资金85、资金探针33均通过。本轮无真实推理，整体验收与发布未完成；N15继续。下方旧基准保留为历史。

> 2026-10-28 最新检查点：依赖调度器及冷启动幂等重投已验证，根 1415/1412 pass/3 skip，默认 35 项，调度原生 14、journal 联合 52；详见 E39 与 PROGRESS 首节。下方旧数字仅为历史。Task/资金原子准入只写了设计，仍待实现。

> 本文件是当前施工队列，不替代 [方案 1.1](plan/20261026_master_plan.md)、[正式任务台账](tasks.json) 或 [最新交接](HANDOFF-20261027-GPT.md)。组件完成不等于产品场景通过；每轮结束同步 `PROGRESS.md`、证据和下一步。

## 基线与边界

- 分支 `feat/bot-integration`，交接 HEAD `89e831264ebc7dacacdd54234377e51f37fb0785`。
- 保留整个未提交工作树；不 reset、clean、stash。用户已于 2026-10-28 授权：完整工程实现并验证完成后，直接提交、上传 GitHub 和发布 npm，核对最终产物，不重复询问。当前未完成，不提前发布。
- 冻结 MR/DS 基线与 GPT-only 约束不变，不修改 DS vendor 或 SDK。
- 测试使用隔离目录和受控替身；本阶段不发起真实模型推理。
- 当前正式状态：0/20 施工包完成，1/63 验收场景 passed，M0 记录子步骤 11/12。

## 当前施工队列

| 编号 | 状态 | 任务 | 完成判据 |
|---|---|---|---|
| N01 | 已完成 | 审查 `funding-accounts`、`deferred-router-state`、committed Bot 快照 | 接口与故障语义明确，缺口有测试覆盖 |
| N02 | 已完成 | 补三处针对性测试并修复实现 | 账户同步失败关闭、延迟启动完整 facade/拒绝与重复安装、快照一致性均通过 |
| N03 | 已完成 | 新资金套件联合原生回归 | 交接列出的六套及新增套件在当前工作树联合通过 |
| N04 | 已完成 | 基础回归与完整 `npm test` | 当前工作树结果单独记录，不引用旧 1340 数字 |
| N05 | 已完成 | 默认产品唯一资金权威启动接线 | 同步安装等待态；SQLite 启动/迁移成功后开放；失败与关闭不泄漏半初始化状态 |
| N06 | 已完成 | Bot 设置、账户目录与模型资金钩子接入默认产品 | 仅按已提交 DS Bot 编译授权；预算/撤权/unknown/冷启动一致；MR 咨询不双记账 |
| N07 | 已完成 | owner actions、usage/read model 与费用页面 | 真实 owner action 可配置；UI 显示预算、收据、订阅与 unknown，不伪造可执行状态 |
| N08 | 已完成 | 更新真实 rc.3 默认产品探针 | 先配置账户和 Main/Worker 绑定，再发合成模型回合；断言完整资金行为 |
| N09 | 已完成 | Task/CLI 接入默认产品 | 复用统一 Bot/账户/项目准入，保留取消、恢复与原收据核对 |
| N10 | 已完成 | CI、package files、行为审计与公开证据 | 新测试进入自动检查；闭包通过；证据区分组件、宿主和真实推理等级 |
| N11 | 当前源码已验证，非干净安装 | 三机复跑当前检查点 | 本机、Ubuntu、Win10 分别留新证据，不覆盖旧 E21/E22 |
| N12 | 待办 | 继续方案 1.1 剩余施工包与发布门禁 | 以 `tasks.json` 和 63 个场景为准，不提前宣告完整交付 |
| N13 | 组件已验证 | 依赖调度、目标 Bot 授权、取消树与写锁协议 | 原生 14 项、默认真实宿主 35 项；T09/T11/T12 仅 partial，真实写退出及混合 CLI/远程树仍待验收 |
| N14 | 组件及默认宿主已验证 | Task/outbox 与资金原子准入 | 先读 `plan/20261028_atomic_task_admission.md`；共享连接、待准入阶段、事务桥及真实进程退出矩阵 |
| N15 | 三机组件与轮换竞态已验证，实网待验收 | T59 公网鉴权抗滥用 | 先审查实际连接/代理 API，不能把 Host 或 Agent 的现有能力重复宣称为本轮新增 |

| N16 | 双Windows19项已验证，完整矩阵待验 | helper全局仲裁/停止与私有数据保护 | E45/E46；125%多屏/会话/托盘/上层授权与OS边界保留 |
| N17 | 兼容入口已验证，只读预览施工中 | 完整配置/数据迁移与回退 | E47；不对真实用户数据自动apply |

## 本轮检查点记录

- 2026-10-28 最终：补原 Agent 已解绑/归档后 owner canonical 重投；从原命令返回身份，旧 Session 不必重建，修改内容冲突仍拒绝，新的私聊来源仍核验已提交 Bot。根 1415/1412 pass/3 skip、默认 35、原生调度 14、journal 联合 52、身份/UI36；E39 和新冷重放证据已同步，E38 保留为稍早检查点。没有真实模型调用或提交/发布。

- 2026-10-28：接续前十组基线全部复现。依赖调度实施后，根 1414 项、1411 通过、3 跳过；调度器 13、journal/依赖/核对 51、身份/UI 联合 35、资金 33、默认产品 34 全部通过；strict 依赖/客户端/冻结源/受管与 legacy-policy 宿主通过。新证据 `20261028_dependency_scheduler.json` 20 个源 blob 逐个核对，E38 与任务台账同步，STATUS 由 report 生成。未提交/推送/发布，没有真实推理。
- 剩余未完成：初始 Task/outbox 与资金仍是两个连接的非原子准入（仅完成设计）；T11 写 facade/真实工作区退出、真实 Planner 与混合原生 CLI/远程取消树、T59，以及交接 §7.2 的环境/授权条件。W08.5 依交接约定仍 planned，W07.2 in_progress，不用局部测试替代产品 passed。

- 2026-10-27：已读取交接、正式台账、方案 1.1、E21/E22，核对分支/HEAD/工作树并运行 `integration:status`。
- N01–N04 已完成：针对测试 49/49、联合回归 110/110；完整根套件 1346 项，1343 通过、0 失败、3 跳过。`integration:check` 与产品客户端 `--check` 通过（2,055,676 字节、118 输入）。以上均为本机离线测试，不是产品场景验收。
- 审查修复了延迟 facade 错要求 `saveDynamicData`/`saveRoutingLearning` 的合同偏差；真实 SQLite/funded store 不包含这两个方法，否则 N05 启动会误拒资金权威。
- 当前执行 N05；N06 之后须依据实际测试结果继续拆分。
- 2026-10-27（续）：N05 端到端验证完成并修复三处问题：
  1. `product-composition.mjs` 的 `grantFor` 在机器目录已关闭时抛 `MACHINE_DIRECTORY_CLOSED`（boot 失败清理后调用即崩）；改为不可用时授予无机器权限，DS lifecycle 不再被挂起。组合单元测试 7/7。
  2. `package.json` files 清单缺少 8 个新资金模块（ Host 入口导入闭包）：`deferred-router-state`、`funded-router-state`、`funding-admission`、`funding-projection`、`model-receipt`、`product-funding`、`sqlite-router-state`、`task-contract`；已按闭包算法补齐（239 项），roadmap 闭包测试恢复。
  3. `integration-product-default.mjs` 与组合启动竞态：资金/机器权威先于 DS 通道就绪，首次 `api('state')` 404；已在两次启动后增加产品通道就绪等待。
- 当前基线（本机 Win11/Node24.20.0）：联合原生资金套件 68/68（需 `DSH_TASK_DRIVER`）；完整根套件 1346 项、1343 通过、0 失败、3 跳过；`integration-product-default.mjs` 10/10 通过（默认入口 = DS 运行时 + MR + SQLite 资金权威 + 远程机器，含 secretRef 配对/Bot 授权/撤销/真实 AgentLoop 读取/冷启动重建）；`integration-remote-machines.mjs` 通过。日志在 `tmp/integration/m0-20261027/`。
- N05 判据（同步安装等待态、SQLite 启动后开放、失败不泄漏半初始化状态）已由上述探针与 `tests/deferred-router-state.test.mjs` 覆盖；N06 待办：Bot 设置/账户目录/模型资金钩子接入默认产品（替换诊断装饰器为统一准入），随后 N07 owner actions 与费用页面、N08 探针扩展。
- 2026-10-27（续 2）：N10 部分完成——5 个新原生资金套件（`funding-accounts`、`funding-projection`、`bot-settings`、`cli-execution`、`funded-router-state`）直接 import 根生产依赖 `better-sqlite3`（无需 `DSH_TASK_DRIVER`），已注册进 `npm test` 获得 CI 覆盖；完整根套件 **1382 项、1379 通过、0 失败、3 跳过**。注意：`sqlite-router-state.native.mjs`/`model-accounting.native.mjs` 仍按旧约定走 `DSH_TASK_DRIVER`（由 finance probe 运行），未并入 `npm test`。
- N06 实施设计（下一轮，原子切换，禁止半途停留）：
  1. boot 内在 `deferredRouterState`（产品宿主）分支打开 `openBotSettings()` 与 `openFundingAccounts()`（同 SQLite 组件表）；`catalogFor` 提供 models（路线目录）、fundingScopes（账户目录）、capabilities 与**本机机器条目**（machineId=组合 machineId、location 'local'、root 'default'）——启用绑定强制要求 workspaceRef，没有本机条目则无法启用。
  2. `grantFor` 委托 `botSettings.grantFor(bot)`（纯函数；未配置/模型不匹配 → EMPTY_GRANT =  fail-closed），机器域保留现有 machines 目录集成（已探针验证）。
  3. **待决设计问题**：bot-settings 的 `machineGrants` 与 machines 目录绑定是两条机器授权路径；`machine.bind` 是否需要同步写 bot-settings 记录（跨组件事务）需先定论，否则授权来源不唯一。
  4. `pricingFor` 从 bot-settings 读取资金配置（api 需价格/请求上界/日月预算；subscription 需次数）；`accountStream` 换 `createModelAccounting()`（store=funding store），辅助调用独立准入。
  5. owner actions：`binding.save`（botSettings.save，CAS）、`funding.account.save`（fundingAccounts.save，CAS）；read model 增加 botBindings/fundingAccounts 分区。
  6. 探针（N08）必须先经真实 owner action 配资金账户与 Main/Worker 绑定再发合成回合；断言预算拒绝零分派、unknown/撤销/冷启动一致、MR 咨询不双记账。
- 2026-10-27（续 3）：N06a（配置面）完成并验证——`product-composition.mjs` 在产品宿主 boot 打开 `openBotSettings()` 与 `openFundingAccounts()`（同 SQLite 组件表，失败链与 dispose 均关闭）；`settingsCatalog` 提供路线模型、本机机器条目（启用绑定强制 workspaceRef）与已启用资金范围；read-model 新增 `botBindings`/`fundingAccounts` 分区；owner 动作 `binding.save`/`funding.account.save` 仅在组件可用时注册。**授予编译仍走路线目录、模型调用仍走诊断装饰器**——`onCommitted/onSuspended` 是刻意的不发布记录器，N06b 才切换。
- N06a 验证（本机 Win11/Node24.20.0）：默认探针 **11/11**（新增"owner 资金策略与 Bot 绑定保存走真实 owner 动作、未配置绑定保持 blocked"）；针对性测试 36/36；完整根套件 1382 项、1379 通过、0 失败、3 跳过；闭包测试 20/20（files 241 项）。期间修复：一次内联闭包脚本误将 119 个绝对路径写入 files，已剔除并改用相对路径闭包补齐真正缺失的 bot-settings/funding-accounts。证据：[N06a 配置面](evidence/20261027_m6_configuration_surface.json)。
- N06b（下一轮，原子切换）：`grantFor` 委托 `botSettings.grantFor()`（未配置/模型不匹配 → EMPTY_GRANT）、`onCommitted/onSuspended` 发布/撤销授权到 directory 并刷新 lifecycle、`pricingFor` 读绑定资金配置、`accountStream` 换 `createModelAccounting()`；探针必须先配资金账户与 Main/Worker 绑定再发合成回合。半途停留会令默认产品不可用，禁止分批合并。
- 2026-10-27（续 4）：**N06b 原子切换完成并验证**——默认产品的 Bot 模型调用全面走统一准入：`grantFor` 委托 `botSettings.grantFor()`（未配置/模型不匹配/不完整 → 无模型授权）；`onCommitted/onSuspended` 立即发布/撤销授权并刷新 lifecycle；账户变更联动重评全部绑定；`bindingFunding` 把绑定映射为记账策略（API 价格/请求上界/日月预算 + 账户限额，或订阅次数）；`accountStream` 从诊断装饰器切到 `createModelAccounting()`（store 为同一 SQLite 权威）。
- N06b 关键修复（均为真实宿主暴露）：(1) Bot runtime 报 `bot-session`/`bot-auxiliary` 而收据 schema 封闭词表为 `bot`/`aux` 等，辅助调用被 `INVALID_MODEL_RECEIPT` 拒绝——组合层做显式词表适配，未知来源 fail-closed；(2) SDK AgentLoop 传**冻结请求**（signal 不可写），先触发 `MODEL_CANCELLATION_BOUNDARY_REQUIRED`、后触发 `MODEL_OUTPUT_BOUNDARY_REQUIRED`（未指定 maxTokens 被误判为需钳制）——改为：可变请求照旧携带合并租约信号，冻结请求由租约信号门控迭代（quiet provider 仍被撤权/过期中断，清理时归还迭代器），钳制仅在请求**显式超界**时要求；(3) bot-settings 的 compiledGrant 从目录 capabilities 取工具，目录初始为空导致授予缺 `model/infer`（`TOOL_DENIED`）——目录提供 model-inference/mr-routing 两个能力（精确对应默认产品面）。
- N06b 验证（本机 Win11/Node24.20.0）：默认探针 **14/14**（配置先行 3 项 + 原 11 项中的 10 项 + 预算拒绝零分派 + 冷启动）；model-accounting 原生 **14/14**（新增冻结请求准入 + 租约门控 quiet provider 回归）；完整根套件 1382 项、1379 通过、0 失败、3 跳过。证据：[N06b 统一准入](evidence/20261027_m7_bot_funding_admission.json)。
- 2026-10-27（续 5）：N07（usage 投影）完成并验证——`product-composition.mjs` 新增 usage 只读提供器：按已提交 Bot 经 `store.modelCalls` 游标分页读取持久收据，用共享 `actualCost` 计算逐条金额（用量/价格未知保持 null，未运行才为 0），summary 汇总 apiUsd/reservedUsd/unknownCount 与订阅调用次数（来自 funding 投影）；read-model 六分区中五个 available（bindings/botBindings/fundingAccounts/machines/usage），tasks 仍 blocked。客户端来源标签统一为收据词表（bot/aux/mr-api/cli/review），出厂 bundle 重建（2,055,661 字节）且 `check:client` 通过。
- N07 验证（本机 Win11/Node24.20.0）：默认探针 **15/15**（新增"usage 投影显示逐来源收据、精确模型与资金汇总，未知金额保持 null"——断言存在 bot/aux 两类来源收据、金额 >0 或 null、billing=api、summary.apiUsd>0）；完整根套件 1382 项、1379 通过、0 失败、3 跳过；UI/组合测试 11/11。证据：[N07 usage 投影](evidence/20261027_m8_usage_projection.json)。
- 2026-10-27（续 6）：N08（探针收据断言）完成并验证——默认产品 Bot 经真实 owner 动作配好资金范围与 Main/Worker 绑定后，worker 的 MR 咨询走统一准入：**恰好一条关联收据**（source `mr-api`、usage 11/5 未被重复计），且逐来源收据总额与 funding 汇总一致（不双记账）。
- 为此修复三处真实宿主暴露的接线缺陷：(1) 咨询的模型调用不带 sessionId，factory 的身份解析改为经策略的可信上下文（ALS 执行帧）；(2) 组合的 accountStream 包装层在记账前把 MR 执行帧内的直接调用标记为托管，关联原运行发票；(3) 组合向 ctx 提供 `botFunding`，MR 咨询路径经同一绑定投影路线，运行包携带绑定价格而非未知费用包（此前未知费用会使后续准入全部 MODEL_WAITING_BUDGET）。
- N08 验证（本机 Win11/Node24.20.0）：默认探针 **17/17**（新增"MR 咨询恰好一条关联收据、收据与资金汇总一致"）；针对性测试 12/12；完整根套件 1382 项、1379 通过、0 失败、3 跳过。证据：[N08 MR 咨询收据](evidence/20261027_m9_mr_consult_receipts.json)。
- N09（Task/CLI 默认接线，即任务 7）随后。
- 2026-10-27（续 7）：W01.4（40 组入口审查）完成——behavior-audit.json 增至 37 条记录、覆盖全部 40 个功能组（新增 E23–E37：DS 的记忆/MCP/连接器/浏览器/网页搜索/计划任务/侧聊/语音/问答视图，MR 的安装设置/计划/预设/动态数据/评分/健康诊断；DS 组为迁入上游单组件级 + 冻结源，MR 组为根单套 + 离线宿主探针级，均如实记录 remaining）。M0 记录子步骤 10/12。
- 最终全量验证（本机 Win11/Node24.20.0，全部重跑通过）：完整根套件 1382 项/1379 通过/0 失败/3 跳过；`integration:check` 有效；文档/清单/进度测试 25/25；资金探针 33/33（含冻结请求回归）；默认产品探针 17/17；product-host 4/4；combined-host `--tasks` 9/9、`--legacy-policy` 9/9；remote-machines 通过。工作树无遗留临时脚本。
- 剩余未完成（下一轮）：N09 Task/CLI 默认接线（设计见上，需先定论 backend 按模型固定的问题；真实 codex 入口本机受阻）；初始 Task/outbox 与资金单事务准入；缺收据人工核对 UI（unknown 收据的厂商账单核对放行，需改收据/运行状态机并留痕）；三机复跑；默认用户配置迁移；发布门禁（Electron/干净安装/打包字节核对）。
- N09 实施设计（下一轮执行前需定的决策点）：
  1. **Task Service 接线层**：严格组合（tasks-plugin fixture）的参考接法是在同 ctx 的 fixture 插件里 `openTaskJournal` + `createTaskService({journal,authority,directory,within:policy.executionContext,backends})` + `registerTaskTools`。默认产品应在组合 boot（或 apply 同步段）内完成同一接线，journal 与 funding store 共用 `orchestration.sqlite`；read-model 的 tasks 分区与 task.cancel/retry/reconcile 动作由组合提供（provider 为 late-bound 引用，同 machines 模式）。
  2. **backend 按模型固定的设计问题**：`createMrReadBackend`/`createCliReadBackend` 的 target hash 含 model/billing/pricing/entry/workspace 等，且 `admit()` 用 `backend.model` 校验主体授予——单 Bot 单模型可直接建一个 backend；多 Bot 多模型需要“按绑定模型建 backend 并在绑定变化时重建 service”，或把 model 改为运行期从绑定解析（改动 target 契约，影响 T34/T35 既有证据）。**需先定论再动手**。
  3. **CLI 入口解析**：entry（{executable,sha256,version}）必须来自安装验证过的官方工具注册表（`pinCodexExecutable` 复核 sha256 与 --version），不能来自 Bot 入参或任意路径；settingsCatalog 的 models.cliModels 需要真实 codex 模型目录核验后填充。
  4. **真实 codex 受阻**：本机 codex-cli 0.157.1 的 app-server 在任何隔离 home 下无法初始化 sqlite state（见 N05/N06 记录），产品探针无法跑真实 CLI 回合；CLI facade 的产品接线只能以假 session factory 做契约级验证，真实回合留待取得可用入口。
  5. **远程 CLI 位置契约**：facade.prepare 对 location!=='local' 直接 fail（CLI_TARGET_MISMATCH），远程 CLI 经远程机器 shell 执行的路径按方案留待 W12，本轮只记录契约。
- 本轮日志为 `resume-targeted-initial.log`、`resume-joint-initial.log`、`resume-full-baseline.log`、`resume-integration-check-baseline.log`、`resume-client-baseline.log`，位于被忽略的 `tmp/integration/m0-20261027/`；公开证据只在核对后新增，不改写历史证据。
- 2026-10-27（续 8）：**N09（Task/CLI 接入默认产品）完成并验证**——组合 boot 在同库打开 Task journal（共享 `orchestration.sqlite`），创建一个 Task Service（`within` 即共享策略的执行上下文），注册有界 `bot_task_*` 工具并在 dispose/boot 失败链中释放；read-model `tasks` 分区按 Bot 分页持久 journal 并附后端目录；owner 动作 `task.cancel/retry/reconcile` 运行在归属 Bot 自身主体上（授权来自 Bot 已提交授予，而非浏览器会话）。
- **N09 设计定论（队列决策点 2）**：后端目标契约按类型固定（`mr-api`、`codex-read`），执行目标、模型与资金在运行期从提交 Bot 的绑定解析。绑定变更不会改写已持久化的 target hash：旧任务的重试与核对依然可准入，每个 Bot 按自己的配置价格计费；绑定是授予与资金的唯一来源，因此服务层不再重复模型校验。CLI 后端仅在宿主声明安装核验过的入口（executable/sha256/version）与已核验 CLI 模型身份时存在；未配置时目录不暴露 codex 工具、模式或 cliModels，Bot 绑定无法选择未核验的 CLI 身份。
- **N09 关键设计**：runner 租约 10s + 心跳续约；崩溃未释放租约的旧宿主会阻塞新宿主认领直至租约到期，boot 有界等待（12s）后 fail-closed，避免丢弃全部托管任务。
- **N09 验证（本机 Win11/Node24.20.0，全部重跑通过）**：默认产品探针 **25/25**（新增 7 项 N09 检查：MR 任务成功一次尝试一条关联 run、失败任务重试加关联尝试后成功、运行中任务可取消且终态保留原 run 引用、跨 Bot 读写拒绝、仅获授 CLI 能力的 Bot 可提交 CLI 后端、CLI 契约任务写自己的关联 run 并在 owner 核对前保持 unknown 且 owner 动作幂等、托管收据落入单一资金权威且未确认收据被挡在支出合计之外计为 unknown、未确认收据令其 Bot 零分发拒绝）；`snapshotSections` 六分区全部 available（tasks 由 blocked 转 available）；完整根套件 **1385 项、1382 通过、0 失败、3 跳过**；组合套件 10/10（新增 normalizeTaskCli/createTaskBackends 契约测试）；闭包 20/20（files 252 项）；combined-host `--tasks` 9/9（含崩溃恢复核对）、`--legacy-policy` 通过；finance 33/33；product-host 4/4；remote-machines 通过；`integration:check` 有效；`check:client` OK。证据：[N09 Task/CLI 默认产品](evidence/20261027_m10_task_cli_default_product.json)。
- **N09 修复（真实宿主暴露）**：(1) 组合使用 `dirname` 但未导入，产品宿主在任何服务打开前中止；(2) 探针原经 Bot 自己的 AgentLoop 驱动核对，但未确认收据 fail-closed 该 Bot 的模型回合——恢复改走真实 owner 动作（归属 Bot 主体）；(3) 收据与汇总一致性断言把未确认收据的用量两边都计入——已确认收据与支出合计对齐，未确认金额单独断言为 unknown。
- 剩余未完成（下一轮）：**本机可做的工程缺口只剩依赖调度器**（W07.2 Planner 选目标 Bot 与计划校验、W08.5 依赖失败阻塞下游/独立分支/整树取消——T08/T09/T11/T12 的共同前提；T11 另依赖尚未放行的写执行 facade）。其余均需用户侧条件：N11 三机复跑、W15.2/W16 Win10/Win11 实机桌面、W20 发布与下载字节核对、W03.4 默认用户配置迁移实测、真实 codex 入口安装核验决策。把场景推到 passed 的产品级验收（真实机器/真实推理/干净安装）同样属用户侧。
- 2026-10-27（续 14）：**证据清点第二轮**——再把 12 个已有真实证据但未挂接的场景挂上证据、层级与精确剩余说明：T02 单一产品入口、T44 长期记忆与历史、T45 计划任务、T46 原交互能力回归、T51 可选发行载体、T53 UI 可用性与离线、T56 支持声明与证据审计、T61 冻结基线与增量纳入、T62 研发与产品角色分离、T39 订阅计量与回退、T41 质量复核与用户评分（T59 公网鉴权抗滥用经核对无现成实现证据，未挂）。挂接时修正了一处笔误产生的无效证据路径。验收场景累计 **1 passed / 45 partial / 17 not_run**， 与文档测试保持通过。
- **17 个 not_run 的定性**：T08/T09/T11/T12 共同依赖尚未实现的依赖调度器（本机可做的最后工程缺口，W07.2/W08.5；T11 另依赖尚未放行的写执行 facade）；T14 远程断网、T29/T30 桌面实机、T35 远程 CLI、T36 十二工具回归、T37 真实 PTY、T42 worktree 合入、T47 能力包/秘密/连接器、T50 干净安装、T52 发布字节、T54 性能配额、T58 预览版合同、T59 公网鉴权抗滥用——分别需要第二台机器、真实桌面/PTY、真实 CLI 入口、安装与发布授权或公网暴露面验收，属用户侧条件或未实现的执行面。
- 2026-10-27（续 10）：**缺收据人工核对（owner 解决路径）完成并验证**——`sqlite-router-state.mjs` 新增 `resolveUnknownPackage`：在同一个 CAS 事务内按 owner 决定处理未确认工作包（`attest` 带厂商确认金额或 `waive` 按零费用放行，均需留痕说明），并释放中断执行留下的预占（该预占同时贡献估算金额与 unknown 计数，是 Bot fail-closed 的直接原因之一）；解决记录写在 run 自身上，提交摘要链即审计链，不引入第二个资金写入方。活动中的预占一律拒绝由核对解决；跨 Bot 越权在所有权校验处即被拒。
- 组合层新增 owner 动作 `usage.resolve`（仅组件可用时注册）与 usage 只读分区扩展：`unresolved` 列出可核对的未确认工作包（botId/runId/packageId/计费/用量），逐条收据附 `resolution`（kind/costUsd/note/resolvedAt），已确认收据与支出汇总对齐、未确认金额不再重复计入。
- 验证（本机 Win11/Node24.20.0，真实模型请求 0）：新增原生套件 `tests/unknown-receipt-resolution.native.mjs` **7/7**（waive/attest、所有权、重复解决、活动预占拒绝、中断预占随核对释放、跨连接持久化）并进入 `npm test`；默认产品探针 **26/26**（新增"owner 经真实 owner 动作解决未确认收据；waive 在 run 上留痕且 Bot 恢复支出"，含跨 Bot 越权与同 Bot 重复解决均被拒、unknownCount 归零、收据与汇总一致）；完整根套件 **1392 项、1389 通过、0 失败、3 跳过**；`integration:check` 有效；N09 证据已同步（26 项检查、新 blob 与回归数字）。
- 2026-10-27（续 9）：**N10（CI、package files、行为审计与公开证据）完成**——新增测试全部进入自动检查：5 个原生资金套件与组合契约测试（`normalizeTaskCli`/`createTaskBackends`）随 `npm test` 运行，`integration-product-default`（25 项，含 N09 七项）、`integration-cli-execution`、`integration-cli-native`、`integration-remote-machines` 已在 CI integration-host 作业；`package.json` files 闭包按新导入链补入 11 个模块（task-journal/task-service/task-tools/mr-read-backend/cli-execution 及 cli-runtime/capability-broker 依赖），闭包测试 20/20（252 项）；证据按组件/宿主/真实推理分级（`level` + `actualModelCalls: 0`），新增 [N09 证据](evidence/20261027_m10_task_cli_default_product.json) 并接入 W08/W11.2 台账与 E20 行为记录。
- 2026-10-27（续 11）：**缺收据人工核对的客户端页面完成**——usage 页将可核对的未确认工作包渲染为卡片（必填核对说明 + 可选厂商确认金额 + “按厂商账单确认/按零费用放行”两个门控动作），收据行按解决记录显示标签（已按零费用放行 / 已确认金额）；`Usage` 组件接入 `dispatch`/`busy`，出厂 bundle 重建为 2,059,617 字节，`check:client`、product-client `--check`（118 输入）与 product-source（297 文件）通过。
- 页面验证（本机 Win11/Node24.20.0，真实模型请求 0）：`tests/bot-runtime-ui.test.mjs` **5/5**（新增“未确认收据的核对卡片与已解决收据的审计标签”：卡片数据、必填说明门控、解决后无核对表单）；完整根套件 **1393 项、1390 通过、0 失败、3 跳过**。说明：该测试骨架在 DOM 安装前导入 React，React 的 input 事件支持探测因此为否，jsdom 下文本输入不触发 onChange（click 不受影响），故页面测试只覆盖渲染与门控；解决动作的载荷与资金语义由默认产品探针（26/26）与原生套件（7/7）覆盖。
- 2026-10-27（续 12）：**绑定 maxConcurrentTasks 兑现完成**——Task Service 新增 `concurrencyFor`（每 Bot 并发上限），组合把已提交绑定的 `maxConcurrentTasks` 传给它；目标契约仍按后端类型固定，并发变更不改写已持久 target hash；未配置 Bot 或超出 1..32 的答案一律回退保守的单任务默认，不会 fail-open。
- 验证（本机 Win11/Node24.20.0，真实模型请求 0）：`tests/cli-execution.native.mjs` **10/10**（新增"默认保持每 Bot 一个活动任务、二任务绑定同时分派两个且均可取消"）；默认产品探针 **28/28**（新增"maxConcurrentTasks 2 时同一 Bot 同时运行两个托管任务"与"两个并发任务均可经 owner 动作取消"）；完整根套件 **1394 项、1391 通过、0 失败、3 跳过**。N09 证据已同步（28 项检查、18 个源 blob 全部核对）。
- 2026-10-27（续 13）：**验收场景证据归集与台账语义厘清**——对 63 个场景清点证据，把已有真实证据的 10 个场景（T03/T04/T05/T06/T07/T10/T13/T15/T32/T55）挂上证据、层级与精确剩余说明，未超出证据覆盖提升状态；4 个真缺口（T08 环路/悬空依赖拒绝、T09 依赖失败与独立分支、T11 工作区写入互斥、T12 整树取消）显式记入台账。施工包子步骤同步：W02.5、W04.1、W05.1、W05.2、W07.1、W08.1–W08.4 完成并挂证据，W07.2/W08.5 记 planned。M0 记录子步骤 11/12；验收场景 1 passed / 34 partial / 28 not_run。
- **台账语义（决定后续施工判据）**：施工包 completed 要求其全部验收场景 passed，非 M0 施工包还要求 M0 四门禁完成。因此交付物已验证的包仍保持 in_progress；把场景推到 passed 需要真实机器/真实推理/部署授权等产品级验收，多属用户侧条件。
