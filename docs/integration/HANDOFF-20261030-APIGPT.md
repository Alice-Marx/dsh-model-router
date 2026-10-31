# API GPT 工程交接报告（2026-10-30，停于 E64）

> **交接结论：E64 bound stop-proof 组件检查点已完成并发送阶段通知；完整工程、产品验收和发行均未完成。本次按用户要求停在 E64，仅交接，不开始任何下一独立范围。**
>
> 本文是 API GPT 根据实际文件、日志、metadata、台账和归档编制的当前交接。历史报告、计划或通知中“继续下一范围”“待继续施工”等措辞不构成本次授权；上一 API GPT 尝试启动下一独立范围后已被用户停止。本次没有启动施工包、修复、其他代理、真实推理或发布。

## 1. 交接位置、权威顺序与工作树保护

| 项目 | 核对结果 |
|---|---|
| 工程根目录 | `F:\everyAI\dsh-model-router-all\dsh-model-router` |
| 当前分支 | `feat/bot-integration` |
| 当前 HEAD | `89e831264ebc7dacacdd54234377e51f37fb0785` |
| HEAD 提交时间、标题 | `2026-10-27T11:50:17+08:00`；`feat(integration): migrate MR money authority to transactional SQLite` |
| 本地远程跟踪引用 | 初始只读输出显示 `origin/feat/bot-integration` 指向同一 HEAD；未 fetch，不代表实时远端核验 |
| 版本背景 | 现有日志包名为 `@ljwei-stak/dsh-model-router@0.25.5`；本次不查询 registry、不比较发行、不改版本 |
| 工程状态 | 大量修改、未跟踪目录以及被忽略的冻结 vendor 构成工程主体，**不是干净工作树** |
| 本次交接允许写入 | 本报告、[交接索引](HANDOFF.md)的当前权威指针，以及归档新建 `closure-02` 内本报告的单独副本 |

**绝不能只交 HEAD 或 `git diff` 作为完整源码。** 当前 `apps/`、`modules/`、`remote-computer-agent/`、`native/`、`deploy/`、多个 `packages/`、测试与证据均含未跟踪主体。既有 `package.json`、CI、锁文件和客户端的 dirty 状态也早于本次交接；不能把它们误认作本次文档变更，更不能清理、回退或覆盖。

用户本次明令禁止 reset、clean、stash、checkout、stage、commit、push、publish；本次均未执行。不得更改源码、测试、package/CI、台账完成状态或真实用户数据。历史“工程完成后可发布”的授权不能越过当前停止指令。

建议阅读顺序：本文 → [E64 证据](evidence/20261030_bound_stop_proof.json) → [当前台账](tasks.json)及[状态输出](STATUS.txt) → [进度](PROGRESS.md)/[执行记录](EXECUTION-20261027.md) → [主方案 1.1](plan/20261026_master_plan.md)。[CODEX 旧交接](HANDOFF-20261030-CODEX.md)用于更早架构和环境背景，其 E58–E60 数字、CLI Job 待办和旧停工/恢复描述不得覆盖 E61–E64 及本次停工。

本文所有 Markdown 文件链接均采用项目内相对路径；跨盘归档与远程工作目录只用代码文本列示，不创建失效的跨盘链接。文中的测试时间均为 **2026-10-30 UTC**，除非另有明确时区。

## 2. E64 范围、实际九文件改动与派生产物

E64 修复的是“停止证据来源绑定与重试门控”，不是新增完整命令产品或 OS 隔离。其组件级接受结论为 `componentAcceptance: verified within the stated scope`，产品级仍为 `productAcceptance: partial`。

变更边界直接来自[原九文件清单](../../tmp/integration/step-e64-followup/before-manifest.json)、[最终九文件清单](../../tmp/integration/step-e64-followup/final-manifest.json)、[前后差异](../../tmp/integration/step-e64-followup/review.diff)和 E64 的 `nineFileFinalSnapshot`。本次只读核对确认：前后各 9 个文件、九个摘要均有变化、最终清单与 E64 内嵌清单完全一致；没有为编制报告重新全面阅读源代码。

| 授权源码/测试路径 | E64 实际用途 | 最终字节数 | 最终 Git blob |
|---|---|---:|---|
| [task-journal.mjs](../../packages/orchestration/src/task-journal.mjs) | 持久 `task_dispatch_fences`；拒绝裸标记、错绑/旧证明；未证明停止的终态与旧重试保守门控；Task/plan 投影清除不可信确认 | 46000 | `d1f81b73c035b271fbd5286469e978a2d8bb6ac9` |
| [cli-execution.mjs](../../packages/orchestration/src/cli-execution.mjs) | 将 native-tree 停止证明绑定原资金收据、Task 身份及执行引用；冷 collect/reconcile 核验；factory 前拒绝/预算拒绝生成明确未派发证明 | 18501 | `6b25498f6b0cdcebd85f7164896a412d4c6596bd` |
| [remote-execution.mjs](../../packages/orchestration/src/remote-execution.mjs) | 验证 Agent 独立写入停止收据、原 operation/身份/摘要，成功还校验输出内容；不再把原始 result 布尔值升级为 Host provenance | 8575 | `e8b6345feaae6b4d334dcc82ef46ac8a43a77987` |
| [task-service.mjs](../../packages/orchestration/src/task-service.mjs) | backend 回调进入前调用持久 beginDispatch；未进入则 closeDispatch，阻止结算后迟到回调再启动 | 18829 | `5d871c99d56445cff3c323e967b7cceafa96ed6c` |
| [task-retry-stop-evidence.native.mjs](../../tests/task-retry-stop-evidence.native.mjs) | 裸 flag、旧终态、缺引用、旧已排队 retry、错 task/attempt/operation/target/reference/source/hash 等负例，以及持久未派发正例 | 19159 | `7352998d606fbeef2f2439ee405075e12d43ef93` |
| [agent.ts](../../remote-computer-agent/src/agent.ts) | 跟踪中的进程内 `fs_write` 与清理结束后独立落盘 `agent_stop_receipts`；status/cancel/幂等返回只附匹配原收据的证明 | 25751 | `bbde74e4c38fe922508615ac4fb1ae8a2524189c` |
| [operation-cancel-evidence.native.mjs](../../tests/operation-cancel-evidence.native.mjs) | 验证裸写标记、复制/过期/错绑独立收据不可制造可信停止；已结束失败写入可确认停止但仍可能有副作用 | 8139 | `feb5eacee69bcf3e07bd0a63258ea540935e4d31` |
| [panels.jsx](../../apps/integration-client/panels.jsx) | 重试以 Host 投影 `stopConfirmed === true` 为依据，移除裸 `notStarted` 的 UI 放行捷径；保留停止不等于回滚提示 | 24900 | `44c21489e147124b6758476f15fc0b2d13a560b2` |
| [bot-runtime-ui.test.mjs](../../tests/bot-runtime-ui.test.mjs) | “原操作未启动可重试”fixture 同时要求 Host 确认；与既有未确认禁重试、可能已应用提示共同回归 | 18934 | `0d1332b02f363d78750a7264600032eeffe8b7c6` |

### 2.1 客户端与其余身份集合不可混淆

- 另有**派生构建产物** [`.dsh-plugin/client.js`](../../.dsh-plugin/client.js)，不计入上述 9 个源码/测试文件；E64 已执行 `build:client` 和 `check:client`。最终 **2063296 bytes**，Git blob `25be97d710a4be8eaea9fa23f7b34547df015697`，SHA-256 `85d059f675319a3c751de7115c82ff9d02a6d20c3a00e7cccb85e2d9c874b703`。
- [旧生成客户端备份](../../tmp/integration/step-e64-followup/before-generated-client.js)保留 **2063017 bytes**，SHA-256 `2ed243be280e177c375807f01407bd91e077bb8802420d58470824519ac4c74a`。不得把旧 bundle 当 E64 最终 bundle。
- 远程修正包 c 包含 **52 个逐文件校验源**，见[清单](../../tmp/integration/step-e64-followup/e64-bound-20261030c-manifest.json)和[压缩包](../../tmp/integration/step-e64-followup/e64-bound-20261030c.tar.gz)；包 SHA-256 为 `45034569f60391675f329cfbda49d4ccb2edf35723ccdff9f5fde1af89a543c3`。52 是此次专项输入集合，不是全仓源码总数。
- E64 `sourceGitBlobs` 共 **53 项**，其中包含最终生成客户端；`sourceSha256` 为 **52 项**。本次逐项只读重算后，53 个 Git blob、52 个 SHA-256 均匹配，没有把缺少客户端的 52 项清单说成 53 项 SHA 清单。
- [Agent dist 入口](../../remote-computer-agent/dist/index.mjs)等依赖文件虽被纳入身份核对，不表示它们是 E64 新修改文件；是否属于改动必须看九文件前后快照。
- E64 没有改 package/CI 注册入口；工作树中 package/CI 的已有修改属于更早工程。**stop-proof 专项尚未注册根测试入口**，不能由一次手动专项通过推断已有持久自动回归。

## 3. 下一负责人必须保持的安全不变量

### 3.1 Host journal / Task Service

1. `notStarted`、`notDispatched`、`summary.notStarted`、裸 `stopConfirmed: true` 或只有 `stopEvidence` 标签，都不是已启动操作的来源证明；字符串/数值真值更不能被信任。
2. 对已启动 `codex-read` 与 `remote-write`，证明须匹配原 `taskId`、`attemptId`、`operationId`、`targetHash`、执行引用摘要、schema/source 和证据摘要；错绑、旧引用、空证明保持 unknown/needs-reconciliation。
3. 真正未派发须由 Host 自己的持久状态证明：未送出的队列，或关闭且不可再进入的 dispatch fence，或已封存的未提交资金准入；不能由 backend result 自报。迟到 callback 必须被拒绝。
4. 成功、失败、取消乃至 waiting-budget 不能用作掩盖缺停止证明的旁路。旧终态、冷恢复及父证明缺失的旧已排队 retry 仍受 fence 限制。
5. Task 与 plan 投影必须去除无来源的停止确认；锁、原 attempt/operation 和待核对状态不能因为 UI 显示终态就被解除或自动重发。

### 3.2 CLI 与原资金收据

1. native-tree 停止证明与原始金融收据、run、requestHash、Task 标记和执行引用绑定；cold collect/reconcile 重新检查原来源身份与摘要。
2. sessionFactory 前的准入拒绝、预算拒绝只能产生其真实覆盖范围内的 `cli-no-dispatch` 证明；不能冒充“CLI 已运行且停止”。
3. 未确认进程树、模型身份不符或未知账单仍 fail-closed，保留原 hold；不能制造零费用或重复账单。E64 本身不证明真实模型/收费成功。

### 3.3 Agent 与远程写入

1. `fs_write` 的停止证明来自**独立持久收据**，且只在跟踪中的写入和 cleanup 已结束后生成；原始 result 布尔值、无活动进程或一个伪造成功终态不能补造来源。
2. 证明匹配 machine、task、attempt、operation、tool、status 和原收据摘要；Host 再核对原 operation、绑定及引用。成功写入还核对预期输出 SHA-256 和字节数。
3. 重复请求返回原 operation；冷恢复是观察与核对原操作，不是再执行。历史成功写入若没有独立持久证明，升级后仍可能保持未知，不能回填“通过”。
4. **停止不等于回滚。** 已结束的失败写入可以证明“已经停止”，但 `possiblyApplied` 仍保守为 `true`；已落盘内容不会因取消自动撤销。
5. 该机制不对抗已失陷 Agent 或恶意数据库写者，不提供签名信任、跨版本协调、外部写者 CAS 或 OS 文件系统隔离。其他外部工具原收据组件不能直接等同于完整命令/浏览器/桌面 Task facade。

### 3.4 UI

UI 仅消费 Host 投影，不是授权和停止事实来源。裸 `notStarted` 不再放行远程重试；unknown 只允许核对原操作，已确认停止且可能产生副作用时必须提示“文件可能已改变，重试不撤销已有变更”。E63 的最新快照保护、失联禁用和不自动重发也继续保留。React/JSDOM 通过不等于真实桌面或完整产品交互验收。

以上均可追溯至 [E64 observed/limitations](evidence/20261030_bound_stop_proof.json)、[review.diff](../../tmp/integration/step-e64-followup/review.diff)和[行为审计 E64](behavior-audit.json)，而非本次新增设计。

## 4. 已有测试证据：平台、命令与真实结果

**本次交接不重跑测试。** 以下均是 E64 已有运行结果；本次核对其文件、metadata、退出码和摘要。既有记录中的 UTC 时间与三平台 Node 版本分别保留。

### 4.1 六套完整专项：每个平台合计 59/59，不是每个测试文件各 59

| 套件 | 每平台最终用例数 | 覆盖重点 |
|---|---:|---|
| [task-retry-stop-evidence.native.mjs](../../tests/task-retry-stop-evidence.native.mjs) | 11 | journal provenance、旧重试/冷恢复、绑定负例与迟到 callback |
| [cli-execution.native.mjs](../../tests/cli-execution.native.mjs) | 10 | 原 Task/资金收据、取消回收、预算/绑定、冷核对和禁止重放 |
| [operation-cancel-evidence.native.mjs](../../tests/operation-cancel-evidence.native.mjs) | 6 | 原操作取消、独立写停止证明、伪造/过期证明拒绝 |
| [remote-write-tasks.native.mjs](../../tests/remote-write-tasks.native.mjs) | 14 | scoped Agent 写 Task、去重、未知锁与原操作 status/reconcile |
| [bot-runtime-ui.test.mjs](../../tests/bot-runtime-ui.test.mjs) | 11 | 停止/副作用提示、重试门控、身份和机器/资金 UI |
| [product-refresh-order.test.mjs](../../tests/product-refresh-order.test.mjs) | 7 | 快照顺序、卸载/API 更替、失联和动作回复丢失保护 |
| 合计 | **59** | 各平台均 pass 59 / fail 0 / skip 0 |

| 平台 | Node / 系统记录 | UTC 运行窗口 | 最终结果、依据 |
|---|---|---|---|
| 本机 Win11 | `v24.20.0`；`Windows-11-10.0.26200-SP0` | `08:54:01.330266`–`08:54:11.225058` | **59/59，0 fail，0 skip，exit 0**；[日志](../../tmp/integration/step-e64-followup/output/local-six-03.log)、[metadata](../../tmp/integration/step-e64-followup/output/local-six-03.json) |
| Ubuntu 远程 | `v22.22.1`；linux `6.8.0-101-generic` | `08:35:38.136`–`08:35:47.741` | **59/59，0 fail，0 skip，exit 0**；[原始日志](../../tmp/integration/step-e64-followup/output/linux-e64-bound-20261030c-tests-raw.log)、[metadata](../../tmp/integration/step-e64-followup/output/linux-e64-bound-20261030c-result.json) |
| Win10 远程 | `v24.18.0`；win32 `10.0.19044` | `08:35:35.787`–`08:35:43.764` | **59/59，0 fail，0 skip，exit 0**；[原始日志](../../tmp/integration/step-e64-followup/output/win10-e64-bound-20261030c-tests-raw.log)、[metadata](../../tmp/integration/step-e64-followup/output/win10-e64-bound-20261030c-result.json) |

原始日志 SHA-256：

| 平台 | SHA-256 |
|---|---|
| Win11 | `3dcba71e458f26304cb864e4db1079fcabf7851d49746f4f95cca7a60e9d2207` |
| Ubuntu | `1968b02b374f6fa080385eca0176085b8f967ff5184d3c936a29165ed303f3b4` |
| Win10 | `0c73677cdcdf7cf4ab61b7deb85fe0cf90295de2ba2460331b1b560e001286cb` |

两台远程先验证既有 E62/E63 隔离 fixture 的依赖，最终在 E63 `refresh-ui-20261030a` 运行；没有用 prepare 覆盖旧 fixture。目录为：

- Ubuntu：`/opt/dsh-bot-integration-tests/20261027-product-machines-01/refresh-ui-20261030a`。
- Win10：`D:\DSH-Bot-Integration-Tests\20261027-product-machines-01\refresh-ui-20261030a`。
- 两远程执行前分别逐项确认 **52 源文件**，见[Linux 包装记录](../../tmp/integration/step-e64-followup/output/remote-linux-bound-02.log)及[Win10 包装记录](../../tmp/integration/step-e64-followup/output/remote-win10-bound-02.log)首行。原始下载日志摘要与各自 result metadata 一致，成功退出码来自原始运行记录，不是从包装器打印猜测。

上述是复用已验证依赖的专项验证，**不是干净安装，不是本轮远程整仓 regression**；E60 更早“962 源/根 1743 全绿”等数值只是旧快照，不能移植为 E64 全仓结论。

### 4.2 Win11 根回归、正确探针、客户端与管理检查

| 已执行入口 | 已有最终结果 | 日志/metadata 与解释 |
|---|---|---|
| `npm.cmd test` | **1763 tests，1740 pass，1 fail，22 skip；exit 1** | [根日志](../../tmp/integration/step-e64-followup/output/root-regression-01.log)、[metadata](../../tmp/integration/step-e64-followup/output/root-regression-01.json)；UTC `08:51:48.864670`–`08:53:13.719616` |
| `npm.cmd run integration:probe-tasks` | **29/29，fail 0，exit 0** | [日志](../../tmp/integration/step-e64-followup/output/journal-probe-02.log)、[metadata](../../tmp/integration/step-e64-followup/output/journal-probe-02.json)；verified native driver **13.0.3**，Node `v24.20.0` |
| `npm.cmd run build:client` | **exit 0，生成 2063296 bytes** | [日志](../../tmp/integration/step-e64-followup/output/client-build-01.log)、[metadata](../../tmp/integration/step-e64-followup/output/client-build-01.json) |
| `npm.cmd run check:client` | **exit 0，`[build-client] OK`** | [日志](../../tmp/integration/step-e64-followup/output/client-check-01.log)、[metadata](../../tmp/integration/step-e64-followup/output/client-check-01.json) |
| 文档/清单/进度/client-build 四文件检查 | **26/26，fail 0，skip 0，exit 0** | [docs-final 日志](../../tmp/integration/step-e64-followup/output/docs-final-01.log)、[metadata](../../tmp/integration/step-e64-followup/output/docs-final-01.json)；UTC `09:08:33.146810`–`09:08:34.093374` |
| `npm.cmd run integration:probe-product-source` | **passed，冻结 297 文件，exit 0** | [日志](../../tmp/integration/step-e64-followup/output/frozen-source-01.log)、[metadata](../../tmp/integration/step-e64-followup/output/frozen-source-01.json)；冻结提交 `de55888a93983fc51c94f7d22bc94b4f8293205d` |
| `npm.cmd run integration:check` | **exit 0；32R/40F/63T/20W 台账有效** | [初次日志](../../tmp/integration/step-e64-followup/output/integration-check-01.log)及[closure 检查 metadata](../../tmp/integration/step-e64-followup/output/integration-check-closure-01.json)；后者 UTC `09:44:09.131319`–`09:44:09.902229` |

文档四文件入口是 `node --test tests/integration-progress.test.mjs tests/integration-documents.test.mjs tests/integration-inventory.test.mjs tests/product-client-build.test.mjs`。26/26 是 E64 完成当时已有证据，**不冒称本次新报告也重跑了这套测试**；本次新文档只做相对链接、数据/身份和只读台账检查。

### 4.3 唯一根失败必须保留，不能“修测试”以交接

- 文件：[tests/workspace-agent.native.mjs](../../tests/workspace-agent.native.mjs)，测试起点 `26:1`，失败断言 `29:130`。
- 用例：`workspace Agent: cancellation before publication waits for the write and releases with a truthful no-effects receipt`。
- 失败为 `AssertionError [ERR_ASSERTION]`，`actual: true` / `expected: false`；即实现保守返回 `possiblyApplied: true`，测试要求 false。
- E64 报告/证据将其记录为**既存且单独未解决的失败**，九文件差异中没有改该测试；本次也不改。当前该文件 SHA-256 为 `0c939406a9513ca741a7f104d8dfe0fff5088eee338b73d7c22b9a57d715909b`，列入交接前后保护校验。
- 不将“独立证明已经停止”混同“能证明没有写入副作用”，也不把 `possiblyApplied` 直接改 false 或弱化断言。可信发布前无效果证明及其根因修复须另行授权、另定边界、另留证据。

## 5. 失败、重试、操作错误与最终纠正

失败原件全部保留；“最终通过”只指其后确有日志和 metadata 支持的运行，不覆盖历史。

| 记录 | 实际失败/问题 | 已有纠正结果与边界 |
|---|---|---|
| [red-raw-provenance.log](../../tmp/integration/step-e64-followup/output/red-raw-provenance.log)及[metadata](../../tmp/integration/step-e64-followup/output/red-raw-provenance.json) | 首轮负向复现 **10 tests / 8 pass / 2 fail / 0 skip，exit 1**；裸来源让 journal 返回 failed 而非 needs-reconciliation，remote 返回 failed 而非 unknown | 后续九文件实作及最终 stop-proof 专项通过；这是修复前真失败，不是最终运行的跳过项 |
| [local-five-01.log](../../tmp/integration/step-e64-followup/output/local-five-01.log) | 实作中间态 **52 tests / 46 pass / 6 fail**；一项 CLI 等待 cancelled 未到达，五项 journal fixture 报 `INVALID_TASK_REFERENCE` | [local-five-02](../../tmp/integration/step-e64-followup/output/local-five-02.log)为 **52/52，0 fail/skip，exit 0**；扩至六套后最终 59/59。不从一次重跑通过推定所有独立超时根因已解释 |
| [validate-win10-01.log](../../tmp/integration/step-e64-followup/output/validate-win10-01.log) | PowerShell 引号损坏导致 `require(fs)`，报 `Cannot access 'fs' before initialization`，exit 1 | [validate-win10-02](../../tmp/integration/step-e64-followup/output/validate-win10-02.log) exit 0，确认两个既有 fixture 的依赖；cancel 目录无 UI fixture，refresh-ui 目录有 UI fixture。不是产品测试失败，也不是首次验证成功 |
| [remote-linux-bound-01.log](../../tmp/integration/step-e64-followup/output/remote-linux-bound-01.log) | 旧 bundle b 漏带动态引用 `panels.jsx`，**59 / 57 pass / 2 UI fail**，exit 1 | 修正包 c 纳入面板并逐源核对，最终 Linux 原始日志/metadata 59/59、exit 0；b 的压缩包、清单和失败日志保留 |
| [remote-win10-bound-01.log](../../tmp/integration/step-e64-followup/output/remote-win10-bound-01.log) | 旧转发器 UTF-8 解码失败后又触发 GBK 打印 `UnicodeEncodeError`；包装器 exit 1；下载的旧测试日志同样记录 57 pass / 2 UI fail | 保留[旧下载日志](../../tmp/integration/step-e64-followup/output/download-win10-bound-01.log)原字节及 E64 解释；**该包装器失败不是独立远程测试 exit 元数据**。最终包 c 用原始日志文件和 result JSON 独立记录，59/59、exit 0 |
| `Get-FileHash` 不可用 | E64 `executionNotes` 明记 Linux 包上传已发生，但本地该 cmdlet 不可用；不能把它记录为哈希验证成功 | 后续 Python 核对压缩包摘要及本地逐源身份，Windows 上传及两机执行使用校验后的包；最终包摘要见 §2.1 |
| [journal-regression-01.log](../../tmp/integration/step-e64-followup/output/journal-regression-01.log)及[metadata](../../tmp/integration/step-e64-followup/output/journal-regression-01.json) | 错误直接 `node --test ... tests/task-journal.native.mjs ...`，该文件要求 verified-driver probe；exit 1，其余 43 项通过 | 改用既有正确 `integration:probe-tasks`，29/29、exit 0。不得将错误入口整体改记通过 |
| Provider relay 读/patch 中断 | 旧会话存在传输中断；已有说明与读回确认首次中断 patch 未应用 | 之后小范围重试才实施；中断不是有效 patch、测试结果或新增证据；不重复已经完成的远程测试/通知 |
| 本机根 `npm test` | 1763/1740/1/22，exit 1 | **仍未纠正**，唯一 workspace-agent 断言移交下一负责人；不把组件通过说成根全绿 |

本次文档核对过程中还遇到工具层 ripgrep 返回 `Invalid ripgrep match output`，以及 Windows 内联 Python 中 Unicode 正则经管道替换后报 `re.PatternError`。未产生写入、未运行工程测试；改用 ASCII 过滤读取既有日志后完成核对。旧 Win10 下载日志被通用读取工具判为二进制时保留原件，不转换或覆盖；最终运行依据独立 raw log/result metadata，旧失败依据 E64 保留说明。

更早 E53 首次 MR 咨询超时仍是未解释的稳定性线索；旧 CLI 已分派但 usage/请求数未知的事实也不能被本次 `actualModelCalls=0` 冲销。

## 6. E64 证据与台账登记已做到哪里

### 6.1 文件索引

| 文件 | 用途及权威边界 |
|---|---|
| [20261030_bound_stop_proof.json](evidence/20261030_bound_stop_proof.json) | E64 主证据：父 HEAD、0 模型调用、53 Git blobs、52 SHA、九文件快照、包、平台命令/时间/退出/日志摘要、失败与限制 |
| [report.md](../../tmp/integration/step-e64-followup/report.md) | E64 组件检查点和管理归档结果摘要；其中“下一独立范围”是历史建议，不是本次任务 |
| [notes.md](../../tmp/integration/step-e64-followup/notes.md) | 前态漏洞与最终组件结论；开头裸标记漏洞描述是修复前状态，不能误认最终源码仍允许 |
| [task_plan.md](../../tmp/integration/step-e64-followup/task_plan.md) | E64 五阶段已勾选；“继续下一独立范围”未勾选。本次不修改历史任务计划 |
| [final-manifest.json](../../tmp/integration/step-e64-followup/final-manifest.json) / [review.diff](../../tmp/integration/step-e64-followup/review.diff) | 最终九文件身份、字节数及相对本轮 baseline 的实际差异；before/final 目录在同一隔离证据树 |
| [archive-independent-readback.json](../../tmp/integration/step-e64-followup/archive-independent-readback.json) | 原 145 文件独立读回及原清单摘要 |
| [closure-readback.json](../../tmp/integration/step-e64-followup/closure-readback.json) | 原 145 仍一致、closure-01 共 11 项、通知 exit 0 和 closure 清单摘要 |

E64 主证据当前 SHA-256：`e68126f9e939077c384d5addf7e080cb13e8b5bef4862f727bd614d304497aaf`。本次没有改它或任何测试证据；`output/` 中逐项 `.json` 是精确命令/UTC 时间/退出码/日志摘要，`.log` 是已有输出，不能只看摘要性 report 就替代这些原件。

### 6.2 已有台账更新，不在本次再次修改

- [tasks.json](tasks.json)：E64 已挂入 W08、W09、W11 的包级证据；子步骤 **W08.2、W08.5、W09.1、W09.6、W11.2** 有 E64 引用。W08.5、W11.2 仍 `in_progress`。
- 场景 **T11、T12、T13、T33、T53** 增补 E64 证据/说明，仍为 `partial`；没有以组件专项提升场景或整包为 passed/completed。
- [behavior-audit.json](behavior-audit.json)：新增 **E64**，涉及 **F33、F40**，记录来源绑定和显式重试 fence、九文件及派生客户端身份、observed/remaining。总计 **64 条 partial entry observations 覆盖 40 功能组**，不是 64 个产品 passed。
- [PROGRESS.md](PROGRESS.md)、[EXECUTION-20261027.md](EXECUTION-20261027.md)：顶部 E64 摘要保留三平台59/59、根一失败、边界/后续建议和未发布事实。
- [STATUS.txt](STATUS.txt)：当前仍显示 0/20、1/63、M0 11/12；本次只运行只读 `integration:status`，**不运行写 STATUS 的 report 命令**。

## 7. 真实整体完成度：2026-10-30 台账快照

本次于 `2026-10-30T10:10:01.104953+00:00` 直接解析台账核对；随后只读 `npm.cmd run integration:status` 输出一致，exit 0。台账 `updatedOn` 为 `2026-10-30`，active milestone **M0**。

| 维度 | 实际记录 | 不能外推成什么 |
|---|---|---|
| 整包 | **0/20 completed；13 in_progress，7 planned** | 不能用组件 completed 推定整包或发行就绪 |
| 产品验收场景 | **1/63 passed；52 partial，10 not_run** | 唯一 passed 为 **T63 / level=document**，不是 1 个真实产品工作流通过 |
| 已记录 M0 子步骤 | **11/12 completed** | W02.7 实际拓扑/休眠仍 in_progress；不是 M0 门禁已完成 |
| 全部已记录子步骤 | **46 completed、9 in_progress、1 planned，共56** | 不是工时百分比，不代表主方案缺少 steps 的包已完成 |
| M0 四门禁 | **G1/G2/G3/G4 全部 in_progress** | 无门禁被 E64 提升 |
| E64 actualModelCalls | **0** | 不是项目历史零费用，也不抹去旧未知 usage/超时 |
| Git/发行 | 本次及 E64 无 stage/commit/push/publish；当前 HEAD 不变 | 没有本次新 tag、GitHub Release、npm 包或正式安装验证 |

10 个 `not_run` 场景原 ID 为：**T30、T35、T36、T37、T42、T43、T50、T52、T54、T58**。

| 包 | 当前状态 | 下一负责人仍需关注的未完范围 |
|---|---|---|
| W01 功能清单 | in_progress | 功能/来源/行为资料存在，但整包验收与依赖门禁未完 |
| W02 DSH/CLI/存储兼容 | in_progress | W02.7 真实机器拓扑及休眠，M0 G1–G4 |
| W03 迁入 DS 运行时 | in_progress | W03.4 完整迁移/旧安装升级、可恢复应用 |
| W04 MR 兼容入口 | in_progress | 完整产品场景，不以局部 policy 检查替代 |
| W05 Bot 身份/模型策略 | in_progress | 真实模型工作流、整包场景验收 |
| W06 事务账本/数据迁移 | in_progress | W06.3 全域、停写、一致性、位置/激活与激活后回退 |
| W07 Planner 选 Bot | in_progress | W07.2 真实 Planner/完整派活场景 |
| W08 依赖/取消/恢复 | in_progress | W08.5 混合真实执行树与物理停止；根取消无效果失败待独立处理 |
| W09 远程 Agent | in_progress | W09.3 常开生产、跨机受保护网络与休眠；现有组件不代替部署 |
| W10 Linux 命令/文件/工作区 | in_progress | parent/leaf 固定、外部写者 CAS、真实权限/世代与完整 facade |
| W11 CLI 绑定/桥接 | in_progress | W11.2 真实身份/推理/账单/完整远程位置；E61 Job 和 E64 停止证明不等于全部完成 |
| W12 CLI 位置与工具 | planned | 本机/远程位置、十二工具及真实 PTY 等完整矩阵 |
| W13 浏览器 | planned | persistent profile、refs/script/Task、上传下载与地址边界的产品入口 |
| W14 功能并集/完整 UI | planned | 两仓能力可达、群聊/任务/附件/语音/widgets/费用等完整工作流 |
| W15 Windows helper/安装 | in_progress | W15.2 实机矩阵、安装包；Job 原子创建组件不等于账户隔离 |
| W16 DPI/会话/桌面互斥 | in_progress | W16.2 planned；W16.3 in_progress，125%/多屏/变化、锁屏/UAC/RDP/人工暂停等 |
| W17 隔离/性能/升级 | planned | OS 边界、性能/长跑/配额、升级与混版本协调 |
| W18 Desktop/Docker/运维 | planned | 干净安装、部署、运维交付 |
| W19 全量验收/证据审计 | planned | 主方案完整场景、平台矩阵与证据一致性 |
| W20 发布/下载字节核对 | planned | 正式版本、Git/npm/Release 及匿名下载/干净安装一致性 |

## 8. 阻塞、环境限制与历史材料使用纪律

1. **当前首要阻塞就是用户的停工指令。** 本次任何“下一步”只供移交，不得执行；不因远程机器可用或历史发布授权存在而继续。
2. 本机根回归未绿、stop-proof 专项尚未进入根/CI 自动回归；完整产品或发布声明不成立。远程只验证 E64 的 52 文件和六套专项，不存在本轮远程根全量通过结论。
3. 原 parent/leaf 固定、外部所有者 CAS、不同 Agent dataDir 的同机根协调、实际工作区 0600/所有权/权限和持久世代未完成。既有 Linux 新文件草稿据[进度](PROGRESS.md)首测 27 项仅 24 pass / 3 fail，尚未接入产品；本次没有续做、修复或复跑它。
4. Linux 容器和 Windows Job 组件只证明对应已测进程回收/容器边界，不证明 application/native 具备完整 OS 隔离。命令/CLI 写/浏览器/桌面的完整 Task facade 仍未开放完毕，不能取消门控。
5. 完整迁移仍有全域/外部状态、ACL/ADS/xattr、跨 Host 停写、一致快照、资金权威位置、完整 activation 和激活后新增数据回退。已有 `applySupported=false` / `activationSupported=false` 不得擅改。保存记忆 fixture 和既有 desktop 私有副本审计不能合称“所有真实用户域已验”。
6. 远程隔离测试目录及依赖存在，不应重复索要已提供的普通访问资料；但 SSH 可达不等于产品受保护网络部署/休眠拓扑验收。复用 fixture 不得用 prepare 覆盖；旧 TLS/授权有效期须在未来有授权工作中另行检查，本次不接触凭据。
7. 旧报告记录 Win11 笔记本支持 S3/hibernate、Win10 固件不提供 S3 且 hibernate 未启用、Ubuntu 为 KVM；这是旧只读电源信息。本次没有执行休眠/唤醒、改电源配置或重新确认硬件条件。
8. 100%/150%基础桌面和 helper 互斥有历史证据，但125%/跨屏/负坐标/会话变化、UAC/RDP/托盘暂停、安装卸载与生产常开仍未完成；本次未操作真实桌面。
9. 不读取或公开真实 profile、凭据、私有捕获内容、密钥、完整用户审计或计划。E64 归档不含它们。desktop 仍保持用户选择及手动移除旧 MR，web 延期，不以交接为由安装或切配置。
10. 冻结 DS vendor 与 SDK 不变，MR 来源基线 `de82df4e737954ba0458d597ea82f9a6666c1a9b`，DS 基线 `de55888a93983fc51c94f7d22bc94b4f8293205d`。历史代理/模型调度政策的讨论不是本次调用授权；本次没有启动其他代理或真实模型。

## 9. 原归档、closure-01 与本次 closure-02

### 9.1 原 145 文件检查点

归档根目录：

`E:\Obsidian_ljw\Obsidian\exports\20261030_dsh_e64_bound_stop_proof`

- 原 `20261030_SHA256.json` 为 **145 条文件清单**，逐条路径→SHA-256。清单自身 SHA-256 为 **`4ff8e021c1a457099b688d06ea65c6fd9e3ed8b5f949f88c8cd26e34b5511c86`**。不要把目录后来新增 closure 后的全部文件总数继续叫“145 文件”。
- 原 `20261030_README.md` 明确这是 selected source/public tracking/isolated synthetic evidence 的组件快照，**不是完整 source checkout 或 release**；不含 `.git`、依赖、凭据、私有 profile。工作树仍是工程主体。
- [原读回记录](../../tmp/integration/step-e64-followup/archive-readback.json)与[独立读回](../../tmp/integration/step-e64-followup/archive-independent-readback.json)记录 145 个文件及 53 个 individual sourceGitBlobs；本次只读再次核验原145条摘要全部一致。

### 9.2 closure-01：既有管理附录，只读不动

路径：`E:\Obsidian_ljw\Obsidian\exports\20261030_dsh_e64_bound_stop_proof\closure-01`。

其 `20261030_SHA256.json` 共 **11 项**，清单 SHA-256：**`212cb7a90739bbf9847840bdb6107f00b78fcb7c607d4ebfb96e21c8333aaf0e`**。本次逐项只读核验一致。11 项分别是：

1. `task_plan.md`；
2. `notes.md`；
3. `report.md`；
4. `archive-readback.json`；
5. `archive-independent-readback.json`；
6. `close-archive-e64.py`；
7. `output/feishu-stage-01.json`；
8. `output/feishu-stage-01.log`；
9. `output/integration-check-closure-01.json`；
10. `output/integration-check-closure-01.log`；
11. `20261030_README.md`。

其中旧计划可能仍写“closure addendum pending verification；then next scope”；实际[closure-readback](../../tmp/integration/step-e64-followup/closure-readback.json)已证实 closure-01 读回完成。保留历史字节，不改写归档以“修正措辞”；本报告说明该时间差，并以本次用户停工指令为最高边界。

### 9.3 如何只读读回原清单

以下仅是交接后的人工核对参考，不运行任何测试，也不修改归档；本次已用等价只读逻辑核验：

```python
from pathlib import Path
import hashlib, json
root = Path(r'E:\Obsidian_ljw\Obsidian\exports\20261030_dsh_e64_bound_stop_proof')
expected = {
    root: '4ff8e021c1a457099b688d06ea65c6fd9e3ed8b5f949f88c8cd26e34b5511c86',
    root / 'closure-01': '212cb7a90739bbf9847840bdb6107f00b78fcb7c607d4ebfb96e21c8333aaf0e',
}
for folder, digest in expected.items():
    raw = (folder / '20261030_SHA256.json').read_bytes()
    assert hashlib.sha256(raw).hexdigest() == digest
    entries = json.loads(raw)
    for relative, sha in entries.items():
        assert hashlib.sha256((folder / relative).read_bytes()).hexdigest() == sha
    print(folder, len(entries), 'verified')
```

### 9.4 closure-02：只存本次交接报告

最终报告将单独复制为：

`E:\Obsidian_ljw\Obsidian\exports\20261030_dsh_e64_bound_stop_proof\closure-02\HANDOFF-20261030-APIGPT.md`

严格只新增本报告副本，不改原145文件或清单，不改 closure-01，不复制整个工作树、不新造测试记录。最终归档后从目标文件重新读取原始 bytes，与工程内报告逐字节比较并分别计算 SHA-256；回执在本次交付消息中给出。报告不内嵌自身哈希，以免自指并使归档副本失配。复制后不再编辑报告。

## 10. Feishu 阶段通知：已发一次，不重复发送

- [feishu-stage-01.json](../../tmp/integration/step-e64-followup/output/feishu-stage-01.json)保留原命令、通知正文、UTC 时间、exit 与日志摘要；[日志](../../tmp/integration/step-e64-followup/output/feishu-stage-01.log)只有“已发送 ✅”。
- 标题：`DSH E64 组件阶段归档（非产品验收）`。UTC `09:40:54.763359`–`09:40:55.682318`，**exit 0**；日志 SHA-256 `b3ca71fded26711d1af6a7441d2735b3ad93acf17ad77c79e6a6c39f4ae9a9bb`，本次核对匹配。
- 原通知如实披露三机59/59、53 blobs、145归档读回、根1740通过/1既存失败/22跳过，以及0/20、1/63、M0 11/12和未发布。
- “发送脚本已接受/exit 0”不等于用户已读或完整产品被接受。本次不再发送通知、不读取凭据；通知里的“下一独立范围”仅保留为当时建议，已经受本次停工指令覆盖。

## 11. 建议的后续顺序——全部未在本次启动

**以下是给下一负责人的建议，不是本次执行清单，也不表示下一包已经开始或完成。必须等用户重新明确授权后再开工。**

1. 先只读确认工作树、HEAD、53 blobs、九文件快照、原145/closure-01和本报告副本；保全大量未提交主体及私有数据边界，明确新的窄范围。
2. 独立限定 stop-proof 根/CI 回归注册，与可信发布前无效果证明/`workspace-agent` 失败的根因处理；不能直接放宽 E64 provenance、把 possiblyApplied 改 false 或改测试逃避问题。两项可分开记录，不承诺测试通过即产品接受。
3. 收口文件 parent/leaf 固定、真实权限/世代和外部写者 CAS；现有 Linux 新建草稿3失败须先复核其实际证据，再决定是否继续，不冒称已集成。
4. 依赖安全边界完成后推进完整命令/CLI写/浏览器/桌面 Task facade，覆盖准入、授权、取消、原操作核对、产物和 UI；保持当前不安全入口禁用。
5. 推进完整迁移/跨 Host 停写/一致备份/资金位置与 activation、激活后新增数据回退，保护用户选择的 desktop/旧MR手动移除和 web 延期。
6. 完成真实受保护网络、生产常开/休眠、DPI/Session/UAC/RDP、干净安装、PTY、性能/长跑及其余 W12–W18 产品矩阵；真实推理/账单须有独立明确条件和授权，不用合成结果顶替。
7. 最后才做 W19 全量场景证据审计、W20 正式发布/下载字节核对；按[项目规则](../../AGENTS.md)验证固定依赖、完整测试/client、Git/npm同版本内容、标签/Release及产物。**本次不执行其中任何命令或发行操作。**

## 12. 本次交接文档核验与停止声明

已完成的只读证据核验：

- 直接解析 `tasks.json` 得到 §7 全部实际计数，`integration:status` exit 0 且与 STATUS 一致；未运行会写 STATUS 的 `integration-progress ... report`。
- 九文件 before/final、E64 内嵌快照一致；53 Git blobs、52 源 SHA-256、客户端大小/摘要和包 c 摘要均匹配。
- `output/` 中有日志摘要的 **23 组 metadata/log** 全部匹配，含失败记录；最终远程原始日志/退出记录独立匹配。摘要一致只说明身份，不把失败 exit 升格为通过。
- 原145文件及清单、closure-01的11条及清单再次只读匹配；未写这些归档文件。
- 本次工具读取/编码错误已在 §5 披露，不将其写成工程用例失败或伪装成通过。

正文完成后，仅执行本文和索引当前指针的相对文件链接存在/项目内路径核验、受保护台账/package/CI/既有失败测试的前后字节守卫，以及允许的只读 `integration:check`；随后只复制报告并做 closure-02 字节/哈希读回。具体末次结果随交付回执给出，不构造新产品证据，不改任务状态。

**用户要求本次停在 E64。交接及 readback 完成后立即停止；没有下一施工包、修复、代理、真实模型推理、用户 profile 写入、Git 提交、推送或发布。组件检查点已核验，不宣布项目完成。**
