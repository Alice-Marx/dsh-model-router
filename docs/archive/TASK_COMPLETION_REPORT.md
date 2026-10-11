# Model Router + GALGame 两项任务完成报告

## 1. 报告概况

| 项目 | 内容 |
|---|---|
| 项目目录 | `F:\DeepSeek_harness\model-router-galgame` |
| 任务一 | 为 Model Router + GALGame 插件集成 ModLens 图片理解能力 |
| 任务二 | 创建路由优化算法实验插件并运行六组论文实验 |
| 依据文档 | `MODLENS_INTEGRATION_INSTRUCTION.md`、`EXPERIMENT_PLUGIN_INSTRUCTION.md`、`RESEARCH_PAPER_FRAMEWORK.md` |
| 完成状态 | 官方 ModLens 集成、DeepSeek 视觉复测与实验框架已落地；严格视觉验收仍有未完成项 |
| ModLens 版本 | `@liustack/modlens@3.25.4`（原生 DSH bundle，无独立服务地址） |
| 实验运行方式 | `cd experiment-plugin && npm start` |

本报告记录实施过程、技术方案、验证结果、输出物和当前边界。任务一曾误把本地关键词
测试桩当作 ModLens 服务；相关结论现已撤销，并改为安装官方 npm bundle。真实 DSH
联调显示：模型列表、图片 attachment 和官方调用链均已恢复。视觉引擎已切换为 DeepSeek
官方兼容接口，当前样本识别正确但耗时约 10.34 秒。严格代码错误、图表、成本和
`<3 秒` 验收仍未全部完成。详见
[MODLENS_REAL_USAGE_REPORT_2026-09-02.md](../../MODEL-file/MODLENS_REAL_USAGE_REPORT_2026-09-02.md)。
任务二采用固定随机种子的离线数据和执行模拟器，验证路由算法、指标计算和报告
生成流程，不把模拟结果描述为真实供应商 API 的质量评测。

## 2. 总体完成情况

### 2.1 任务一完成情况

- 已安装官方 `@liustack/modlens@3.25.4`，与 GAL 路由器共同加载。
- 官方插件注册 `modlens_read_image` 工具、Web 粘贴处理、设置卡和动态包装 provider。
- 已删除路由器内的伪 HTTP ModLens 客户端、伪 provider 和 8000 端口运行时依赖。
- GAL 模型目录改为读取 DSH 官方 `modelCatalog()`，模型切换走官方 `selectModel()`。
- 集体模式检测到图片且目标为纯文本模型时，切换到对应官方包装 provider；原生视觉模型保持原路由。
- 已现场验证 3 个原始 DeepSeek 模型与 2 个 `(modlens vision)` 模型同时可见。
- 官方 CLI 真实读取已跑通。DeepSeek `deepseek-v4-flash-vision-exp` 正确返回 OCR、布局和语义结果，耗时约 10.34 秒；因此当前样本的视觉链路通过，但代码错误金样本、图表数据点、成本节省和 `<3 秒` 指标仍未通过或未验证。

### 2.2 任务二完成情况

- 已创建独立 `experiment-plugin` 项目结构、配置文件、README、测试和输出目录。
- 已实现 QCG-Router、AMO-Router、DAG-Assign 以及 Random、Cheapest、Best、Rule-based 基线。
- 已实现六个实验模块：单任务性能、权重敏感性、协作模式、在线学习、预算约束和消融实验。
- 已实现 PNG 图表生成器、Markdown 表格生成器和完整实验报告生成器。
- 已执行全部实验，生成 15 张 PNG、原始 JSON、实验日志和 Markdown 报告。
- 实验插件测试全部通过，六个实验在最终运行中均无失败项。

## 3. 任务一：官方 ModLens 集成实施过程

### 3.1 纠错与官方架构

初版实现依据集成说明自行创建了 Python HTTP 服务、`ModLensClient` 和
`ModLensIntegration`，但复核官方仓库后确认这不是 ModLens 的公开架构。官方 3.25.4
是原生 DSH npm bundle：它注册 `modlens_read_image`，动态生成 `(modlens vision)`
包装模型，并在请求时通过 DSH attachment store 读取图片、调用包内 CLI、注入 v2
结构化证据。旧测试桩不读取像素，其准确率和 43 ms 延迟结论全部撤销。

### 3.2 安装与配置

正常 Web profile 同时保留：

```text
model-router-galgame
@liustack/modlens@3.25.4
```

视觉引擎由官方设置卡或 `modlens config` 管理，配置位于
`C:\Users\Jianw\.modlens\config.json`。GAL 不再保存 ModLens 地址或密钥，也不需要
Docker、Python 服务或 8000 端口。

### 3.3 模型目录修复

GAL 过去依赖自身的 ModelDirectory 投影，恢复会话或 adapter 刷新时可能长期停在
“正在读取模型”，看起来像模型被删除。现在直接以 DSH 官方
`remote.session.modelCatalog()` 作为显示来源，并以
`remote.session.selectModel()` 作为备用选择通道。现场可见 3 个原始 DeepSeek 模型
和 2 个官方包装模型，且包装条目与普通条目之间可切换。

### 3.4 集体模式协调

模型评分仍只针对真实上游路由，官方包装路由不会和自己的上游重复参与优化。本轮消息
含图片、计划目标不声明图片能力且存在匹配包装模型时，请求 provider 才映射为官方
包装 provider；原生视觉模型、无图片消息和找不到包装的其他路由均保持不变。图片检测
覆盖顶层图片和 `tool-result` 内的嵌套图片，与官方 ModLens 转换边界一致。

### 3.5 真实验证

| 验证项 | 当前结论 |
|---|---|
| 官方 bundle 与工具 | 通过 |
| GAL 完整模型目录 | 通过 |
| 官方包装模型切换 | 通过 |
| 集体模式图片路由回归 | 通过 |
| DeepSeek Vision Exp 真实读图 | 通过当前样本；OCR、布局和语义结果正确 |
| DSH 图片上传与 attachment | 通过；包装模型历史记录可见 |
| 纯文本模型基于描述回答 | 通过当前样本；正确回答截图文字问题 |
| 代码截图错误识别 | 部分通过；UI 截图 OCR 正确，代码错误金样本尚未验证 |
| 图表数据点提取 | 未验证 |
| 成本节省 >95% | 未验证 |
| 理解时间 <3 秒 | 未通过，DeepSeek Vision Exp 实测约 10.34 秒 |

真实结果见 [MODLENS_REAL_USAGE_REPORT_2026-09-02.md](../../MODEL-file/MODLENS_REAL_USAGE_REPORT_2026-09-02.md)。

## 4. 任务二：实验插件实施过程

### 4.1 项目结构

项目目录：[experiment-plugin](/F:/DeepSeek_harness/model-router-galgame/experiment-plugin)

实现了文档要求的主要目录：

```text
experiment-plugin/
├── package.json
├── config.json
├── README.md
├── src/
│   ├── algorithms/
│   ├── datasets/
│   ├── experiments/
│   ├── metrics/
│   ├── visualization/
│   └── utils/
├── data/
├── outputs/
└── tests/
```

### 4.2 数据和复现策略

为了让实验在没有外部数据集、API Key 和付费模型的环境下可重复运行，使用了固定种子 `20260902` 的合成任务生成器。任务覆盖 `general`、`code`、`math`、`writing`、`research` 和 `vision`，并按照 `simple`、`balanced`、`complex` 分配质量下限。

任务包含文本长度、任务类型、复杂度和质量约束；执行阶段使用确定性伪随机扰动模拟实际成本、质量和延迟。这样可以验证算法和统计管线，但不替代真实 MMLU、HumanEval、GSM8K API 评测。

### 4.3 三个核心算法

#### QCG-Router

文件：[qcg-router.mjs](/F:/DeepSeek_harness/model-router-galgame/experiment-plugin/src/algorithms/qcg-router.mjs)

实现流程：

1. 根据复杂度读取质量下限。
2. 估算每个模型的质量、成本、延迟、专长匹配和风险。
3. 过滤满足质量下限的候选模型。
4. 按论文中的质量、成本、延迟、专长和风险权重计算效用。
5. 选择效用最高的可行模型；没有可行候选时使用质量最高的回退模型。

#### AMO-Router

文件：[amo-router.mjs](/F:/DeepSeek_harness/model-router-galgame/experiment-plugin/src/algorithms/amo-router.mjs)

AMO-Router 继承 QCG 的质量和成本估计，增加：

- simple、balanced、complex 三组独立权重。
- 每次路由后的历史记录。
- 根据实际成本、实际质量、目标成本和质量下限进行在线更新。
- 非负投影和归一化，确保权重和为 1。

#### DAG-Assign

文件：[dag-assign.mjs](/F:/DeepSeek_harness/model-router-galgame/experiment-plugin/src/algorithms/dag-assign.mjs)

实现流程：

1. 使用 Kahn 算法进行拓扑排序并检测环。
2. 反向计算节点关键度，综合节点附加高权重。
3. 普通节点使用 QCG 路由，综合节点优先高质量模型。
4. 检查预算，必要时选择剩余预算内的低成本模型。
5. 返回分配表、总成本、平均质量、拓扑序、关键度和预算满足状态。

同时实现了 Random、Cheapest、Best 和 Rule-based 四个对比基线，供实验一和消融分析使用。

### 4.4 六组实验

| 实验 | 实现文件 | 主要变量 | 主要输出 |
|---|---|---|---|
| 实验 1：单任务路由性能 | `experiment-1-single-task.mjs` | 任务、算法、模型 | 成本、质量、延迟、QSR、CSR |
| 实验 2：权重敏感性 | `experiment-2-weight-sensitivity.mjs` | 质量/成本权重网格 | Pareto 前沿、热力图、质量曲线 |
| 实验 3：协作模式 | `experiment-3-collaboration.mjs` | 单模型与 DAG 协作 | 协作质量提升、成本对比 |
| 实验 4：在线学习 | `experiment-4-online-learning.mjs` | 1000 次迭代、学习率 | 权重收敛、效用变化 |
| 实验 5：预算约束 | `experiment-5-budget-constraint.mjs` | `$0.001` 至 `$0.05` 预算 | 质量-预算、满足率、成本曲线 |
| 实验 6：消融实验 | `experiment-6-ablation.mjs` | 关闭质量、专长、协作、学习 | 质量和成本影响 |

### 4.5 指标实现

指标模块位于 `src/metrics/`：

- `cost-calculator.mjs`：按输入/输出 token 和 USD 每百万 token 价格计算成本。
- `quality-evaluator.mjs`：在预测质量基础上产生受控扰动。
- `latency-tracker.mjs`：根据模型平均延迟生成执行延迟。
- `metrics-aggregator.mjs`：按算法聚合平均成本、平均质量、平均延迟、质量约束满足率和成本节省率。

其中：

```text
QSR = 满足质量下限的任务数 / 总任务数
CSR = (Best 基线平均成本 - 当前算法平均成本) / Best 基线平均成本
```

### 4.6 图表和报告生成

文件：[chart-generator.mjs](/F:/DeepSeek_harness/model-router-galgame/experiment-plugin/src/visualization/chart-generator.mjs)、[report-builder.mjs](/F:/DeepSeek_harness/model-router-galgame/experiment-plugin/src/visualization/report-builder.mjs)

图表生成器使用 Node.js 标准库直接生成 PNG，避免依赖原生 `canvas` 编译环境。支持：

- scatter：成本-质量散点图。
- bar：算法/预算柱状图。
- line：收敛、质量和满足率曲线。
- heatmap：权重敏感性热力图。
- paretoFront：帕累托点计算与可视化。
- table：Markdown 表格。

报告生成器会读取所有实验结果，输出执行摘要、逐实验统计表、图表链接、结果解读、结论和复现配置。

### 4.7 实验运行过程

主入口：[src/index.mjs](/F:/DeepSeek_harness/model-router-galgame/experiment-plugin/src/index.mjs)

运行过程：

1. 读取 `config.json`。
2. 注册六个实验。
3. 按顺序运行实验并记录耗时。
4. 捕获单个实验错误，避免一个模块阻断整套实验。
5. 补充扩展图表，写入 `outputs/charts/`。
6. 写入 `outputs/data/raw-results.json` 和 `experiment-log.txt`。
7. 生成 `outputs/reports/EXPERIMENT_REPORT.md`。

最终命令：

```text
cd F:\DeepSeek_harness\model-router-galgame\experiment-plugin
npm start
```

### 4.8 实验结果

报告文件：[EXPERIMENT_REPORT.md](/F:/DeepSeek_harness/model-router-galgame/experiment-plugin/outputs/reports/EXPERIMENT_REPORT.md)

实验一的实际汇总如下：

| 算法 | 平均成本 USD | 平均质量 | QSR | CSR |
|---|---:|---:|---:|---:|
| Random | 0.008845 | 0.929 | 98.3% | 62.9% |
| Cheapest | 0.000241 | 0.835 | 89.2% | 99.0% |
| Best | 0.023849 | 0.991 | 100.0% | 0.0% |
| Rule-based | 0.009931 | 0.895 | 100.0% | 58.4% |
| QCG-Router | 0.002545 | 0.935 | 100.0% | 89.3% |
| AMO-Router | 0.002541 | 0.936 | 100.0% | 89.3% |

其他实验结论：

- 协作实验平均质量为 `0.989`，单模型基线为 `0.940`。
- AMO 在线学习实验运行 `1000` 次迭代，权重持续归一化并生成收敛曲线。
- 预算实验覆盖 `$0.001`、`$0.005`、`$0.01`、`$0.02`、`$0.05` 五档预算。
- 消融实验覆盖 `full`、`no-quality-constraint`、`no-specialty`、`no-collaboration` 和 `no-learning`。

### 4.9 实验输出清单

目录：[outputs](/F:/DeepSeek_harness/model-router-galgame/experiment-plugin/outputs)

当前输出包括：

- `outputs/charts/`：15 张 PNG 和 1 个 Markdown 性能表。
- `outputs/data/raw-results.json`：约 386 KB 的逐任务、逐算法结果。
- `outputs/data/experiment-log.txt`：完成时间日志。
- `outputs/reports/EXPERIMENT_REPORT.md`：完整实验报告。

PNG 文件包括：

```text
exp1-cost-quality-scatter.png
exp1-cost-by-algorithm.png
exp1-latency-by-algorithm.png
exp2-pareto-front.png
exp2-quality-weight-curve.png
exp2-weight-heatmap.png
exp3-collaboration-comparison.png
exp3-collaboration-scatter.png
exp4-convergence-curve.png
exp4-utility-curve.png
exp5-quality-budget-curve.png
exp5-budget-satisfaction.png
exp5-cost-by-budget.png
exp6-ablation-bar-chart.png
exp6-ablation-cost.png
```

## 5. 自动化验证记录

### 5.1 主插件与官方 ModLens

执行：

```text
npm test
npm run build:client
```

结果：

- 主插件测试：44 项通过，0 项失败。
- 客户端构建：成功生成客户端 bundle。
- ModLens 路由回归覆盖图片包装路由、原生视觉绕过、无图片绕过和嵌套图片检测。
- `modlens doctor`：Node 与视觉 CLI 可发现；当前默认 provider 已切换为 DeepSeek
  OpenAI-compatible 路线，凭据仅保存在本机配置中。

### 5.2 实验插件

执行：

```text
npm test
npm start
```

结果：

- 算法测试：2 项通过，0 项失败。
- 六组实验：全部完成。
- PNG 文件：15 张。
- 报告、原始数据和日志：均已生成。

### 5.3 真实 DSH 联调

1. `http://127.0.0.1:3080/` 由现有 DSH 进程监听；重复启动报 `EADDRINUSE` 属于端口占用提示。
2. 正常连接页面显示 3 个原始 DeepSeek 模型和 2 个 `(modlens vision)` 模型。
3. 官方 ModLens CLI 使用 DeepSeek `deepseek-v4-flash-vision-exp` 成功返回 v2 JSON；
   OCR、布局和语义结果与截图一致，耗时约 10.34 秒。
4. 选择 `deepseek-modlens/deepseek-v4-pro` 后上传 JPEG，DSH attachment 被接受并在
   历史记录中保留；纯文本模型正确回答截图文字问题。
   实际回答为：“截图里出现了‘ModLens 已启用’。可确认的 5 个可见文字：DSH 本地
   构建、新会话、DeepSeek 连接成功、DeepSeek娘、输入你想说的话....”。
5. 因此插件安装、模型发现、图片上传、包装路由和当前样本识别均通过；代码错误金
   样本、图表数据点、成本节省和 `<3 秒` 延迟验收仍未通过或未验证。

## 6. 交付文件索引

### ModLens 集成

- [index.mjs](/F:/DeepSeek_harness/model-router-galgame/.dsh-plugin/index.mjs)
- [modlens-routing.mjs](/F:/DeepSeek_harness/model-router-galgame/.dsh-plugin/shared/modlens-routing.mjs)
- [model-directory-bridge.mjs](/F:/DeepSeek_harness/model-router-galgame/.dsh-plugin/client/model-directory-bridge.mjs)
- [SettingsTab.jsx](/F:/DeepSeek_harness/model-router-galgame/.dsh-plugin/client/SettingsTab.jsx)
- [modlens-routing.test.mjs](/F:/DeepSeek_harness/model-router-galgame/tests/modlens-routing.test.mjs)
- [model-directory-bridge.test.mjs](/F:/DeepSeek_harness/model-router-galgame/tests/model-directory-bridge.test.mjs)
- [MODLENS_DEPLOYMENT.md](../../MODEL-file/MODLENS_DEPLOYMENT.md)
- [MODLENS_TEST_REPORT.md](../../MODEL-file/MODLENS_TEST_REPORT.md)
- [MODLENS_REAL_USAGE_REPORT_2026-09-02.md](../../MODEL-file/MODLENS_REAL_USAGE_REPORT_2026-09-02.md)

### 实验插件

- [experiment-plugin/README.md](/F:/DeepSeek_harness/model-router-galgame/experiment-plugin/README.md)
- [experiment-plugin/config.json](/F:/DeepSeek_harness/model-router-galgame/experiment-plugin/config.json)
- [实验报告](/F:/DeepSeek_harness/model-router-galgame/experiment-plugin/outputs/reports/EXPERIMENT_REPORT.md)
- [原始结果](/F:/DeepSeek_harness/model-router-galgame/experiment-plugin/outputs/data/raw-results.json)
- [outputs 目录](/F:/DeepSeek_harness/model-router-galgame/experiment-plugin/outputs)

## 7. 当前边界与后续建议

1. 当前官方 ModLens 默认使用 DeepSeek `deepseek-v4-flash-vision-exp`；当前样本约
   10.34 秒且识别正确，但仍需用代码错误和图表金样本做准确率复测，并继续优化到
   `<3 秒`。
2. 当前实验默认使用合成任务和模拟执行器；论文正式版本建议替换为真实 MMLU、HumanEval、GSM8K 样本及可审计的模型 API 结果。
3. 当前 PNG 生成器不依赖原生图形库，重点保证可复现和可批量生成；若论文排版需要坐标轴文字、字体、图例和出版级主题，可在相同数据接口上接入 Matplotlib、Plotly 或企业图表服务。
4. ModLens 官方 Web 路由已经限制回环访问、检查图片 magic bytes 和大小；额外端点的凭据与图片数据仍应按供应商安全要求处理。
5. 成本节省率必须同时报告视觉引擎和后续纯文本模型的真实消耗，并与完成同一任务的多模态基线比较。

## 8. 最终结论

任务一已按官方 ModLens 架构完成安装、模型目录、图片 attachment 和路由协调，模型
列表恢复，DeepSeek Vision Exp 官方 CLI 及 DSH 包装模型端到端可执行；当前 UI 截图
样本识别正确，纯文本模型也能基于描述回答。但代码错误和图表金样本尚未验证，真实
成本节省没有账单对照，单次视觉耗时约 10.34 秒，故 `<3 秒` 指标未达成，任务一应
标记为“集成完成、严格验收进行中”。任务二完成了论文框架要求的三类核心算法、六组
模拟实验、指标统计、PNG 图表和 Markdown 报告生成；这些输出适合实验流程与论文草稿，
不等同于真实模型 API 基准。
