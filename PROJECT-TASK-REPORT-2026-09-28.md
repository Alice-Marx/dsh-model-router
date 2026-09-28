# Model Router Galgame 总项目任务报告（2026-09-28）

## 项目方向与当前结论

原 Rustagent/Wonderland 的复杂度路由、预算估算、跨模型分工与交付验收构想，现集中到 `model-router-galgame`，作为**官方 DeepSeek Harness Desktop 0.1.7-rc.2 的插件**继续开发。当前代码与本地安装候选包版本为 **0.8.0**。它尚未在用户真实账号及官方桌面版完成本轮验收。本报告列明可用能力与尚未达成的部分；下文先记录 0.8.0，后面的 0.7.0 段落保留上一轮历史，不代表当前限制。

2026-09-28 用户更新发布顺序，要求**先上传 npm 和 GitHub**。因此本轮以候选版身份发布，明确保留真实账号与桌面验收未完成的状态。构建时核对 npm 最高稳定版与 GitHub 最新 Release 均为 0.4.32，0.8.0 无同号冲突。

### 0.8.0 发布记录（后续更新，以本段为准）

- 源码提交 `81179a26e92f371da2d7c4b18599968b39b81350` 已快进推送到 GitHub `main`；注释标签 `v0.8.0` 指向该提交。
- [GitHub 0.8.0 预发布](https://github.com/Alice-Marx/model-router-galgame/releases/tag/v0.8.0) 已创建，附带同一 `.tgz` 安装包。GitHub 资产公布的 SHA-256 与本地包一致：`0CF4BDFB3BE8F110254C994272C19795F659BFCC9CA7D54DC4B29CC063C6D8DD`，大小 12,582,606 字节。
- npm 包维护者 `ljwei-stak` 已完成登录及网页二次验证。[npm 0.8.0 包](https://www.npmjs.com/package/@ljwei-stak/model-router-galgame/v/0.8.0) 已以 `next` 标签发布；公开 registry 查询确认 `next=0.8.0`、`latest=0.4.32`。[公开 tarball](https://registry.npmjs.org/@ljwei-stak/model-router-galgame/-/model-router-galgame-0.8.0.tgz) 下载结果为 12,582,606 字节，其 SHA-256 为 `0CF4BDFB3BE8F110254C994272C19795F659BFCC9CA7D54DC4B29CC063C6D8DD`，与本地包及 GitHub 附件完全一致；其 SHA-512 也与 registry `dist.integrity` 一致。
- 同步报告的 GitHub `main` 提交为 `bf30cc2`；本次再修正文档顶部的发布状态，避免仓库文档继续显示“未发布”。

历史状态：0.5.1 已由官方插件管理器本地安装，侧边栏及模型路由主面板曾实际显示；0.6.0 的本地包在 `package.json.files` 中漏掉 Host 工具模块，因此该旧包**不应继续安装或发布**。0.7.0 已修正打包清单并重新构建。

## 0.8.0：七家官方工具执行与 ZCode 安装（本轮）

### 完成的工作

1. **Claude Code/Codex 完整工具入口**：可编辑 Claude 移除旧的 restricted、仅 Read/Glob/Grep、禁用技能/MCP/子代理的参数，改为经 Harness 工具审批后在独立 Git 工作区以官方 CLI 的正常工具集运行。Codex 恢复加载用户配置和其中的 MCP。审批文案明确会使用终端、技能与已配置 MCP。Windows 官方沙箱报告 `partial` 时，不能据此宣称所有磁盘和网络效果被完整封闭；原仓库仍通过干净工作区与补丁整合闸门保护。
2. **Kimi Code 2.1.1**：固定官方 npm 包与 Node 入口，按 `-p` 和 `stream-json` 解析助手答复，要求退出码和最终答复。该模式自动处理工具权限，因此只开放经审批的独立工作区可编辑任务；过长的 Windows 命令行任务会明确拒绝并建议拆分。
3. **MiniMax Code 0.5.5**：固定官方 npm 入口，使用 `mcode exec --input - --permission full --output-format stream-json`；解析任务起始、会话、回合与 `exec.completed` 结果，拒绝不完整或失败终态。仅开放经审批的独立工作区可编辑任务。模型参数要求 CLI 的 `provider/model` 格式。
4. **MiMo Code 0.1.15 与 Grok Build 1.0.41**：绕过可变的 npm `.cmd`/JS 包装器，查找固定版本官方可选包的 Windows 原生程序并按发行文件 SHA-256 校验。MiMo 用 `mimo run --format json`，可编辑模式才使用官方 `--dangerously-skip-permissions`；解析 `error`、`step_finish` 和最终文本。Grok 用官方 `-p` 与 `streaming-json`，只读模式限读工具，可编辑模式启用 `--always-approve`；解析 `end/EndTurn`，长任务明确拒绝。Grok 原生程序和账号目录在本机非 C 盘 npm prefix 下使用 `.model-router-grok`。
5. **ZCode 3.14.3**：按用户给出的官方仓库，识别 Windows 注册表、标准目录或显式安装目录；仅接受厂商签名有效、版本匹配、GLM 资源位于同一安装根目录，且实际执行的 `zcode.cjs` SHA-256 与固定官方安装器解包文件一致的桌面版。本机 `D:\Program Files\ZCode` 的 14,820,819 字节脚本与验签、验整包 SHA-256 的安装器解出文件逐字节相同，SHA-256 为 `B1DF2EF3E5BD76C4AF3ECB296BC003A10D3F13191A26610BD0BA940FEADAD529`。一键安装先下载到非 C 盘目录，核对安装器 SHA-256 与智谱签名，再打开原厂交互窗口供用户选择目标目录；“安装器已打开”不冒充“已安装”。编程任务使用 `--output-format stream-json`，要求同一会话中有匹配回合的 `turn.started`、`turn.completed` 且 `resultType=success`，没有失败事件，最后收到有效 `result` 与退出码 0；`projection.status=idle` 只作辅证。ZCode CLI 无 `--model`，使用其配置的默认模型。
6. **计划、团队与界面**：七张工具卡分别显示安装与执行就绪状态；复杂任务的明确编号、分行、分号或独立中文动作句会形成最多六个有具体 `objective` 的执行包，超出六项的剩余需求集中在最后一包，代码围栏里的示例不参与拆分。目标贯穿计划卡、协作指令和 CLI 提示词，保留分析→执行→可选验证→整合的依赖。团队筛选执行模式允许的供应商，工作包失败立即停止。Harness 目录的模型 ID 与厂商 CLI 模型名不直接互通：团队默认仅对 Claude/Codex 请求推荐 ID，其余使用各自 CLI 默认模型并在每包结果中说明；可选 `cliModelsJson` 按工具或工作包绑定该 CLI 已配置的准确模型名，工作包优先，执行前验证格式。单工具调用提供 `cliModel`；MiniMax/MiMo 均要求 `provider/model`。可编辑团队以运行前原提交为基线生成补丁，覆盖厂商 CLI 自己提交过的改动；即使有 Git 忽略产物，也会整合可追踪源文件，同时把团队或单工具结果标为 `integration-pending` 并列出未整合产物。工具重探测使用新鲜状态。
7. **Gal 自由模式接线修复**：Host Remote 的请求 ID 原先只接受四段 UUID，客户端发出的标准五段 UUID 都被拒绝；已修正格式校验，使发送消息可到达官方模型服务。仍须在用户真实账号与 Desktop 中验证回复、取消和切换模型行为。

### 本轮文件说明

| 文件 | 说明 |
| --- | --- |
| `.dsh-plugin/shared/official-tool-registry.mjs` | 七家固定来源、版本和供应商映射；ZCode 为交互式已签名安装器。 |
| `.dsh-plugin/shared/official-tools-runtime.mjs` | ZCode 发现/下载安装作业；非 C 盘 Grok home；保留原有 npm 探测、安装与取消。 |
| `.dsh-plugin/shared/official-tool-executor.mjs` | 七家 CLI 的统一受限启动、模式、账号环境、超时、取消、结果解析与官方沙箱包装。 |
| `.dsh-plugin/shared/vendor-minimax-adapter.mjs` | MiniMax 固定 headless 参数与严格 JSONL 终态解析。 |
| `.dsh-plugin/shared/vendor-mimo-grok-adapter.mjs` | MiMo/Grok 固定原生程序哈希、参数及机器可读终态解析。 |
| `.dsh-plugin/shared/zcode-bundle.mjs` | Windows ZCode 桌面版注册表/目录发现、签名、版本与实际 CLI 脚本哈希核对。 |
| `.dsh-plugin/shared/zcode-installer.mjs` | 非 C 盘缓存下载、固定哈希与签名校验、打开可选目录安装窗口。 |
| `.dsh-plugin/shared/router.mjs` | 复杂任务显式需求拆分、具体目标与依赖工作包生成；过滤代码围栏中的样例。 |
| `.dsh-plugin/shared/official-team-runtime.mjs` | 执行模式预筛、工具/工作包 CLI 模型绑定及回退提示、具体包指令、原提交到最终索引的补丁整合及忽略产物清单。 |
| `.dsh-plugin/shared/harness-plan.mjs` | 各厂商 CLI 模型名与 Harness 推荐 ID 可能不同的渠道说明；把具体目标投射到工作包。 |
| `.dsh-plugin/official-tools-remote-service.mjs` | 新鲜探测工具状态；修复 Gal 自由模式五段 UUID 请求 ID 校验。 |
| `.dsh-plugin/index.mjs` | 七家工具说明、单工具 `cliModel` 与团队 `cliModelsJson` 绑定、安装与可编辑执行审批文案、团队模式筛选。 |
| `.dsh-plugin/client/router-main.jsx`、`.dsh-plugin/client.js` | 七张工具卡、ZCode 安装窗口状态、工作包具体目标与模型回退说明及构建结果。 |
| `package.json`、`README.md`、`README.zh.md`、`INSTALLATION_GUIDE.zh.md`、`MIGRATION.md` | 0.8.0 候选版号、四个新增模块的包清单及实际能力/验收步骤。 |

### 已完成的静态检查与交付包

`npm run build:client` 已生成 17,089,134 字节客户端文件；`node --check` 通过 Host 入口、路由与计划、执行器、工具运行时、团队运行时、MiniMax 与 MiMo/Grok 适配器、ZCode 安装器和发现模块；`npm pack --pack-destination dist --json` 生成 **23 文件**的 0.8.0 本地候选包，并确认四个新增 Host 模块均在清单中。`git diff --check` 无空白错误。**本轮未添加或运行自动化测试；未在用户账号上调用模型；未在官方桌面版安装本包。**上述检查在上传前完成，发布结果见本报告开头。

发布前另完成 `pnpm install --frozen-lockfile`、`npm run check:client` 和 `pnpm peers check`；三项均通过。`npm test` 未运行，不能用历史测试结果代表 0.8.0。

安装包：`dist/ljwei-stak-model-router-galgame-0.8.0.tgz`，12,582,606 字节，SHA-256：`0CF4BDFB3BE8F110254C994272C19795F659BFCC9CA7D54DC4B29CC063C6D8DD`。

### 需要做的测试及方法

1. 用官方插件管理器从本地 `.tgz` 升级，确认 Host 无加载错误、模型路由/Gal 两个侧边栏分块及七张工具卡显示；确认原模型设置和 Gal 存档保留。
2. 在专用干净 Git 仓库逐家运行一个只读或可编辑的小任务，检查厂商账号登录、实际模型、工具调用、结构化终态、独立工作区、补丁整合与费用；Kimi、MiniMax、ZCode 只能选择可编辑模式。检查失败/取消不会把原仓库误标为完成，再让 CLI 在隔离工作区自行提交一次、生成一次 Git 忽略产物，确认提交的源文件仍被整合且忽略产物被显式报告。用明确列出的多项需求检查工作包数、具体目标、前置依赖和 `cliModelsJson` 工具/包级覆盖。
3. 在一台未装目标 CLI 的环境分别点 npm 安装、取消与重试；ZCode 点击后确认非 C 盘下载缓存、官方签名、安装目录选择与安装后重新探测。核对 Grok 的 `GROK_HOME` 与 npm prefix 同在非 C 盘。
4. 运行仓库单元与边界测试，并补齐各厂商 JSONL 成功/失败、签名/哈希拒绝、安装取消和团队混合厂商工作包案例。此轮遵照用户当前任务未运行测试，历史通过记录不能代表 0.8.0。
5. Gal 剧情、自由对话与真实账号行为按上一轮清单复查，尤其是中止请求、跨剧目存档和安装升级后的状态。

### 尚未完成及思路

1. **真实账号和官方 Desktop 验收**：开发接线不等于真实供应商凭据可用。由账号持有人在官方桌面版安装候选包，逐家完成最小调用，记录厂商返回的模型、授权、费用和失败原因；据此修正适配器后才可标记为稳定版。
2. **CLI 模型 ID 映射**：当前团队针对 Kimi/MiniMax/MiMo/Grok/ZCode 默认使用各自已配置模型，允许操作者用 `cliModelsJson` 明确覆盖，但不能自动证明与 Harness 建议模型相同。Claude/Codex 的 ID 也仍要以真实账号记录核对。下一步读取各厂商配置/结构化记录建立自动、可验证映射，并对不同包按实际模型估算成本；ZCode 如需逐项切换模型，应改接其 Agent Server 的模型控制协议。
3. **更细的权限与进度桥**：当前可编辑无界面入口在一次 Harness 审批后运行厂商自身工具，Windows 沙箱仍报告部分隔离。下一步把支持 ACP/Agent Server 的厂商接入逐项权限回调与任务事件流，再考虑从工作台直接启动/暂停团队任务；Remote 必须绑定官方会话身份和工作区，不能让普通面板 RPC 任意改写文件。
4. **工作包实质验收和成本**：目前团队按终态/补丁做机器检查，无法证明需求本身已达成，也无法硬限真实费用。应把计划的验收项与实际文件、命令记录和厂商 token/费用记录逐项核对；不通过保留隔离工作区并明确列出差距。
5. **稳定版后续发布**：0.8.0 已按用户更新的顺序作为预发布提交 GitHub 与 npm `next`，但尚未完成完整自动化测试和真实账号验收。完成上述验证并修复发现的问题后，按仓库 `AGENTS.md` 的同步规则运行完整检查、更新版本与 Release，再决定是否将 npm 稳定标签指向验收通过的版本；不可把当前候选包标作已验收发行版。

### 本轮官方依据与本机核对

ZCode `v3.14.3` 的流输出和终态来自[官方 CLI 输出实现](https://github.com/zai-org/ZCode/blob/v3.14.3/apps/zcode-cli/packages/cli/src/prompt-command.ts)、[事件映射](https://github.com/zai-org/ZCode/blob/v3.14.3/apps/zcode-cli/packages/bootstrap/src/zcode-protocol/session-mapper.ts)和[回合结果类型](https://github.com/zai-org/ZCode/blob/v3.14.3/apps/zcode-cli/packages/contracts/src/events/session.events.ts)。本机固定安装器经 SHA-256 与 Authenticode 核对后，用 `D:\Program Files\7-Zip\7z.exe` 解包，安装件及解包件的 `zcode.cjs` 逐字节比较相同；该哈希随后写入启动前检查。此核对证明本机文件与该固定发行件一致，不等同于已经通过 ZCode 账号调用。

## 0.7.0 历史记录

## 本轮完成的工作

1. **一键安装链路**：在官方 Client 与 Host 间增加 Typert Remote 通道。桌面工具卡片可检测、点击下载安装、取消排队或运行中的安装、显示任务进度与日志、重新探测真实版本。Host 只接收六个注册表工具 ID；固定 npm 包名、版本、安装参数、超时与输出上限均由 Host 决定。取消后进程树会收到终止请求；若 npm 已修改全局目录，界面要求重新检测。模型工具安装另通过官方工具审批；界面点击属于已认证操作者主动请求。官方连接层不能从该 Remote 区分本机桌面与其他已认证客户端。
2. **官方 CLI 注册表更新**：截至 2026-09-27 核对的固定版本为 Kimi Code 2.1.1、Claude Code 2.1.283、Codex 0.157.1、MiniMax Code 0.5.5、MiMo Code 0.1.15、Grok Build 1.0.41。纠正了 MiniMax 包名为 `@minimax-ai/code`，并确认 Grok 的官方 npm 包 `@xai-official/grok`。升级前拒绝对较新或无法比较的已装版本执行可能的降级；npm 成功后必须重新探测到目标版本才报告成功。
3. **真实 CLI 执行入口**：增加 `model_router_tool_run`。当前 Windows 上仅 Claude Code 与 Codex 有经限定的非交互适配器：真实官方入口、固定参数、无 shell 传入任务、标准输入、有限运行时间与输出、取消进程树、结构化终态。Windows 原生 EXE 需核对有效厂商签名；Codex 不再执行仅凭 npm 包名找到的未签名 JS 包装器，Claude 旧版本门槛提高到满足全部受限参数。每个 CLI 进程还要经过官方 `ctx.sandbox.confine` 包装；该 Windows ACL 沙箱自身报告部分文件效果隔离，不能当成完全隔离。只读与可编辑模式分开；可编辑模式在独立 Git 工作区运行，要求原仓库干净，完成后校验并应用补丁。
4. **复杂任务顺序分工**：增加 `model_router_team_execute`。先从官方已配置模型目录筛选已安装且实际受信执行入口就绪的供应商，按复杂度生成带依赖的工作包，再逐个请求推荐模型 ID、调用对应官方 CLI、携带前置结果。任一包失败即停止；可编辑任务在同一个独立工作区累积成果，全部 CLI 成功后才尝试整合。独立工作区在原仓库内部时写入该仓库的本地 Git exclude，不把工作区本身带入正常提交；若 CLI 生成 Git 忽略文件，则保留工作区并返回待整合，避免假报交付。返回每包状态、结果、工作区与整合状态。CLI 退出成功仍须按验收项检查内容，模型 ID 也须以厂商记录核对。
5. **执行渠道显示**：计划现在区分“CLI 已安装”“当前平台有适配器”和“实际受信入口就绪”。仅 `--version` 成功不再使工具被标成可执行 `official-cli`；界面展示具体未就绪原因。官方 Agent Teams 的成员模型由宿主配置，不能直接按本插件的工作包推荐自动切换；插件的 CLI 团队执行器是独立流程。
6. **Gal 独立模块**：剧情模式改用原项目 15 张章节/支线场景 WebP 和 7 张角色立绘，保留两部剧目、选择、历史、结局、章节/支线跳转与三槽本地存档。自由模式除复制提示词外，新增面板内消息发送：经官方 `ctx.llm` 调用用户已配置路线，按上限传入对话历史，显示回复、加载与错误。以随机请求 ID 关联“停止生成”与 Host AbortController；切换路线/角色或离开面板时请求取消旧回复，长回复明确标记截断，限制并发发送与本地历史长度。已经发生的模型费用不会因取消而自动退回。凭据仍在官方模型设置中，插件不保存 API Key。
7. **可分发候选包**：客户端图像以 data URL 自包含打入 `client.js`，避免安装后找不到相对素材。0.7.0 包清单包含全部 Host 运行模块及客户端成品，不再把缺素材的开发源码装入包。已生成 `dist/ljwei-stak-model-router-galgame-0.7.0.tgz`，12,558,678 字节，19 个文件；SHA-256：`8289288681046BC27A8AEB5D1F10610362C1A0FF21F5BD19DEC36023D894E76A`。

## 主要文件说明

| 文件 | 职责与本轮变更 |
| --- | --- |
| `.dsh-plugin/index.mjs` | 官方 Host 入口；注册路由、咨询、安装、单 CLI 执行、团队执行工具及人工命令；为安装/可编辑执行接入官方审批；从会话沙箱策略取工作区。 |
| `.dsh-plugin/shared/official-tool-registry.mjs` | 六家官方 npm 包、固定版本、探测命令与供应商映射。 |
| `.dsh-plugin/shared/official-tools-runtime.mjs` | npm prefix 发现、探测缓存、串行安装、排队与运行中取消、超时终止、日志上限、升级与重新探测。 |
| `.dsh-plugin/shared/official-tool-executor.mjs` | Claude/Codex 的受限 CLI 适配器；有效签名原生入口、执行就绪核验、Harness 进程沙箱包装、模式、模型 ID、终态、取消和输出边界。其他四家返回明确不支持原因。 |
| `.dsh-plugin/shared/official-team-runtime.mjs` | 会话工作区校验、独立 Git 工作区、本地 Git 忽略、依赖顺序执行、失败停止、忽略产物保护与补丁整合。 |
| `.dsh-plugin/shared/official-tools-remote.mjs` | Client/Host 的 Typert 描述符及安装、取消、状态、Gal 回复/停止参数边界。 |
| `.dsh-plugin/official-tools-remote-service.mjs` | Remote Host 服务：工具列表/执行就绪/安装/取消/状态和通过官方模型服务的 Gal 自由对话与主动停止。 |
| `.dsh-plugin/shared/harness-plan.mjs` | 路由计划的可执行渠道标注、团队工作包与交接说明。 |
| `.dsh-plugin/client/official-harness.jsx` | 官方侧边栏、工作台、设置卡与 Gal 面板注册；把 Remote 方法注入页面。 |
| `.dsh-plugin/client/router-main.jsx`、`.css` | 模型目录、计划与六张工具卡片；安装进度、日志、执行能力与版本状态。 |
| `.dsh-plugin/client/gal-module-page.jsx`、`.css` | 独立 Gal 舞台、剧情/存档、自由对话与本地图像呈现。 |
| `scripts/build-client.mjs`、`.dsh-plugin/client.js` | 图像 data URL 构建规则与自包含浏览器产物，客户端文件 17,082,732 字节。 |
| `package.json` | 0.7.0 版本、Typert 与沙箱 peer、准确的运行时文件白名单。 |
| `README.md`、`README.zh.md`、`INSTALLATION_GUIDE.zh.md`、`MIGRATION.md` | 更新实际能力、安装步骤、迁移范围、执行边界与发布状态。 |
| `tests/official-tools.test.mjs`、`tests/harness-host.test.mjs` | 既有断言按新注册表和工具清单同步；本轮未运行测试，也未为新增执行链路编写测试。 |

原 `aipicture/` 下 22 张选用素材只用于构建客户端，没有在本轮修改；npm 包内仅保留其编译后的 data URL。其余路由算法、剧情数据与存档模块沿用仓库已有实现。

## 本轮已做的构建与静态检查

| 项目 | 结果 |
| --- | --- |
| `npm run build:client` | 成功；`client.js` 17,082,732 字节。 |
| `node --check` | Host 入口、Remote 服务/描述符、执行器、团队运行时、计划模块语法通过。 |
| `npm pack --pack-destination dist --json` | 成功；19 文件，包含全部 Host 运行模块，包大小与哈希见上。 |
| `npm test` | **本轮未运行**；当前代码的新增 Remote、Gal 对话与 CLI 执行行为尚不能据历史 34 项通过记录推断为已验证。 |
| 官方桌面版 0.7.0 安装 | **尚未进行**；用户此前实机安装的是 0.5.1。 |

## 还需进行的测试及方法

1. **桌面安装/显示**：在官方插件管理器用 0.7.0 `.tgz` 更新，确认 Host 组件无加载错误，两个侧边栏分块、Gal 图片、工具卡片均出现。验证升级仍保留 0.5.1 的官方模型配置和 Gal 本地存档。此步骤需对新包做一次实际桌面安装。
2. **单元与边界检查**：运行仓库既有 `npm test`，修复变化带来的断言；补齐 Remote 参数限制、安装超时/取消、受信入口识别、CLI 终态解析、Git 工作区清洁检查/忽略文件/补丁失败、Gal 自由对话多轮/截断/错误的自动化用例。当前未新增或运行这些测试。
3. **真实一键安装**：在未安装的一家上点击卡片，核对固定命令、日志、版本重探测和 npm prefix 位于预期磁盘；核对取消排队及运行中安装后的实际版本，再模拟网络失败、目标已是较新版本及重复点击。
4. **真实账号调用**：由账号持有人对 `model_router_consult` 与 Gal 自由模式分别进行首轮、续轮、失败/主动停止/切换路线中止验证，核对费用与模型身份。插件不能仅凭目录记录证明凭据有效。
5. **官方 CLI 执行**：在专用干净 Git 仓库分别用 Claude/Codex 做只读与可编辑任务，核对厂商签名、Harness 沙箱启动与部分隔离提示、模型 ID 参数、取消/超时、文件只在独立工作区变化、补丁成功或失败时原工作区状态。随后执行一个至少两个工作包的团队任务，核对依赖传递和验收结果。
6. **Gal 剧情**：桌面检查两部剧目、章节/支线跳转、选项、历史、三槽跨剧目存档、断损存档和重开客户端；检查窄窗口下图像与控件布局。

## 尚未完成的开发与完成思路

1. **四家官方 CLI 托管执行**：已查明 Kimi 2.1.1 的 ACP 文件/终端能力有本地回退路径；MiniMax 0.5.5 的 ACP 可逐次拒绝权限，是候选适配器；MiMo 0.1.15 的 ACP `end_turn` 不能单独证明请求成功；Grok 官方沙箱无 Windows 隔离保证。ACP 回调不等于 Windows 进程沙箱。下一步先为每个固定版本证明 OS 或供应商级文件/命令边界与终态，再接入公共 ACP Host 适配器；未证明的保持禁用。安装与探测可先用，不表示执行已完成。
2. **实际模型身份与预算**：团队工具已传入推荐模型 ID，但不同 CLI 可能拒绝别家目录的 ID 或内部回退。需读取各厂商结构化运行记录中的实际模型、计费与 token 消耗，再实现每家验证过的 ID 映射；预算目前只是规划约束，不是真实消费上限。
3. **桌面执行体验**：工作台目前展示计划，执行入口是官方会话工具。若要从工作台直接启动团队任务，应增加带会话身份、工作区与审批的受限 Remote，显示每包进度及可中止任务；不可让一个普通面板 RPC 任意改写文件。
4. **工作包实质验收**：当前只有 CLI 进程、结构化终态、补丁和忽略产物闸门，不能自动证明每个验收项已达成。下一步收集每包交付文件和证据，与计划中的 `verificationChecklist` 对照，由用户或指定验收模型确认后再标记任务完成；失败应保留独立工作区和未满足项。
5. **发布闸门**：上述功能与验证完成，用户确认真实账号行为后，再审查差异、提交/推送 GitHub，并用 npm 账号发布。当前不应把 0.7.0 标为已完成发布版。

## 依据

官方 CLI 用法与安装方式核对来源：[Kimi Code](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/reference/kimi-command.md)、[Claude Code](https://code.claude.com/docs/en/cli-reference)、[Codex](https://github.com/openai/codex/blob/main/README.md)、[MiniMax Code](https://github.com/MiniMax-AI/minimax-code)、[MiMo Code](https://mimo.mi.com/docs/en-US/news/latest/mimocode)、[Grok Build](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/01-getting-started.md)。具体固定版本以本仓库注册表和本地 npm 元数据核对记录为准。
