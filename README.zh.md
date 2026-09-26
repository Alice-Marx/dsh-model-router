# Model Router for DeepSeek Harness

面向官方 **DeepSeek Harness Desktop 0.1.7-rc.2** 的模型路由插件。

仓库：[Alice-Marx/model-router-galgame](https://github.com/Alice-Marx/model-router-galgame)
npm 包名仍为 `@ljwei-stak/model-router-galgame`，以保持已有安装记录的连续性。

## 它做什么

插件读取 DeepSeek Harness 官方模型目录中已登记的路由，不保存 API Key，也不自行创建供应商配置。目录中列出的路线仍需通过真实调用验证凭据与网络是否可用。

0.6.0 在官方侧边栏提供两个独立工作区：**模型路由**（模型目录、按任务复杂度的本地路由建议、Agent Teams 工作包、官方 CLI 工具卡片）与 **Gal 模块**（剧情模式 gal 视图舞台 + 自由模式）。浏览目录和生成计划不会发起模型请求。预算和咨询输出上限设置位于 **插件管理器**中本安装包的详情页。

它提供五个模型可调用工具：

| 工具 | 用途 |
| --- | --- |
| `model_router_routes` | 查看官方桌面版模型目录中已登记的路线。 |
| `model_router_plan` | 按任务复杂度给出模型选择建议、执行渠道标注（官方 CLI / 模型目录 API），并可输出适合 Agent Teams 使用的工作包。 |
| `model_router_consult` | 向一个已配置的其他模型发起一次独立咨询，返回可供当前 Agent 采用的结果。 |
| `model_router_tools` | 探测各厂商官方 CLI（Kimi Code、Claude Code、Codex、MiniMax Code、MiMo Code、Grok Build）的安装状态与版本。 |
| `model_router_tool_install` | 按服务端注册表中固定的官方命令一键安装某个工具；不接受自定义包名或命令。 |

人工命令：`/router <任务>` 生成路线建议；`/tools` 查看官方 CLI 检测状态；`/tools install <工具id>` 一键安装。

模型建议和咨询都以官方 **模型**页面中已经启用的供应商与模型为准。先在官方界面配置模型及其凭据，再使用本插件。

## Agent Teams 的配合方式

任务拆分与团队生命周期由官方 DeepSeek Harness 的 **Agent Teams** 功能负责。`model_router_plan` 可以提出工作包和模型建议；创建成员、发送消息、等待结果和结束成员，仍在官方 Agent Teams 工具与界面中完成。

这样团队任务、会话历史和权限行为都保留在官方运行时中。

## 路由行为

0.6.0 不自动替换主会话当前选择的模型。

可在侧边栏的 **模型路由** 工作区查看本地建议，或让 Agent 调用 `model_router_plan`。计划会为推荐路线与每个工作包标注执行渠道：`official-cli` 表示该厂商官方 CLI 已安装（可由官方工具直接执行任务），`harness-llm` 表示经官方模型目录 API 调用。需要跨模型意见时，让 Agent 调用 `model_router_consult`；打开工作区不会自动咨询模型。由使用者在官方界面中决定主会话使用的模型。

## Gal 模块

侧边栏的 **Gal 模块** 是独立分块，包含两种模式：

- **剧情模式 · Gal 视图**：以《千桥协议》与《旧城迁移篇》两部剧目为核心的 gal 视图舞台——场景头、角色立绘位、打字机对话框、选项、结局、历史回看与三槽本地存档。剧情引擎为确定性纯函数，全部在客户端运行，不调用模型。
- **自由模式**：从官方模型目录选择一条路线和一个角色，合成角色扮演开场提示词；复制后在官方会话中选择对应模型粘贴发送即可开演。自由对话发生在官方会话中，本面板不直接调用模型、不保存任何凭据。

## 安装

通过官方 DeepSeek Harness Desktop 的 **插件管理器**安装：

1. 获取本地 `.tgz` 包，或准备好本仓库的本地插件目录。
2. 打开官方桌面版的插件管理器，选择添加本地插件。
3. 选择本地目录或 `.tgz` 文件，并在插件管理器中启用它。
4. 打开官方 **模型**页面，配置需要使用的供应商、模型和 API Key。
5. 从侧边栏打开 **模型路由**，查看模型目录、填写任务并生成本地计划或团队工作包。
6. 在 **插件管理器**中打开 `@ljwei-stak/model-router-galgame` 的安装包详情页，调整预算和咨询输出上限。
7. 需要真实跨模型意见时，在会话中让 Agent 调用 `model_router_consult`。

不要修改 `DeepSeek Harness` 安装目录、`app.asar` 或桌面版自带文件。插件的安装、启用、更新和移除都应在官方插件管理器中完成。

开发环境和更详细的本地安装步骤见 [INSTALLATION_GUIDE.zh.md](INSTALLATION_GUIDE.zh.md)。从旧版迁移见 [MIGRATION.md](MIGRATION.md)。

## 范围与限制

- 本插件不代管 API Key、供应商端点或模型目录。
- 路由建议不能代替对模型输出、费用和权限的人工判断。
- 交叉模型咨询只会调用用户已在官方模型页面配置的模型。
- 旧 GAL 界面、自动更新逻辑和旧桌面版集成已归档，不属于官方桌面版适配运行路径。

## 开发

```powershell
pnpm install --frozen-lockfile
npm run build:client
npm test
```

构建本地安装包：

```powershell
npm pack --pack-destination dist
```

然后在官方插件管理器中选择生成的 `.tgz` 文件。
