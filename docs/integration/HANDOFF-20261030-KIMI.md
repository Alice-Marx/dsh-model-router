# DSH Bot 一体化工程详细交接（E65–E66，2026-10-30）

> **当前交接点：E65 stop-proof 自动回归注册与 E66 发布前取消效果分类已完成组件验证；完整工程、产品验收和发行仍未完成。**
>
> 本文接续 [API GPT E64 交接](HANDOFF-20261030-APIGPT.md)。E58–E64 的实现和历史证据保持原样；旧交接中的根测试数字、待办顺序和停止状态只代表各自时点。用户在阅读 E64 后明确选择“授权恢复施工”，本阶段因此只处理 E64 建议的前两项，没有开始 parent/leaf 新实现或发布。

## 1. 工程位置、权威顺序与工作树保护

| 项目 | 当前事实 |
|---|---|
| 工程根目录 | `F:\everyAI\dsh-model-router-all\dsh-model-router` |
| 分支 | `feat/bot-integration` |
| HEAD | `89e831264ebc7dacacdd54234377e51f37fb0785` |
| 工程主体 | 大量未提交、未跟踪文件及被忽略的冻结 vendor；不能只用 HEAD 或 `git diff` 交接 |
| 当前组件检查点 | E65 自动回归注册、E66 取消效果分类 |
| 整体状态 | **0/20 整包完成；1/63 场景 passed；M0 子步骤 11/12** |
| 发布状态 | 未 stage、commit、push、tag、GitHub Release 或 npm 发布 |

建议阅读顺序：本文 → [E66 证据](evidence/20261030_write_cancel_effects.json) → [E65 证据](evidence/20261030_stop_proof_regression.json) → [E64 证据](evidence/20261030_bound_stop_proof.json) → [tasks.json](tasks.json) / [STATUS.txt](STATUS.txt) → [PROGRESS.md](PROGRESS.md) / [EXECUTION-20261027.md](EXECUTION-20261027.md)。

禁止 `reset`、`clean`、`stash`、只恢复 HEAD 或用远端文件覆盖工作树。冻结 DS vendor 与 SDK 未改；DS 基线仍为 `de55888a93983fc51c94f7d22bc94b4f8293205d`，MR 来源基线仍为 `de82df4e737954ba0458d597ea82f9a6666c1a9b`。

## 2. 本阶段实际改动

### 2.1 E65：让 E64 stop-proof 进入常态回归

[E65 设计](plan/20261030_stop_proof_regression.md)只处理测试入口和高负载 fixture 等待，不改变 Task、CLI、Agent 或 UI 语义：

- `package.json`：把既有 `tests/task-retry-stop-evidence.native.mjs` 的 11 项检查加入 `npm test`。
- `.github/workflows/ci.yml`：在 Windows/Ubuntu CI 直接运行该文件；删除重复的无条件 CLI native-peer 步骤，保留 Windows 专用 Job/probe 步骤。
- `tests/cli-native-peer-job.native.mjs`：仅将 `waitControl` 的 fixture 等待从原生默认 15 秒提高到 45 秒。没有改产品断言、进程收容或停止证据。

| 文件 | 最终 Git blob |
|---|---|
| `package.json` | `cd5d209bd997ca6cec263b9f5b914b2e33145455` |
| `.github/workflows/ci.yml` | `1969f75a14dee829f007cde56ed351932db0a65c` |
| `docs/integration/plan/20261030_stop_proof_regression.md` | `e4d6e80233fd51285873fdb5fe34219807013ee5` |
| `tests/task-retry-stop-evidence.native.mjs` | `7352998d606fbeef2f2439ee405075e12d43ef93` |
| `tests/cli-native-peer-job.native.mjs` | `873e79db8b7c3145b9905c851ff9d3b471e83270` |

### 2.2 E66：区分“发布前取消”与“已经发布”

[E66 设计](plan/20261030_write_cancel_effects.md)修复 E64 根回归暴露的确定性分类错误：

- `Agent.write` 的三个 `WRITE_CANCELLED` 抛出点都位于目标 `rename` 前，现在显式携带内部 `possiblyApplied:false`。
- 异常汇总只接受“`WRITE_CANCELLED` 且明确分类为发布前”的 false；其他失败、未知结果和未分类异常继续保守为 true。
- 真实 `rename` 后的取消分支不变：状态可为 cancelled，但 `possiblyApplied:true`，并保留实际写入的 sha256/size。
- E64 独立 `agent-stop-receipt` 的生成顺序、字段和 Host provenance 不变。
- Host 新增合同检查：有效独立停止收据可以投影 false；同样的裸 false 没有有效收据时仍为 unknown 且 `possiblyApplied:true`。

| 文件 | 最终 Git blob |
|---|---|
| `remote-computer-agent/src/agent.ts` | `31d5a70c860b40812bfae4dd9687bf77855da1c2` |
| `tests/workspace-agent.native.mjs` | `96851b3e3e5bc0e7fa4ccc90083189d0c64e7d14` |
| `tests/task-retry-stop-evidence.native.mjs` | `8b16403910899dcd52890e8bfce182b18b77218b` |
| `docs/integration/plan/20261030_write_cancel_effects.md` | `29ab50ed80f4e6b0864134fc4385530a4414b8a4` |

新增两个 Agent 确定性屏障，加上原有用例形成三组对照：

1. **进入原始 write 前取消**：没有目标读取、临时文件或 rename，结果 false。
2. **最终发布前读取时取消**：临时文件已经产生，但最终检查尚未通过、rename 未执行，结果 false，清理完成后释放锁。
3. **真实 write 已返回、结果尚未 settle 时取消**：目标已经发布，结果 true，内容与 digest 保留。

三组均验证独立停止收据。收据的 `receiptHash` 必须等于 `sha(canonical(operation))`，重复 `operation_status` 和 settled `operation_cancel` 返回同一证明。

## 3. 必须保持的安全不变量

1. **停止不等于回滚。** `stopConfirmed:true` 只表示原写入链和 cleanup 已 settle，不能据此删除已发布内容。
2. **无目标效果不等于未启动。** 发布前取消可以已经 admitted/running，也可以已有临时文件；false 仅指本 Agent 未执行目标发布。
3. **false 不能自证。** Host 只有核验独立 `agent-stop-receipt` 的 machine/task/attempt/operation/tool/status/canonical hash 后，才接受 `possiblyApplied:false`。
4. **保守默认不变。** 普通失败、外部写者不确定、rename 后取消、未知结果和任何未显式分类的新异常都保持 true。
5. **锁释放顺序不变。** 取消请求本身不释放 workspace admission；原写入和 cleanup settle、终态落盘后才释放。E64 停止收据仍在 terminal operation 之后写入。
6. **历史记录不回填。** 新分类只影响新 operation；旧成功/失败收据不会因升级自动获得停止证明或被改写。
7. **不扩大边界。** 该修复不提供外部写者 CAS、parent/leaf 固定、文件系统隔离、签名防失陷 Agent 或跨版本协调。

## 4. 实际验证结果

### 4.1 三平台联合专项

每个平台运行 workspace-agent 8 项加 E64 六套 59 项，合计 **67/67，0 失败、0 跳过**：

| 平台 | Node | 结果 | 范围 |
|---|---|---|---|
| 本机 Win11 | v24.20.0 | 67/67 | 当前工作树 |
| Win10 | v24.18.0 | 67/67 | 在既有 E64 `refresh-ui-20261030a` fixture 上只覆盖三个源文件 |
| Ubuntu | v22.22.1 | 67/67 | 同上 |

远程修正包只含 `agent.ts`、`workspace-agent.native.mjs` 和 `task-retry-stop-evidence.native.mjs`，SHA-256：

`27b0f4fba939a8939a7235a13d2292574d8c5385796ab67684a7a6edd2daadd0`

原始日志 SHA-256：

- Win10：`b4c29af8a3d14fe822bafd0ed266f37985cb50a1e77f2d1ab4e9bb12ae40adc8`
- Ubuntu：`37037f1a43c4b32d6eb388500c9e9e0a0539b5b4cd7f4d37d4cb91d4b7987f22`

远程复用了已验证 fixture 和依赖，没有 prepare 覆盖、替换依赖或声称干净安装。**远程没有在本阶段复跑完整根回归。**

### 4.2 本机完整根回归与补充检查

| 验证 | 结果 |
|---|---|
| 最终 `npm test` | **1776 项：1754 通过、0 失败、22 跳过** |
| E64 六套 stop-proof 联合 | 59/59 |
| CLI native-peer + capability probe | 13/13 |
| 原 Agent 探针 | 12/12，0 真实模型调用 |
| private roots + workspace identity/admission | 33 项：32 通过、1 个 Linux-only 跳过 |
| CI/package closure | 6/6 |
| 文档/清单/进度/client-build 四文件检查 | 26/26 |
| `npm run integration:check` | 32R/40F/63T/20W 有效 |
| `npm run check:client` | `[build-client] OK` |
| 冻结 DS 源检查 | 297 文件，冻结提交匹配 |

平台跳过没有写成实际通过。根回归覆盖 Linux-only 跳过和既有 Windows 跳过，但不等于真实容器、真实桌面或生产部署验收。

### 4.3 失败历史未被擦除

1. E64 根回归为 1763 项、1740 通过、1 失败、22 跳过；失败是 workspace-agent 的 `possiblyApplied` 分类。
2. E65 注册后的根回归为 1774 项、1749 通过、3 失败、22 跳过：原 workspace 失败仍在，另有两个 CLI 控制帧等待在高负载下超过 15 秒。
3. 仅提高 fixture 有界等待后，CLI 专项 13/13；随后 E66 修复真实分类根因并增加两个对照用例，最终根总数为 1776、0 失败。
4. 没有把首次失败改记为通过，也没有通过修改原断言、跳过测试或把 `possiblyApplied` 全部改成 false 来制造绿色结果。

## 5. 台账与文档同步

- [tasks.json](tasks.json)：E65/E66 已挂入 W08、W09 及相应子步骤；E65 也挂入 W11。T11、T12、T13、T33、T53 的说明更新为当前结果，场景仍全部保持原状态。
- [behavior-audit.json](behavior-audit.json)：新增 E65、E66，现共 **66 条 partial entry observations**，不是 66 个产品通过场景。
- [PROGRESS.md](PROGRESS.md) 与 [EXECUTION-20261027.md](EXECUTION-20261027.md)：分别记录自动注册、取消效果分类、失败历史和剩余边界。
- [STATUS.txt](STATUS.txt)：由 `node scripts/integration-progress.mjs report` 真实生成，计数没有人为改写。
- `tasks.json`、`behavior-audit.json` 保持 CRLF 和两空格；`package.json` 保持 LF，已做字节级换行检查。

整体仍为：**0/20 整包、1 passed / 52 partial / 10 not_run、M0 11/12，G1–G4 全 in_progress**。没有新增整包 completed 或产品场景 passed。

## 6. 仍需下一负责人处理的技术边界

### 6.1 文件写入与工作区

- parent/leaf 描述符固定、外部所有者 CAS、根/中间目录替换、真实权限和持久 root/config generation 仍未完成。
- E64 交接记录的 Linux 新建文件 `pinned-write` 草稿首测 **27 项中 24 通过、3 失败**，尚未接入产品；后续先复核硬链接计数和 symlink 错误码，不得把它当作已通过实现。
- 不同 Agent dataDir 的同机协调、已有文件元数据保持、容器 UID65532 实际访问和 Windows ACL/ADS/reparse 语义仍是独立工作。

### 6.2 CLI 原生监督器的已知未收口项

对 E61 `native-peer.ps1` 的独立静态复核没有发现原子 Job/creator watchdog 的阻断问题，但以下未被 E65–E66 修改或验收：

- 子进程不读 stdin 时，同步 `StreamWriter.WriteLine` 可能在管道写满后阻塞 deadline/EOF；写入与自然退出竞态也可能丢失优雅 `stopped` 帧。需要异步有界写入和真实不读取 fixture。
- `SafeFileHandle` 在 `FileStream` 构造异常路径上有原始句柄与 safe handle 的双重关闭边界；应先完成所有权转移再构造。
- `bInheritHandles=true` 未使用 `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`，所以控制帧隔离只针对普通 stdout，不是恶意同用户进程边界。
- legacy fixture 在 gate 无法解析的失败路径需要加强精确 PID/FILETIME 回收；helper 的 preCreate 强杀也没有对称三阶段覆盖。

这些是后续硬化事项，不影响本阶段已验证的 Job 原子入组结论，也不能被描述为已经完成 OS 沙箱。

### 6.3 其余完整工程

- 完整命令/CLI 写/浏览器/桌面 Task facade、真实 PTY、远程 CLI 位置和十二工具矩阵未开放完成。
- 完整迁移仍有全域/OS 元数据、跨 Host 停写、一致备份、activation 和激活后新增数据回退；`applySupported=false` / `activationSupported=false` 不得擅自改真。
- 常开生产 Agent、受保护跨机网络、真实休眠、DPI/Session/UAC/RDP、人工托盘控制、安装升级、性能长跑与发行验收未完成。
- E53 首次 MR 咨询超时仍无根因解释；更早真实 CLI turn 的未知 usage/请求数也不能被本阶段 0 调用冲销。

## 7. 建议的下一顺序

1. 先复核 `pinned-write.ts` 及 `tests/pinned-write.native.mjs` 的三个真实失败，限定为“不覆盖的新文件创建”范围，保留外部写者 CAS 和已有文件覆盖的禁用边界。
2. 再处理真实工作区权限、root/config generation 和预览失效；不得 chmod/chown 用户项目来让测试通过。
3. 在路径和权限边界稳定后，继续完整命令/CLI 写 facade，保持当前模型 shell 门控，不能凭 application/native 配置声明接受 OS 隔离。
4. 继续完整迁移/停写/activation 后最新数据回退、生产拓扑与休眠、浏览器/桌面/PTY/UI 和安装矩阵。
5. 最后才执行 W19 全量证据审计与 W20 发布。用户已有的“全部完成后上传 GitHub/npm”授权持续有效，但当前前提远未达到。

## 8. 复跑入口

```powershell
node --test tests/task-retry-stop-evidence.native.mjs tests/cli-execution.native.mjs tests/operation-cancel-evidence.native.mjs tests/remote-write-tasks.native.mjs tests/bot-runtime-ui.test.mjs tests/product-refresh-order.test.mjs
node --test tests/workspace-agent.native.mjs
node --test tests/cli-native-peer-job.native.mjs tests/cli-native-peer-probe.native.mjs
node scripts/integration-remote-agent.mjs
node --test tests/remote-private-roots.native.mjs tests/workspace-identity.native.mjs tests/workspace-admission.native.mjs
npm test
npm run check:client
npm run integration:check
node --test tests/integration-progress.test.mjs tests/integration-documents.test.mjs tests/integration-inventory.test.mjs tests/product-client-build.test.mjs
node scripts/integration-progress.mjs report
```

真实安装 CLI 的无推理验证仍只能使用 `scripts/integration-cli-installed.mjs`；**`integration-cli-runtime.mjs` 默认会进入推理，不得顺手运行。** 本阶段没有执行真实模型推理、真实账单或用户 profile 写入。

## 9. 私有材料、归档与停止点

- 远程 fixture、日志、TLS 私钥、CLI 隔离安装及私有 metadata 只保留在已授权的隔离目录；公开证据只记录计数、Git blob、包/日志摘要和相对路径。
- desktop 仍是用户选定迁移对象，web 延后；用户手动移除旧 MR 的状态不得自动恢复。未读取或改写真实 desktop profile。
- 本阶段所有编码探索子代理均已结束，没有后台编码代理继续施工。没有提交、推送或发布。
- 本文归档到 Obsidian 后应与工程内文件逐字节一致；归档副本不包含凭据、私有 profile、完整工作树或发布声明。

**交接结论：E65/E66 的组件目标已有实际证据，本机根回归恢复 0 失败；完整 DSH Bot 一体化工程仍未完成。下一项必须按上述边界另行实施和验证，不能把组件通过或根回归通过写成产品验收。**
