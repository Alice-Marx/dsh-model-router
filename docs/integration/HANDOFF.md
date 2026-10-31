# 交接报告（HANDOFF）

**最新权威交接：[HANDOFF-20261031-KIMI-E77.md](HANDOFF-20261031-KIMI-E77.md)。E77 combined-host 容器命令端到端场景已完成组件验证：Win11 非容器 never-started、Ubuntu 真 Docker 成功，本机根回归1853项、1785通过、0失败、68跳过。完整工程、产品验收和发行仍未完成。下方保留历史材料；当前数字、证据边界和未完成项以新交接为准。**


> **最新交接（2026-10-28）：先读 [2026-10-28 详细交接文档](HANDOFF-20261028.md)**（架构地图、资金链路不变量、剩余工作含依赖调度器实施设计、复跑命令、踩坑与同步规则，13 章）。该文档优先于本文及 `HANDOFF-20261027-GPT.md` 中关于"当前状态"的描述。全部代码仍未提交；历史快照数字只证明各自时点。

更新日期：2026-10-27。本文是给接手方（GPT Codex）的交接说明：本会话做了什么、当前状态、还没做什么、坑与规则。**本文是点时间快照；持久状态以 `PROGRESS.md`、`tasks.json`、`STATUS.txt` 为准。**

## 0. 一分钟现状

### GPT 接续更新（同日，优先于下方历史快照）

- 后续已增加CLI执行组件（见[合同](../../packages/cli-runtime/README.md)及[三机证据](evidence/20261027_m5_cli_execution.json)）：Task/资金原生8项、桥3项、Task29项、资金27项与严格MR实际宿主均通过。Task最长两小时并续签短期执行租约；Linux长profile的socket失败已修复并验证权限/清理。默认产品Task/资金接线、其他CLI与远程CLI仍待实施，不把组件测试提升为实际模型工作流通过。行为记录22组。

- 任务6的产品部分已经落地：默认入口的机器页、host-only秘密表单/secretRef、真实machineId与版本核验、按Bot授权、受控读测试、撤销/未确认停止/重试确认、冷启动恢复。使用真实AgentLoop调用远程读取；没有改冻结DS或SDK源码。
- 三机当前结果：Win11/Ubuntu/Win10各8项Host机器原生、12项Agent原生、9项默认组合检查通过。新版代码在全新隔离源码目录执行，复用既有已验证依赖，不声称干净安装或生产网络部署。
- 本机完整回归1339项，1336通过、0失败、3跳过；资金27项通过。复现新增 `node scripts/integration-remote-machines.mjs`。证据与代码摘要见 [产品机器接入](evidence/20261027_m4_product_machines.json)，行为记录现21组。W09.2完成，W09.3保留生产/跨机网络/休眠验收。
- **任务7的版本判断已更正**：机器上有Codex0.163.0；已再次用真实app-server完成独立profile、孙进程私有MCP、精确配置模型、伪造拒绝、撤权及原生Job停止，0新推理。0.157.1只代表旧PATH入口，无需用户选择降级适配。实际执行facade、CLI资金准入/收据和远程CLI仍待接。
- 本机和远程访问沿用用户已给的私有资料，不需要重复索要。此前一个真实CLI turn超时且usage未知的事实仍保留；当前非推理验证不代表真实推理成功或零费用。
- Git仍未提交、未推送、未发布。下一步继续任务7与8；下文原会话的数字、机器未接入及版本受阻描述仅为历史。

- 产品目标：DS-Bot 界面 + dsh-model-router（MR）全部功能 + 远程电脑，合一为**单个插件**，最终上传 `Alice-Marx/dsh-model-router`。方案见 `plan/20261026_master_plan.md`（v1.1，32 需求 / 40 功能 / 63 验收场景 / 20 施工包）。
- **出厂默认单插件组合已在真实 rc.3 宿主验证通过**（7 项探针检查）：一个入口 = 冻结 DS Bot 运行时 + MR 插件体 + 一个策略 + 一个客户端 bundle。
- 完整回归：**1335 项，1332 通过，0 失败，3 跳过**（本机 Win11 / Node 24.20.0）。
- 所有改动都在**工作树中，未做任何 git 提交/推送**（等用户验证后授权）。
- 接手方从**任务 6（远程电脑产品接入）**开始；任务 5（默认组合）已完成。

## 1. 必读规则（先读再动手）

1. **模型调用仅 GPT**；本会话全部验证 0 次真实模型请求。任何“真实推理验收”留给用户自行运行。
2. **不擅自 git 提交/推送/发布**；用户明确说“全部工程做完后我自己验证”。
3. **完成必须有证据**：代码 + 测试/探针 + `docs/integration/evidence/` 证据文件 + 台账（tasks.json/PROGRESS.md/STATUS.txt/behavior-audit.json）同步更新；不要把未验证的标成 completed。
4. 文档用**相对路径**、中文优先；不把真实端点/账户/密钥写进公共文档（用占位符，见 `deployment-profile.md`）。
5. 台账格式：`tasks.json` 与 `behavior-audit.json` 是 **CRLF + 2 空格缩进**；`package.json` 是 **LF**。用脚本改 JSON 时先做往返一致性守卫再写。
6. 临时脚本放 `scripts/tmp-*.mjs`（**必须是 .mjs**，项目是 ESM；.cjs 不能用 import）并在用完删除；shell 内联 node -e 的反斜杠会被吞，写文件更稳。
7. 完成后运行 `npm run integration:check`（校验台账）与 `npm test`（完整回归）。

## 2. 本会话完成的工作

### 2.1 盘点并验证既有未提交工作（任务 1）
工作树里有大量前会话未提交实现，逐项验证后确认可用并登记：
- `modules/bot-runtime`（冻结 DS 迁入，297 文件字节级核对）、`packages/cli-runtime` + `cli-bootstrap/cli-stdio-bridge`、`remote-computer-agent` + `native/windows-desktop` + `deploy/remote-agent`、`apps/integration-client`、`model-accounting/model-receipt`。
- 验证数字（本机 Win11）：上游 DS 套件 1062/1061/1；原生资金 27/27；原生 CLI 桥 3/3；远程 agent 11/11；浏览器 5 项；Win11 桌面 8 项；Task 原生 28/28（含新增）。

### 2.2 测试与 CI 注册（任务 2）
- 4 个新测试文件进入 `npm test`；新增 10 个 probe 脚本注册；CI integration-host 作业加入 7 个探针步骤（含本次默认组合），超时 15→25 分钟。

### 2.3 证据与台账（任务 3）
新增 6 个证据文件：`evidence/20261027_m1_bot_runtime.json`、`20261027_m0_model_accounting.json`、`20261027_m0_cli_runtime.json`、`20261027_m0_remote_agent.json`、`20261027_m0_budget_wait_expiry.json`、`20261027_m1_default_composition.json`。台账更新：14 个 T 场景转 partial、W03/W09/W11/W15 转 in_progress、behavior-audit 增至 20 组（E15–E20）、创建 `deployment-profile.md`（M0 §8.4 交付物，占位符 + 如实状态）。修正了证据文件中 sourceGitBlobs 的转录错位（按 `git hash-object` 逐文件重算）。

### 2.4 预算等待自动到期（任务 4 的一部分）
- `packages/orchestration/src/task-journal.mjs` 新增 `expire(identity, now)`：单事务把超过总 deadline 的 `waiting-budget` 任务置为 `failed`/`BUDGET_WAIT_EXPIRED`（带事件、不新增 attempt）。
- `task-service.mjs` 在启动与每次心跳续期时驱动扫描；`tests/task-journal.native.mjs` 增加 2 项测试（journal 级确定性 + 服务级心跳驱动）；Task 原生检查 26→28。

### 2.5 出厂默认单插件组合（任务 5，核心）
- 新模块 `packages/orchestration/src/product-composition.mjs`：`startBotProduct(ctx, options)`（同步段建 authority/directory/policy 并提供 `botIntegrationPolicy`，有界初始路线快照后创建 DS 运行时）、`compileProductGrant`（纯函数）、`createDiagnosticAccountStream`（有界诊断装饰器，不计费）。
- `.dsh-plugin/index.mjs`：`apply()` 顶部接入受守卫的组合；`inject` 合并 DS 运行时注入；Config 新增 `botProduct`（默认 true）。
- 客户端收敛：`.dsh-plugin/client.js` 即产品 bundle（由 `apps/integration-client/index.jsx` 生成，2,045,678 字节 / 118 输入）；`build-client.mjs` 委托产品生成器；重复的 `apps/integration-client/client.js` 在字节一致验证后删除；GAL 防护改为内容级（标识禁则 + 嵌入图片载荷 <4096 + 生成器输入路径检查）。
- 发布清单：`package.json` files 增至 230 项，携带完整运行时闭包（bot-runtime、vendor DS 源逐文件、orchestration 原语）。
- 新探针 `scripts/integration-product-default.mjs`：无 fixture、加载出厂默认入口，7 项检查通过（见下）。
- 既有探针不回归：product-host（fixture 组合）4 项、combined-host --legacy-policy 9 项通过（overlay 加 `botProduct: false` 保持隔离组合逐字节不变）。
- 测试更新：`tests/product-composition.test.mjs`（6 项新测试）、`cordis-inject`/`install-settings-host` 补 DS 服务、`plugin-split` GAL 断言改内容级、`strict-ctx` HOST_INJECT 同步。

## 3. 当前验证状态（复跑入口）

```sh
npm test                                    # 1335/1332/0/3
npm run integration:check                   # 台账有效
npm run check:client                        # 出厂 bundle 与生成器一致
node scripts/integration-product-default.mjs   # 默认组合 7 项（出厂路径）
node scripts/integration-product-host.mjs      # fixture 组合 4 项
node scripts/integration-combined-host.mjs --ds-root tmp/integration/upstream/ds-bot-frozen --host-root tests/fixtures/integration-host --legacy-policy
node scripts/integration-task-probe.mjs        # 28/28
node scripts/integration-finance-probe.mjs     # 27/27
node scripts/integration-cli-native.mjs        # 3/3
node scripts/integration-remote-agent.mjs      # 11/11
```

SQLite 类探针需要 `tmp/integration/probes/sqlite` 已装 better-sqlite3@13.0.3（CI 有安装步骤；本机已装）。

## 4. 未完成的工作（按建议顺序）

### 任务 6：远程电脑产品接入（W09.2）— 建议下一个做
- 产品机器页/只读投影（read-model 的 machines section 现在返回 blocked）、secretRef 配对流程（Host 侧 `/control/v1` 配对、凭据入秘密界面）、Bot 机器授权/撤销、ping 与受控读测试入口。
- agent 侧已完成（配对/授予/撤销、fs/shell/browser/desktop 工具、Streamable HTTP、worktree）；缺的是 Host/UI 侧对接与真实部署。

### 任务 7：CLI 执行 facade（W11.2/W12）
- 官方 CLI 按 Bot 绑定的执行 facade（`probe/prepare/start/observe/cancel/collect/reconcile` 适配器接入 Task/Execution/Policy/Accounting）；目前 Bot 对执行类工具被策略拒绝（`EXECUTION_FACADE_REQUIRED`，见 `bot-policy.mjs` 的 pendingExecutionFacade）。
- **真实 codex 入口受阻**：本机 codex-cli 0.157.1 的 `app-server` 在任何重定向 home 下都死于 sqlite state runtime 初始化（诊断过程见 `evidence/20261027_m0_cli_runtime.json` 的 realCodexEntryProbe）。适配器按 0.163.0 编写。**需要用户决策**：取得 0.163.0，还是适配 0.157.1 的 daemon/proxy 模式。

### 任务 8：剩余门禁项 + 最终全量验证
- **Task/outbox 与资金单事务准入**（task-service + journal + sqlite-router-state 合一，当前两者分开且各有 fence）。
- **缺收据人工核对 UI**（model-accounting 的 unknown 收据阻塞下次计费调用，需要产品侧核对入口）。
- **资金权威接入默认路径**：默认组合的 accountStream 是诊断装饰器；逐来源收据/预算准入/订阅计量要接 SQLite（M2/W06，涉及默认 profile 的数据迁移，谨慎）。
- W01.4 行为审查补齐（20/40 组）。
- 最终全量验证 + 三机复跑。

### 其他未开始施工包
W03.4（用户配置迁移/旧安装升级）、W04（MR 兼容 facade 收尾）、W06、W07（Planner 选 Bot）、W08（DAG/取消/恢复）、W10（Linux 产品侧）、W12、W13（浏览器产品侧）、**W14（功能并集与完整 UI，两仓全部能力产品化）**、W16（DPI/会话/桌面互斥）、W17（隔离/性能/升级）、W18（Desktop/Docker/运维文档——deploy 脚本已存在但无干净安装验证）、W19（全量验收）、W20（发布字节核对）。

### 环境受阻项（需要用户或特定条件，不要假装完成）
1. 真实 codex 0.163.0 入口（见任务 7）。
2. Ubuntu/Win10 复跑——本轮所有新验证仅本机 Win11；远程两机需用户提供访问。
3. Win10/Win11 实机桌面验收、DPI/多屏、UAC/锁屏/RDP（W15.2/W16）。
4. 生产常开部署 + 笔记本休眠拓扑（`deployment-profile.md` 已用占位符交付）。
5. 真实 GPT 模型推理验收。
6. git 提交/推送/npm/GitHub Release——工作树全是未提交改动，等用户验证。

## 5. 关键踩坑记录（重要，避免重犯）

1. **路线目录必须取原始目录**：`discoverConfiguredRoutes` 带策略过滤（`filterRoutes` 在执行上下文外抛 `CALL_CONTEXT_REQUIRED`），用作授予编译的路线源会让所有 Bot 拿不到模型授权（表现为 `MODEL_DENIED`，内存复查调用最先暴露）。组合模块因此内置原始 `ctx.llm` 目录遍历。
2. **apply() 的组合守卫**：轻量 mock ctx（无 Cordis 表面或 DS 服务）必须跳过组合，否则 boot 失败会经 failClosed 异步抛异常炸掉测试进程。守卫 = `provide/effect` 是函数 **且** 8 个 DS 服务经 `ctx.get` 可解析。
3. **测试夹具双重组合**：探针 overlay 必须给 MR 配 `botProduct: false`（`integration-product-host.mjs`、`integration-combined-host.mjs` 全模式已加），否则默认入口与 fixture 插件会重复 provide/重复建 DS runtime。
4. **发布清单逐文件**：`tests/roadmap.test.mjs` 的闭包检查要求 files 清单包含每个被导入的**具体文件**，目录条目不满足；vendor DS 的 129 个 src 文件已逐条加入。
5. **bundle 大小不是 GAL 护栏**：统一产品 bundle 合法 2MB；GAL 断言已改为标识禁则 + 嵌入图片载荷上限 + 生成器输入路径检查（`tests/plugin-split.test.mjs`）。
6. **JSON 文件换行**：tasks.json/behavior-audit.json 是 CRLF，package.json 是 LF；脚本改 JSON 前先往返守卫。
7. **诊断装饰器不是记账**：默认组合的 accountStream 只记身份/来源（有界环形缓冲），任何“费用/预算”宣称都超出其范围。
8. **`assert.rejects` 同步抛出**：`service.retry` 是同步函数，测试里要包一层 `async () => service.retry(...)`，否则 Node 把同步异常当测试失败。
9. **journal 测试的 now 不能超过 runner 租约**：`store(t)` 辅助函数claim 1000ms 租约，测试里的 now 值要小于它。

## 6. Git 状态

- 分支 `feat/bot-integration`，HEAD 仍是 `89e8312`（前会话最后一个提交）。**本会话及前会话的全部工作都在工作树未提交**：约 300+ 个未跟踪/修改路径（含 `modules/`、`packages/`、`remote-computer-agent/`、`native/`、`deploy/`、`apps/`、`docs/integration/` 更新、`.dsh-plugin/index.mjs`、`package.json`、CI 等）。
- 接手方**不要擅自提交**；用户验证后若要提交，需按路径分组、只含本任务相关文件。

## 7. 建议的接手顺序

1. 读 `PROGRESS.md`（尤其两个 2026-10-27 检查点章节）→ 跑第 3 节复跑入口确认环境一致。
2. 任务 6：远程电脑产品接入（machines 投影 + secretRef 配对 + Bot 授权），照 `read-model.mjs` 的 provider 契约与 `remote-computer-agent/README.md` 的配对/授权流程做；补集成测试与证据。
3. 任务 7：CLI 执行 facade；先让用户定 codex 版本决策。
4. 任务 8：单事务准入 → 缺收据 UI → 资金接入默认路径 → W01.4 补齐 → 最终验证。
5. 每项完成都按第 1 节规则 3 更新证据与台账。
