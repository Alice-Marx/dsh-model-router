# DeepSeek Harness Desktop 插件安装与验证

适用官方桌面版 **0.1.7-rc.2**；当前仓库版本 **0.8.0（本地候选版，尚未发布）**。包名 `@ljwei-stak/model-router-galgame`。

## 生成安装包

```powershell
Set-Location F:\everyAI\all\model-router-galgame
npm run build:client
npm pack --pack-destination dist
```

在官方 DeepSeek Harness Desktop 的**插件管理器**选择生成的 `ljwei-stak-model-router-galgame-0.8.0.tgz`，安装并启用。升级时仍使用官方插件管理器；不要手工替换应用安装目录、`app.asar` 或 profile 中的文件。

## 配置与使用

1. 在官方**模型**页启用所需供应商、模型及凭据。插件只读官方模型目录，不另存 API Key。
2. 左侧打开**模型路由**：确认目录出现，输入任务生成单任务或团队计划；点击**官方工具**卡片可按固定官方来源下载安装、取消下载、查看日志与执行入口状态。前六家使用固定 npm 包；ZCode 会打开已验签的官方安装窗口，选择 D 盘目录并完成安装后再点“重新检测”。取消正在进行的 npm 安装后也应重新检测实际版本。
3. 在官方会话调用 `model_router_consult` 获取另一模型意见。调用 `model_router_tool_run` 执行单个已适配官方工具；复杂任务可调用 `model_router_team_execute`。Claude、Codex、MiMo、Grok 可选只读或可编辑；Kimi、MiniMax、ZCode 的无界面执行只允许可编辑隔离工作区。可编辑模式需要干净 Git 仓库，先在独立工作区编辑，全部成功后应用补丁，并经过官方工具审批。
   若单工具调用要指定厂商 CLI 里的准确模型名，同时传入官方目录的 `provider`/`model` 与 CLI 自身的 `cliModel`；MiniMax/MiMo 用 `provider/model` 格式。未提供时按下方默认模型规则执行。
   团队任务请逐条列出具体需求；如需指定每家 CLI 或每个工作包的准确模型，可给 `model_router_team_execute` 传 `cliModelsJson`。格式如 `{"minimax-code":"minimax/your-configured-model"}`，实际调用时换成该 CLI 中已配置名称。先用 `model_router_plan` 查看工作包 ID，再按 ID 精确覆盖；ZCode 无逐次切换模型能力。
4. 左侧打开**Gal 模块**：剧情模式可离线游玩与存档；自由模式从官方目录选路线，在面板发送消息会发生真实模型调用并可能产生费用，可用“停止生成”中断当前请求，也可复制开场提示词到官方会话。

七家执行适配器已经接线，但 0.8.0 尚未完成真实账号调用验收。“已安装”和“执行入口就绪”也不证明凭据有效。团队规划会标注执行渠道；团队执行只向 Claude/Codex 传入建议模型 ID，其余 CLI 使用各自已配置的默认模型并在结果中标明，实际模型与费用以厂商记录为准。Grok 在 Windows 上会优先把原生程序与登录数据放在非 C 盘 npm 全局目录下的 `.model-router-grok`；若需在独立终端登录 Grok，请让该终端的 `GROK_HOME` 指向同一目录。

## 验证清单

| 检查项 | 预期 |
| --- | --- |
| 插件启用 | 插件详情为 0.8.0，左侧出现“模型路由”和“Gal 模块”。 |
| 官方工具 | 七张工具卡显示状态；点击下载、取消和重试后确认真实探测版本及执行入口就绪状态；ZCode 须在原厂安装窗口完成安装。 |
| 本地规划 | 单任务与团队模式都能显示复杂度、路线、渠道、估算费用和工作包。 |
| Gal 剧情 | 两部剧目、章节、支线、选项、历史和三槽存档可切换；重开后存档可读。 |
| Gal 自由 | 用户自行配置的模型可回复首轮和续轮消息；停止生成会取消当前请求，切换模型/角色会清空旧对话并请求取消旧回复。 |
| CLI 执行 | 已登录账号下逐家调用，核对实际模型、结构化终态与权限；可编辑任务先在干净测试仓库核对独立工作区与补丁整合。 |
| 团队执行 | 在测试仓库验证多工作包依赖、失败停止、取消、模型 ID 不受厂商接受时的错误。 |

真实账号、付费模型、CLI 授权与桌面交互需由账号持有人操作并核对。完成这些验收后，才按要求发布 npm 与 GitHub。
