# DSH Bot 一体化工程详细交接（E77，2026-10-31）

> **交接点：E77 combined-host 容器命令端到端场景已完成组件验证。默认产品 AgentLoop 可提交获准的容器命令；Win11 非容器 never-started、Ubuntu 真 Docker 成功，最终本机根回归 1853 项 0 失败。完整工程、产品整包验收和发行仍未完成。**
>
> 本文接续 [GLM E67–E76 交接](HANDOFF-20261031-GLM.md)与 [KIMI E65–E66 交接](HANDOFF-20261030-KIMI.md)。旧交接中的数字和任务顺序只代表各自时点；本文件是当前接力入口。

## 1. 工程位置与工作树保护

| 项目 | 当前事实 |
|---|---|
| 工程根目录 | `F:\everyAI\dsh-model-router-all\dsh-model-router` |
| 分支 / HEAD | `feat/bot-integration` / `89e831264ebc7dacacdd54234377e51f37fb0785` |
| 工作树 | 大量未提交、未跟踪文件和被忽略的冻结 vendor 是工程主体，不能只用 HEAD 或 `git diff` 接力 |
| 当前组件 | E77 默认产品容器命令场景与授权编译修复 |
| 整体状态 | **0/20 整包、1/63 场景 passed、M0 11/12** |
| 发布状态 | 未 stage、commit、push、tag、GitHub Release 或 npm 发布 |

禁止 `reset`、`clean`、`stash`、只恢复 HEAD 或用远端文件覆盖工作树。冻结 DS vendor 与 SDK 未改，DS 基线仍为 `de55888a93983fc51c94f7d22bc94b4f8293205d`。`tasks.json`/`behavior-audit.json` 保持 CRLF+两空格，`package.json` 保持 LF。

建议阅读顺序：本文 → [E77 证据](evidence/20261031_command_combined_host.json) → [E76 注册证据](evidence/20261031_command_product_registration.json) → [tasks.json](tasks.json) / [STATUS.txt](STATUS.txt) → [PROGRESS.md](PROGRESS.md)。

## 2. E77 实际改动

### 2.1 授权编译修复

E76 已把 `createRemoteCommandBackend` 加入 composition，但首次真实 AgentLoop 提交仍被 `TOOL_DENIED` 拒绝。根因是 `grantFor` 没有把 `remote/container_command_v1` 编译进 Bot 授权。

现在只有在以下三个条件同时成立时才加入该能力：

- `scope.mode === 'workspace-write'`；
- 授权含 `operation_status`；
- 授权含 `operation_cancel`。

没有放宽任何授权，也没有给命令添加原生 shell 或回退路径。

### 2.2 默认产品端到端场景

`scripts/integration-product-default.mjs` 现在：

- 期望 `mr-api`、`codex-read`、`remote-write`、`remote-command` 四个后端全部存在；
- 通过真实 AgentLoop 调用 `bot_task_start`，不是直接调用 backend 的离线替身；
- Ubuntu 且 `DSH_TEST_DOCKER=1` 时，在自有 fixture 上配置固定容器镜像和 `/usr/local/bin/node` 别名，验证真实 Docker；
- 其他平台使用普通 Agent，验证 never-started 和无原生回退；
- 按公开任务投影 `result.code` / `result.remote` 断言，而不是误读 journal 内部 summary。

`tests/fixtures/integration-combined/mock-plugin.mjs` 新增 `integration:remote-command:<machineId>` 标记，固定请求：

```text
backend=remote-command
argv=['node','-e','process.stdout.write("command-ok")']
timeoutMs=20000
```

### 2.3 文件身份

| 文件 | 最终 Git blob |
|---|---|
| `packages/orchestration/src/product-composition.mjs` | `4f525a2fac16fcca3fc1ee78c91fb9e1470b1cb3` |
| `scripts/integration-product-default.mjs` | `133281d5ad017dd604d36c846a87fa1510f66afe` |
| `tests/fixtures/integration-combined/mock-plugin.mjs` | `9af585ec6161adc8e97a6e6e9a62d6be949ec47a` |
| `docs/integration/plan/20261031_command_combined_host.md` | `b1432bf3e9e86e94dde667d4f4436d29485d31a1` |

Ubuntu 完整源码包含 1032 个文件（冻结 DS 297），包 SHA-256：

`a0fc738b462d2c668504c1a43c1fe3707c8e7f4e701afb955c9a4b414c7e4f32`

## 3. 必须保持的安全不变量

1. 命令只接受 owner 批准的 argv 别名，不接收 endpoint、credential、任意路径或 shell 字符串。
2. 命令仅在绑定容器内执行，绝不原生回退；非容器 Agent 必须落 never-started 终态而不是悬挂 admitted operation。
3. 后端注册不等于能力授予：真实 Bot 的 write/status/cancel 授权必须同时存在才能编译 `remote/container_command_v1`。
4. 停止证据来自原操作收据/监督者，终态本身不是停止证明；取消不是回滚，效果保守保留。
5. never-started 才能 `possiblyApplied:false`；真实命令成功的效果保持 `possiblyApplied:true`。
6. 原 operation 是幂等/对账边界，重复提交不能创建第二次真实执行。
7. 更宽的模型面命令开放仍是产品决策，不因本场景通过而默认开放。
8. `HANDLE_LIST` 继续为 **0x00020002**；`0x20001` 是两台真机实测拒绝的保留号，不得改回。
9. 产品验证保持 0 真实模型推理；`scripts/integration-cli-runtime.mjs` 默认会进入推理，禁止顺手运行。

## 4. 实际验证结果

### 4.1 默认产品宿主

| 平台 | Node / 后端 | 结果 |
|---|---|---|
| 本机 Win11 | v24.20.0 / 普通 Agent | **42 项检查通过**：never-started、`possiblyApplied:false`、`stopConfirmed:true`、无 workspace 锁 |
| Ubuntu | v22.22.1 / 固定镜像真实 Docker | **42 项检查通过**：批准 alias 执行一次、exitCode 0、`stopConfirmed:true`、原 operation 仅一次 |

这些检查包含此前的 MR、Task、资金、调度、机器配对、文件写、冷恢复等全部路径，新增命令场景没有牺牲旧行为。

Ubuntu 原始日志 SHA-256：

`956f84940007d0f0de2410ddd2069a0e73b77fe5adf463526908adbe8526880d`

### 4.2 完整验证

| 验证 | 结果 |
|---|---|
| 最终 `npm test` | **1853 项：1785 通过、0 失败、68 跳过** |
| `npm run check:client` | `[build-client] OK` |
| `npm run integration:check` | 32R/40F/63T/20W 有效 |
| 文档四件套 | **26/26** |
| 冻结 DS 源检查 | 297 文件匹配 |
| 迁移配置专项 | 初次 Windows EPERM 后，专项 **12/12**；最终全量 0 失败 |

跳过项没有计为通过。远程复用了既有隔离依赖，**不是干净安装或生产部署证明**。

## 5. 失败、修复与环境记录

1. **首次真实提交失败**：后端已注册但授权缺失，出现 `TOOL_DENIED`。已修复 grant compiler，未绕过授权。
2. **断言层级错误**：早期探针误读 `result.summary`，已改为公开 `result.code` / `result.remote`，未改变任务合同。
3. **远程精简 fixture 缺文件**：先后缺少 `integration-upstream-tests`、`integration-combined-host`、`task-executors`、`official-tool-executor` 等，测试在产品执行前中止。改为新的完整源码目录，并链接既有隔离依赖，未用 prepare 覆盖旧 fixture。
4. **依赖链接修正**：`@deepseek-ai/dsh` 位于既有 `tests/fixtures/integration-host/node_modules`，补齐该链接后真实宿主才能启动。
5. **一次 Windows EPERM rename**：完整根回归中 `migration-configuration-commit` 出现一次性权限错误；专项随后 12/12，最终全量 0 失败。原始失败没有被改写成一次通过。

## 6. 台账同步状态

- [tasks.json](tasks.json)：W09.9 已改为“产品注册与 combined-host 端到端场景”，挂 E76/E77；T14 增加 E77，仍为 partial。
- [behavior-audit.json](behavior-audit.json)：新增 E77；当前为 **77 条 partial entry observations**，并补齐 E67–E77 顶层证据索引，不是 77 个产品通过场景。
- [PROGRESS.md](PROGRESS.md) / [EXECUTION-20261027.md](EXECUTION-20261027.md)：已记录 E77 与失败历史。
- [STATUS.txt](STATUS.txt)：由 `node scripts/integration-progress.mjs report` 真实再生成。
- 整包、验收场景和 M0 门禁没有提升：仍 **0/20、1/63、M0 11/12、G1–G4 全 in_progress**。

## 7. 剩余边界与建议顺序

1. **停写栅栏切片 5**：整合写者清点、共享/独占栅栏、最新回退诊断与既有配置事务/归档，形成可恢复提交编排。`activationSupported` 和 `postActivationRollbackSupported` 继续保持 false，直到实际门控完成。
2. **切片 4 OS 隔离适配器**：需要专用账户/设备及真实旧入口，验证旧进程停写、写句柄、自动重启拦截和 coordinator 死亡，不能用协议参与方声明代替。
3. **Windows 命令面**：当前只有 never-started 证明；Windows 原生 Job/受限令牌命令后端需要独立设计和实测，不能宣称已有 OS 隔离。
4. 继续完整迁移/OS 元数据/激活后新增数据回退、生产常开与受保护网络、真实休眠、DPI/Session/UAC/RDP、安装升级、PTY 和性能矩阵。
5. 最后才是 W19 全量证据审计与 W20 发布。历史“全部完成后上传 GitHub/npm”授权持续有效，但当前前提远未达到。

## 8. 复跑入口与远程通道

```powershell
node scripts/integration-product-default.mjs
npm test
npm run check:client
npm run integration:check
node --test tests/integration-progress.test.mjs tests/integration-documents.test.mjs tests/integration-inventory.test.mjs tests/product-client-build.test.mjs
node scripts/integration-progress.mjs report
```

Ubuntu 真容器：

```sh
DSH_TEST_DOCKER=1 node scripts/integration-product-default.mjs
```

远程通道（凭据不进入公开文档）：

- Ubuntu：`10.0.0.1`，使用 Alice_marx_workshop `remote_control/scripts/ssh_run.py`、`ssh_upload.py`；大文件走 SFTP。
- Win10：`10.0.0.2`，用户 `cad`，使用既有 SSH/SFTP 通道。
- 远程源码运行前先校验 Git blob/SHA-256，复用既有隔离依赖，不 prepare 覆盖旧 fixture，不把复用依赖写成干净安装。

真实安装 CLI 的无推理核验只能使用 `integration-cli-installed.mjs`；**不要运行默认进入推理的 `integration-cli-runtime.mjs`。**

## 9. 定时工具、私有材料与停止点

- 应用户要求已安装全局 OpenCode `CronList` / `CronDelete` 插件，位置：`C:\Users\Jianw\.config\opencode\plugins\cron`。它支持 ZCode `automation-*` 与 OpenCode `sch_*` 两类 ID，并启用 `experimental.schedules`。
- 交接中的旧 `automation-eb4fee9b-b022-4f3d-9fc2-ea2f6aeaa482` 在当前 ZCode 任务库中已不存在；没有对它执行成功删除，也没有新建定时任务。当前没有双线施工。
- 远程日志、TLS 私钥、CLI 隔离安装、凭据和私有 metadata 不进入公开交接。desktop 仍为用户选择，web 延后，旧 MR 手动移除不得自动恢复；未写真实 profile。
- 本阶段 0 真实模型推理、0 真实账单，未提交/推送/发布。归档到 Obsidian 时应与本文件逐字节一致，不包含完整工作树或凭据。

**交接结论：E77 已有真实组件证据，E76 的 combined-host 缺口和授权编译问题已闭合。完整 DSH Bot 一体化工程仍未完成；下一项按 §7 顺序实施验证，不能把组件通过或本机根回归通过写成产品整体验收。**
