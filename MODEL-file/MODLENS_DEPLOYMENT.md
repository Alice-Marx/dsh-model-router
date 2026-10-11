# 官方 ModLens 部署与集成指南

> 纠错：ModLens 不是运行在 `localhost:8000` 的 Docker/Python 服务，也没有
> `/v1/understand` 或 `/v1/understand/batch` 接口。旧的 `modlens-service` 只是本项目
> 早期创建的关键词测试桩，不能读取图片像素，现已废止。

## 安装到 DeepSeek Harness

ModLens 3.25.4 是原生 DSH bundle。公开的 Model Router npm 包会自动安装它：

```powershell
pnpm config set registry https://registry.npmjs.org/
pnpm dsh plugin --profile web add @ljwei-stak/model-router-galgame@0.4.20
pnpm dsh plugin --profile desktop add @ljwei-stak/model-router-galgame@0.4.20
```

安装结果位于对应的 `F:\DeepSeek_harness\.dsh\profiles\<profile>` 目录，
`@ljwei-stak/model-router-galgame` 和 `@liustack/modlens` 会同时出现在依赖闭包和
`dsh.profile.bundles` 中。安装或更新后请重启对应 profile。

本地开发时可以直接安装源码目录：

```powershell
pnpm dsh plugin --profile web add F:\DeepSeek_harness\model-router-galgame
```

## 官方运行方式

官方插件在 DSH 内完成四件事：

1. 注册 `modlens_read_image` 工具。
2. 自动发现纯文本 DeepSeek、GLM、MiMo Pro 路由，并生成
   `<原模型> (modlens vision)` 包装条目。
3. 对包装路由中的图片附件调用 `ctx.attachments.readImage()`，运行同一 npm 包内的
   ModLens CLI，把图片转换为结构化证据后再交给原纯文本模型。
4. 在 Web 中提供粘贴转临时路径和“视觉引擎（ModLens）”设置卡。

因此不需要启动额外的 8000 端口服务，也不需要本项目实现
`ModLensClient`/`ModLensIntegration` HTTP 客户端。

## 配置与检查

视觉引擎配置由官方 CLI 管理，文件为：

```text
C:\Users\Jianw\.modlens\config.json
```

也可在 DSH 的“设置 → 插件 → 插件配置 → 视觉引擎（ModLens）”中修改。检查命令：

```powershell
pnpm exec modlens doctor
```

当前固定使用 `claude-cli`。它能完成调用链，但本机实测一次读取约 157 秒，而且对
DSH 截图产生严重误识别，不适合准确率或延迟验收。官方推荐的快速路径是
`gemini-api`（文档标称约 5–10 秒），也可配置真实的 OpenAI-compatible 多模态端点。

## 与 GAL 路由器的边界

GAL 不实现第二套 ModLens 协议，也不保存视觉引擎密钥。它只做两项协调：

- 模型下拉框读取 DSH 官方 `modelCatalog()`，因此普通、原生视觉和
  `(modlens vision)` 条目同时可见并通过 `selectModel()` 切换。
- 集体模式中，如果本轮含图片、算法选中的目标是纯文本模型且存在对应官方包装路由，
  仅把该次请求的 provider 改为包装 provider；原生视觉模型保持不变。

## 验收口径

插件安装、包装模型出现和 CLI 成功返回，只证明集成链路可执行。代码截图识别、图表
数据提取、成本节省和端到端延迟必须使用真实视觉引擎逐项测量，不能用测试桩返回值
或官方宣传值代替实测。
