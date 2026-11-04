# 借鉴 OpenBot 与 dsh-superagent 的优化记录（2026-11-04）

参考项目（本地只读）：

- `OpenBot` — https://github.com/CopilotKit/OpenBot
- `dsh-superagent-prototype` — https://github.com/deepseek-ai/dsh-superagent-prototype

本文记录"看懂了什么、准备抄什么、明确不抄什么"，以及第一批落地的改动。

## 两个项目各自最重要的四点

### dsh-superagent

1. **注意力预算**：`take as little human attention as possible`。每条消息、每个设置、每个面板元素都要证明自己值回票价，否则删掉。
2. **面板只回答三个问题**，顺序固定：现在有需要我的事吗 → 系统健康吗 → 某件事的历史。健康状态不占空间。
3. **每个工单只有一个阶段**（delivery / answer / review / blocked+failed / queued / idle / working），按一张从上到下第一行命中的表推导，标签写"在等谁、需要什么"，不写内部状态码。
4. **许可分强度**：explicit / inferred / not admitted；推断出来的工作先"只记录不执行"，规则收紧不会追溯扩大已发出的 mandate，恢复前会重新校验。

### OpenBot

1. **一个网关决定并记录所有动作**：Bot 对电脑、文件、MCP、组件的每个动作都经过同一个 gateway，先决定、再执行、后记账，拒绝时说出被哪条规则拒绝。
2. **每个同事一台自己的电脑**：独立浏览器、登录态、文件，只给被授予的工具。
3. **平台无关**：AG-UI 协议接入任意 agent 栈，治理跟着协议走而不是跟着框架走。
4. **回答是组件而不只是文字**（generative UI），本地部署、数据在自己库里。

## 抄什么（按性价比排序）

| 优先级 | 借鉴点 | 落到 dsh-model-router 的样子 | 状态 |
| --- | --- | --- | --- |
| P0 | 面板先回答"现在有需要我的事吗" | 工作台顶部新增「需要你处理」卡片，只在有事时出现；行内写清等谁、要什么决定、点一下去哪 | **本次已实现** |
| P0 | 单一阶段推导，标签写"等人"不写状态码 | `shared/attention.mjs` 的纯函数：预算暂停 → 中断未核验 → 体检失败/超时 → 执行失败 → 需要登录，按顺序取第一条 | **本次已实现** |
| P1 | 健康不占空间 | 无待办时不渲染卡片；`attentionSummary` 空串即不显示 | **本次已实现** |
| P1 | 推断工作先进"只记录"模式 | 团队分工增加"演练（dry-run）"：完整规划与派单，工具调用只记账不执行，产出"本应执行的动作清单" | 待做 |
| P2 | 一个动作网关 | 把远程电脑、官方 CLI、终端、文件写入的决策与结果收敛到同一张动作账本（现有 operation record 扩展 `decision` 字段） | 待做 |
| P2 | 阶段表文档化 | 把工作包阶段（queued/working/awaiting-review/blocked/failed/done）写成一张表，面板标签由表推导，与 superagent 的 Ticket 阶段对齐 | 待做 |
| P3 | 许可强度 | Bot 权限区分 explicit / inferred：非直接请求触发的工作默认只记录；规则收紧时重新校验未完成的 grant | 待做 |

## 明确不抄

- **AG-UI / 多框架**：我们的产品是 DSH 内的单栈插件，多协议接入只会增加概念和攻击面。
- **Docker Compose + PostgreSQL 全家桶**：桌面插件不该要求用户跑容器编排；现有 SQLite + Host 状态足够。
- **飞书/GitHub 事件源**：那是 superagent 的场景；我们已经有 Bot 会话与远程电脑，不新增 Source 概念。
- **Generative UI 组件协议**：收益主要在富交互产品，我们当前瓶颈是"看不清楚现在要做什么"，不是"回答不够花哨"。

## 第一批落地（0.26.3）

新增 `shared/attention.mjs`：

```js
deriveAttention({ budget, reserved, probes, health, runs, limit })
// → [{ key, stage, title, detail, target }]
```

- 阶段顺序：`blocked`（预算暂停、执行中断）→ `failed`（体检失败/超时、执行失败）→ `login`（已安装但未登录）
- 每行给出**人的动作**（"核对后再继续""重新体检""运行登录命令"），不出现内部状态码
- 健康时返回 `[]`，界面完全不渲染
- 纯函数，7 个用例覆盖：健康沉默、预算优先、降级不打扰、中断计数、失败任务命名、只报已安装且未登录、条数上限

界面：工作台在各标签页之前渲染「需要你处理」，每行按阶段着色（阻止执行=红、失败=橙、登录=绿），右侧按钮直接跳到对应页。

## 下一步建议

1. 演练模式（dry-run）——团队分工路径最缺的安全阀，先记账不执行。
2. 动作账本统一——把 `operation record` 扩展为 `{ decision, reason, effect }` 三段，和 OpenBot 的 gateway 对齐。
3. 阶段表——先写文档再改代码，避免面板标签继续各写一套。
