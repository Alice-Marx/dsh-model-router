# 官方 ModLens 在 DeepSeek Harness 中的真实使用报告

> 复测更新：2026-09-03。以下“当前配置”和验收结论以本次 DeepSeek Vision Exp 复测为准。

## 摘要

本次重新以官方 `liustack/modlens` 3.25.4 源码和 npm 包为准，纠正了此前将本地
Python 测试桩当成 ModLens 服务的错误。正常 DSH Web profile 已同时加载 GAL 路由器
和官方 ModLens；模型列表已恢复，包装模型可见且可切换。随后将视觉引擎切换为
DeepSeek 官方兼容视觉接口，官方 CLI 已真实读取截图并返回 OCR、布局和语义结果。
当前链路可用，但单次视觉调用约 10.34 秒，严格的 `<3 秒` 指标仍未达到；代码错误
金样本、图表数据点和成本节省也尚未完成正式验收。

## 官方架构核对

官方实现没有常驻 HTTP 视觉服务。DSH bundle 直接注册 `modlens_read_image` 工具，
并自动为符合条件的纯文本路由注册包装 provider：

- `deepseek-official` 对应历史兼容 ID `deepseek-modlens`。
- 其他 provider 对应 `modlens-<upstream>`。
- 包装模型声明 `inputModalities: ['text', 'image']`，请求时读取 DSH attachment，调用
  包内 CLI 生成 v2 结构化证据，再把证据文本交给原 provider。
- 原生视觉模型根据模型 ID 和 `inputModalities` 被排除，不会被包装或降级。
- 视觉引擎配置统一保存在 `~/.modlens/config.json`，由官方设置卡或 CLI 管理。

## 集成修复

1. 正常 Web profile 保留 `model-router-galgame`，并安装
   `@liustack/modlens@3.25.4`，两者不再互相覆盖。
2. 删除 GAL 路由器注册的伪 ModLens provider、`localhost:8000` 调用和过时设置项。
3. GAL 模型下拉框改读 DSH 官方 `remote.session.modelCatalog()`，选择改走官方
   `remote.session.selectModel()`，避免插件自造目录导致“模型都没了”。
4. 集体模式的算法候选只统计真实上游路由；本轮带图片且目标纯文本时，才映射到官方
   包装 provider。这样不会让包装模型与自身上游重复竞价，也不会处理两次图片。
5. 图片检测与官方实现对齐，覆盖顶层 `image` 和嵌套在 `tool-result` 中的图片。

## 现场页面验证

运行地址：`http://127.0.0.1:3080/`。

GAL 下拉框在连接正常的页面中显示：

- `DeepSeek-V4-Flash`
- `DeepSeek-V4-Pro`
- `DeepSeek-V4-Flash-Vision-Exp`
- `DeepSeek-V4-Flash (modlens vision)`
- `DeepSeek-V4-Pro (modlens vision)`

已现场切换到 `DeepSeek-V4-Pro (modlens vision)`，再切回
`DeepSeek-V4-Pro`。官方设置页也能显示“视觉引擎（ModLens）”卡片。

部分较早打开的浏览器页仍可能显示“正在读取模型”或缺少包装条目，这是断开连接的旧
页面快照；正常连接的新页面已经返回完整目录。3080 端口已由 DSH 进程监听，再次运行
`pnpm dsh web` 出现 `EADDRINUSE` 表示已有实例，不是插件安装失败。

## 真实识图试验

样本：用户提供的 DSH GAL 模型选择界面截图。

### DeepSeek Vision Exp（当前配置）

- ModLens provider：`openai`（OpenAI-compatible 协议）。
- 视觉模型：`deepseek-v4-flash-vision-exp`。
- 官方 CLI 返回完整 v2 结构化结果，包含 `summary`、`ocr`、`layout`、`semantics`
  和 `visual` 字段。
- OCR 正确读出 `DSH 本地构建`、`GAL 视窗`、`连接成功`、`DeepSeek娘`、
  `ModLens 已启用`、`发送` 等界面文字；布局还识别出侧栏、角色窗口、成本面板和
  输入区。
- 单次调用耗时约 `10.34` 秒，token 用量为 prompt `723`、completion `1169`、
  total `1892`。
- 原始结果：`test-artifacts/modlens-deepseek-vision-result.json`。

DSH 端到端会话 `session-8c67ca8a-45f0-42f2-8fd7-02c68c6f435b` 选择
`deepseek-modlens/deepseek-v4-pro` 后上传同一截图，历史记录确认实际模型来源为该
包装模型。纯文本模型基于视觉描述正确回答“截图里出现了‘ModLens 已启用’”，并列出
5 个可见文字，说明“上传 attachment → ModLens → 纯文本模型”的完整链路已经跑通。

附件注意：`test-artifacts/modlens-real-upload.png` 的文件内容实际是 JPEG。ModLens CLI
可按文件内容读取，但 DSH attachment 会校验 MIME；端到端上传应使用
`mediaType: image/jpeg`，文件名建议使用 `.jpg`。

### Claude CLI Haiku

- 官方 ModLens CLI 成功结束并返回完整 v2 schema。
- ModLens `meta.durationSeconds` 为约 152.8 秒，完整 provider attempt 为约 157.4 秒。
- 结果把 DSH GAL 截图误认成 Claude Code，并虚构
  `claude-opus-5`、`claude-sonnet-5`、`claude-haiku-4-5` 等菜单项。
- 结论：调用链成功，但视觉事实错误，结果不可用。

原始结果保存在：

`test-artifacts/modlens-official-screenshot-result.json`

### 其他尝试（历史记录）

- Claude CLI Sonnet：180 秒内未完成，超时。
- 初次临时尝试 DeepSeek Vision Exp 的 OpenAI-compatible 路线约 63 秒内未得到有效结果；
  重新按官方配置格式设置 provider、base URL 和模型后已复测成功，以上一节结果为准。

## 验收结论

| 原标准 | 当前结论 |
|---|---|
| 代码截图能准确识别错误信息 | 部分通过；DeepSeek 对当前 UI 截图 OCR 正确，代码错误金样本尚未验证 |
| 图表能提取数据点 | 未验证；尚无图表金样本 |
| 纯文本模型能基于描述回答 | 通过当前样本；DSH 端到端正确回答截图文字问题 |
| 成本节省 >95% | 未验证；无真实账单对照 |
| 理解时间 <3 秒 | 未通过；DeepSeek Vision Exp 实测约 10.34 秒 |

## 当前配置与下一步

当前 `C:\Users\Jianw\.modlens\config.json` 使用 `openai` provider，base URL 指向
DeepSeek 官方兼容接口，模型为 `deepseek-v4-flash-vision-exp`，thinking 关闭。API
凭据仅保存在本机配置中，未写入报告或日志。`claude-cli` 结果保留在上面的历史章节，
不再作为默认视觉引擎。

要完成剩余验收，需要补充代码错误截图和图表金样本，记录可复核的答案与数据点，
并用同一任务对比多模态基线和 ModLens 的真实账单。当前 10.34 秒已明显优于 Claude
CLI，但仍应通过图片压缩、提示词和服务端延迟优化继续逼近 `<3 秒` 目标。
