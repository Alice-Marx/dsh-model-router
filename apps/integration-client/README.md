# 统一 Bot 客户端

## 工作空间重构（本地开发预览）

`workspace-navigation.mjs` 定义工作空间页面和按产品 API 隔离的 UI 深链、一次性目标转交与内存草稿；不存权限或执行凭据。`workspace-model.mjs` 从已提交投影生成总览、搜索与看板；未加载的任务不计入统计，不推算节省时间。

`workspace-ui.jsx` 提供首页、任务待办、成员目录、键盘搜索和外观控制。`workspace.css` 重排产品导航与信息层级，并在明暗主题、紧凑密度和窄屏下使用同一组语义颜色。产品页内 Ctrl/Cmd K 打开工作空间搜索；聊天中的原搜索继续由 Bot 界面处理。外观偏好保存在本机浏览器，目标文本仅在当前宿主 API 的内存里保留。

新目标仍先检查候选与预览，再通过原始提交确认流程派发；看板不提供拖动改状态。任务链接由 Bot ID 与 Task ID 共同定位，电脑搜索只聚焦原电脑卡片，不自动连接或取得控制。

```sh
node --test tests/workspace-model.test.mjs tests/workspace-ui.integration.test.mjs
node scripts/verify-workspace-browser.mjs
node scripts/verify-workspace-browser.mjs --serve
```

浏览器脚本运行真实产品组件与离线 fixture，截图明确标注为本地验证数据；它不证明实际 Harness Desktop 的完整安装、Electron 或用户 profile 已验收。

`index.jsx` 在同一 ModuleLoader factory 中安装完整冻结 DS 界面和现有 MR 高级工作台。
默认沿用 DS 的 Main、Bot/工作群、记忆、侧聊、语音、设置、能力与计划任务。
通过公共 sidebar.workspaces slot 包装原 TeamSidebar，联系人保留主区域，底部使用
ContactNavigation 的待办、工作空间和资源菜单。HeaderPill 通过自有 product-overlay
增加会话工具，原注册组件身份、工作目标、审批、输入和执行授权继续由 native 路径负责。

产品页读取宿主 `schemaVersion:1` 投影。缺后端、宿主读取错误、只读锁、未知费用、
未在线/锁屏机器都有明确状态和下一步；列表不放示例 Bot、机器、任务或收据。
Task 的核对/取消/重试只有宿主声明动作可用时显示，最终授权仍由宿主执行。

```sh
node scripts/integration-product-client.mjs
node scripts/integration-product-client.mjs --check
node --test tests/bot-runtime-product.test.mjs tests/bot-runtime-ui.test.mjs
```

默认生成主包统一的 `.dsh-plugin/client.js`，`--output <path>` 可显式指定其他位置。
构建 API `bundleProductClient()` 返回 `{code,inputs,bytes}`，
`generateProductClient({output,check})` 可供主构建脚本调用。生成物只有一个 loader id
`@ljwei-stak/dsh-model-route-bot`，没有单独 `ds-bot` 的 loader。纯路由包 `@ljwei-stak/dsh-model-router` 使用独立工作台入口，不导入此集成客户端。
React、ReactDOM 与 Harness UI primitives 继续由宿主提供。

实际 bundle 大小以构建结果为准。旧 MR 的单独客户端保持原构建方式。
发布还需在主包的客户端依赖声明中包含 DS 公开
`inject` 所需的 sessions、uiWorkspace、uiConversation、slots、theme、layout 等服务。

组件 DOM 检查覆盖未知 Operation 原依据、核对请求使用原 taskId、同模型不同 Bot、
未接入权限、未知金额及 Windows 锁屏原因。实际浏览器/Electron 的整体布局、键盘/窄屏
和默认 profile 升级仍需单独验收；本目录的 DOM 检查不宣称这些已通过。

安全配对使用 `secure-pairing.jsx` 与 `pairing-qr.jsx`，支持短期邀请、独立确认码、摄像头
和本地二维码图片解码。jsQR 1.4.0 的 Apache-2.0 许可证随
`licenses/jsqr-1.4.0-LICENSE.txt` 分发；源码和作者见 https://github.com/cozmo/jsQR。
二维码图像不会发送给模型或外部解码服务。摄像头仅在显式点击后开启。
协议、Host 与 Agent 的实现及验证边界见
`docs/implementation/20261107-secure-pairing.md`；尚不代表全功能迁移或真实用户桌面验收完成。
