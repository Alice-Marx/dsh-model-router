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
3. 保留 `model-router:gal` 存档、设置与阅读记录键。相同浏览器 origin/profile 可继续读取；跨 profile 或 origin 必须导出/导入 JSON。推荐先导出备份，再升级或停用旧合并版，最后安装独立 GAL，避免旧 GAL 与新 GAL 暂时重复入口。
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
- GAL `npm test`：最终 100/100 通过。官方运行时安装检查发现空 Config 不生成客户端 namespace，已修正后重新运行。
- 两个核心项目合计 **170/170**：路由 70 项 + GAL 100 项；可选剧目归档另外 11/11 通过，不计入核心 170 项。
- 两项目均完成构建、生成客户端检查、冻结依赖安装与 peer 检查。
- 可选剧情归档：11/11 测试通过；引用已切换到新 GAL 与 legacy source。
- 已安装 CLI 实际版本 rc.2；所有安装检查使用 `F:\everyAI\all\wl-plugin-split-verify` 隔离 home，未更改用户桌面 profile、账号和 8080 服务。

- 官方 rc.2 三个隔离 profile 分别验证“仅路由”“仅 GAL”“两者一起”。路由独立安装只有路由入口，GAL 独立安装只有 GAL 入口，共同安装各一个入口；模型目录与路由规划、两部核心剧目、场景、存档保存与重载、设置预览均通过，客户端 runtime error 为 0。
- 隔离检查覆盖人物布局与设置界面预览，以及重新加载后的剧情存档恢复；未使用真实账号，不把离线结果当作模型质量或收费验证。

自动测试和隔离安装不替代真实账号费用/质量验收。

## 统一迁移步骤与在线指南

1. 在旧合并版导出需要保留的剧情 JSON，并备份 Harness profile；重要手动槽可逐个读档后分别导出。
2. 将旧合并版升级到路由 **0.12.0**，或先停用旧合并版。
3. 安装并启用独立 GAL **0.1.0**，打开对应剧目核对存档。
4. 相同浏览器 origin/profile 可继续使用旧键；不同 origin/profile 或未恢复进度时，选择同剧目后导入 JSON。

已发布的路由包指南采用“先安装 GAL，再升级路由”的顺序，完成两步后的结果仍兼容，但操作期间旧合并版和独立 GAL 可能暂时注册重复入口。推荐使用本报告的顺序；保留已发布包的不可变内容，不为文档顺序覆盖 npm 版本。

路由 npm 包不包含完整工作台教程和历史报告源码；解包后需要详细教程时使用 [GitHub 完整工作台使用指南](https://github.com/Alice-Marx/model-router-galgame/blob/main/docs/WORKBENCH_USER_GUIDE.zh.md)。源仓库中的对应相对链接存在，后续版本可补充包内教程或改用在线直链。

## 发布校验与当前状态

| 项目 | npm / 包状态 | tarball 大小 | SHA-256 | 源码对应 |
| --- | --- | ---: | --- | --- |
| 路由 0.12.0 | **npm 已成功发布，标签 `next`**；已从 npm 下载核验 | 333,507 字节 | `C3B2F354374B355DF1751DC64229BEEE2C09053B8CD7F9443BCA9FD36BAE0A06` | 下载包 29 个文件已与提交 `a15907f` 校验一致。 |
| GAL 0.1.0 | **npm 已成功发布，`latest` 与 `next` 均为 0.1.0**；已从 npm 重新打包核验 | 40,188,069 字节 | `B8E4DB966991A772C23A14F02E3EAB08B008DD7941651A98809A3283038DFDE9` | 注册表包的 16 个文件已与推送后的 `origin/main` 逐字节一致。 |

路由 GitHub Release **已发布并从公开下载验证**：[v0.12.0](https://github.com/Alice-Marx/dsh-model-router/releases/tag/v0.12.0)。GitHub 在本轮发布期间将原路由仓库重定向到规范地址 [Alice-Marx/dsh-model-router](https://github.com/Alice-Marx/dsh-model-router)；旧 `model-router-galgame` 地址会跳转。已更新本地 `origin`，保留原 npm 包身份以支持升级。主分支包含发布报告；标签 `v0.12.0` 仍固定在经核验的源码提交 `a15907f78abd2d611c2802f95167bb09deb3f815`，Release 附有已下载核验的 tarball 和 SHA-256 文件。独立 GAL 的 [GitHub v0.1.0 Release](https://github.com/Alice-Marx/deepseek-harness-galgame/releases/tag/v0.1.0) 也已公开发布并完成附件下载核对；标签固定在源码提交 `2aef3e42b8d266f7a45222d3010751771e3fbd90`。

GAL npm 的原始直连验证上传返回 `EOTP`；使用本机代理重新验证后，CLI 返回成功。为确认完整载荷，从官方 registry `npm pack` 得到的 tarball 与发布前包 SHA-1 / SHA-512 / SHA-256 一致，16 个文件也逐一与 GitHub `origin/main` 一致。安装命令需指定精确版本；路由包的 `latest` 仍是旧版 `0.4.32`，`next` 指向 `0.12.0`。

## 用户仍需要测试

1. 在本人 Desktop profile 先导出两部剧目进度，再升级到路由 0.12.0 或停用旧合并版，最后安装新 GAL；确认只出现一个 GAL 入口和一个路由入口。
2. 核对旧自动/手动槽、字体、音量、人物布局；若跨 origin 丢失进度，选择同剧目导入 JSON。JSON 不包含全部手动槽、设置或本地音乐文件。
3. 使用本人已登录厂商 CLI / 模型路线，验证任务调用、团队交付、自由模式和实际账单；本轮不启动付费模型或安装厂商 CLI。

## 后续工作与方法

| 工作 | 完成方式 |
| --- | --- |
| 正篇继续扩写 | 只在独立 GAL 仓库修改章节和素材；增加剧情/存档回归再发布 GAL 新版，不影响路由。 |
| 路由优化 | 在原路由仓库继续完善模型质量数据、价格和工作包算法，单独发布路由版本。 |
| 官方未来版本适配 | 审计使用 API，扩充 gate 测试并运行官方新 runtime 后才放宽 peer。 |
| 可选剧目未来重启 | 从同级归档恢复到独立扩展项目，设计显式数据包协议后再安装，不重新塞入当前主包。 |
