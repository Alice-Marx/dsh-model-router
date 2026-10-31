# 内置 Bot Runtime

本目录把冻结 DS Bot 迁入 MR 的一个插件中。`vendor/ds-bot/` 来自
`de55888a93983fc51c94f7d22bc94b4f8293205d` 的 Git 对象，没有修改源码、测试或 SDK。
源仓库为 [Fei2411/DS-Bot](https://github.com/Fei2411/DS-Bot)，核对镜像为
[Alice-Marx/DS-Bot-model-router](https://github.com/Alice-Marx/DS-Bot-model-router)。
`SOURCE.json` 记录全部 297 个迁入文件的来源路径及 SHA-256。保留了包内
`LICENSE`、仓库 `UPSTREAM_LICENSE` 和 `UPSTREAM_NOTICE`；其 Apache-2.0 许可继续适用。
本仓自有组合器与投影代码沿用本仓许可。生成的客户端也包含上述 Apache 来源代码。

迁入完整的 Bot/群聊、角色与会话、长期记忆、派活/结果回传、侧聊、语音、浏览器、
Capabilities、秘密、计划任务、Token 用量和主题界面。完整冻结测试也保留在 vendor 中，
以便从最终仓库复现。内置模块不再单独安装或更新 `ds-bot`；原更新操作会说明从
Harness 插件管理更新统一 MR 插件。

## 主插件接入

只导出内部 factory，不创建第二个顶层插件，也不创建 authority、身份目录、配置库、
Task Service 或资金库。必须提供同一宿主的这些既有对象，以及共享费用装饰器：

```js
import { createBotProduct } from './modules/bot-runtime/index.mjs'

ctx.provide('botIntegrationPolicy', policy)
const product = createBotProduct(ctx, {
  authority, directory, policy,
  grantFor,             // 仅从可信的已提交宿主配置编译授权
  accountStream,        // (options, next, metadata) => AsyncIterable
  runtimeConfig: { home: botHome },
  readModels: { bindings, tasks, machines, usage },
  actions: {
    'task.cancel': cancelTask,
    'task.retry': retryTask,
    'task.reconcile': reconcileTask,
  },
  authorizeRequest: request => ownerAuth.authenticate(request),
})
// 接着在同一 ctx 中加载原 MR，requireBotPolicy: true，再启动业务服务。
// ctx 释放时自动关闭 product 的监听；共享资金库/authority 由主插件释放。
```

`grantFor(bot)` 返回已有 lifecycle 契约的 `{tools, modelRoutes}`；Bot 自填角色、
指令、请求参数不会授予权限。保存成功后才更新真实 Session/Agent 归属；群成员和换段
继续由原 DS Runtime 维护。MR 工具与 Task 工具的 schema 可见性跟随同一授权。

`accountStream(options,next,{subject,source,sessionId,runtime})` 在策略准入后调用。
source 为 `bot-session` 或 `bot-auxiliary`，使用 SDK 的 AgentLoop 身份标记和 DS
辅助调用标记判断。缺少明确 Session 的 MR 内嵌请求需由共享资金适配器使用已有
执行上下文/WeakMap 标记辨认，避免重复入账；不能从模型参数推断归属。缺少
`accountStream` 时 factory 拒绝启动。原 DS `usage.sqlite` 只存 Token 投影，不是费用或
预算单写权威；实际金额仍由同一 MR 资金库负责。

## 版本化只读投影

factory 提供 `ctx.botProductReadModel`，`version: 1`：

- `snapshot({signal})` 返回 `schemaVersion: 1`、真实持久 Bot/模型/当前 Session、
  lifecycle 状态、只读原因及 bindings/tasks/machines/usage 四个 section。
- `readModels[key]({runtime,signal})` 返回 `{status:'available'|'blocked',items:[],reason?,nextAction?,summary?}`。
  必须只返回公开字段，不含密钥；没有服务或读取失败显示可执行阻塞原因，不生成样例记录。
- `dispatch({action,payload},trustedContext)` 仅接受已认证 owner，动作来自固定表。
  实际 action handler 再检查当前授权、资金/Task fence 与操作范围。
- 只有传入 `authorizeRequest` 才挂载 `POST /api/bot-product`。认证器必须验证真实会话，
  返回 `{kind:'owner',...可信上下文}`；不要信任 JSON、任意 cookie 是否存在或 `botId`。
  未接入认证器时保留进程内服务，HTTP 入口不开放。

UI 字段：bindings.items 每项以 botId 关联工具/权限/workspace/budgetScope；tasks.items
沿用 taskId/botId/state/attempts/operationId/executionRef/reconciliation；machines.items
使用 id/name/platform/version/status/lastSeenAt/capabilities/desktop/blockedReason；usage.items
使用 Bot/Task 归属、source、准确 model、amountUsd、billing、status。未知金额使用 null，
不要写成 0。usage.summary 可提供 apiUsd/reservedUsd/unknownCount/subscriptionSummary。

## 验证与边界

默认组合已提供机器目录与 `machine.secret/pair/bind/probe/revoke/reconcile` 拥有者操作。
机器页秘密表单复用原DS秘密库及脱敏，保留 `REMOTE_AGENT_*` 命名空间且Bot scope为空；
秘密界面和Bot的request_secret不能把控制面凭据交给Bot。目录只存secretRef，不存Token。
受授予Bot可通过真实Agent对象调用 `remote_computer_read/list/ping`；机器、根目录、工具和
revision逐次校验。离线撤销保留持久的停止未确认状态，重试核对不恢复授权。
见[产品机器证据](../../docs/integration/evidence/20261027_m4_product_machines.json)。
这不是远程写入/CLI/桌面Task执行或生产网络部署验收。

```sh
node scripts/integration-product-source.mjs
node --test tests/bot-runtime-product.test.mjs tests/bot-runtime-ui.test.mjs
node scripts/integration-product-upstream-tests.mjs
node scripts/integration-product-host.mjs
```

最后两个命令使用既有固定 rc.3 测试宿主，所有数据写入 `tmp/integration/`。
宿主探针跑迁入 factory、真实 Session/AgentLoop、MR 工具、派活/回传、撤权与冷启动；
accountStream 是明确标注的离线诊断装饰器，不能当作统一费用验收。原 1062 项 DS
测试是源码/组件回归，也不能代替默认用户迁移、Electron、真实模型、完整调度、
远程 Agent 或 OS 隔离验收。没有提供的后端在产品页保持 blocked。

发布时必须随主插件携带 `index.mjs`、`read-model.mjs`、`SOURCE.json`、本说明和
vendor 中的 index.js/package.json/web-search.js/src/** 与三个 LICENSE/NOTICE 文件。
冻结测试、开发脚本及其原生成客户端只用于源码复现，不是第二插件发行入口。
