# ModLens 集成测试报告

> 复测更新：2026-09-03。视觉引擎已切换为 DeepSeek Vision Exp，以下结果覆盖 CLI 与 DSH 端到端验证。

## 结论

官方 `@liustack/modlens@3.25.4` 已安装到正常 Web profile，GAL 模型目录和模型切换
已恢复。视觉引擎已切换为 DeepSeek 官方兼容视觉接口；官方调用链和 DSH 端到端图片
会话均已验证。当前样本 OCR/描述正确，但单次视觉调用约 10.34 秒，严格的 `<3 秒`
目标以及代码错误、图表和成本三项仍未完成正式验收。

| 验证项 | 结果 | 证据 |
|---|---|---|
| 官方插件安装 | 通过 | Web profile 同时包含 `model-router-galgame` 和 `@liustack/modlens` |
| 官方工具注册 | 通过 | 官方 bundle 注册 `modlens_read_image` |
| 包装模型发现 | 通过 | 页面出现两个 DeepSeek `(modlens vision)` 条目 |
| GAL 模型目录 | 通过 | 普通模型、原生视觉模型和包装模型均可见 |
| GAL 模型切换 | 通过 | 通过 DSH 官方 `selectModel()` 切换并现场验证 |
| 集体模式图片路由 | 通过（代码回归） | 纯文本+图片转对应包装 provider；原生视觉与无图片请求保持原路由 |
| 官方 CLI 真实读图 | 通过 | `openai` provider + `deepseek-v4-flash-vision-exp` 返回完整 v2 schema，OCR/布局/语义正确 |
| DSH 图片上传与 attachment | 通过 | DSH 接受 JPEG MIME，历史记录保留图片并使用包装模型 |
| 纯文本模型基于描述回答 | 通过当前样本 | `deepseek-modlens/deepseek-v4-pro` 正确回答“ModLens 已启用”并列出 5 个文字 |
| 代码截图准确识别 | 部分通过 | UI 截图 OCR 正确；代码错误金样本尚未验证 |
| 图表数据点提取 | 未验证 | 尚无图表金样本结果 |
| 成本节省 >95% | 未验证 | 没有真实账单和同任务多模态基线 |
| 理解时间 <3 秒 | 未通过 | DeepSeek Vision Exp 单次约 10.34 秒；Claude CLI 仅作历史对照 |
| 插件自动测试 | 通过 | `44/44` 通过，0 失败 |

## 已撤销的旧测试结论

旧报告曾把 `localhost:8000` 关键词测试桩返回的 `TypeError`、`chart` 和
`data_points` 当成识图结果。该服务没有读取 PNG 像素，因此这些结果不能作为 ModLens
准确率、性能或成本证据。相关 Python 服务、HTTP 客户端和配置已从运行时集成中移除。

## DeepSeek 复测记录

- 配置文件：`C:\Users\Jianw\.modlens\config.json`（provider 为 `openai`，模型为
  `deepseek-v4-flash-vision-exp`；凭据未写入本报告）。
- CLI 结果：`test-artifacts/modlens-deepseek-vision-result.json`。
- 视觉调用：约 `10.34` 秒，`total_tokens=1892`。
- 识别内容：正确读出 `DSH 本地构建`、`GAL 视窗`、`连接成功`、`DeepSeek娘`、
  `ModLens 已启用`、`发送` 等，并返回角色窗口、成本面板、输入区等布局区域。
- DSH 会话：选择 `deepseek-modlens/deepseek-v4-pro`，上传图片后由纯文本模型基于
  ModLens 证据作答，证明包装路由可用。

注意：测试文件 `modlens-real-upload.png` 的内容实际为 JPEG。DSH 上传时应声明
`mediaType: image/jpeg`，否则会被 attachment MIME 校验拒绝。

真实使用过程与输出见
[MODLENS_REAL_USAGE_REPORT_2026-09-02.md](MODLENS_REAL_USAGE_REPORT_2026-09-02.md)。
