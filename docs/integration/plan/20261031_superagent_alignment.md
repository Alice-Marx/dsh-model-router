# dsh-superagent 思路与现工程对齐合同（E90）

参考：`F:/everyAI/dsh-model-router-all/dsh-superagent-prototype`（研究代码，只读）。本文不把原型当生产基线，也不替换当前冻结 DS/SDK/MR。

## 1. 概念映射，不重写核心

| 参考概念 | 当前工程 | 必须保持的规则 |
|---|---|---|
| Trigger | owner 请求、计划或 Source 事件 | 不可变输入、requestKey/requestHash 幂等，重复接受不得产生第二份 Task |
| Eval | `parseTaskPlan`、Policy、目标与资源准入 | 合法性与授权先于调度；模型文本不是权限 |
| Ticket | Task | 一个授权工作单元，状态由 journal 决定，不跟随某个 Session 的临时状态 |
| Assignment | attempt | 可重试、恢复，保留 operationId 与原收据；不重复执行或计费 |
| Channel/backend | 注册的 effect-bound backend | Host 固定可执行体、端点和秘密，禁止模型任意命令 |
| Effects | `task_outbox`、dispatch fence、执行租约 | 提交后执行；回滚不得触发外部效果 |
| Receipt | operation result、stopProof、needs-reconciliation | unknown 不是 failed、not-started 或已停止，必须人工/只读核对 |
| Policy version | binding/machine revision | 改变必须重新准入，不能沿用旧授权 |
| Composition root | `product-composition` + `createTaskService` | 组合不含领域规则，状态各有一个写者 |

依赖 `task_package_deps` 是执行 DAG，不等同参考中的 Subscription；机器/工作区授权也不等同于跨 Source 身份映射。不同 Source 的 ID 不自动合并为“同一个人”。

## 2. 已核实无需重写的部分

- `canonicalTaskJson`/`taskHash` 已提供不可变请求与幂等。
- `createTaskService` 在 journal 提交后调度 backend，beginDispatch/closeDispatch 防止迟到 dispatch。
- `needs-reconciliation` 已把 unknown 与普通 failed 分离；reconcile 只允许观察原 operation，禁止重放。
- 现有 remote write/command 已具备 stopProof、never-started、原始收据和撤权后拒绝迟到成功。
- Task、资金、机器目录、Bot 设置各自有固定写者，没有引入第二资金 writer。

## 3. 首个实现切片：结构化阶段投影

新增 `taskStage({state,needsReconciliation})`，在 journal 视图上提供计算字段，不新增数据库状态：

| 输出 | 当前事实 |
|---|---|
| `working/queued` | ready，尚未取得执行权 |
| `working` | admitting/running |
| `working/cancelling` | cancelling |
| `working/budget` | waiting-budget，预算等待不是人工失败 |
| `person/reconciliation` | needs-reconciliation 或显式标记，unknown 必须核对 |
| `person/blocked` | blocked |
| `person/failed` | failed |
| `person/review` | succeeded，等待人审阅结果 |
| `idle` | cancelled/skipped |

未知状态抛出 `TASK_STAGE_INVALID`，不得静默映射成健康或成功。参考中的 `person/delivery`、`person/answer` 当前没有等价结构事实，不能凭自由文本猜测。

## 4. 后续采用顺序

1. 保持现有迁移/停写主线，先闭合真实 OS 与旧 writer 证据。
2. Source 接入（W12/W13）沿用 Trigger→Eval→Ticket→Attempt，不在 Task 之外另建一套工作流。
3. 新 UI 优先展示 `person/*`，健康状态不占人工注意力；不得用通知掩盖未知。
4. 所有外部效果继续采用先 journal 后 dispatch，崩溃只核对原 operation。
5. 发布前仍以 20/20、63/63 和真实平台门禁为准，参考文档本身不增加通过数。
