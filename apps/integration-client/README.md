# 统一 Bot 客户端

`index.jsx` 在同一 ModuleLoader factory 中安装完整冻结 DS 界面和现有 MR 高级工作台。
默认沿用 DS 的 Main、Bot/工作群、记忆、侧聊、语音、设置、能力与计划任务。
通过公共 sidebar.workspaces slot 包装原 TeamSidebar，在底部增加中文入口：
Bot 绑定、任务、远程电脑、费用与用量、高级工作台。没有修改 vendor 或旧 MR 大面板。

四个产品页只读取宿主 `schemaVersion:1` 投影。缺后端、宿主读取错误、只读锁、未知费用、
未在线/锁屏机器都有明确状态和下一步；列表不放示例 Bot、机器、任务或收据。
Task 的核对/取消/重试只有宿主声明动作可用时显示，最终授权仍由宿主执行。

```sh
node scripts/integration-product-client.mjs
node scripts/integration-product-client.mjs --check
node --test tests/bot-runtime-product.test.mjs tests/bot-runtime-ui.test.mjs
```

默认生成 `apps/integration-client/client.js`；`--output <path>` 可写入主包统一的
`.dsh-plugin/client.js`。构建 API `bundleProductClient()` 返回 `{code,inputs,bytes}`，
`generateProductClient({output,check})` 可供主构建脚本调用。生成物只有一个 loader id
`@ljwei-stak/dsh-model-route-bot`，没有单独 `ds-bot` 的 loader。纯路由包 `@ljwei-stak/dsh-model-router` 使用独立工作台入口，不导入此集成客户端。
React、ReactDOM 与 Harness UI primitives 继续由宿主提供。

当前完整功能并集 bundle 约 2 MiB。旧 MR 的单独客户端保持原构建方式，是否切换默认
产物由主插件接入与产品验收决定。发布还需在主包的客户端依赖声明中包含 DS 公开
`inject` 所需的 sessions、uiWorkspace、uiConversation、slots、theme、layout 等服务。

组件 DOM 检查覆盖未知 Operation 原依据、核对请求使用原 taskId、同模型不同 Bot、
未接入权限、未知金额及 Windows 锁屏原因。实际浏览器/Electron 的整体布局、键盘/窄屏
和默认 profile 升级仍需单独验收；本目录的 DOM 检查不宣称这些已通过。
