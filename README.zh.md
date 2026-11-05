# DSH Bot · 模型路由

[English](README.md) · [简体中文](README.zh.md)

**当前版本：0.63.1，2026-11-05。** 历史报告中的旧版本号只代表当时的报告，不代表当前源码。Windows 电脑 Agent 独立使用 **0.1.0** 版本。

0.63.1 参考 Grok Bot 的简洁工作区布局，统一灰白底色、侧栏、线性图标和 Bot 权限分组，重新整理电脑、资料库与例行任务页面；通过 Chromium 检查浅色、深色及窄屏。0.63.0 运行时基线通过已安装 Harness 0.2.2-rc.1 SDK 的完整离线产品 Host 验收；本次界面更新的验证见[发布报告](https://gitlab.com/Alice_marx/dsh-model-router/-/blob/main/docs/releases/0.63.1-validation.md)。基线在当前 WireGuard 链路的一台 Windows 10 电脑上，1920×1080 桌面 8 秒样本实测 13.12 FPS，输入确认 p50 为 125 ms、p95 为 274 ms。变化区域 JPEG 传输保持物理输入坐标；这些测量不构成固定帧率承诺。

一个 DeepSeek Harness 插件整合长期 Bot 对话、群聊、记忆和浏览器工作，以及模型路由、托管任务、Bot 私有文件和独立实现的 Windows 远程桌面。先为各 Bot 配置准确模型、工具和电脑权限，再由 Main Bot 将工作路由并真实派发给具备条件的执行 Bot。

本项目对可观察工作流进行实现，其中包括 Grok Bot 公开描述的工作流；不声称取得或复刻 Grok 私有系统及完整商业服务。Windows/云电脑和账户由你准备；本产品没有自动创建云 VM、代管云账单或交付自有 iOS 客户端。

**从这里开始：** [安装](#install) · [第一个 Bot](#quick-evaluation) · [连接电脑](#computers) · [例行任务](#routines) · [Bot 路由](#bot-routing) · [私有资料库](#library) · [模型工作台](#workbench) · [数学参考](#costs) · [源码开发](#development) · [排查问题](#troubleshooting)。

![DSH Bot workspace](https://gitlab.com/Alice_marx/dsh-model-router/-/raw/main/docs/assets/workspace-0.63.1-light.png)

<a id="capabilities"></a>

## 已纳入的工作流

| 范围 | 可以使用的能力 |
| --- | --- |
| Bot 对话 | 各自的模型、角色、工作目录、私有对话和权限设置；侧聊、提问与审批卡片。 |
| 团队协作 | 群聊、并行提及、分阶段群目标、Bot 之间交接与结果留存。 |
| 上下文与记忆 | 对话检查点/分段与搜索；Bot/群/团队三类记忆、变更历史，以及可审查的技能/项目规则学习提议。 |
| 浏览器与文档 | 每 Bot 浏览器分区及页面工具，Office 文件读取/预览，连接器与密钥输入卡片；头像库与团队外观设置。 |
| 定时工作 | Host 开启 Automation tasks 服务后使用上游定时任务；持续工作要求 Host 和相关 Agent 保持运行。 |
| Bot 路由 | 保存省钱/均衡/效果策略，读取已提交模型/工具/机器候选，预览拒绝原因并真实派发执行任务。 |
| 远程电脑 | 配对 Windows 桌面，观看/接管切换，键盘、鼠标和文字输入，显示器选择及放大查看。 |
| 例行任务 | 演示已确认输入，按 Bot 保存，通过真实桌面会话回放，查看结果并核对未知影响。 |
| 私有资料库 | 按 Bot 隔离的文件夹、二进制上传下载、文本编辑、名称筛选，以及页面和已授权 Bot 工具的私有文本搜索。 |
| 模型工作台 | 本地模型路线规划、带依赖工作包、官方 CLI 检测/安装/终端、执行历史及独立的 API/订阅核算。 |

集成的 DS Bot 固定为 **0.2.7**，提交 **`71d344bf193f3f18185f25de3d8e5c483046910a`**：包含 352 个与上游字节一致的文件和 6 个可重现产品覆盖，产品修改独立维护在 `modules/bot-runtime/product-overlay/`。`modules/bot-runtime/SOURCE.json` 记录来源和摘要。上游浏览器、头像库与本产品的完整桌面、文档文件资料库分别实现。

<a id="install"></a>

## 安装

在 Harness Desktop 从 npm 安装 `@ljwei-stak/dsh-model-router@0.63.1`，或导入对应的 Release 安装包。

1. 在 Harness Desktop 打开 **插件 → 添加插件**，输入 `@ljwei-stak/dsh-model-router@0.63.1`，也可导入 Release 的 `.tgz` 包；本地解压安装时选择包含 `package.json` 和 `.dsh-plugin` 的内层 `package` 目录。
2. 启用插件后，**连同托盘进程一起完全退出 Harness**，再重新启动。只关窗口可能仍保留旧 Host。
3. 检查已加载包的版本并打开 Bot 工作区/产品导航。Provider 凭据和模型在 Harness 官方 **模型** 设置中配置。

使用 DSH CLI 安装指定正式版：

```powershell
dsh plugin --profile desktop add @ljwei-stak/dsh-model-router@0.63.1
```

仅执行全局 `npm install -g` 不会注册插件。包名仍为 `@ljwei-stak/dsh-model-router`，内部插件 ID 仍为 `model-router-galgame`，以保留设置。替换旧包前先移除重复插件条目；GAL 是独立插件。

自己生成归档时参见[源码开发](#development)。验证使用独立测试 profile；依赖声明或构建成功不能直接证明安装版 Desktop 已验收。

<a id="quick-evaluation"></a>

## 第一个 Bot 与第一个任务

1. 在 Harness **模型** 中添加 Provider/模型，然后新建或选择 Bot，绑定准确的已配置模型。
2. 打开 **Bot 绑定**，核对该 Bot 的工具、工作目录、机器权限与资金设置。角色说明本身不授予权限。
3. 在 Bot 设置中将协调 Bot 标记为 Main，并为执行 Bot 分别配置实际要用的模型和工具。
4. 发送一个产物明确、验收方式具体的小任务。检查任务状态及产物；已受理的计划 ID 代表已提交，不代表已完成。
5. 需要电脑操作时先完成下方配对；需要委派时开启 [Bot 路由](#bot-routing)，先预览候选决定。

集成模式复用 Harness Sessions。可选的独立运行时使用自己的会话存储，必须显式切换；同一 Bot 只能有一个正在服务的运行时。群聊、记忆、浏览器和长期上下文来自已固定的上游实现，而非占位能力清单。

Windows/云电脑安装：[下载 Agent 0.1.0 完整 Windows x64 包](https://github.com/Alice-Marx/dsh-model-router/releases/download/v0.63.0/dsh-remote-agent-0.1.0-windows-x64.zip)，解压后运行 `start.cmd`。

<a id="computers"></a>

## 连接自己的 Windows 或云电脑

### 在被控制的电脑上

1. 准备自己的 Windows x64 电脑/云电脑，并登录它的桌面。使用画面与输入时保持交互用户会话可用。
2. 将 **完整** `DSH-RemoteAgent-windows-x64-…zip` 解压到要长期保留的目录。完整包包含 Node、生产依赖、`dist`、安装/启动文件及原生 helper；只复制 `start.cmd` 或单个 exe 不够。
3. 双击 **`start.cmd`**。向导会让你选择工作目录、监听的具体本机/私有 VPN 地址、端口（默认 `9701`），以及 Harness 所在电脑能够访问的 Agent 基础 URL。
4. 跨电脑使用前先配置 WireGuard/Tailscale 或受保护隧道。只有已配置该私网时才确认私网隧道选项。本机使用或另行配置的 SSH 端口转发可使用回环地址。
5. 决定是否开启 **`hostManagedBots`**。显式开启后，这个可信、已认证 Host 可以在配对的目录/工具上限内授权现有及新建团队 Bot；关闭时必须填写固定的允许 Bot ID。它不会把配对密钥交给模型，也不会取消目录/工具限制。
6. 选择可选的命令/浏览器权限。向导为当前已登录用户注册 Agent 与桌面 helper 任务，不保存 Windows 密码；显示安装路径，并在其中生成 **`private/pairing.private.json`**。再次运行会保留已有配置和凭据。

### 在 Harness 中

1. 打开 **远程电脑 → 添加电脑**，导入 Agent 安装目录生成的 **`private/pairing.private.json`**。
2. 导入会自动填写 endpoint、机器/客户端标识、`rootIds`、工具和隧道选项。核对后按表单选择 Bot，再配对/探测。该文件包含 Host 配对凭据，应私下保管，不上传 Git 或问题报告。
3. 检查 **Bot 绑定** 和电脑授权。观看需要截图权限；接管及 routine 回放还需要获准的桌面输入工具和写入模式。`project` 等目录 ID 对应远端已配置工作目录，不是模型指定的路径。
4. 在 Bot 右侧 **电脑操作** 页签或电脑页面中选择电脑/显示器，点击 **连接桌面**，先以 **仅观看** 模式查看。
5. 点击 **取得控制权**，等待控制确认后再使用鼠标、键盘、滚轮或文字输入。真人控制期间会阻止该 Bot 冲突的桌面自动化；点击 **仅观看** 归还控制并释放按住的输入。
6. 点击 **放大** 进入铺满应用的查看界面，或在观看时双击；**关闭放大** 返回面板。结束后断开连接，留意任何停止尚未确认的提示。

桌面引擎使用 **Windows GDI 截图 → JPEG → WebSocket**，输入由原生端逐条确认。这是独立实现，不使用 RustDesk 协议。界面显示实测帧率；不承诺固定 30 FPS、已达到 RustDesk 性能、安全桌面采集或任意网络吞吐。Agent 可访问不等于已登录用户的桌面 helper 可用。

<a id="routines"></a>

## 演示、保存与回放例行任务

1. 连接桌面、取得控制权，将应用恢复到已知起始界面，输入例行任务名称，点击 **开始录制**。
2. 演示工作流。只有该桌面会话成功确认的输入进入录制。连续鼠标移动按 **200 毫秒** 采样为路径点；保留按钮/按键/文字/滚轮顺序以及这些动作之前的最终位置。
3. 点击 **结束并保存**。客户端等待输入队列、确认释放按住的输入，再保存到该 Bot 的私有 routine 存储。输入的文字会包含在录制中；缺少保存确认时保留草稿，不显示成功。
4. 打开 **例行任务**，选择 Bot/电脑并恢复起始界面，运行已保存任务，查看实际结果及停止步骤。
5. 最多保存 **200 个保留步骤**，保留动作之间的停顿最多 **60 秒**。回放核对准确显示器 ID、物理分辨率、坐标系及已录 DPI。应用状态/布局变化仍需要重新演示；采样鼠标轨迹不适合精细绘图。

这是有界的坐标与时序回放，不是通用视觉学习。回放会取得控制权，每个原生输入都等待 ACK，续期授权，并在完成、失败或取消时释放输入/控制。明确拒绝即停止后续步骤；已经发送但 ACK 丢失、断线或 Host 中断的输入会标记为 **unknown / 结果未知**，因为可能已经生效。

未知执行会阻止这个 Bot/电脑再运行 routine。先检查真实桌面，确认工作已经做到哪里，恢复适合下一次运行的界面，并填写检查说明后再解除阻塞。核对不会将旧结果改为成功，也不会自动重跑。请求停止不等于确认停止；所有输入 ACK 成功也不能单独证明业务目标已经达成。

<a id="bot-routing"></a>

## 在 Bot 之间路由工作

1. 先为 Main 和执行 Bot 配置准确模型、官方工具及机器/工作区授权。
2. 在 **任务 → Bot 路由** 开启路由，选择 **省钱优先**、**均衡** 或 **效果优先**，使用对应控件保存设置。
3. 输入任务，选择自动路由或指定 Bot；需要时选择电脑/目录和只读、写入、桌面或浏览器操作。**预览路由** 会显示选中者、缺失条件/落选原因及拟新增绑定。
4. 点击 **按此路由创建任务** 才会真实派发。可选的自动电脑授权仍受已提交机器上限与发起 Main Bot 可委派范围限制。
5. Main Bot 可以调用 **`bot_route_task`** 或同义工具 **`bot_dispatch`**，两者默认都会派发。显式 **`preview:true`** 仅预览，不创建任务、不新增授权。通过 `bot_task_plan_status` 查看真实计划/任务状态，并检查产物后再报告完成。

候选来自已提交的 Bot 模型/工具/机器状态，包括可用性与已配置价格/质量证据。Bot 名称或提示词不能授予端点、可执行文件、凭据或操作身份。执行 Bot 的每次模型请求单独进行预算准入并生成与父任务关联的收据；任务获准不等于后续所有模型调用都被统一放行。

<a id="library"></a>

## 使用 Bot 私有文件资料库

打开 **资料库**，选择 Bot 和文件夹，可以上传本地文件、新建/进入文件夹、编辑支持的文本与下载文件；名称筛选只缩小当前目录条目。需要正文检索时输入字面查询并点击 **搜索文本**。结果显示文件路径、行号和匹配文本；点击路径可打开并选中对应行，修改后显式保存到该文件。

二进制上传/下载保留原始字节，每个文件最多 **16 MiB**。文本读取/编辑每文件最多 **1 MiB**。文本搜索不区分大小写，查询最多 256 字符，在选中 Bot 的库内最多扫描 500 个条目/8 层目录，从符合条件的文本文件返回最多 50 行匹配。已授权的 `bot_library_search` 工具复用相同后端，只搜索实际调用 Bot 自己的库。同名上传会被拒绝。

资料库是该 Bot 的私有文件区，与上游头像库、远端机器工作区不同。上传 PDF 或 Office 文件不代表自动提供 OCR、语义索引或对所有二进制格式的检索。模型通过已获准的资料库工具访问自己的文件，不能靠传入另一个 Bot ID 读取其私有区。

<a id="workbench"></a>
<a id="official-tools"></a>
<a id="session-tools"></a>
<a id="team-lifecycle"></a>
<a id="architecture"></a>

## 模型工作台、工具与执行边界

打开 **高级工作台** 使用模型路线规划、准确路线档案、官方工具、终端、带依赖工作包以及 API/订阅核算。Provider 凭据在 Harness 模型页面配置，厂商 CLI 使用自身登录。检测或安装成功不能证明登录、模型权益或某种托管执行模式可用。

规划与候选预览在本地进行。执行可能将任务/上下文发送给选中的供应商或 CLI，并产生费用。模型路由选择模型路线，Bot 路由选择已配置 Bot 并派发真实执行任务；两者共用已提交的 Host 权限与核算，不从模型参数接受权限。

官方工具注册表包括 Kimi Code、Claude Code、Codex、MiniMax Code、MiMo Code、Grok Build、Gemini、OpenCode、StepCode、Pi、Hermes、ZCode 和 DSH TUI。能否运行取决于工作台显示的平台和执行模式。交互终端使用当前系统用户权限；显式选择厂商原生环境的可编辑进程不在 Harness 进程沙箱内，worktree 只归集修改，不限制系统访问。

任务保留 task/attempt/operation 身份、结果及未知影响证据。根据任务状态和验收标准判断完成，不从已生成计划、安装方法、权限检查通过或方法名称推断完成。API 金额/预占与订阅调用次数/已报告 token 独立记账，缺失用量保持未知。

下方保留的数学参考描述 **模型路线工作台**；Bot 选择和桌面 routine 回放属于另外的工作流。

<a id="costs"></a>

## 成本、订阅与质量

- **API 预算：** 单次规划目标与日/月金额检查用于 API 计费执行。启动时原子检查已记录 API 支出和其他 API 预占，再为本次 API 估计预占。有限预算下，API 单价、费用或预占未知需要显式确认；后续 API 调用会按最新支出与预占重验。已确认的订阅通道不占 API 金额，也不会仅因 API 预算用满或单价缺失而被阻止。订阅转 API 是一次新的金额准入：按实际 API 路线估价、取得所需确认并原子预占后才调用。本地估计不是厂商硬性扣费上限。
- **检查点与中断：** 路由执行、重跑/改派、官方团队、单工具运行和会话咨询共用持久执行生命周期。可选复核和质量升级在追加调用前预占额度。质量升级启动前，先保存首个收据与待核对的追加尝试，避免中断时抹掉首次费用或把第二次尝试视为免费。界面区分实际支出与预占，预占不是账单。确认进程退出后仍保留中断预占及未知用量证据以供核对；仅凭经过时间不会释放，也不会自动重放调用。
- **订阅优先：** 默认优先检测到的 CLI 账号订阅或已配置 coding-plan 路线。CLI 订阅尝试会移除 API-key 环境变量。`billing` 可为 `subscription-first`、`api-only` 或 `subscription-only`；`subscription` 可为 `cli-login`、`plan-key` 或 `none`。
- **回退：** 检测到额度耗尽/限流时，将订阅标记为冷却，并可按策略与可用性在已配置 API 路线上重试该路由步骤。其他已尝试的订阅失败默认暂停（`onSubscriptionFailure: "ask"`）：可在历史中选择 API 重试、订阅重试或取消。订阅切换到 API 时，必须按实际 API 路线重新估算并检查预占。缺少价格或超出有限预算时，需要相应确认；未获确认不会启动 API 调用。托管可编辑/单工具/团队运行不会自动在 API 上重试。
- **订阅用量：** 独立记录日/月调用次数、已报告输入/输出/缓存 token 和未知/不完整用量次数，并按供应商、工具、模型分组。缺失计数不视为零。订阅转 API 时同时保留订阅用量收据和 API 计费结果。旧记录的参考美元字段可保留，但当前订阅统计不再把它折算为金额，也不据此补造 token。token 数不能证明厂商订阅总额度、剩余额度或已用百分比。
- **API 核算：** 对 API 计费结果，有效的 CLI 报告金额（包括零）优先采用。否则按 token 计算 CLI 费用，需要完整用量，以及报告实际模型匹配已配置单价或显式 CLI 映射。身份未知或不匹配时 API 费用保持未知；推荐路线价格不能证明实际成本。CLI 使用 API Key 时仍属于 API 计费，厂商账单为准。重跑替换的收据和已裁剪历史保留先前核算。
- **质量与偏好：** 可选 `off`/`sample`/`always` 更强模型复核可能增加付费调用，且不作为人工反馈。显式评分以时间衰减和小样本收缩，调整精确路线、任务类型对应的独立主观效用（默认上限 ±0.04，可配置至 ±0.1）。评分不改变客观质量分或其硬下限；可禁用学习、撤回评分或重置学习起点。

Coding-plan 密钥与端点保留在 Harness 供应商设置中。`plan-key` 配置可将已配置的精确 `apiRoute` 指定为回退；路线编辑器不接受凭据或任意命令。厂商套餐资格与条款需向厂商核实。

### 实际费用与规划估计

下面公式用于 API 计费结果。算法中的路线价格比较是规划输入，不会把订阅变成 API 账单；执行预览分别显示 API 金额和订阅预估 token。

对 API 计费结果，有效的 CLI 报告美元金额（包括明确的零）优先于 token × 单价计算。否则，按 token 核算 CLI 费用要求完整、归一化的用量，已知非负价格，以及报告的实际模型匹配计价路线或其显式 CLI 映射：

<!-- formula:actual-cost -->
```math
C_a = \frac{I_u p_i+O p_o+R p_r+W p_w}{10^6}
```

$`C_a`$ 对应 `actualUsd`；$`I_u`$、$`O`$、$`R`$、$`W`$ 分别对应 `inputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens`，$`p_i`$、$`p_o`$、$`p_r`$、$`p_w`$ 分别为输入、输出、缓存读取和缓存写入单价，单位为美元/百万 token。

经适配器归一化后，这些账本计数互不重叠；不要把缓存 token 再加到已包含缓存的输入计数中。缺少可选缓存单价时，使用输入单价。用量不完整、价格缺失或身份未知/不匹配时，金额保持 `null`，不是零。完整的终态证据可在失败、取消、超时后保留；部分事件标记为 `usageIncomplete`。

例如，完整 API 结果含 1,000 个未缓存输入 token（\$1/百万）和 500 个输出 token（\$5/百万），费用为 \$0.0035。订阅结果记录已报告 token 和调用次数，不折算成 API 金额。API 尝试中厂商报告的 \$0 是该次尝试的明确证据，不能证明先前费用未知的尝试免费。实际厂商账单为准。官方团队模式不自动回退 API，但厂商 CLI 使用自身 API 凭据时仍产生 API 计费。

<a id="routing"></a>

## 路由算法

手动分配：生成任务建议后，可选择按算法推荐执行，或逐包指定模型 API / 官方工具。参见[手动分配使用说明](https://gitlab.com/Alice_marx/dsh-model-router/-/blob/main/docs/MANUAL_TASK_ASSIGNMENT.zh.md)。

规划器是确定性的本地启发式算法，不是训练得到的成功率预测器。它对文本分类、估计复杂度、创建适当的分析/执行/验证/汇总工作包，发现精确的已配置路线，叠加路线配置，并应用能力/质量约束。显式指定路线会跳过与其他路线的比较。目录质量/延迟/风险提示是实验性先验，不是实测成功概率或厂商实时报价。执行当前以文本为主；vision 标签不能证明已有端到端多模态流水线。

### Token 与价格估计

没有匹配资源证据时，基础输入 token 为 $`\max(80,\lceil n/3.7\rceil)`$，再乘以工作包阶段系数。基础输出为 900，按阶段/推理强度调整，最少 220。其中 $`n`$ 对应 JavaScript 的 `text.length`。这是按文本长度估算，不是厂商 tokenizer。匹配的完整历史记录达到样本门槛后，改用经验 P90 资源估计，不再重复乘档位和阶段系数。令 $`I`$ 为估计输入总数，$`R`$/$`W`$ 为缓存读取/写入部分，$`O`$ 为输出，价格单位为美元/百万 token：

<!-- formula:planning-cost -->
```math
C = \frac{(I-R-W)p_i+O p_o+R p_r+W p_w}{10^6}
```

<!-- formula:cost-utility -->
```math
U_c = \frac{1}{1+C/\max(C_{\mathrm{ref}},10^{-12})}
```

$`U_c`$ 对应 `costUtility`，单价符号与上文一致。$`C_{\mathrm{ref}}`$ 使用固定参考价（输入 1、输出 5、缓存读取/写入 1 美元/百万），不是厂商报价。固定尺度防止一个无关的昂贵候选把所有费用惩罚压平。未知价格的公开估计为 `null`，费用效用为 0。内部无预算约束搜索使用费用哨兵值 0，但有限预算分配会排除价格未知候选；哨兵值绝不代表执行免费。

### 候选目标与质量下限

使用归一化质量 $`q`$，以及归一化延迟、领域匹配、推理匹配和风险代理值：

<!-- formula:latency-utility -->
```math
L = \begin{cases}
\dfrac{1}{1+t/10\,000}, & t\text{ known}, \\
1-\min(1,\max(0,\ell e_\ell)), & \text{otherwise}.
\end{cases}
```

<!-- formula:candidate-utility -->
```math
u = w_q q+w_c U_c+w_\ell L+w_s s+w_r r-w_k k-\alpha\max(0,f-q)+\Delta_p
```

<!-- formula:assignment-score -->
```math
S = \sum_{j=1}^{n}u_j - 0.015\sum_{(i,j)\in E}\mathbf{1}[\rho_i\ne\rho_j]
```

$`L`$ 为延迟效用：$`t`$ 是匹配历史的 P90 耗时，单位为毫秒；未知时使用延迟代理值 $`\ell`$ 及档位系数 $`e_\ell`$。效用式中，$`s`$/$`r`$/$`k`$ 分别是领域匹配、推理匹配和风险，$`f`$ 为质量下限，$`\alpha`$ 为关键性，$`\Delta_p`$ 为有界的 `preferenceAdjustment`；各 $`w`$ 为对应权重。$`S`$ 对应 `assignmentScore`，$`E`$ 为依赖边集合，$`\rho_j`$ 为工作包 $`j`$ 的 `provider/model` 路线；指示函数在路线不同时取 1，否则取 0。

质量优先使用足量且匹配的任务客观证据，再回退对应任务类别的 LiveBench 分数、整体 LiveBench、路线配置/目录估值。至少两个 API 档位各有可用任务证据时，才联合比较模型与档位；经验耗时可替换延迟代理项。公共数据刷新默认关闭，需主动启用。人工评分仅影响有界的 `preferenceAdjustment`，不能提高客观质量或满足质量下限。

| 工作包基础类型 | 质量 | 费用 | 延迟 | 领域 | 推理 | 风险 |
| --- | --- | --- | --- | --- | --- | --- |
| 简单 | 0.28 | 0.45 | 0.14 | 0.04 | 0.07 | 0.02 |
| 均衡 | 0.40 | 0.26 | 0.10 | 0.09 | 0.10 | 0.05 |
| 复杂 | 0.48 | 0.14 | 0.06 | 0.14 | 0.11 | 0.07 |
| 汇总 | 0.58 | 0.08 | 0.04 | 0.08 | 0.16 | 0.06 |

简单/均衡/复杂任务的基础质量下限分别为 **0.75 / 0.78 / 0.82**；关键复杂包会提高下限，复杂任务的汇总包至少为 0.84。省钱预设把质量/费用/延迟权重分别乘以 0.75/1.6/1.1，并把下限降低 0.04。效果优先把质量/费用/领域/推理权重分别乘以 1.35/0.5/1.2/1.2，并把下限提高 0.04。倾斜后的权重重新归一化到原总量；调整后的下限限制在 [0.5, 0.97]。均衡不作倾斜。

### 候选裁剪与分配搜索

1. 优先保留达到各工作包质量下限的候选。若没有合格候选，保留质量最高的至多三个回退候选，并报告约束放宽。
2. 每包最多保留 **12 个候选**，包含最低已知费用、最大效用与最高质量的锚点。存在依赖时禁用局部 Pareto 裁剪，因为路线身份会影响交接。
3. 验证工作包 ID 唯一且依赖按拓扑排序。保留候选的笛卡尔空间大小不超过 **4,096** 时精确搜索；否则采用 **beam width 256**。搜索按未来依赖的模型边界压缩被支配前缀，并用未来交接的乐观估计排序。剩余最小费用用于裁剪不可行前缀；有限预算时，beam 会保护最便宜的可行前缀。
4. 按字典序比较分配：更少放宽包、更小质量缺口、更高效用、更低费用、更少路线切换，最后稳定的路线顺序。最小费用模式先比较费用，再比较效用。每条跨越 `provider/model` 路线的依赖边从效用中扣除 0.015。
5. 报告搜索元数据与可行性。正预算下若不存在可行分配，仍可返回最小费用备选，但标记 `budgetFeasible: false`。显示了计划不代表预算已满足。

“精确”仅适用于保留下来的候选空间与代理目标。候选上限和 beam 裁剪意味着不能声称在所有已配置模型上全局最优。单元/合成测试验证机制，不证明真实回答质量提升。研究审查使用的公开 2026-06-25 LiveBench 分数/费用表属于汇总数据；未取得逐题配对的质量/费用矩阵，因此不主张真实路由收益。参见[研究](https://gitlab.com/Alice_marx/dsh-model-router/-/blob/main/docs/ROUTING_RESEARCH.zh.md)、[推导/实验](https://gitlab.com/Alice_marx/dsh-model-router/-/blob/main/docs/ROUTING_DERIVATION_EXPERIMENTS.zh.md)与[验证规程](https://gitlab.com/Alice_marx/dsh-model-router/-/blob/main/docs/ROUTING_LIVEBENCH_VALIDATION.zh.md)。

证据导入、回退条件、推理档位与可选 JSON 验收升级的设置参见[算法优化使用说明](https://gitlab.com/Alice_marx/dsh-model-router/-/blob/main/docs/ROUTING_ALGORITHM_OPTIMIZATION.zh.md)。验收升级默认关闭，启用后仍需通过计费与预算检查，最多增加一次普通 API 调用。

实现：[router.mjs](.dsh-plugin/shared/router.mjs)、[assignment-solver.mjs](.dsh-plugin/shared/assignment-solver.mjs)、[routing-evidence.mjs](.dsh-plugin/shared/routing-evidence.mjs)、[harness-plan.mjs](.dsh-plugin/shared/harness-plan.mjs) 与 [quality-gates.mjs](.dsh-plugin/shared/quality-gates.mjs)。

<a id="data"></a>

## 数据与隐私

Provider 凭据和认证会话由 Harness 管理。路由状态/收据位于 `<DSH_HOME>/model-router/`；产品还在其中保留已提交 Bot 绑定、任务记录、私有资料库与 routine/执行账本。上游 Bot home 按配置位置保留对话、记忆、浏览器状态及相关团队文件。远程 Agent 状态与配对凭据留在被控电脑的安装目录。

发送给供应商或 CLI 的任务/上下文适用对应服务的账户和计费条款。已保存 routine 包含演示输入的文字。配对导出、历史、日志及私有文件应作为私有数据保管。更换运行时所有者或降级前备份应用状态，不删除收据或未知操作账本来绕过阻塞。

GitHub 保留当前程序、构建工具和针对产品的测试；完整测试、历史文档和验收报告位于 [GitLab 全量归档](https://gitlab.com/Alice_marx/dsh-model-router)。

<a id="development"></a>

## 从源码开发和构建

需要普通 **Node.js 22.19+** 和 **pnpm 10.34.6**（仓库固定的包管理器版本）。原生 SQLite/PTY 模块必须使用匹配的普通 Node 运行时，不能通过不兼容的 Electron ABI 加载。在仓库根目录执行：

```powershell
npm install --include=dev
npm run build:client
npm run check:client
node scripts/check-readme.mjs
npm test
node scripts/integration-product-source.mjs
npm --prefix remote-computer-agent ci
npm --prefix remote-computer-agent run build
npm run pack:local
```

在测试 profile 中安装生成的 `dist/*.tgz`。`npm run preview:ui` 是离线 fixture 预览，不是认证 Host 验收。配置的 registry 无法提供 SDK 包时，`scripts/setup-harness-dev.mjs` 支持显式指定已安装 Host 树；按其选项操作，不静默替换任意 SDK 版本。

安装 Agent 依赖后，可以在 Windows x64 上生成完整包：

```powershell
powershell -NoProfile -File scripts/package-remote-agent.ps1
```

打包脚本构建原生 helper，包含普通 Node 与生产依赖，验证 SQLite 后在 `tmp/integration/remote-agent-package/` 创建 zip，输出产物路径和 SHA-256。安装向导在用户准备的 Windows 电脑上运行，不在源码打包时运行。

### 复现固定上游运行时

不要直接编辑 `modules/bot-runtime/vendor/ds-bot/`，产品修改应放在外置 overlay。导入时显式指定来源 checkout 和固定提交：

```powershell
node scripts/sync-ds-bot.mjs --source ../DS-Bot-upstream --source-commit 71d344bf193f3f18185f25de3d8e5c483046910a
node scripts/sync-ds-bot.mjs --check --source ../DS-Bot-upstream --source-commit 71d344bf193f3f18185f25de3d8e5c483046910a
npm run build:client
npm run check:client
```

不带来源参数的 `node scripts/sync-ds-bot.mjs --check` 只检查已记录的 vendor 字节，不猜测同级 `../ds-bot`。有意升级上游时要检查来源提交与 overlay 应用结果。`.dsh-plugin/client.js` 是生成文件。

双语 README 保留 6 个展示公式和 33 个行内数学表达式。修改两份翻译后，将准确 Git blob SHA-1 写入 `README.i18n.yaml`，运行 `node scripts/check-readme.mjs` 和 `node --test tests/readme-math.test.mjs`。结构校验不能代替实际渲染检查。

## 验证范围与当前限制

真实 **SDK 0.2.1-rc.4** Host 集成已经走通 Main 工具 → 路由后的执行 Bot AgentLoop → 私有资料库写入 → 任务 `succeeded`。执行 Bot 每次模型请求分别进行预算准入，并关联父任务。这是该路径的证据，不代表所有 Host/浏览器探针、安装版 Desktop 变体、厂商账户或真实云电脑部署都已通过。后续验收应绑定实际测试配置。

本地 WebSocket/React 测试覆盖已确认录制、私有保存/读回、使用假 native transport 的真实回放效果、取消、清理、未知恢复与准入拒绝。Windows 原生/Agent 检查与该 fixture 分开。实际桌面 FPS 取决于采集、分辨率、网络及客户端解码，界面显示的实测帧率才是对应观察。

Grok 工作流审计采用此前抓取的公开需求清单；本轮重访官网受网络/Cloudflare 阻挡，并非新的完整产品盘点。岗位简报是模板，不是已接通 CRM/广告/报销系统的业务服务。不宣称提供自动云 VM 创建、云计费服务、自有 iOS 发布或完整商业 Grok 对等实现。

全量源码归档包含[电脑/Bot 指南](https://gitlab.com/Alice_marx/dsh-model-router/-/blob/main/docs/COMPUTER_BOT_GUIDE.zh.md)、[上游证据](https://gitlab.com/Alice_marx/dsh-model-router/-/blob/main/docs/implementation/20261105-upstream-parity.md)、[工作流边界](https://gitlab.com/Alice_marx/dsh-model-router/-/blob/main/docs/implementation/20261105-grok-workflows.md)及[桌面引擎证据](https://gitlab.com/Alice_marx/dsh-model-router/-/blob/main/docs/implementation/20261105-desktop-engine.md)。上文已给出核心操作，因此只含代码与 README 的分发也能独立使用。项目发布规则为 GitHub 保留代码和 README，完整文档/历史放到 GitLab 归档。

<a id="troubleshooting"></a>

## 排查问题

| 现象 | 检查内容 |
| --- | --- |
| 更新后仍是旧 UI/版本 | 完全退出托盘 Host，确认安装包位置/版本并重启。 |
| 无路线或没有可用执行 Bot | 准确模型、允许工具、机器/目录授权、当前可用性及预览中的拒绝原因。 |
| `TOOL_DENIED` 或任务受阻 | 查看实际已提交 Bot 权限和请求操作，不扩大模型提供的身份，也不将角色提示词视为授权。 |
| Agent 在线但没有桌面 | 当前已登录 Windows 会话、两个安装任务、full-desktop helper 及原生日志。 |
| 连接不到 Agent | 可访问的基础 URL/端口、已配置的私有 VPN/隧道；导入配对文件不会建立网络。 |
| 可以观看但接管按钮不可用 | 所需桌面输入工具、写模式授权及当前控制权占用。 |
| Routine 提示显示器变化 | 恢复录制时显示器/分辨率/DPI，或重新录制；应用布局也要一致。 |
| 结果未知或停止未确认 | 检查实际电脑和执行记录后再解除阻塞，不盲目重跑、不删除账本。 |
| 资料库拒绝文件 | 二进制传输每文件最多 16 MiB，文本编辑/读取最多 1 MiB，同名上传会被拒绝。 |
| API/订阅金额未知 | 检查实际模型身份、价格和供应商用量证据，缺失计数不是零。 |

## 历史版本

旧 0.20.x–0.26.x 发布说明、截图和实验仅作为对应版本的历史证据，不是当前安装说明，也不是本 preview 的稳定发布公告。包名：`@ljwei-stak/dsh-model-router`；入口：`.dsh-plugin/index.mjs`；许可证：[MIT](LICENSE)。
