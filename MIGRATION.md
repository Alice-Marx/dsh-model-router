# 迁移到独立模型路由与 GAL 插件

从模型路由 **0.12.0** 开始，原合并插件拆成两份，均面向官方 **DeepSeek Harness Desktop 0.2.0-rc.1 / 0.2.0-rc.2**。

| 插件 | 安装输入 | 所属项目 |
| --- | --- | --- |
| 模型路由 | `@ljwei-stak/dsh-model-router@0.13.0`（0.12.0 起独立；0.13.0 起改名） | [路由仓库](https://github.com/Alice-Marx/dsh-model-router)；旧包名 `@ljwei-stak/model-router-galgame` 停在 0.12.0，不再更新。 |
| GAL | `@ljwei-stak/dsh-galgame@0.1.0` | [新 GAL 仓库](https://github.com/Alice-Marx/deepseek-harness-galgame)；独立安装与更新。 |

路由 0.12.0 只注册**模型路由**侧边栏入口。剧情引擎、角色美术、音乐、存档与自由模式全部归独立 GAL；两个插件互不依赖。

## 0.13.0 包名变更

0.13.0 起 npm 包名由 `@ljwei-stak/model-router-galgame` 改为 **`@ljwei-stak/dsh-model-router`**。旧包名停在 0.12.0（`next`）与 0.4.32（`latest`），不再更新，也不会被弃用或删除。

- 插件管理器把两者视为不同的包，不能原地“更新”：先卸载旧包（保留 profile 与应用数据），再添加新包。
- 不要同时安装：二者使用同一个 profile 条目 id `model-router-galgame` 和相同的 `model_router_*` 工具名。
- 保留的标识：profile 条目 id、侧边栏面板 id、设置命名空间与 Cordis 插件名仍为 `model-router-galgame`，执行记录仍在 `~/.dsh/model-router/state.json`，因此已保存的路由设置和执行记录继续生效。
- 改变的标识：npm 包名、`cordis.patch.yml` 中被加载的模块名、插件管理器设置卡识别的包名、宿主 Remote（typert）包键和更新检查查询的包名。

## 从合并版 0.11.x 迁移

1. **升级前备份**：旧 GAL 播放器导出需要保留的进度 JSON，并备份 Harness profile。JSON 保存当前剧情状态，不包含全部槽位、设置、已读记录或音乐；重要手动槽可依次读取后导出。
2. 在**同一个 Harness profile**安装 `@ljwei-stak/dsh-galgame@0.1.0`。
3. 在官方插件管理器卸载原包 `@ljwei-stak/model-router-galgame`，再添加 `@ljwei-stak/dsh-model-router@0.13.0`。完成两项安装后再打开剧情，避免并行使用旧合并 GAL 与新 GAL 入口。
4. 核对只有一个**模型路由**和一个**Gal 模块**入口。打开独立 GAL 检查当前进度、三槽及设置；同 profile 继续使用原 localStorage 键。
5. 若使用不同 profile 或没有读到进度，在 GAL 选择匹配剧目，再导入保存的 JSON。导入上限 **2 MB**，确认后替换当前剧情进度。

独立 GAL 保留 `model-router:gal-story:v1` 等既有存档命名空间，不因包名改变而主动清理旧数据。旧城迁移篇保留历史基础键，正篇使用其独立剧目键；其他已分出的故事存档字节不清理，但不能在仅有两部核心剧目的新播放器里运行。旧版所有故事的代码与专属素材保存在源代码归档。

两部核心剧目是**《回声之城·正篇》**和**《旧城迁移篇：未写完的约定》**。需要继续扩展正篇时只更新 GAL，路由功能调整只更新路由。只用路由无需安装 GAL。

## 从旧桌面适配迁移到官方 Harness

历史 **0.8.0** 声明 0.1.7-rc.2 依赖，当前官方桌面会拒绝它。历史 **0.10.1** 只接受 0.2.0-rc.1；rc.2 用户应安装上表精确版本，不修改 `app.asar` 或绕过版本检查。

1. 备份原 profile 与需要的故事状态。在官方插件管理器按升级流程替换重复旧实例，不清理应用数据。
2. 在 Harness 官方**模型**页核对供应商、模型与凭据。旧插件凭据不由本插件迁移或保存。
3. 打开**模型路由**核对模型目录、档案、建议、官方工具卡和设置。需要 GAL 时再单独安装其插件。
4. 真实模型意见使用 `model_router_consult`；单 CLI 任务使用 `model_router_tool_run`；依赖工作包使用 `model_router_team_execute`。可编辑执行需要干净 Git 仓库与官方工具审批。

## 功能归属与差异

| 功能 | 独立插件的行为 |
| --- | --- |
| 模型配置 | 在宿主官方“模型”页完成，两个插件都不保存 API Key。 |
| 路由规划 | 路由插件从官方目录与用户档案估算难度、质量、费用和工作包。 |
| 官方工具 | 路由插件维护七家固定来源安装与执行入口；ZCode 原厂安装器由用户选目录。 |
| 执行团队 | 路由插件的 CLI 团队执行器按依赖顺序运行；官方 Harness Agent Teams 的成员、消息与生命周期由宿主管理。 |
| 剧情与自由对话 | 独立 GAL 管理故事、立绘、音乐、设置和存档；自由模式经宿主模型服务调用，可能计费。 |
| 更新 | 通过官方插件管理器分别安装各自的新版本；发布使用 npm `next`，推荐精确版本。 |

登录、厂商实际模型和账单仍由账号持有人验收。完整步骤与安装后的检查见 [INSTALLATION_GUIDE.zh.md](INSTALLATION_GUIDE.zh.md)，GAL 播放器教程见[独立仓库](https://github.com/Alice-Marx/deepseek-harness-galgame#readme)。
