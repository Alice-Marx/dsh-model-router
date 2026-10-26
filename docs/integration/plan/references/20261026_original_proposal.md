# DS-Bot 一体化开发方案

**版本：** 2026-10-26  
**最终发布仓：** Alice-Marx/dsh-model-router  
**UI 基调参照：** Alice-Marx/DS-Bot-model-router  
**上游对照：** Fei2411/DS-Bot  

本文是完整成稿：远程控机、Bot 派活、两仓功能并集、改/留/新建原则、分期与验收均写在正文里，不依赖外链跳转。

---

## 1. 一句话定位

做一个 DeepSeek Harness（DSH）插件：用户自备远程电脑可被 Bot 操控；同时具备 Alice-Marx/dsh-model-router 与 Alice-Marx/DS-Bot-model-router 两仓现有能力的并集（可多不可少）；默认像 Grok Bot 一样只私聊一个 Main Bot 即可自动派活；界面大致像 DS-Bot；代码与 Release 最终落在 Alice-Marx/dsh-model-router。

远程控机是最初目标，也是核心增量之一，不是可有可无的脚注。

---

## 2. 产品原则

### 2.1 功能底线

- 对照两仓：凡用户侧已有能力，一体化后都必须可达。
- 允许新增（例如远程控机）。
- 禁止静默砍掉任一侧能力。

### 2.2 开发灵活性（改 / 留 / 新建）

两仓同等对待，每个功能开工前判定一次：

| 判定 | 含义 | 做法 |
|------|------|------|
| 留 | 行为已对、契约稳定 | 文档化 + 回归测试，不改核心路径 |
| 改 | 方向对但不够稳/不够通 | 修边界、补 UX、接官方工具或控机；尽量不换数据模型 |
| 新建 | 两边都没有对等物 | 新模块，接口贴现有 Bot / Capabilities |
| 迁入 | 逻辑在另一仓 | 抽库合入最终仓，映射到 Bot 身份，避免双入口、双套壳 |

不为「一体化」推倒重写。能留则留，不够成熟就改，缺口才新建。

### 2.3 UI

- 主界面观感与信息架构大致对齐 DS-Bot-model-router（Bot 列表、详情、群聊、Capabilities、Usage 等）。
- dsh-model-router 的路由、官方工具、预算、工作台等能力嵌进 Bot / 设置 / 「高级」区域，不另起第二套互不通气的壳。
- 独立「模型路由工作台」可保留为高级/调试，不抢默认入口。

### 2.4 发布

- 最终上传与 Release：Alice-Marx/dsh-model-router。
- DS-Bot-model-router 作为 Bot 雏形与对照源，成果合回最终仓；合入后可用 README 指向最终仓。

---

## 3. 用户怎么用

1. **日常（默认）**  
   只开与 Main Bot（Chief）的私聊。Main 根据各 Bot 的职责、模型与工具自动拆包并 handoff；进度与结果回主会话。不必建群，也不必 @ 每一个人。

2. **工作群（可选）**  
   需要同屏看见多 Bot、互相 @、共享群记忆时再建群。群内 admin 仍可自动拆包。建群只是功能之一，不替代私聊派活。

3. **工种 Bot**  
   先配置若干 Bot：职责不同；模型可以相同也可以不同。  
   示例小队（可改配）：
   - DeepSeek · 调研 — 模型 DeepSeek — 官方工具 DeepSeek Harness — 资料搜集  
   - DeepSeek · 评审 — 模型 DeepSeek — 官方工具 DeepSeek Harness — 挑刺验收  
   - Kimi · 长文 — 模型 Kimi — Kimicode（可选）— 长文整理  
   - Kimi · 代码辅 — 模型 Kimi — Kimicode — 仓库辅助改码  
   - GPT · 实现 — 模型 GPT — Codex CLI — 主实现与 CLI 执行  

4. **官方工具规则**  
   - 绑定维度是 Bot，不是模型。同模型可多 Bot 分职，记忆与工具白名单互不串。  
   - 本插件跑在 DeepSeek Harness 上，**DeepSeek Bot 的官方工具就是 Harness 本身**（宿主内建 shell / 文件 / 审批等），不必再挂「DeepSeek CLI」。  
   - 其他厂商用各自 CLI（如 Kimicode、Codex CLI、Claude Code 等），按 Bot 白名单隔离。  
   - 官方工具失败不静默降级成另一家模型的 API 调用。

5. **远程电脑（核心）**  
   用户自备机器，安装同仓 remote-computer-agent，在 Capabilities 登记后赋给指定 Bot；Bot 即可在远程机执行命令、读写文件、无头浏览器，Windows 上再补 GUI。

---

## 4. 远程电脑（核心章节）

### 4.1 目标

- 人人可配：用户填写自己的服务器或电脑端点与 Token；不绑定某个人的隧道或机器。
- 能力进最终发布仓：Capabilities 登记远程 MCP，赋给指定 Bot。
- 同仓发布 agent 安装包（Linux 无头 / Windows 桌面），协议统一；**不是第二个 DSH 插件**。
- 网络自选：WireGuard / Tailscale / Cloudflare Tunnel / 公网 TLS；插件只要求可达。
- 典型场景：Ubuntu 云宜作常开沙箱优先；老家 Windows 10 经 WireGuard 后再做 GUI / local-exec。

### 4.2 非目标（首期不做）

- 官方托管多租户云机或代管用户密钥  
- 再做一个独立 DSH 插件包名  
- 替代 DSH 本机 shell 与文件工具  
- 保证未登录 Windows Session 0 下的 GUI 点击  

### 4.3 架构要点

- DSH + 本插件跑在用户任选主机上。  
- 远程机一律用 **HTTP MCP**（或本机回环）+ Bearer Token；可选 mTLS。  
- local stdio 只表示 agent 与 DSH 同机，不能指向远机。  
- Linux：shell、文件、Playwright 无头。  
- Windows：同上，加截屏与键鼠（需交互桌面会话）。

### 4.4 首期 MCP 工具（稳定面）

| 工具 | 作用 | 风险 |
|------|------|------|
| machine.ping | 健康与版本 | 低 |
| fs.read / write / list | 文件 | 中 |
| shell.exec | 命令（超时与 cwd） | 高 |
| browser.* | 无头导航与 DOM | 中 |
| desktop.screenshot | 整屏（有桌面时） | 中 |
| desktop.click / type | 坐标键鼠 | 高 |

传输：Streamable HTTP 或 SSE MCP；响应带 machine_id、agent_version、os。破坏性变更升 major；插件拒绝过低 agent 版本。

### 4.5 控机分期（可与 Bot/工具分期并行）

| 阶段 | 内容 | 约时 |
|------|------|------|
| P0 | 协议与假 agent：schema、鉴权、错误码；mock MCP 登记进 Capabilities，Bot 调通 ping | 1–2 周 |
| P1 | Linux agent 真实现：shell、文件、无头浏览器；安装脚本；Token 必填 | 2–3 周 |
| P2 | 插件侧：添加机器（名称、URL、密钥引用）、健康检查、赋给 Bot；隧道文档 | 1–2 周 |
| P3 | Windows GUI：截屏、点击、输入；注销会话时失败可读 | 2–3 周 |
| P4 | 硬化：白名单、速率限制、审计、版本协商；Release 附安装包与兼容表 | 1–2 周 |

### 4.6 安全基线（控机）

- 禁止默认监听全网且无 Token  
- 密钥仅经 DSH 密钥与环境变量引用，不进 git  
- shell.exec、desktop.*、fs.write 默认需用户确认；可按 Bot 收紧白名单  
- 审计：谁在何时对哪台机调了何工具  
- 文档写明共享家庭电脑与注销会话风险  

---

## 5. 三块能力怎么叠

| 层 | 主要来源 | 职责 |
|----|----------|------|
| 自动派活 + 可选工作群 | DS-Bot 系 | Main 私聊 handoff（默认）；群聊 / @ / 群记忆（可选） |
| 模型 + 官方工具 | dsh-model-router + DSH | 每 Bot 钉死模型；DeepSeek→Harness；外厂→各自 CLI；按 Bot 过滤；分包与预算 |
| 远程电脑 | 新建 | 同仓 agent；HTTP MCP；按 Bot 赋权机器 |

**默认路径：** 私聊 Main → 自动拆包 handoff → 各工种 Bot 用自己的模型、官方工具、（可选）远程机干活 → 结果回主会话。

---

## 6. 双仓盘点初稿（改 / 留 / 新建）

代号：DS = Alice-Marx/DS-Bot-model-router；MR = Alice-Marx/dsh-model-router。

| 能力 | 主要来源 | 倾向 |
|------|----------|------|
| Bot 列表 / 详情 / 记忆 UI | DS | 留（定 UI 基调） |
| Main / Chief 私聊 | DS | 改（强化无群自动派活） |
| 无群自动派活回主会话 | DS 偏弱 | 改 |
| 工作群 + @ + 群记忆 | DS | 留 |
| 每 Bot 选模型 | DS | 改（长期钉死、同模型多实例隔离） |
| Capabilities / Usage | DS | 留 / 改（接远程机与官方工具） |
| 模型路由建议 / 成本预览 | MR | 留 / 改 |
| 官方工具注册表与执行 | MR | 改（按 Bot 绑定） |
| 分包 / 团队执行 / 预算账 | MR | 留 / 改 |
| 工作台入口 | MR | 改（降为高级） |
| 远程控机 | 无 | 新建 |

M0 必须把上表落成可勾选清单（路径、接口、用户可见行为）。验收时做功能 diff：任一侧有、一体化没有的项 = 未完成。

---

## 7. 仓库角色

| 仓 / 路径 | 角色 |
|-----------|------|
| Alice-Marx/dsh-model-router | 最终发布仓：一体化插件、Release、文档、安装入口 |
| Alice-Marx/DS-Bot-model-router | Bot 雏形与 UI 对照源；可继续开发，成果合回最终仓 |
| 最终仓内 Bot 模块（如 ds-bot/ 或等价） | Bot 团队 UI 与 handoff（从 DS 系迁入后改） |
| 最终仓内 model-router 核心 | 已有路由 / 官方工具 / 预算；按 Bot 绑定改造 |
| 最终仓 remote-computer-agent/ | 新建附属组件（Linux / Windows），非第二插件 |
| Fei2411/DS-Bot | 上游对照；不以它为发布仓 |

**合并注意：** 两仓插件 id、状态目录可能冲突；合入前定单一 package 名与数据路径；提供单向迁移脚本；同模型多 Bot 按 botId 隔离会话。

---

## 8. 每 Bot / 工作群配置（建议字段）

### Bot

| 字段 | 说明 |
|------|------|
| model | Harness 精确路由 provider/model（必填；可与其他 Bot 相同） |
| officialTools | DeepSeek → harness（宿主）；其他 → registry id（kimicode、codex 等）；可空 |
| capabilities | MCP / skills / 远程机器 id |
| rolePrompt | 工种说明；同模型靠这个区分 |
| budgetScope | 可选 API / 订阅分账范围 |

### 工作群（可选）

| 字段 | 说明 |
|------|------|
| members | Bot id 列表；允许同 model 多 id |
| adminBot | 默认接单的 Main / 协调者 |
| sharedMemory | 群级结论与任务状态 |
| templates | 可选预设小队 |

---

## 9. 任务转交（默认无群）

1. 用户只私聊 Main；Main 接单。  
2. 产出 work packages：目标 Bot、目标、验收、依赖。  
3. 注入该 Bot 的模型与工具白名单后在后台 / 子会话执行。  
4. 状态与结果回主会话；失败可改派（同模型另一角色或换模型 Bot）。  
5. 可选：建群后同屏协作；用户也可直接私聊或 @ 某成员。

路由算法建议服务 Main：输出「派给哪个 Bot」，而不是裸 provider 字符串。

---

## 10. 产品分期（总览）

| 阶段 | 内容 | 约时 |
|------|------|------|
| M0 | 双仓盘点清单（留/改/新建）+ 冻结要改的 schema / handoff / 执行器接口 + 兼容矩阵。禁止未盘点就平行重写 | 约 1 周 |
| M1 | 钉死模型 + 无群自动派活；同模型多 Bot 隔离；工作群作可选项 | 2–3 周 |
| M2 | 官方工具：MR 注册表与 executor 按 Bot 白名单；DeepSeek 默认绑 Harness | 3–4 周 |
| M3 | 远程控机 MVP（与上可并行）：对齐第 4 章 P0–P2，再扩 P3–P4 | 3–4 周起 |
| M4 | 一体化体验：默认 Main 私聊；工作台高级化；合入并 Release 到 dsh-model-router；Windows GUI；安装文档 | 约 2 周 |

---

## 11. 验收标准

| 项 | 标准 |
|----|------|
| 控机 MVP（核心） | 按文档：装插件 → 装 Linux agent → 填 URL 与 Token → Bot 能远程 echo 并读文件；完整版含 Win10 GUI 与高危审批 |
| 派活 MVP | 只私聊 Main，在已配置多工种 Bot（含同模型异职 + 外厂 CLI）时自动拆包派活并回主会话，无需建群 |
| 工作群 | 同一套 Bot 可拉进群同屏协作与 @；不替代私聊派活 |
| 隔离 | 同模型两 Bot 互不可见对方私有记忆与未绑定工具 |
| 工具 | DeepSeek Bot 走 Harness；Codex 仅 GPT Bot；Kimicode 仅绑定了的 Kimi Bot |
| 功能并集 | 对照两仓清单 diff：任一侧已有能力均可达；允许额外能力 |
| UI | 主界面大致同 DS-Bot；MR 能力进 Bot/设置/高级 |
| 发布 | 在 Alice-Marx/dsh-model-router 出 Release、安装说明与兼容表 |

---

## 12. 安全总览

- 同模型两 Bot：会话、记忆、工具、密钥引用互不可见  
- 外厂官方 CLI：sandbox / cli-native 显式选择与确认  
- 远程 agent：禁止无鉴权公网；高危默认审批  
- 预算：API 金钱账与订阅次数账分离（迁入 MR 账本时保持）  
- 密钥不进 git；不把 API key 打进模型配置日志  

---

## 13. 待决事项（建议默认）

| 事项 | 建议默认 |
|------|----------|
| DSH 主要跑哪 | 未定；控机侧建议 Ubuntu 云常开沙箱优先，Win10 后补 GUI |
| 群模板是否预置 | 可选预置；不挡无群派活主路径 |
| 工作台是否保留 | 高级 / 调试；默认走 Main 私聊 |
| 两仓怎么收束 | 功能合入 dsh-model-router；DS-Bot-model-router 可指向最终仓 |
| 路由算法放哪 | 服务 Main；输出派给哪个 Bot |
| agent 语言 | TypeScript（与 DS-Bot 一致）；需单文件再考虑 Go |
| GALGame | 独立插件，不进本范围 |

---

## 14. 测试清单（摘要）

- [ ] Mock MCP：Capabilities 登记与 Bot 工具可见  
- [ ] Linux agent：shell、文件、无头打开示例页  
- [ ] 错误鉴权 401；过低 agent 版本被拒绝  
- [ ] Windows：登录会话下截屏点击；注销会话失败可读  
- [ ] 断网与超时：Bot 侧可读错误，不卡死会话  
- [ ] 工作群内两个 DeepSeek Bot 记忆与工具不串  
- [ ] DeepSeek / Codex / Kimicode 互不串工具  
- [ ] Main handoff 后子 Bot 使用自己的模型路由  
- [ ] 两仓功能 diff 无遗漏  

---

## 15. 结语

本方案把三件事钉死在同一产品里：

1. **远程控机** — 最初目标，核心增量，同仓 agent + Capabilities。  
2. **两仓并集** — 改/留/新建，可多不可少；UI 像 DS-Bot；发到 dsh-model-router。  
3. **Main 自动派活** — 默认无群；建群可选；每 Bot 钉模型与官方工具（DeepSeek = Harness）。

落地顺序以 M0 盘点为门禁，控机 P 轨与 Bot/工具 M 轨可并行，最终在 Alice-Marx/dsh-model-router 一次性对用户呈现。
