# Model Router Galgame · DeepSeek Harness 插件

面向官方 **DeepSeek Harness Desktop 0.1.7-rc.2**。当前本地候选包为 **0.8.0，尚未发布**；npm 包名保持 `@ljwei-stak/model-router-galgame`。仓库：[Alice-Marx/model-router-galgame](https://github.com/Alice-Marx/model-router-galgame)。

## 功能

- **模型路由**：读取官方已配置的模型目录，按任务类型、复杂度、估算费用生成推荐路线；团队模式拆成带依赖、推荐模型和验收项的工作包。生成计划只在本机计算，不发起模型调用。
- **官方工具**：界面检测 Kimi Code、Claude Code、Codex、MiniMax Code、MiMo Code、Grok Build 与 ZCode。前六项按固定官方 npm 包和版本安装；ZCode 下载固定版本安装器，校验 SHA-256 与厂商签名后打开原厂安装窗口，由用户选择安装目录。安装状态、取消、日志与执行入口就绪状态分别显示。界面与 Host 均不接受任意包名或命令。
- **模型可调用工具**：`model_router_routes`、`model_router_plan`、`model_router_consult`、`model_router_tools`、`model_router_tool_install`、`model_router_tool_run`、`model_router_team_execute`。人工命令有 `/router` 与 `/tools`。
- **Gal 模块**：独立侧边栏分块。剧情模式复用原项目场景图和人物立绘，包含选项、历史、结局与三槽本地存档；自由模式可选官方已配置模型在插件面板内对话、停止当前生成，也可复制开场提示词到官方会话。插件不保存供应商凭据。

`model_router_tool_run` 已接入七家官方工具的固定执行入口。Claude Code、Codex、MiMo Code 和 Grok Build 支持只读及可编辑模式；Kimi Code、MiniMax Code、ZCode 的无界面模式会自动处理工具权限，因此仅允许经审批的独立 Git 工作区可编辑执行。每次启动都经过 Harness 进程沙箱；Windows ACL 后端报告部分文件效果隔离。可编辑模式要求干净 Git 仓库，先在独立工作区执行，CLI 成功结束且原仓库仍干净时应用源文件补丁；被 Git 忽略的产物保留在独立工作区，结果标为 `integration-pending` 供核对。`model_router_team_execute` 按依赖顺序调用就绪的官方工具，单项失败立即停止。Harness 模型目录 ID 不一定是厂商 CLI 的模型名称：团队执行只向 Claude/Codex 请求建议 ID，Kimi、MiniMax、MiMo、Grok、ZCode 使用各自 CLI 已配置的默认模型，并明确报告这一点。实际模型仍须核对厂商记录。预算估算不限制真实账号费用。

单独调用 `model_router_tool_run` 时，如已知道厂商 CLI 中配置的准确模型名，可同时给出官方目录中的 `provider`/`model` 路线与 `cliModel`；MiniMax/MiMo 的 `cliModel` 要用 `provider/model` 格式。ZCode 3.14.3 无法逐次切换模型。

团队任务可按编号、分行、分号或完整动作句列出独立需求，插件最多生成六个有具体目标的执行包。`model_router_team_execute` 可选填 `cliModelsJson`，内容是按官方工具 ID 或工作包 ID 指定 CLI 已配置模型名的 JSON 对象。格式示例：`{"minimax-code":"minimax/your-configured-model"}`，实际调用时替换成 MiniMax CLI 中已配置的名称；工作包设置优先。插件在开始执行前核对模型名格式。

**安装成功不等于账号可用。** 当前适配器已按固定版本源码核对协议并接线，但 0.8.0 尚未在用户真实账号和官方桌面版完成调用验收。官方 Agent Teams 的成员生命周期仍由 Harness 管理；插件提供的 CLI 团队执行器是独立的顺序执行流程。

## 本地安装

1. 在仓库执行 `npm run build:client` 和 `npm pack --pack-destination dist`。
2. 通过官方桌面版**插件管理器**安装并启用生成的 `.tgz`。
3. 在官方**模型**页配置供应商、模型和凭据。
4. 左侧打开**模型路由**查看目录、规划与工具安装；打开**Gal 模块**游玩剧情或自由对话。
5. 在官方会话调用 `model_router_consult` 获取跨模型意见，调用 `model_router_tool_run` 或 `model_router_team_execute` 进行受支持的 CLI 执行。可编辑任务要求干净 Git 仓库，并经过官方工具审批。

所有插件更新都走官方插件管理器，不修改 DeepSeek Harness 安装目录或 `app.asar`。详见[安装指南](INSTALLATION_GUIDE.zh.md)和[总项目任务报告](PROJECT-TASK-REPORT-2026-09-28.md)。

## 发布状态

0.8.0 仍是本地开发候选版。按用户要求，插件全部完善并完成必要的桌面与真实账号验证后，再上传 npm 和 GitHub。
