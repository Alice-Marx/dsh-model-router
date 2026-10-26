# M0 组合与运行时验证结论

2026-10-27。本页记录冻结 MR `de82df4` / DS `de55888` 基础上的组合试验；当前源码检查点仍是 M0。

## 已建立的依据

官方 DSH 0.2.1-rc.3 Web profile 能同时挂载两套插件。Main 的真实 AgentLoop 经 `create_bot` 创建工种 Bot，工种 Bot 经 DSH 工具注册表执行 `model_router_routes`，Main 的 `message_bot` 派活得到回复。真实 Session 事件中能读取各 Bot 的 fixture token，用新宿主进程重开同一隔离 home 后身份、模型和往来消息保留。

这里的推理来自离线脚本适配器，真实模型请求为零。Main/工种的 AgentLoop 和辅助记忆复查均有观测；它们共享同一准确的测试模型路线。

本机浏览器实查了 Bot 界面、派活回传、用量分组和经典 Agent 模式的 MR 工作台，两边读取同一个模型目录。截图见[组合证据](evidence/20261027_m0_combined_host.json)。这证明当前组件能够共存；单一产品导航、配置入口和双来源费用 UI 仍由后续里程碑完成。

在用户授权的真实 Ubuntu 24.04/Node22 与 Win10 LTSC/Node24 上重跑组合宿主、完整 MR 回归和原生 SQLite 探针均无失败。数据库原生载荷摘要、ABI、结果和源覆盖摘要在[平台证据](evidence/20261027_m0_remote_platforms.json)。没有用 CI 的 Windows Server 替代 Win10 实机。

## 后续实现必须处理的事项

| 发现 | 实施影响 | 下一验证 |
|---|---|---|
| 普通 DS Bot 的真实请求包含13个旧 MR 工具 | `restrict` 与 `guard` 必须覆盖旧 facade；仅在新页面隐藏按钮不足以形成绑定 | 直接工具调用、PTC子调用、RPC、会话命令、重跑与取消的主体校验 |
| 记忆复查存在 AgentLoop 之外的模型调用 | 模型准入与预算不能只挂在 AgentLoop；辅助调用必须归属 Bot/task/attempt | 严格模型失效、辅助调用前预占、失败和实际收据 |
| DS用量与MR费用分别使用原账本 | 本次DS用量页有token、MR费用为零，不能误称统一费用已接通 | 单写迁移、receipt幂等、真实Bot+CLI双来源UI |
| Bot模式与经典模式切换后可达MR | 可以先保留高级入口；产品仍需统一导航与任务卡 | 单插件配置、完整侧栏与宽窄视口 |
| Ubuntu首次接收的DS工作树带CRLF，被完整性守卫拒绝 | 跨平台交付使用Git对象/原始blob字节，拒绝通过删校验掩盖问题 | 从冻结对象创建新测试副本后已通过；发布继续验证Git字节 |
| SSH连接已验证，产品agent尚未安装 | 测试机可用于后续Linux/Win10验收，不能称作已完成配对或常开部署 | 短期身份、能力暴露、撤销、服务生命周期与笔记本休眠 |

## 边界

- 没有修改用户自己的 DSH home、既有远程服务、全局 Node/pnpm、WireGuard 或防火墙。
- 远程工作位于本次独立测试目录；所有测试宿主进程已由启动器结束。
- Node/OS/架构证据仅覆盖报告列出的组合；Electron、PTY、GUI helper、安装/升级/卸载仍待验证。
- 本机UI截图不等于Win10远程交互桌面验收；一次干净重启不等于T13全部中断点恢复。
- 只确认同宿主组成与有限入口行为。MCP/search/审批/schedule完整生命周期、G2强隔离与G3桥接仍在M0门禁中。

完整需求和验收范围保持不变。T01/T57只记录partial，T63仍是唯一passed的文档场景；当前9/12是M0子步骤计数。
