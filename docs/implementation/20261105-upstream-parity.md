# 上游 DS Bot 0.2.7 导入与特性对齐（2026-11-05）

本文件记录一次可复现的上游同步：把 `modules/bot-runtime/vendor/ds-bot` 从
`5c514ad70d5f3fd1c3b72b2e76e530bef50989d7`（ds-bot 0.2.6）推进到
`71d344bf193f3f18185f25de3d8e5c483046910a`（ds-bot 0.2.7），同时把产品自有的四处改动
变成显式、可复算的覆盖层，并用可执行证据固定「什么是上游的、什么不是」。

- 上游权威 checkout：`F:/everyAI/dsh-model-router-all/DS-Bot-upstream`
  （remote `https://github.com/Fei2411/DS-Bot.git`，HEAD `71d344b`，`git status` 干净）。
- 注意：`../DS-Bot`（0.26 应用分支，HEAD `ee7e28c`）与 `../DS-Bot/model-router` 不是 runtime
  上游；本次同步只读 `../DS-Bot-upstream`，未改动其中任何字节。

## 1. 同步前的真实状态（证据）

对比 vendor（0.2.6）与 `DS-Bot` 仓 `5c514ad` 的 `ds-bot/`（`git archive` 到
`tmp/integration/baseline-5c514ad`）后，产品自有改动只有 5 个文件：

| 文件 | 改动 |
| --- | --- |
| `src/client/desktop-pane.js` | 上游没有的文件：Grok Bot 式远程桌面页 |
| `src/client/details-drawer.js` | 增加「电脑操作」页签并渲染 `DesktopPane`（4 处：import、`TAB_LABELS`、`tabs`、渲染） |
| `src/client/sidebar.js` | 一行：渲染 `actions.sidebarAddon` |
| `src/client/index.js` | 一行：槽位探测接受 `entry.component?.dsBotTeamSidebar === TeamSidebar` |
| `client.js` | 构建产物：只含 sidebar/index 两处改动，**不含**桌面页签（见 §6 的既有不一致） |

也就是说：桌面页签在源码里，但 vendor 的 `client.js` 是旧的构建，冻结测试
`client.js is the build of src/client` 在同步前就是失败的。

## 2. 上游到底有什么（证据，不臆造）

来自 `DS-Bot-upstream/ds-bot/README.md`、`CHANGELOG.md` 与源码清单：

- **有「浏览器面板」**：`src/host/browser*.js`、`src/host/browser/*.js`、
  `src/client/browser-pane.js`、`src/client/read-page.js`、`src/client/bot-browsers.js`；
  README「Bot browser (dsh Desktop and the desktop app)」一节，含每 Bot 独立 partition、
  cookie 导入、`read_browser` 与浏览器插件（refs/script/task）。
- **有「头像库」**：`src/host/avatar-library.js`、`src/client/avatar-library.js`，
  README「your own photo from the reusable avatar library」，i18n `Library: '头像库'`。
  它是 Bot 头像照片库，与文档无关。
- **没有「远程电脑」**：在上游 `ds-bot/` 全树 grep `remote computer|remote desktop|remote
  machine|remoteComputer|remoteDesktop` 零命中；README 里的 desktop 只指 dsh Desktop 应用。
- **没有「文档知识库」**：`library` 只出现在头像库与 capability library；没有
  `documentLibrary`/`knowledgeBase` 一类实现。上游只有 `src/office/*`（docx/xlsx/pptx 读取与
  预览）和 Bot 记忆。

0.2.7 相对 0.2.6 的新增（上游 CHANGELOG + 源码）：分阶段群目标 `group_goal`
（`src/host/goals.js`、`src/client/goal.js`、`src/host/goal-skills.js`、
`src/host/skills/goal-grill/SKILL.md`）、记忆变更历史与按行恢复、新 Bot 默认模型、Enter
发送/换行偏好与催稿（`src/client/enter-key.js`、`enter-steer.js`、`src/host/steer.js`）、
消息时间（`messageClock`）、Models 引导步（`MODELS_STEP`）、失败回合可操作提示
（`src/client/turn-error.js`）、桌面应用启动窗鲸鱼交接（`useReportReady`）、侧边栏滑入滑出。
新增测试 13 个（`app-ready`、`composer-enter`、`enter-steer`、`failure-labels`、
`goal-client`、`group-goal`、`memory-history`、`message-times`、`models-step`、`new-chat`、
`side-chat-view`、`team-actions`、`turn-error`）。

## 3. 同步工作流（`scripts/sync-ds-bot.mjs` 重写）

```sh
node scripts/sync-ds-bot.mjs --source ../DS-Bot-upstream \
  --source-commit 71d344bf193f3f18185f25de3d8e5c483046910a --rebase-overlay
```

- **来源必须显式**：`--source` 指向仓库根（含 `ds-bot/`）或 runtime 目录本身；不再自动寻找
  `REPOSITORY/ds-bot` 或 `../ds-bot`，因此同级目录不可能意外顶替固定来源。没有 `--source`
  时只刷新/校验已有字节——打包后的仓库没有同级 checkout 也能 `build:client`/`check:client`。
- **固定提交**：`--source-commit` 与 `git -C <root> rev-parse HEAD` 不一致直接失败
  （`SOURCE_COMMIT_MISMATCH`）；非 git 目录必须显式给提交号（`SOURCE_COMMIT_REQUIRED`）；
  工作区不干净拒绝同步（`SOURCE_DIRTY`）。
- **无网络**：全程只有本地文件与 `git` 只读命令。
- **通告与摘要完整性**：复制 `<root>/LICENSE`→`UPSTREAM_LICENSE`、`<root>/NOTICE`→
  `UPSTREAM_NOTICE`；`SOURCE.json` 逐文件记录 `path/sourcePath/sha256/gitBlob/origin`，
  并记录 `commit`、`runtime.version` 与 `overlays`。
- **`origin`**：`upstream`（352）、`notice`（2）、`overlay`（6）、`generated`（1，`client.js`）。
- **`--check`**：不带 `--source` 时按字节比对 vendor 与 `SOURCE.json`；带 `--source` 时额外
  逐字节比对每个 `origin: 'upstream'` 文件与来源、校验 `commit`/`version`、确认 overlay 补丁
  仍能应用，并用上游固定的 esbuild 0.28.2 重建 `client.js` 比对。
- 内置一个小的 LCS diff + 统一 diff 应用器（约 120 行，无新依赖），按内容行比较，与
  CRLF/LF 无关，结果沿用被补文件的行尾。

## 4. 产品覆盖层（`modules/bot-runtime/product-overlay/`）

- `OVERLAY.json`：6 个条目。`kind: "product-file"`（`src/client/desktop-pane.js`，实体在
  `files/`）；`kind: "patched"`（details-drawer / sidebar / index，实体是
  `base/<path>` + `patches/<path>.patch`，`base.commit`/`base.sha256` 记录基准）。
- 同步时把补丁应用到**当前上游文件**，因此上游在同一文件里的新改动会保留，只改产品的行；
  基准漂移时补丁按偏移应用，`--rebase-overlay` 把基准换成新上游并重写补丁（本次已 rebase 到
  `71d344b`）；某段上下文再也匹配不上就报 `OVERLAY_CONFLICT` 并指出行号，不静默丢东西。
- **桌面页签的新钩子**（协调者要求）：`DesktopPane` 在
  `globalThis.__dshDesktop?.renderPane` 存在时直接渲染它（`h(pane, { bot, api })`），否则回退到
  原面板；所有 hook 仍无条件执行，只在副作用里待命，避免桥在渲染间出现/消失导致 hook 顺序变化。
  产品侧已实现 `installDesktopBridge(api, renderPane)`（`apps/integration-client/desktop-bridge.mjs`）
  与 `DesktopPane({ bot })`（`apps/integration-client/desktop-pane.jsx`），props 契约就是 `{ bot }`。
- `README.md` 说明条目形态、同步命令与「不得手改 vendor」的纪律。

## 5. 特性矩阵（`scripts/check-upstream-parity.mjs` + `tests/upstream-parity.test.mjs`）

矩阵 26 条上游特性，每条都必须由 vendor 里的文件 + 文件内的 marker 证明（缺一即失败）；
2 条「不是上游」的特性用**在上游 runtime 里 grep 不到实现标记**来证明，并列出产品侧实现路径；
4 条产品改动用 marker 证明仍在 vendor 里。当前输出 `passed`：

```
vendored runtime               ds-bot 0.2.7
pinned upstream commit         71d344bf193f3f18185f25de3d8e5c483046910a
vendored files                 361 (upstream 352, notice 2, generated 1, overlay 6)
absence proved against         upstream 71d344bf193f3f18185f25de3d8e5c483046910a
source verification            71d344b… 0.2.7, client bundle passed
```

`tests/upstream-parity.test.mjs` 另做：SOURCE.json 与 vendor 逐字节一致且无未登记文件、
overlay 补丁能从记录基准复算出 vendor 文件且补丁是自身基准的规范 diff、桌面页签的委托/回退
行为（esbuild 打包 + React stub + VM，断言 `delegated.type === renderPane`）、同步不猜来源、
来源提交不符或字节漂移被拒。

## 6. 精确验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `node scripts/sync-ds-bot.mjs --source ../DS-Bot-upstream --source-commit 71d344b… --rebase-overlay` | `{"status":"synced","files":361,"commit":"71d344b…","version":"0.2.7","overlays":[desktop-pane applied, details-drawer/sidebar/index rebased]}` |
| `node scripts/sync-ds-bot.mjs --check` | `{"status":"passed","files":361,…}` |
| `node scripts/sync-ds-bot.mjs --check --source ../DS-Bot-upstream --source-commit 71d344b…` | `{"status":"passed",…,"drifted":[],"rebuilt":{"client":"passed"}}` |
| `node scripts/integration-product-source.mjs` | `{"status":"passed","files":361,…}` |
| `node scripts/check-upstream-parity.mjs [--source …]` | `passed` |
| `node --test tests/upstream-parity.test.mjs` | 6 passed / 0 failed |
| `npm run build:client` | `[build-client] generated 2375019 bytes`（随后并发代理改了 `apps/integration-client/*`，重建为 2375619 字节） |
| `npm run check:client` | `[build-client] OK` |
| `node --test tests/bot-runtime-{product,ui,assembly,config,dispatch,switch}.test.mjs tests/product-client-build.test.mjs tests/plugin-split.test.mjs tests/client-loader.test.mjs tests/product-web-search.test.mjs tests/desktop-stream-viewer.test.mjs tests/product-actions-contract.test.mjs` | 73 passed / 0 failed |
| `node --test tests/bot-attention.test.mjs tests/bot-policy-scope.test.mjs tests/library-panel.integration.test.mjs tests/pairing.test.mjs tests/product-channel-dispatch.test.mjs tests/product-refresh-order.test.mjs tests/cordis-inject.test.mjs` | 31 passed / 0 failed |
| vendor 冻结测试（0.2.6 基线） | 1320 tests / 1309 pass / 10 fail |
| vendor 冻结测试（0.2.7 同步后） | **1626 tests / 1625 pass / 0 fail / 1 skipped** |
| `npm test`（提交的 `scripts/test-plan.json`，30 个 stage） | stage 2 有 1 个失败（见 §7.2），stage 3–30 全部 exit 0（含 stage 30 的 `tests/upstream-parity.test.mjs`） |

vendor 冻结测试跑法（本机没有 `deepseek-harness` checkout，也没有装
`tests/fixtures/integration-host` 的依赖，因此 `scripts/integration-product-upstream-tests.mjs`
的 rc.3 锚点不可用；改用本机已有的 rc.4 harness 树作只读锚点，日志在
`tmp/integration/upstream-parity/vendor-0.2.7-full.log`）：

```sh
cd modules/bot-runtime/vendor/ds-bot
DSH_HARNESS=<harness 树> NODE_PATH=<本仓 node_modules> \
  node --import ./test/harness-resolve.mjs --test --test-timeout=120000 --test-reporter=spec "test/*.test.js"
```

0.2.6 → 0.2.7 的失败变化：`client.js is the build of src/client` **转绿**（同步按打过补丁的
源码重建了 vendor 的 `client.js`），3 个由我上一次运行注入 `HOME`/`USERPROFILE` 造成的失败消失；
新增的 13 个上游测试文件随源码一起进入并全部通过（中途 `test/office.test.js` 曾因本机缺 vendor 的
devDependency `@xmldom/xmldom` 而整文件失败，并发代理把它加进根 devDependencies 并安装后
66 个用例全部通过）。最终 **0 fail / 1 skipped**（该 skip 与 0.2.6 基线一致，是上游自带的跳过）。

## 7. 未接受/待办（不因文件已复制而声称通过）

1. **发布清单**：根 `package.json` 的 `files` 数组本来就没覆盖全部 vendor 源码（同步前已有
   **26** 个 `vendor/ds-bot/src/**` 文件不在其中）；本次同步又新增 7 项：
   `src/client/{enter-key,enter-steer,goal,turn-error}.js`、`src/host/{goals,goal-skills}.js`、
   `src/host/skills/`。`package.json` 不在本次授权范围，发布前必须补齐，否则 npm 包缺文件
   （冻结测试与 `check:client` 都不校验这一点）。
2. **治理基线**：`docs/integration/baseline.json` 的 DS 提交仍是 `de55888a…`，而 live
   `SOURCE.json` 自 `bdbe112` 起就是 `5c514ad…`，因此
   `tests/integration-upstream-include.test.mjs` 的 4 个 DS include 用例**在同步前就已失败**
   （已用旧 SOURCE.json 复现同一失败加以确认），需要治理侧另行推进，不在本次范围。
3. **桥的覆盖顺序（需协调者确认）**：`apps/integration-client/panels.jsx` 的 Machines 页会把
   `globalThis.__dshDesktop` 覆写成一个**没有 `renderPane`** 的对象；用户打开过「电脑」页后，
   抽屉的桌面页签会回退到旧面板。建议 Machines 页保留既有桥的 `renderPane`（或让
   `installDesktopBridge` 的桥后装并胜出）。
4. **`AGENTS.md` 与根 `README`** 仍写着「从 `../ds-bot/` 同步」，已过时；两者都不在本次授权
   范围，建议随后续改动一起更新。
5. **`.dsh-plugin/client.js` 需要再重建一次**：并发代理在我构建之后又改了
   `apps/integration-client/{index.jsx,panels.jsx,product.css}`，我按当前源码重新
   `npm run build:client`（2375619 字节，`check:client` 通过）；该文件是生成物，任何时候都可以
   再重建。

## 7a. 测试计划与并发改动

`npm test` 现在跑 `scripts/run-tests.mjs` + `scripts/test-plan.json`（另一代理新增，30 个
stage；`tests/upstream-parity.test.mjs` 已在 stage 30 里）。本次实测：

- stage 2（137 个文件，1841 tests）**1 个失败**：`tests/desktop-compat.test.mjs`
  「the release accepts the audited Desktop release candidates without exemptions」——
  根 `package.json` 的 `peerDependencies` 被并发代理加上了
  `0.2.2-rc.1 || 0.2.2-rc.2 || 0.2.2-rc.3`，而测试里的 `SUPPORTED_DESKTOP_PEERS` 还是旧值。
  与本次同步无关（我没有改 `package.json`）。
- stage 3–30 全部 exit 0。

vendor 冻结测试的锚点说明：本机没有 `deepseek-harness` checkout，
`tests/fixtures/integration-host` 的依赖也未安装，因此 AGENTS.md 里的
`node scripts/integration-product-upstream-tests.mjs`（固定 rc.3 宿主）跑不了；上面的数字来自
用本机已有的 harness 树（0.2.1-rc.4）作只读锚点 + `NODE_PATH` 指向本仓 `node_modules`
（并发代理已把 `@xmldom/xmldom` 加进根 devDependencies 并安装，office 测试因此全部通过）。
日志：`tmp/integration/upstream-parity/vendor-0.2.6-baseline.log`、
`vendor-0.2.7-final.log`。

## 8. 变更文件

- 重写 `scripts/sync-ds-bot.mjs`（显式来源、固定提交、overlay 引擎、client.js 重建、双模式校验）。
- 新增 `scripts/check-upstream-parity.mjs`（特性矩阵 + 覆盖层报告）。
- 新增 `tests/upstream-parity.test.mjs`（6 个用例）。
- 新增 `modules/bot-runtime/product-overlay/`：`OVERLAY.json`、`README.md`、
  `files/src/client/desktop-pane.js`、`base/src/client/{details-drawer,sidebar,index}.js`、
  `patches/src/client/{details-drawer,sidebar,index}.js.patch`。
- 重新生成 `modules/bot-runtime/SOURCE.json`（commit `71d344b`，0.2.7，361 个文件）。
- 经同步脚本更新 `modules/bot-runtime/vendor/ds-bot/**`（0.2.7 + 覆盖层 + 重建 client.js）。
- 更新 `modules/bot-runtime/README.md`（来源、origin、同步命令、0.2.7 特性、「不属于上游」边界）。
- 重新生成 `.dsh-plugin/client.js`（`npm run build:client`，生成物，未手改）。
- 本文件。


2026-11-05 最终整合补充：为实际 Harness 0.2.2-rc.1 的 section-only system-prompt assembly 增加 `src/host/tools.js` 单行兼容补丁（`assembled.tools ?? []`）；原独立隐藏工具 guard 继续生效。故最终按字节分类为353上游、5覆盖、2许可、1生成，总361文件。最初354/4是该兼容补丁之前的证据。

最终兼容补充：`src/host/schedules.js` 引用产品自有 `modules/bot-runtime/schedule-compat.mjs`，把0.2.1的逐Session Schedule接口适配到0.2.2的Host-wide API，保留精确Session target并以expectedUpdatedAt核验删除；实际SDK0.2.2-rc.1的调度/Session轮转/冷启动完整50项验收通过。最终分类352上游、6覆盖、2许可、1生成，总361文件。
