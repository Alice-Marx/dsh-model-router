# Model Router Galgame 总项目任务报告（2026-09-28）

## 项目方向与当前结论

原 Rustagent/Wonderland 的复杂度路由、预算估算、跨模型分工与交付验收构想，现集中到 `model-router-galgame`，作为**官方 DeepSeek Harness Desktop 0.1.7-rc.2 的插件**继续开发。当前代码与本地安装候选包版本为 **0.7.0**。它尚未在用户真实账号及官方桌面版完成本轮验收，**未上传 npm，也未推送 GitHub**。用户要求的是全部完善可用后再发布；本报告列明可用能力与尚未达成的部分。

历史状态：0.5.1 已由官方插件管理器本地安装，侧边栏及模型路由主面板曾实际显示；0.6.0 的本地包在 `package.json.files` 中漏掉 Host 工具模块，因此该旧包**不应继续安装或发布**。0.7.0 已修正打包清单并重新构建。

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
