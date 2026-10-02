# 总项目任务报告：路由与 GAL 独立插件

日期：2026-10-02。目标：用户可只安装模型路由，再按需安装独立 GAL；两个项目分别维护源码、版本、npm 包和 GitHub Release。

## 完成的开发

| 项目 | 版本 / 安装标识 | 职责 |
| --- | --- | --- |
| Model Router | `@ljwei-stak/model-router-galgame@0.12.0` | 保留旧包身份便于升级，仅注册模型路由。复杂度分析、费用与质量权衡、工作包依赖、官方工具探测/安装/执行继续独立工作。 |
| DeepSeek Harness GAL | `@ljwei-stak/dsh-galgame@0.1.0` | 独立 Host、客户端、通信通道、配置与发布。只内置回声之城·正篇和旧城迁移篇：未写完的约定。 |

新仓库：https://github.com/Alice-Marx/deepseek-harness-galgame 。路由仓库继续使用 https://github.com/Alice-Marx/model-router-galgame 。两包支持 Desktop 0.2.0-rc.1 / rc.2；不绕过官方兼容检查。

1. 路由移出 GAL 的侧栏、主页面、模型对话 RPC、剧情引擎、人物/背景/音乐依赖。客户端从 53,952,207 字节降至 154,122 字节；安装时不会再下载整套 GAL 美术。
2. GAL 的自由模式只使用独立 `dshGalgame` RPC 和官方 `llm`，没有官方工具安装或路由规划依赖。双方构建脚本用 esbuild 依赖图阻止模块重新耦合。
3. 保留 `model-router:gal` 存档、设置与阅读记录键。相同浏览器 origin/profile 可继续读取；跨 profile 或 origin 必须导出/导入 JSON。安装新插件后再把旧合并版升级，完成两步后避免旧 GAL 与新 GAL 重复入口。
4. MiMo 与 Mistral 分别保留正确原稿，Claude 继续使用用户指定原稿；新仓库包含 29 张注册人物、差分、场景、配乐数据和制作源文件。
5. 移出旧路由的 423 文件 / 199,385,473 字节全部保存在同级 `model-router-galgame-legacy-source`，逐文件 SHA-256 一致；原发布历史和报告留在路由仓库。先前可选剧目保存在 `model-router-galgame-optional-stories`，不进入两包。归档不是可安装插件。

## 主要文件说明

| 文件 | 说明 |
| --- | --- |
| 路由 `.dsh-plugin/client/official-harness.jsx` | 只注册路由工作台和路由设置；旧配置 namespace 保持兼容。 |
| 路由 `official-tools-remote-service.mjs` / `shared/official-tools-remote.mjs` | 只保留探测、安装、取消与状态 RPC。 |
| 双方 `scripts/build-client.mjs` | 生成宿主单文件客户端，并拒绝另一模块的依赖。 |
| 路由 `tests/plugin-split.test.mjs` | 验证包身份、无 GAL 美术/存档代码与独立 RPC 边界。 |
| `scripts/check-split-desktop.mjs` | 已安装官方 rc.2 CLI 的三个隔离 profile 浏览器检查；通过参数读取启动日志，不在脚本中存账号。 |
| 双方 `package.json` / `pnpm-lock.yaml` / `cordis.patch.yml` | 独立包、版本、可复现依赖与 Host 注册。 |
| 双方 README / 安装指南 / MIGRATION | 精确版本安装、独立选择、迁移顺序与存档范围。路由保留算法推导与图文教程。 |
| 新 GAL 的 `shared/gal-remote.mjs` / `gal-remote-service.mjs` | bounded 请求、UUID 取消、官方模型目录校验、超时和回复截断。 |
| 新 GAL 的 `client/gal-catalog.mjs` | 只转换官方可路由目录；不会引入路由规划算法。 |
| 归档 `SOURCE-MAPPING-SHA256.json` | 保存移出旧源码的路径、文件尺寸与哈希；可恢复制作历史。 |

## 验证记录

- 路由 `npm test`：70/70 通过。保留费用/质量、任务分配、团队依赖、取消、模型不符和 Git 集成回归。
- GAL `npm test`：初版 96/96 通过；官方运行时安装检查发现空 Config 不生成客户端 namespace，修正后再次验证并在下方记录最终结果。
- 两项目均完成构建、生成客户端检查、冻结依赖安装与 peer 检查。
- 可选剧情归档：11/11 测试通过；引用已切换到新 GAL 与 legacy source。
- 已安装 CLI 实际版本 rc.2；所有安装检查使用 `F:\everyAI\all\wl-plugin-split-verify` 隔离 home，未更改用户桌面 profile、账号和 8080 服务。

发布前的测试、包尺寸、校验、安装三组合与 npm/GitHub 结果在最终发布段补充。自动测试和隔离安装不替代真实账号费用/质量验收。

## 用户仍需要测试

1. 在本人 Desktop profile 先导出两部剧目进度，安装新 GAL，升级路由到 0.12.0，确认只出现一个 GAL 入口和一个路由入口。
2. 核对旧自动/手动槽、字体、音量、人物布局；若跨 origin 丢失进度，选择同剧目导入 JSON。JSON 不包含全部手动槽、设置或本地音乐文件。
3. 使用本人已登录厂商 CLI / 模型路线，验证任务调用、团队交付、自由模式和实际账单；本轮不启动付费模型或安装厂商 CLI。

## 后续工作与方法

| 工作 | 完成方式 |
| --- | --- |
| 正篇继续扩写 | 只在独立 GAL 仓库修改章节和素材；增加剧情/存档回归再发布 GAL 新版，不影响路由。 |
| 路由优化 | 在原路由仓库继续完善模型质量数据、价格和工作包算法，单独发布路由版本。 |
| 官方未来版本适配 | 审计使用 API，扩充 gate 测试并运行官方新 runtime 后才放宽 peer。 |
| 可选剧目未来重启 | 从同级归档恢复到独立扩展项目，设计显式数据包协议后再安装，不重新塞入当前主包。 |
