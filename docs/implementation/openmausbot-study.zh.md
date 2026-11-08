# OpenMausBot 研究与移植路线

研究对象：[OpenMausBot](https://github.com/milind-soni/OpenMausBot) `bea6b2da42a15ddfd4cacd3388743fb53f222546`，共 7279 个受版本控制的文件。核心代码为 **Apache-2.0**；`enterprise/` 目录是另行授权的 source-available 代码，不能移植。按要求，云端桌面订阅（Boat 云电脑、`cloud-buy`、`cloud-welcome`、Cloud Pro 计费）不在移植范围内。

## 结论

OpenMausBot 与本插件的产品形态相同：侧栏里是一组 Bot，每个 Bot 有自己的模型、角色、电脑和工具，人在对话里审批。两者的差别主要在三处：

1. **模型选择的体验。** OpenMausBot 用左侧引擎导轨 + 右侧模型列表的选择器，引擎状态（未安装、未登录、版本）直接显示在选择器里。本插件原来是一个下拉框加一组复选框。这一处已在本次移植。
2. **外观。** OpenMausBot 有十二套皮肤和统一的圆角、字体、状态色体系；本插件的产品页面原来把 DS Bot 的主题变量固定死，切换主题对产品页无效。这一处已在本次移植。
3. **“大脑”的来源。** OpenMausBot 的 Bot 直接由本机 `claude`、`codex`、`grok` 等 CLI 回答，用户的订阅额度就是大脑。本插件的大脑是 Harness 里配置的准确 API 路线，官方 CLI 作为执行手段。本次保留了这个分工，原因和后续方案见下文“为什么不直接把 CLI 换成大脑”。

DS Bot 0.2.7 已经覆盖了 OpenMausBot 的很多对话功能（群聊、记忆、审批卡片、提问卡片、侧聊、定时任务、浏览器、连接器、头像），本插件又补上了 Main Bot 派发、Windows 电脑配对、例行任务录制回放和私有资料库。剩余差距集中在团队导入/分享、快速决策模型、语音、MCP 控制面和 CLI 大脑。

## OpenMausBot 的结构

两个进程：React 应用只发 HTTP 命令、只收一条 SSE 事件流；`127.0.0.1:8799` 上的 harness server 持有全部 Agent 进程，把各家 CLI 的原生协议规范化为统一的运行时事件流，并按会话写 NDJSON 日志。Electron 外壳内嵌 harness，分别适配 macOS、Windows、Ubuntu。

| 目录 | 文件数 | 职责 |
| --- | --- | --- |
| `server/` | 2677 | harness server：驱动、路由、权限、电脑、浏览器、语音、决策模型、例行任务等 |
| `src/` | 1868 | 聊天应用：组件、状态 reducer、多语言、预览页 |
| `docs/` | 1146 | 设计文档、需求、计划、截图、验证记录 |
| `electron/` | 486 | 桌面外壳、原生能力、打包资源 |
| `shared/` | 230 | 前后端共享的类型与 app-frame |
| `apps/`、`companion/`、`relay/`、`connector/` | 244 | 手机配对、中继、外部连接器 |
| `cloudflare/`、`deploy/` | 81 | 云端控制面与部署（云订阅相关，不移植） |
| `evals/`、`skills/` | 82 | 评测场景、工具选择基准、内置技能 |
| `enterprise/` | 10 | source-available，不移植 |

### server 子系统

| 子系统 | 位置 | 要点 |
| --- | --- | --- |
| 驱动 | `server/drivers/`（298 个文件） | 每个引擎一个驱动：Claude（stream-JSON）、Codex（app-server JSON-RPC）、Grok Build 与 Antigravity（ACP）、Pi（RPC），以及 OpenRouter、Groq、Cerebras、Mistral、MiniMax、Ollama 等 OpenAI 兼容端点。每个驱动自带模型目录（`claude-catalog`、`codex-catalog`）、登录与计费检测、错误归一化。未知驱动降级为“不可用”，不会拖垮整个 Bot 集合。 |
| harness | `server/harness/` | `registry`（配置 → 运行实例）、`bus`（事件扇入 → SSE）、进度闸门、未请求停止检测。 |
| 运行时 | `server/runtime/` | 能力声明、提问、状态回复、不变量检查、会话树。 |
| 权限 | `permission-command`、`chat-tool-approval`、`auto-approve` | 所有有风险的动作变成对话里的审批卡片；可按 Bot 设置审批模式和白名单。 |
| 模型目录 | `server/model-catalog/` | models.dev 快照、预设、裁剪；选择器的“推荐”来自这里。 |
| 电脑 | `bot-box/`、`browser/`、`saved-steps/` | bubblewrap 隔离盒、带出站网关的浏览器、电脑步骤的录制与回放。 |
| 决策模型 | `server/decider/` | 用 Workers AI、Jev 或 OpenRouter 的小模型在几百毫秒内为“自动”房间挑选回答的 Bot，失败时回落到房间负责人；也做收件箱分拣。 |
| 哨兵 | `server/sentinel/` | 扫描运行日志，检测费用异常、排队过久、重试循环、工具错误、意外停止。 |
| 语音 | `server/tts/` | ElevenLabs、Fish Audio、Grok、macOS 语音、本地 Chatterbox；朗读前把 Markdown 改写成适合听的文本；通话模式。 |
| 其它 | `email/`、`meetings/`、`phones/`、`pages/`、`headless/` | 邮件、会议、手机中继、页面发布、无界面 CLI（`openmausbot team apply`、`openmausbot run`）。 |

### 应用层

`src/components/` 按功能分组：`bot-settings`（50）、`bot-panel`（28）、`onboarding`（23）、`widget`（19）、`inbox`（16）、`routines`（13）、`keys`（12）、`automations`（12）、`bot-access`（10）等；`cloud-buy`（14）与 `cloud-welcome`（10）属于云订阅，不移植。状态由服务端驱动，客户端只有一个 reducer，没有自己的传输层。

### 设计语言

- **字体**：Geist 优先，系统 UI 字体回落。
- **圆角阶梯**：列表行 6–8px，卡片与菜单 12px，对话框 16px，消息气泡 18px，输入框 22px。
- **状态色**：成功、警告、危险各有前景色，背景用 10% 左右的同色调；状态以胶囊（pill）显示。
- **皮肤**：midnight、atelier、foundry、lagoon、graphite、linen、dusk、daylight、meadow、pop、halloween、aurora，每套是一种明或暗的配色。
- **模型选择器**（`ModelPicker.tsx`）：56px 引擎导轨 + 420px 宽、最高 600px 的弹出层；默认显示 5 个推荐模型，可展开“全部模型（n）”；超过 5 个模型出现搜索；不可用的引擎变暗并说明原因；底部是设置入口。

## 功能对照

| OpenMausBot 功能 | 本插件现状 | 处理 |
| --- | --- | --- |
| 引擎导轨模型选择器、引擎状态 | 下拉框 + CLI 复选框 | **本次已移植**：大脑选择器 |
| 十二套皮肤、统一设计语言 | 产品页固定配色 | **本次已移植**：六组明暗皮肤，产品页随主题换色 |
| 每 Bot 独立模型、角色、记忆 | DS Bot 已有 | 保持 |
| 审批卡片、提问卡片 | DS Bot 已有 | 保持 |
| 频道/群聊、回答规则、负责人 | DS Bot 群聊已有 | 保持；快速决策模型见路线图 |
| 例行任务、自动化 | Host Automation tasks + 例行任务录制回放 | 保持 |
| 电脑：本机控制、录制回放 | Windows 电脑配对、观看/接管、例行任务 | 保持；本地虚拟机见路线图 |
| 电脑：Boat 云桌面订阅 | 无 | **不移植**（订阅功能） |
| 浏览器 | DS Bot 每 Bot 浏览器分区 | 保持 |
| 连接的应用（Composio） | DS Bot 连接器 + 密钥卡片 | 路线图：可选 Composio 连接器 |
| CLI 作为大脑 | 准确 API 路线作为大脑，CLI 作为执行手段 | 路线图第一项 |
| 团队 Markdown 导入、部门分享、预设 Bot | 无 | 路线图 |
| 语音朗读与通话 | 无 | 路线图 |
| MCP 控制面、无界面 CLI | 无 | 路线图 |
| 哨兵异常检测 | 预算与收据核对 | 路线图：在执行记录上做检测 |
| 企业版（`enterprise/`） | 无 | **不移植**（非 Apache-2.0） |

## 本次移植的内容

**宿主：官方工具就绪状态。** 新增仅限所有者的产品动作 `engines.catalog`。它把路由器缓存的体检报告和托管执行能力投影成每个注册工具一行：是否安装、版本、是否有更新、登录状态与计费方式、登录命令、可托管的执行模式。`fresh: true` 只重跑固定的只读探测；不安装、不登录、不启动工具，也不返回路径、凭据或环境变量。纯路由版本不提供这个服务。动作已登记到 `contracts/product-action/v1/actions.json`。

**界面：大脑选择器。** 取代 Bot 绑定表单里的模型下拉框和 CLI 复选框：

- 导轨上半部分“大脑”按 Provider 列出 Harness 中已配置的准确路线；下半部分“官方工具”列出注册表中的 13 个 CLI，需要安装或登录的工具在右上角带警示点；当前大脑所在的 Provider 和已附加委派的工具在右下角带强调色点。
- API 引擎显示模型列表、推荐、搜索；官方工具显示安装/登录引导卡、更新提示、托管委派列表和“允许此 Bot 调用官方工具”开关。
- 托管委派只出现在宿主为该路线核验过的 CLI 模型上；选择另一条路线的委派会同时切换大脑。
- 保存的数据结构与原来完全相同，宿主仍按已提交的目录核验，没有放宽任何权限边界。
- 绑定卡片用大脑徽章显示当前路线和附加的官方工具。

**界面：皮肤。** OpenMausBot 的十二套皮肤按色系配成六组 DS Bot 主题：MausBot（Daylight/Midnight）、工坊（Atelier/Foundry）、亚麻（Linen/Graphite）、草地（Meadow/Aurora）、泻湖（Lagoon/Dusk）、波普（Pop/Halloween），名称与 **设置 → 主题** 中显示的一致。皮肤通过 DS Bot 公开的 `dshBotQueue` 注册，不修改也不导入锁定的 vendor 代码。产品样式改为从当前主题派生，切换主题后聊天、侧栏和产品页一起换色；用户气泡改为 OpenMausBot 的 18px 统一圆角。

署名见 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)。

## 为什么不直接把 CLI 换成大脑

OpenMausBot 让 CLI 直接回答对话，因为它的 harness 就是 CLI 的宿主，费用由 CLI 自己的订阅承担，OpenMausBot 不做跨模型的费用核算。本插件有三条不能破坏的约束：

1. **权限来自已提交的宿主状态。** 模型、工具、电脑和资金的授权不能来自模型参数。CLI 作为大脑时，CLI 自己会决定调用哪些工具，必须把它的工具调用映射回 Bot 已提交的授权，并经过同一套审批策略。
2. **收据必须如实。** 资金核算不能把一次 CLI 订阅调用记成某条 API 路线的调用。CLI 大脑需要自己的收据来源（订阅调用、token 证据未知时记为未知，而不是零）。
3. **远程写入要有持久身份。** CLI 会话中断后，结果未知的写入需要核对，而不是重放。

所以本次先让官方工具以“手”的身份进入选择器（托管委派 + 模型路由调用），大脑仍是准确路线。

## 路线图

按依赖顺序排列，每项写明要改的组件和风险。

1. **CLI 作为大脑。** 在 `modules/bot-runtime/index.mjs` 的 `llm/stream` 接缝处，为绑定了 CLI 大脑的 Bot 走官方工具执行器，而不是 `modelAccounting.stream`。需要：新的收据来源（订阅调用）、每个 Bot 独立的 CLI 会话与工作目录、CLI 工具调用到已提交授权的映射、中断后的核对流程。选择器里官方工具组会多出“作为大脑”的模型列表。风险最高的一项，涉及资金和权限两条主线。
2. **对话头部的模型切换。** OpenMausBot 可以在对话中途切换模型。DS Bot 的 `model-menu.js` 属于锁定 vendor 代码，需要在 `product-overlay/` 中登记补丁，把大脑选择器接到对话头部，切换仍走 `binding.save` 由宿主核验。
3. **团队导入与分享。** 读取 OpenMausBot 团队 Markdown（YAML frontmatter + 正文手册），预览后创建 Bot、群聊、共享说明和暂停状态的例行任务；导出时剔除对话、凭据、模型选择和电脑。需要新的产品动作和导入预览页，导入的 Bot 默认没有任何授权。
4. **快速决策模型。** 为“自动”群聊配置一条低价准确路线，按消息挑选回答的 Bot，失败时回落到群负责人。走现有路由与预算核算。
5. **哨兵检测。** 在执行记录与收据上检测费用异常、重试循环、工具连续失败、意外停止，在“需要你处理”面板提示。只读，不自动处置。
6. **语音。** 朗读回复和通话。语音服务的密钥放在 Harness 设置里，不进入插件状态。
7. **MCP 控制面与无界面 CLI。** 以产品动作契约为边界，开放查看 Bot/群、读取对话、发送任务、等待完成；不开放审批、删除、凭据和电脑生命周期。
8. **可选连接器。** 在 DS Bot 连接器之外提供 Composio 连接器，需要用户自己的 Composio 密钥。

不在范围内：Boat 云桌面与云订阅（`cloud-buy`、`cloud-welcome`、Cloud Pro、Team Cloud 引擎目录）、`enterprise/` 下的全部功能。

## 验证

- 新增测试：`tests/official-engines.test.mjs`、`tests/brain-catalog.test.mjs`、`tests/product-skins.test.mjs`；扩展 `tests/bot-runtime-ui.test.mjs`（选择器的 JSDOM 交互与保存）、`tests/product-channel-dispatch.test.mjs`（所有者限定）、`tests/product-actions-contract.test.mjs`。
- 选择器在 MausBot Daylight、MausBot Midnight、Atelier 和窄屏 Dusk 下用真实组件、离线数据渲染并截图核对。
- `npm run check:client`、`node scripts/check-contracts.mjs`、`node scripts/integration-product-source.mjs`、`node scripts/check-readme.mjs`、`tests/readme-math.test.mjs` 通过。`tests/write-retry.native.mjs` 在 Linux 上的失败与本次改动无关，基线上同样失败。
