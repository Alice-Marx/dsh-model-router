# Model Router 总项目任务报告（2026-09-26）

> 历史报告勘误（2026-09-28）：0.6.0 的本地 npm 包遗漏 Host 工具模块，不应安装或发布；本页对 0.6.0 能力的描述属于当时源码状态。当前候选版、修复、验证缺口与发布状态见 [2026-09-28 总项目任务报告](PROJECT-TASK-REPORT-2026-09-28.md)。

## 本轮目标与状态

**0.6.0（当前轮，基于 0.5.1 官方桌面适配成果）**：应用户要求新增三类能力并保持“全部完善可用后才上传 npm”的发布闸门——① 官方 CLI 工具的探测与一键安装（复杂任务由各模型用各自官方工具执行）；② 路由计划按复杂度选模型并标注**执行渠道**（official-cli / harness-llm）；③ **Galgame 单独分块**：侧边栏独立“Gal 模块”入口，含剧情模式（gal 视图舞台）与自由模式。npm 发布继续等待用户完成真实账号验证后进行。

---

## 0.5.1 轮（历史）目标与状态

继续将 `model-router-galgame` 从旧桌面集成迁到官方 DeepSeek Harness Desktop `0.1.7-rc.2`，并把此前 Rustagent/Wonderland 的跨模型分工、预算估算和交付验收思路接入路由计划。本轮处理用户反馈的“插件能看到，但没有主界面”：`0.5.0` 只有设置卡与 `/router` 命令，没有独立工作台；候选版本为 **`0.5.1`**。

`0.5.1` 已通过官方插件管理器本地安装并热启用。桌面左侧出现“模型路由”，主面板显示“模型路由工作台”、任务规划、模型目录和 **6 个供应商、30 条路线**。该数字只是检查时的官方目录快照，不代表这些路线的账号凭据和网络已经通过实际调用验证。主面板的本地规划按钮和真实跨模型调用尚未完成桌面交互验证。

本轮没有手工修改官方应用安装目录、`app.asar`、桌面 profile 或用户凭据；桌面 profile 的包登记由官方插件管理器安装流程完成。`0.5.1` 没有发布到 GitHub/npm；按照用户要求，**插件全部更新完善并可用后再上传 npm**。

## 0.6.0 轮：已完成工作

1. **官方 CLI 工具注册表与运行时**（`.dsh-plugin/shared/official-tool-registry.mjs` + `official-tools-runtime.mjs`）：固定注册表收录 Kimi Code@2.0.2、Claude Code@2.1.193、Codex（跟随上游）、MiniMax Code@0.5.2、MiMo Code@0.1.15，版本与各集成核对版一致；Grok Build 无可核验 npm 渠道，明确不支持（fail-closed）。探测先用 `where/which` 判存在再取 `--version` 横幅（避免 shell 下“命令不存在”与“程序损坏”混淆）；服务启动式懒解析 `npm config get prefix` 并注入本进程 PATH，修复 npm 前缀挪盘后探测不到的问题；安装作业串行执行、输出有界（120 行）、超时 15 分钟，成功后以重新探测确认。
2. **模型可调用工具与人工命令**：`model_router_tools`（探测）、`model_router_tool_install`（按注册表固定命令安装，只接受工具 id，拒绝任意包名/命令）；人工命令 `/tools` 查看状态、`/tools install <id>` 一键安装。模型与人类共享同一条安装通道，命令完全来自服务端注册表。
3. **执行渠道标注**：`model_router_plan`、`/router` 与桌面计划卡为推荐路线与每个工作包标注 `official-cli`（厂商官方 CLI 已安装，可由官方工具直接执行任务）或 `harness-llm`（经官方模型目录 API 调用，附安装指引）。provider→工具映射采用保守关键词（moonshot/kimi、anthropic/claude、openai、minimax、mimo、xai/grok），DeepSeek 为宿主本身恒为 harness-llm，未匹配供应商不臆测。
4. **桌面工作台“官方工具”卡片**：列出注册表全部工具、用途与固定安装命令，一键复制命令；卡片说明一键安装走 `/tools` 或 `model_router_tool_install`。
5. **Galgame 单独分块**：新侧边栏入口 **Gal 模块**（`model-router-gal` 主面板，与模型路由工作区平级）。剧情模式以 gal 视图舞台呈现官方两条剧目（《千桥协议》v2 八章主线+群星支线、《旧城迁移篇》v1）：场景头（地点/时间/描述）、角色头像与名牌、打字机对话框、选项分支、制度结局卡、历史回看、三槽本地存档（跨剧目校验、损坏降级为 invalid 而非崩溃）、章节跳转与重新开始。自由模式从官方目录选路线+角色+场景合成开场提示词，复制后到官方会话开演；面板不直接调用模型。
6. **验证**：`npm test` 34/34 通过（新增 official-tools 9 项：注册表完整性/版本锁定/provider 映射/渠道标注/计划标注/探测三态分类/缓存/安装拒绝/横幅解析；gal-module 5 项：双剧目引擎、角色表、存档往返、槽位校验、历史回放）；客户端构建 629,546 字节且与源码一致；**真实安装链路验证**：`startInstall('kimi-code')` → `npm install -g @moonshot-ai/kimi-code@2.0.2` exit 0 → 重探测 installed 2.0.2；本机实探测得 kimi-code 2.0.2、claude-code 2.1.282、codex 0.154.0。

## 0.6.0 轮：文件说明

| 文件 | 本轮职责 |
| --- | --- |
| `.dsh-plugin/shared/official-tool-registry.mjs` | 新增。官方 CLI 固定注册表（纯数据，Host/客户端/测试共用）：包名、锁定版本、安装参数、探测命令、provider 关键词。 |
| `.dsh-plugin/shared/official-tools-runtime.mjs` | 新增。探测（where/which+--version、缓存、npm prefix 注入）、安装作业（串行、有界输出、超时）、执行渠道解析；runner 可注入供离线测试。 |
| `.dsh-plugin/shared/harness-plan.mjs` | 契约版本升至 2：计划与工作包标注 executionChannel/channelTool/channelLabel；新增 channelForProvider 纯函数。 |
| `.dsh-plugin/index.mjs` | 注册 model_router_tools / model_router_tool_install 与 /tools 命令；计划函数并入工具探测；commandText 输出执行渠道。 |
| `.dsh-plugin/client/gal-module-page.jsx`、`gal-module.css` | 新增。Gal 模块独立主面板：剧情模式 gal 视图舞台与自由模式提示词合成；GalPanelIcon。 |
| `.dsh-plugin/client/router-main.jsx`、`router-main.css` | 新增官方工具卡片与执行渠道徽标。 |
| `.dsh-plugin/client/official-harness.jsx` | 注册 Gal 模块 main 槽与 sidebar.panellist 入口（order 31）。 |
| `tests/official-tools.test.mjs`、`tests/gal-module.test.mjs` | 新增，共 14 项离线测试。 |
| `tests/harness-host.test.mjs` | 工具/命令清单断言更新为 5 工具 + 2 命令。 |
| `package.json` | 0.6.0；测试脚本纳入新测试文件。 |

## 0.6.0 轮：还需进行的测试与完成方法

1. **桌面加载与交互验证（用户侧）**：`npm pack` 产物 `dist/ljwei-stak-model-router-galgame-0.6.0.tgz`（SHA-256 见下）经官方插件管理器安装后，核对侧边栏出现“Gal 模块”、剧情模式可玩可存档、官方工具卡片渲染、模型路由计划出现执行渠道徽标。
2. **真实安装验证（用户侧，会产生真实下载）**：在官方会话运行 `/tools` 查看检测状态，`/tools install minimax-code` 安装一个未装工具并核对探测版本；或在会话中让 Agent 调用 `model_router_tool_install`。
3. **真实跨模型调用与 Teams 交付**：沿用 0.5.1 轮第 3–5 项（真实目录/计划/咨询/Teams），在 0.6.0 上复核渠道标注与实际调用一致（CLI 已装的厂商走官方 CLI 的路径仍由官方 Teams/Agent 执行器接管，插件只做建议与标注）。
4. **发布闸门**：以上通过后按用户要求上传 npm（0.6.0）。

**0.6.0 本地安装包**：`F:\everyAIll\model-router-galgame\dist\ljwei-stak-model-router-galgame-0.6.0.tgz`（197,328 字节，19 个文件）。SHA-256：`81E123EDC6563A4BCE3B9B7D68197D7B4A26A4D8FD789B1F5061519C79F492A2`。

---

## 0.5.1 轮：已完成工作

1. **官方宿主适配**：新宿主通过官方 `ctx.llm` 枚举模型、读取推理等级和输入模态，并通过 `ctx.tools.register(defineTool(...))` 注册三个模型可调用工具：`model_router_routes`、`model_router_plan`、`model_router_consult`。另有人工命令 `/router <任务>`。目录列出的路线不保证凭据和网络可用，工具返回中已说明此边界。
2. **跨模型与团队融合**：计划沿用原仓库的任务分类、质量、价格与预算估算；团队模式输出带依赖关系、推荐路线和验收清单的工作包。团队成员、消息和任务执行由官方 Agent Teams 处理。咨询工具通过官方 LLM 流向另一条已配置路线发起一次独立调用，限制返回字符数并传递取消信号。
3. **原生桌面工作台**：使用官方 `sidebar.panellist` 和同名 `main` 槽添加侧边栏入口与主面板。面板包含任务描述、单任务/团队分工切换、估算预算、路线搜索和刷新、建议结果与团队工作包；目录加载、失败和空目录有明确状态。主会话模型由官方选择器管理；插件不注册 `agent/request` 或 `agent/pre-step` 全局改写。
4. **官方模型目录与本地规划**：通过 `ctx.remote.session.modelCatalog()` 读取已登记的 provider/model，过滤不可路由的供应商并去重。抽取 Host 与桌面共用的纯规划函数；点击生成建议只做本机计算，不调用模型或创建团队。修正显式 `reasoning=false` 被误判的问题。目录未提供的图像模态保留为未知。
5. **插件详情与设置**：把预算和咨询输出上限设置挂到已安装包对应的 `plugins.bundle.config`，并增加“打开工作台”操作。设置由官方 Host 配置表单保存；工作台读取预算默认值，本次预算经用户编辑后保留输入。
6. **依赖与安装包**：更新官方 SDK 依赖到 `0.1.7-rc.2`，补齐客户端 API 的开发依赖与注入声明。打包时检查生成客户端与源码一致；构建器支持 CSS 文本加载。生成的客户端 79,796 字节，`.tgz` 57,768 字节、19 个文件，旧 GAL 资源不在包内。
7. **文档迁移**：更新中英文 README、安装指南和旧版迁移说明，明确供应商与 API Key 在官方“模型”页面配置。
8. **桌面实机加载**：`0.5.0` 曾验证插件可见、设置卡和 `/router` 指令候选出现，但确实没有主界面。用户授权升级后，`0.5.1` 已热启用，侧边栏及工作台实际显示，并读取到 6 个供应商、30 条路线；没有发送消息或调用真实模型。

## 文件说明

| 文件 | 本轮职责 |
| --- | --- |
| `.dsh-plugin/index.mjs` | 官方 Host 入口：模型发现、三工具及 `/router`；现复用共享规划函数。 |
| `.dsh-plugin/shared/harness-plan.mjs` | 新增 Host 与工作台共用的确定性规划、预算与模态提示、团队工作包及验收清单。 |
| `.dsh-plugin/shared/router.mjs` | 保留路由分类、评分与成本估算；修正显式关闭推理能力的判断。 |
| `.dsh-plugin/shared/livebench.mjs` | 保留可选基准数据解析；本轮没有在线抓取。 |
| `.dsh-plugin/client/catalog.mjs` | 新增官方客户端模型目录到可规划路线的映射，及本地规划入口。 |
| `.dsh-plugin/client/router-main.jsx` | 新增侧边栏图标、工作台、任务交互、目录和规划结果展示。 |
| `.dsh-plugin/client/router-main.css` | 新增工作台明暗主题、响应式布局和状态样式。 |
| `.dsh-plugin/client/official-harness.jsx` | 注册官方侧边栏、主面板、已安装包设置卡及“打开工作台”操作。 |
| `.dsh-plugin/client.js` | 用官方模块加载器格式生成的浏览器端产物。 |
| `scripts/build-client.mjs` | 将 JSX 与 CSS 构建为客户端产物，并检查生成文件与源码一致。 |
| `scripts/prepack.mjs` | 打包前验证客户端并准备 `dist`。 |
| `package.json`、`pnpm-lock.yaml` | `0.5.1` 包声明、官方 SDK/API 依赖、客户端注入与可复现锁定。 |
| `cordis.patch.yml` | 只插入当前路由插件，不接管官方其他组件。 |
| `tests/harness-host.test.mjs` | 验证 Host 模型发现、工具、咨询流和命令。 |
| `tests/harness-workspace.test.mjs` | 新增客户端目录映射、团队本地规划及异常输入验证。 |
| `tests/router.test.mjs` | 验证原有路由算法；其他旧 GAL 测试仍在源码仓库，不属于当前 `npm test` 范围。 |
| `README.md`、`README.zh.md` | 中英文能力边界和使用入口。 |
| `INSTALLATION_GUIDE.zh.md`、`MIGRATION.md` | 官方桌面安装、升级与旧集成迁移说明。 |

## 已执行验证

| 验证 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过。 |
| `pnpm peers check` | 开发仓库显示 `No peer dependency issues found`；不等于验证用户 profile 中所有既有插件的 peer 状态。 |
| `npm test` | 20 项通过，0 失败；包含新增的客户端目录映射与本地团队规划用例。自动化使用模拟目录，不读取真实凭据。 |
| `npm run build:client`、`npm run check:client` | 均通过，79,796 字节的客户端产物与源码一致。 |
| `npm pack --pack-destination dist --json` | 成功，`0.5.1` 包为 57,768 字节、19 个文件，无旧 GAL 素材。 |
| `git diff --check` | 通过。 |
| 官方 Desktop 插件管理器 | 用户授权后已本地安装并热启用 `0.5.1`；profile 的 `package.json` 读回版本 `0.5.1`。已安装包详情显示包名、`v0.5.1` 与组件“运行中”；点击“打开工作台”已成功跳转到主面板。 |
| 已安装包设置 | 详情页实际显示预算 `0`、咨询输出字符数 `12000`；尚未改写或保存用户配置。 |
| 官方桌面主界面 | 左侧“模型路由”入口和“模型路由工作台”实际显示；官方目录返回 6 个供应商、30 条路线。此项只验证界面加载和目录读取。 |
| 桌面 `/router` 指令入口 | `0.5.0` 阶段已在会话输入框出现 `router` 指令候选；本轮未执行真实模型请求。 |

本地安装包：`F:\everyAI\all\model-router-galgame\dist\ljwei-stak-model-router-galgame-0.5.1.tgz`（57,768 字节）。SHA-256：`6F6E503C90A057F3013AFD3B3FAC9A240D982DB2C55697A165E094BC83CD902E`。

`0.5.0` 的安装日志、设置卡和指令候选验证属于历史记录。`0.5.1` 的主界面与详情设置已经实际显示；示例任务输入时桌面自动操作两次检测到并发用户输入而中止，因此尚未点击“生成路由建议”完成桌面交互验证。目录登记也不能证明账号和网络可用。

## 还需进行的测试与完成方法

1. **工作台本地交互**：在左侧“模型路由”输入一条普通任务，分别选择“单任务”和“团队分工”点击“生成路由建议”；核对推荐路线、估算成本、工作包依赖与验收清单。再测试空任务、非法预算、目录刷新和搜索。预期只做本机规划，不产生模型调用。自动化已覆盖规划核心，桌面按钮的完整交互尚待验证。
2. **设置保存与同步**：详情页已看见版本、两个默认值并验证“打开工作台”跳转；下一步在记录原值后保存合法预算，重开工作台核对初值同步及恢复默认，不无故改写用户配置。
3. **真实模型目录与计划工具**：由用户在官方“模型”页配置目标供应商和模型，调用 `model_router_routes`、`model_router_plan`，核对 provider/model 与官方页面一致；插件结果不得包含 API Key 或端点。现有自动验证只使用模拟目录。
4. **真实跨模型咨询**：由用户用自己的账号对 `model_router_consult` 指定一条可用路线，核对返回文本、失败处理、取消和输出长度。此步骤会产生真实模型调用及可能费用，尚未执行。
5. **官方 Teams 分工**：先用 `model_router_plan` 的 `mode=team` 生成工作包，再用官方 Agent Teams 创建成员、交付任务、等待与整合；核对依赖、改动文件、验证结果和未完成事项。计划工具目前只提出分工，不自动创建团队。
6. **升级与回归**：后续候选包安装后检查已有会话、官方模型配置和插件设置没有丢失，也没有重复实例；完成上述桌面流程后再做公开发布检查。

## 未完成开发与实施思路

| 事项 | 实施思路 |
| --- | --- |
| 真实账号下的全链路可用性 | 使用用户自己的官方模型配置完成目录、计划、咨询、失败和取消验证；只记录模型标识与结果，不保存凭据。发现兼容问题后修复并重新打包。 |
| 与官方 Teams 的自动任务分派和工作区整合 | 在官方 `agentTeams` 能力可用时做可选适配，沿用其成员和任务生命周期；用每个工作包的依赖与验收清单进行交接，单独测试取消、失败和整合。 |
| 可审计的主会话自动路由 | 先实现持久化路由决策事件及会话节点，并与官方模型选择器投影协调，再考虑让用户选择开启；当前版本保持纯建议。 |
| 准确价格与硬预算 | 将目前路由核心的实验性价格基线替换为经来源标记的供应商价格/实际用量；若做支出上限，必须由官方请求前策略阻断并覆盖并发调用。 |
| 模型能力元数据 | 官方目录未披露模态时只能保留“未知”，需要逐供应商核对图像、工具和推理等级，再用官方元数据约束候选路线。 |
| 旧 GAL 与旧设置 | 旧源码保留追溯；如确需恢复剧情能力，应作为独立可选插件适配官方原生 UI，先设计显式设置迁移，不在启动时修改旧会话。 |
| GitHub 与 npm 发布 | 完成必要开发、桌面完整交互和真实账号验收后，核对源码、版本、安装包、发布说明与标签一致，再按用户要求上传；`0.5.1` 目前只是本地候选包。 |

当前候选包已通过桌面加载、详情入口和主界面显示验证；工作台规划按钮、真实跨模型调用与团队交付仍待验证。下一个验收结果应继续写入本总项目任务报告，再决定 GitHub 与 npm 的公开发布版本。
