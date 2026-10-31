# DSH Bot 一体化工程详细交接（E67–E76，2026-10-31）

> **当前交接点：E67–E76 十个检查点完成组件实现与验证（pinned-write 复核/接线、roots-generation、CLI 监督器硬化、真实权限+跨 dataDir、容器命令 Task 后端+产品注册、停写栅栏切片 1/2/3）；完整工程、产品整包验收和发行仍未完成。**
>
> 本文接续 [KIMI E65–E66 交接](HANDOFF-20261030-KIMI.md)。E58–E66 的实现和历史证据保持原样；旧交接中的根测试数字、待办顺序和停止状态只代表各自时点。用户持续"继续"授权下，本阶段按 KIMI §7 顺序推进，未做 parent/leaf 之外的任何发布操作。

## 1. 工程位置、权威顺序与工作树保护

| 项目 | 当前事实 |
|---|---|
| 工程根目录 | `F:\everyAI\dsh-model-router-all\dsh-model-router` |
| 分支 / HEAD | `feat/bot-integration` / `89e831264ebc7dacacdd54234377e51f37fb0785`（未变） |
| 工程主体 | 大量未提交、未跟踪文件（`git status --short` 约 282 项）及被忽略的冻结 vendor；不能只用 HEAD 或 `git diff` 交接 |
| 当前组件检查点 | E67–E76（本文 §2） |
| 整体状态 | **0/20 整包完成；1/63 场景 passed；M0 子步骤 11/12；behavior-audit 76 条 partial entry observations** |
| 发布状态 | 未 stage、commit、push、tag、GitHub Release 或 npm 发布 |

建议阅读顺序：本文 → 各检查点证据（§2 表内链接）→ [tasks.json](tasks.json) / [STATUS.txt](STATUS.txt) → [PROGRESS.md](PROGRESS.md)。

禁止 `reset`、`clean`、`stash`、只恢复 HEAD 或用远端文件覆盖工作树。冻结 DS vendor 与 SDK 未改；DS 基线仍为 `de55888a93983fc51c94f7d22bc94b4f8293205d`。`tasks.json`/`behavior-audit.json` 保持 CRLF+两空格，`package.json` 保持 LF（每次改后做过字节级检查）。

## 2. 本阶段十个检查点（E67–E76）

每项均为：设计文档先行 → 实现 → 本机全量根回归 0 失败 → 真机验证（见 §4）→ 台账同步（证据 JSON + audit 条目 + tasks 步骤 + PROGRESS/STATUS + integration:check/文档检查/check:client）。首跑失败一律如实记入各证据 `preservedFailures` 并修复重跑，无静默、无改断言、无跳过销项。

| 检查点 | 内容 | 证据 | tasks 步骤 |
|---|---|---|---|
| E67 | pinned-write 交接后源编辑的真机复核（前任在 E64 验证后又改了源码：4 个发布前取消点补 `possiblyApplied:false`、link 后首观测走 publishedGuard；agent.ts 被半接线）→ Ubuntu fixture 5 文件 SHA-256 校验后 **27/27**；E66 联合 67/67 与根回归 1776 证明半接线行为中性 | [pinned_write_recheck](evidence/20261030_pinned_write_recheck.json) | W10.3 |
| E68 | 持久 workspace **roots-generation 绑定与失效**：`rootsGeneration()` 摘要排序 rootId→路径映射入 Store meta；同配置重启零影响；配置变化按 legacy 同一活性谓词 fail-closed 栅栏（`WORKSPACE_RECOVERY_REQUIRED`），结算后栅栏失效不回滚；升级旧库不栅栏；admission 记 `roots_generation` 列；`machine_ping` 暴露摘要作为 Host 预览失效钩子 | [workspace_roots_generation](evidence/20261030_workspace_roots_generation.json) | W10.4 |
| E69 | Linux `fs_write` **描述符固定发布接线**（CODEX P0#2 主体）：Linux 新建文件走 `pinnedCreateNewFile`，Windows 逐字节保留原 rename 路径；现有目标→`FILE_CHANGED`、匹配哈希覆写→`OVERWRITE_UNSUPPORTED` 501 不回退、失配/缺失保持 CAS 契约；准入 pin 即 pinned 根，`pinnedWritePolicy` 每相位复查授权/保护路径/根身份；发布后策略拒绝→unknown 保留锁；现有"最终发布前取消"屏障按路径重锚、E66 断言零放宽 | [pinned_write_agent_wiring](evidence/20261030_pinned_write_agent_wiring.json) | W10.5 |
| E70 | **CLI native-peer 监督器硬化**（CODEX P0#1/KIMI §6.2 四项）：stdin 中继改有界队列+排水线程（不读取子进程→`input-stalled` 停止帧+Job 树 137+`treeStopped`；管道破裂保留优雅帧）；`OwnStream` 先转移句柄所有权消除双关闭；`PROC_THREAD_ATTRIBUTE_HANDLE_LIST`（**0x00020002**——错误常量 0x20001 在两台真机复现 ERROR_NOT_SUPPORTED 后修正）限定继承；helper 死亡矩阵补 `preCreate`、legacy gate 不可解析时按原始字节 PID/FILETIME 回收 | [cli_peer_hardening](evidence/20261030_cli_peer_hardening.json) | W11.2 挂证据 |
| E71 | **真实权限+跨 dataDir 协调**（CODEX P0#3 收口）：真机 Docker 探针（worker 65532:65532 全能力丢弃：授权根可读写、0600/0700 `EACCES` fail-closed、chmod/chown `EPERM`、建档归属 65532；Agent 永不 chmod/chown 用户数据）；`WorkspacePin.capture` Linux 对目录 `dev:ino` 取 `/tmp/dsh-agent-root-locks` 独占声明（controller-lock 纪律回收死亡持有者、同进程嵌套引用计数、目录不可用可观测降级） | [workspace_permissions](evidence/20261031_workspace_permissions.json) | W10.6 |
| E72 | **版本化容器命令 Task 后端**（CODEX P0#4 组件层）：Agent `container_command_v1` 独立类目工具（非容器 Agent 落 never-started 而非抛错、无原生回退、argv 唯一形态）；Host 闭集合同+`createRemoteCommandBackend`（先 journal 后派发/有界轮询/原操作身份+严格监督者停止证据/丢回复 unknown 仅观察对账/取消请求后**有界观察原操作到终态**再取收据）；Ubuntu 真实 Docker 21/21 | [remote_command_facade](evidence/20261031_remote_command_facade.json) | W09.8 |
| E73 | **停写栅栏切片 1**——只读写者/域清点：显式声明域、`dev:ino` 身份别名收敛、Linux 真实 `/proc` 扫描（fdinfo 八进制写标志、stat 字段 22 身份、调用进程自身照报、不可读描述符=枚举缺口）、非 Linux 如实报告能力缺口、恒 `stopWriteProvable:false` | [migration_writer_inventory](evidence/20261031_migration_writer_inventory.json) | W06.11 |
| E74 | **切片 2**——单机共享准入与迁移独占栅栏原型：guard 互斥下原子"查 intent→建共享声明"关闭读门竞态；协调者持久 intent（跨自身死亡阻断）→排空→guard 内复查取独占；崩溃接管验证死亡后回收；仅协议参与方、非停写证明。开发中复现修复 Windows guard 自残留死锁等 4 缺陷 | [migration_fence](evidence/20261031_migration_fence.json) | W06.12 |
| E75 | **切片 3**——只读最新回退准备诊断：活跃/unknown/可重试 blocked/已启动 skipped/未决操作/未投递 outbox/开放 hold 为阻断码，not-started skipped 仅提示；账本归档须校验通过**且**私有导出与活库一致（校验器返回脱敏摘要→直接比对私有导出；归档后改库=`BACKUP_BINDING_STALE`）；诊断前后两库字节不变有断言；资金 rollback guard 一字未动 | [migration_rollback_readiness](evidence/20261031_migration_rollback_readiness.json) | W06.13 |
| E76 | **产品注册（命令 facade 设计门 5）**：composition 双后端+目录；计划接受 command 执行形状（归一化保留真实后端——开发中暴露第二处硬编码站点并修复）；UI 投影增量 `exitCode`/`notStarted`；模型计划描述文档化边界；发布清单补新模块（闭包测试抓出） | [command_product_registration](evidence/20261031_command_product_registration.json) | W09.9 |

### 本阶段新增/修改的主要源文件（Git blob 见各证据 JSON）

- `remote-computer-agent/src/`：`workspace-generation.ts`（新）、`agent.ts`（write 分流/pinnedWritePolicy/container_command_v1 路由/generation reconcile）、`protocol.ts`（目录+`container_command_v1`）、`workspace-identity.ts`（跨 dataDir 声明锁）、`workspace-admission.ts`（`roots_generation` 列+工具清单）、`pinned-write.ts`（E67 验证的编辑）
- `packages/orchestration/src/`：`remote-command-execution.mjs`（新）、`migration-writer-inventory.mjs`（新）、`migration-fence.mjs`（新）、`migration-rollback-readiness.mjs`（新）、`task-contract.mjs`、`task-service.mjs`、`task-journal.mjs`、`remote-machines.mjs`、`product-composition.mjs`、`task-tools.mjs`
- `packages/cli-runtime/src/native-peer.ps1`、`scripts/integration-workspace-permissions.mjs`（新）
- 新测试套件（均已注册 `npm test`/CI）：`workspace-generation`、`workspace-agent-pinned`、`pinned-write`、`workspace-root-lock`、`remote-command-tasks`、`migration-writer-inventory`、`migration-fence`、`migration-rollback-readiness`

## 3. 必须保持的安全不变量（本阶段新增部分叠加旧交接）

1. pinned 组件边界不变：inode 固定≠路径/挂载/安全标签约束；`link()` 仍走 `/proc/fd` 路径串；现有目标一律拒绝、无外部写者 CAS；发布后失败=unknown 保留锁无停止证明。
2. Linux 覆写禁用不回退（`OVERWRITE_UNSUPPORTED`）；Windows 发布保持路径语义、不获描述符声明。
3. roots-generation：升级旧库**不**栅栏（无观察到的变化）；只有观察到摘要变化才 fail-closed。
4. 容器命令仅别名 argv、仅容器内执行、无原生回退；非容器 Agent 必须**落成 never-started 终态**而非抛错（抛错会让 admitted 操作悬置）。
5. 停止证据只有原操作收据（监督者/in-process），绝不以终态冒充；取消不是回滚、效果保留并如实投影。
6. 写者清点/栅栏/回退诊断**永不自称停写证明**（`stopWriteProvable:false` 恒置）；`activationSupported=false`、`postActivationRollbackSupported=false` 不得改真；资金 `rollback()` guard 不动。
7. Agent 永不 chmod/chown 用户项目；夹具只准备自己的树（容器夹具需自备 operator 授权 chmod）。
8. `HANDLE_LIST` 常量为 **0x00020002**（0x20001 是保留号、两台真机实测 ERROR_NOT_SUPPORTED——勿"改回去"）。
9. 0 真实模型推理；`scripts/integration-cli-runtime.mjs` 默认推理不得运行。

## 4. 实际验证结果（本阶段累计口径）

| 验证 | 结果 |
|---|---|
| 最终 `npm test` | **1853 项：1785 通过、0 失败、68 跳过，exit 0**（起点 1776） |
| Ubuntu 真机（10.0.0.1，Node v22.22.1，内核 6.8.0-101-generic） | 各检查点专项全绿：pinned 27/27、E69 联合 71/71、写者清点 8/1跳过、栅栏 7/7、回退诊断 6/6、命令（真实 Docker）21/21、注册联合 21/21、权限探针全过 |
| Win10 真机（10.0.0.2，Node v24.18.0） | 对应 Windows 面：CLI 16/16、栅栏 7/7、命令 21:16/0/5、注册 21:16/0/5、清点 4/5跳过 等 |
| `integration:check` | 32R/40F/63T/20W 有效 |
| `check:client` / 文档四件套 | `[build-client] OK` / 26/26 |

远程按既有纪律：复用 `refresh-ui-20261030a` fixture、只覆盖检查点文件（字节数/SHA-256 校验）、不跑 prepare。**注意：fixture 现已累积多轮覆盖文件与 scripts/ 目录，属测试基建可继续复用。**

### 远程访问通道（本阶段查明并全程使用；前几任未写入交接）

- 凭据模块：`C:\Users\Jianw\.agents\skills\Alice_marx_workshop\modules\remote_control\scripts\`（用户自建授权 skill；`creds.py` 从 `computer_code.txt` 读主机账密，不含密码明文）
- **Ubuntu = 10.0.0.1**（不是 .2）：`python ssh_run.py "命令"` / `python ssh_upload.py <本地> <远程>`（exec+base64，<100KB/文件）
- **Win10 = 10.0.0.2**（用户 `cad`）：`python win_run.py "cmd命令"`（GBK 自动解码）+ paramiko SFTP 上传（示例脚本散见 `/tmp/win10_push_*.py`，可重写）
- 大文件/整包：先压缩分片或直接复用 fixture 既有依赖

### 自动续跑定时任务（重要）

本会话创建了工作区级 cron：`automation-eb4fee9b-b022-4f3d-9fc2-ea2f6aeaa482`，**每日 03:26** 触发（对应用户 5 小时额度重置点），自动在本会话上下文继续工程（prompt 含完整纪律与边界）。接手者注意：
- 它继续的是**本会话**的对话上下文；若你另开会话接手，请让用户删除或重建该任务，避免双线施工。
- 管理：CronList/CronUpdate/CronDelete（标题"03:26额度重置后自动继续DSH Bot工程"）。

## 5. 台账与文档同步状态

- [tasks.json](tasks.json)：新增 W06.11/12/13、W09.8/9、W10.3/4/5/6（均 completed）；W11.2 挂 E70 证据。场景与整包计数未动。
- [behavior-audit.json](behavior-audit.json)：E67–E76 共 10 条新条目，现 76 条 partial entry observations。
- [PROGRESS.md](PROGRESS.md)：每检查点一节（最新在顶部）。
- [STATUS.txt](STATUS.txt)：每步由 `node scripts/integration-progress.mjs report` 真实再生成。
- 新计划文档：`20261030_pinned_write_recheck.md`、`20261030_workspace_roots_generation.md`、`20261030_cli_peer_hardening.md`、`20261031_workspace_permissions.md`、`20261031_migration_fence.md`。
- 原始日志在 `tmp/integration/`（root 回归）与 `tmp/integration/step-*/output/`（远程原始日志+sha256）。

## 6. 仍需下一负责人处理的技术边界

### 6.1 命令/文件面（E76 遗留）

- **combined-host 端到端命令场景**：现有 `scripts/integration-combined-host.mjs` 全绿但无命令用例；加一条（离线模型 fixture + 容器命令或至少 never-started 路径）即可闭合 E76 的"产品验收"缺口。
- **Windows OS 边界命令**：`container_command_v1` 在 Windows 无容器后端（fail-closed 已验）；Windows 原生命令面（Job 对象监督 + 受限令牌）是独立设计，勿凭 application/native 配置宣称隔离。
- 模型面命令开放策略：当前仅 workspace-write 计划面；更宽暴露是产品决策。

### 6.2 停写栅栏剩余切片（设计见 [20261030_migration_stop_fence.md](plan/20261030_migration_stop_fence.md) §6）

- **切片 4（OS 隔离适配器）**：专用账户/设备上验证真实旧进程停写、写句柄、自动重启拦截与 coordinator 死亡——需平台凭据与真实旧入口，工作量最大。
- **切片 5（可恢复提交编排+激活）**：整合切片 1/2/3 与既有配置事务/归档为状态机（inspect→intent→drain→capture→maintenance→activate→release）；`activationSupported` 只在此后讨论。
- 栅栏原型的产品接线（migration-startup-gate 与 fence 协议对接）未做。
- Windows 声明无 start-tick 身份（PID 复用限制，已如实记录）。

### 6.3 其他未收口（承接旧交接，均未变化）

- 完整迁移：全域/OS 元数据、跨 Host 停写、一致备份、激活后新增数据回退的**实际执行**（诊断已就绪）。
- 常开生产 Agent、受保护跨机网络、真实休眠、DPI/Session/UAC/RDP、人工托盘、安装升级、性能长跑。
- E53 首次 MR 咨询超时仍无根因；更早真实 CLI turn 的未知 usage 不能被本阶段 0 调用冲销。
- CLI `native-peer.ps1` 已硬化但非 OS 沙箱；恶意同用户进程不在任何威胁模型内。
- E71 组授权（chgrp 65532）需 root 夹具未验；跨用户声明目录共享降级语义已记录。

## 7. 建议的下一顺序

1. **combined-host 命令场景**（小、快、闭 E76 缺口）。
2. **停写栅栏切片 5 编排**（复用切片 1/2/3 组件 + 既有配置事务/归档，纯合成环境可推进，无需切片 4 的平台条件）；`activationSupported` 保持 false。
3. 切片 4 OS 隔离适配器（需用户协调专用账户/设备）。
4. Windows OS 边界命令面设计。
5. 生产拓扑/休眠/安装矩阵 → W19 全量证据审计 → W20 发布。用户已有的"全部完成后上传 GitHub/npm"授权持续有效，前提远未达到。

## 8. 复跑入口（按需）

```powershell
# 本阶段核心专项
node --test tests/pinned-write.native.mjs tests/workspace-agent-pinned.native.mjs
node --test tests/workspace-generation.native.mjs tests/workspace-root-lock.native.mjs
node --test tests/remote-command-tasks.native.mjs            # Docker 用例需 linux + DSH_TEST_DOCKER=1
node --test tests/migration-writer-inventory.native.mjs tests/migration-fence.native.mjs tests/migration-rollback-readiness.native.mjs
node --test tests/cli-native-peer-job.native.mjs tests/cli-native-peer-probe.native.mjs
# 全量
npm test
npm run check:client
npm run integration:check
node --test tests/integration-progress.test.mjs tests/integration-documents.test.mjs tests/integration-inventory.test.mjs tests/product-client-build.test.mjs
node scripts/integration-progress.mjs report
node scripts/integration-workspace-permissions.mjs           # 仅 Ubuntu(有 docker)
```

远程复跑：§4 通道 + 各 `tmp/integration/step-*/` 下的 runner 脚本模式（SHA-256 校验→运行→取回日志核对哈希）。**`integration-cli-runtime.mjs` 默认进入推理，不得顺手运行；无推理安装核验只用 `integration-cli-installed.mjs`。**

## 9. 私有材料、定时任务与停止点

- 远程 fixture、日志、TLS 私钥、CLI 隔离安装及私有 metadata 只在授权隔离目录/用户 skill 内；公开证据只记计数、Git blob、摘要与相对路径。
- desktop 仍是用户选定迁移对象，web 延后；用户手动移除旧 MR 的状态不得自动恢复；未读取/改写真实 desktop profile。
- 本阶段 0 真实模型推理、0 真实账单、无用户 profile 写入；未提交、未推送、未发布、未发飞书通知。
- 定时任务处置见 §4；本文归档到 Obsidian 时应与工程内文件逐字节一致，归档副本不含凭据/私钥/完整工作树/发布声明。

**交接结论：E67–E76 十个检查点均有真实证据，本机根回归 1853 项 0 失败；CODEX P0 全部收口、停写栅栏完成 1/2/3、命令 facade 五道门全过。完整 DSH Bot 一体化工程仍未完成（0/20 整包、1/63 场景）。下一项按 §7 顺序另行实施验证，不得把组件通过写成产品验收。**
