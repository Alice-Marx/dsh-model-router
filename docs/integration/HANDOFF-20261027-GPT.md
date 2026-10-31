# GPT 续接交接报告（2026-10-27，用户要求停止施工）

> 当前已按用户要求停止实现，保留工作树供接手。本文优先于同日较早的 HANDOFF、PROGRESS 和证据快照中关于“当前状态”的描述；历史测试数字仍仅证明各自检查点。没有提交、推送、发布或发起新 CI。

## 1. 一分钟现状

- 工程目录为当前仓库；分支 `feat/bot-integration`，HEAD `89e831264ebc7dacacdd54234377e51f37fb0785`。大量已跟踪修改及未跟踪新文件都是工程资产，不能清理、重置或只拷贝 git diff 后交接。
- 目标仍是完整 [方案 1.1](plan/20261026_master_plan.md)：DS Bot 界面、原 MR 功能并集、按 Bot 配置、CLI、远程电脑、预算、迁移、安装与发布，32 R / 40 F / 63 T / 20 施工包。**整个工程远未完成，不能说已经全部落地。** 台账仍为 0/20 包完成、T63 一个场景 passed、M0 9/12；局部子步骤完成不等于产品验收完成。
- Step 留下的默认单插件组合已保留；本次进一步完成了产品机器接入、CLI Task 执行组件、Linux 原生桥修复和一批统一资金准入组件。
- 最近完整 `npm test`：**1340 项，1337 通过、0 失败、3 跳过**。这次回归发生在最后一批账户/延迟资金库/DS 已提交快照改动之前，**不能代表停工时整个工作树均已验证**。
- 默认产品目前仍使用 `createDiagnosticAccountStream()`，默认 Task/费用页还没有真正接上资金与执行服务。最后正在做这个接线，用户要求停止时尚未完成。不要把已经写出的财务组件误当成默认产品已收费准入。
- **停工前最后写入、尚未运行测试/接入产品的代码**：`funding-accounts.mjs`、`deferred-router-state.mjs`，以及 `ds-lifecycle.mjs` 新增的 committed Bot 快照接口。先审查它们，再继续。
- 全部改动保留为未提交工作；沿用此前“不擅自提交/推送/发布”的边界。用户这次只要求交接。

## 2. 本次完成并验证的内容

### 2.1 默认产品的远程电脑接入

主体位于：

- `packages/orchestration/src/remote-machines.mjs`
- `packages/orchestration/src/machine-secrets.mjs`
- `packages/orchestration/src/product-composition.mjs`
- `apps/integration-client/panels.jsx`
- `remote-computer-agent/` 对应授权与撤销实现

已实现：拥有者机器登记/secretRef 配对、真实 machineId/API major 核验、按 Bot/根目录/能力授权、ping/列目录/受控读取、撤销、停止未确认及重试确认、冷启动恢复。工具身份取自实际 SDK Agent 对象，不接受参数冒充；控制凭据继续放原 DS 秘密库，不进入机器元数据或模型参数。

撤权能中止静默请求，Agent 能停止所属进程；兄弟 Bot 票据不受影响。离线撤权先关闭宿主准入，远端停止保留未确认，跨重启不消失。并发撤销按 request_id CAS 写回，迟到成功不能覆盖较新的未确认记录。秘密名称保护复用冻结 DS 的 normalizeName，补了别名形式绕过测试。

Win11 / Ubuntu / Win10 各通过：Host 机器原生 8 项、Agent 原生 12 项、默认真实 rc.3 宿主组合 9 项。此后本机默认探针扩到 10 项，增加拥有者 MR 只读 RPC 校验，已在本机通过，尚未补三机 10 项的新证据。

见 [E21 机器证据](evidence/20261027_m4_product_machines.json)。这些是隔离源码目录、复用已验证依赖的测试，**不是干净安装、跨机 VPN/TLS 或生产部署验收**。W09.2 已完成，W09.3 生产/网络/休眠拓扑仍在进行。

### 2.2 CLI Task 执行组件与原生桥

新增 `packages/orchestration/src/cli-execution.mjs`：Host 固定 Codex 入口/摘要/版本、准确模型、资金方式、角色、工作区及能力；Task 参数只带任务文本。支持 probe/prepare/start/observe/cancel/collect/reconcile，目标合同变化会拒绝旧排队任务。Task 执行引用先持久化，CLI 来源收据与 MR 金额使用同一 SQLite 权威。

取消等待会话清理和原生停止。无停止证明、模型不匹配或缺 API 账单时保留 unknown/原预占，不伪造免费或自动重放。订阅美元为 0，未知 token 仍是 null。缓存输入计数拆开。Task 完成写失败后可按原 operation/attempt 核对已有收据，不发新请求。

Task 总期限上限延长到两小时，执行租约仍短期续签，撤权仍生效；测试用短墙钟跨多次续期，不是两小时压力测试。

Linux 实测发现长 profile 导致 Unix socket 地址超限，已改为 0700 短私有 socket 目录；签名、UID、PID/创建时间、祖先链校验保留，正常退出后清理目录。没有退化到 TCP 桥。

三机检查点：CLI Task/资金 8 项、原生桥 3 项、Task 29 项、财务 27 项，以及真实 rc.3 MR 受管执行/预算/取消/恢复均通过。CLI 组件的会话用显式离线替身，不能称作真实厂商推理通过。此后本机 CLI 原生增至 **9 项**，补运行历史裁剪后仍按原收据拒绝重放；尚未写新的三机 9 项证据。

本机实际存在 Codex **0.163.0**，真实 app-server/profile/孙进程私有 MCP/配置模型/伪造拒绝/撤权/Windows Job 停止已以非推理方式复核。不要再拿旧 PATH 的 0.157.1 当版本决策阻塞。实际入口路径属于本机私有环境，不写入公共材料。

见 [E22 CLI 组件证据](evidence/20261027_m5_cli_execution.json)和 [CLI 合同](../../packages/cli-runtime/README.md)。默认产品 Task/CLI facade、其他 11 个工具、远程 CLI 与实际 OS worker 尚未接完。

### 2.3 统一资金投影、按范围准入及订阅次数

新主体：

- `funding-projection.mjs`：在原 MR SQLite 财务事务内生成 Bot/账户/项目派生投影，不增加第二个记账写入者。
- `funding-admission.mjs`：供纯 CAS 回调使用的范围预算检查。
- `model-accounting.mjs`、`model-receipt.mjs`、`sqlite-router-state.mjs` 的对应扩展。

已验证的行为：

1. 先保存每个资金运行的贡献，再裁剪 UI 历史；裁剪后预算及执行收据仍在。
2. 更新运行替换原贡献，不再累加一次；已裁剪运行 ID 重放拒绝并回滚。
3. Bot、账户 scope、项目身份互相冲突时拒绝；旧 v1 收据无新增 scope 字段时保持原 identity hash。
4. 历史归档无法可靠归属时单列 unassigned，并保守占用受限范围，不能迁移成零费用。
5. 缺账单保持 unknown；订阅参考美元不混成 API 金额。
6. 共享账户/项目下不同 Bot 的并发预占互斥；0 是真实禁止付费的限额，包括极小正金额，不使用会放过零限额的绝对 epsilon。
7. 模型请求的实际 maxTokens 被夹到已配置上界，并在清理后恢复调用者属性描述符；字符串、不可修改的超大输出包拒绝。
8. `maxInputTokens` 不能自己宣称为 tokenizer。API 准入增加 Host-only `inputBoundFor`：可信上界未知或超过配置预留时拒绝。默认接线计划用准确模型的整个 context window 作保守上界，覆盖多模态与适配器 framing；这个默认接线尚未完成。
9. 订阅次数 0 禁止调用，日/月次数来自持久来源收据；已裁剪运行、旧未插桩订阅、未归属归档都不能重置额度。来源覆盖同一 run/package 时不把一份调用重复计次。
10. 资金日/月沿用 MR 的 Host 本地日历；epoch 记录时区，时区变更拒绝继续而非悄悄换日。此时区拒绝分支尚未新增专门测试。

最近检查：模型原生 13 项、资金投影原生 8 项。模型测试、投影测试和下面 MR 适配测试使用真实 better-sqlite3，模型端是明确的控制替身，没有真实推理。

曾有一个测试暴露旧归档 quantity 为空但 monetary subscription 标记非零，导致次数为 0；已补保守 floor，投影 8 项重新通过。`funding-all-new.log` 仍保留那次 28/29 的失败，不能删除后假装从未发生；修复后的单套结果是 `funding-projection-final.log`。**修复后没有再执行一次包含所有新套件的完整联合运行。**

### 2.4 MR 咨询关联原账单，避免双记账

新增 `funded-router-state.mjs`，并在 MR 的 `execution-lifecycle.mjs` / `budget-reservations.mjs` 添加 Host-only 资金准入接缝。策略增加私有 ALS 财务上下文；只在原资金预占成功、工作包已开始时，才将实际 MR 请求对象关联到原运行。关联不是从 JSON 参数获得。

真实 `executeBudgetedConsult()` 函数已纳入原生测试：预占与金额仍归原 MR 运行，模型装饰器只写一条关联来源收据。Host 绑定价格覆盖旧路线价格，避免同一次调用出现两套价格。DS ownRequest 的记忆/摘要等辅助调用独立保留自己的账单，不占用 MR 关联。

已通过 `tests/funded-router-state.native.mjs` **4 项**：实际 MR 咨询单账单/价格、Bot 零限额不可被 confirmOverBudget 绕过、共享账户竞争/未开始不得关联、DS 辅助独立计费。当前适配器刻意只支持一个 API 包；团队/多账户工作必须继续设计拆分与父级汇总，不能直接放开。

### 2.5 Bot 绑定设置组件

`bot-settings.mjs` 已修复并通过 **8 项原生测试**：拥有者 CAS、可信模型/CLI/机器/根目录/能力目录、启停、旧 Bot 保守迁移、失败暂停、原始 DS 模型变更时不自动改绑等。闭合 schema 不接任意可执行路径、URL、凭据或根路径。API 启用前要求价格、输入/输出预留上界及日/月预算；0 和 null 含义分开。

`grantFor(bot)` 保持纯读，不会在 DS 保存前根据内存状态发布授权；显式保存或已提交生命周期才发布。授权回调失败需要可靠暂停，不能显示已启用。

该组件仍未接入默认产品及绑定表单。**DS 原模型设置是唯一模型编辑权威**；绑定中的模型只是授权/价格快照。不要再造第二个独立修改 Bot 模型的写入者。

### 2.6 拥有者只读 RPC 与包闭包

默认策略已恢复宿主拥有者的目录/状态/费用/边界/预览/运行状态/终端只读方法，动态刷新准确模型目录。模型主体不能冒充 owner。写入、启动执行、安装器和终端写入仍需要相应 facade；后续要恢复完整授权的人类工作流，不能把现在的阻断当最终功能删减。

实际 npm 包检查发现 files 里目录声明与逐文件声明重复，已删除冗余目录而保留全部冻结源文件。检查点包 237 文件、运行时闭包 110 项通过，files 清单 231 项。后续新资金模块尚未接入默认闭包，**不能认为最新工作树打包已经通过**。

## 3. 停工时刚写出、尚未测试的内容

这部分不是“完成项”，请接手先审核：

1. **`packages/orchestration/src/funding-accounts.mjs`**：SQLite provider 资金范围配置，scope ID 由 provider 稳定摘要派生，拥有者 CAS 修改启停及日/月本地限额；声明不是厂商余额。尚未测试、未注册 owner action/页面、未接 model accounting。特别需要补授权同步失败后的关闭语义，不能在回调失败后留下仍被其他宿主视为可用的状态。多账户凭据的真实映射及项目级配置仍未完成。
2. **`packages/orchestration/src/deferred-router-state.mjs`**：拟在 apply 同步段安装唯一资金权威，启动早期 MR 请求等待 SQLite 就绪，避免先写 JSON 再迁移的双写窗口。尚未测试/接线；需要核对完整 RouterState API（例如当前 facade 尚未覆盖 dismissNotice），处理 startup reject/dispose 和重复 install。最终 resolve 应指向带 prepareExecutionFunding 的适配状态，而不是直接指向缺此方法的 raw store。
3. **`packages/orchestration/src/ds-lifecycle.mjs`**：最后补 `compileDsOwnership().botRecords`、生命周期 committedBot()/committedBots()。目的是让资金/绑定回调只读取已提交 DS 身份，而非会先变化再保存的 runtime.state。**这批新增接口还没重跑 lifecycle 或全量测试**；此前已验证的同 revision 授权刷新不等于新增接口已验证。

用户要求停止后，没有继续修改这些实现或补跑测试。只整理了本报告与进度交接入口。

## 4. 推荐接手顺序

1. 先看 `git status` 和本报告，不 reset/clean/stash 掉别人未提交工作。核对上述三处未测代码；读 `PROGRESS.md`、`tasks.json`、master plan 和已有 E21/E22。
2. 对所有新资金套件做一次联合原生回归，修复后再跑完整 npm test；补资金账户、延迟启动权威、committed Bot 快照的针对性测试。不要用旧 1340 或旧 54 代替当前状态。
3. 完成默认资金接线：同步安装等待中的唯一财务 store → 启动 SQLite 原权威/备份迁移 → 创建 Bot settings、账户目录与资金适配器 → shared model hook → usage/read model/owner actions → 页面。完整断言 MR 咨询不双记账、辅助调用独立记账、unknown/撤销/冷启保持一致。
4. 启用资金前，严格按已提交 DS Bot 模型编译授权；保存/目录变化先同步撤权，再刷新 lifecycle 工具限制。新 Bot 默认未配置，页面必须明确引导，不能伪造可执行。
5. 默认真实 rc.3 探针需先通过真正 owner action 配账户和 Main/Worker 绑定，再发合成模型回合。现脚本仍按旧诊断默认入口运行，直接换资金钩子会在首次调用前被拒绝，这是需要更新的产品流程，不是放宽准入的理由。
6. 接 Task/CLI 到默认产品；CLI facade 的全局 USD 限额与订阅日计数目前仍沿旧组件合同，尚未全部用新 Bot/账户/项目准入统一。其他 CLI/远程执行及 OS worker 继续做，不能因当前 Codex 组件通过而标记 W11 完成。
7. 新原生套件/脚本进入 CI、package files 闭包与证据；三机复跑；更新台账/行为审计。目前新资金阶段还没有公开 evidence 文件、行为审计分组或 CI 注册，不要漏掉。
8. 继续 master plan 全部剩余施工包和发布门禁，最终用户验证与发布按既有授权边界处理。不能停在“默认入口能开”的里程碑冒充整个工程完成。

## 5. 仍未完成的工程范围

- 默认产品真正的 Task/资金服务、费用/预占/订阅来源列表和 unknown 收据核对 UI，端到端单事务准入。
- 工作包图/规划器、审批、制品、写入执行、合并及失败恢复等完整任务流程；当前固定只读单包后端不是完整 DAG。
- 原 DS 用户配置迁移/旧安装升级 W03.4；W04；W06–W08；W10；W12–W14；W16–W20 的未开工/未完成施工内容。准确清单以 tasks.json 为准。
- 人类高级工作台原有写入/安装/终端流程在授权 facade 下恢复，不能永久禁用原功能。
- 所有 CLI 工具、远程 CLI、浏览器/桌面真实 Task facade；完整跨 Bot/CLI/远程取消树。
- 真实 DSH OS worker 隔离：Linux/Win10 曾能读其他 Bot 的合成文件；Win11 native sandbox ACL 曾有 Win32 5。另一个非 root 容器的合成隔离测试并不表示 DSH worker 已隔离。不可把应用层作用域或只读 CLI/MCP 描述等同 OS 边界。
- DS 群组模型 override 与每 Bot 精确模型授权仍需设计；不能简单将所有路由并集授权来绕过。
- 生产 Ubuntu/Win10 常开 Agent、真实 VPN/TLS、休眠/唤醒、跨机网络及生产服务管理；Win10/Win11 DPI/多屏/UAC/RDP/安装包等实机矩阵。
- 干净安装/升级/回滚、Electron/最终包闭包、全部场景验收、正式发布。没有新 CI 验证本次未提交代码。

## 6. 可复跑入口与现有日志

以下均在仓库根运行，不含真实模型推理：

```powershell
# 已安装/固定的原生驱动；旧原生测试从这个变量导入
$env:DSH_TASK_DRIVER = (node -p "require('node:url').pathToFileURL(require.resolve('better-sqlite3')).href")

# 建议接手先联合执行，当前没有这份最新联合通过结论
node --test tests/sqlite-router-state.native.mjs tests/model-accounting.native.mjs tests/funding-projection.native.mjs tests/funded-router-state.native.mjs tests/bot-settings.native.mjs tests/cli-execution.native.mjs

node --test tests/budget-reservations-state.test.mjs tests/bot-policy.test.mjs tests/ds-lifecycle.test.mjs
npm test
npm run integration:check
node scripts/integration-product-client.mjs --check
node scripts/integration-product-default.mjs
node scripts/integration-remote-machines.mjs
node scripts/integration-cli-execution.mjs

# 仅在确需恢复依赖时，按已验证锁文件严格安装
node tmp/pnpm-10.34.6/package/bin/pnpm.cjs install --frozen-lockfile --strict-peer-dependencies
```

原生 driver 13.0.3 已加入根生产依赖，pnpm onlyBuiltDependencies 只允许 better-sqlite3；CI 隔离宿主步骤需显式 rebuild。不要顺手升级 SDK/冻结 DS 来消除问题。

日志位于被忽略的 `tmp/integration/m0-20261027/`，不是公开证据：

| 日志 | 当时结论与边界 |
|---|---|
| `full-funding.log` | 根 1340 / 1337 pass / 3 skip；早于最后三处未测改动 |
| `funding-expanded.log` | 当时资金/设置/CLI 联合 54/54；早于后续新增测试/实现 |
| `funding-base.log` | 原预算/策略 24/24 |
| `funded-mr.log` | 模型 13 + 当时投影 6 + MR 适配 4 = 23/23 |
| `funding-all-new.log` | 29 项中 1 失败，旧归档订阅 floor 问题；保留历史 |
| `funding-projection-final.log` | 上述修复后，投影独立 8/8；无最新全套联合结论 |
| `default-owner-final.log` | 本机默认真实 rc.3 组合 10 项通过，仍是诊断资金路径 |
| `cli-linux-final.log` / `cli-win10-final.log` | E22 对应三机组件检查点 |
| `cli-peer-linux-final.log` / `cli-peer-win10-final.log` | 最终私有短 socket / 原生桥检查 |

`npm test` 目前没有自动覆盖这些 `.native.mjs` 新资金套件；仅看根测试通过是不够的。现有公开 E21/E22 是点时间证据，不要改数字/ZIP 摘要冒充最新快照。

## 7. 测试机、私有资产与安全复用

- 用户已给过远程测试资料，私有 helper 为被忽略的 `tmp/integration/remote-testing.py`，可 `linux|win10 run/upload/download`。不要打印 helper 或凭据文件内容，不要将真实端点/账号/密钥写进报告或公共证据。
- 新隔离源码目录：Linux `/opt/dsh-bot-integration-tests/20261027-product-machines-01/source`；Win10 `D:/DSH-Bot-Integration-Tests/20261027-product-machines-01/source`。通过链接复用了更早测试根的依赖与已验证 addon，并非全新安装。
- `tmp/integration/m0-20261027/` 内源 ZIP 曾重复使用同名文件、后续还有文件 overlay；旧证据中的摘要只对应当时快照。不要直接重跑旧 record/pack 脚本覆盖 E21/E22。
- 私有 `pack-machine-source.py` 按 git tracked + 非 ignored untracked 收集源码，避免把 tmp、node_modules、凭据打包；接手仍须核对清单。
- 冻结 MR baseline `de82df4e737954ba0458d597ea82f9a6666c1a9b`；冻结 DS `de55888a93983fc51c94f7d22bc94b4f8293205d`，迁入 297 文件。DS vendor 和 SDK 不应改动；适配在外层。
- 所有新增测试均为受控模型替身或非推理 CLI 探针。更早曾有一次真实 Codex turn 发出后超时，usage/厂商请求数/支出未知；后续非推理 0 请求不能抵消它。**不要宣称整个工程真实模型请求或支出为 0，也不要宣称真实模型工作流已通过。**
- 原有工程约束为 GPT 调用；曾用的三个 GPT 子代理已因额度限制停止，文件已保留，本轮后续由主会话直接执行。没有自动切换模型。

## 8. 交接注意事项

- 最后新增代码没有任何 git commit；接手必须拿整个工作树及必要 ignored 本地测试资产，不能只拿 HEAD。
- 台账 JSON 使用 CRLF + 两空格；package.json 使用 LF。不要顺手格式化造成大片噪音。
- `updateRun` 回调修改原对象，返回替代对象不会生效；CAS 回调必须纯，不能在重试中启动进程或请求。
- Windows PowerShell 5 经 native argv 传 `node -e` 的双引号会丢失；需要含双引号的 JS 时用脚本文件或 HereString 管道。
- package files 要逐文件闭包，目录项会被闭包验证器拒绝；未提交时不能执行 Git 字节证明。
- 根已有 Step 留下的 `scripts/tmp-ds-closure.mjs` 和 `scripts/tmp-update-package.mjs`，未擅自删除。
- 下一位接手前，应先确认用户授权恢复施工；本报告本身不是继续运行、发布或调用真实模型的授权。
