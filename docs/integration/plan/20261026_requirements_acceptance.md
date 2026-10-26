# 功能并集、需求追踪与验收矩阵

版本：1.1｜2026-10-26｜配套：[完整实施方案](20261026_master_plan.md)。

本表是最终交付合同的设计基线。R 为产品需求，F 为现有能力分组，T 为验收场景。所有 R 都属于完整版本的必选项；MVP/预览仅代表阶段进度。表中的“保留”不代表已迁入，“通过条件”不代表已执行。

## 1. 原构想的完整追踪

| ID | 必选需求 | 原方案对应 | 落地模块与里程碑 | 主要验收 |
|---|---|---|---|---|
| R01 | 默认只私聊 Main，自动派活并回主会话 | §3、§9、§11 | bot-runtime/task-service，M3 | T06、T07、T13 |
| R02 | 可选工作群、管理员、@、群进度与共享记忆 | §3、§8、§11 | groups/memory/task，M1/M6 | T43、T44 |
| R03 | 同模型多个 Bot 分职，身份和私有数据分开 | §3、§7、§12 | Bot identity/policy，M2 | T04、T05、T25 |
| R04 | 每 Bot 精确模型，禁止不可见替换 | §3、§8、§9 | models/execution，M2/M5 | T03、T32、T56 |
| R05 | 官方工具按 Bot 绑定，保留注册表既有能力 | §3、§5、§6 | cli-runtime/policy，M5 | T05、T32–T37 |
| R06 | DeepSeek 使用宿主 Harness，不新增专用 CLI | §3、§5、§11 | Bot 原生 Session，M2 | T03、T06、T55 |
| R07 | 用户 Linux 机可执行命令，带 cwd、超时与取消 | §4、§11 | agent/shell，M4 | T12、T24、T25 |
| R08 | 远程文件列举、读取、写入与输出回传 | §4 | agent/fs/artifacts，M4 | T20–T23 |
| R09 | Linux/Windows 无头浏览器与按 Bot 隔离 | §4、§11 | agent/browser，M6 | T26、T27 |
| R10 | Win10/Win11 登录桌面的截屏、键鼠与清楚错误 | §4、§10、§11 | desktop-helper，M7 | T28–T31、T50 |
| R11 | 用户自备 URL/Token/网络，不绑定个人机器 | §4、§13 | machines/pairing，M4 | T16–T19、T50、T57 |
| R12 | Capabilities 登记、Bot 授权、秘密引用与能力包 | §3、§4、§8 | capabilities/broker，M2/M5 | T17、T33、T47 |
| R13 | 高风险审批、撤权、谁在何时做何操作的审计 | §4、§12 | policy/approval/audit，M2/M4 | T05、T17、T18、T31、T59 |
| R14 | 保留路由建议、成本预览、质量与学习设置 | §2、§6、§13 | planner/advanced UI，M3/M6 | T38、T41、T55 |
| R15 | API 金额与订阅次数/token 分账，未知不当零 | §5、§12 | accounting，M2/M5 | T38–T41、T60 |
| R16 | 任务进度、失败详情、重试/改派与恢复 | §6、§9、§14 | task-service/UI，M3 | T12–T15、T53 |
| R17 | 保留安全的可编辑 worktree 与条件合入 | §2 功能并集 | execution/workspace，M4/M5 | T11、T35、T42 |
| R18 | 持久任务状态、依赖、去重与结果未知处理 | §9、§14 | SQLite/outbox/operation store，M2/M3 | T07–T15 |
| R19 | DS 风格统一 UI，MR 能力进设置/高级 | §2、§6、§11 | DS client/MR UI，M1/M6 | T02、T53 |
| R20 | 两仓能力并集，任何原有能力不能静默消失 | §2、§6、§11 | F01–F40，全阶段 | T36、T44–T56、T61 |
| R21 | 单向迁移、单一 writer、旧数据可恢复 | §7 | migration/store，M2/M8 | T48、T49 |
| R22 | 单一最终仓和 DSH 插件身份 | §1、§2、§7 | package/loader，M1/M9 | T01、T02、T52 |
| R23 | 同仓 agent 安装包、Linux/Windows 配置引导 | §4、§11 | packaging/install，M4/M7/M8 | T50、T52 |
| R24 | 机器健康、鉴权错误、版本协商与断网可读 | §4、§14 | machines/transport/errors，M4 | T14、T16–T19、T30 |
| R25 | Bot 长期记忆、群记忆、历史与续接完整保留 | §2、§3、§6 | memory/parts/index，M1/M6 | T04、T43、T44 |
| R26 | 语音、侧聊、引用、附件、交互视图等原有体验 | §2 功能并集 | DS client/host，M6 | T46、T47、T53 |
| R27 | 并发可控、写资源互斥、计划任务可恢复 | §9、§14 | scheduler/resource leases，M3/M6 | T09–T13、T31、T45 |
| R28 | MCP、skills、连接器与旧工具/RPC 的兼容 | §2、§3、§8 | broker/compat facade，M1/M5 | T01、T33、T47、T55 |
| R29 | 应用层隔离和强隔离如实区分，严格配置可验收 | §11、§12 | sandbox/worker profiles，M2/M8 | T04、T05、T21、T25 |
| R30 | 资源限额、可靠取消、健康和性能可测 | §4、§14 | agent/Host limits，M4/M8 | T10、T12、T24、T54 |
| R31 | Release、兼容表、安装/升级/回退与运维文档 | §2、§7、§10、§11 | packaging/docs，M8/M9 | T48–T52、T56、T58、T63 |
| R32 | 模型调用仅 GPT，测试证据与支持声明真实 | 用户长期偏好 | 全部研发与验收，M0–M9 | T56、T62 |

原方案 §13 的实现选择由主方案确定：Linux 常开主机优先；群模板提供为可选；工作台保留高级入口；最终仓收束；路由输出 Bot；agent 采用 TS 协议主体加 Windows 原生 helper；GALGame 保持原排除范围。

## 2. 两仓用户能力的迁入与保留清单

来源约定：DS 路径相对 `ds-bot/`；MR 路径相对项目根。此表按用户行为分组，M0 需要继续展开到具体端点、参数、入口和证据，不能把分组总数当作已经完成的全量源码 diff。

| ID | 用户能力 | 已核对的主要来源路径 | 处理方式及统一入口 | 验收 |
|---|---|---|---|---|
| F01 | Bot 创建、重命名、职责、颜色/头像、复制和归档 | DS `src/host/roster.js`、`src/client/bot-settings.js` | 迁入；Bot 列表/详情与 Main 管理工具 | T02、T04 |
| F02 | Main 管理 Bot 和群，直接对话配置 | DS `src/host/prompt.js`、`src/host/tools.js` | 改；保留管理体验，机器授权另经 Policy | T06、T17 |
| F03 | 私聊派活、追加信息、排队和回传 | DS `src/host/handoffs.js`、`delivery.js`、`requests.js` | 改；消息与统一任务记录关联 | T06、T07、T15 |
| F04 | 群创建、成员、管理员、@ 与工作状态 | DS `src/host/groups.js`、`src/client/group-settings.js` | 迁入；群界面复用同一任务系统 | T43 |
| F05 | Bot/群记忆编辑、清理、持久化 | DS `src/host/memory.js`、`memory-pending.js` | 留/改；访问主体与操作审计统一 | T04、T44 |
| F06 | 长对话分段、压缩、历史检索与恢复 | DS `src/host/parts.js`、`chat-index.js`、`resume.js` | 留；换 Session 保持稳定 Bot 身份 | T13、T44 |
| F07 | 每 Bot 模型与思考级别 | DS `src/host/models.js`、`src/client/model-menu.js` | 改；严格模型与可见兼容策略 | T03、T32 |
| F08 | 工作目录、文件夹和权限 preset | DS `src/host/folders.js`、`permissions.js` | 改；统一 workspaceRef 和策略交集 | T05、T20、T25 |
| F09 | MCP/skill/pack 的保存、启用和状态 | DS `src/host/capabilities.js` | 迁入/改；设置→Capabilities | T33、T47 |
| F10 | 秘密申请、输入卡、范围与替换 | DS `src/host/secrets.js`、`src/client/secret-card.js` | 留/改；机器凭据也走同一秘密入口 | T16、T17、T47 |
| F11 | GitHub 连接器与登录/断开状态 | DS `src/host/connectors.js` | 留/改；Bot 授权及 token 脱敏 | T47 |
| F12 | 浏览器会话、profile 与浏览器面板 | DS `src/host/browser.js`、`browser/session.js`、`src/client/browser-pane.js` | 迁入；本机与远程位置清楚区分 | T26、T27 |
| F13 | 浏览器 refs/script/task 插件及下载控制 | DS `src/host/browser-plugins.js`、DS 根 `browser-plugins/` | 留/改；可执行脚本独立授权 | T27 |
| F14 | 网页搜索 provider 与出错恢复 | DS `web-search.js`、`src/host/providers.js` | 留；保留宿主/插件兼容配置 | T01、T56 |
| F15 | 计划任务与会话归属 | DS `src/host/schedules.js` | 留/改；每次触发重新准入，绑定稳定 Bot | T45 |
| F16 | 侧聊、旁路讨论、对话引用 | DS `src/host/side.js`、`btw.js`、`src/client/read-page.js` | 迁入；上下文访问与额外费用可追踪 | T44、T46 |
| F17 | 语音输入/语音模式 | DS `src/client/voice.js`、`speech.js`、`composer.js` | 留；沿用宿主或浏览器可用引擎 | T46、T56 |
| F18 | 问答卡、交互图表/视图与内联展示 | DS `src/host/tools.js`、`src/shared/views.js`、`src/client/widget-*.js` | 留；受认证用户输入与工具调用分开 | T46、T53 |
| F19 | 图片、附件、长消息与文件引用 | DS `src/host/images.js`、`delivery.js`、`links.js` | 留/改；接统一产物访问检查 | T23、T44、T46 |
| F20 | 按 Bot/模型/时间查看 Token 用量 | DS `src/host/usage.js`、`src/client/usage-page.js` | 改；从唯一 receipt 投影，避免重复 | T40 |
| F21 | 主题、语言、侧栏、审批提示与诊断 | DS `src/client/themes.js`、`i18n.js`、`src/host/diagnostics.js` | 迁入；统一设置和任务提示 | T02、T53 |
| F22 | 独立桌面、Docker/Web 与数据位置配置 | DS 根 `app/`、`docker/`、README | 迁入发行能力；同一业务插件的可选载体 | T50、T51 |
| F23 | 本地任务分析、复杂度与单/团队计划 | MR `.dsh-plugin/shared/router.mjs`、`harness-plan.mjs` | 留/改；Main 计划与高级工作台共用 | T06、T08、T55 |
| F24 | 精确路线档案、价格/质量/思考/计费偏好 | MR `.dsh-plugin/shared/model-profiles.mjs`、`reasoning-execution.mjs` | 留；设置→模型/路线 | T03、T32、T38 |
| F25 | 省钱/均衡/质量预设、搜索与质量下限 | MR `.dsh-plugin/shared/assignment-solver.mjs`、`routing-presets.mjs` | 留/改；在合法 Bot 候选中推荐 | T06、T38、T41 |
| F26 | 动态价格/质量数据与数据来源状态 | MR `.dsh-plugin/shared/dynamic-data.mjs`、`livebench.mjs` | 留；高级→路由数据 | T55、T56 |
| F27 | 手动工作包分配、显式 API 或 CLI 选择 | MR `.dsh-plugin/shared/package-assignments.mjs`、`manual-plan.mjs` | 留；高级手动计划，Bot 路径受白名单 | T05、T32、T55 |
| F28 | 十二工具检测/安装/更新/修复/卸载与日志 | MR `.dsh-plugin/shared/official-tool-registry.mjs`、`official-tools-runtime.mjs` | 留；工具页，远程位置独立登记 | T35、T36 |
| F29 | 安装来源、可信入口、原生发行校验 | MR `.dsh-plugin/shared/npm-attestation.mjs`、`zcode-bundle.mjs`、`tool-install-preferences.mjs` | 留；继续保留当前信任边界的真实说明 | T36、T52、T56 |
| F30 | 本机 shell/CLI 终端、登录、多会话 | MR `.dsh-plugin/shared/cli-terminal.mjs`、`.dsh-plugin/client/cli-terminal.jsx` | 留；高级终端，保持人工独立通道 | T37 |
| F31 | 只读路由、咨询与官方 CLI 任务执行 | MR `.dsh-plugin/shared/task-executors.mjs`、`.dsh-plugin/index.mjs` | 留/改；统一执行 facade 和账本 | T32、T38、T55 |
| F32 | 可编辑 CLI 团队、沙箱/原生环境和 worktree 合入 | MR `.dsh-plugin/shared/official-team-runtime.mjs`、`security-boundaries.mjs` | 留/改；按 Bot/机器授权，保留高级模式 | T25、T35、T42 |
| F33 | 后台进度、取消和任务结果读取 | MR `.dsh-plugin/shared/run-jobs.mjs`、客户端 run-launcher | 改；关联持久 Task，兼容旧 job 响应 | T12、T13、T53 |
| F34 | 历史、失败详情、重跑/改派和执行检查点 | MR `.dsh-plugin/shared/execution-lifecycle.mjs`、`run-ledger.mjs` | 留/改；旧历史可读，新 attempt 不覆盖旧费用 | T13–T15、T40 |
| F35 | API 金额预算、预占与并发准入 | MR `.dsh-plugin/shared/budget-reservations.mjs`、`execution-accounting.mjs` | 改持久适配；逻辑与未知语义保留 | T38–T40 |
| F36 | 订阅优先/only、次数/token、冷却与回退选择 | MR `.dsh-plugin/shared/subscription-billing.mjs`、`subscription-usage.mjs` | 留/改；严格 Bot 默认暂停，高级显式策略保留 | T39、T40 |
| F37 | 用户评分、自适应偏好、复核与质量升级 | MR `.dsh-plugin/shared/adaptive-feedback.mjs`、`quality-gates.mjs` | 留；复核费用纳入预算和独立证据 | T41 |
| F38 | 安装向导、健康/诊断与执行边界展示 | MR `.dsh-plugin/shared/tool-health.mjs`、`error-diagnostics.mjs`、客户端设置 | 留/改；统一引导，位置与权限可读 | T19、T36、T53 |
| F39 | 会话命令、model_router 工具与客户端 RPC | MR `.dsh-plugin/index.mjs`、`official-tools-remote.mjs` | 留 facade；所有入口统一鉴权和计量 | T05、T55 |
| F40 | 新增机器、远程 agent、CLI 能力桥接与 Windows 控机 | 原方案 §4；两仓通用 MCP/CLI 基础 | 新建；机器页与 Bot 授权、同仓发行 | T14–T35、T50、T52 |

M0 每个 F 还要登记当前可用平台与限制，不能把“安装可用”提升成“所有模式自动执行可用”。

## 3. 验收场景与可观察通过标准

| ID | 场景 | 通过标准与证据 |
|---|---|---|
| T01 | 固定 DSH 下迁入 DS 与 MR | 插件启用、agent/session/tools/审批/MCP/search/client 生命周期均能加载；记录宿主版本和错误日志 |
| T02 | 单一产品入口 | 一个插件配置入口、一套 Bot/群、一致侧栏；原 MR 高级入口可达；截图含宽窄窗口 |
| T03 | 严格模型不可用 | 配置模型失效/移除/缺密钥时明确暂停；零调用其他模型；修复后仍用原模型 |
| T04 | 同模型两个 Bot 的私有状态 | A/B 私聊、memory API、Session 轮换、CLI profile 与受限目录互不可读；显式分享的任务输入除外 |
| T05 | 白名单与旧入口越权 | 伪造 botId、直接 RPC、旧 model_router 工具、PTC 子调用和重跑均不能调用未授权工具/路线 |
| T06 | Main 无群端到端 | 私聊 Main 完成分析→实现→评审→汇总，子 Bot 使用各自模型、结果与文件回原会话 |
| T07 | 同一派活重复投递 | UI 重发、message_bot 重复、重连后 replay 均指向原任务；实际 attempt 数不增加 |
| T08 | 非法计划 | 环路、悬空依赖、重复 id、无目标 Bot、夹带不可接受字段在任何执行前被拒绝 |
| T09 | 依赖失败与独立分支 | 失败阻塞下游；合法独立只读包继续；总任务不会误报全部成功；旧串行入口保持原语义 |
| T10 | 并发限额 | 压测下活动包/Bot/机器数量不超过配置；等待状态可见，无丢任务或忙循环 |
| T11 | 工作区写入互斥 | 相同 worktree 两个写任务不并发；独立 worktree 可运行；锁在真实退出后释放 |
| T12 | 取消整任务树 | 包含 CLI/远程命令时停止进程树并核对，未启动包 skipped；未确认停止时仍 cancelling |
| T13 | Host 崩溃与重启 | 派发前/派发后/收据落盘前分别断进程；重启核对原 attempt，费用和产物不丢且不重复执行 |
| T14 | 远程断网结果未知 | 断网发生在动作开始后时显示 outcome-unknown；重连查询原 operation，不自动再运行 |
| T15 | agent 去重与冲突 | 同 operation id 同摘要返回原记录；不同摘要冲突；清理产物后去重仍有效 |
| T16 | 错误或缺失机器凭据 | 401/明确鉴权失败；无工具动作发生；日志、模型消息和诊断导出无凭据 |
| T17 | 授权撤销与配置变化 | 撤权后旧 grant/审批/预览不能启动新动作；在途动作有取消或未停止证据；无冒充主体 |
| T18 | 网络边界 | 非法 Origin/Host、跨域重定向、错误 TLS/端点被拒；Token 不转发到其他端点 |
| T19 | 产品/协议版本不兼容 | 旧 agent、不同 API major、MCP 不兼容给升级/兼容指引；不死循环重连、不损坏会话 |
| T20 | 文件路径逃逸 | ../、绝对路径、编码路径、Windows 盘符/UNC 等不能越过根目录授权 |
| T21 | 链接与并发替换 | 符号链接/junction/reparse 与路径替换攻击被拒或由 OS 边界限制；实际读取不出授权范围 |
| T22 | 写文件并发与中断 | expectedHash 不匹配拒绝；断电/进程中断后为旧或新完整文件，不能半写成功 |
| T23 | 文件/产物边界 | 中文名、二进制、分片、大文件上限、hash、下载与过期反馈正确；只能读取获准 artifact |
| T24 | 命令参数、超时与输出 | 空格/Unicode/换行参数正确；argv 不经拼接；超时杀进程组；大输出受限且状态准确 |
| T25 | OS 隔离真实检查 | Linux 容器/独立用户及 Windows 专属账户不能读取其他 Bot 状态；native 模式 UI 如实展示边界 |
| T26 | 浏览器身份隔离 | A 登录状态/cookies/downloads 不出现在 B；非持久任务关闭后回收；持久 profile 显式选择 |
| T27 | 浏览器行为控制 | refs/script/task、本机与远程导航/DOM 操作可用；下载/脚本/上传和内部地址策略有效 |
| T28 | Windows 基本控机 | Win10 和 Win11 实机登录态能截图、点击、滚动和输入中英文，结果可验证 |
| T29 | 多屏与 DPI | 100%/125%/150% 和负坐标显示器映射正确；过期截图/分辨率变化拒绝旧点击 |
| T30 | 登录/锁屏/注销/UAC/RDP | 状态变化可读；不会点进错误 Session、不绕过安全桌面、不声称动作已成功 |
| T31 | 桌面租约与人工停止 | 两 Bot 控桌面互斥；托盘暂停/停止与远程取消生效；撤权后不能继续下一步 |
| T32 | CLI 精确模型身份 | 请求、报告与已验证映射分别记录；不匹配拒绝或暂停；不能指定的组合明确限制 |
| T33 | CLI 原生 MCP bridge | 只列获准能力，桥接只持短期身份；无法列/调用其他 Bot 机器/秘密；退出后授权失效 |
| T34 | CLI 不支持 MCP 的完整工作流 | 所属 Bot 执行远程准备/验证、CLI 收到受控输入和产物；UI 不声称 CLI 直连，失败不悄悄换模型 |
| T35 | 远程 CLI 运行位置 | CLI 在声明机器和 worktree 执行；登录/依赖检查按该机器；本机/远程路径与密钥不混淆 |
| T36 | 十二工具既有能力回归 | 每工具原有检测、安装/更新、修复、卸载、登录/就绪、终端/自动模式逐平台比对；未支持模式不被伪装 |
| T37 | 真实 PTY 与多会话 | 中文/ANSI/resize/输入/登录/退出码/清理正确，固定入口不被 PATH 别的副本替代 |
| T38 | API 并发预算 | 同时启动、重试、复核时预占原子有效；未知/超预算未获许可不执行；展示支出和预占分开 |
| T39 | 订阅计量与回退 | 未知 token 不当零；subscription-only 不转 API；显式转 API 时重新估价、审批和预占 |
| T40 | 收据与历史 | Bot/CLI/评审/旧档案不重复计账；失败/取消保留已发生费用；同 receipt 重写幂等 |
| T41 | 质量复核与用户评分 | 学习撤回/重置可用，质量下限不被主观评分绕过；复核另计调用并保留原收据 |
| T42 | worktree 条件合入 | 源脏/HEAD 变更/冲突/CLI 内提交均正确处理；未通过检查不覆盖源，产物可恢复 |
| T43 | 群聊与授权范围 | 管理员/@/进度/结果回群，群外 Bot 与不相关群记忆不可见；同 Bot 身份不复制 |
| T44 | 长期记忆与历史 | 编辑/删除/检索、长对话分段/摘要、重启续接、引用范围与文件附件保持正确 |
| T45 | 计划任务 | 归属稳定 Bot；每次执行重新检查模型、预算、授权；重复 tick 不产生双任务；会话切换不丢计划 |
| T46 | 原交互能力回归 | 语音、侧聊/btw、引用、图片/附件、ask_user/show_view/widgets 各有可达入口和真实 UI 证据 |
| T47 | 能力包/秘密/连接器 | MCP/skill/pack 生命周期、秘密替换/撤销、GitHub 连接/断开与 Bot scope 均保持；不泄露 Token |
| T48 | 迁移完整性 | Bot、群、记忆、会话引用、API 历史、订阅档案和未知值数量/归属一致；两次导入不重复 |
| T49 | 迁移失败与回退 | 在不同步骤中断仍能恢复旧数据；新库版本不能被旧插件误写；新任务数据可导出保留 |
| T50 | 干净安装与升级 | Linux 与 Win10/Win11 从空环境安装 agent、配对、配置 Bot 完成远程任务；升级/卸载不误删数据 |
| T51 | 可选发行载体 | 现有桌面支持平台和 Docker/Web 安装可加载同一插件；数据位置、更新/导入与退出行为有证据 |
| T52 | 发布字节与兼容表 | CI 成功后，源码/tag/npm tarball/Release/agent 摘要相符；匿名下载与干净安装通过；旧历史保留 |
| T53 | UI 可用性与离线 | 宽窄窗口、长日志、错误、审批、未知状态、任务恢复均可操作；浏览器刷新不重发副作用 |
| T54 | 性能/配额/泄漏 | 在记录环境下测量入队/进度目标；磁盘满、日志上限、并发压力、长跑后无失控进程和无限增长 |
| T55 | 兼容 facade | 旧工具/命令/RPC 的输入、结果和计费行为保持；所有路径调用统一 Policy，无绕过授权 |
| T56 | 支持声明与证据审计 | 每项声明关联版本、平台、模式、证据级别；mock/协议/真实推理分开；研发模型调用记录仅 GPT |
| T57 | M0 拓扑与笔记本休眠 | deployment-profile 明确宿主、常开 agent、Windows/WireGuard 路径；所选常开拓扑不依赖笔记本转发，休眠后任务/计划按策略继续并恢复 UI；本机宿主模式如实标明限制 |
| T58 | 预览版发行合同 | 每个预览 tag/npm/Release 带 preview 或 rc；附完整 R/T 状态与未完成项、F差分、平台和证据；Linux-only 不能进入稳定发行流程 |
| T59 | 公网鉴权抗滥用 | 随机Token、摘要验证、恒定时间比较、失败节流/临时冷却、Origin/Host/TLS/代理来源及可选mTLS有效；攻击失败不锁死合法客户端，轮换立即生效 |
| T60 | 双来源费用可见 | 真实GPT的Bot推理+CLI子任务在任务卡分别展开，重试/评审可追踪；按receipt去重，订阅不虚构美元，未知不当零 |
| T61 | 冻结基线与增量纳入 | 代码与功能差分基于完整SHA；上游更新先列文件、F/R/T、迁移和风险，经明确纳入再改基线；禁止自动追HEAD改变验收范围 |
| T62 | 研发与产品角色分离 | 产品Bot身份/权限与IDE/外部评审分开；无截图触发外部委派或Release权限；实际模型调用遵守GPT-only，人员/工具分工标明已定或待定 |
| T63 | 文档离机可读 | 资料包复制或解包到新位置后全部本地引用可读且不越界；无作者盘符依赖；随附方案/评估/截图及校验信息完整 |

## 4. 完成记录格式与验收规则

实施时每条 F/T 填入：源码提交、构建摘要、宿主/OS/架构、CLI/agent 版本、模式、账户授权条件、执行日期、结果、证据位置和限制。失败项必须保留日志和恢复步骤。

“无该模式”只能用于上游/现有适配器本来没有的模式，并保持原有能力可达。R01–R32 的必选目标不能标成不适用。用户账户未提供时可以先完成适配与协议测试，但不能把未执行的真实模型验收填为通过。

最终功能差分必须包含 `原入口 → 新入口 → 操作 → 可观察结果 → 验收证据`。完整版本的交付报告列出未通过项；只要 Linux 控机、Windows 登录桌面、Main 无群派活、Bot 隔离、两仓能力或发行迁移存在缺项，就不能宣称全部实现。
