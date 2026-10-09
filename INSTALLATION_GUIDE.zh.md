# DeepSeek Harness Desktop · 独立插件安装与验证

模型路由从 **0.12.0** 起独立发布；GAL 是新的 **0.1.0** 插件。两者均声明支持官方 **DeepSeek Harness Desktop 0.2.0-rc.1 / 0.2.0-rc.2**，可分别安装和更新。

当前路由正式版为 **0.16.2**。本版修复官方工具更新/安装按钮：点击会真正启动更新，失败时在该行显示原因，而不是没有任何反应。0.16.1 的反馈缓存、刷新与预算保护仍然保留。公开数据默认关闭；主观偏好调整不改变公共能力评分或质量门槛。源码开发可使用独立模拟 UI 预览；安装时选择下方精确版本。

[路由 README](README.zh.md) · [迁移说明](MIGRATION.md) · [独立 GAL README](https://github.com/Alice-Marx/deepseek-harness-galgame#readme)

## 1. 选择需要的插件

| 需求 | 添加插件输入框 | 安装后的入口 |
| --- | --- | --- |
| 分析复杂度、按质量和费用选模型、调用官方工具 | `@ljwei-stak/dsh-model-router@0.16.2` | 模型路由 |
| 剧情、立绘、音乐、存档、自由对话 | `@ljwei-stak/dsh-galgame@0.1.0` | Gal 模块 |
| 两者都要 | 分别安装上面两个包 | 模型路由 + Gal 模块 |

旧 npm 包名 `@ljwei-stak/model-router-galgame` 最后版本为 0.13.0，之后不再更新；新安装使用 `@ljwei-stak/dsh-model-router`。自 0.12.0 起路由不含 GAL 入口或剧情美术。GAL 不依赖路由，路由也不依赖 GAL。

路由正式版发布在 npm **`latest`** 标签，预发布版在 `next`。推荐填写精确版本。不要省略版本号：`latest` 或镜像状态可能选择与当前宿主不兼容的旧包。

## 2. 从 npm 安装

1. 打开 **DeepSeek Harness Desktop → 插件 → 添加插件**。
2. 在“包名、GitHub 仓库地址或本地目录路径”输入框填一个完整包名，例如：

   ```text
   @ljwei-stak/dsh-model-router@0.16.2
   ```

   只想安装 GAL 时填写：

   ```text
   @ljwei-stak/dsh-galgame@0.1.0
   ```

3. 安装源选可连接的 **HTTPS** npm 源。新版本尚未同步到镜像时，选“自定义地址”并填官方源：

   ```text
   https://registry.npmjs.org/
   ```

4. 核对预览的包名、版本和宿主兼容信息，安装并启用。完全退出 Harness（包括托盘进程）再启动，确保 Host 加载新代码。
5. 检查插件详情与侧边栏：路由应为 **0.16.2 / 模型路由**；GAL 应为 **0.1.0 / Gal 模块**。仅装路由时没有 GAL 入口是预期行为。

普通用户无需 `npm install -g`，该命令不会把插件注册到当前 Harness profile。

## 3. 从 GitHub 版本化安装包安装

进入对应 Release 下载 `.tgz`：

- [模型路由 Releases](https://github.com/Alice-Marx/dsh-model-router/releases)（也可运行 `npm pack @ljwei-stak/dsh-model-router@0.16.2` 获取同一安装包）
- [独立 GAL v0.1.0](https://github.com/Alice-Marx/deepseek-harness-galgame/releases/tag/v0.1.0)

在“添加插件”填写下载文件的**绝对路径**，例如：

```text
D:\Plugins\ljwei-stak-dsh-model-router-0.16.2.tgz
```

```text
D:\Plugins\ljwei-stak-dsh-galgame-0.1.0.tgz
```

如附有 `.sha256` 文件，用 PowerShell 计算并比较摘要：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'D:\Plugins\ljwei-stak-dsh-model-router-0.16.2.tgz'
Get-FileHash -Algorithm SHA256 -LiteralPath 'D:\Plugins\ljwei-stak-dsh-galgame-0.1.0.tgz'
```

也可解压后填内层含 `package.json` 和 `.dsh-plugin` 的 `package` 目录。下载文件可放在 D 盘等自选位置，运行时数据目录由宿主 profile 决定。通过插件管理器更新，不修改 `app.asar` 或绕过版本检查。

## 4. 从合并版迁移：先备份，再拆分安装

1. 在旧合并插件的 GAL 播放器导出需要保留的剧情进度，并备份整个 Harness profile。每份 JSON 仅保存**当前剧情状态**，不含所有手动槽、设置、已读记录或本地音乐；重要槽位可依次读档再导出。
2. 在**同一个 profile**安装独立 `@ljwei-stak/dsh-galgame@0.1.0`。
3. 0.13.0 起包名改为 `@ljwei-stak/dsh-model-router`（旧包名最后版本为 0.13.0，内容相同，之后不再更新）：在插件管理器卸载原 `@ljwei-stak/model-router-galgame`（保留 profile 与应用数据），再添加 `@ljwei-stak/dsh-model-router@0.16.2`。不要两个同时安装（条目 id 与工具名相同）；条目 id 未变，路由设置与执行记录会保留。完成两项更新后再玩剧情，避免同时操作旧合并入口和新入口。
4. 现在路由与 GAL 各有一个入口。独立 GAL 沿用旧存档 localStorage 键，核对当前进度和三槽；更换 profile 或进度未恢复时，先切换到匹配剧目，再导入 JSON 备份。
5. 后续分别更新需要的插件；只用路由可以不启用或不安装 GAL。保留 profile 与应用数据，卸载插件时不要清理故事数据。

GAL 核心只包含**《回声之城·正篇》**与**《旧城迁移篇：未写完的约定》**。已分出的其他篇目保存在源代码归档，不在任一核心包里。其旧存档字节保留，但独立 GAL 核心不能运行那些旧剧目。

## 5. 模型路由第一次使用

工作台自 0.15.0 起分成**任务与执行、模型配置、官方工具、预算与安全**四页；0.16.2 沿用该布局。切换页面保留安装任务、终端会话和未完成的输入。

1. 在 Harness 官方**模型**页配置供应商、模型与凭据。插件读取准确的 `provider/model` 目录，模型档案不保存 API Key。
2. 在**模型配置**刷新目录，逐条填写自报质量评分、核对过的输入/输出单价（USD / 百万 token）和擅长方向；缺价留空。可选 `cliModel` 必须是该厂商 CLI 已验证接受的名字。可选 LiveBench 名称须准确对应版本与推理档位；它是用户确认的映射，不自动证明实际执行档位。
3. 在**任务与执行 → 任务规划**输入目标、步骤和验收标准。单任务推荐一条路线，团队模式为足够复杂的任务拆依赖工作包，指定模型跳过其他路线比较。预算是本地估价目标，`0` 表示不设本次估价约束，不限制厂商账单。
4. 点**生成路由建议**。建议直接显示在规划之后；规划计算在本机完成，不启动模型或 CLI。若已明确启用动态公开数据，读取账本/规划时可按检查间隔请求公开源，但不会把任务或反馈发送给这些源。
5. 需要真实只读执行时，使用**在工作台执行**，填写存在的工作区绝对路径（留空沿用上次运行）。先**预览执行计划**、核对路线/费用和全部确认原因，再明确确认执行。宿主启动前会重查；确认后才发生真实调用，结果写入执行记录。
6. 在**官方工具**检测、安装/更新工具并核对入口与登录。ZCode 打开原厂安装窗口后仍需用户选择目录并完成安装，再体检。可信入口就绪不等于账号和模型有权限。
7. 在**预算与安全**查看每日/月度预算、订阅失败策略及可读/写边界；**持续反馈与本地偏好**可设置学习启停、半衰期、收缩强度和调整上限，**动态公共数据**需自行启用。官方工具终端不经过 Harness 沙箱，继承用户登录环境，需单独确认启动。
8. 需要 CLI 修改文件时进入官方会话、选择工作区，明确请求 `model_router_tool_run` 或 `model_router_team_execute` 的 `workspace-write` 模式。可编辑托管执行要求干净 Git 仓库、宿主审批和进程沙箱。`model_router_execute` 用于只读路由执行，`model_router_consult` 用于模型 API 意见。

完整教程见[工作台使用指南](docs/WORKBENCH_USER_GUIDE.zh.md)；路线算法、订阅与数据保存说明见[README](README.zh.md)。

在成功结果上点 👍 / 👎，再次点已选评价可撤回。评价按准确路线和任务类型形成时间衰减、向零收缩的**主观偏好效用**，默认最大幅度 ±0.04，可配置到不超过 ±0.1；不抬高客观能力分或公共质量门槛。模型复核不视作人工评价，模型侧评分工具需要用户审批；本版不发起付费探索。

学习范围是同一个本地 **DSH_HOME** 共享的最近 **200 次运行**，不是多账号隔离或无限长期记忆。“从现在重新学习”只让旧结果不再参与学习，不删除执行记录和费用累计。动态价格只读取用户指定的公开、严格结构化、按官方文档策展的 USD/百万 token 固定费率快照；不是自动抓取所有厂商价目表，复杂阶梯/时段计费不能强行折成该格式。人工单价优先；公开数据默认关闭，详情见[动态数据与持续反馈说明](docs/ROUTING_ADAPTIVE_LEARNING.zh.md)。

注册表包含 Kimi、Claude、Codex、MiniMax、MiMo、Grok、Gemini 和 ZCode。Claude、Codex、MiMo、Grok 支持单工具/团队只读或可编辑执行；Kimi、MiniMax、ZCode 仅支持获批的可编辑托管执行。Gemini 有路由无界面适配器，不进入单工具/团队托管执行器。详见[官方工具与托管模式](README.zh.md#官方工具与托管模式)。CLI 模型名可能不同于 Harness 目录；多数 CLI 不提供可核验的实际模型 ID，要看厂商记录与账单。

安装使用固定官方 npm 包的 `@latest` 或 ZCode 签名安装器。希望 npm 工具安装在非 C 盘时，先按自己的空间规划配置全局前缀；Grok 数据目录与登录应使用一致的 `GROK_HOME`。MiniMax Windows 原生依赖失败时，从固定官方 HTTPS 来源下载最新版安装脚本，仅检查大小和基本内容结构后原样执行，**没有锁定该安装脚本的哈希**。安装后的 MiniMax CLI 代码另按已安装版本的官方 npm tarball 摘要核验。MiMo/Grok 同样使用官方 npm 内容证明；适用的 Claude/Codex/ZCode Windows 入口验证发布者签名，ZCode 内置脚本还有每个签名构建的首次信任摘要检查。具体规则见[执行器](.dsh-plugin/shared/official-tool-executor.mjs)和[npm 内容核验](.dsh-plugin/shared/npm-attestation.mjs)。

## 6. GAL 第一次使用

安装独立 GAL 后，从**Gal 模块**打开标题画面，选择正篇或旧城迁移篇；**Gal 设置**可调整完整立绘/半身表情、主角色与同伴大小位置、音乐与文字阅读。音乐首次播放需用户点击；剧情模式离线可玩。自由模式发送消息是真实模型调用，需宿主官方模型凭据，可能计费。

剧目章节、存档、快捷键、自动阅读、素材鉴赏与故障处理由[独立 GAL 仓库](https://github.com/Alice-Marx/deepseek-harness-galgame#readme)的教程维护。

## 7. 安装后验收

| 检查 | 预期 |
| --- | --- |
| 宿主版本 | 0.2.0-rc.1 或 0.2.0-rc.2；包括 `rc` 后缀。 |
| 路由独立安装 | 0.16.2 详情、模型路由入口、目录和模型档案可用；不出现旧合并 GAL 入口。 |
| GAL 独立安装 | 0.1.0 详情、Gal 模块入口、标题与两部核心剧情可用；不要求安装路由。 |
| 共同安装 | 两个入口各一份，路由工具和 GAL 播放器均能使用。 |
| 存档迁移 | 同 profile 可读旧键；跨 profile 用匹配剧目 JSON 导入；旧篇目的数据不覆盖。 |
| 本地规划 | 简单与复杂工作包分配可解释；价格未知保持未知；生成计划不调用模型。 |
| 官方工具 | 探测、固定来源安装、修复、取消和日志可检查；登录另验。 |
| 工作台只读执行 | 预览不启动模型，明确确认后执行；核对记录中的渠道、错误与费用。 |
| 持续反馈 | 点赞/不好/撤回后重新规划；调整只影响本地主观效用，停用与重置不抹除费用。 |
| 动态公开数据 | 默认关闭；自行启用后核对快照版本、校验时间及失败/过期状态；人工单价仍优先。 |
| 可编辑执行 | 在干净测试仓库核对审批、隔离工作区、补丁整合、厂商实际模型与计费。 |

历史 0.15.0 的自动测试验证为 220 项通过、3 项 Windows 平台跳过；组件 UI 预览检查使用模拟数据。**0.16.2 的发布验证见[更新记录](CHANGELOG.md)**，不把模拟公开源/模型流和组件预览当作真实付费调用或 Harness Desktop 端到端验收；上表中的实际安装、账号和工作区检查仍需在使用环境中完成。

## 8. 开发者从完整源码构建

路由需要 Node.js **22.19+** 与 **pnpm 10.34.6**。从完整源码仓库根目录构建；复现正式版 0.16.2 时检出对应发布标签。旧版（如 0.15.0）标签保留其当时内容。运行：

```powershell
pnpm install --frozen-lockfile --strict-peer-dependencies
npm run build:client
npm test
npm run check:client
npm run pack:local
```

pnpm 10 没有 `pnpm peers check`；使用严格依赖安装。客户端修改后必须重建，通过 `check:client` 再打包。将 `dist` 中本地包的绝对路径填入插件管理器，在测试 profile 验证；本地开发改动需独立验证，不能仅凭版本号判断包内容相同。

仅查看 UI 可运行 `npm run preview:ui` 并打开[本地预览](http://127.0.0.1:4173)。这是模拟目录、工具和执行记录，不启动 Harness Host、真实 CLI 或付费模型；不能代替桌面集成验收。GAL 独立仓库的开发与验证步骤以其自身 README 为准。

## 历史兼容提醒

合并版 **0.11.1 / 0.11.0** 声明 rc.1 与 rc.2；**0.10.2** 是未发布的本地兼容修复。已发布 **0.10.1** 仅声明 rc.1，rc.2 拒绝安装是 peer 依赖问题，换镜像不能修复；**0.8.0** 使用 0.1.7-rc.2 依赖，不用于当前宿主。历史 Git 标签和安装包保留，详见[更新记录](CHANGELOG.md)和[迁移说明](MIGRATION.md)。
