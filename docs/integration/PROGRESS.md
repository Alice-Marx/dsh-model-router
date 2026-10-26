# 一体化工程进度

更新日期：2026-10-26。当前阶段：**M0 基线与兼容**。研发分支：`feat/bot-integration`。

## 目标与已确认约束

按 [方案1.1](plan/20261026_master_plan.md) 完成 Main 私聊派活、两仓功能并集、按 Bot 绑定模型/官方工具、Linux 与 Windows 远程电脑，以及迁移、安装和发布。分期仅安排先后，不缩减最终范围。实际模型调用仅使用 GPT。

## 已完成的启动工作

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
| G1 宿主/会话 | MR现有回归、DS全套使用rc.3、真实LLM钩子探针 | 真实同宿主挂载、UI、完整会话/调度与产品预算接入 |
| G2 权限边界 | 真实工具registry/restrict/guard探针 | 实际PTC VM、所有旧入口、OS强隔离、撤权中的运行进程 |
| G3 CLI/bridge | Codex可执行版本可读 | 独立配置、短期能力桥接、远程路径和取消契约 |
| G4 安装/存储 | 当前Windows/Node24驱动ABI与事务探针 | Node22/宿主/Electron、Linux与实际Win10、PTY和完整安装 |

实际日常宿主、常开agent与Win10/WireGuard目标尚未登记。公共台账不存真实端点/密钥；机器拓扑与笔记本休眠验收尚未进行。现有测试的3个跳过项涉及PTY或进程树，不能计为通过。

## 下一步

1. 继续W01逐入口行为核对，补齐动态工具/RPC与UI路径，区分静态发现和已复现行为。
2. 继续W02同宿主组合测试、模型调用准入钩子和CLI配置/bridge探针。
3. 在已确认的隔离环境验证M0剩余项，冻结Bot/任务/授权/收据契约。
4. G1–G4达到所需证据后进入M1，迁入DS Bot运行时并保留MR兼容入口。

T63（便携方案文档）已在document级通过；其余产品场景尚未验收。M0已完成8个启动子步骤，W01/W02及四个总门禁仍在进行，不能按“测试很多”提前结项。

## 复现与环境说明

```sh
npm run integration:status
npm run integration:check
npm run test:integration
node scripts/integration-host-probe.mjs
node scripts/integration-sqlite-probe.mjs
node scripts/integration-inventory.mjs --ds-root tmp/integration/upstream/ds-bot-frozen
node scripts/integration-host-probe.mjs --llm
```

SQLite探针需要先在隔离的 `tmp/integration/probes/sqlite` 安装锁定的13.0.3驱动，命令见证据文件；不修改用户DSH数据。源文件静态清单中的Git blob来自冻结提交，不依赖本机换行符。

本机Corepack pnpm启动器曾报缓存目录错误，本轮改用项目既有 `tmp/pnpm-10.34.6/package/bin/pnpm.cjs` 执行固定版本安装，未修改全局Node、pnpm或代理配置。其他环境使用正常的pnpm 10.34.6入口。

完整测试宿主最初的严格peer检查发现遥测依赖选到不兼容的API1.10.0；已仅在独立测试fixture内锁为1.9.0并通过frozen/strict/offline安装。pnpm顶层不暴露全部peer包导致的测试解析问题通过公共package.json解析锚点解决，没有修改DSH或冻结DS源码。复现完整套件的方法见[测试宿主说明](../../tests/fixtures/integration-host/README.md)。

## 接手规则

先读本页和 `tasks.json`，再运行进度检查；不要重新做已留证据的基线验证，除非依赖、源码或环境变化。任务步骤完成不代表对应产品T场景完整通过。把新增证据、失败、限制和下一步同步记录在本目录，不能只留在聊天里。
