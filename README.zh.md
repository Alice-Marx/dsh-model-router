# Model Router Galgame · DeepSeek Harness 插件

面向官方 **DeepSeek Harness Desktop 0.1.7-rc.2**。当前本地候选包为 **0.7.0，尚未发布**；npm 包名保持 `@ljwei-stak/model-router-galgame`。仓库：[Alice-Marx/model-router-galgame](https://github.com/Alice-Marx/model-router-galgame)。

## 功能

- **模型路由**：读取官方已配置的模型目录，按任务类型、复杂度、估算费用生成推荐路线；团队模式拆成带依赖、推荐模型和验收项的工作包。生成计划只在本机计算，不发起模型调用。
- **官方工具**：界面检测 Kimi Code、Claude Code、Codex、MiniMax Code、MiMo Code、Grok Build，并按固定官方 npm 包和版本一键下载安装；显示进度、取消按钮、日志、重新探测结果与受信执行入口状态。界面与 Host 均不接受任意包名或命令。
- **模型可调用工具**：`model_router_routes`、`model_router_plan`、`model_router_consult`、`model_router_tools`、`model_router_tool_install`、`model_router_tool_run`、`model_router_team_execute`。人工命令有 `/router` 与 `/tools`。
- **Gal 模块**：独立侧边栏分块。剧情模式复用原项目场景图和人物立绘，包含选项、历史、结局与三槽本地存档；自由模式可选官方已配置模型在插件面板内对话、停止当前生成，也可复制开场提示词到官方会话。插件不保存供应商凭据。

`model_router_tool_run` 目前可通过官方 **Claude Code** 或 **Codex** CLI 做只读分析。每次启动均经过 Harness 官方进程沙箱；Windows ACL 后端报告部分文件效果隔离。可编辑模式先在独立 Git 工作区执行，CLI 成功结束、原仓库仍干净且没有被 Git 忽略的遗漏产物时才应用补丁。`model_router_team_execute` 从已配置、已安装且实际执行入口已核验的路线中规划工作包，按依赖顺序交给各官方 CLI，并请求计划中的模型 ID。实际使用的模型仍需以厂商运行记录核对。估算预算不限制真实账号费用。

**安装成功不等于可托管执行。** Windows 上 Kimi、MiniMax、MiMo、Grok 的固定版本尚未完成权限、工作区隔离或机器可判定终态的验证，因此 0.7.0 不自动替它们执行任务；界面会分别显示安装状态与执行能力。官方 Agent Teams 的成员生命周期仍由 Harness 管理；插件提供的 CLI 团队执行器是独立的顺序执行流程。

## 本地安装

1. 在仓库执行 `npm run build:client` 和 `npm pack --pack-destination dist`。
2. 通过官方桌面版**插件管理器**安装并启用生成的 `.tgz`。
3. 在官方**模型**页配置供应商、模型和凭据。
4. 左侧打开**模型路由**查看目录、规划与工具安装；打开**Gal 模块**游玩剧情或自由对话。
5. 在官方会话调用 `model_router_consult` 获取跨模型意见，调用 `model_router_tool_run` 或 `model_router_team_execute` 进行受支持的 CLI 执行。可编辑任务要求干净 Git 仓库，并经过官方工具审批。

所有插件更新都走官方插件管理器，不修改 DeepSeek Harness 安装目录或 `app.asar`。详见[安装指南](INSTALLATION_GUIDE.zh.md)和[总项目任务报告](PROJECT-TASK-REPORT-2026-09-28.md)。

## 发布状态

0.7.0 仍是本地开发候选版。按用户要求，插件全部完善并完成必要的桌面与真实账号验证后，再上传 npm 和 GitHub。
