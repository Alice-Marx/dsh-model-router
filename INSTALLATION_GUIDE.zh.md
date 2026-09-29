# DeepSeek Harness Desktop 插件安装与验证

当前发布的 **0.9.0** 适配官方 DeepSeek Harness Desktop **0.2.0-rc.1**。npm 的 `next` 指向 0.9.0，而 `latest` 仍指向历史版 0.4.32；在插件管理器安装时务必填写完整版本号。包名为 `@ljwei-stak/model-router-galgame`。0.9.0 已发布到 [npm](https://www.npmjs.com/package/@ljwei-stak/model-router-galgame/v/0.9.0) 和 [GitHub v0.9.0 预发布](https://github.com/Alice-Marx/model-router-galgame/releases/tag/v0.9.0)。

## 版本与宿主对应关系

| 插件版本 | 发布渠道 | 声明的 DeepSeek Harness 依赖 | 安装建议 |
| --- | --- | --- | --- |
| **0.9.1-dev.1** | 本地开发包，未发布 npm | `0.2.0-rc.1` | 包含《回声之城：雪灯来信》与 Gal 全角色立绘、旧城场景背景修复；按下方本地打包步骤安装，尚需用户桌面试玩验收。 |
| **0.9.0** | npm `next`、GitHub v0.9.0 预发布 | `0.2.0-rc.1` | 当前官方桌面版 0.2.0-rc.1 使用此版，并显式指定 `@0.9.0`。 |
| 0.8.0 | 历史发布 | `0.1.7-rc.2` | 与桌面版 0.2.0-rc.1 不兼容。 |
| 0.4.32 | npm `latest` | `@deepseek-ai/dsh-settings` 的 `^0.1.1-rc.1 || ^0.1.2-rc.1 || ^0.1.5-rc.1` | 历史版本；不适用于当前桌面版 0.2.0-rc.1。 |

表中列的是包声明的兼容依赖，并非对所有旧桌面版本的实机验收。先在 DeepSeek Harness 的插件页确认宿主版本；不要只输入不带版本的包名，否则会按 npm `latest` 安装 0.4.32。

## 安装 0.9.0

以下方法均在官方桌面版的 **插件 → 添加插件** 中操作。安装完成后启用插件；若页面提示重启后生效，则重启 DeepSeek Harness。已装旧版本时，先在插件页禁用重复的旧实例，再安装指定版本。不要手工改动应用安装目录、`app.asar` 或 profile 文件。

### 方法一：从 npm 安装（推荐）

在“包名或地址”中完整填写：

```text
@ljwei-stak/model-router-galgame@0.9.0
```

“安装源”选择可以连通的 **npm 官方源**；若网络无法访问，可按插件管理器提示改选中国大陆镜像源，但镜像需要已同步 0.9.0。确认预览显示 **0.9.0** 且没有宿主依赖不兼容提示，再点“安装”。普通用户不需要在系统终端运行 `npm install -g`：全局安装 npm 包不会自动把插件加入当前 DeepSeek Harness profile。

### 方法二：安装 GitHub Release 的固定安装包

从 [GitHub v0.9.0 预发布](https://github.com/Alice-Marx/model-router-galgame/releases/tag/v0.9.0)下载 `ljwei-stak-model-router-galgame-0.9.0.tgz`，保存到你选择的目录。然后在“包名或地址”中填写**下载后文件的绝对路径**，例如：

```text
D:\Plugins\ljwei-stak-model-router-galgame-0.9.0.tgz
```

这里的 `D:\Plugins\` 只是示例，实际输入须与文件所在位置一致。官方插件管理器支持本地 `.tgz` 路径。发布包的 SHA-256 为 `FB06ED5527DE256062BB932EF5A35AF8FF9BEB8B6D2B3F635E2F30D0736A8E4B`；需要核对下载文件时，可在 PowerShell 运行 `Get-FileHash -Algorithm SHA256 -LiteralPath "D:\Plugins\ljwei-stak-model-router-galgame-0.9.0.tgz"`（按实际路径替换）。

### 方法三：从源码自行打包（开发者可选）

在已安装 Node.js 22.19 或更新版本与 pnpm 的环境中，检出 `v0.9.0` 后执行：

```powershell
git clone https://github.com/Alice-Marx/model-router-galgame.git
Set-Location model-router-galgame
git checkout v0.9.0
pnpm install --frozen-lockfile
npm run build:client
New-Item -ItemType Directory -Force dist | Out-Null
npm pack --pack-destination dist
```

随后按方法二，在插件管理器中填写生成的 `dist\ljwei-stak-model-router-galgame-0.9.0.tgz` **绝对路径**并安装。源码安装需能下载开发依赖；仅想使用插件时优先选择方法一或二。

## 本地试玩 Gal 场景与《雪灯来信》（0.9.1-dev.1）

已发布的 0.9.0 **没有**这部新剧。要试玩，请使用本机 `F:\everyAI\all\model-router-galgame` 目录中的当前源码构建本地开发包（不需要模型账号）：

```powershell
Set-Location F:\everyAI\all\model-router-galgame
pnpm install --frozen-lockfile
npm run build:client
New-Item -ItemType Directory -Force dist | Out-Null
npm pack --pack-destination dist
(Resolve-Path '.\dist\ljwei-stak-model-router-galgame-0.9.1-dev.1.tgz').Path
```

把最后一行输出的 **绝对路径**填入官方桌面版 **插件 → 添加插件**，确认预览为 `0.9.1-dev.1` 后安装并启用。它是供本地试玩的开发包，未上传 npm，也未对用户真实桌面配置完成安装验收；不要把 `@ljwei-stak/model-router-galgame@0.9.1-dev.1` 当作已发布的 npm 地址。在左侧 **Gal 模块 → 剧情模式** 的“剧目”下拉框选 **雪灯来信**，再切到两部旧剧核对人物立绘和场景背景。玩法及存档说明见[独立指南](docs/ECHO_CITY_STORY.zh.md)。

## 配置与使用

1. 在官方**模型**页启用所需供应商、模型及凭据。插件只读官方模型目录，不另存 API Key。在插件设置或工作台为对应的准确 provider/model 填入自己的质量评分、输入与输出单价（USD/百万 token），必要时设置该厂商 CLI 的 `cliModel` 名称。官方目录本身没有价格或比较质量评分；缺价时不会显示虚构的费用或节省比例。
2. 左侧打开**模型路由**：确认目录出现，输入任务生成单任务或团队计划，核对每个工作包的难度、路线和依赖；点击**官方工具**卡片可按固定官方来源下载安装、取消下载、查看日志与执行入口状态。若版本横幅已是目标版本、但安全校验找不到官方执行入口，点“修复官方执行入口”会按固定包重新安装。前六家使用固定 npm 包；ZCode 会打开已验签的官方安装窗口，选择 D 盘目录并完成安装后再点“重新检测”。取消正在进行的 npm 安装后也应重新检测实际版本。
3. 在官方会话调用 `model_router_consult` 获取另一模型意见。调用 `model_router_tool_run` 执行单个已适配官方工具；复杂任务可调用 `model_router_team_execute`。Claude、Codex、MiMo、Grok 可选只读或可编辑；Kimi、MiniMax、ZCode 的无界面执行只允许可编辑隔离工作区。可编辑模式需要干净 Git 仓库，先在独立工作区编辑，全部成功后应用补丁，并经过官方工具审批。
   若单工具调用要指定厂商 CLI 里的准确模型名，同时传入官方目录的 `provider`/`model` 与 CLI 自身的 `cliModel`；MiniMax/MiMo 用 `provider/model` 格式。未提供时按下方默认模型规则执行。
   团队任务请逐条列出具体需求；如需临时指定每家 CLI 或每个工作包的准确模型，可给 `model_router_team_execute` 传 `cliModelsJson`。格式如 `{"minimax-code":"minimax/your-configured-model"}`，实际调用时换成该 CLI 中已配置名称。先用 `model_router_plan` 查看工作包 ID，再按 ID 精确覆盖；临时工作包设置 > 临时工具设置 > 保存的路线映射。ZCode 无逐次切换模型能力。
4. 左侧打开**Gal 模块**：剧情模式可离线游玩与存档；自由模式从官方目录选路线，在面板发送消息会发生真实模型调用并可能产生费用，可用“停止生成”中断当前请求，也可复制开场提示词到官方会话。

七家执行适配器已经接线，但 0.9.0 尚未完成真实账号逐家调用验收。“已安装”和“执行入口就绪”也不证明凭据有效。团队规划会标注执行渠道；映射到厂商 CLI 的模型名会传给对应工作包，但多数 CLI 不返回可靠的实际模型 ID，因此仍须核对厂商记录与费用。MiniMax 在 Windows 上的 npm 安装可能因 `better-sqlite3` 缺少预编译文件或本机 C++ 构建工具而失败；插件会用固定 SHA-256 校验官方安装脚本，锁定 0.5.5，并在 npm 全局前缀下的 `.minimax-code` 目录安装。脚本来源内容变化时会拒绝执行并显示错误，待插件审核新版后更新。已通过官方 Windows 安装器安装的 0.5.5 版本也会被入口哈希识别，无需重复安装。若要避免 C 盘安装空间，请先把 npm 全局前缀设在非 C 盘。Grok 在 Windows 上会优先把原生程序与登录数据放在非 C 盘 npm 全局目录下的 `.model-router-grok`；若需在独立终端登录 Grok，请让该终端的 `GROK_HOME` 指向同一目录。

## 验证清单

| 检查项 | 预期 |
| --- | --- |
| 插件启用 | 插件详情为 0.9.0，左侧出现“模型路由”和“Gal 模块”；没有“与 DSH 0.2.0-rc.1 不兼容”的提示。 |
| 官方工具 | 七张工具卡显示状态；点击下载、取消和重试后确认真实探测版本及执行入口就绪状态；ZCode 须在原厂安装窗口完成安装。 |
| 本地规划 | 单任务与团队模式都能显示复杂度、每包难度、路线、渠道、依赖；完整填写单价时才显示费用，缺价时显示“价格待配置”。用简单与困难任务核对不同模型分配。 |
| Gal 剧情 | 0.9.0 的两部旧剧保持可读；0.9.1-dev.1 另有《雪灯来信》五章、两种结局和独立三槽。核对章节、选项、历史、切换与重开后的存档，以及 23 位角色立绘和旧城地点背景。 |
| Gal 自由 | 用户自行配置的模型可回复首轮和续轮消息；停止生成会取消当前请求，切换模型/角色会清空旧对话并请求取消旧回复。 |
| CLI 执行 | 已登录账号下逐家调用，核对实际模型、结构化终态与权限；可编辑任务先在干净测试仓库核对独立工作区与补丁整合。 |
| 团队执行 | 在测试仓库验证多工作包依赖、失败停止、取消、模型 ID 不受厂商接受时的错误。 |

真实账号、付费模型及 CLI 授权仍需由账号持有人操作并核对；每家模型名、实际计费和完整任务质量以厂商运行记录及用户验收为准。
