# DSH 模型路由

中文 | [English](README.md)

[![npm 版本](https://flat.badgen.net/npm/v/@ljwei-stak/dsh-model-router)](https://www.npmjs.com/package/@ljwei-stak/dsh-model-router)

DeepSeek Harness 的模型路由工作台。安装后保留 Harness 原有界面，在侧栏增加 **模型路由** 入口。此包不安装 DS Bot、Bot 对话、Bot 资料库、例行任务和远程电脑。

需要包含模型路由的完整 Bot 工作区，请安装 **`@ljwei-stak/dsh-model-route-bot`**。同一个 profile 选择一种安装形态；两者沿用同一个路由配置标识。

## 安装

在 Harness 的 **插件 → 添加插件** 输入 `@ljwei-stak/dsh-model-router@0.64.0`，从侧栏打开 **模型路由**。Provider 凭据和模型仍在 Harness 官方 **模型** 设置中配置。

## 使用

1. 填写目标与预期结果。单任务选择一条路线，团队分工生成有依赖的工作包，指定模型使用你选择的准确模型。
2. 按需比较本地路线建议或手动调整工作包。费用估算需要为准确模型配置价格。
3. 预览执行，核对模型/工具、工作区、权限、API 预估费用与订阅用量。预览不会调用模型。
4. 确认后启动选中的模型或受支持的官方工具。在执行记录中查看结果、费用、取消状态及受支持的重试。

**模型配置** 管理路线档案与价格；**官方工具** 检测、安装及打开厂商 CLI，各工具使用自己的登录；**预算与安全** 设置 API 限额，并单独核对订阅用量。已安装、已登录仍需通过所选执行模式的就绪检查。

模型路由按只读方式执行。需要修改文件时，选择团队分工、官方工具协作和明确的“编辑文件”权限，核对预览后执行。厂商 CLI 正常环境使用当前用户权限；独立工作树归集修改，不限制工作树外访问。

“需要你处理”面板可用右上角 × 关闭，顶部 **显示待处理提醒** 可恢复；当前设备会记住选择。

## 切换安装形态

需要完整 Bot 工作区时，在插件管理中移除此安装入口，再在同一个 Harness profile 添加 **`@ljwei-stak/dsh-model-route-bot`**。保留现有数据目录并沿用已配置的 Bot 目录。内部路由配置标识沿用原值；同一时间启用一种安装形态。

## 许可与参考

[MIT](LICENSE)。当前源码与完整版本说明：[GitHub](https://github.com/Alice-Marx/dsh-model-router)。[技术文档及版本记录](https://gitlab.com/Alice_marx/dsh-model-router)。
