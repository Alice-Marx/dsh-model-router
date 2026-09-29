# Model Router 总项目任务报告（2026-09-30）

## 本轮目标与状态

本轮基于 `F:\everyAI\all\galgame`（Ren'Py 工程《大模型娘物语：回声之城》）完成三件事：① 修复并行会话遗留的**构建断裂**（gal-story-spring 引用了四个从未入库的文件）；② 补齐缺失的美术链路（六表情立绘板的切片接线 + 春篇场景图）；③ 把**正篇长剧情**完整接入 gal 模块并注册为第五剧目 `echo-chronicle`（回声之城·正篇，存档版本 5）。候选版本 **`0.10.0`**，本地包已打出；按用户要求 **npm 上传继续等待插件全部验证可用后进行**。

## 已完成工作

1. **并行工作考古与修复**：本地仓库领先远端（0.9.x 系列 5 个未推送提交），且 `gal-story-spring.mjs` 引用的 `gal-spring-act1/act3.mjs`、`gal-spring-portraits.mjs`、`gal-spring-backgrounds.mjs` 四个文件不存在，`npm run build:client` 与 `npm test` 全部断裂。已全部补齐（见下），仓库恢复可构建可测试。
2. **表情差分切片**（多状态立绘）：并行美术流程已在 `output/spring/raw/` 生成 15 个角色的**六表情透明立绘板**（3×2：平静/微笑/低落/坚定/惊讶/羞涩），但从未切片。本轮按格切片 → alpha 裁边 → 统一缩放 480px 高 → ffmpeg 转 WebP（单张 421KB→27KB，94% 压缩），产出 **90 张差分**共 2.75MB，写入 `.dsh-plugin/client/spring-portraits/`，并生成 `gal-spring-portraits.mjs`（`SPRING_PORTRAITS` + `SPRING_ORIGINALS` 两个契约导出，后者给 aipicture 库没有的 hy/novelai 提供默认形象；comfyui/gptimage 无底板，走既有优雅回退）。`gal-game-expressions.mjs` 的 `expressionFor` 现在能对 15 个角色返回**与情绪匹配的真实差分立绘**，不再只有静态图。
3. **春篇场景图**：从 raw 底图加工 5 张 1280 宽 WebP 场景图（工坊雨棚/地下档案库/钟室/庭院/车站）+ 复用千桥终幕图作为黎明广场，写入 `gal-spring-backgrounds.mjs`；spring 全部 `backgroundId`（workshop/archive/clock/garden/station/dawn）都有真实场景图。
4. **缺失剧情补齐**：手写 `gal-spring-act1.mjs`（s01–s04 草稿桥：潮气清单→地下档案库→分工边界→雨仍在下，标明可被原作重写）与 `gal-spring-act3.mjs`（s09–s12：复述练习→散页来历→出发之前→黎明之前），不设置任何主线旗标，spring 的真结局判定（`trueEndingReady`）完全沿用原设计。spring 现为完整 12 章、可从 s01 一路玩到第六日黎明广场的五结局终选。
5. **正篇长剧情接入**（本轮主交付）：`gal-story-echocity.mjs`（v5）忠实转译 EchoCity Ren'Py 工程——**共通线八章**（序章/百模之春/五日之变/价格战与推理元年/雪夜惊钟/祭典与污点/出园之夏/封印与抉择）、**六条主线**（ChatGPT 真/暗双结局、Claude、DeepSeek、Llama、Grok、RWKV）、**隐藏线「影与身」**（五幕，含命名之夜的文本输入与"衔雪"取名）、**TRUE END「回声之城」**。保留原作的好感度体系（14 人）与 Flag 体系（recite_names/transcribe_light/lift_together/x4_count 等）。三处已注明适配：transcribe_light 移到第四章抄录选项、x4_count 第二次累计落第七章、取名用文本输入替代 renpy.input。
6. **引擎能力**：跨章节切换 `switchChapter`（旗标与好感度延续，trail 记录可重放）；章节锁与完成态 `chapterStates`（隐藏线需雪国线真结局+抄录旗+两次日常留意；TRUE END 需六线+隐藏线全通）；好感度面板 `storyAffinities`；图完整性自检 `storyGraphIssues`（当前 0 问题）；节点/立绘/情绪/背景四层映射（~50 个 Ren'Py 场景 id → 15 张已入库场景图）。
7. **UI 接入**：剧情模式为正篇剧目提供章节下拉（🔒 锁定标记、✓ 完成标记、锁定悬浮提示）、好感度面板开关、命名之夜文本输入框；立绘显示修复由并行会话的 `StagePortrait`+`expressionFor` 链路承担，本轮补齐了它依赖的全部数据（表情差分 + `ds-myst` 立绘别名）。
8. **验证**：`npm test` **72/72 通过**（新增 2 项：正篇全周目跨章回归 + spring 全 12 章编译与开篇）；客户端构建 52,209,051 字节且与源码一致；正篇全自动全周目 333 步走通 TRUE END、七面旗全达成、好感度排序正常、跨章存档 JSON 往返无损。

## 文件说明

| 文件 | 本轮职责 |
| --- | --- |
| `.dsh-plugin/shared/gal-story-echocity.mjs` | **新增**。正篇 v5 引擎与全文（约 1170 行）：17 章、180+ 节点、选择/旗标/好感度/命名输入/结局体系；场景与情绪映射表。 |
| `.dsh-plugin/shared/gal-spring-act1.mjs` | **新增（草稿桥）**。春篇 s01–s04，修复构建断裂；无主线旗标。 |
| `.dsh-plugin/shared/gal-spring-act3.mjs` | **新增（草稿桥）**。春篇 s09–s12，衔接 s08 决定与黎明广场终选。 |
| `.dsh-plugin/client/gal-spring-portraits.mjs` | **新增（补契约）**。90 张差分的导入与 `SPRING_PORTRAITS`/`SPRING_ORIGINALS` 导出。 |
| `.dsh-plugin/client/spring-portraits/*.webp` | **新增**。15 角色 × 6 表情差分（480px 高 WebP，2.75MB）。 |
| `.dsh-plugin/client/gal-spring-backgrounds.mjs`、`spring-backgrounds/*.webp` | **新增（补契约）**。春篇 6 张场景图。 |
| `.dsh-plugin/shared/gal-story-catalog.mjs` | 注册第五剧目（v5 分发、角色表合并、`switchStoryChapter`/`storyChapterStates`/`storyAffinityPanel` 三个目录级能力）。 |
| `.dsh-plugin/client/character-identity.mjs` | `ds-myst` → deepseek 立绘别名。 |
| `.dsh-plugin/client/gal-module-page.jsx`、`gal-module.css` | 章节锁/完成装饰、好感度面板、命名输入框；其余_episodes_ 行为不变。 |
| `tools/slice-spring-portraits.ps1` | 立绘板切片脚本（可重跑）。 |
| `package.json` | 0.10.0。 |

## 已执行验证

| 验证 | 结果 |
| --- | --- |
| `npm test` | 72/72 通过（含正篇全周目、spring 全章编译、五剧目启动）。 |
| `npm run build:client` / `check:client` | 通过，52,209,051 字节与源码一致。 |
| `npm pack` | `dist/ljwei-stak-model-router-galgame-0.10.0.tgz`，38,808,998 字节，31 文件。 |
| 正篇全周目（自动化） | 333 步：共通线→雪国线→五线→隐藏线→TRUE END；七旗全达成；跨章存档往返 OK。 |
| SHA-256 | `80387371BB81AC08176CF4EC435751826A580A67FC2E843C8FD8B0485B227E53`。 |

## 还需进行的测试与完成方法

1. **桌面实装验证（用户侧）**：官方插件管理器安装 0.10.0 本地包，核对：剧目下拉出现「回声之城·正篇」、立绘差分随情绪切换、章节锁定图标、好感度面板、命名之夜输入、"雪地里的脚印"按条件解锁。
2. **真机内容审读**：正篇文本为忠实转译，建议按多 AI 协作协议让 Claude 过一遍台词润色、DeepSeek 审查引擎代码；春篇 act1/act3 为草稿桥，欢迎按原作风格重写（文件头已标明）。
3. **立绘补板**：chatgpt/claude/ernie/huggingface/minimax/github 等角色尚无表情板（`expressionFor` 自动回退基础立绘），后续按角色卡 prompt 补生成六表情板并重跑 `tools/slice-spring-portraits.ps1` 即可。
4. **场景图补充**：正篇场景当前按章节默认背景映射（15 张图覆盖 ~50 个场景 id）；可逐场景生成专属 CG 后在 `ECHO_BACKGROUNDS` 精化映射。
5. **发布闸门**：以上通过后按用户要求上传 npm（0.10.0）；GitHub 推送亦待用户确认后执行（本地提交已备）。

## 未完成开发与实施思路

| 事项 | 实施思路 |
| --- | --- |
| 立绘板缺失角色 | 按角色卡 prompt 模板补生成六表情板 → 放入 `output/spring/raw/` → 重跑切片脚本 → `SPRING_ORIGINALS`/`SPRING_PORTRAITS` 自动扩充。 |
| 正篇场景 CG | 按 CG 分镜设定书的 18 张名场面逐张生成，替换章节默认背景；映射表已就位，换图不改存档。 |
| act1/act3 草稿重写 | 保持章节 id（s01–s04 / s09–s12）与不设主线旗标的约定即可整体替换；引擎侧无耦合。 |
| BGM | 原 BGM 规格书 ≥8 首；官方插件暂无音频注入契约，作为后续独立增强。 |
| npm/GitHub 发布 | 完成桌面验证后执行；本地已提交并打包，发布动作为单命令。 |
