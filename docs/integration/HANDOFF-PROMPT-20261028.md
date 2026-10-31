# 交接提示词（2026-10-28）

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


> 最新E45–E47：根1479/0fail（Windows1476pass/3skip、Ubuntu1455pass/24skip），默认36、配置6，双Windows19真实GUI；helper全局仲裁/取消撤权和私有路径API已实现。新profile只读规划由GPT子代理继续，完整apply/数据/回退未实现。以HANDOFF顶端及新证据为准，不重复旧1446基准或发布。

> 用法：把下面「提示词正文」整段复制，交给下一位开发者或 AI 代理。工程目录与文档路径已写死，无需额外交代。

---

## 提示词正文（复制以下全部）

你是 DSH Bot 一体化工程的接手开发者。

**工程根目录**：`F:\everyAI\dsh-model-router-all\dsh-model-router`（分支 `feat/bot-integration`，HEAD `89e831264ebc7dacacdd54234377e51f37fb0785`，全部工作未提交）。

**交接文档（先完整读它，这是本工程现状的唯一来源）**：
`F:\everyAI\dsh-model-router-all\dsh-model-router\docs\integration\HANDOFF-20261028.md`
（已追加同日 GPT 调度器检查点；在工程内的相对路径为 `docs/integration/HANDOFF-20261028.md`）

**第一步（必做，按顺序，不要跳过）**：

1. `git status` 确认工作树完好（原有工程 + 调度器 + 新证据，另含被忽略的 `modules/bot-runtime/vendor/ds-bot`）。**禁止 reset / clean / stash，禁止只拿 HEAD 或只拿 diff**——未提交工作树就是工程主体。
2. 完整阅读上面给出的交接文档全文。它是本工程现状的唯一来源，优先于 `PROGRESS.md`、`HANDOFF.md`、`HANDOFF-20261027-GPT.md` 及历史证据中关于"当前状态"的描述。
3. 跑该文档 §8 的复跑命令，确认能复现同样数字再动手。最新基准：`npm test` 1446 项 / 1443 通过 / 0 失败 / 3 跳过；默认产品 36/36；调度原生 14/14；journal/依赖/核对联合 52/52；资金 33/33；本轮 `actualModelCalls: 0`。**1399/1396、28/28 是施工前基线，1414/34 也是本日较早检查点。**

**用户已确认的验收条件**：Win10与Win11均可提供登录、解锁的交互桌面和专门可见测试窗口；只操作fixture，不重复询问。基础真实helper已按E44在Win10/Win11各跑8项（100%/150%），清理通过。继续全局桌面仲裁/输入效果/停止矩阵与完整迁移，不重复做可用性问询。最新E43：三机源865、原生44、根1446、鉴权10、默认36均通过；历史E42数字只证明前一检查点。

**你的任务**：继续 W03.4/W06 完整配置与数据迁移、回退以及主方案剩余施工包；E42 当前三机根/默认宿主/原生/客户端已通过，实际安装/网络/桌面/推理与完整场景仍待验收，不能缩减范围。Task/outbox 与资金原子准入已实现并验证，先读 `docs/integration/evidence/20261028_atomic_task_admission.json` 与设计。schema4/同一资金句柄借用/Host-only帧/admitting/提交前后进程退出恢复、取消撤权期限和CAS竞争不可回退；新原生套件 `tests/task-admission.native.mjs` 20/20，默认宿主36/36，根1435/1432通过/3跳过。新Linux/Win10复跑和实机/完整迁移、真实推理等仍待验收。

计划校验层和依赖调度器主体已经交付，不要重做。journal schema 已是 4，资金连接也兼容 4；新调度器套件 `tests/task-plan-journal.native.mjs` 14/14。最新证据在 `docs/integration/evidence/20261028_dependency_scheduler_cold_replay.json`，20 个源 blob 已逐个核对；前一证据保留，不改历史数字。

必须保留 T09/T11/T12 的既有依赖/取消/未知停止/重启行为。T11 只做到锁协议，写 facade 仍拒绝，实际写工作区退出和混合原生 CLI/远程取消树未验。按约定 W08.5 仍 planned 并挂证据，W07.2 in_progress，整个工程仍未完成。

**硬边界（违反即返工）**：

- 用户已于 2026-10-28 授权“全部弄好了就上传 GitHub 和 npm”：完整工程实现并验证后直接执行提交/推送/发布及产物核验，不重复询问。当前未完成，不提前发包；只 stage 核实属于本工程的路径。
- 不改冻结 DS vendor（`modules/bot-runtime/vendor/ds-bot`，297 文件字节级核对）与 SDK；适配在外层。
- 所有验证 **0 真实模型请求**（用离线 fixture 替身）；真实推理验收由用户执行，不要伪造。
- **未验证不标 completed**。施工包标 `completed` 的硬门槛见交接文档 §9.1：要求其全部验收场景 `passed`、全部子步骤 completed、依赖 completed，且非 M0 包另要求 M0 四门禁 completed。
- 改 `tasks.json` / `behavior-audit.json` 前必读 §9.1：这两个文件是 **CRLF + 两空格缩进**，`package.json` 是 **LF**；证据路径必须是可移植相对路径且指向真实文件（写错会让 `integration:check` 直接失败）。
- 临时脚本一律写 `.mjs` 文件，**不要内联 `node -e`**（Windows 下反斜杠/引号会被吞，这个坑踩过多次）。
- 每完成一项按交接文档 §11 的 7 步同步台账与文档，缺一项即未完成。

**完成定义**：代码 + 测试/探针 + `docs/integration/evidence/` 新证据文件（`sourceGitBlobs` 用 `git hash-object <file>` 逐个核对）+ `tasks.json` + `behavior-audit.json` + `PROGRESS.md` + `EXECUTION-20261027.md` + `STATUS.txt`（用 `node scripts/integration-progress.mjs report` 生成，不要手改）+ `npm run integration:check` 与文档测试通过。

**之后的剩余工作**：T59 公网鉴权抗滥用，以及 §7.2 的环境/授权矩阵。先检查实际 Host/Agent 接入点和已有实现，避免重复或削弱认证。第二台机器、真实桌面/PTY/CLI、安装与发布条件不得假装通过。

遇到阻塞先查交接文档 §9 踩坑（10 条代码坑 + 7 条机械规则）；仍有疑问问用户，不要猜。

---

## 附：给用户的一句话

把上面「提示词正文」整段发给接手方即可；先读最新交接与原子准入设计，保留已验证的调度器并继续下一项。
