# 总项目任务报告 · Desktop rc.2 兼容修复（0.10.2）

日期：2026-10-01（Asia/Shanghai）。本轮由用户上传的官方桌面安装失败截图触发，继承上一轮 GitHub 与 npm 发布授权。0.10.1 保留，不覆盖已发布包。

## 问题与根因

截图中的宿主是 **DSH 0.2.0-rc.2**，而 0.10.1 的六项 DSH peer 仍精确为 `0.2.0-rc.1`。官方安装器逐项用 `semver.satisfies(runtimeVersion, range, { includePrerelease: true })` 核验并拒绝安装。本次错误属于版本约束不匹配，不能用重新下载同一 0.10.1 解决。

上一轮只对 rc.1 兼容检查和生成包做了验证，没有核对用户已经更新的 rc.2 实机，这是上一轮验证范围的缺口。

## 已完成的工作

1. 从官方 `dsh-v0.2.0-rc.1` 与 `dsh-v0.2.0-rc.2` 标签审计插件用到的 API，读取已安装 `app.asar` 元数据并运行官方 `dsh --version`，确认实际 runtime 为 rc.2。Node/pnpm 的 `runtime/versions.json` 不含 DSH 版本，不能替代检查。
2. 发布版本改为 **0.10.2**。六项 DSH peer 明确声明 **`0.2.0-rc.1 || 0.2.0-rc.2`**；拒绝未经验证的后续 rc 和正式版本。全部 DSH 开发 SDK 改为精确 rc.2，并更新锁文件。
3. 官方工具、LLM、sandbox、commands、settings、typert protocol、session-controller、app-boot、UI layout/settings 的相关源码在两标签间没有变化；gateway 和 remotes 为新增接口／挂载，插件无需实现其新增方法。Sidebar 只调整 Tooltip，插件管理器调整安装与升级提示。
4. 新增官方 gate 的兼容矩阵与负向测试：两个已支持版本接受，0.10.1 在 rc.2 拒绝，0.8 旧约束拒绝，rc.3／正式 0.2.0／0.3.0／1.0.0 拒绝。所有调用不使用版本豁免。
5. 更新中英文安装说明，明确指定 0.10.2，并区分安装失败未注册与同名旧插件已注册的处理。修复通过插件包交付，不修改宿主 `app.asar` 或用户账号配置。

## 文件说明

| 文件 | 本轮职责 |
| --- | --- |
| `package.json` | 0.10.2 版本、两个明确支持的 DSH peer 与 rc.2 开发 SDK。 |
| `pnpm-lock.yaml` | rc.2 开发依赖的可复现安装。 |
| `tests/desktop-compat.test.mjs` | 安装器 gate、SDK 版本、已发布错误版本和未来版本的回归矩阵。 |
| `.dsh-plugin/client.js` | 已用 rc.2 SDK 重建并检查；输出仍为 57,141,394 字节，与上一版客户端字节一致。 |
| `README.md` / `README.zh.md` | 当前版本入口、版本表与使用说明。 |
| `INSTALLATION_GUIDE.zh.md` | rc.2 安装问题根因、0.10.2 安装与旧实例处理步骤。 |
| `docs/ECHO_CITY_STORY.zh.md` | 当前安装版和五剧目说明；0.10.1 原有美术预览保持真实标注。 |
| 本报告 | API 审计、测试、真实运行时安装验证与发布结果。 |

## 已执行测试

| 检查 | 结果与范围 |
| --- | --- |
| `npm test` | **84 / 84 通过，0 失败、0 跳过**；在 rc.2 SDK 下运行，新增三项兼容回归。 |
| `node --test tests/gal-story*.test.mjs tests/gal-game*.test.mjs` | **67 / 67 通过，0 失败、0 跳过**；两组共 151 项。 |
| `npm run build:client` / `npm run check:client` | 通过，客户端 57,141,394 字节。 |
| `pnpm install --frozen-lockfile` | 通过。 |
| `pnpm peers check` | 通过。 |
| 官方已安装 CLI | `D:\Jianwei_Li\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd --version` 实际返回 `0.2.0-rc.2`。 |

用已安装官方桌面所带的 CLI 和 rc.2 运行时，在 F 盘独立 DSH_HOME／compat-rc2 profile 成功安装并动态加载本地 tarball。实际官方 Web UI 出现“模型路由”“Gal 模块”；七家官方工具探测返回真实状态，简单任务生成一个建议，复杂示例生成七个工作包及依赖，Gal 下拉显示五部剧目。未配置／调用真实模型，没有执行厂商安装或付费任务。这个隔离运行时验证不等于用户当前桌面 profile 的安装验收。

随后准备读取当前官方桌面安装页时，Computer Use 返回用户按物理 Esc 停止。已停止所有界面自动操作；没有安装、卸载或重启用户当前桌面中的插件。

## 安装包与发布结果

本地 0.10.2 tarball 已生成并用于上述 rc.2 隔离安装。当前尚未创建 v0.10.2 发布标签、上传 GitHub 或发布 npm。下一步完成用户桌面验证和发布手续后，发布同一最终包到 npm `next`／GitHub 预发布，并重新下载核对；已有 0.10.1 和所有历史发布保持不变。当前可手工在插件管理器输入 `F:\everyAI\all\model-router-galgame\dist\ljwei-stak-model-router-galgame-0.10.2.tgz` 安装。

## 用户需要做的测试

1. 在 Desktop rc.2 安装指定 0.10.2，核对版本以及“模型路由”“Gal 模块”入口。失败的 0.10.1 若没有出现在已安装列表，无需卸载；已经注册同名旧实例时按插件管理器的卸载重装指引处理，先保存／备份剧情槽位，不清理 profile 数据。
2. 检查五部剧目、Claude 原稿、双人物同场和旧春篇／正篇存档。此次未修改剧情与素材，应保持 0.10.1 内容。
3. 本人账号测试真实模型、CLI、团队依赖、输出和实际费用；这些项目不能由离线测试代替。

## 未完成事项与完成方法

| 事项 | 完成方法 |
| --- | --- |
| 真实账号执行与费用比较 | 继续采用前报告的固定任务对照，记录实际模型、账单与质量评分。 |
| 后续官方版本兼容 | 对新的官方发布逐项审计使用 API，升级开发 SDK、扩充兼容矩阵并实装验证后，才加入 peer 支持范围。 |
| 长篇 CG、JEV／Mistral 角色扩展与配乐 | 按开发报告继续制作，此次兼容修复不增加剧情或把原稿清单外的新人物算作已完成。 |

## 最终本地包校验

最终说明更新后重新打包：42851133 字节，37 文件；SHA-256：31BB9DFB15F68EF7466F3E02AE99A3692A714964FC64E1EA851659786E5CB85F。此包尚未发布。
