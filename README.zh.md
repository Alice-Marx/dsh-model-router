# Model Router · DeepSeek Harness 模型路由插件

**0.12.0 将模型路由与 GAL 拆成两个独立插件。** 路由器分析问题、判断难度，在用户已配置的模型中选择合适路线：简单工作更重视费用，困难工作更重视质量，复合任务拆成有依赖的工作包，再由支持的官方模型工具执行。

npm 包名仍为 `@ljwei-stak/model-router-galgame`，便于原用户直接升级；**0.12.0 只提供“模型路由”入口**。要玩剧情、调整立绘、听音乐或自由对话，请另装 [DeepSeek Harness GAL](https://github.com/Alice-Marx/deepseek-harness-galgame)。两个插件互不依赖，可单独安装，也可同时安装。

[English](README.md) · [安装与验证指南](INSTALLATION_GUIDE.zh.md) · [迁移说明](MIGRATION.md) · [独立 GAL 仓库](https://github.com/Alice-Marx/deepseek-harness-galgame)

> **宿主版本：**模型路由 0.12.0 与 GAL 0.1.0 均声明支持 DeepSeek Harness Desktop **0.2.0-rc.1 和 0.2.0-rc.2**。宿主仍是预发布版本，本轮发布使用 npm `next` 标签；推荐精确版本安装，不要依赖裸包名或不断变化的标签。

![本地规划、按难度选模型与官方工具执行流程](docs/assets/routing-workflow.svg)

*图：路线来自 Harness 官方模型目录，质量与价格可由用户补充。生成计划在本机完成，不会启动 CLI 或消耗模型 token。*

![官方 rc.2 中的独立路由 0.12.0](docs/assets/router-only-0.12.0.png)

*本轮隔离 rc.2 profile 实拍：仅安装路由插件，左侧没有 GAL；显示内置路线，没有调用真实模型账号。*

## 目录

- [安装与版本选择](#安装与版本选择)
- [开始使用](#开始使用)
- [工作台页面怎么用](#工作台页面怎么用)
- [体检、成本与质量回路](#体检成本与质量回路)
- [路由算法：从输入到分配](#路由算法从输入到分配)
- [官方工具与执行边界](#官方工具与执行边界)
- [可选安装 GAL](#可选安装-gal)
- [验证与开发](#验证与开发)

## 安装与版本选择

在 **DeepSeek Harness Desktop → 插件 → 添加插件** 中，按需求填写一个完整包名：

| 安装内容 | 输入框填写 | GitHub 仓库 |
| --- | --- | --- |
| 模型路由、模型档案与官方工具 | `@ljwei-stak/model-router-galgame@0.12.0` | [Model Router](https://github.com/Alice-Marx/model-router-galgame) |
| GAL 剧情、自由模式与播放器 | `@ljwei-stak/dsh-galgame@0.1.0` | [DeepSeek Harness GAL](https://github.com/Alice-Marx/deepseek-harness-galgame) |

1. npm 安装源选择官方 **HTTPS** 地址 `https://registry.npmjs.org/`；国内镜像尚未同步时可改用此源或版本化 GitHub 安装包。
2. 核对安装预览版本与宿主版本，安装并启用；有重启提示时重启。
3. 路由详情应为 **0.12.0**，侧边栏显示 **模型路由**；独立 GAL 详情应为 **0.1.0**，另显示 **Gal 模块**。

普通使用不需要 `npm install -g`：全局 npm 安装不会注册到当前 Harness profile。路由与 GAL 都可以不安装另一插件而运行。

### 从合并版 0.11.x 升级

1. **先备份**：旧版 GAL 中对需要保留的剧情进度使用“导出存档”，并备份 Harness profile。JSON 仅包含当前剧情状态，不包含全部手动槽、设置、已读记录与本地音乐。
2. 在**同一个 profile**安装 `@ljwei-stak/dsh-galgame@0.1.0`。
3. 用插件管理器把原 `@ljwei-stak/model-router-galgame` 更新到 **0.12.0**。完成两项更新后再游玩；旧合并插件的 GAL 入口随路由升级移除，只留下新 GAL 插件的入口。
4. 打开独立 GAL 检查进度。它保留原 localStorage 存档键；更换 profile 或没有读到旧进度时，先选择对应剧目，再导入备份 JSON。

独立 GAL 核心只内置**《回声之城·正篇》**和**《旧城迁移篇：未写完的约定》**。此前分出的其他篇目保留在源代码归档，不随这两个核心插件发布。完整迁移步骤见[迁移说明](MIGRATION.md)。

### 使用 GitHub 安装包

从[路由 v0.12.0 Release](https://github.com/Alice-Marx/model-router-galgame/releases/tag/v0.12.0)或[GAL v0.1.0 Release](https://github.com/Alice-Marx/deepseek-harness-galgame/releases/tag/v0.1.0)下载 `.tgz`，在添加插件输入框填写文件绝对路径，例如：

```text
D:\Plugins\ljwei-stak-model-router-galgame-0.12.0.tgz
```

如附有 `.sha256` 校验文件，使用以下命令计算摘要并比较：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'D:\Plugins\ljwei-stak-model-router-galgame-0.12.0.tgz'
```

也可解压并填写内层含 `package.json` 和 `.dsh-plugin` 的 `package` 目录。安装包可放到自选磁盘；运行数据位置由宿主 profile 决定。不要改 `app.asar` 或绕过依赖检查。

### 历史版本

| 版本 | 声明的宿主 | 功能范围 |
| --- | --- | --- |
| **模型路由 0.12.0** | **0.2.0-rc.1 / rc.2** | 独立路由；GAL 另装。推荐精确版本，可用 `@next` 跟随该预发布渠道。 |
| **GAL 0.1.0** | **0.2.0-rc.1 / rc.2** | 独立 GAL 首版，两部核心剧目。推荐精确版本。 |
| [合并版 0.11.1](https://github.com/Alice-Marx/model-router-galgame/releases/tag/v0.11.1) | 0.2.0-rc.1 / rc.2 | 历史路由与 GAL 合并包；修正 0.11.0 发布说明。 |
| [合并版 0.11.0](https://github.com/Alice-Marx/model-router-galgame/releases/tag/v0.11.0) | 0.2.0-rc.1 / rc.2 | 历史播放器更新。 |
| 0.10.2 | 0.2.0-rc.1 / rc.2 | 未发布的本地兼容修复。 |
| [0.10.1](https://github.com/Alice-Marx/model-router-galgame/releases/tag/v0.10.1) | 0.2.0-rc.1 | 历史发布版；rc.2 会拒绝其 peer 范围。 |
| [0.9.0](https://github.com/Alice-Marx/model-router-galgame/releases/tag/v0.9.0) | 0.2.0-rc.1 | 历史官方桌面适配版。 |
| 0.8.0 | 0.1.7-rc.2 依赖 | 与当前 0.2.0-rc.1 / rc.2 不兼容。 |
| 0.4.32 | 旧 DSH settings 依赖范围 | 历史发布记录，不用于当前宿主。 |

不要根据旧包名中的 `galgame` 判断功能范围；以版本和安装预览为准。旧版本与历史 Release 保留，不覆盖、不撤包。

## 开始使用

1. 在宿主的**模型**页配置要用的供应商、模型和凭据。插件只从官方目录读取准确的 `provider/model` 路线，不替用户创建模型账号，也不另存 API Key。
2. 打开**模型路由 → 逐模型价格与能力**。为准备比较的每条路线填写自己认可的质量评分（0–100）、输入/输出单价（USD / 百万 token）、擅长方向；有缓存价格时可另外填写。未知项可以留空，界面会说明估价缺失。
3. 输入任务，先查看单任务、团队计划，或在**指定模型**里直接选一条已配置路线。结果会给出复杂度、工作包目标与依赖、质量门槛、推荐路线、预计费用及 `official-cli` / `harness-llm` 渠道。规划本身**不会调用付费模型**。
4. 在**逐模型价格与能力**里可以为每条路线选择执行方式：`auto` / `official` 优先该厂商官方工具，缺失或失败时回退模型目录 API；`api` 始终走模型目录。不填写时按 `auto`。
5. 在**官方工具**卡片上检测、一键下载安装或修复执行入口。工具就绪只说明安装与可信入口通过核验；首次登录、模型权限和真实费用仍要在对应厂商账号中验证。
6. 在官方会话里使用 `model_router_execute` 按计划或指定模型执行并汇总结果。`model_router_consult` 仍是一次模型目录咨询；`model_router_tool_run` 跑一个已核验的官方 CLI；`model_router_team_execute` 按依赖顺序执行可编辑工作包。可编辑任务需要干净的测试 Git 仓库，并经过宿主的工具审批。 体检、重跑和评价另有 `model_router_health`、`model_router_rerun_step`、`model_router_rate`，见下文。

![0.9.0 隔离安装后的桌面官方工具面板](docs/assets/desktop-official-tools-0.9.0.png)

*图：历史 0.9.0 在官方 Desktop 0.2.0-rc.1 隔离 profile 的实拍。截图里的“Gal 模块”来自当时的合并插件，路由 0.12.0 已移除该入口；账号与安装状态仅属于验证环境。*

## 工作台页面怎么用

![模型路由工作台的操作位置示意](docs/assets/workbench-usage.svg)

*图为不含个人任务内容的操作示意，不是桌面实拍。完整的逐项教程与排障见[工作台使用指南](docs/WORKBENCH_USER_GUIDE.zh.md)。*

1. **先看右侧“模型目录”**：顶部“供应商数 · 路线数”表示 Harness 已登记的 `provider/model`；搜索框只过滤显示，“刷新”重新读取目录。卡片上的“推理等级”不是价格、质量分或登录状态。若列表为空，先去 Harness 官方“模型”页添加供应商与模型。
2. **要比较费用，先向下配置档案**：在“逐模型价格与能力”里选择准备使用的准确路线，填写自报质量评分（0–100）和核对过的输入/输出价格（均为 USD / 百万 token），按**保存此模型**；每条待比较路线分别保存。擅长标签和厂商 CLI 模型名可选。没有价格就留空，不要把未知写成零。
3. **写“任务描述”**：可以粘贴长提案，但最好把要交付的步骤写成编号条目，并写清验收标准。“单任务”只给单项路线建议；“团队分工”会把可执行需求拆成有依赖的工作包，最多六个显式执行包。“指定模型”不比较其他路线，整项任务都交给下拉框里选中的那一条。
4. **设置预算并生成**：“本次估算预算（USD）”中的 `10` 只是本地估价目标，`0` 表示规划不设预算；两者都**不会限制真实账号扣费**。点**生成路由建议**后，继续向下滚过“逐模型价格与能力”，找到新增的**路由建议**卡片。按钮不会启动模型。
5. **读结果**：先核对推荐 `provider/model`、复杂度、估算总成本、执行渠道与警告；团队模式再逐包核对目标、难度、依赖、建议模型、估价和验收项。`官方 CLI` 说明本机相应入口可托管；`模型目录 API` 说明可通过 Harness 模型目录调用，但不等于这个包能由插件的 CLI 团队执行器运行。修改任务、预算或档案后重新生成。
6. **需要实际工作时另开官方会话**：在左侧点**新会话**并选好工作区。要按工作台结果执行，请求 `model_router_execute`；若只要某一个模型，同时给出该路线的 `provider` 和 `model`。`model_router_consult` 只做模型目录咨询。`model_router_tool_run` 与 `model_router_team_execute` 仍负责已核验 CLI 的可编辑任务。团队执行会按照**当前已就绪且支持所选模式的官方 CLI**重新规划，可能与页面上刚才的静态建议不同；它不会直接读取那张结果卡作为执行清单。

例如，要先给一个三分钟科幻短片做**前期规划**，可以在任务描述中输入：

```text
目标：先交付 3 分钟科幻短片的前期制作方案；不要声称已生成成片。
1. 压缩故事结构，交付约 12 个镜头的分镜文字表和时长。
2. 列出角色、场景、声音、字幕资产与命名规则。
3. 设计素材清单、构建脚本和验收步骤，标明所需软件。
4. 检查总时长、版权、字幕和输出格式，列出待确认事项。
验收：每项写明输入、输出文件名与检查方法。
```

先选**团队分工**、预算填 `0`、点**生成路由建议**并向下看结果；补齐价格后再用 `10` 等估价目标比较方案。如果只想在会话里再得到一次计划，可发送“请调用 `model_router_plan`，按 `team` 模式规划以下任务，`budgetUsd=10`，先不要执行”。若确认要调用已安装 CLI，可在**测试仓库**中请求“请调用 `model_router_team_execute`，对同一任务先以 `read-only` 模式执行可完成的文字/代码检查，并报告每包的实际状态”。想让 CLI 写文件时改为 `workspace-write`，需要干净 Git 仓库及宿主审批。真实执行可能计费。

当前插件能规划短片任务，并通过已适配的官方**模型编程 CLI**处理它们有能力完成的文本或代码工作。**“生成路由建议”不会操作 Blender、ComfyUI、剪辑软件或导出视频。** 要交付成片，还需为相应创作软件提供可调用的工作流、素材、权限和人工验收。详见[工作台使用指南](docs/WORKBENCH_USER_GUIDE.zh.md)的单工具、团队和常见问题章节。

## 体检、成本与质量回路

工作台顶部按下面顺序展示这些能力。会话内对应的工具在括号里。

1. **开箱体检**（`model_router_health`）。第一次打开工作台时，会对注册表里的每个官方工具检查三件事：是否安装、版本是否等于本版固定版本、是否已登录。登录检查只跑很便宜的状态命令，每条超时都很短：Claude 用 `claude auth status --json`，Codex 用 `codex login status`。Gemini 根据 `GEMINI_API_KEY`/`GOOGLE_API_KEY` 或 `~/.gemini/oauth_creds.json` 推断。其他工具暂时显示“登录状态未知”。体检不会发起登录。
   - 未安装的工具点**一键安装**，复用原有的固定注册表安装器。
   - 未登录的工具点**去登录**，查看并复制登录命令。
   - 体检结果缓存 10 分钟。路由会**立刻跳过未登录的 CLI**，直接走模型目录 API；以前 Codex 要等约 14 秒才失败回退。配置了对应 API Key 时不跳过。如果执行中 CLI 报出登录错误，也会把该工具标为未登录。点“重新体检”可以刷新。
2. **路由决策看得见**。路由建议会显示推荐模型、路由方案、难度分和估算成本，以及执行渠道（官方 CLI 还是模型目录 API；未登录时标“CLI 未登录”）。执行记录里每一步都写明实际渠道。如果回退到 API，会显示脱敏后的真实错误：Claude JSON 的 `result`、Codex 的 `turn.failed.error.message`，或 stderr 片段。设置允许时可以**改派并重跑**到另一条已配置路线（`allowManualReassign`，默认开启）。
3. **成本控制**。“成本控制”卡片显示今日和本月已花费金额及进度条，并可设置**每日/每月预算**（USD，`0` 表示不限）。
   - 执行前，用本次预估金额检查预算。
   - 执行后，记录实际费用：优先用 CLI 回报的费用（Claude 的 `total_cost_usd`），否则用 token 用量乘以“模型价格与能力配置”里的单价。没有单价时只记录 token 数。
   - 超出预算时的处理由 `overBudgetAction` 决定：`downgrade`（默认）先改用“省钱优先”重新规划，仍超出就暂停；`pause` 直接暂停，询问你是否继续。会话里继续需要传 `confirmOverBudget=true`，宿主会再弹出一次审批。
   - 注意：Claude 的 `total_cost_usd` 是按 API 价格换算的金额，使用订阅时不等于实际扣费。
4. **预设方案**（`routingPreset`）。可选**省钱优先 / 均衡 / 效果优先**，默认是均衡。方案会调整质量、成本和速度三者的权重，并把替代模型必须达到的质量门槛下调或上调 0.04。均衡和以前的算法完全相同。
5. **子任务可视化**（`model_router_rerun_step`）。团队分工的工作包按依赖关系分列，显示成依赖图（DAG）。执行记录里每一步都标有状态：完成、已回退、失败或依赖未完成。点**重跑此步**只重跑失败的那一步，以及依赖它的未完成步骤，已完成的步骤保留原结果。
6. **安全边界**。“安全边界”卡片和插件设置页会逐条列出每条路线可读、可写的范围，以及是否经过 Harness 沙箱：
   - 只读执行不写文件；
   - 修改文件的执行在独立 Git 工作树里进行，需要宿主审批；
   - 在 Linux/macOS 上直接启动无界面 CLI 时没有 Harness 进程沙箱，`confirmUnsandboxedCli`（默认开启）会在启动前先询问你。
7. **质量回路**（`model_router_rate`）。`reviewMode` 可以设为 `off`、`sample` 或 `always`；`sample` 按 `reviewSampleRate` 的比例抽检。开启后，会让更强的已配置模型复核便宜模型的输出，并把结论写进执行记录。你可以对每个结果点 👍/👎。评价会以收缩平均的方式，给对应 `provider/model` 的质量分加一个微调，范围最多 ±0.04，作用于以后的路由。

**本地数据**：上面的状态保存在 `~/.dsh/model-router/state.json`（若设置了 `DSH_HOME`，则在 `$DSH_HOME/model-router/state.json`），包括体检结果、最近 200 次执行的**任务文本、答案摘要**、费用和评价。只保存在本机，不上传。需要清除时直接删除这个文件。

**当前限制**：
- 只有 `model_router_execute` 的执行会写入记录和 DAG。`model_router_team_execute` 与 `model_router_tool_run` 只受预算检查约束，不记录费用和评价。
- 工作台还不能直接发起新的执行，任务仍要在会话中开始；重跑和评价可以在工作台里完成。
- Kimi、MiniMax、MiMo、Grok、ZCode 还没有可靠的登录状态命令，显示的登录命令仅供参考。
- 这些界面只通过了构建检查和单元测试，还没有在真实 Harness 桌面里验证。

## 路由算法：从输入到分配

路由器是**可复查的规则和有界搜索**，不把模型自称的能力、未经配置的价格当作测量结果。实现位于 [`router.mjs`](.dsh-plugin/shared/router.mjs)、[`harness-plan.mjs`](.dsh-plugin/shared/harness-plan.mjs) 和 [`model-profiles.mjs`](.dsh-plugin/shared/model-profiles.mjs)。

### 1. 判断复杂度并拆任务

令 `clip(x)=min(1,max(0,x))`。对任务文本计算：

```text
C = clip(
  0.10
  + 0.30·clip(字符数 / 2200)
  + 0.18·clip(列表项数 / 8)
  + 0.28·clip(领域词命中数 / 5)
  + [含代码/工程词 ? 0.22 : 0]
  + [含高推理词 ? 0.20 : 0]
  + [含图像词 ? 0.12 : 0]
)
```

在没有特殊关键词覆盖时，`C < 0.34` 为简单，`0.34 ≤ C < 0.66` 为均衡，其余为复杂。明确的高风险/高难要求可直接判复杂；短小的翻译、摘要、提取等变换请求可直接判简单；识别出的复合需求也会提高到复杂。该值只衡量文本特征，**不等于真实难度测量**。

复合任务从可执行的列表、逐行指令或动作子句中提取需求，避开代码块和作为摘要材料的清单。复杂计划形成“问题分析 → 具体执行包 → 必要验证 → 结果整合”的依赖图；显式执行包最多六个，超出会合并且保留原文。每个包重新评定难度，因而总任务复杂也可以含有便宜模型胜任的简单包。

### 2. 设质量下限，再比较效用

简单、均衡、复杂工作包的基础质量下限分别为 `0.75`、`0.78`、`0.82`。复杂包再按 `clip(0.82 + 0.12·max(0,关键程度 - 0.65))` 提高下限，复杂整合包至少 `0.84`。界面填写的质量分会除以 100 参与计算。算法先筛过下限的路线；全部不达标时标记**约束放宽**，而不是声称已经满足质量要求。

候选的效用由任务难度对应的权重计算：

```text
U = wq·质量 + wc·成本得分 + wl·(1 - 延迟估值)
  + ws·专长匹配 + wr·推理匹配 - wx·风险估值
  - 关键程度·max(0, 质量下限 - 质量)
```

| 工作包 | 质量 `wq` | 成本 `wc` | 延迟 `wl` | 专长 `ws` | 推理 `wr` | 风险 `wx` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 简单 | 0.28 | **0.45** | 0.14 | 0.04 | 0.07 | 0.02 |
| 均衡 | 0.40 | 0.26 | 0.10 | 0.09 | 0.10 | 0.05 |
| 复杂 | **0.48** | 0.14 | 0.06 | 0.14 | 0.11 | 0.07 |
| 整合 | **0.58** | 0.08 | 0.04 | 0.08 | 0.16 | 0.06 |

缓存读/写比例为 `r`、`w` 时，有效输入价 `p_eff=(1-r-w)·p_in+r·p_read+w·p_write`。设 `M=max(1,max候选(p_eff+p_out))`，推理档位的输出倍率为 `m_out`，则成本得分为 `clip((1-(p_eff+p_out)/(2M))/sqrt(m_out))`。它是**排序分数，不是美元费用**；缺价时内部打分为 0，但公开费用仍显示未知。由此，简单包重视成本，复杂包重视质量和专长。图像包还要经过输入能力筛选；没有合适路线时明确报无法分配。

![质量门槛与候选筛选示意](docs/assets/candidate-pruning.svg)

*图为算法示意，点位不是厂商实测。实际 Pareto 筛选还同时考虑延迟、专长、推理匹配与风险。*

### 3. 估算费用和搜索组合

文本长度先近似成输入 token：`T_in=max(80,ceil(字符数/3.7))`。分析、执行、验证、整合各阶段再按源码中的倍率调整输入与输出 token，推理档位也影响输出估算。给定用户填写的 USD / 百万 token 价格：

```text
预计费用 USD =
  ((普通输入token × 输入单价)
 + (缓存读取token × 缓存读取单价)
 + (缓存写入token × 缓存写入单价)
 + (预计输出token × 输出单价)) / 1,000,000
```

未填价格或货币不是 USD 时，这一路线的费用保持**未知**，不会写成 0 或虚构节省比例。算法逐包做质量筛选和多维 Pareto 筛选，每包最多保留 12 个候选，再以束宽 256 搜索依赖图；跨依赖换路线有交接惩罚。若给定预算，先找估价可行方案；找不到时返回低成本方案并标明预算超出。这个有界启发式**不保证全局最优**；预算也不是厂商账户的硬支出上限。

### 4. 一个可以复算的演示

假设用户**自己**在官方目录中配置两条虚构路线，且两者都可用：

| 路线 | 自报质量 | 输入价 / 输出价（USD / 百万 token） | 擅长 |
| --- | ---: | ---: | --- |
| `cheap-provider/Flash Custom` | 79/100 | 0.10 / 0.20 | 摘要与提取 |
| `strong-provider/Reasoning Custom` | 97/100 | 5 / 25 | 推理与代码 |

输入下面的测试用例原文，规则得出 `C≈0.705`，形成六个工作包：

```text
请处理项目。
- 请提取关键词
- 请设计复杂系统架构
- 最后验证架构安全性
```

关键词提取包是简单任务，下限 `0.75`，两模型都达标。只看该包，在默认缓存比例 0 的演示条件下，成本得分约为 Flash `0.995`、Reasoning `0.5`；带入简单任务权重，效用约为 `0.81345` 与 `0.6163`，因此推荐 Flash。架构设计和安全验证包给强模型。

该提取包预计输入 96、输出 900 token，于是 Flash 的估价为 `(96×0.10+900×0.20)/1,000,000 = $0.0001896`。六包计划的源码示例估价约 **$0.125295**；若六包都选各包最高质量路线，估价约 **$0.148085**；演示节省率约 **15.39%**。这些数字只来自假设价格、假设质量和 token 估算，**不是两家真实产品报价，也不是已经发生的节省**。实际输出量、重试、缓存和厂商计费可能改变账单。

## 官方工具与执行边界

| 工具 | 本版固定目标版本 | 安装与可编辑执行 |
| --- | --- | --- |
| Kimi Code | 2.1.1 | 固定官方 npm 包；无界面模式只允许经审批的独立 Git 工作区可编辑任务。 |
| Claude Code | 2.1.283 | 固定官方 npm 包；支持只读及可编辑模式。 |
| Codex CLI | 0.157.1 | 固定官方 npm 包；支持只读及可编辑模式。 |
| MiniMax Code | 0.5.5 | 固定官方 npm 包；Windows 原生依赖安装失败时使用已核验脚本兜底；只允许经审批的独立 Git 工作区可编辑任务。 |
| MiMo Code | 0.1.15 | 固定官方 npm 包；支持只读及可编辑模式。 |
| Grok Build | 1.0.41 | 固定官方 npm 包；支持只读及可编辑模式。 |
| ZCode | 3.14.3 | 固定、校验哈希和签名的 Windows 安装器；用户在原厂窗口选目录；只允许经审批的独立 Git 工作区可编辑任务。 |
| Gemini CLI | 0.62.0 | 固定官方 npm 包 `@google/gemini-cli`。无界面任务使用 `gemini -p`；签名沙箱入口不启动它。 |

插件界面只能请求注册表内的工具 ID，不能传入任意 npm 包名或 shell 命令。下载后还会核验版本和可信执行入口；仅显示版本号但入口不可信时，卡片提供“修复官方执行入口”。MiniMax 已由官方 Windows 安装器管理的 0.5.5 版本也可识别。若 npm 全局前缀在 C 盘，CLI 安装可能占用 C 盘；请先按自己的空间规划调整此前缀。

### 官方工具如何接到被分配的任务

`model_router_execute` 在模型拿到任务或子任务后选择执行通道。适配器只认固定命令，不接受调用方传入的可执行文件或参数：

| 供应商 | 官方工具 | 无界面调用 | 凭据 |
| --- | --- | --- | --- |
| Anthropic / Claude | Claude Code | `claude -p --output-format json`，任务作为位置参数传入 | 已配置的 `ANTHROPIC_API_KEY`，否则使用 `claude` 自己的登录会话 |
| OpenAI | Codex CLI | `codex exec --json --sandbox read-only` | 已配置的 `OPENAI_API_KEY`，否则使用 `codex` 登录会话 |
| Google / Gemini | Gemini CLI | `gemini -p --output-format json`，标准输入作为补充上下文 | 已配置的 `GEMINI_API_KEY`，否则使用 Gemini CLI 已缓存的登录 |
| DeepSeek 及其他没有适配器的供应商 | 无 | 直接使用 Harness 模型目录 API | 使用宿主里已经配置的供应商凭据，插件不另存密钥 |

安装示例（版本与工作台一键安装相同）：

```text
npm install -g @anthropic-ai/claude-code@2.1.283 --registry=https://registry.npmjs.org/
npm install -g @openai/codex@0.157.1 --registry=https://registry.npmjs.org/
npm install -g @google/gemini-cli@0.62.0 --registry=https://registry.npmjs.org/
```

Claude 与 Codex 若本机已有经核验的签名入口，仍优先走原有沙箱执行器；入口不可用时才用上面的无界面命令。每次调用都在当前会话工作目录中进行，限制输出体积和超时（默认 10 分钟，上限 45 分钟）；超时或取消时先发 SIGTERM，5 秒后仍未退出则 SIGKILL。官方命令缺失、超时、非零退出或输出无法解析时，自动改走模型目录 API，并在结果里写明回退原因。密钥只放进该子进程的环境变量，不会写入模型档案或返回文本。

每条路线的 `execution` 可以是 `auto`（默认）、`official` 或 `api`。前两者都会先尝试官方工具；`api` 不启动 CLI。可编辑写文件仍使用 `model_router_tool_run` 或 `model_router_team_execute`，不由这次只读汇总改仓库。

`model_router_tool_run` 用于单工具调用；`model_router_team_execute` 为**插件自有的顺序 CLI 团队执行器**：按依赖运行，失败或回报模型不匹配即停。可编辑工作先在独立 Git worktree 执行，并在原仓库保持干净时整合；被 Git 忽略的输出需单独检查。官方 Harness Agent Teams 的成员生命周期与成员模型仍由宿主管理。

Harness 目录中的模型 ID 未必是厂商 CLI 接受的名字。逐模型设置可填写 `cliModel`；团队执行时临时的“工作包映射 > 工具映射 > 保存映射”。ZCode 3.14.3 不能逐次切换模型。多数 CLI 不回报可核验的实际模型 ID，执行后要对照厂商运行记录、权限和账单。Windows Harness 沙箱的 ACL 文件效果报告为部分隔离，涉及敏感仓库时应先用测试环境验证。

## 可选安装 GAL

[DeepSeek Harness GAL](https://github.com/Alice-Marx/deepseek-harness-galgame)单独维护剧情引擎、立绘与场景、音乐、阅读设置、存档和自由模式。安装输入为 `@ljwei-stak/dsh-galgame@0.1.0`，详细操作见该仓库 README。模型路由安装包不再包含这些美术或剧情引擎，后续路由与 GAL 各自更新版本。

## 验证与开发

开发环境为 Node.js **22.19+** 与 pnpm 10（已通过 `packageManager` 固定，`corepack enable` 后自动使用）。在完整源码根目录运行：

```powershell
pnpm install --frozen-lockfile
npm run build:client
npm test
npm run check:client
pnpm peers check
npm pack --pack-destination dist
```

客户端源代码有变化时必须重建；旧生成文件不能验证新实现。将生成的安装包在独立测试 profile 安装，检查路由入口、目录、模型档案和官方工具卡。GAL 的单独安装及与路由共同安装按其仓库步骤验收。真实登录、厂商实际模型、任务质量与计费仍需账号持有人核对。

历史记录保留在 [0.11.1 发布报告](https://github.com/Alice-Marx/model-router-galgame/blob/main/PROJECT-TASK-REPORT-2026-10-02-NPM-RELEASE-AND-README-FIX.md)和[rc.2 兼容报告](PROJECT-TASK-REPORT-2026-10-01-RC2-COMPAT.md)。本次拆分的构建、测试与发布结果写入新的总项目报告；旧合并版的测试数量不代表独立包已经通过验证。

安装或执行出错时，可到 [Issues](https://github.com/Alice-Marx/model-router-galgame/issues) 提供宿主版本、插件版本、安装详情和脱敏日志。

许可证：[MIT](LICENSE)。
