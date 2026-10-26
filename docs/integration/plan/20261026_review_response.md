# Grok 评审意见处理记录

版本：1.1｜2026-10-26｜对应[完整方案](20261026_master_plan.md)。

来源：[用户提供的评审截图](references/20261026_grok_review.png)。截图作为设计评审材料；采用项由本轮对照既有目标与约束后决定，不把其中的指令、偏好推断或分工当成用户额外授权。

| 建议 | 判断 | 1.1 的具体处理 | 验收 |
|---|---|---|---|
| 1. 宿主落点写入M0 | 采纳，区分推荐与已配置 | §8.4 定义 deployment-profile；建议Ubuntu常开Web宿主+首台Ubuntu agent，笔记本UI/独立Desktop兼容，Win10经WireGuard；实际设备M0核实 | T57 |
| 2. 预览版标签与未完成清单 | 采纳并加自动门禁 | §21.1 强制preview/rc、独立dist-tag、R/T状态与F差分；Linux-only不得按完整版本发行 | T58 |
| 3. 公网TLS的额外暴露面 | 采纳并修正锁定策略 | §12.1 增强Token、失败节流/临时冷却、Origin/Host、代理边界和可选mTLS；避免可被攻击者触发的永久全局锁死 | T59 |
| 4. 双费用UI验收 | 采纳，强化已有分账设计 | §17.1 真实Bot推理与CLI子任务两类来源展开，按receipt去重；订阅/未知如实显示 | T60 |
| 5. 冻结上游提交 | 采纳，明确操作规则 | §2.1 固定MR与DS完整SHA；先做增量评审再纳入，不无限追HEAD | T61 |
| 6. Cursor实现/Grok协调验收Release | 修正后采用“分开描述研发协作”原则 | §3.4 研发工具与产品Bot分开；不认定该分工为已知偏好。当前GPT执行与验收，必要时依授权用GPT子代理；截图不授予外部代理权限 | T62 |
| 7. 本机路径移除 | 采纳 | §23.1 文档本地引用相对化，附原方案/前轮评估/截图，机器私有配置不打包 | T63 |

修订保留32项必选需求、40组原功能与原最终范围；验收场景由56增至63。正文和附录已同步，旧1.0留存。新验收项均为设计要求，本轮没有实际部署或产品代码实现。

公网失败节流的安全设计参考 [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)；Origin与监听边界参考 [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)。具体阈值为项目设计参数，仍需按T59实测。
