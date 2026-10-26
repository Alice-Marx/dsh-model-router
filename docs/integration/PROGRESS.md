# 一体化工程进度

更新日期：2026-10-27。当前阶段：**M0 基线与兼容**。研发分支：`feat/bot-integration`。

## 目标与已确认约束

按 [方案1.1](plan/20261026_master_plan.md) 完成 Main 私聊派活、两仓功能并集、按 Bot 绑定模型/官方工具、Linux 与 Windows 远程电脑，以及迁移、安装和发布。分期仅安排先后，不缩减最终范围。实际模型调用仅使用 GPT。

## 2026-10-27：组合宿主与实机验证

- 使用官方 `dsh` CLI，在独立 profile 中实际挂载 DS 与 MR，没有修改 DSH 或冻结 DS 源码。
- 9项组合检查通过：Main/工种 Bot 的真实 Session 与 AgentLoop、Main 工具创建 Bot、工种 Bot 调用 MR 路由工具、派活与结果回传、按 Bot 归属的用量，以及新宿主进程恢复身份/模型/消息历史。
- 本机浏览器已检查 Main/工种私聊、DS 用量、经典模式中的 MR 工作台和两边共享的模型目录；[截图与边界](evidence/20261027_m0_combined_host.json)已保存。
- 用户授权的 Ubuntu 与 Win10 已用于隔离实机测试。两机的组合宿主、工具/模型拦截探针、SQLite 原生加载/WAL/事务/中断恢复和客户端检查均通过。
- 新增2项环境隔离检查；工程检查现为29项。以下是本检查点完整 MR 套件的结果，跳过项没有计为通过：

| 环境 | Node | 总数 | 通过 | 失败 | 跳过 |
|---|---|---:|---:|---:|---:|
| 本机 Win11 x64 | 24.20.0 | 1260 | 1257 | 0 | 3 |
| 远程 Win10 LTSC x64 | 24.18.0 | 1260 | 1257 | 0 | 3 |
| 远程 Ubuntu 24.04 x64 | 22.22.1 | 1260 | 1237 | 0 | 23 |

证据：[远程平台](evidence/20261027_m0_remote_platforms.json)、[本轮工程检查](evidence/20261027_project_checks.json)、[六个入口的部分行为审查](behavior-audit.json)。Ubuntu 的额外跳过主要是既有 Windows 专项测试；没有据此宣称对应能力已在 Linux 验收。

发现的关键缺口：普通 DS Bot 能看到13个旧 MR 工具；记忆复查还有 AgentLoop 之外的模型调用；DS 用量和 MR 费用仍由各自旧账本管理。它们分别进入统一授权、模型准入与账本迁移，不能把同宿主能运行当成这些功能已完成。详见 [M0 验证结论](M0_FINDINGS.md)。

首次传输到 Ubuntu 的 DS 工作树带入 Windows 换行，冻结源码检查在启动前拒绝；已从原冻结 Git 对象新建干净测试副本后通过，没有放宽检查。实际机器端点与凭据只留在本机，项目仅记录测试别名。

## 2026-10-26 启动检查点

- 方案、来源材料和评审处理记录已放入项目，全部本地文档引用为相对路径。
- 建立32项需求、40组功能、63个验收场景、20个施工包的机器可读台账。
- MR 冻结在 `de82df4e737954ba0458d597ea82f9a6666c1a9b`，DS 冻结在 `de55888a93983fc51c94f7d22bc94b4f8293205d`；没有跟随上游 HEAD。
- 40组功能已登记：39组映射到既有源码，远程电脑组明确为新建；提取37个静态工具注册，逐入口的完整行为审查仍在进行。
- MR 固定依赖安装通过；全套1231项测试：1228通过、0失败、3跳过；客户端生成物检查通过。
- DS 的53项核心测试通过后，进一步用锁定的完整rc.3测试宿主运行全部1062项测试：1061通过、0失败、1跳过；测试入口与独立依赖锁已保存。这是单元/UI组件兼容验证，不是整应用或真实推理验收。
- 真实 Cordis/DSH 工具注册表探针通过：按 Agent 隐藏和阻止直接调用、兄弟 Agent 不受影响、guard不能被允许钩子覆盖、嵌套dispatch仍受限、撤销后恢复。
- better-sqlite3 13.0.3在当前Windows/Node24环境加载，WAL、回滚、双连接预占冲突、幂等与进程中断后重开探针通过。
- 真实LLM Runtime探针验证了模型调用前拒绝、会话归属和用量观察；只分派离线假适配器，没有真实模型请求。
- 本轮新增27项工程检查通过；修改后完整MR套件1258项中1255通过、0失败、3跳过，客户端检查通过。CI已加入任务依赖、范围和证据路径检查。

证据入口：[原始基线](evidence/20261026_m0_baseline.json)、[DS全套兼容](evidence/20261026_m0_ds_full.json)、[本轮工程检查](evidence/20261026_project_checks.json)。任务状态及证据由 `npm run integration:check` 检查。

## 当前未通过的门禁

| 门禁 | 已有依据 | 仍需验证 |
|---|---|---|
| G1 宿主/会话 | rc.3组合宿主、真实Session/AgentLoop、浏览器UI、三机运行与重启恢复 | MCP/search/审批/schedule等完整生命周期、产品模型准入/任务预算接入与部署拓扑 |
| G2 权限边界 | 真实registry/restrict/guard探针；已复现普通Bot可见旧MR工具 | 产品白名单接入、实际PTC VM、所有旧入口、OS强隔离、撤权中的运行进程 |
| G3 CLI/bridge | Codex可执行版本可读 | 独立配置、短期能力桥接、远程路径和取消契约 |
| G4 安装/存储 | Ubuntu/Node22、Win10/Node24、Win11/Node24原生驱动与事务探针 | Electron ABI、PTY、GUI helper、干净安装/升级/卸载 |

已登记并使用两台真实测试目标，但生产常开宿主和产品agent尚未部署。SSH可达不能替代产品配对/鉴权、WireGuard拓扑或笔记本休眠验收。现有Windows测试的3个跳过项涉及PTY或进程树，不能计为通过。

## 下一步

1. 继续W01逐入口行为核对：目前只有六个入口有部分行为记录，完整40组功能审查未结束。
2. 继续W02/G2实际PTC、旧MR工具/RPC/重跑入口与强隔离试验；根据边界冻结Policy/worker契约。
3. 继续W02/G3 Codex独立profile、短期能力bridge、取消与远程路径契约；补齐G1其余生命周期。
4. 以已有真实测试目标验证常开部署与休眠拓扑；冻结Bot/任务/授权/收据契约。
5. G1–G4达到所需证据后进入M1，迁入DS Bot运行时并保留MR兼容入口。

T63（便携方案文档）已在document级通过；T01/T57为partial，其余产品场景尚未验收。M0已完成9/12个记录子步骤；W01/W02及四个总门禁仍未完成，不换算为整个项目的完成比例。

## 复现与环境说明

```sh
npm run integration:status
npm run integration:check
npm run test:integration
node scripts/integration-host-probe.mjs
node scripts/integration-sqlite-probe.mjs
node scripts/integration-inventory.mjs --ds-root tmp/integration/upstream/ds-bot-frozen
node scripts/integration-host-probe.mjs --llm
node scripts/integration-combined-host.mjs --ds-root tmp/integration/upstream/ds-bot-frozen --host-root tests/fixtures/integration-host
```

SQLite探针需要先在隔离的 `tmp/integration/probes/sqlite` 安装锁定的13.0.3驱动，命令见证据文件；不修改用户DSH数据。源文件静态清单中的Git blob来自冻结提交，不依赖本机换行符。

本机Corepack pnpm启动器曾报缓存目录错误，本轮改用项目既有 `tmp/pnpm-10.34.6/package/bin/pnpm.cjs` 执行固定版本安装，未修改全局Node、pnpm或代理配置。其他环境使用正常的pnpm 10.34.6入口。

完整测试宿主最初的严格peer检查发现遥测依赖选到不兼容的API1.10.0；已仅在独立测试fixture内锁为1.9.0并通过frozen/strict/offline安装。pnpm顶层不暴露全部peer包导致的测试解析问题通过公共package.json解析锚点解决，没有修改DSH或冻结DS源码。复现完整套件的方法见[测试宿主说明](../../tests/fixtures/integration-host/README.md)。

组合宿主的隔离、离线适配器和浏览器检查方式见[组合fixture说明](../../tests/fixtures/integration-combined/README.md)。CI新增Ubuntu/Node22与Windows/Node24组合宿主及原生数据库检查。远程机的连接凭据、实际目录和完整日志均不提交。

## 接手规则

先读本页和 `tasks.json`，再运行进度检查；不要重新做已留证据的基线验证，除非依赖、源码或环境变化。任务步骤完成不代表对应产品T场景完整通过。把新增证据、失败、限制和下一步同步记录在本目录，不能只留在聊天里。
