# DSH Bot 一体化工程交接报告

> **后续状态更新：**用户已要求 GPT 继续统筹，本文原停工描述及 CLI Job 缺口属于 E60 历史检查点。其后 Windows CLI Job 专项、能力探测与 npm 辅助脚本闭包已补充并留 [E61 证据](evidence/20261030_cli_native_peer_job.json)；远程取消停止证据收紧见 [E62](evidence/20261030_operation_cancel_evidence.json)。最新进展及仍未完成内容见 [PROGRESS.md](PROGRESS.md)。其余未验证的产品范围不能因组件测试通过而关闭。

更新日期：2026-10-30（Asia/Shanghai）。交接点：E58–E60 当前阶段完成，按用户要求停止继续施工。

**本文件是交接时“当前状态”的权威入口。** PROGRESS.md、STATUS.txt 与三份新证据应与之一起读取。HANDOFF-20261028.md、此前交接和证据保留为历史；其中的“现在”、旧计数、旧任务顺序与 GPT-only 限制不能覆盖本文件及用户最新 AGENTS。

## 1. 一分钟现状

- 工程本机位置：`F:/everyAI/dsh-model-router-all/dsh-model-router`。分支 `feat/bot-integration`；HEAD 仍为 `89e831264ebc7dacacdd54234377e51f37fb0785`。
- **工程主体是大量未提交、未跟踪文件及被忽略的冻结 vendor。没有 commit、push、tag、GitHub Release 或 npm 发布。只取 HEAD 或 git diff 会丢掉主体。**
- 本阶段完成：实际物理根写入准入/持久互斥、Linux 挂载身份门控、文件取消和退出等待、Agent Windows Job 原子创建及父进程死亡回收、真实官方 Codex 0.163.0 无推理 MCP 探针。
- 同一批 **962 个源码文件**已在 Win11、Win10、Ubuntu 逐文件核对，含冻结 DS **297 文件**。三机项目根回归各 **1743 项 / 0 失败**。
- 真实 CLI 版本缺口已有实证：隔离安装的 **0.163.0** 在三机真实初始化、原生 MCP、正常退出 **13/13**。模型名为合成配置身份，**未做真实推理、模型可用性或账单验收**。
- 整体仍 **0/20 整包完成；63 场景中 1 passed / 52 partial / 10 not_run；M0 子步骤 11/12**。组件实现已有大量进展，整包按全部场景、依赖及 M0 门槛统计。
- 当前没有继续运行的编码子代理；本阶段自有 Windows 草稿进程检查为 0。测试源、私有日志和隔离安装目录保留，便于复跑；没有清理用户工程或迁移数据。
- 用户先前给过“全部完成后上传 GitHub 和 npm”的授权，该授权持续有效。**完整工程未验收，本交接点未触发发布。**

## 2. 接手第一步与硬边界

按顺序执行：

1. `git status --short`、`git branch --show-current`、`git rev-parse HEAD`，保全当前工作树。
2. 完整阅读本文件，查看 [STATUS.txt](STATUS.txt)、[tasks.json](tasks.json) 与 E58–E60；不要拿历史的 1399、1643、1696 等数字当当前基准。
3. 核对 vendor 存在且为 297 文件，再按第 8 节选择适用平台复跑。先定位环境/证书/路径差异，不靠升级 SDK 或禁用校验让测试变绿。

必须保持：

- 禁止 reset、clean、stash、只恢复 HEAD、全量覆盖为仓库远端版本。
- DS 冻结目录 `modules/bot-runtime/vendor/ds-bot` 不改；DS 基线 `de55888a93983fc51c94f7d22bc94b4f8293205d`，MR 来源基线 `de82df4e737954ba0458d597ea82f9a6666c1a9b`。适配在外层，SDK/依赖版本按锁文件。
- 产品验证保持 **0 真实模型推理**；真实推理由用户执行。不要把开发模型池的 key 注入产品 Bot、CLI 或资金账户。
- 用户目前选定 `desktop` 迁移；`web` 延后。用户明确手动移除了旧 Model Router，**不得从历史备份自动恢复它**。
- 本阶段没有写入/安装/激活真实 desktop profile，也没有读取其登录资料来给 CLI 测试“补登录”。
- `tasks.json`、`behavior-audit.json`：CRLF、两空格、末尾 CRLF；`package.json`：LF。证据路径使用仓库相对路径且文件必须真实存在。
- 临时 Node 脚本保存为 `.mjs`。长命令、JSON、Windows 反斜杠不要塞进 `node -e` 或跨 shell 字符串。
- 未验证不标 completed；整包 completed 还要求全部场景 passed、全部子步骤 completed、依赖 completed，非 M0 包另要求 M0 四门禁 completed。

## 3. 完整工程此前已具备的基础

下表概括已有代码及证据范围，不能据此宣称完整产品验收。

| 领域 | 已有基础 | 仍需完成 |
| --- | --- | --- |
| 出厂组合 | 一个插件入口接 DS Bot 运行时、MR 插件体、一个策略和一个客户端 bundle；真实 rc.3 宿主验证 | 全功能 UI/用户工作流、生产安装与升级 |
| Bot/模型/资金 | 稳定 Bot 主体、严格模型绑定、来源收据、未知费用保留、API/订阅投影与所有者核对 | 用户真实模型/CLI/复核费用、完整交互和生产数据验收 |
| Task/调度 | Task journal、outbox、资金同事务准入、DAG 校验与依赖派发、失败分支阻塞、独立分支、取消/原操作恢复 | 真实 Planner 与全部执行类型/实际场景 |
| 机器 | secretRef 配对、按 Bot/根/工具授权、撤权、读取、票据轮换、TLS/mTLS/匿名抗滥用、控制路径保护 | 常开生产服务、真实跨机产品连接、休眠拓扑 |
| 远程文件 Task | 固定 fs_write、原 operation 去重、结果未知不重发、状态核对、取消后效果/UI 投影的已有用例 | 完整 leaf/parent 固定与更多中断/产品取消分支 |
| CLI | 只读 facade 契约、身份/位置元数据、短期原生能力桥接、租约续期；本阶段新增真实安装协议 | 原生监督器创建竞态、真实推理/账单、完整远程 CLI/PTY/写模式 |
| 迁移 | 两 profile 只读预览、desktop 选定捕获、ledger/数据归档、会话/资金/工作区/保存记忆/能力引用审计、可恢复配置阶段和启动 gate | 完整一致备份、OS 元数据、全 Host 停写、激活和最新数据回退 |
| 浏览器/桌面 | Agent 侧浏览器基础、Windows pipe/租约/撤权及历史双 Windows 合成窗口证据 | 完整 Task 接口、浏览器模式/传输、DPI/多屏/真实 Session 转换/人工停止 |

相关源码集中在 `modules/bot-runtime/`、`packages/orchestration/src/`、`packages/capability-broker/`、`packages/cli-runtime/`、`remote-computer-agent/`、`native/windows-desktop/`。

## 4. 本阶段完成了什么

### 4.1 E58：物理根准入与已验证挂载转换

[E58 证据](evidence/20261030_workspace_admission_mount.json)；[设计](plan/20261029_verified_container_mount.md)。

- 新 `workspace-identity.ts`：通过原生 bigint stat 取 dev/inode/非零 birth generation，生成实际根与有界祖先身份；Linux 持有目录描述符。文件写入造成的目录元数据变化不改变身份。
- 新 `workspace-admission.ts`：复用 Agent SQLite 连接；同事务检查实时授权、原 operation 归属和状态，按真实根/父子关系互斥。同一上层祖先下的独立根不会被全串行化。
- 同 operation 同完整快照幂等；跨 Bot/attempt、变更平台/快照拒绝。容量 4096，达限不删旧锁，原操作重试仍可幂等。
- 终态收据与释放处于一个 SQLite 事务；shell 必须是 JSON 布尔 `true` 的停止/未启动证明，数字 `1`、字符串不算。unknown、cancel_pending、未确认停止不会因时间、授权到期或重启自动释放。
- Agent 接入 fs_write 和 **container profile** shell；普通文件读取不取写锁。旧未知写者没有实际根快照时增加恢复 fence，不猜路径后放行。
- 文件写任务取消前检查与 graceful close 等待已接线。已发布后发生取消仍保留实际 digest 并保守报告效果，未发布取消记录无目标写入。
- 直接把 `/proc/<pid>/fd/<n>` 交给 Docker/runc 实测 EINVAL；采用保留原描述符、create/start 前检查，**可信 PID1 在启动调用程序前核对实际绑定目录**的方案。
- 三个真容器换目录场景通过；container 模式 worktree create/diff/integrate 在原生 Git 执行前拒绝，machine_ping 能力列表也过滤这些入口。

**范围限制：** fs_write 的 leaf/parent rename 还没有完成描述符化；原生 application shell/Git 是所有者兼容能力，未验为隔离的模型 Task 后端；多个不同 dataDir 的 Agent 没有共享全机写锁；工作区 UID/权限和配置世代仍待收口。模型 shell Task 工具没有开放。

### 4.2 E59：Agent Windows Job 原子创建

[E59 证据](evidence/20261030_windows_job_creation.json)；[设计与边界](plan/20261029_windows_job_creation.md)。

- 原 Agent 探针在 150ms 超时场景挂住，留下创建后未加入 Job 的挂起子进程。
- 从已核验 E57 源码取出原实现，设置确定性屏障，证明包装器在 CreateProcess 与 Assign 之间死亡时子进程存活；永久原生套件在两个 Windows 都复现并精确清理该旧失败。
- `ProcessJob.cs` 用 STARTUPINFOEX / JOB_LIST，在 CreateProcess 内原子建立 Job 归属；保留 KILL_ON_JOB_CLOSE 与 CREATE_NO_WINDOW。
- 持有创建者的真实内核进程句柄，创建时间核验后监护其结束；正常退出先唤醒并 join watchdog，再关闭正在等待的句柄。
- 修正 UTF-8 JSON 入参、条件 attribute cleanup、FILETIME 字符串化；测试程序保存为文件。
- Win10/Win11 各 11/11，包括精确参数、退出码、旧失败、包装器死亡、创建前/后/后代运行中的实际父进程死亡。原 Agent 12 项也恢复通过。

**不能外推：** 这是进程收容；Windows 专属账户、AppContainer、文件系统隔离和安装器尚未完成。**CLI 的 native-peer.ps1 是另一份监督器，仍有单独的旧创建顺序**，详见第 7 节。

### 4.3 E60：真实官方 Codex 0.163.0，无推理 MCP

[E60 证据](evidence/20261030_installed_cli_protocol.json)；新脚本 [integration-cli-installed.mjs](../../scripts/integration-cli-installed.mjs)。

- 仅在自有 fixture 目录安装官方 npm 0.163.0，禁 lifecycle scripts、独立 npm 配置/缓存；未替换全局 0.157.1。
- 调用实际 pinCodexExecutable → createCodexSession → native peer → 真实 app-server。三机各 13/13。
- 有效配置仅暴露本 Task 的 dsh_task MCP；实际列出并调用一次只读 marker 能力，拒绝未知能力/伪造参数，正常关闭确认 treeStopped/root process reclaimed。
- 无凭据、无 auth 文件生成、无 session.run / turn/start。`gpt-installed-probe` 是合成配置身份，不是可用模型或真实响应模型证明。
- 两个 provider base URL 都指向本地 403 sink；每机观察到 `GET /plugins/featured`、`GET /v1/responses`，均拒绝。**0 推理不等于 0 HTTP 尝试。**
- 所有者真实 profile 没有提供给探针；未声称做过全 OS 文件读取/网络目的地审计。

| 平台 | 0.163.0 二进制 SHA256 |
| --- | --- |
| Windows x64 | `2692c8c7bb2cf8b0aefe638741fc90236f4b824c59578ce84994f9de58200993` |
| Linux x64 musl | `399ff69c431c066e40de318fba45c2b07f45a76b19939d247ee4828fc70c4215` |

### 4.4 进度语义修正

- W08.5 已有依赖调度代码和两份证据，历史的 planned 校正为 in_progress；没有提前标整包完成。
- W11.2 原标题把契约验证与真实模型/远程执行混在一起，校正为 in_progress，并保留旧证据；本阶段新增范围明确的 W11.3。
- 新增已完成组件 W10.2、W15.3、W11.3。整包、验收场景和 M0 数量未被这些组件夸大。

## 5. 最终验证基准

同一份实现源码：962 文件，冻结 DS 297。实现/测试源快照的归档 SHA256：

`ebf6711067fd421895fed3ed7c781aa5a2d135989be1256280a08802abcc6c4a`

该快照的标签路径仍为 `tmp/integration/stage-final-20261029/`；完成验证和交接日期按客户端时间记为 2026-10-30。快照位于新增 E58–E60、最终交接/台账更新之前；此后只变更文档/台账/归档信息，没有继续改产品代码。

| 验证 | Win11 / Node24.20.0 | Win10 / Node24.18.0 | Ubuntu / Node22.22.1 |
| --- | --- | --- | --- |
| 项目根回归 | 1743：1721 pass / 0 fail / 22 skip | 同左 | 1743：1690 pass / 0 fail / 53 skip |
| workspace 三套原生 | 31：30 pass / 1 Linux-only skip | 同左 | 31/31 |
| Windows Job | 11/11 | 11/11 | 11 项明确跳过 |
| 已安装真实 CLI，无推理 | 13/13 | 13/13 | 13/13 |
| 真实 Linux 容器 | 平台不运行 | 平台不运行 | 29/29，含 7 次真实 Agent 退出 |
| Agent 控制器所有权 | 9/9 | 9/9 | 9/9 |
| 原 Agent / 远程写 Task | 12 / 14 | 12 / 14 | 12 / 14 |
| 迁移套件 | 175/175 | 175/175 | 175/175 |
| 默认真实 rc.3 Host / 语义 Host / 启动 gate | 40 / 8 / 7 | 40 / 8 / 7 | 40 / 8 / 7 |
| 资金探针 | 33 | 33 | 33 |
| 客户端/发布闭包检查 | 通过，client 2061889 bytes | 同左 | 同左 |

普通根回归未启用真容器，因此有容器顶层跳过；专用 Linux 探针才实际执行 29 项。Windows Job 的 Linux 跳过同理。不要把 1743/0 fail 写成 1743 全部实际通过。

本机固定 pnpm10.34.6 `--frozen-lockfile --strict-peer-dependencies` 通过；既有 SDK/native 依赖复用，**不等于产品从空环境干净安装通过**。文档与台账在封账后另跑检查。

## 6. 重要源码和证据地图

| 路径 | 用途 |
| --- | --- |
| `remote-computer-agent/src/workspace-identity.ts` | 可信实际根身份、Linux 目录描述符 |
| `remote-computer-agent/src/workspace-admission.ts` | 实际根/父子互斥、收据触发释放、4096 容量 |
| `remote-computer-agent/src/agent.ts` | 准入接线、旧未知恢复 fence、文件取消/join、container Git 拒绝 |
| `remote-computer-agent/src/container-command.ts` | 原容器持久控制、挂载身份持久化/观察、无重派恢复 |
| `remote-computer-agent/src/container-supervisor.mjs` | 不同 UID 可信 PID1、挂载身份门控、绝对截止 |
| `native/windows-desktop/ProcessJob.cs` | 本阶段修复的 Agent 原生进程 Job 包装器 |
| `packages/cli-runtime/src/native-peer.ps1` | **另一份 CLI Windows 监督器，下一优先项** |
| `scripts/integration-cli-installed.mjs` | 必须提供 entry/hash/version 的无推理探针 |
| `packages/orchestration/src/remote-execution.mjs` | 现有远程固定文件写 Task 后端；取消后摘要投影可继续补产品用例 |
| `packages/orchestration/src/task-journal.mjs` / `task-service.mjs` | DAG、取消/恢复、资金共享准入的既有基础 |
| `packages/orchestration/src/migration-*.mjs` | 捕获/归档/审计/配置阶段；完整激活未开放 |

E58–E60 的 `sourceGitBlobs` 已用逐文件 `git hash-object <file>` 核对；分别 16 / 9 / 6 条，包含复用路径。历史证据里的源 blob 表示当时内容，后续源码变化不抹掉历史记录。

## 7. 必须交给下一位的未完成项

### P0：先收口执行边界

1. **CLI Windows 监督器的创建窗口。** `native-peer.ps1` 仍是 CreateProcess(CREATE_SUSPENDED) 后再 Assign。此处由源码检查识别出与已复现 Agent 失败相同的间隙，本阶段没有对它直接注入死亡屏障。用独立真实 fixture 验证，改为原子 Job-list，并验证 helper/控制者死亡；保留已有 pipe framing、peer owner/tree 校验、停止计数与短期身份。不能因 E59 通过就说这份监督器已修复。
2. **fs_write leaf/parent 固定。** 当前根 admission/目录身份不等于文件父目录和最终 rename 固定；外部所有者写者也不受该 SQLite 锁约束。补描述符路径、目标发布/并发替换与 CAS 语义证据，保护已存在用户数据。
3. **真实工作区权限与世代。** 容器调用程序为 65532；测试只改变自有 fixture 权限。真实 0600 文件的所有权/读写、持久 root/config 世代和预览失效需要设计；不要 chmod/chown 用户项目“让用例通过”。不同 Agent dataDir 的同机根协调也未实现。
4. **完整命令/CLI 写 Task facade。** 保持当前模型写命令门控；application/native 不凭配置声明就算 OS 隔离。当前 container worktree/Git 入口统一拒绝。补齐策略、定位、准入、取消、原操作核对、产物和 UI 后再开放。
5. **文件取消收据的产品细节。** 原始 Agent 新取消分支保留实际效果；RemoteWrite/Task/UI 是否完整投影所有 cancelled 情况的 digest/possiblyApplied，还需针对性端到端用例。现有 14 个写 Task 用例覆盖其已声明路径。

### P1：完整迁移、生产拓扑与实际桌面

- W03.4/W06.3：完整 DS/MR 配置/数据/外部状态、OS ACL/ADS/xattr 等、共享 Host 停写、一致备份、资金权威和位置、完整激活与**激活后新增数据**的可恢复回退。
- 配置阶段是可恢复验证，并未完成完整 activation；`applySupported=false`/`activationSupported=false` 不能偷偷改成 true。
- desktop 的既有私有选定域审计来自 E52；E55 保存记忆/能力引用是 fixture 增量，**没有重新审计实际用户捕获**。不要合并成“真实用户所有域已验”。
- M0 缺 W02.7 实际机器/休眠验证；W09.3 常开生产 Agent、跨机产品连接未验。SSH 访问测试电脑不等于产品已完成真实受保护网络配对。
- 只读电源核对：Win11 测试笔记本有 S3/hibernate；Win10 固件不提供 S3，hibernate 未启用；Ubuntu 是 KVM。**没有执行任何休眠/唤醒或电源配置修改。** 实测窗口需协调，不能拿 mock 断连替代。
- Windows 125%/跨屏/负坐标与变化、锁屏/注销/UAC/RDP、托盘人工暂停停止、实际安装/卸载和账户隔离仍需完成。当前阶段没有新增这些桌面验收。

### P2：剩余产品与发行

- W12 CLI 位置/十二工具回归/真实 PTY；W13 浏览器 persistent profile、refs/script/task、上传下载/内部地址与完整产品入口。
- W14 功能并集、完整 UI、群聊、计划任务、附件/语音/widgets/完整费用卡片等真实工作流。
- W17 隔离/性能/长跑/配额/升级；W18 Desktop/Docker 与运维交付；W19 全量证据审计；W20 发布与匿名下载/干净安装字节核对。
- E53 首次 MR 咨询超时仍是未解释的历史稳定性线索；后续重跑通过没有给出原因修复。
- 真实模型推理、CLI 真账单、后端模型身份和订阅语义仍由用户侧条件支持，不能用合成模型/离线收据销项。

## 8. 复跑入口

以下在工程根执行，保留真实退出码；先确认依赖和 TLS。不要运行带真实推理的脚本来“顺手验一下”。

### 8.1 TLS

旧 `tmp/integration/auth-20261028/tls-shared` 已过期，不再使用。此阶段使用 `tls-container-fresh-20261029`；server 有效期截至 **2026-10-30 12:01:43 UTC**。接手时先检查是否过期。

可在 Windows PowerShell 中为本机测试指定该**合成**夹具：

```powershell
$env:DSH_TEST_TLS_FIXTURE=Join-Path (Get-Location) 'tmp/integration/auth-20261028/tls-container-fresh-20261029'
```

夹具过期/换机器时，用 `tests/helpers/remote-auth-tls.mjs` 的 `createTlsFixture` 在新的自有目录生成，或清除旧环境变量让套件按其默认生成流程处理。临时调用保存成 `.mjs`；不关闭 TLS/mTLS、证书时间或证书验证来绕过失败。源码交接包不包含这些私钥。

### 8.2 根、工作区、Windows 和容器

```powershell
npm test
node --test tests/workspace-identity.native.mjs tests/workspace-admission.native.mjs tests/workspace-agent.native.mjs
node --test tests/windows-process-job.native.mjs
node --test tests/remote-agent-instance.native.mjs
node scripts/integration-remote-agent.mjs
node --test tests/remote-write-tasks.native.mjs
```

仅 Linux、有 Docker 和预加载固定镜像时：

```sh
node scripts/integration-remote-container.mjs
```

镜像必须是现有固定摘要 `node@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d`。探针不拉取替代镜像、不回落本机 shell。Docker daemon/宿主管理员是可信条件。

### 8.3 真实 CLI 无推理

同机安装定位的私有 metadata 在 `tmp/integration/cli-attested-0163-20261029/installation.json`。本机 Win11 的实际二进制在此前独立 `codex-0163-20261029` 前缀，远程两个平台在 `cli-attested-0163-20261029` 前缀；均是自有 fixture，没有全局安装变更。

Windows 示例（按已有 fixture 定位；不要用未核验 PATH 副本）：

```powershell
$entry=(Resolve-Path 'tmp/integration/codex-0163-20261029/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe').Path
node scripts/integration-cli-installed.mjs --entry $entry --sha256 2692c8c7bb2cf8b0aefe638741fc90236f4b824c59578ce84994f9de58200993 --version 0.163.0 --out tmp/integration/step-cli-installed/handoff-smoke
```

Linux 示例：

```sh
node scripts/integration-cli-installed.mjs --entry "$PWD/tmp/integration/cli-attested-0163-20261029/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex" --sha256 399ff69c431c066e40de318fba45c2b07f45a76b19939d247ee4828fc70c4215 --version 0.163.0 --out tmp/integration/step-cli-installed/handoff-smoke
```

换机器时自行在隔离前缀安装固定 `@openai/codex@0.163.0`、禁 lifecycle scripts、空 npm 配置/无用户凭据，并核对版本/hash。普通源码包不包含该平台二进制或 npm cache。

**`scripts/integration-cli-runtime.mjs` 默认会进入推理流程，本阶段没有运行它。** 无推理探针为 `integration-cli-installed.mjs`；不要混用。

### 8.4 迁移、宿主、资金和台账

```powershell
node --test tests/profile-migration-plan.test.mjs tests/migration-snapshot.test.mjs tests/migration-preview-cli.test.mjs tests/migration-ledger-export.test.mjs tests/migration-data-archive.test.mjs tests/migration-session-reader.test.mjs tests/migration-financial-audit.test.mjs tests/migration-domain-audit.test.mjs tests/migration-workspace-audit.test.mjs tests/migration-configuration-commit.test.mjs tests/migration-supporting-domains.test.mjs
node scripts/integration-product-default.mjs
node scripts/integration-migration-audit.mjs
node scripts/integration-migration-gate.mjs
node scripts/integration-finance-probe.mjs
node scripts/integration-product-client.mjs --check
node scripts/build-client.mjs --check
npm run integration:check
node --test tests/integration-documents.test.mjs tests/integration-progress.test.mjs
node scripts/integration-progress.mjs report
```

保存 STATUS.txt 用最后一条的真实输出生成，不手工伪造状态。

固定依赖检查的本机命令：

```powershell
$env:COREPACK_HOME=Join-Path (Get-Location) 'tmp/integration/pnpm-cache-20261029'
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT='0'
pnpm install --frozen-lockfile --strict-peer-dependencies
```

系统 Corepack cache 曾不可写，本阶段使用自有 cache；不要修改全局设置或升级 SDK。

## 9. 所有包与场景当前状态

| 包 | 状态 | 主要缺口 |
| --- | --- | --- |
| W01 功能清单 | in_progress | 冻结/证据/依赖门禁完整验收 |
| W02 兼容验证 | in_progress | W02.7 真实拓扑与休眠 |
| W03 DS Bot 迁入 | in_progress | W03.4 完整迁移/旧安装升级 |
| W04 MR 兼容入口 | in_progress | 完整兼容行为验收 |
| W05 Bot/模型策略 | in_progress | 实际模型和全部策略场景 |
| W06 事务/迁移 | in_progress | W06.3 完整生产迁移与回退 |
| W07 Planner | in_progress | 真实 Planner/全部派发场景 |
| W08 调度/取消/恢复 | in_progress | 全执行类型与真实场景 |
| W09 远程配对 | in_progress | 常开生产连接/拓扑 |
| W10 Linux 命令/文件 | in_progress | leaf 固定/权限/完整命令 Task |
| W11 CLI 桥接 | in_progress | 真实推理/完整位置；原生监督器创建窗口 |
| W12 CLI 执行 | planned | 十二工具/远程 CLI/PTY |
| W13 浏览器 | planned | 完整产品接口与各模式 |
| W14 功能并集/UI | planned | 真实完整 UI/交互/费用工作流 |
| W15 Windows helper | in_progress | 全实机矩阵/安装器/账户边界 |
| W16 DPI/会话/互斥 | in_progress | 125%/跨屏/真实 Session/人工控制 |
| W17 隔离/性能/升级 | planned | 完整施工与实际验收 |
| W18 发行载体/运维 | planned | 完整施工与实际验收 |
| W19 全量验收 | planned | 63 场景与声明证据审计 |
| W20 发布 | planned | 发布、匿名下载和干净安装 |

仍未跑的十个场景：T30 登录/锁屏/注销/UAC/RDP、T35 远程 CLI 位置、T36 十二工具完整回归、T37 真实 PTY/多会话、T42 worktree 条件合入、T43 群聊授权、T50 干净安装/升级、T52 发布字节、T54 性能/长跑、T58 预览发行合同。

精确定义看 [验收目录](plan/20261026_requirements_acceptance.md)。其历史 T56/T62 的 GPT-only 文句已被用户最新 AGENTS 的研发调度授权覆盖，覆盖说明记录在当前台账；冻结来源原文保留。

## 10. 研发分工与实际通道

用户最新 AGENTS：GPT 拆分调度；适合的工作优先 Step Plan，不人为设预算上限；GLM 次之；Kimi 优先 opencodego Go，确认套餐/速率限额后才转 Kimi Plan，其他故障不能冒充额度耗尽。工具型执行走 `model_pool/scripts/agent_run.py`，workdir 不是沙箱，必须逐任务限定读写路径和动作。

本阶段实际使用 StepCode / Step Plan，启动参数 `step-5-preview`。5 次工具代理启动中：

- 准入组件初版完成，14 项原生检查。
- 定向耦合修复完成：四个修复前失败、修复后 18/18；父会话按报告接线，针对性核验必要安全耦合。
- Windows 草稿因 StepCode 命令分析/非交互审批阻挡结束，产物保留；GPT 接手完成原子创建、watchdog 清理、UTF-8和 11 项真实测试。
- CLI 首次因复合命令解析阻挡结束；只用直接文件工具与固定命令的重试成功，真实协议 13/13。

执行器拒绝原因是 shell 命令无法完整分析、非交互审批不可用，**不是套餐额度耗尽**。开发调用非零；产品 0 推理是另一统计口径，不能混报。历史 Step 文本审阅 3 次 length 空正文、GLM 一次 read-timeout 没有可用交付，也没有被当作实现。

没有执行模型池/技能文件修改与同步；没有截图触发外部委派、自动发布或凭空赋予产品 Bot 外部 agent 权限。

## 11. 私有材料与可迁移源码包

以下是同机 ignored 材料，**不进入源码交接包、GitHub 或 npm**：

- `tmp/integration/auth-20261028/`：远程 helper、平台报告、运行日志、源码快照、合成 TLS、私有定位信息。不得整目录公开。
- `tmp/integration/step-workspace-admission/`：初版/followup 报告、失败见证和日志。
- `tmp/integration/step-windows-job/`：中断草稿/日志；未作为完成报告。未用草稿已转存私有目录。
- `tmp/integration/step-cli-installed/`：报告、隔离 home、native 诊断、summary；只公开净化后的证据。
- `tmp/integration/stage-final-current-20261029/` 与 `auth-20261028/stage-final-results-*/`：三机最终日志/报告。
- `tmp/integration/cli-attested-0163-20261029/`、`codex-0163-20261029/`：隔离 CLI 安装/缓存。
- 实际用户 desktop 捕获/审计/资金和其他私有数据仍在先前授权位置；可由同机的 `desktop-domain-audit.json` 私有映射定位，不要把其完整内容输出到模型或资料包。

交接源码包保存全部 non-ignored 工作树源码和额外的冻结 vendor297，附 manifest/README/校验。**不包含 .git、node_modules、用户数据、凭据、合成 TLS 私钥或上述私有 tmp。** 它支持迁移源码字节，Git 历史/平台依赖/私有数据需分别保全；不要拿源码归档冒充完整生产数据备份。

若转移到另一台机器：优先 clone 精确基线/现有仓库并保留历史，再覆盖交接源码；确保所有未跟踪源和 vendor 一起恢复，然后按锁文件安装依赖。现有 checkout 直接保全复用即可，不必重建工作树。

## 12. 已知机械坑与验收纪律

1. CLI 两份 Windows Job 实现分开；当前 Agent 修复不能覆盖 native-peer.ps1。
2. 挂起子进程可能读不到 MainModule；清理用已知 fixture 的内核句柄+精确创建 FILETIME，不按进程名清理。
3. FILETIME 超过 JS 安全整数范围，序列化字符串。
4. 等待中的内核句柄不能被另一线程直接关闭；先关闭等待流程并 join。
5. PowerShell 5 的 npm notice stderr 曾被当 NativeCommandError，中断了安装后描述步骤；包已装完后重新核验 hash/version，未借机升级 npm。
6. exec 返回 session_id 代表仍在运行，应等待完成。此次曾误判导致 Win10 辅助脚本少传，已补齐；首次失败发生在测试开始之前。
7. 临时 matrix topic 全局替换曾误改测试文件名，已修正；保留已过的前缀记录，从实际未跑步骤续跑。最终整根回归是完整执行。
8. 老 TLS 夹具过期只更换合成证书，不禁用校验。
9. container image 固定摘要、不同 UID 监督器和绝对 deadline 不因方便调试放松；观察只核对原 worker，不 create/start 替代品。
10. 主 Task journal 版本5、资金激活 marker4、Agent 自有表是不同概念；不要一起盲升版本。
11. legacy 全局预算0可表示无限额；Bot 预算0表示禁止费用。未知费用保持 null，不改成0。
12. 真用户迁移必须保留激活后的新任务/新费用，不能拿旧副本覆盖“回退”。

## 13. 下一次施工与销项建议

先选第 7 节一个 P0，写清具体设计/授权范围/失败见证和实际验收，再施工。无需重写已交付的 DAG、物理根准入或真实 CLI 无推理探针。

每完成组件：代码与必要验证 → 真实相对路径新证据及逐项 hash-object → tasks/audit → PROGRESS/EXECUTION/HANDOFF → 生成 STATUS → integration:check/文档检查 → 归档/读回/通知。未验部分明确保留；不因测试多就关闭整包。

需要付费产品模型或真实物理/安装条件的场景保留待办，不能借开发通道伪造；已有授权不要重复询问，但新的实际影响范围须做成可审核结果。

## 14. 交接停止点

本阶段实现与三机验证已完成，E58–E60 入库；最终文档/台账检查与归档记录见 PROGRESS 和随包 README。没有新开后续施工，没有留编码子代理继续改源，没有发布。

给下一位的简短任务入口：[HANDOFF-PROMPT-20261030.md](HANDOFF-PROMPT-20261030.md)。
