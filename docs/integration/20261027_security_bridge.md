# M0 授权、PTC 与 CLI 桥接实验

2026-10-27。冻结上游仍为 MR `de82df4` / DS `de55888`，SDK 为
`0.2.1-rc.3`。实验代码在 `packages/capability-broker/`，没有进入已发布插件入口。
完整范围、版本和稳定发布条件保持方案1.1。

## 主体与授权契约

宿主持有的对象是授权主体，模型输出的 `botId`、机器 ID 或路径不能创建主体。
宿主从认证上下文解析 Bot，再建立主体与所有 Session/Agent 的可信映射；本次
PTC 实验只映射实际 Main/worker Agent，尚未实现跨 Session 的稳定映射。

授权核限定准确的 provider/model、工具、任务、attempt、机器、工作区 ID 与本地/
远程位置。工作区 ID 必须由可信执行器解析为根目录，不能让模型用绝对路径替代。
短期票据仅在父进程内存中持有，内核保存其摘要；最大生命周期5分钟、默认30秒，
最多256份租约。改授权、撤权、过期与关闭会取消活跃处理器；忽略取消的外部副作用
仍须执行器处理，不能把“已发出取消”记成“进程已停止”。

## 真实 PTC 的结论

组合宿主通过 `worker.ctx.get('tools')` 取得实际作用域，把同一授权核挂在 guard。
探针调用真实 Node PTC `run_code`，检查宿主 binding、隐藏工具、嵌套调用拒绝、
兄弟主体独立、运行中下一次调用撤权和忙循环取消。没有修改 SDK 或冻结 DS 源码。

Ubuntu 和 Win10 的7项工具约束检查通过，但同用户 PTC 仍能读到隔离测试目录中
另一 Bot 的合成文件；两机沙箱均报告 partial enforcement。Ubuntu 还报告旧
Landlock ABI。这证实方案 ADR10 的 OS worker 路径必须保留。
本机 Win11 的 workspace-write 沙箱在 `SetNamedSecurityInfoW` 授权阶段返回 Win32 5，
记录为受阻，不能通过放宽 ACL 或切换不受限模式算通过。各平台最终结果见
[安全证据](evidence/20261027_m0_security.json)。

独立 Linux 容器实验使用不可变 Node 镜像摘要、UID65532、只读根目录、无网络、
无 capabilities、no-new-privileges，唯一 bind mount 是自己的工作区。它能读写自己
的合成文件，并拒绝读取宿主另一 Bot 的合成文件。它还不是运行 DSH 的 worker：
DSH 的依赖、消息、凭据代理、Broker 回传和容器中断恢复仍需接入。Windows 专属
账户/ACL、桌面会话与 helper 也仍待实施。凭这一实验不能将 T25 标为通过。

## MCP 桥与 Codex 配置

实际 MCP SDK 客户端、桥子进程和父授权核已连通；两份 Bot grant 的工具列表独立，
伪造 Bot/机器参数不进入后端，撤权后不能继续调用，MCP 取消能传到后端，关闭能
结束本次拥有的子进程。测试覆盖 legacy 与 modern 两种协议模式。实现使用公开
SDK API，依据 [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)、
[stdio 接入](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html)和
[协议版本说明](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions.html)。

已安装的 Codex CLI 0.163.0 实际执行 `mcp list/get --json`，读取两份独立
`CODEX_HOME` 下的 MCP 配置，既有用户配置保持原字节。配置项与
[官方 CLI MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)核对。
这是配置解析验证，没有通过 Codex 启动桥、没有真实 GPT 推理，也没有验证 CLI
模型身份。当前桥只接受直接父进程的私有 IPC；CLI 孙进程的私有引导还没接通，
不能声称已完成 Codex 原生 MCP 工具调用。详见[桥接证据](evidence/20261027_m0_broker_bridge.json)。

## 复现与接入顺序

```sh
npm run test:integration
node scripts/integration-combined-host.mjs --ds-root <frozen-DS> --host-root tests/fixtures/integration-host --security
node scripts/integration-codex-profile.mjs --entry <verified-official-codex-bin-js>
docker pull --platform linux/amd64 node@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d
node scripts/integration-linux-isolation.mjs
```

命令使用独立测试 home，仅记录合成数据。Docker 探针只清理本次 ID 和标签匹配的
容器。配置检查不启动推理，不读取或导出用户登录凭据。根依赖与宿主 fixture
分别使用已提交的锁文件。全部实际模型请求为0。

下一步先实现稳定主体/Session 映射和全部旧工具、RPC、命令、重跑入口的 facade，
再将预算与 receipt 接入同一执行路径。桥侧需完成 CLI 私有引导、失败/超时/
进程树取消与远程路径；worker 侧需用真正的 DSH profile 复验 OS 隔离。G2/G3
继续进行，W02.5仍为 in_progress；本轮不会把部分探针折算为产品场景通过。
