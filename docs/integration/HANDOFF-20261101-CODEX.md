# DSH Bot 一体化工程：Codex 完整交接（2026-11-01）

> **交接目的**：后续工作转交 Codex。本文如实区分已完成、未完成、未验证、明确跳过以及做砸/反复返工的事项。
>
> **当前不要上传**：用户已明确要求暂时停止 `git push`、新 tag、`npm publish` 和 GitHub Release。先读完全文，再决定本地修改。不要重置、清理或覆盖当前工作树。

## 1. 当前基线与状态

| 项 | 当前事实 |
|---|---|
| 主仓 | `F:/everyAI/dsh-model-router-all/dsh-model-router` |
| 分支 | `feat/bot-integration` |
| 本地及远端 HEAD | `e2a5367c28fc7ddbc92c2b7afa4aac04d771e6ad`（`ci: skip hosted native peer and expose upstream failures`） |
| 当前 `package.json` 版本 | `0.26.0-preview.1`，**只有本地未提交修改，没有对应 tag 或发布** |
| 正式验收 | **0/20 工作包、44/63 场景、M0 11/12** |
| M0 门禁 | G1–G4 全部 `in_progress` |
| 工作树 | 交接前已有 6 个修改文件和 1 个新文件；本文另外新建。没有暂存修改 |
| 已发布版本 | 只有 `0.26.0-preview.0`；`latest` 仍为 `0.25.5` |
| 迁移能力标志 | `activationSupported=false`、`postActivationRollbackSupported=false`、`stopWriteProvable=false` |
| 发布结论 | **不是稳定版，不是完整生产迁移版，CI 未全绿** |

根说明位于 `AGENTS.md`。继续任何 integration 工作前必须阅读 `docs/integration/PROGRESS.md` 并运行 `npm run integration:status`。冻结 DS 基线为 `de55888a93983fc51c94f7d22bc94b4f8293205d`，参考仓 `F:/everyAI/dsh-model-router-all/dsh-superagent-prototype` 只读。

## 2. 已验证到何种程度

| 验证 | 最近结果 | 必须同时理解的边界 |
|---|---|---|
| 完整根回归 | **1989 项、1901 通过、0 失败、88 跳过** | 这是本机结果，不等于 GitHub Actions 通过；后续又改过 upstream 过滤器，需重跑 |
| 客户端 | `npm run check:client` OK | 当前 preview.1 客户端也已重新生成，但还未发布 |
| 冻结上游 | **1062 项、1061 通过、0 失败、1 跳过** | 本机完整结果；CI 的单项日志脱敏用例连续失败，当前过滤器尚未修好 |
| 默认产品 | **47 项检查通过** | 隔离离线 Host，含真实 Chromium 操作，不是生产部署或真实模型调用 |
| 文档/台账 | `integration:check` 有效 | 32R/40F/63T/20W；不能把组件证据当产品验收 |
| 发布包 | 272 文件与 tag 中 Git 对象逐字节一致 | 仅针对 preview.0，不针对当前 preview.1 工作树 |
| 隔离安装 | 实际加载 `model-router-galgame`，`apply` 为函数 | 不是完整 Host 生产启动验收 |
| 真实模型推理 | **0 次** | 所有产品探针使用合成模型/API；没有真实厂商权益、配额或账单证明 |

`0/20` 并不表示没有完成代码工作，而是施工包受全部场景和 M0 总门禁约束，不能提前标记 completed。

## 3. 已完成的主要工作

### 3.1 产品组合、身份与核心工作流

- 出厂单插件组合 DS Bot 运行时与 Model Router，保留固定 DS 源码和许可字节。
- Bot 身份、精确模型绑定、同模型多 Bot 的私有状态/目录、权限撤销和严格不可用处理已接通。
- Main 私聊派活、独立 Bot 分析/实现/评审/汇总、依赖计划、独立分支、取消与冷恢复可用。
- 任务去重、稳定 Task/attempt/operation、计划 DAG、失败阻塞、重试边界、预算与未知收据 fail-closed 已实现。
- API/订阅分账、预占、未知金额不当零、人工对账、辅助/CLI/评审分别计账已有证据。
- 保留 legacy 工具、命令和 RPC 的统一授权，不留下旧入口绕过。

### 3.2 远程机器、文件与浏览器

- 已有 Agent 配对、机器授权、秘密 host-only、Bot scope、原操作收据、断网重连、未知结果对账。
- 文件 CAS、路径逃逸拒绝、真实写入、取消不回滚既有效果、artifact 哈希核验已实现。
- Linux 容器命令后端、进程树取消、工作区互斥和原操作恢复已有组件证据。
- 浏览器临时/持久 profile 隔离、受控下载、脚本、内存上传和产品入口已实现。
- 默认产品真实浏览器操作 open/script/close 已跑通；Ubuntu CI 安装 Chromium 的问题也已处理。

### 3.3 UI 与交互

- DS Bot/群、Bot 绑定、任务、远程电脑、费用和高级工作台统一入口已接通。
- 宽窄 UI、问答卡、show_view、侧问、引用、附件入口均有真实浏览器证据。
- 断网保留旧视图并禁用写操作；任务恢复、错误反馈、长日志、未知收据可操作。
- 浏览器整页刷新前后诊断调用 `1→1`、`bot_task` 调用 `0→0`，没有重发副作用。
- 语音只验证了入口，未验证音频设备。

### 3.4 迁移组件

- 配置预览、数据/账本私有归档、Session/引用/资金/工作区/支持域审计已具备。
- 共享准入、排他 fence、持久 intent、ownerToken、原子写和严格读已具备。
- 配置维护/安装/激活前回退及真实进程退出恢复已具备。
- 新增 `restoreMigrationArchives`：显式空目标或完全一致目标的幂等恢复，逐域暂存、核对、发布，冲突旧数据不变。
- schema 5 账本完整逻辑导出保留 Bot 归属、unknown、任务和收据；重复导入不重复。
- 真实子进程在数据域发布后、账本发布后分别 `exit(86)`，新进程均恢复成功，因此 **T48/T49 以 integration 级别 passed**。
- 产品入口已经采用“取共享准入→复查 gate→再建 writer”，并持有至 dispose。

这些不是 `activate→committed`、全域停写或激活后回退证明。

### 3.5 已发布的 preview.0

- tag：`v0.26.0-preview.0`，提交 `de1ae863452915083a7375624e57dc7f54d4af3b`。
- npm：`@ljwei-stak/dsh-model-router@preview`，当前 `preview=0.26.0-preview.0`，`latest=0.25.5`。
- GitHub：[0.26.0-preview.0 prerelease](https://github.com/Alice-Marx/dsh-model-router/releases/tag/v0.26.0-preview.0)。
- tarball：272 文件、2,280,088 字节，SHA-256 `16d678edbdc190111f5c414a58a201872fb9b4f3fab03609af4e95818b7df1fd`。
- npm 和 GitHub 匿名下载字节均与该 SHA-256 一致，隔离安装加载真实入口成功。
- 发布证据：[E149](evidence/20261101_preview_release_0_26_0.json)。

**但是 preview.0 的 CI 没有通过。** T52 未通过，T58 仅 partial，preview.0 不是成熟稳定版。

## 4. 当前未提交修改：Codex 必须先审查

以下不是已完成发布内容，不能默认接受或提交：

| 文件 | 当前修改 | 判断 |
|---|---|---|
| `.dsh-plugin/client.js` | 版本变为 preview.1 并重新生成 | 构建变化本身可复核，但不能单独证明发布就绪 |
| `CHANGELOG.md` | 新增 preview.1 条目 | 需要与最终实际改动和 CI 结果同步 |
| `package.json` | 版本 preview.1，加入 preview.1 validation | 未提交、未打 tag |
| `docs/releases/0.26.0-preview.1-validation.md` | 新文件，含 F 差分及显式跳过说明 | CI 结果仍是占位文字，必须更新后才能使用 |
| `tests/plugin-split.test.mjs` | 版本断言 preview.1 | 与版本同步，合理 |
| `tests/migration-windows-launcher-quarantine.native.mjs` | CI 跳过真实 AtLogOn writer 生命周期 | 是明确跳过，不是修好；负例仍执行 |
| `scripts/integration-product-upstream-tests.mjs` | CI 使用 `--test-name-pattern` 排除上游日志脱敏用例 | **当前仍有缺陷：实测没有排除目标**；应评估改成已直接验证过的 `--test-skip-pattern` |
| `docs/integration/HANDOFF-20261101-CODEX.md` | 本交接文件 | 新增，不代表代码验收 |

最近一次完整根回归是在 preview.1 与显式跳过项阶段通过的；此后又调整了 upstream 过滤器，Codex 必须重新跑完整验证。

## 5. 未完成的 19 个验收场景

| 场景 | 状态 | 剩余工作 |
|---|---|---|
| T25 OS 隔离真实检查 | partial | 需要 Windows 专属账户实机证据，Job Object/应用层策略不能替代 |
| T29 多屏与 DPI | partial | 125%、多显示器、负坐标、移动和动态变化矩阵 |
| T30 登录/锁屏/注销/UAC/RDP | not_run | 真实 Windows 会话矩阵 |
| T31 桌面租约与人工停止 | partial | 真实托盘人工暂停/停止，不能用远程取消冒充 |
| T34 CLI 不支持 MCP 的完整工作流 | partial | 无 MCP 时的完整执行链 |
| T35 远程 CLI 运行位置 | not_run | 真实远程位置、身份与授权 |
| T36 十二工具既有能力回归 | not_run | 十二工具检测、安装、更新、修复、卸载和日志 |
| T37 真实 PTY 与多会话 | not_run | 真实 PTY、多会话、输入输出与回收 |
| T50 干净安装与升级 | not_run | Linux/Win10/Win11 空环境安装、配对、远程任务、升级/卸载数据保留 |
| T51 可选发行载体 | partial | 桌面、Docker/Web 同插件、数据位置、更新/导入/退出 |
| T52 发布字节与兼容表 | not_run | 绿 CI 后源码/tag/npm/Release/agent 一致、匿名下载、干净安装、旧历史保留 |
| T54 性能/配额/泄漏 | not_run | 长时运行、性能、并发配额、进程/句柄/内存泄漏 |
| T55 兼容 facade | partial | 最终兼容入口和原能力验收 |
| T56 支持声明与证据审计 | partial | 最终支持声明、费用说明和全证据审计 |
| T57 M0 拓扑与笔记本休眠 | partial | 常开拓扑、真实机器、休眠/恢复；W02.7 |
| T58 预览版发行合同 | partial | F 差分、平台/证据说明、CI 闭环；当前 preview.0 仍有缺口 |
| T59 公网鉴权抗滥用 | partial | 公网部署下的鉴权、节流、代理/TLS/mTLS 和轮换 |
| T60 双来源费用可见 | partial | 真实 GPT Bot+CLI 任务卡分别展开、去重和费用追踪；目前 0 真实推理 |
| T61 冻结基线与增量纳入 | partial | 完整 SHA 差分、明确纳入流程，禁止自动追 HEAD |

## 6. 尚未完成的关键工程门禁

### 6.1 M0 与迁移

- W02.7：实际机器拓扑和休眠未闭合。
- W03.4：用户配置迁移与旧安装升级只有预览和组件，生产应用未闭合。
- W06.3：完整 DS/MR 配置和用户数据迁移、回滚及生产验收未完成。
- W06.15：非参与写者、其他 launcher/账户、机器重启和全域停写未完成。
- 没有 `activate→committed` 路径；不能把归档恢复组件当生产激活。
- 激活后新增数据的实际导出、双向对账和回退未实现/未验。

### 6.2 平台与部署

- Windows 专属账户隔离未验。
- 多屏、DPI、UAC、RDP、锁屏和真实托盘控制未闭合。
- 常开生产 Agent、跨机受保护网络、真实休眠和安装矩阵未完成。
- 远程 CLI、真实 PTY、十二工具完整回归未完成。
- 公网部署和性能/泄漏验收未完成。

### 6.3 发布

- preview.1 未提交、未验证完成、未发布。
- preview.0 的 CI 失败，T52 不可通过。
- 尚未形成 20/20、63/63、M0 G1–G4 全 completed 的成熟版本。
- 干净检出完整复现、最终版本提交、tag、npm、GitHub Release 和在线字节核验仍未完成。

## 7. 做砸、返工和流程失误（不要掩盖）

### 7.1 过早和过频繁上传

- 在完整场景和 CI 未通过时发布 preview.0，随后反复推送 CI 修复，产生多轮失败和重复运行。
- 用户已明确指出不要急着上传。后续必须先本地验证，再经用户明确同意才能发布。
- preview.0 已在线，不删除、不覆盖、不移动 tag；preview.1 未发布。

### 7.2 版本和客户端同步遗漏

- 初次版本升级后，3 个测试仍固定旧版本/旧客户端：Host 版本、client bundle、plugin-split 断言。
- 已重新生成客户端、同步断言并完整复跑通过。以后版本升级先构建再跑测试。

### 7.3 CRLF 导致首包包字节不一致

- 首次在工作树直接打包时，`modules/bot-runtime/SOURCE.json` 与 Git 对象因 CRLF/LF 不同而不一致。
- 该包没有发布；随后从同一提交创建 LF 干净检出，272 文件全部匹配后才发布。
- 初次 `npm pack` 还遇到依赖注释路径差异，已用固定依赖树复核生成一致性。

### 7.4 Windows ACL 多次实现错误

- 初版只 `/grant:r`，没有删除其他显式 ACE，CI 上不是 owner-only。
- 改 .NET 时，PowerShell 参数未使用 script block，路径/SID 没进入 `$args`。
- 又把 SID 字符串直接传给 `FileSystemAccessRule`，被当账户名而非 SID，导致身份映射失败和零 ACE/EPERM。
- 后续本地修好，但 CI 仍出现 Administrators、SYSTEM、CREATOR OWNER、Users。
- 最终 `icacls` 显式移除这些默认主体，相关 40 项测试通过；预览 CLI 重复旧函数也改为共享实现。
- 这是实际返工，不能描述成一次成功。

### 7.5 计划任务指纹反复失败

- 最初在 Disable/Enable 后仍要求原始 XML 哈希，状态改变必然导致 `MIGRATION_WINDOWS_LAUNCHER_CHANGED`。
- 改为只在操作前验指纹、后续只读状态；又把 `Enabled` 从指纹中排除，并兼容大小写。
- CI 的真实 writer 生命周期仍失败。按用户决定，CI 这一项先明确跳过，负例继续执行。**没有解决，也不是通过。**

### 7.6 原生 peer 启动超时未解决

- 多组 native peer/helper 用例在 hosted Windows 上协议建立前超时，stderr 为空。
- 尝试延长等待和 Windows 2022 runner 仍未解决。
- 按用户决定，CI 的 13 个 peer 用例明确跳过；本机真实进程套件仍运行并通过。**未验，不是通过。**

### 7.7 上游日志脱敏过滤器仍未正确处理

- CI 的上游用例 `warnings are kept, cleaned, written to the log, and read back after a restart` 把 `/home/runner/...` 当成泄漏，连续失败。
- 用 `--test-name-pattern` 负向前瞻尝试排除，实测目标仍执行，过滤器无效。
- 直接运行文件验证过 `--test-skip-pattern` 能排除，但当前工作树尚未改成这个参数。
- Codex 应先修正并确认计数，再谈 CI 通过，不能只看返回码或摘要。

### 7.8 npm 路径和下载判断失误

- 第一次 `npm publish` 使用相对 tarball 路径，被误当 Git 仓库；改绝对路径后成功。
- 匿名下载时先用了带 scope 的本地文件名，404；实际 registry 文件名为 `dsh-model-router-0.26.0-preview.0.tgz`。
- 发布元数据传播期间也出现过 404，最后以元数据中的精确 URL 完成字节核验。

### 7.9 验收运行器与错误诊断

- 一次默认产品 Host 被外层 300 秒任务时限终止，改受控不限时运行并完成 47 项自检，不能记成产品失败。
- 多处测试摘要最初没有原始错误，后续才补充日志。Codex 不应只凭“ passed/自报”验收，要查原始日志和实际效果。

## 8. 明确跳过项与未验项

| 项目 | 当前处理 | 结论 |
|---|---|---|
| CI native peer 13 项 | 明确 skipped | 未验；本机真实进程证据另算 |
| CI 真实 AtLogOn writer 生命周期 | 明确 skipped | 未验；负例仍执行，不能说修复 |
| 上游单个路径脱敏用例 | 计划 CI 精确跳过，但当前过滤写法未生效 | 必须先修正过滤器；不能视为已跳过或通过 |
| Linux `/proc` 等专属腿 | 按平台 skipped | 不是 Windows 通过证据 |
| Windows 计划任务注册（本机） | 权限拒绝，3 项 skipped | CI 可注册后另有指纹问题，未闭合 |
| 真实模型、真实账户、生产迁移 | 未执行 | 不能用离线 fixture 冒充 |

## 9. Codex 建议执行顺序

1. **保护工作树**：阅读根 `AGENTS.md`、`docs/integration/PROGRESS.md`、`docs/integration/tasks.json`、E149 和本文。不得 `reset --hard`、`clean`、`stash` 或 force-push。
2. **处理未提交修改**：先修 upstream 过滤器为已验证的 `--test-skip-pattern`，确认目标不再执行；更新 preview.1 validation 的真实 CI 结果，不要直接提交现有占位说明。
3. **本地复验**：完整根回归、客户端、默认产品、上游、迁移专项和 integration 文档检查。原始日志必须保留，不能只接受摘要。
4. **决定 CI 跳过策略的正式记录**：13 个 peer 和真实 writer 明确记未验；不要把这些跳过改成 passed。尝试解决时也最多两轮，按用户要求仍失败就明确跳过并交接。
5. **推进 M0 硬门禁**：迁移激活、全域停写、最新数据回退、真实拓扑和休眠。优先级高于继续增加新功能。
6. **补真实平台/部署**：OS 账户隔离、DPI/多屏/UAC/RDP/托盘、CLI/PTY、干净安装和常开 Agent。
7. **补性能、公网和最终审计**：T54/T59/T60/T61，以及 F/R/T 最终支持声明。
8. **最后才重新评估发布**：20/20、63/63、M0 G1–G4 全 completed 后，干净检出复现，再由用户决定是否创建新版本并发布。

## 10. 本地复核命令

在 Git Bash、主仓根目录执行。发布命令不在此列表中，当前禁止上传。

```bash
npm run integration:status
pnpm install --frozen-lockfile --strict-peer-dependencies
npm test
npm run check:client
node scripts/integration-product-default.mjs
node scripts/integration-product-upstream-tests.mjs
node --test tests/migration-restore.test.mjs tests/migration-restore.native.mjs
npm run integration:check
node scripts/integration-progress.mjs report
node --test tests/integration-combined-host.test.mjs tests/integration-progress.test.mjs tests/integration-documents.test.mjs tests/integration-inventory.test.mjs tests/product-client-build.test.mjs
git diff --check
git status --short
```

需要 CI 环境模拟上游精确跳过时：

```bash
GITHUB_ACTIONS=true node scripts/integration-product-upstream-tests.mjs
```

## 11. 关键证据入口

- [E149：preview.0 发布与在线字节核验](evidence/20261101_preview_release_0_26_0.json)
- [E148：迁移真实进程崩溃恢复](evidence/20261101_migration_restore_crash.json)
- [E147：私有归档幂等恢复](evidence/20261101_migration_restore.json)
- [E146：UI 离线与恢复](evidence/20261101_ui_offline_recovery.json)
- [E145：能力包、秘密和连接器](evidence/20261101_capability_secret_lifecycle.json)
- [E104：Windows 计划任务能力缺口](evidence/20261101_migration_windows_launcher_quarantine.json)
- [迁移提交编排](plan/20261031_migration_commit_orchestration.md)
- [OS/launcher 隔离设计](plan/20261031_migration_os_quarantine.md)
- [当前进度](PROGRESS.md)
- [验收任务台账](tasks.json)
- [冻结 R/F/T 范围](scope.json)

## 12. 最终提醒

- 不要真实模型推理、真实用户 profile、真实凭据或生产进程，除非用户另行明确授权。
- 不要把离线探针当生产验收，不要把 skipped 当 passed。
- 不要为追求全绿而降低断言、删除安全边界或改变冻结 DS 基线。
- 不要继续反复上传未完成版本。先完成实质工作，再经用户明确同意后发布。
