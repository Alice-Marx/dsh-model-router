# 交付说明：三仓学习 → 0.66.0

> 这份文件给"隔一段时间回来接手"的人看：做了什么、凭什么相信它、还剩什么。
> 生成于 2026-11-07。所有数字都可复核，命令写在每一节末尾。

## 1. 任务与结论

用户要求：把 `OpenMausBot`、`Agents-Anywhere`、`OpenBot` 三个本地仓库**逐文件学透**并沉淀为长期记忆，再据此对 `dsh-model-router` 插件做**重大更新优化**（含可执行清单、实现、回归验证），最后授权**真实发布**。

四件事都完成了：

| 交付 | 结果 |
| --- | --- |
| 记忆体系 | `MEMORY/`，**30 个 md / 19,633 行**，覆盖 13,955 个文件 / 324 万文本行的机器清册 |
| 升级清单 | `MEMORY/10-CROSS/UPGRADE-BACKLOG.md`，7 批 43 条，每条带现状代码、改法、可执行验收 |
| 实现 | **15 条落地**，每条都有"没有它就会红"的回归 |
| 发布 | **0.66.0 已进 npm 公开元数据**，tarball 匿名下载与本地逐字节一致 |

## 2. 记忆体系怎么用

入口 [README.md](../../MEMORY/README.md)，方法 [00-METHOD.md](../../MEMORY/00-METHOD.md)。三层覆盖口径写得很明确：清册级（全部文本文件）、结构级（约 800~1200 个核心文件）、精读级（约 300~400 个文件 / 25~40 万行）。**不许把索引说成精读**。

引用完整性跑过脚本审计：7,165 条 `文件:行` 引用，可解析 83.8%，越界 2 条（已修）。审计脚本 `MEMORY/_inventory/audit-citations.mjs` 可重跑。

```sh
node MEMORY/_inventory/audit-citations.mjs
```

## 3. 落地的 15 条（按问题类别）

### 会让系统"静默死掉"的

1. **U-01 运行器可重建**：`stopRunner(reason)` 记录原因、`restart()` 重建、产品装 5 秒看门狗。此前 Host 一次长阻塞就让运行器永久死亡，提交永远停在"排队中"，零日志。
2. **U-04 租约用账本时钟**：`leaseClock:'db'`，系统时间跳变不再把活租约判给第二个运行器。
3. **U-02 写冲突有界等待**：`write-retry.mjs`，第二个 Host 不再启动即崩；超时错误报出等了多久。

### 会让"同一条命令执行两次"的

4. **U-05 停止证明真值表**：提取 `stop-proof.mjs`；**发现 `remote-command` 不在名单**（其驱动早已产出 `container-supervisor` 证据，账本却不认），补齐后失败不再被当成可安全重试。
5. **U-16 删除死桥**：`approval-gate.mjs` 四个导出零消费方，其中一条测试长期红着没人发现（它不在测试计划里）。

### 让失败可归因的

6. **U-15 拒绝带闸名**：`PolicyError{gate,rule}` + 六处 `gate(name,…)` + `block()` 记录。
7. **U-13 四段式 checkpoint**：准入 / 租约 / 派发 / 结算各写一行 `gate` 事件，`result.authorization={gates,carriedOut}`。
8. **U-32 执行进度三态**：`taskAttribution()` 区分"未执行 / 已执行后失败 / 已执行未确认"，任务面板与详情都显示。

### 性能与规模

9. **U-08 列表批量化**：一页 **9 条语句**（改前约每行 9 条，128 行 ≈ 1,150）。
10. **U-11 计划刷新增量**：已结束的计划不再参与每次写入。
11. **U-09 账本增量写**：`writeRuns()` 差集写入，`writeFull()` 保留作 A/B 参照。

### 契约与结构

12. **U-20 `contracts/`**：手写校验器（拒绝未实现的关键字）、已发布版本哈希冻结、28 个产品动作。
13. **U-21 逐动作 payload**：5 个任务动作闭合形状 + **反向检查**（处理函数读了未声明字段即失败）。
14. **U-38 架构边界**：四条规则 + 冻结例外清单（棘轮），实测三条违规都能拦住。
15. **U-19 + 交接修复**：`initiator` 六类（`task-request/v2`），并修掉 **Bot 交接在契约层就被拒绝**的死路（`origin.kind='handoff'` 契约不认）。

## 4. 凭什么相信

```sh
npm test                      # 32 阶段 / 1848 项 / 0 失败
node scripts/integration-task-probe.mjs     # 54/54，actualModelCalls 0
node scripts/integration-finance-probe.mjs  # 35/35
npm run check:contracts       # 5 契约 / 17 夹具 / 28 动作 / 5 payload
npm run check:client
node scripts/check-readme.mjs
node scripts/check-package.mjs dist/release-0.66.0/*.tgz        # 474 文件与 HEAD 一致
node scripts/check-router-package.mjs dist/release-0.66.0/ljwei-stak-dsh-model-router-0.66.0.tgz
node scripts/integration-product-default.mjs --host-root tmp/integration/host-rc3   # 真实 Host 组合里 passed
```

三条最值得记住的验证手法：

- **rowid 稳定性**证明增量写：UPDATE 保 rowid、DELETE+INSERT 换 rowid。先证明 `writeFull` 会移动全部 rowid，再断言增量路径一个都没动。
- **反向漂移检查**：正向只能证明"我给的例子合格"；反向能发现"代码偷偷依赖了没人承诺的字段"。
- **匿名下载比对**：`npm publish` 报成功不算证据，从 registry 取回来逐字节比才算。

## 5. 还剩什么

| 项 | 状态 | 为什么没做 |
| --- | --- | --- |
| U-10 `countModelCalls` 提列 | 未做 | 需要 `user_version 5→6` 迁移与"哪些版本不能混跑"声明，值得单独一轮 |
| U-12 `synchronous` 分级 | 未做 | 与写路径形状耦合，先定形状再调参数 |
| 批次 6 其余（U-33~U-37） | 未做 | 依赖 U-10 与 attention 的消费面 |
| 批次 7 其余（U-39~U-43） | 未做 | 流程约定与结构重构，风险低但价值也低于功能 |
| U-14 策略求值器 | **明确不做** | 本仓没有用户可配置策略，做出来就是第二座死桥 |
| main 分支对齐 | **留给负责人** | 见下 |

## 6. 需要负责人决定的一件事

本地 `v0.65.0` → `c611013`；`origin/main` 上已发布的 0.65.0 → `879c7b2` + 回执 `ac9f5cd`。**两个不同的提交**。工作分支 `archive/preview6` 相对 `origin/main` 领先 108、落后 93。

本轮从 `release/0.66.0`（`a997e51`）发布并打 tag，**没有改写 main、没有移动旧 tag**。要决定：main 快进到 `release/0.66.0`，还是做一次合并；以及本地陈旧 tag 删还是重指。

细节在 [publication.json](publication.json)。

## 7. 未验证（必须一起读）

- 没把 0.66.0 装进**你的**真实桌面 profile，也没在运行中的 Host 里点开任务面板。
- 没重建 Windows 安装包与远程 Agent（保持 0.1.1）。
- 本轮没推 GitLab 的 main。
- GitHub 页面上的公式渲染未在本地核验。
- 架构边界测试读的是 **import 说明符**，变量拼出的动态 import 看不见。
