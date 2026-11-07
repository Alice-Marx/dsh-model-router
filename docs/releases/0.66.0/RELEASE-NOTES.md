## 0.66.0 — 可靠性、契约与边界闸

Built on `release/0.66.0` at `a997e51`. Fifteen changes, each with a regression that fails without it.

### 可靠性
- 任务运行器失去租约后**自行重建**，每次停止记录原因；此前静默死亡，提交的任务永远停在“排队中”。
- 租约到期改用**账本时钟**，系统时间跳变不再把活租约判给第二个运行器。
- 账本写冲突改为**有界等待**，第二个 Host 不再启动即崩。
- 容器命令纳入**停止证明**：此前不在名单里，失败后重试可能把同一条命令执行两次。

### 一致性
- 任务页一次读取一页：128 行 **9 条语句**（此前约每行 9 条，合计约 1,150）。
- 已结束的协作计划不再在每次写入时重新推导。
- 路由账本只写变化行；`writeFull` 保留为增量路径的 A/B 参照。

### 权限与审计
- 每次尝试记录四道检查（准入 / 租约 / 派发 / 结算）与“是否真的进入执行”。
- 拒绝时给出**闸名**，不再只有笼统拒绝码。
- 删除从未接线的 `approval-gate` 兼容桥；审批属于宿主的用户审批能力。
- 六个任务动作在入口声明自己只属于已登录的人。

### 契约与分层
- 新增 `contracts/`：手写校验器（拒绝未实现的关键字）、已发布版本按哈希冻结、28 个产品动作双向校验。
- 分层边界测试：vendored 运行时、共享层、客户端产物各有冻结的例外清单。
- **修复 Bot 之间交接无法提交**：`buildHandoff` 发 `origin.kind='handoff'`，契约只接受 `private|group`，交接在契约层即被拒绝。
- 任务带 `initiator`（本人 / Bot / 例程 / 交接 / 职责 / 记忆），契约升 `task-request/v2`，v1 保持不变。
- 任务行区分“未执行 / 已执行后失败 / 已执行但结果未确认”。

### 安装
```
dsh plugin --profile desktop add @ljwei-stak/dsh-model-route-bot@0.66.0
dsh plugin --profile desktop add @ljwei-stak/dsh-model-router@0.66.0
```

**校验**：`npm test` 32 阶段 / 1848 项通过；两个原生探针 54 + 35 项；`check:package` 474 文件与 HEAD 一致（193 个运行时文件）；`check:router-package` 62 文件、53 个运行时文件；两个发布包匿名下载与本地 SHA256 逐字节一致。
