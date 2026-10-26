# 稳定 Bot 主体与旧入口权限接入

2026-10-27，接续 `0c79a60`。这轮把可选权限接缝接到 MR 源码，不再只验证独立
授权核。默认旧 profile 仍使用原行为；正式集成 profile 需要明确加载权限服务并
配置 `requireBotPolicy: true`。严格配置下服务缺失/无效或宿主缺少单调 guard 会拒绝
操作，不会恢复不受限的旧入口。

## 已接入的入口

| 入口 | 实现位置 | 本轮行为 |
|---|---|---|
| 13个 `model_router_*` 工具 | `index.mjs` + `shared/legacy-policy.mjs` | 审批前、单调guard、工具体三次校验；主体来自真实Agent对象 |
| `/router`、`/tools` | 同一权限接缝 | 使用真实CommandInvocation.agent；模型/命令文本中的身份不参与授权 |
| 23个RPC方法 | `official-tools-remote-service.mjs` | 覆盖描述符导出的完整合同，含安装器和终端；主体只读Gateway调用上下文 |
| 准确模型目录 | `discoverConfiguredRoutes` | 在当前主体上下文内过滤，列表和规划都只得到获准路线 |
| MR嵌套及辅助模型调用 | `packages/orchestration/src/bot-policy.mjs` | 嵌套调用保留主体；辅助调用只接受已登记Session元数据；首次读取前再次检查 |

RPC使用公开SDK提供的 `ctx.invocation.peer.principal`。该principal由宿主创建peer时
固定，wire不能覆盖。当前适配器只接纳已认证owner，且每个方法仍需准确capability；
没有调用上下文或其他peer类型一律拒绝。不能把payload中的 `botId` 或 `owner` 当身份。
静态注入检查仅为该Typert公开accessor登记了精确例外，其余检查保持原约束。

工具的第一次实机尝试发现安装器仍会进入旧审批分支；因此增加审批前检查，同时
保留guard和工具体检查来覆盖异步准入后的变化。完整回归也发现轻量settings接收器
没有services字段，已保留其同步结果形状并修复可选读取，没有删除原测试。

## 稳定主体与生命周期

一个Bot持有一个宿主对象，多个私聊/群聊/续段Session映射到同一个主体。复制Agent
JSON、只提供相同id、重复绑定Session均不能取得权限。解绑一个Session不影响同Bot
的其他Session；改授权作用于全部绑定并中止合作式运行；退休清空绑定并禁止在本
进程复活同id。宿主重启后必须从可信持久状态重建映射，不能从请求参数恢复。

同一操作的主体通过AsyncLocalStorage传入模型目录和MR嵌套请求，并发Bot不会串号。
租约绑定的task/attempt/机器/工作区目前是实验调用上下文，尚非持久Task记录。
模型流在构造时、首次读取前及后续chunk校验准确路线；构造后撤权不会启动适配器。
无输出的辅助provider尚不能靠这层中止正在等待的远端请求，不能称为完整推理取消。

## 实测边界

真实组合宿主使用有效必填参数调用全部12个未获准旧工具，拒绝来自Policy，不能
拿参数错误充当权限检查。获准路由工具和规划命令正常；工种Bot的真实schema只保留
获准MR工具。新建第二个真实Session并由可信fixture绑定到同Bot后，两Session都能
调用获准工具，撤权后同时被拒，Main仍可使用自己的授权。没有真实模型请求。

全部23个真实RPC接收器在缺少authenticated invocation时拒绝；owner成功路径另有
独立单元检查。尚未把真实Gateway正向RPC、DS生命周期自动绑定或全部AgentLoop/
记忆路径算为产品验收。这轮仍在隔离profile中手动绑定可信Session，没有迁移用户数据。

Bot的原生CLI、团队执行、重跑、安装和主观评分即使获准旧工具名称也暂时拒绝，
等Execution facade校验固定程序、CLI身份、原运行归属、审批、预算和收据后开放。
严格RPC后台启动也暂时拒绝，需先让持久Task租约独立于单次RPC请求生命周期。
这些功能继续保留在完整范围中；普通旧profile仍保持既有能力。

## 复现及接续

```sh
npm run test:integration
node scripts/integration-combined-host.mjs --ds-root <frozen-DS> --host-root tests/fixtures/integration-host --legacy-policy
```

Ubuntu/Win10可同时追加 `--security`，继续运行上一阶段的真实PTC检查。Win11原生
沙箱ACL阻塞仍保留，不为此次普通工具/命令通过而改写。

下一步完成可信DS生命周期映射、Gateway正向RPC与执行/重跑所有权，随后接入CLI
孙进程私有引导和真正DSH OS worker。CLI桥、持久Task/预算/receipt、Windows专属
账户隔离仍未完成。当前只是可选集成接缝，不据此发布新的稳定包或将T05标为passed。
