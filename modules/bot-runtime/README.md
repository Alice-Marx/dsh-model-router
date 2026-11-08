# 内置 Bot Runtime

本目录把当前 DS Bot 迁入 MR 的一个插件中。`vendor/ds-bot/` 由
`scripts/sync-ds-bot.mjs` 从**显式指定**的上游 checkout 同步，构建前更新，`--check` 按字节
拒绝旧副本。源仓库为 [Fei2411/DS-Bot](https://github.com/Fei2411/DS-Bot)。
`SOURCE.json` 记录全部迁入文件的来源路径、SHA-256、固定提交与运行时版本；每个文件另带
`origin`：`upstream`（与上游逐字节相同）、`notice`（`UPSTREAM_LICENSE`/`UPSTREAM_NOTICE`）、
`overlay`（产品自有改动）、`generated`（按打过补丁的源码重建的 `client.js`）。保留了包内
`LICENSE`、仓库 `UPSTREAM_LICENSE` 和 `UPSTREAM_NOTICE`；其 Apache-2.0 许可继续适用。
本仓自有组合器与投影代码沿用本仓许可。生成的客户端也包含上述 Apache 来源代码。

```sh
# 同步：必须给出 checkout 与固定提交；--rebase-overlay 在上游改动后重写产品补丁的基准
node scripts/sync-ds-bot.mjs --source ../DS-Bot-upstream \
  --source-commit 71d344bf193f3f18185f25de3d8e5c483046910a --rebase-overlay
# 校验：不带 --source 只校验 vendor 与 SOURCE.json；带上时逐字节比对上游并重建 client.js
node scripts/sync-ds-bot.mjs --check [--source ../DS-Bot-upstream]
# 特性矩阵：逐条给出上游特性、非上游特性与产品改动的证据
node scripts/check-upstream-parity.mjs [--source ../DS-Bot-upstream] [--diff]
```

同步不再自动寻找 `../ds-bot` 或仓库内的 `ds-bot/`：没有 `--source` 时只刷新和校验已有字节，
因此打包后的仓库（没有同级 checkout）同样能 `build:client` / `check:client`。同步不访问网络。

产品对上游的自有改动集中在 `product-overlay/`（Bot 抽屉的「电脑操作」页、侧边栏
`sidebarAddon`、`sidebar.workspaces` 槽位探测），以「记录的上游基准 + 补丁」的形式保存，
详见该目录的 README。上游在同一文件里的新改动不会被这些补丁覆盖。

迁入完整的 Bot/群聊、角色与会话、长期记忆（含变更历史与按行恢复）、派活/结果回传、侧聊、
语音、浏览器面板与浏览器插件、Capabilities、秘密、计划任务、Token 用量和主题界面，以及
0.2.7 起的分阶段群目标（`group_goal` 与 goal-grill 技能）、Enter 发送/换行偏好与催稿、
消息时间、新 Bot 默认模型、Models 引导步和失败回合的可操作提示。完整冻结测试也保留在
vendor 中，以便从最终仓库复现。内置模块不再单独安装或更新 `ds-bot`；原更新操作会说明从
Harness 插件管理更新统一 MR 插件。

**不属于上游**：远程电脑（配对机器、桌面画面与输入）和文档知识库都是 MR 自己的能力，
实现在 `packages/orchestration/` 与 `apps/integration-client/`；上游只有浏览器面板和
头像库。`node scripts/check-upstream-parity.mjs` 用可执行证据守住这条边界。

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

UI 字段：bindings.items 每项以 botId 关联工具/权限/workspace/budgetScope，并带有引擎选择 `selection`（`instanceId`、`model`、可选 `effort`/`variant`）和有序 `fallback`。`fallback` 只记录备用引擎，不进入 `modelRoutes`。tasks.items
沿用 taskId/botId/state/attempts/operationId/executionRef/reconciliation；machines.items
使用 id/name/platform/version/status/lastSeenAt/capabilities/desktop/blockedReason；usage.items
使用 Bot/Task 归属、source、准确 model、amountUsd、billing、status。未知金额使用 null，
不要写成 0。usage.summary 可提供 apiUsd/reservedUsd/unknownCount/subscriptionSummary。

## 验证与边界

默认组合已提供机器目录与 `machine.secret/pair/bind/probe/revoke/reconcile` 拥有者操作。
机器页秘密表单复用原DS秘密库及脱敏，保留 `REMOTE_AGENT_*` 命名空间且Bot scope为空；
秘密界面和Bot的request_secret不能把控制面凭据交给Bot。目录只存secretRef，不存Token。
受授予Bot可通过真实Agent对象调用远程读取、写入、浏览器、命令与桌面工具；机器、根目录、工具和
revision逐次校验。离线撤销保留持久的停止未确认状态，重试核对不恢复授权。
生产网络部署与外部账户仍需按部署指南验收。

```sh
node scripts/integration-product-source.mjs
node --test tests/bot-runtime-product.test.mjs tests/bot-runtime-ui.test.mjs
node scripts/check-upstream-parity.mjs
node --test tests/upstream-parity.test.mjs
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
