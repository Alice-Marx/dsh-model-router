# 多 Bot 任务工作区（0.65.0）

本轮依据用户选择增强「多 Bot 任务进度与待处理事项」，按随后给出的上传授权纳入 0.65.0 发布。未修改用户当前桌面 profile。

参考仓库：[Agents Anywhere](https://github.com/anywhere-labs/Agents-Anywhere)，本地研究版本 `98e1242446b47d7074935b3a38b1b1f0f7f987ff`。主要研究当前 `dsh-bridge-next`、`desktop-workbench` 和 `docs/api/capabilities.md`；没有依赖其废弃目录、服务端或账号体系，也未直接复制实现代码。

## 已实现的行为

- 团队任务总览：按 Bot 展示已加载任务的进行中、待处理和总数；状态筛选与 Bot 筛选、名称或编号搜索可组合使用。
- 待处理列表：总数不受默认六项展示限制，可以展开全部。每项均可打开原任务，审批提醒可打开原 Bot 会话。没有可执行的宿主动作时仍有详情入口。
- 时间线：从持久 journal 读取原任务的事件，显示每次尝试、时间、结果与原操作身份。首次打开或任务更新时按需读取，也可手动重读；失败显示在详情区域。旧宿主回退到现有收据展示。
- 加载顺序：跨宿主已知 Bot 优先加载待处理和进行中任务，再显示新历史，避免每个 Bot 的最早 128 条记录永久遮住后续任务。最多 512 条；显示截断与总数，计数不会冒充全量统计。日志默认最近 80 条，同样提供截断信息。
- 资金准入检查是进行中，只有 `waiting-budget` 提示预算待处理。未确认远程结果归入待处理，不计为已结束。

## 与参考项目的对应

| 参考方式 | 本插件的落点 |
| --- | --- |
| 按持久事件展示 Timeline | `task.inspect` 从已有 SQLite journal 读取事件，不生成推测事件。 |
| 按有效能力开放操作 | 依据宿主 `availableActions` 和原任务状态显示按钮，Host 再次执行认证与授权。 |
| 将交互请求定位回原会话 | 审批提醒使用原 Bot 的 `sessionId` 打开私聊。 |
| 明确状态与操作的区别 | 停止请求不会显示为停止确认；结果未知时保留核对依据。 |

## 实现入口与权限

- `apps/integration-client/task-progress.mjs`：已加载记录的统计、类别和组合筛选。
- `apps/integration-client/tasks-panel.jsx`：总览、待处理、任务详情、时间线与协作计划。
- `packages/orchestration/src/task-product.mjs`：显式字段投影，排除原始输入、执行引用、事件详情和核对证明。
- `task-journal.mjs` 的 `productList` / `timeline`：只读查询，不改变原 runner 队列或执行顺序，不迁移数据库 schema。
- `product-composition.mjs` 的 owner `task.inspect`：先使用原 Bot subject 检查已提交 `task/read` 权限，再检查任务所有者，最后读取日志。它不申请新授权、不启动模型、不调用远程执行。
- 详情请求绑定 Bot、Task 和 Host；切换任务、宿主或卸载会丢弃迟到响应，身份不一致或早于当前快照的响应不会采用。

## 验证入口

```sh
node --test tests/task-product.native.mjs tests/task-progress.test.mjs tests/task-workspace.integration.test.mjs
node --test tests/bot-runtime-ui.test.mjs tests/product-refresh-order.test.mjs tests/bot-routing-card.integration.test.mjs
node scripts/integration-product-default.mjs
npm run build:client
npm run check:client
npm test
```

验证在 `tmp/integration` 和本次 `tmp/agents-anywhere-20261107` 中使用隔离数据和离线模型替身。实际供应商调用、用户现有 Electron 安装及手机访问不在这次验证范围内。
