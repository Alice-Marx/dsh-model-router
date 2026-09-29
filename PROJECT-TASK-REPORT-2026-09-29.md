# Model Router Galgame 总项目任务报告（2026-09-29）

## 本轮目标与交付状态

本项目继续把原 Rustagent/Wonderland 的“按难度选模型、控制估计费用、拆解复合任务、跨模型交付”构想融入 `model-router-galgame`，作为官方 DeepSeek Harness Desktop 插件运行。本轮针对用户实际安装 **0.8.0** 时出现的 **DSH 0.2.0-rc.1 不兼容**，准备 **0.9.0** 修复版，并核验模型规划、官方工具安装和独立 Gal 模块。真实账号下的付费模型调用仍须账号持有人测试；本地规划结果不等于实际模型完成质量或真实账单。

## 已完成的工作

1. **新版宿主兼容**：将声明的 DSH peer 和构建 SDK 对齐 0.2.0-rc.1，更新锁文件。隔离安装时又发现 Typert Client Remote 的 `install` 方法与 0.2 客户端命名空间服务冲突，改成 `installTool`；远程服务需要在挂载描述符后通过 `ctx.inject` 声明依赖，才注册模型路由和 Gal 界面。兼容测试使用桌面安装件解出的真实 0.2.0-rc.1 运行时代码，不接触用户当前 profile、账号和应用安装目录。
2. **按成本与能力路由**：每个准确 `provider/model` 路线可由用户填写质量评分、USD/百万 token 输入/输出及缓存单价、专长标签、厂商 CLI 模型名。规划只使用官方模型目录实际存在的路线；缺少价格时返回未知，不会当作免费或虚构节省额。复合任务拆成有依赖、难度、验收项的工作包；简单包在质量下限内优先低价路线，困难包优先强模型。图像任务只派给声明图像能力的路线；无法满足时明确失败。
3. **厂商工具与团队执行**：Host 仍按固定注册表探测和安装 Kimi、Claude、Codex、MiniMax、MiMo、Grok 与 ZCode；模型可调用规划、咨询、工具运行和顺序团队执行。团队执行支持保存的路线 CLI 模型映射及临时逐工具/逐包覆盖，先校验模型名和执行入口，按依赖执行，失败或报告模型不匹配时停止，可编辑任务在独立 Git 工作区运行后整合。实际厂商模型 ID 多数不能由 CLI 回报验证，结果明确标注这一限制。
4. **一键安装真实性修复**：之前工具仅返回目标版本横幅时，安装任务会误报“无需重复安装”，即使可信官方入口不存在。界面现在提供“修复官方执行入口”；Host 只在版本和执行入口都核验通过时跳过安装，实际安装后也检查两者。Windows 签名校验显式加载系统 PowerShell Security 模块，修复在 DSH 子进程环境中自动加载失败、把已签名的 Claude/Codex 误判为不可用的问题。
5. **Gal 独立分块**：保留独立侧边栏入口，剧情模式的 Gal 场景、角色、分支、历史和三槽本地存档；自由模式可选官方目录路线在面板对话或复制开场提示词。自由模式真实账号调用没有在本轮代用户执行。
6. **MiniMax 与 MiMo 实机修复**：MiniMax 官方 Windows 安装器把包放在版本化 `releases` 下，原探测只找全局 npm 包。本轮把官方 `@minimax-ai/code@0.5.5` npm 发行包中的 `cli.js` 与本机 D 盘安装器文件逐字节比对，SHA-256 相同；再核对版本、包元数据、入口位置和 SQLite 原生文件后允许托管执行。为全新安装增加 Windows 兜底：npm 原生依赖失败时下载固定 SHA-256 的官方脚本，只把 npm 版本选择改为 0.5.5，在用户 npm 全局前缀下安装，验收版本、入口哈希与原生依赖。MiMo 的 `package.json` 以 `./bin/mimo` 表示入口，原适配器只接受 `bin/mimo`，现做等价路径规范化后以原生程序的固定哈希验收。Grok 在隔离 F 盘前缀中也完成固定版本 npm 安装和原生入口哈希验收。

## 主要文件说明

| 文件 | 本轮职责 |
| --- | --- |
| `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` | 0.9.0 版本、0.2.0-rc.1 对齐的宿主依赖、可重现安装与测试入口。 |
| `.dsh-plugin/index.mjs` | Host 工具与命令、用户模型资料接入规划、CLI 模型映射、团队调用。 |
| `.dsh-plugin/shared/model-profiles.mjs` | 严格解析逐模型质量、价格、专长与 CLI 名称；拒绝密钥/命令及未知路线注入。 |
| `.dsh-plugin/shared/router.mjs` | 复杂度和工作包分析、质量下限、成本估算、预算与模型分配。 |
| `.dsh-plugin/shared/harness-plan.mjs` | 把 Host/桌面模型目录转成计划、执行渠道和工作包。 |
| `.dsh-plugin/shared/official-team-runtime.mjs` | 依赖执行、取消、失败停止、模型回报核对、隔离 Git 工作区整合。 |
| `.dsh-plugin/shared/official-tool-executor.mjs` | 七家固定 CLI 入口与执行就绪校验；Windows 厂商签名验证，MiniMax 官方安装器版本及入口哈希识别。 |
| `.dsh-plugin/shared/official-tools-runtime.mjs` | 固定来源探测/串行安装/取消/日志；版本与可信执行入口双重安装验收，MiniMax 固定哈希官方脚本兜底。 |
| `.dsh-plugin/shared/vendor-mimo-grok-adapter.mjs` | MiMo/Grok 原生入口及哈希核对；接受 npm 中等价的 `./bin` 声明。 |
| `.dsh-plugin/shared/official-tools-remote.mjs`、`.dsh-plugin/official-tools-remote-service.mjs` | 与 0.2 Client Gateway 兼容的 Typert 描述符和 Host 接收器。 |
| `.dsh-plugin/client/official-harness.jsx`、`.dsh-plugin/client.js` | 先挂载 Remote、再注入命名空间的桌面入口及构建产物。 |
| `.dsh-plugin/client/router-main.jsx`、`router-main.css`、`catalog.mjs` | 工作台、价格与能力配置、规划结果、官方工具状态。 |
| `.dsh-plugin/client/model-profile-editor.jsx`、`model-profile-editor-state.mjs` | 逐条路线编辑、校验、保存与删除。 |
| `.dsh-plugin/client/tool-install-state.mjs` | 执行入口未就绪时可修复，同版本但就绪时才禁用安装。 |
| `tests/*.test.mjs` | 兼容门槛、路由费用与难度、团队生命周期、模型资料、工具状态和厂商输出协议回归。 |
| `README.md`、`README.zh.md`、`INSTALLATION_GUIDE.zh.md`、`MIGRATION.md` | 0.9.0 安装、迁移、能力边界和用户验收步骤。 |

## 已做的验证

- `pnpm install --frozen-lockfile`、`npm test`、`npm run check:client`、`pnpm peers check`、`git diff --check` 已通过；当前 70 项自动测试全部通过。覆盖价格未知、简单/困难分工、复合任务拆分、图像能力、团队失败停止、可编辑工作区整合、客户端远程命名冲突，以及 MiniMax 安装器版本和哈希拒绝逻辑。
- 以桌面安装件中的 0.2.0-rc.1 运行时启动**隔离 web profile**，从 `.tgz` 安装插件。主页面出现“模型路由”和“Gal 模块”，工具 Remote 正常返回结果；Gal 剧情与自由表单均可打开。
- 在隔离 profile 填入测试估值：Flash 质量 82、单价 0.1/0.4；Pro 质量 95、单价 4/20。简单“提取关键词”推荐 Flash，估算 $0.0003；复合需求拆成 6 包，简单关键词包给 Flash，复杂架构与安全验证给 Pro。以上都是本地估算，不是供应商真实报价。
- 本机签名及入口复核：Codex 和 Claude 显示可信入口就绪；Kimi 原本版本横幅为 2.1.1，但官方 npm 包缺少目标版本。用隔离到 `F:\everyAI\all\wl-verify-data\dsh-compat-smoke-2026-09-29\tool-prefix` 的 npm 前缀点击“修复官方执行入口”，实际安装 `@moonshot-ai/kimi-code@2.1.1`，界面返回“安装成功并验证”且“官方执行入口已核验”。未调用付费账号。
- 本机 MiniMax 官方安装器位于 D 盘，版本 0.5.5，入口哈希 `8D36DEC7…261608D2C82658814AB` 与官方 npm 包一致；隔离验证环境中其 `--version` 返回 0.5.5，SQLite 原生依赖可在内存数据库执行查询。隔离 npm 安装 MiniMax 失败于 `better-sqlite3` 本机原生编译；已存在的官方安装器版本经新适配器识别，不再触发失败的重复安装。
- 另建完全独立的 F 盘 `minimax-fallback-prefix`，从 PATH 排除原有 MiniMax 后真实执行插件一键安装。首次脚本因 Windows PowerShell 5 对无 BOM UTF-8 的解析失败，补入 BOM；再次因宿主子进程不自动加载 `Get-FileHash` 所属系统模块失败，改为显式加载固定系统 Utility 模块。第三次完成官方原生 SQLite 下载和生命周期核验、安装器激活，任务返回 `succeeded`；**重新启动 Node 进程**后仍能从前缀下的 `.minimax-code` 自动找到固定版本与可信入口。
- MiMo 用固定 `@mimo-ai/cli@0.1.15` 在 F 盘隔离前缀安装，起初因入口路径 `./bin/mimo` 未规范化而误报不可执行；修复后原生程序哈希通过，重复点安装直接返回“已核验”。Grok 固定 `@xai-official/grok@1.0.41` 在同一隔离前缀安装成功，原生入口哈希通过。两者未进行真实账号模型调用。
- 将最终 `.tgz` 安装到使用桌面安装件 0.2.0-rc.1 运行时代码的独立 profile，浏览器中可见“模型路由”和“Gal 模块”两个侧边栏分块；任务规划、价格与能力配置、官方工具卡片、剧情舞台和自由模式表单都正常挂载。MiniMax D 盘安装器入口在界面显示“官方执行入口已核验”。从该**已安装包**独立导入检查 Kimi、Claude、Codex、MiniMax、MiMo、Grok 六个入口均能验证；隔离 web profile 的 Host 子进程没有继承用于 F 盘工具前缀验证的覆盖配置，因此 UI 的 Kimi/MiMo/Grok 显示“修复官方执行入口”，这是该 profile 的可见工具目录与独立导入环境不同，不是包代码再次失配。ZCode 本机未安装。

## 用户需要做的真实账号测试

1. 在自己的 Desktop 0.2.0-rc.1 插件管理器升级到 0.9.0，确认已启用、两个侧边栏面板出现。若仍失败，请保留插件安装详情与客户端日志。
2. 在官方“模型”页启用希望参与路由的供应商/模型，逐路线填入自己认可的质量分、真实单价及必要的 CLI 模型名。先对简单任务和多步任务核对建议，不满意时调整评分与专长。
3. 对 Kimi、MiniMax、MiMo、Grok、ZCode，以及本机已就绪的 Claude/Codex，分别在测试仓库做单 CLI 任务；核对登录状态、实际模型、工具权限、结果和厂商账单。ZCode 安装窗口仍需用户选择目录；其 3.14.3 CLI 不能逐次选择模型。
4. 用干净测试 Git 仓库跑复杂多步骤 `model_router_team_execute`，核对每包实际厂商、模型、依赖、失败停止、文件整合与费用；再验证 Gal 自由模式首轮、续轮、停止生成和切换角色/路线。不要把目录登记或 CLI 已安装当作凭据通过。

## 尚未完成及处理思路

- **真实账号与付费调用验收**：本轮没有代用户登录七家供应商，也没有向付费模型发送任务。用户按上节执行后，依据 CLI 结构化输出、厂商运行记录和账单修订映射/参数；若 CLI 不回报实际模型，则继续显示“未核验”，不声称精确分配已证实。
- **官方 Agent Teams 成员级模型控制**：宿主仍拥有成员模型和生命周期。插件当前通过自己的顺序 CLI 团队执行器按包选工具；若官方将来开放成员级模型选择 API，再把同一计划映射到官方 Agent Teams，不使用未公开内部状态。
- **Windows 文件隔离边界**：官方沙箱报告 ACL 文件效果为部分隔离。可编辑任务仍需干净仓库和独立工作区；对 CLI 的账号目录、全盘可见性与已配置 MCP 的影响，应在用户可接受的测试环境核对。不能把部分 ACL 当成完整沙箱。
- **Desktop 实机更新**：隔离 web profile 使用的是同一安装件的运行时代码，但不替代用户自己的 Electron profile。发布后应在用户自己的插件管理器安装相同包、确认界面并反馈异常。
- **MiniMax 官方脚本更新**：Windows 兜底固定了本轮审核的官方脚本 SHA-256 与 0.5.5 版本选择；上游一旦更换脚本内容，本版会拒绝执行并给出可诊断错误，需审核新版后更新哈希与适配。脚本的原生依赖工件来自官方 CDN 并由脚本按清单哈希核对。插件把安装位置和缓存指向 npm 全局前缀；若用户的前缀仍在 C 盘，需先调整此前缀才能避免 C 盘安装占用。

## 发布记录

0.9.0 计划作为 npm `next` 与 GitHub 预发布，保留 0.8.0 历史。本地安装包 `dist/ljwei-stak-model-router-galgame-0.9.0.tgz`，SHA-256 `110BB0679170EF67AF67D320900090E3E23D527ACC0DEA8AF2885688CF8AE4F4`。最终提交、npm tarball 和 GitHub Release 的核对结果在发布后补记。
