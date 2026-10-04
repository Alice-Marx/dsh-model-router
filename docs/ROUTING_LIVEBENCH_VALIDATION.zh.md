# LiveBench：最新证据与同题质量—成本验证

核查日期：2026-10-03（Asia/Shanghai）。对应本地未发布 `0.16.0-dev.1`，稳定版本仍为 `0.15.0`。

本轮依用户要求，将真实数据调查从 LLMRouterBench 转为 LiveBench。结论是：**找到最新公开聚合数据，但尚未取得这个版本的完整逐题质量—费用矩阵，不能宣称新路由算法已经获得真实质量—成本收益。** 已实现聚合审计和连续分配对统计工具；未训练路由器、未付费调用、未修改生产选模逻辑、未发布。

2026-10-04扩展检索：[逐题文件查找与候选审计](ROUTING_LIVEBENCH_DATA_SEARCH.zh.md)。实际下载了答案附件、历史评分包及单模型日志，核验全部120官方分支与10个HF数据集；这些候选仍不满足最新完整同题质量—费用矩阵条件。

## 1 来源、日期与证据粒度

不同日期不能互相替代：论文日期描述研究，仓库提交日期描述代码变化，release 日期描述题集，而数据文件日期描述实际公开记录。

| 官方来源 | 固定版本／日期 | 能直接使用的证据 | 不能推断的内容 |
|---|---|---|---|
| [当前官网](https://livebench.ai/)与[新站源码](https://github.com/LiveBench/new-livebench/tree/caa4253c8a3aa93b5c7ec234e681d4f120a20240) | release `2026-06-25`；源码 `caa4253…`（2026-09-29 提交） | 66 个模型变体 × 23 个任务，分属 7 类；任务均分、任务总费用与题数 | 每个模型在同一道题上的答案、质量分和费用 |
| [公开逐题评分](https://huggingface.co/datasets/livebench/model_judgment/tree/9704e5da7bfbefe75ac1482a13de827127295993) | revision `9704e5…`；2025-04-07 更新 | 60,372 行；`question_id/task/model/score/turn/tstamp/category` | 2026 题集结果；逐题 token 或费用 |
| [公开逐题回答](https://huggingface.co/datasets/livebench/model_answer/tree/bc43a286b08243d6dcfa89ba2e906283e9adac9c) | revision `bc43a2…`；2024-10-22 更新 | 回答文本及 task/category/model 等元信息 | 与最新题集一致的完整矩阵；实际计费用量 |
| [采集与评价源码](https://github.com/LiveBench/LiveBench/tree/8f8e5c381a16e3f24257776edd53471fe86f8091) | `8f8e5c…`（2026-09-29 提交） | 可检查当前评分、采集方式 | 源码支持记录费用，不代表相应逐题数据已公开 |

这里的“尚未取得”指本轮核查的官方公开文件、官网前端取数路径和下载工具；不声称作者没有内部数据。最新费用生成说明指向 `livebench-private`。[官方数据布局说明](https://github.com/LiveBench/new-livebench/blob/caa4253c8a3aa93b5c7ec234e681d4f120a20240/README.md)

三个最新官方文件已下载到本机不可变 raw 档案；源码和元信息共 12 份，另有来源 manifest。仓库仅交付审计脚本和派生报告，不复制未知独立许可的原始表。

| 文件 | bytes | SHA256 |
|---|---:|---|
| `table_2026_06_25.csv` | 11,069 | `1021e4ef211ccba609d6da2c22032f46d695c1546508cf144a58a2f3d6960f3d` |
| `categories_2026_06_25.json` | 725 | `dad300ad18655b69db720e1b88fc5a5eac06c5b2f0e52c2bf50f10ff057674f3` |
| `cost_2026_06_25.csv` | 28,845 | `d572014a891e76ef3f30896f66cc873ec02eb5c7d10909a6796efe450ad05ba9` |

官方 datasheet 声明 benchmark suite 使用 Apache-2.0；HF 元信息及新站聚合表未单独标明各文件许可，不将代码许可自动扩大为所有原始题目、回答和聚合表的再分发许可。[datasheet](https://github.com/LiveBench/LiveBench/blob/8f8e5c381a16e3f24257776edd53471fe86f8091/docs/DATASHEET.md)

## 2 最新表应该怎样计算

令 $S_{mt}$ 为模型 $m$ 在任务 $t$ 的公开平均分（0–100），$T_k$ 是类别 $k$ 的任务集合。完整覆盖时：

$$Q_{mk}=\frac1{|T_k|}\sum_{t\in T_k}S_{mt},\qquad Q_m=\frac17\sum_{k=1}^{7}Q_{mk}.$$

这是类别等权的质量画像，不是所有题的微平均。任务总费用 $C_{mt}$、有效计数 $n_{mt}$ 给出：

$$\bar C_m=\frac{\sum_t C_{mt}}{\sum_t n_{mt}}.$$

费用按题数加权，不能先求每类费用均值再除以 7。保留精确模型 ID 和 effort/reasoning 后缀，不把不同动作合并成同一模型。公式来自官方[质量平均代码](https://github.com/LiveBench/new-livebench/blob/caa4253c8a3aa93b5c7ec234e681d4f120a20240/src/Table/Averaging.js)和[费用计算代码](https://github.com/LiveBench/new-livebench/blob/caa4253c8a3aa93b5c7ec234e681d4f120a20240/src/lib/compute.js)。

`livebench-aggregate-audit.mjs` 使用自己的严格文本解析，不执行下载的 JavaScript。缺失分数/费用保留缺失，不填 0；拒绝重复模型 ID、非法数值、重复列及不一致格式。先按完整计数向量的众数确定审计对照组，选择不使用质量/费用优劣；只有全部 23 任务评分/费用/计数完整、计数向量相同且公开平均费用为正的模型，进入有价格的描述性静态 Pareto 比较。公开零费用保留原值并单列，不证明免费可用，不参与有价格前沿。计数相同仍**不能证明题目身份相同**。

静态 Pareto 的意思仅是：在这些聚合数值上，没有另一模型同时质量不低、费用不高且至少一项严格更好。不代表逐题路由最优，不代表 DAG 最优，不生成逐题样本、bootstrap 区间或算法收益结论。

数值审计使用 Neumaier 补偿求和／均值；支配关系比较使用微小计算容差：质量 $32\,\mathrm{EPSILON}\max(1,|Q_a|,|Q_b|)$（0–100分），费用 $32\,\mathrm{EPSILON}\max(|C_a|,|C_b|)$（USD/题，无绝对美元下限）。容差内视为平局，至少一项须超过容差才算严格改善；这不是业务非劣margin，也不是统计显著性界限。十进制文本精确检查符号、评分上界和正整数题数，拒绝非零下溢，避免先转浮点再把非法小数题数当整数。

最新聚合审计结果保存为 [latest-aggregate-audit.json](experiments/20261003-livebench/latest-aggregate-audit.json)。这是一份真实公开表的描述性检查，**不是新旧路由实验**。

### 2.1 实际聚合审计结果

三个文件 SHA256 与固定版本一致。66 模型均有完整任务评分/费用/计数，63 模型具有相同题数向量（总计 1,270）；3 模型计数向量不同，不进入对照池：`gpt-5.4-nano-xhigh`（1,246）、`gpt-5.4-mini-xhigh`（1,257）、`claude-opus-5-max-effort`（1,271）。另 `ox-alpha-max` 全任务公开费用为 0，作为未验证免费证据排除有价格前沿。最终有价格比较池 62 个动作，静态前沿 9 点：

| 精确动作 ID | 类别等权分 /100 | 公开聚合 USD/题 |
|---|---:|---:|
| `deepseek-v4-flash` | 65.48 | 0.010534 |
| `smaug-flash` | 77.44 | 0.010863 |
| `deepseek-v4.1-flash-max` | 81.11 | 0.023670 |
| `gpt-6.1-sol-xhigh` | 81.11 | 0.075744 |
| `gpt-6.1-sol-max` | 81.62 | 0.115550 |
| `claude-opus-5-5-xhigh-effort` | 82.06 | 0.199206 |
| `gpt-6-astra-max` | 82.16 | 0.604605 |
| `claude-opus-5-5-max-effort` | 83.22 | 0.665127 |
| `claude-fable-5-1-max-effort` | 83.41 | 1.010765 |

表中只舍入显示；前沿使用未舍入数值。两个显示为81.11的动作原始类别均分分别为81.109702…与81.110190…，故都保留；微小差异没有逐题区间支持，不称统计显著提升。费用沿用作者该release聚合计费口径，不是本项目账单或当前调用报价。这里没有本项目路由的选择记录，因此没有“节省X%且不降质”的实测结论。

## 3 为什么聚合表不能重建路由收益

以下是说明信息缺失的**人工反例，不是 LiveBench 实验**。两道题、两个模型，路由事先固定为“题 1 选 A，题 2 选 B”。

| 数据世界 | A 的逐题质量／费用 | B 的逐题质量／费用 | 每模型公开均分／均费 | 路由均分／均费 |
|---|---|---|---|---|
| 世界一 | `(1,0)`／`($1,$3)` | `(0,1)`／`($3,$1)` | 都为 `0.5 / $2` | `1 / $1` |
| 世界二 | `(0,1)`／`($3,$1)` | `(1,0)`／`($1,$3)` | 都为 `0.5 / $2` | `0 / $3` |

公开的模型任务均分和费用完全相同，固定路由却从高质量低成本变成低质量高成本。聚合过程丢失了查询特征、选中动作与逐题结果之间的联合关系。因此，不论排行榜有多新，不能从均分推出当前算法的质量—成本收益，也不能把任务均分复制成多道题来制造置信区间。

## 4 完整 LiveBench 回放仍需要的数据

取得数据后，必须先完成来源和覆盖审计，再冻结实验。最少字段如下；**这是待采集合同，不是已经拥有的数据**。

- 题集 release、category、task、question_id、完整 prompt 和题目时间元信息。
- 模型精确版本、provider、effort/reasoning、生成参数、回答、评分器版本及 `[0,1]` 质量分。客观评分可能有部分分，禁止 `Boolean(score)` 或把所有非 1 分剔除。
- 同题每个候选模型的费用或可复核计费桶，包含缓存、可计费隐藏推理、失败与重试；注明价表时间和估算/实收口径。无法从旧回答重新 tokenize 恢复这些数据。
- 运行时间、缺失和错误记录。失败不免费，费用未知不是 0，缺失不能按错误标签补齐。

ID 至少按 JSON 编码的 `(release, category, task, question_id)` 连接，不能只按 question_id。再根据规范化 prompt 及同源题族建立 group，防止重命名重复题跨 split。模型变体必须是独立动作；如果采集参数与本项目执行参数不同，只能评价该记录动作，不能冒称本项目线上执行效果。

### 4.1 计划中的固定协议

详情见 [evidence-protocol.json](experiments/20261003-livebench/evidence-protocol.json)。聚合审计的证据界限已固定；逐题协议仍待真实文件的元信息审计，当前不能宣称已完成预注册试验。

1. 同题完整候选池的覆盖资格在看测试优劣之前确定，公开所有排除理由。重复组整体划分；初步计划为 train/validation/test = 60/20/20，以固定盐的 group SHA256 进行划分。跨域重复组必须先合并并确定单一规范 domain，不能为保留分层而拆散。
2. 使用 train 构造同一套模型能力/费用先验给 0.15.0 和当前版本；关闭额外线上排行榜刷新。validation 选 best-single、cheapest-single 和诊断性 domain-single。每个模型的推理配置固定。需要学习/校准时另建独立校准集，本协议本身不认证概率。
3. 两版路由只读取 query 与冻结 profiles，不读取 test 答案、质量分、实际输出 token 或逐题费用。先写出全部选择并保存 hash，再连接结果。置换 test 标签或放大 test 费用不得改变选择。
4. 主实验限定为 `first-stage-model`：比较两版首个工作包所选动作在原题作者记录上的直接回答。**不重放 DAG**，也不测新推理等级的效果。另报告两版都恰好一个执行节点的共同子集覆盖，不能仅挑当前版容易完成的题。
5. 主比较为当前 balanced 分别对旧 balanced、validation best-single、domain-single，共 $K=3$。domain-single 只有在可获得相同 domain 信号时才是可部署基线；否则明确称使用基准域标签的诊断参照。随机、cheapest、其他 preset 和 hindsight Oracle 只作描述性补充，Oracle 不可部署。
6. 质量不降且费用严格降低才是收益。未经独立业务依据，不临时放宽非劣边界；初步主协议取 $\delta=0$。不得挑选 test 上最好的预算、seed 或 preset 作为主结果。

费用条件若只能用作者 token × 历史价表估算，结论只能是“该历史名义计费口径下的收益”；不能换成当前价表后仍称真实账单。当前价表重新计算须另标 counterfactual repricing。不能把模型输入/输出平均 token 当作每题实际用量。

### 4.2 已实现的配对统计

新模块 [routing-paired-statistics.mjs](../scripts/routing-paired-statistics.mjs) 接收已经冻结选择后连接好的真正逐题结果：

```js
import { pairedRoutingComparison } from './scripts/routing-paired-statistics.mjs'
// rows 来自真实逐题记录，不来自排行榜均分。质量保持 [0,1] 部分分。
const result = pairedRoutingComparison(rows, {
  strategy: 'new-balanced', reference: 'old-balanced',
  seed: 20261003, resamples: 4000, alpha: 0.05,
  claims: 3, nonInferiorityMargin: 0,
})
```

每行格式为 `{id,groupId,domain,outcomes:{策略名:{quality,costUsd}}}`，每个所比较策略必须在同一行有结果。兼容二元 `correct`；与 `quality` 并存时二者必须严格一致。

逐题差 $d_i=Y_{i,\pi}-Y_{i,b}$、$e_i=C_{i,\pi}-C_{i,b}$；主指标是 $\bar d$、$\bar e$，节省比为 $1-\bar C_\pi/\bar C_b$，不是逐题节省率的均值。宏领域质量差是领域内均差的等权平均。

每次在每个 domain 内有放回抽原数量的 group，整组保留所有题；两个策略共用抽样。组内题数不同会使每次 domain 的题数变化，微质量/平均费用按该次题数加权，宏质量仍领域等权；这是分层整组比率估计，不是固定领域行数权重的另一种估计。每次重新计算微/宏质量、费用和费用比。报告每个指标名义双侧 95% percentile 描述区间（四个区间没有同时覆盖校正），以及按 $\alpha/(2K)$ 分配的质量下界 $L_Q$、费用上界 $U_C$。模块的理论比较规则为：

$$L_Q\ge-\delta\quad\text{且}\quad U_C<0.$$

数值实现另作保守守卫：质量同时要求补偿计算的 $L_{Q+\delta}\ge0$；费用要求 $U_C<-\tau_C$，其中 $\tau_C=32\,\mathrm{Number.EPSILON}\max(\bar C_\pi,\bar C_b)$。使用逐题配对差与补偿求和，保留质量边界残差，不把数值epsilon加进业务margin；费用守卫也没有固定美元门槛。完全相同费用多重集合不因舍入被认作节省；同margin边界的可辨别质量损失不被抹掉。超小量数值无法表达时不得据此通过非劣。这些守卫不是统计保证。

这是近似 bootstrap 推断，**不是有限样本风险保证或正式认证**；Bonferroni 不会修复失真的单项区间。每域只有一个 group 时无法估计该域组间变异，模块报告警告，报告作者不得以退化区间宣称显著性。独立组和分布代表性还需采集设计支持。

空集返回 `null`，不制造 0%；参考平均费用为 0 时节省率为 `null`。若任何重采样的费用比无定义，其区间整体为 `null`，不偷偷筛掉该次抽样。未知费用输入直接拒绝，交由采集报告披露。本轮此模块仅用人工单元测试验证，没有对最新聚合表调用它。

## 5 复现与交付范围

在完整源码目录，Node >=22.19；聚合审计不联网、不调用模型：

```powershell
npm run audit:livebench -- --input-dir "<LIVEBENCH_INPUT_DIR>" --output "test-artifacts/livebench-aggregate-audit.json"
node --test tests/livebench-aggregate-audit.test.mjs tests/routing-paired-statistics.test.mjs
npm test
npm run check:client
```

将 `<LIVEBENCH_INPUT_DIR>` 替换为已下载并核对固定来源 hash 的公开输入目录。本页操作示例与仓库中的核验 JSON 使用发布脱敏投影：本机路径改为仓库相对路径或占位符，日期、版本、hash 和数值核验结果保留；公开副本字节不等同原始记录，原始归档保持不变。

其他机器先从固定 revision 获取上述 table/categories/cost 文件到独立目录，并核验 SHA256；`--input-dir` 使用该目录。输出不能放进原始输入目录。报告保存来源哈希、覆盖、排除与局限；相同输入应得到相同结果。

已有二元评估器 `evaluate-routing.mjs` 不因新增工具自动支持 LiveBench 部分分。连续分研究使用新配对模块，不对旧工具静默转换标签。生产 `shared/livebench.mjs` 的能力先验适配与本轮科研统计也相互独立；未将聚合 Pareto 当逐题标签注入生产。

已完成：最新官方来源核验、不可变归档、聚合审计、连续分配对统计及回放协议文档。

本轮全量 `npm test` 为367项：364通过、3项既有Windows条件跳过、0失败；新增两组相关测试共73项（统计52、聚合21）全部通过。`npm run check:client` 成功。原文哈希及数值边界经独立复核；这些都是工程检查，不是回答质量实验。

未完成：2026-06-25 的真正逐题矩阵、0.15.0 与当前版的真实同题质量—成本回放、时间/域外测试、概率校准和完整 DAG/端到端收益验证。下一步需要作者提供该 release 的逐题文件，或另行确认模型池、题集和费用上限后采集新结果；本轮不会自行扩大为付费实验。
