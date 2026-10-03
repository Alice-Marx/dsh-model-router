# DeepSeek Harness Desktop · 独立插件安装与验证

模型路由从 **0.12.0** 起独立发布；GAL 是新的 **0.1.0** 插件。两者均声明支持官方 **DeepSeek Harness Desktop 0.2.0-rc.1 / 0.2.0-rc.2**，可分别安装和更新。

[路由 README](README.zh.md) · [迁移说明](MIGRATION.md) · [独立 GAL README](https://github.com/Alice-Marx/deepseek-harness-galgame#readme)

## 1. 选择需要的插件

| 需求 | 添加插件输入框 | 安装后的入口 |
| --- | --- | --- |
| 分析复杂度、按质量和费用选模型、调用官方工具 | `@ljwei-stak/dsh-model-router@0.14.0` | 模型路由 |
| 剧情、立绘、音乐、存档、自由对话 | `@ljwei-stak/dsh-galgame@0.1.0` | Gal 模块 |
| 两者都要 | 分别安装上面两个包 | 模型路由 + Gal 模块 |

路由保留旧 npm 包名供原用户升级，包名中的 `galgame` 是历史名称；**路由 0.12.0 不含 GAL 入口或剧情美术**。GAL 不依赖路由，路由也不依赖 GAL。

路由正式版发布在 npm **`latest`** 标签，预发布版在 `next`。推荐填写精确版本。不要省略版本号：`latest` 或镜像状态可能选择与当前宿主不兼容的旧包。

## 2. 从 npm 安装

1. 打开 **DeepSeek Harness Desktop → 插件 → 添加插件**。
2. 在“包名、GitHub 仓库地址或本地目录路径”输入框填一个完整包名，例如：

   ```text
   @ljwei-stak/dsh-model-router@0.14.0
   ```

   只想安装 GAL 时填写：

   ```text
   @ljwei-stak/dsh-galgame@0.1.0
   ```

3. 安装源选可连接的 **HTTPS** npm 源。新版本尚未同步到镜像时，选“自定义地址”并填官方源：

   ```text
   https://registry.npmjs.org/
   ```

4. 核对预览的包名、版本和宿主兼容信息，安装并启用。有重启提示时重启桌面程序。
5. 检查插件详情与侧边栏：路由应为 **0.14.0 / 模型路由**；GAL 应为 **0.1.0 / Gal 模块**。仅装路由时没有 GAL 入口是预期行为。

普通用户无需 `npm install -g`，该命令不会把插件注册到当前 Harness profile。

## 3. 从 GitHub 版本化安装包安装

进入对应 Release 下载 `.tgz`：

- [模型路由 Releases](https://github.com/Alice-Marx/dsh-model-router/releases)（也可运行 `npm pack @ljwei-stak/dsh-model-router@0.14.0` 获取同一安装包）
- [独立 GAL v0.1.0](https://github.com/Alice-Marx/deepseek-harness-galgame/releases/tag/v0.1.0)

在“添加插件”填写下载文件的**绝对路径**，例如：

```text
D:\Plugins\ljwei-stak-dsh-model-router-0.14.0.tgz
```

```text
D:\Plugins\ljwei-stak-dsh-galgame-0.1.0.tgz
```

如附有 `.sha256` 文件，用 PowerShell 计算并比较摘要：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'D:\Plugins\ljwei-stak-dsh-model-router-0.14.0.tgz'
Get-FileHash -Algorithm SHA256 -LiteralPath 'D:\Plugins\ljwei-stak-dsh-galgame-0.1.0.tgz'
```

也可解压后填内层含 `package.json` 和 `.dsh-plugin` 的 `package` 目录。下载文件可放在 D 盘等自选位置，运行时数据目录由宿主 profile 决定。通过插件管理器更新，不修改 `app.asar` 或绕过版本检查。

## 4. 从合并版迁移：先备份，再拆分安装

1. 在旧合并插件的 GAL 播放器导出需要保留的剧情进度，并备份整个 Harness profile。每份 JSON 仅保存**当前剧情状态**，不含所有手动槽、设置、已读记录或本地音乐；重要槽位可依次读档再导出。
2. 在**同一个 profile**安装独立 `@ljwei-stak/dsh-galgame@0.1.0`。
3. 0.13.0 起包名改为 `@ljwei-stak/dsh-model-router`（旧包名最后版本为 0.13.0，内容相同，之后不再更新）：在插件管理器卸载原 `@ljwei-stak/model-router-galgame`（保留 profile 与应用数据），再添加 `@ljwei-stak/dsh-model-router@0.14.0`。不要两个同时安装（条目 id 与工具名相同）；条目 id 未变，路由设置与执行记录会保留。完成两项更新后再玩剧情，避免同时操作旧合并入口和新入口。
4. 现在路由与 GAL 各有一个入口。独立 GAL 沿用旧存档 localStorage 键，核对当前进度和三槽；更换 profile 或进度未恢复时，先切换到匹配剧目，再导入 JSON 备份。
5. 后续分别更新需要的插件；只用路由可以不启用或不安装 GAL。保留 profile 与应用数据，卸载插件时不要清理故事数据。

GAL 核心只包含**《回声之城·正篇》**与**《旧城迁移篇：未写完的约定》**。已分出的其他篇目保存在源代码归档，不在任一核心包里。其旧存档字节保留，但独立 GAL 核心不能运行那些旧剧目。

## 5. 模型路由第一次使用

1. 在 Harness 官方**模型**页配置供应商、模型与凭据。插件只读取准确的 `provider/model` 目录，不另存 API Key。
2. 打开**模型路由 → 逐模型价格与能力**，逐条填写自报质量评分、核对过的输入/输出单价（USD / 百万 token）、擅长方向；缺价留空。厂商 CLI 模型名 `cliModel` 可选，必须是该 CLI 接受的名字。
3. 在**任务规划**输入目标、步骤与验收标准。单任务给一项建议，团队分工把复合任务拆成有依赖的工作包。预算是本地估价目标，0 表示不设估价约束，不限制实际厂商账单。
4. 点**生成路由建议**，向下滚过模型档案编辑区，查看**路由建议**和各工作包。规划不启动模型。
5. 在**官方工具**卡片检测、安装或修复可信执行入口；ZCode 使用原厂安装窗口，用户选择安装目录后重新检测。就绪只证明本地入口通过检查。
6. 实际执行时进入官方会话、选工作区，明确请求 `model_router_consult`、`model_router_tool_run` 或 `model_router_team_execute`。可编辑运行需要干净 Git 仓库与宿主工具审批。

完整页面教程、参数和结果位置见[工作台使用指南](docs/WORKBENCH_USER_GUIDE.zh.md)，算法推导见[README](README.zh.md#路由算法从输入到分配)。

Claude、Codex、MiMo、Grok 支持只读或可编辑；Kimi、MiniMax、ZCode 无界面模式仅在获批的隔离可编辑工作区运行。CLI 模型名可能不同于 Harness 目录；多数 CLI 不提供可核验的实际模型 ID，要看厂商记录与账单。

希望官方 CLI 尽量装在非 C 盘时，先按自己的空间规划配置 npm 全局前缀。MiniMax Windows npm 原生依赖失败时使用锁定哈希的官方安装脚本兜底，内容变化会拒绝执行；Grok 非 C 盘 npm 安装的数据目录与登录须使用一致的 `GROK_HOME`。

## 6. GAL 第一次使用

安装独立 GAL 后，从**Gal 模块**打开标题画面，选择正篇或旧城迁移篇；**Gal 设置**可调整完整立绘/半身表情、主角色与同伴大小位置、音乐与文字阅读。音乐首次播放需用户点击；剧情模式离线可玩。自由模式发送消息是真实模型调用，需宿主官方模型凭据，可能计费。

剧目章节、存档、快捷键、自动阅读、素材鉴赏与故障处理由[独立 GAL 仓库](https://github.com/Alice-Marx/deepseek-harness-galgame#readme)的教程维护。

## 7. 安装后验收

| 检查 | 预期 |
| --- | --- |
| 宿主版本 | 0.2.0-rc.1 或 0.2.0-rc.2；包括 `rc` 后缀。 |
| 路由独立安装 | 0.14.0 详情、模型路由入口、目录和模型档案可用；不出现旧合并 GAL 入口。 |
| GAL 独立安装 | 0.1.0 详情、Gal 模块入口、标题与两部核心剧情可用；不要求安装路由。 |
| 共同安装 | 两个入口各一份，路由工具和 GAL 播放器均能使用。 |
| 存档迁移 | 同 profile 可读旧键；跨 profile 用匹配剧目 JSON 导入；旧篇目的数据不覆盖。 |
| 本地规划 | 简单与复杂工作包分配可解释；价格未知保持未知；生成计划不调用模型。 |
| 官方工具 | 探测、固定来源安装、修复、取消和日志可检查；登录另验。 |
| 真实执行 | 在测试仓库核对审批、隔离工作区、补丁整合、厂商实际模型与计费。 |

构建、自动测试、包内容和发布校验由本次总项目报告记录。真实账号调用与用户现用 profile 的验收仍需账号持有人进行。

## 8. 开发者从完整源码构建

路由仓库检出 `v0.14.0`；GAL 仓库检出 `v0.1.0`。使用 Node.js **22.19+** 与 pnpm，各自在根目录运行：

```powershell
pnpm install --frozen-lockfile
npm run build:client
npm test
npm run check:client
pnpm peers check
npm pack --pack-destination dist
```

两项目的生成包互相独立。客户端有修改时必须重建，再将包绝对路径填入插件管理器验证。

## 历史兼容提醒

合并版 **0.11.1 / 0.11.0** 声明 rc.1 与 rc.2；**0.10.2** 是未发布的本地兼容修复。已发布 **0.10.1** 仅声明 rc.1，rc.2 拒绝安装是 peer 依赖问题，换镜像不能修复；**0.8.0** 使用 0.1.7-rc.2 依赖，不用于当前宿主。历史 Git 标签和安装包保留，详见 [README 版本表](README.zh.md#历史版本)。
