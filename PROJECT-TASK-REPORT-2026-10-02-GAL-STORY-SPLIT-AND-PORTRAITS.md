# 总项目任务报告：Gal 剧目拆分与 MiMo / Mistral 立绘校正

日期：2026-10-02  
项目：`@ljwei-stak/model-router-galgame`  
状态：本地开发改动已完成，尚未发布

## 本轮目标

主插件只提供两部剧目：**《回声之城·正篇》**与**《旧城迁移篇：未写完的约定》**。千桥协议、雪灯来信、未寄出的春天等其余篇目从主插件运行时代码、素材包和客户端菜单中拆出，源内容保留在独立 companion 目录，方便以后单独整理成故事包。回声之城仍可继续扩章，不依赖这些被拆出的故事模块。

## 已完成

### 1. 两部核心剧目

- Gal 剧目目录、标题入口和创建故事 API 现在只允许 `echo-chronicle` 与 `legacy`。
- 新进度默认进入回声之城正篇；旧城迁移篇既有版本 1 存档仍可恢复。
- 正篇与旧城篇使用各自的自动进度和手动存档槽键。存储中的其他旧剧目存档没有被清理；当前插件识别到被拆出剧目的存档时会拒绝加载并保留原数据。
- 移除了客户端对千桥、雪灯、春篇剧情引擎及春篇表情/场景模块的导入。两部内置故事仍会使用的共享背景保留在核心目录；仅供千桥篇使用的 Kimi 排练室背景已归档。
- Gal README、安装指南和剧目说明已改成两部内置剧目的当前事实，并明确归档位置和存档边界。

### 2. 其余剧目的独立归档

归档目录：`F:\everyAI\all\model-router-galgame-optional-stories`

- 千桥协议、雪灯来信、未寄出的春天的引擎、春篇六幕差分与场景图、原始生成素材、脚本、验证测试和历史说明都保存在该目录。
- 将主仓库原有的 **142 个文件**逐项映射检查：全部在 companion 中找到；**135 个文件与仓库 HEAD 字节一致**，另 7 个脚本/测试因 companion 路径布局调整而更新引用。没有缺失文件。
- companion 当前共有 **144 个文件，74,573,333 字节**。归档不是主插件构建或 npm 发布的依赖；目前是保留完整源码的本地项目，不是已发布的独立故事插件。
- 春篇舞台截图和千桥专属的 Kimi 排练背景也移到 companion。主插件不再引用或打包它们。

### 3. MiMo / Mistral 立绘核对

- MiMo 指向 `aipicture/Mimo.png`，SHA-256：`93e675bcee1937c06c6b621e84e16dd276420d60b651b3e9cc0928372c6f0cf1`。
- Mistral 指向 `aipicture/Mistral.png`，SHA-256：`e37b2af0e4037df1a659b6e14bce51f9b3525b4f27f48e184c80db580f938e0f`。
- 模型名/供应商识别已登记 Mistral。先前误作 MiMo 的 `Mimo1.png` 与 Mistral 原图字节相同，已从主目录移入 companion 保存，不再作为 MiMo 立绘。
- 自由模式与表情回退共用各自正确的基础原图。两张映射、清单哈希及图片可加载性均由测试核对。

## 主要文件与用途

| 文件/目录 | 用途 |
| --- | --- |
| `.dsh-plugin/shared/gal-story-catalog.mjs` | 白名单式核心目录，只注册正篇与旧城篇。 |
| `.dsh-plugin/client/GalStoryView.jsx`、`gal-module-page.jsx` | 标题选择、剧情入口、自由模式和章节 UI 与核心剧目列表保持一致。 |
| `.dsh-plugin/client/gal-story-storage.mjs` | 两部剧目的选择、自动进度键、手动槽键与历史存档兼容。 |
| `.dsh-plugin/client/characters.mjs`、`character-identity.mjs` | MiMo / Mistral 的身份别名与正确基础图。 |
| `aipicture/Mimo.png`、`aipicture/Mistral.png` | 各自权威原图的核心包副本。 |
| `.dsh-plugin/client/gal-story-backgrounds.mjs`、`client.js` | 移除未使用的 Kimi 排练室图并重建客户端 bundle。 |
| `package.json` | 主 npm 文件白名单保持核心化；归档不会进入包清单。版本仍为已发布的 0.11.1。 |
| `README.zh.md`、`README.md`、`INSTALLATION_GUIDE.zh.md`、`docs/ECHO_CITY_STORY.zh.md` | 当前剧目范围、安装说明、存档说明及拆分边界。 |
| `docs/GAL_ART_SOURCES.zh.md`、`docs/GAL_ART_PROMPTS.zh.md`、`docs/assets/gal-portrait-sources.json` | 原稿来源、哈希、表情图和场景美术资料。 |
| `tests/gal-story-catalog.test.mjs`、`gal-module.test.mjs`、`gal-save-transfer.test.mjs`、`gal-art.test.mjs`、`gal-fullbody.test.mjs` | 核心剧目白名单、npm 文件清单隔离、存档隔离、画面映射和立绘完整性。 |
| companion 项目的 `shared/`、`client/`、`output/`、`scripts/`、`tests/` | 保存拆出的故事引擎、素材、生成与验证来源。 |

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run build:client` | 通过；生成 bundle **53,952,207 字节**。 |
| `npm test` | **156/156 通过**，0 失败。 |
| `npm run check:client` | 通过，bundle 与源码一致。 |
| companion `node --test tests/gal-story-v2.test.mjs` | **11/11 通过**，包含归档与核心目录隔离检查。 |
| `npm pack --dry-run --json` | **42 个文件**，压缩后 **41,576,693 字节**，解包 **55,747,450 字节**；归档引擎、春篇资源、春篇预览、Kimi 排练图均为 0 个命中。 |
| 与 `dist` 中旧 0.11.1 本地包比较 | 新清单预计减少 **2,387,241 字节（约 5.4%）**。比较基线为 `dist/ljwei-stak-model-router-galgame-0.11.1.tgz`（43,963,934 字节）。 |
| 删除文件与归档核对 | 142/142 均可在 companion 找到；无缺失。 |

## 尚未完成与建议后续步骤

1. **桌面端人工验收**：在隔离的 DeepSeek Harness profile 安装一个新版本候选包，确认剧目列表严格只有两项；分别测试开始、继续、章节切换、三个手动槽、快捷存档、JSON 导入导出和重启恢复。特别确认旧城篇旧槽可读，切换到正篇不会覆盖。
2. **图片人工验收**：进入自由模式切换 MiMo 和 Mistral 模型，逐一确认角色名与全身图不串用；在正篇的舞台比例和 Windows 缩放下检查人物完整、对话框不遮挡。
3. **发布前版本**：源代码的 `package.json` 仍为已发布的 **0.11.1**，本轮没有推送 GitHub、上传 npm 或制作同版本安装包，以免用户无法分辨新旧包。桌面验收后应将版本升至 `0.11.2`，更新发布说明、生成有版本号的 `.tgz`，再按既有发布流程推送 GitHub 并发布 npm。
4. **可选剧目独立产品化**：companion 现在是完整保留源码的归档项目，不是独立安装插件。若要重新发布千桥/雪灯/春篇，应分别给故事包建立自己的 UI/目录注册、显式共享美术依赖、存档迁移策略和 npm 包，再为各包跑构建及官方桌面安装验收。不要把它们重新导入核心目录，否则会恢复本轮拆分要解决的包体和耦合问题。
5. **继续扩写正篇**：新章节与分支写入 `gal-story-echocity.mjs` 对应章节/路线数据；背景键和演员映射加入核心美术注册；更新章节进度和解锁测试、全路线遍历、存档回放测试及玩家文档。每次扩写后都运行 `npm test`、客户端构建，并在目标 Harness 版本验证一次舞台与存档。

本轮未修改已发布的 npm/GitHub 版本。用户完成桌面验收后，再把 0.11.2 候选包作为下一次正式发布对象。
