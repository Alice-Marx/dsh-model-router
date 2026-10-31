# 公网鉴权抗滥用实施设计（2026-10-28，T59）

## 实际基线与缺口

`remote-computer-agent/src/transport.ts` 已有 loopback 默认、四种显式网络模式、Host/Origin 精确名单、32 字节随机配对凭据的摘要存储、轮换 revision、短期票据以及每来源最多 1024 条的临时失败 Map。不得重复声称这些是新做的。当前没有全局匿名失败配额、已认证客户端请求限额、Retry-After 或完整 TLS/mTLS 测试；grant 查找也没有经过摘要恒定时间比较。默认产品 Host 的 owner 接口继续使用 SDK 身份准入，此设计处理机器 agent 的公开控制面和 MCP 入口。

## 决策与实现顺序

1. 独立有界限流器：匿名来源取 TCP peer，忽略 X-Forwarded-For/Forwarded/任意 wire clientId；失败窗口默认 60 秒、5 次失败触发 1 秒起的指数冷却，上限 30 秒，最多保存 1024 来源。全局匿名失败配额默认 128/窗口，饱和后只拒绝无效凭据。重复冷却请求不重复写审计。
2. 先以固定长度随机凭据摘要验证真实客户端，合法凭据不受匿名来源或全局失败冷却影响，包括同一 NAT/代理后的合法客户端。然后按服务端真实 clientId 汇总 control 与所有 grant 的请求数，默认 120/窗口；不同 Bot/票据/自报客户端 ID 不绕过，同一客户端轮换 revision 可解除其旧请求窗口。请求状态 Map 有明确容量，空闲记录可淘汰；本阶段不声称分布式 DDoS 防护或重启后持久节流。
3. 统一无效凭据返回 AUTH_INVALID/401，节流返回 AUTH_RATE_LIMIT/429 和有界 Retry-After；Token 不进入审计/异常/诊断。已认证客户端的权限不足仍是 SCOPE_DENIED/403。数据库中 clients 与 grants 都使用固定长度摘要比较路径；短期票据依旧核对客户端实时 revision/撤销/到期。
4. 公网无 TLS 时只能监听 loopback 并显式列出代理地址；只接受确实来自该 TCP peer 的精确 `X-Forwarded-Proto: https`。代理需覆写该头，后端端口不得额外公开。Host 仍匹配请求 Host，不盲信转发 Host；不使用来源头做限流，避免伪造来源或不明确的代理链解释。直连 TLS 不依赖转发头。强制客户端证书时要求明确 CA，仍需 Bearer 凭据；不会把 mTLS 当 Token 替代。
5. 用真实本机 TCP/HTTPS 测试匿名冷却、全局配额、来源伪造、正常客户端隔离、同客户端多票据合并、轮换立即失效、冷却自然恢复、精确 Origin/Host、错误 CA 与 mTLS。时间窗口组件允许 Host 注入时钟，HTTP 测试采用有约束的较短测试配置；生产默认保持主方案值。所有请求只访问本地隔离 Agent，无模型推理。
6. 构建 agent，补根测试与 CI，复跑原 remote agent/Host 机器/默认产品/完整根套件，增加公开证据并同步七个台账文件。生产 VPN/Tunnel、性能容量与真实公网部署仍需单独实测；组件通过不直接把 T59 标 passed。

## 依据

失败次数、观察窗口、指数退避及锁定造成拒绝服务的权衡参考 [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#login-throttling)。本产品使用高熵设备 Token，匿名输入不能建立可信账户身份，因此将匿名配额与已验证客户端限额分开。

Origin 拒绝、loopback 默认与连接鉴权遵循固定 SDK 当前使用的 [MCP 2025-11-25 Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#security-warning)；不因主方案引用了较晚日期就改冻结 SDK 或声称已验证未来协议。
