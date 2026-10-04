# 模型路由优化的数学推导与实验记录

日期：2026-10-03 初稿，2026-10-04 修订与复核。对象：DSH Model Router 本地开发版 `0.16.0-dev.1`。本轮未发布版本，未调用付费模型。

后续实现补充：[动态数据与持续反馈的推导、实现和实验](ROUTING_ADAPTIVE_LEARNING.zh.md)。公共价格/LiveBench刷新与按任务类型的时间衰减主观效用已接入开发源码；本文既有实验仍为冻结记录，不将新增合成闭环测试改称真实收益研究。

## 摘要

模型路由不是给模型排一个总榜，而是在任务、预算、能力与上下文约束下选择执行路线。本报告将当前实现形式化为带依赖交接项的离散分配问题，推导费用尺度、候选保留和费用下界的性质，说明精确与近似搜索各自能保证什么，并记录反例回归、多种子搜索控制实验和离线结果矩阵核验。

LiveBench 已有的任务/领域评分可以直接用于能力先验、静态领域策略分析及代理规划实验，不需要等逐题文件才开始研究。本报告将它接入进一步优化的推导，并采用连续质量分、相对基线非劣的费用最小化目标。求解与指标计算的工程行为可以离线验证，但真实查询自适应路由的质量—成本收益仍需同题结果验证。

质量、延迟、风险和 token 规模仍主要是代理量；推理等级是在每条路线内预先适配的，不是与模型联合穷举优化。本报告另外推导查询条件学习、校准与独立认证，明确区别于已实现功能。[LiveBench 证据与同题验证协议](ROUTING_LIVEBENCH_VALIDATION.zh.md)保存了 2026-06-25 发布表的冻结核查。本轮使用该快照，不宣称它永远是最新发布；不再等待或继续寻找新逐题文件。

阅读顺序：第 4–6 节解释当前算法；第 7–8 节记录已做实验；第 9 节给出 LiveBench 先验与进一步优化的推导；第 10–11 节规定真实收益验证和接入条件。费用以各模型官方计费规则乘实际 usage 为主要口径，账单仅作可选核对，见第 10.3 节。

## 1 研究问题与证据范围

本轮围绕四个问题展开：

1. 不增加付费调用时，能否修正候选截断、局部剪枝和费用尺度造成的错误选择？
2. 何时可以证明保留候选内的最优性和预算可行性？beam 的近似误差如何测量？
3. 当前评分如何过渡到经过训练和校准的查询条件质量估计？
4. 应当如何验证质量—成本收益，而不把合成例子、手动评分或事后 Oracle 当成部署证据？

证据分为三层，后文分别标明：

| 层次 | 本轮依据 | 可支持的结论 |
| --- | --- | --- |
| 理论推导 | 下述固定候选、可加费用与代理目标的假设 | 在假设成立时的搜索性质 |
| 已开展的实验 | 旧版固定反例、合成 DAG、指标手算、自动测试、LiveBench 聚合先验分析 | 覆盖输入下的实现行为与冻结评分画像；不能外推为真实查询路由收益 |
| 后续研究方案 | 同题多模型标签、训练与独立校准协议 | 研究设计；尚无训练、校准或真实质量结果 |

前一轮的功能概览见 [ROUTING_RESEARCH.zh.md](ROUTING_RESEARCH.zh.md)。本报告补充公式、条件、证明、控制变量和实验过程，不将这些工程改进表述为已获验证的学术新颖性。

## 2 文献依据与本项目的连接

[RouteLLM](https://arxiv.org/html/2406.18665v4) 根据查询和偏好数据学习强弱模型路由；其相对偏好胜出事件不同于客观答对事件。本项目借鉴查询条件学习思路，不把现有质量分冒充训练概率，也不采用论文中的收益数字。

[RouterBench](https://arxiv.org/html/2403.12031v2) 提供多模型逐题结果及质量—费用评估框架。[LLMRouterBench](https://arxiv.org/html/2601.07206v1) 在统一评估中讨论简单基线与正确专家召回不足。由此提出的本项目工程决策是：先检查候选是否被误删，再在同一题目、同一模型池下比较简单基线和路由。

进一步的概率估计可参考 [Guo 等的校准研究](https://proceedings.mlr.press/v70/guo17a.html)；总体风险约束可借鉴 [Learn then Test](https://arxiv.org/html/2110.01052v5) 的独立样本与多重检验范式。第 9 节给出一个保守的 Hoeffding 方案，是本报告的设计推导，不是上述论文算法的复现或已经获得的风险保证。

## 3 问题定义

### 3.1 任务与动作

令任务图为拓扑有序 DAG：

$$
G=(V,E),\qquad V=\{1,\ldots,n\},\quad (s,t)\in E\Rightarrow s<t.
$$

每个工作包有类型、难度、质量门槛 $f_t$ 和关键性 $\kappa_t$。原始路线由 provider/model 标识；同一个模型在不同 provider 下是不同路线。令 $\mathcal A_t$ 为该任务能力过滤后的路线集合。

当前实现仅对图像任务过滤明确不接受图像的路线；输入模态列表为空时仍视为未知但可候选。因此 $\mathcal A_t$ 不是“所有能力都已实证确认”的集合。上下文窗口、工具支持、地区限制和配额等能力约束仍需后续扩展与验证。

对每个任务—路线组合，适配器先固定推理等级 $e_t(r)$，其选择规则为：

$$
e_t(r)=\arg\min_{e\in\mathcal E_r}
\bigl(|\operatorname{rank}(e)-\operatorname{rank}(e_t^{\rm pref})|,
\operatorname{rank}(e),\operatorname{id}(e)\bigr).
$$

这里使用词典序，保留适配器暴露的确切等级 ID。外层每条路线只有一个适配等级；没有枚举 $\mathcal A_t\times\mathcal E_r$。未知或不支持等级时使用代码中的默认开销代理，不应解释为厂商能力测量。

执行边界也须单列：当前规划的 `selected` 是首个工作包选中的路线，并不等于最终写答案模型；`mode=single` 也不保证任务图只有一个节点。规划中的推荐 effort 尚未证明完整传递至实际调用。因此单阶段模型选择实验必须冻结实际 effort/输出上限，只检验选模型；模型×effort 与完整 DAG 的收益需要另外验证调用参数和端到端输出。

### 3.2 三个候选范围不能混淆

候选形成有三个范围：

1. $\mathcal A_t$：能力过滤后的完整路线。
2. $\mathcal S_t$：质量筛选后的来源集合。有达标路线时仅保留 $q_{tr}\ge f_t$ 的路线；否则按质量取前 3 个放宽候选。
3. $\mathcal P_t$：局部剪枝、锚保留和最多 12 个候选截断后的集合。

求解器还会过滤非法费用、非法效用，有限预算时删除未知价格候选。有效集合为：

$$
\mathcal P_t^B=\{r\in\mathcal P_t:\widehat C_{tr}\in[0,\infty),
u_{tr}\text{ 有限},\ B<\infty\Rightarrow\mathrm{known}(r)\}.
$$

精确求解只针对 $\prod_t\mathcal P_t^B$。候选质量门槛仍是启发式合同，不是真实质量约束；不存在达标路线时，前 3 名之外的便宜模型可能被排除。后文所有可行性结论须说明使用哪个范围。

## 4 费用与单步效用推导

### 4.1 预估费用

将任务的估算 token 分成普通输入、缓存读取、缓存写入和输出。给定路线在当前 provider 下的 USD/百万 token 单价，费用为：

$$
\widehat C_{tr}=10^{-6}\left[
(I_t-I_t^{\rm read}-I_t^{\rm write})p_r^{\rm in}
+I_t^{\rm read}p_r^{\rm read}
+I_t^{\rm write}p_r^{\rm write}
+O_{t,e_t(r)}p_r^{\rm out}\right].
$$

当前 $I_t$ 来自文本字符规模及阶段倍率，$O_{t,e}$ 来自输出基数、阶段倍率和推理开销倍率；这是预算规划代理，不是 tokenizer 或实际用量预测模型。后续阶段完整依赖输出的长度、失败重试和厂商计费差异可能使实际费用偏离估算。

该线性式描述当前规划器，并不覆盖所有厂商账务规则。实验费用另定义为 $C_{im}=F_{m,v}(U_{im},Z_{im})$：$U$ 是真实 usage，$Z$ 包括缓存 TTL、上下文阶梯、服务档、时段、工具与非 token 计费，$F$ 是冻结的官方规则版本。价格已知不等于输出用量已知；选择前使用 $\widehat c_m(X)$，选择后才用真实 usage 计价，两者不可混用。

未知价格在无预算搜索内部以 0 作占位，但成本效用为 0，公共估价为 `null`。有限预算搜索只接受明确 `pricingKnown=true` 的候选，不能用占位 0 证明可支付。

### 4.2 为什么使用固定参考尺度

设 $C_t^{\rm ref}>0$ 为同一任务在固定参考价格下的估价。当前参考单价为输入 1、输出 5、缓存读写 1 USD/百万 token，参考推理开销使用默认等级倍率。它不是厂商报价或最优参数。

已知价格的成本效用取：

$$
g_t(C)=\frac{1}{1+C/C_t^{\rm ref}}
=\frac{C_t^{\rm ref}}{C_t^{\rm ref}+C}.
$$

其性质为：

$$
0<g_t(C)\le1,\qquad
g_t'(C)=-\frac{C_t^{\rm ref}}{(C_t^{\rm ref}+C)^2}<0,\qquad
g_t''(C)=\frac{2C_t^{\rm ref}}{(C_t^{\rm ref}+C)^3}>0.
$$

只要任务、该路线价格及其适配推理等级不变，加入一个无关极贵模型不会改变 $g_t(\widehat C_{tr})$。这避免候选池最大价格变化导致原路线的成本差被压平。它只证明单路线成本项不被重新缩放；加入真正有竞争力的路线、或触发候选截断时，最终选择当然仍可能改变。

参考尺度控制偏好曲线斜率，须在验证集调参。凸性和单调性不证明真实经济最优，更不证明评分和成本之间的交换率正确。

### 4.3 单步代理效用

令 $q_{tr}$ 为任务条件质量代理，$a_{tr}$ 为领域适配代理，$d_{tr}$ 为推理等级匹配，$\ell_r$ 为归一化延迟先验，$\rho_r$ 为风险先验，$m_{e}^{\rm lat}$ 为等级延迟倍率。质量短缺为：

$$
h_{tr}=\max(0,f_t-q_{tr}).
$$

代码中的效用可写成：

$$
u_{tr}=w_t^q q_{tr}+w_t^c g_t(\widehat C_{tr})
+w_t^\ell\bigl(1-\operatorname{clip}(\ell_r m_{e_t(r)}^{\rm lat})\bigr)
+w_t^a a_{tr}+w_t^e d_{tr}-w_t^\rho\rho_r-\kappa_t h_{tr}.
$$

未知价格的 $g$ 项按 0 处理。当前权重如下，设置预设还可倾斜并重新归一化；这不是拟合所得参数：

| 工作包类别 | 质量 | 成本 | 延迟 | 领域 | 推理匹配 | 风险 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| simple | 0.28 | 0.45 | 0.14 | 0.04 | 0.07 | 0.02 |
| balanced | 0.40 | 0.26 | 0.10 | 0.09 | 0.10 | 0.05 |
| complex | 0.48 | 0.14 | 0.06 | 0.14 | 0.11 | 0.07 |
| synthesis | 0.58 | 0.08 | 0.04 | 0.08 | 0.16 | 0.06 |

质量来源按工作包分别标记。只有代码分数时，派生 overall 或无来源标记的旧类别缓存不补足推理阶段证据；显式 overall 仍可作跨任务代理先验，不能当成当前题目正确性证据。手动质量、基准分、目录先验与反馈偏移均不等于 $P(\text{答对}\mid x,r)$。

## 5 全局分配目标

令 $x_{tr}\in\{0,1\}$ 表示任务 $t$ 选择路线 $r$。保留候选上的硬约束为：

$$
\sum_{r\in\mathcal P_t^B}x_{tr}=1,\qquad
\sum_t\sum_{r\in\mathcal P_t^B}\widehat C_{tr}x_{tr}\le B.
$$

有限 $B$ 时还要求选中路线价格已知。这里是规划费用约束，不是账单上限；无预算设置使用 $B=+\infty$。

对分配 $r_1,\ldots,r_n$ 定义：

$$
K=\sum_t\mathbf1[h_{t,r_t}>0],\quad
D=\sum_t h_{t,r_t},\quad
H=\sum_{(s,t)\in E}\mathbf1[r_s\ne r_t],
$$

$$
U=\sum_t u_{t,r_t}-\eta H,\qquad
C=\sum_t\widehat C_{t,r_t},\qquad \eta=0.015.
$$

当前一般求解最小化以下词典序向量：

$$
(K,D,-U,C,H,\operatorname{signature}(r_1,\ldots,r_n)).
$$

预算失败后的“低费用回退”求解则使用：

$$
(K,D,C,-U,H,\operatorname{signature}(r_1,\ldots,r_n)).
$$

因此回退不是不计质量条件的最低货币费用；先少放宽、再少短缺、之后才比较费用。小空间精确搜索在此目标下最优；beam 的排序只作用于被保留的前缀，不保证完整候选空间中任一词典序分量都全局最优。

交接项可以引入 $z_{st,ru}=x_{sr}x_{tu}$ 线性化，使用 $0\le z\le1$、$z\le x_{sr}$、$z\le x_{tu}$、$z\ge x_{sr}+x_{tu}-1$。因为 $x$ 为二值，这些约束已使连续 $z$ 等于乘积。在 $r\ne u$ 的组合上求和即得 $H$。这给出未来 MILP 对照的形式，但本项目当前没有引入 MILP 求解器。

交接罚分不是美元费用，也不测量真实信息损失；当前 DAG 模型没有预测前序答案变化对后序成功率和 token 数的影响。不能将 $\sum_t q_{t,r_t}$ 或其乘积解释为最终任务正确率。

## 6 候选与搜索性质的条件证明

### 6.1 无依赖局部支配的安全条件

在没有依赖交接、候选费用独立可加的条件下，若路线 $a$ 对同一任务满足 $h_{ta}\le h_{tb}$、$u_{ta}\ge u_{tb}$、$\widehat C_{ta}\le\widehat C_{tb}$，且其余可行条件不弱于 $b$，则把任何完整解中的 $b$ 换成 $a$ 不增加质量放宽或预算，也不降低效用。因此可删去 $b$ 而不损失数值词典序分量的最优值。

代码使用更保守的多轴支配检查，并额外要求实际效用不差。该论证针对目标值，不保证相同的 ID 破平解；也不允许删除能力资格不同、未知价格证据不同的动作。

有依赖时，上述替换可能增加入边或出边交接。例如单步 $u_A=u_B+0.001$，前后两步固定选 $B$，选择 $A$ 会多付 $2\eta=0.03$ 的代理罚分。此时 $B$ 的整体效用更高，局部支配不能推出全局支配。当前实现因此在存在任何依赖时停用局部路线剪枝。

### 6.2 最便宜候选锚能保证什么

对质量筛选后的 $\mathcal S_t$，先保留已知价格的最便宜路线，再截断得到 $\mathcal P_t$。在有限预算且每任务至少一个已知价候选时：

$$
\min_{r\in\mathcal P_t,\;\mathrm{known}(r)}\widehat C_{tr}
=\min_{r\in\mathcal S_t,\;\mathrm{known}(r)}\widehat C_{tr}.
$$

因为费用可加而无跨任务费用约束，逐任务最小费用之和相等，故 $\mathcal S$ 与 $\mathcal P$ 的“是否存在预算内组合”相同。该性质保护的是已知价费用可行性，不能保证效用最优解、短缺最优解或正确专家被保留。

它不适用于质量筛选前的完整 $\mathcal A$：简单任务中，质量 0.9、单价 1 的路线存在时，质量 0.7、单价 0.001 的路线会先被排除；预算 $10^{-5}$ 下前者估价 $0.000996$，后者 $0.000000996$。全池有便宜路线，严格质量候选却不满足预算。全不达门槛时，质量前 3 名还可能排除第 4 个廉价模型。这是当前质量合同和召回范围的限制，不应写成“完整池无可行解”。

### 6.3 后缀费用界的正确性

针对有限预算、各有效池非空、费用有限非负的情况，定义未分配任务的费用界：

$$
b_k=\sum_{t=k}^n\min_{r\in\mathcal P_t^B}\widehat C_{tr}.
$$

对已分配到 $k-1$ 的前缀费用 $C_{<k}$，若 $C_{<k}+b_k>B$，任何补全都超预算，可以安全剪枝。

在当前独立候选池、可加费用且依赖只进入效用的假设下，反方向也成立：若 $C_{<k}+b_k\le B$，未来每步选其最低费用候选就是一个预算内补全。因此这个界同时是预算可补全的充分必要条件，忽略实现的 $10^{-12}$ 浮点容差。

推论：只要 beam 每层保留至少一个通过此界的前缀，预算可行性就不会因为 beam 宽度丢失。额外保护低费用前缀不是这个证明的必要条件。若未来加入路线相关交接费用、资源冲突或非独立候选，此充分性不再自动成立，只能重新检查界是否仍可采纳。

实现的低费用前缀保护仍先比较 $K,D$，再比较费用，故是“质量优先的低费用锚”：先选取最小 $(K,D)$ 类，再在该类内比较最低费用。

### 6.4 精确求解与 beam 的边界

令 $P_B=\prod_t|\mathcal P_t^B|$。当 $P_B\le4096$ 且计数未溢出时，算法枚举所有通过安全费用界的组合，最终按完整词典序排序，得到有效保留候选内的代理目标最优解。费用界只删除预算无解前缀，不删可行最优解，因而结论成立。不能用过滤前的候选积判断搜索模式。

大于该阈值时，每层保留至多 $W=256$ 个前缀；上述保护锚通过替换进入，不额外增加宽度。前缀较低分但能避开后续交接的路径可能被删，故没有一般最优性或近似比保证。宽度增大也不是理论上的严格单调保证，因为不同层保留集合和锚替换可能不同。

对通用 solver，质量优先排序也不提供全局质量保证：3 个无依赖任务、预算 9，第 1 步“无短缺/费用 9”与“短缺 0.1/费用 1”，后两步均为“无短缺/费用 4”或“短缺 0.1/费用 0”。宽度 1 可先保留第 1 步无短缺路径，最后 $K=2$；精确解放宽第 1 步而保留后两步，$K=1$。这是通用混合短缺池的反例；第 7 节控制实验特意固定短缺为 0，不将效用 gap 当成质量短缺 gap。

### 6.5 实际计算复杂度

令有效候选数 $m_k=|\mathcal P_k^B|$，第 $k$ 层保留前沿数为 $F_k$，尝试数 $A_k=F_{k-1}m_k$，通过预算剪枝的展开数为 $N_k$，入度为 $d_k$，$F_0=1$。每个接受状态复制选择数组和 task→route 映射，规模随 $k$ 增长；排序破平时还会生成路径签名。路由 ID 长度有界、采用常规比较排序时，保守上界为：

$$
O\!\left(\sum_k A_k+\sum_k N_k(k+d_k)
+\sum_k kN_k\log(1+N_k)\right).
$$

精确模式 $N_k\le\prod_{t\le k}m_t$，空间为 $O(\max_k kN_k)$；beam 模式 $F_k\le W$、展开时 $N_k\le Wm_k$，前沿虽仅宽度 $W$，临时展开空间仍可达 $O(nW\max m_k)$。不能只写成“$O(nWK)$ 常数代价”，忽略 Map 复制和排序。

以上是搜索阶段的界。整个求解器还包括拓扑核验与候选过滤，时间 $O(n+|E|+\sum_k\widetilde m_k)$、存储 $O(n+|E|+\sum_k\widetilde m_k)$，其中 $\widetilde m_k$ 是过滤前池大小；生产池已限制为每任务最多 12 个候选。

## 7 实验设计与执行过程

### 7.1 E1 固定反例与旧版对照

基线为公开 0.15.0 源 commit `aca9912921aee50858e4b95c8698e3177e22335c`。前轮同一组固定输入的实际记录如下：

| 反例 | 0.15.0 行为 | 0.16.0-dev.1 行为 |
| --- | --- | --- |
| 13 条路线，预算 0.001 | 丢失廉价锚，估价 0.003278、预算不可行 | 保留廉价路线，组合估价 0.00060203、预算可行 |
| 依赖交接 | B→A→B，共 2 次交接 | B→B→B，0 次交接 |
| 无关极贵路线 | 成本尺度受影响，选择 Expensive | 原路线成本项不被重缩放，选择 Cheap |
| 仅有代码分数 | 推理阶段也被标记为有基准证据 | 推理阶段 unknown，不给节省率结论 |
| 归一化类别均值 | 派生 overall 补足跨任务证据 | 保留 derived 来源，不补足未测任务 |
| 图像费用基线 | 以不可执行纯文本路线宣称 99% 节省 | 仅用图像资格路线作基线，本例节省显示 0 |
| 费用舍入边界 | 可同时出现 feasible=true、exceeded=true | 用未舍入总额判断，字段一致 |

费用和质量分均来自合成输入；99% 是旧版错误显示，不是真实节省。旧/新包含多项同时变更，E1 是回归对照，不能将全部差异归因于单独一个改进机制。本轮用可移植 [routing-regression-study.mjs](../scripts/routing-regression-study.mjs) 重新执行七例，保存[完整输入、旧新输出及源码哈希](experiments/20261003-routing-regression/routing-regressions.json)。两版路由接受相同、由当前模型配置规范化逻辑产生的输入；这不是旧版完整配置处理链的消融。

### 7.2 E2 搜索层控制变量实验

独立完整枚举 Oracle 不使用生产 solver 的比较器、剪枝或前缀规则，计算每个完整分配的总效用、费用和交接后比较。它的角色是搜索正确性参照，不是模型回答的事后正确性 Oracle。

预先固定种子 1701、20261003、20261004，每种子生成 48 个随机 DAG，共 144 个随机实例；每次还运行同一个 1728 组合的 forced-B 对抗例。每例使用无预算、紧预算和不可行预算。三次对抗运行只是同一构造的重复，不作为三个独立样本。所有候选 `qualityShortfall=0`、已知价格，比较对象具有相同候选池、同一任务顺序、同一预算和交接罚分。这样隔离搜索方式，不能归因于候选筛选或训练。

随机生成器覆盖 3–6 个任务、每池 2–4 个候选、整数费用 1–9，以及 chain、fan-out-join、dense、random-dag 四类拓扑；效用有独立、费用相关、近似平分三类。任务数与拓扑绑定，候选数与效用分布绑定，故本实验不能独立估计拓扑、规模或费用相关性的因果效应。紧预算为最小组合费用加费用范围的 25% 向下取整；不可行预算低于最小组合费用。费用和效用均为人为任意单位，不是 USD 或正确率。

比较 auto（阈值 4096）与强制 beam 的 $W\in\{1,4,16,64,256\}$。auto 在本实验范围内走精确模式；强制 beam 是控制干预，不表示这些小空间在线上实际使用近似搜索。对每次运行记录是否返回完整解、预算违例、可行性与 Oracle 是否一致、扩展状态、交接数和：

$$
\Delta_U=U_{\rm Oracle}-U_{\rm method}.
$$

不可行例的 gap 为 `null`，不能按 0 混入平均值。零 gap 的数值判断使用报告中的容差；路径破平不应冒充不同效用。`--no-timing` 可输出确定性的数学结果；计时仅用于本机诊断，不作为速度优势或模型 API 延迟证据。

复现命令、实际计数和数据表见第 8 节。完整输入、逐次记录和摘要全部保存，而不是只挑选成功例。

### 7.3 E3 离线结果矩阵的指标核验

现有 `evaluateRouting` 只接收完整同题矩阵及外部已记录选择，不训练、不校准、不重放 DAG。validation 选择 best-single/cheapest-single；test 标签仅用于评价及不可部署的 hindsight Oracle。

随项目的 synthetic fixture 有 3 个模型、4 个 validation 样本、4 个 test 样本。实际手算与运行结果为：

| 策略 | test 微正确率 | 宏领域正确率 | 平均费用 USD |
| --- | ---: | ---: | ---: |
| supplied recorded-router | 0.50 | 0.50 | 0.00450 |
| validation best-single | 0.25 | 0.25 | 0.00100 |
| validation cheapest-single | 0.25 | 0.25 | 0.00100 |
| 固定种子 random | 0.75 | 0.75 | 0.00400 |
| hindsight Oracle | 0.75 | 0.75 | 0.00300 |

记录路由器的费用中模型均值为 0.00425、路由开销为 0.00025。其唯一正确模型桶为 1/1，2–3 正确模型桶为 1/2，4+ 桶为空，召回 `null`；另有 1 道全模型错误题。此表甚至包含随机优于记录路由的例子，其目的仅是核验指标，不能从 4 道合成题得出效果比较或显著性。

微正确率为 $N^{-1}\sum_iY_{i,\pi(x_i)}$；宏领域正确率为各域正确率的非加权均值。正确专家桶的召回分母是桶内题目数，不是候选 `recall@k`。`routingCostUsd` 缺省为 0，其他基线路由开销未测；费用只有在采集者纳入重试和失败后才完整。

### 7.4 E4 LiveBench 评分先验的静态领域分析

直接使用已冻结的 LiveBench 任务分，不寻找逐题文件。输入为 2026-06-25 发布评分表、cost 表及 categories；cost 表仅供共享审计的题数/完整性限定，其费用金额不进入质量均值、权重、最大化或结果。审计结果共 66 个完整模型画像、7 个领域、23 个任务。按题数向量的众数选择 63 个画像作同计数描述性池，筛选规则不使用质量高低；题数相同不能证明题目 ID 相同。此池也不等于用户实际可调用的模型池。

按第 9.1 节任务等权、领域等权公式计算 $q_{m,d}^{\rm LB}$，比较：

$$
V_{\rm single}=\max_m\frac1D\sum_dq^{\rm LB}_{m,d},\qquad
V_{\rm domain}=\frac1D\sum_d\max_mq^{\rm LB}_{m,d}.
$$

对任意固定 $m$，逐域 $\max_uq_{u,d}^{\rm LB}\ge q_{m,d}^{\rm LB}$，求均值再对 $m$ 取最大值，得到 $V_{\rm domain}\ge V_{\rm single}$。该不等式描述冻结表中领域专长的评分空间，不证明将来的泛化收益。域选择是在同一表上做最大化，称“经验领域上包络”，不称已部署域路由或独立 test；七个领域也不是七个独立随机实验。

实验保留全部 63 个画像、每域赢家与固定模型分、未舍入结果、排除对象、来源及脚本 hash。严格比较未舍入 binary64 值，仅严格相等时按模型 ID 字典序破平；不将显示舍入用于选择。不执行来源前端的个别模型例外规则，不合并版本/effort 字符串。

本实验只使用质量，不使用作者发布费用、当前官方单价或假设 token 数；因此不报告节省率、质量—成本 Pareto、配对区间或显著性。费用优化可在第 9.2.1 节以官方规则下的调用前估价开展 proxy 实验；真实收益按第 10 节后续测量。

## 8 本轮结果与复现入口

### 8.1 三种子随机实例汇总

运行环境为 Windows `win32`、Node `v24.20.0`；禁用计时。144 个随机实例形成 432 个预算条件，其中 288 个可行、144 个不可行。六种方法共 2592 次求解；每个方法均有 432/432 可行性判断与独立枚举一致，预算违例为 0。

下表分母只含 288 个双方可行条件。gap 为代理效用任意单位，扩展数也只汇总返回解的条件；不可行搜索诊断未返回，因此不填作 0。数值显示作小数舍入，原始值保留在 JSON。

| 方法 | 零效用 gap 条件 / 可行条件 | 平均 gap | 最大 gap | 扩展状态总数 |
| --- | ---: | ---: | ---: | ---: |
| auto exact（阈值 4096） | 288 / 288 | 0 | 0 | 124259 |
| forced beam 1 | 119 / 288 | 0.03230179 | 0.246362 | 3621 |
| forced beam 4 | 247 / 288 | 0.00315349 | 0.067989 | 9830 |
| forced beam 16 | 281 / 288 | 0.00029435 | 0.024678 | 23706 |
| forced beam 64 | 288 / 288 | 0 | 0 | 49173 |
| forced beam 256 | 288 / 288 | 0 | 0 | 87340 |

此处“零 gap”只比较效用，容差为 $10^{-12}$；不宣称不同的费用、交接或签名破平解完全相同。三个种子的完整输入、逐行记录和各自摘要都保留，合并器从原始行重新计算分母与均值，不平均摘要中的平均数。相同实例的不同预算条件不是独立随机样本，本轮不计算置信区间或总体最优率保证。

### 8.2 单列对抗构造

构造为 3 个前缀任务、每池 12 条路线，末步只允许路线 B，依赖全部前缀；总组合空间 1728。前缀 A 系路线具有略高单步分，但全部使用 B 可避免末步交接。每次运行有 2 个可行预算条件和 1 个不可行条件。

| 方法 | 可行条件的分配效用 | 交接数 | gap |
| --- | ---: | ---: | ---: |
| auto exact | 2.4000 | 0 | 0 |
| forced beam 1 / 4 / 16 / 64 / 256 | 2.3583 | 3 | 0.0417 |

三种子中的这个构造完全相同，三次运行只是重复核验；不能把它写成三个独立对抗样本。搜索层实例总数按运行计为 147、条件 441、求解 2646 次；独立随机实例仍是 144，独立命名对抗构造仍只有 1。此例说明较大 beam 也没有一般最优性保证；不表示这些小空间在生产中走 beam，因为生产 auto 在此空间会精确枚举。

### 8.3 复现命令与原始记录

在源码仓库根目录、Node >=22.19 环境执行以下命令。实验不访问网络、凭据或模型 API；旧版对照需要事先准备正确的本地 0.15.0 源码。当前本机基线 checkout 的 commit 已核验为 `aca9912921aee50858e4b95c8698e3177e22335c`。

```powershell
node scripts/routing-search-experiment.mjs --output docs/experiments/20261003-routing-search --seed 20261003 --instances 48 --no-timing
node scripts/routing-search-experiment.mjs --output docs/experiments/20261003-routing-search/seed-1701 --seed 1701 --instances 48 --no-timing
node scripts/routing-search-experiment.mjs --output docs/experiments/20261003-routing-search/seed-20261004 --seed 20261004 --instances 48 --no-timing
node scripts/summarize-routing-search.mjs --directory docs/experiments/20261003-routing-search
node scripts/routing-regression-study.mjs --baseline test-artifacts/github-0.15.0-checkout --output docs/experiments/20261003-routing-regression
npm run eval:routing -- tests/fixtures/routing-evaluation.synthetic.json
npm test
npm run check:client
```

任意替换 `--baseline` 路径时，须确认它是上述 intended commit，而不只是 package 声明 0.15.0；CLI 的版本检查本身不能认证发布完整性。参数错误、错误基线版本、重复实验条件、错种子、未知 schema 及缺失文件都有失败测试。零费用实例不存在非负的不可行预算时，不生成虚假的 `infeasible` 标签。

复现应使用源码 checkout；npm 插件运行包不提供完整测试/实验工具。JSON 中预算 `null` 表示无预算 Infinity，指标 `null` 表示不可用/未定义，这两者应按字段区别解释。

| 产物 | 保存内容 |
| --- | --- |
| [study-summary.json](experiments/20261003-routing-search/study-summary.json) | 三种子逐行聚合、分组与环境、源码及输入 SHA256 |
| [种子 20261003 JSON](experiments/20261003-routing-search/search-experiment.json) / [CSV](experiments/20261003-routing-search/search-experiment.csv) | 全部固定输入、Oracle、882 次求解与摘要 |
| [种子 1701 JSON](experiments/20261003-routing-search/seed-1701/search-experiment.json) / [CSV](experiments/20261003-routing-search/seed-1701/search-experiment.csv) | 相同协议，另一组预先固定输入 |
| [种子 20261004 JSON](experiments/20261003-routing-search/seed-20261004/search-experiment.json) / [CSV](experiments/20261003-routing-search/seed-20261004/search-experiment.csv) | 相同协议，第三组输入 |
| [routing-regressions.json](experiments/20261003-routing-regression/routing-regressions.json) | 七个反例输入、旧新完整输出、受检源码哈希 |

汇总时记录的源码哈希识别当时文件，不会反向认证过去运行时加载的代码。因此本轮交付前再次运行和对照确定性的记录；如改动源码，须重跑后重建 manifest，不能沿用旧结果。本轮不从扩展状态数推导速度优势。

关闭计时的 E2 JSON/CSV 可逐字节复现。E1 为保留完整原始输出，保留路由器实际 `generatedAt` 时间戳；复跑时仅排除两版输出的这些时间戳再比较全部剩余字段，不宣称 E1 完整文件逐字节相同。

### 8.4 自动验证与审查

2026-10-03 初稿归档的全量 Node 测试共 294 项：291 通过、3 项 Windows 条件跳过、0 失败；当时新增实验与聚合工具共 18 项测试通过，客户端产物检查通过。这是历史运行计数，不是 10-04 当前树的测试总数。数学推导经独立审查后修正了线性化变量非负域和过滤后的搜索空间定义；10-04 又复核了连续非劣目标、乘子单位与分组认证条件。

这些验证不等于统计显著性或真实模型端到端验证。本轮未调用付费模型、不训练、不发布、不推送远端；完整测试输出及交付 manifest 保存于 Obsidian exports 归档。

2026-10-04 本次交付的全量测试为 445 项：442 通过、3 项既有 Windows 条件跳过、0 失败；新增 E4 测试入口已纳入 `npm test`。`npm run check:client` 通过。日志另存本轮归档，不覆盖历史测试输出。

### 8.5 2026-10-04 独立离线重跑

本轮重新执行 E1 七例及 E2 三种子，不修改 10-03 原始记录。新目录为 [20261004-research-recheck](experiments/20261004-research-recheck/study-summary.json)，[recheck-verification.json](experiments/20261004-research-recheck/recheck-verification.json)保存命令、比对范围和差异。E2 仍为 2592 次随机条件求解加 54 次重复对抗条件求解；随机可行条件零 gap 计数仍为 exact 288、beam-1 119、beam-4 247、beam-16 281、beam-64/256 288，预算违规均为 0。

六份 E2 原始 JSON/CSV 与旧记录逐字节相同；E1 七个完整案例仅排除 `generatedAt` 后一致。但是完整报告不完全相同：E1 有 4 处、E2 summary 有 3 处 manifest 差异，来自 `package.json` 的 8294→8619 字节及其 hash 变化。原字段和差异都保留，未为了匹配而删除 provenance。这次重跑提高复现可信度，不增加独立随机实例数，也不是新模型质量样本。上述重跑在新增 E4 的 npm 测试入口前完成；交付 manifest 另记录最终源码，不能将阶段记录中的 package hash 当成后续当前树 hash。

复现时使用新目录，避免覆盖上述历史记录：

```powershell
node scripts/routing-search-experiment.mjs --output docs/experiments/20261004-research-recheck --seed 20261003 --instances 48 --no-timing
node scripts/routing-search-experiment.mjs --output docs/experiments/20261004-research-recheck/seed-1701 --seed 1701 --instances 48 --no-timing
node scripts/routing-search-experiment.mjs --output docs/experiments/20261004-research-recheck/seed-20261004 --seed 20261004 --instances 48 --no-timing
node scripts/summarize-routing-search.mjs --directory docs/experiments/20261004-research-recheck
node scripts/routing-regression-study.mjs --baseline test-artifacts/github-0.15.0-checkout --output docs/experiments/20261004-research-recheck/regressions
```

执行前应复制到另一个未使用的输出目录；这里列的是本轮实际使用路径。后续源码改变不会自动使这些冻结实验失效或重新认证新代码，应重跑并保存新 manifest。

### 8.6 E4 的描述性评分结果

在上述 63 模型画像中，固定最佳单模型是 `claude-fable-5-1-max-effort`，宏领域评分 83.4141547619；按每域经验最高分得到上包络 87.6342500000，两者差 4.2200952381 个百分点。这是聚合样本内的质量画像差，不是本项目在真实任务上提升了 4.22 分，更没有证明成本下降。

| 领域 | 固定最佳单模型分 | 领域最高分 | 聚合表内的最高分模型/推理档 |
| --- | ---: | ---: | --- |
| Reasoning | 91.6923 | 92.6538 | gpt-6-astra-max |
| Coding | 86.3750 | 91.3660 | claude-sonnet-5-5-max-effort |
| Agentic Coding | 66.0607 | 77.2727 | deepseek-v4.1-flash-max |
| Mathematics | 97.0068 | 97.0775 | claude-opus-5-5-max-effort |
| Data Analysis | 80.2757 | 82.9733 | gpt-6-astra-max |
| Language | 89.5010 | 90.6840 | claude-fable-5-max-effort |
| IF | 72.9878 | 81.4125 | gemini-3.8-flash-high |

这些是冻结来源的原始动作名，不是可用 API 模型名、推荐购买名单或已验证当前版本。结果支持保留领域画像而非只看总榜这一研究方向；仍需验证域分类、可调用模型映射、版本迁移和价格差异。对同一表事后选出的赢家不做泛化或因果解释。

原始计算见 [aggregate-prior-study.json](experiments/20261004-livebench-prior-study/aggregate-prior-study.json)，独立核对见 [verification.json](experiments/20261004-livebench-prior-study/verification.json)。独立精确十进制算术核对全部 63 画像与选择，最大均值偏差约 $1.421\times10^{-14}$ 个百分点；原始目录 13 文件的前后 SHA256 一致，确定性 JSON 重建逐字节一致。新模块 12 项测试与既有审计 21 项，共 33 项通过。这些验证是算术/来源与接口核验，不是模型泛化检验。

源码入口为 [livebench-prior-study.mjs](../scripts/livebench-prior-study.mjs)；复现用未使用的新输出目录，其父目录需已存在：

```powershell
node scripts/livebench-prior-study.mjs --input-dir "<LIVEBENCH_INPUT_DIR>" --output-dir "docs/experiments/livebench-prior-reproduction-new"
```

将 `<LIVEBENCH_INPUT_DIR>` 替换为已下载并核对固定来源 hash 的公开输入目录。公开 `verification.json` 是发布脱敏投影，保留日期、版本、hash 和数值结果，只将本机路径改为仓库相对路径或占位符；其字节不等同原始核验记录，原始归档保持不变。未公开核验 driver 的路径使用 `<LOCAL_VERIFICATION_DRIVER>`，公开复现使用上面的仓库脚本。

精确参数及源码/输入 hash 以冻结记录为准。CLI 拒绝重写现有目录及向输入树写入；原 CSV 保持不变，不复制均分造逐题样本。

## 9 基于 LiveBench 的进一步优化推导

本节可直接开展离线推导与先验实验。查询条件预测器、乘子策略与有限样本认证仍是研究方案，没有训练后接入生产路由；不要将公式等同于已经实现的功能。

### 9.1 从 LiveBench 领域先验到查询条件结果预测

设冻结表中模型 $m$ 在任务 $k$ 的百分制评分为 $S_{mk}$，领域 $d$ 包含任务集合 $T_d$。采用冻结任务分的通用任务等权、领域等权口径，不执行来源源码的个别模型例外规则：

$$
q^{\rm LB}_{m,d}=\frac1{|T_d|}\sum_{k\in T_d}\frac{S_{mk}}{100},\qquad
q^{\rm LB}_{m,\rm macro}=\frac1D\sum_dq^{\rm LB}_{m,d}.
$$

这是发布题集上的经验平均质量，不是当前请求的答对概率。对调用前确定的任务权重 $a_d(X)\ge0$、$\sum_da_d(X)=1$，可以直接构造规划先验：

$$
q^{\rm prior}_m(X)=\sum_da_d(X)q^{\rm LB}_{m,d}.
$$

这里“任务等权后领域等权”不是按题 micro。领域内不同任务的题数不等时，也不等于统计工具的“域内按题均分后领域等权”macro；比较实验必须先对齐估计目标，不能把两个同名宏均分直接混用。

单领域任务可取 one-hot 权重，复合任务可用预先冻结的映射。不能用最终答案或 test 标签决定这些权重；自动领域分类的误差和开销须另测。只有明确记录的领域分能支持对应领域证据，缺失分保持未知，不能用总分补成“已测”。保留 provider、模型版本及 effort 原始 ID，不能把不同版本或推理档合并为同一个动作。

聚合分支持两种立即可做的研究：当前评分/权重/预算策略的代理敏感性实验，以及固定“每域一个模型”的描述性质量点值。后者在精确同题且计分权重一致时，可由完整领域均分计算；现有快照的相同题数向量并未证明精确同题，故本轮只计算静态评分上包络。按每道题特征换模型的路由、配对区间、真实费用和 DAG 收益则不能从这些均分恢复。用同一发布评分选模型并评价是 in-sample 分析；若作为下一轮先验，应冻结旧发布，再用不重叠的新题/模板族测试，否则仍有标签泄漏。

令 $X=(q,h,z)$ 表示查询、已知上下文和调用前可见特征；模型池版本固定。后续完整矩阵保存连续质量 $Q_{im}\in[0,1]$ 与官方规则×真实用量的计价费用 $C_{im}$；二元客观任务只是 $Q=Y\in\{0,1\}$ 的特例。代码任务可用隔离测试判断正确性；写作等任务应定义独立 rubric。多个模型可能同时正确，不能默认用互斥 softmax 的“唯一正确模型”标签。

一个可研究的起点是每模型二分类头：

$$
\widehat\theta=\arg\min_\theta
\frac{1}{N|\mathcal M|}\sum_{i,m}
\left[-Y_{im}\log p_{\theta,m}(X_i)
-(1-Y_{im})\log(1-p_{\theta,m}(X_i))\right]
+\gamma\Omega(\theta).
$$

模型费用另由调用前特征估计 $\widehat c_m(X)$。不能使用测试答案、实际输出长度或事后费用作为选择输入。对 LiveBench 部分分等连续评分，可研究有界输出的平方损失回归：

$$
\widehat\theta=\arg\min_\theta
\frac1{N|\mathcal M|}\sum_{i,m}(Q_{im}-\widehat\mu_{\theta,m}(X_i))^2
+\gamma\Omega(\theta),\qquad 0\le\widehat\mu_{\theta,m}\le1.
$$

平方损失在总体下的点式最小者是条件均值 $\mu_m(X)=\mathbb E[Q_m\mid X]$，因为 $\mathbb E[(Q-a)^2\mid X]=\operatorname{Var}(Q\mid X)+(a-\mu_m(X))^2$。连续均分不要命名为答对概率，也无需强制二值化丢弃部分分。

小样本时，可先用训练域均分与 LiveBench 先验作收缩基线：$\widetilde\mu_{m,d}=(n_d\overline Q^{\rm train}_{m,d}+\tau q^{\rm LB}_{m,d})/(n_d+\tau)$，$\tau>0$ 在 validation 选择、test 前冻结。该式是正则化加权均值，不自动构成贝叶斯后验或置信保证；当 $n_d=0$ 时退回先验，并披露领域迁移误差。这比立即堆叠复杂预测器提供了可核验的简单对照，但尚无真实训练结果。

若将动作扩展为 $a=(m,e)$，可拟合 $p_a(X),\widehat c_a(X)$ 后联合优化模型与推理等级；需要为不同等级采集独立结果与成本，不能假定“等级更高必然更准确”。这属于新研究变量，现阶段尚未采集。

### 9.2 质量—成本约束与拉格朗日策略

定义部署总体风险与平均费用：

$$
R(\pi)=\mathbb E[1-Y_{\pi(X)}],\qquad
\overline C(\pi)=\mathbb E[C_{\pi(X)}+C_{\rm router}(X)].
$$

可研究：

$$
\min_{\pi\in\Pi}\overline C(\pi)\quad\text{s.t. }R(\pi)\le\varepsilon.
$$

拉格朗日为 $\overline C(\pi)+\mu(R(\pi)-\varepsilon)$，$\mu\ge0$。在真实条件期望已知、查询间决策可分离，且策略类允许点式选择时，固定 $\mu>0$ 可逐查询选择费用加错误风险最小者。这里不要求各模型结果相互独立，但排除跨查询缓存、负载或总资源预算耦合。用学习估计替代，并令 $\lambda=1/\mu$，得到一个可实验的策略族：

$$
\pi_\lambda(X)=\arg\min_{m\in\mathcal M(X)}
\{1-\widehat p_m(X)+\lambda\widehat c_m(X)\}.
$$

若费用单位为 USD，$\lambda$ 的单位为 USD$^{-1}$。模型相关路由开销须加入对应动作的费用；查询固定且模型无关的开销不影响该 argmin，但仍计入部署费用。该推导定义偏好族，不保证有限策略族达到约束问题最优，也不保证估计误差下风险达标。

平均风险约束不是单题正确性保证，平均费用约束不是每次硬预算。多工作包的最终损失需对端到端输出独立定义并记录，不能直接把单题 BCE 或阶段质量之和移植为整条 DAG 的保证。

#### 9.2.1 连续质量下，相对基线非劣的费用最小化

对于有部分分的评分，优先保留连续质量。冻结部署基线 $\pi_0$ 和允许的绝对归一化下降 $\delta_Q\ge0$，提出：

$$
\min_{\pi\in\Pi}\overline C(\pi)
\quad\text{s.t. }\Delta_Q(\pi)=\mathbb E[Q_{\pi(X)}-Q_{\pi_0(X)}]\ge-\delta_Q.
$$

例如 $\delta_Q=0.01$ 表示百分制下降不超过 1 个百分点，不是相对下降 1%。若基线属于 $\Pi$，它本身满足质量约束，但这只证明有可行基线，不证明存在严格节省。

拉格朗日函数为：

$$
\mathcal L(\pi,\lambda_Q)=\overline C(\pi)
+\lambda_Q\{\mathbb E[Q_{\pi_0(X)}-Q_{\pi(X)}]-\delta_Q\},
\qquad\lambda_Q\ge0.
$$

$\lambda_Q$ 的单位是 USD/归一化质量单位，与前述倒数乘子 $\lambda$ 不同。设 $c_m(X)$ 已纳入模型相关的调用/路由开销；基线、$\delta_Q$ 和模型无关固定开销都与所选动作无关，在固定 $\lambda_Q$ 下可消去。真实条件均值已知、无跨查询耦合且 $\Pi$ 包含点式策略时：

$$
\pi_{\lambda_Q}(X)\in\arg\min_{m\in\mathcal M(X)}
\{c_m(X)-\lambda_Q\mu_m(X)\}.
$$

以 $\widehat c_m,q^{\rm prior}_m$ 或 $\widehat\mu_m$ 替换真值即可开始离线 plug-in 策略实验。$\lambda_Q=0$ 偏向最便宜动作；增大它提高质量的交换价值，并不认证真实质量。有限预设策略族未必容纳点式 argmin，此时应直接在 $\Pi$ 中最小化 $\mathcal L$。确定性离散策略可能有对偶间隙，不能声称扫乘子一定找到了约束问题的全局最优；随机混合的凸化问题属于另一研究设定。

实际实验先冻结乘子网格，在 validation 按预设非劣要求筛策略，再对整个比较族做独立检验。模型无关固定路由费虽不影响选模型，仍会改变是否比基线省钱。仅在代理质量上达标的策略必须标为 proxy-feasible，不能标为真实非劣。

### 9.3 概率校准与独立风险认证

先在独立 $C_{\rm prob}$ 上拟合预先指定的校准器，例如对各二分类头 logits 做预先规定的温度缩放。用可靠性图、Brier score 和预先规定分箱的 ECE 检查；校准误差改善不自动意味着路由更好，也不提供每题成功保证。[Guo 等](https://proceedings.mlr.press/v70/guo17a.html) 提供此类方法的依据。

随后冻结 $J$ 个策略，在另一个独立同分布风险集 $C_{\rm risk}$ 上评估 $[0,1]$ 损失。令 $J,N_r\ge1$、$0<\delta<1$，样本数为 $N_r$、失误上限为 $\varepsilon$、错误认证概率为 $\delta$，经验风险 $\widehat R_j=N_r^{-1}\sum_iL_i(\pi_j)$。由 Hoeffding 和并集界，可得：

$$
\Pr\!\left[\exists j:R(\pi_j)>
\widehat R_j+\sqrt{\frac{\log(J/\delta)}{2N_r}}\right]\le\delta.
$$

因此取：

$$
U_j=\min\!\left(1,\widehat R_j+
\sqrt{\frac{\log(J/\delta)}{2N_r}}\right),\qquad
\mathcal J_{\rm ok}=\{j:U_j\le\varepsilon\}.
$$

在合格策略中选费用较低者仍受同时风险界保护；这不是费用估计最优性保证。如果集合为空，报告“样本不足或无法认证”，不能自动认为强模型满足要求。该保守方案借鉴 [Learn then Test](https://arxiv.org/html/2110.01052v5) 范式，但当前代码未实现。

保证条件包括策略先冻结、风险样本独立同分布、损失有界及有效多重比较。模型版本变化、时间漂移、域外任务或模板相关样本不自动继承保证；逐域要求需预定义域，并对策略×域校正比较数量。单一总体风险界也不能保证少数任务域。

#### 9.3.1 相关题目按独立组认证，不能虚增样本量

若同模板/会话题相关，改用 $G$ 个真正独立同分布的组，组内平均损失 $\overline L_{gj}\in[0,1]$。错误认证概率另写为 $\alpha$，以免与质量非劣界混淆。组等权风险的同时上界为：

$$
U_j^{\rm group}=\min\!\left(1,\frac1G\sum_g\overline L_{gj}
+\sqrt{\frac{\log(J/\alpha)}{2G}}\right).
$$

它保护组等权风险，不是按题数加权的 micro 风险。若组权重 $w_g\ge0$、$\sum_gw_g=1$ 是设计中事先固定的，可用半径 $\sqrt{\tfrac12\sum_gw_g^2\log(J/\alpha)}$ 保护对应加权期望；随机且可能与难度相关的组大小不能无条件转换成部署总体 micro 保证。

直接认证连续配对质量差时，$D_{gj}=\overline{Q_{\pi_j}-Q_{\pi_0}}\in[-1,1]$，范围长度是 2，不能套用 $[0,1]$ 的半径。等权独立组的同时下界为：

$$
L_{\Delta,j}=\frac1G\sum_gD_{gj}-\sqrt{\frac{2\log(J/\alpha)}G}.
$$

只有 $L_{\Delta,j}\ge-\delta_Q$ 才按该方案认证组等权质量非劣；所有在风险集上尝试过的冻结策略都计入 $J$。此界可能很保守，样本不足应明确报告。它不认证无上界费用的严格节省，也不同于第 10.4 节近似 bootstrap 区间；本项目尚未实现该有限样本认证器。

## 10 真实模型实验协议

### 10.1 数据划分与防泄漏

建议依次使用 train、$C_{\rm prob}$、validation、$C_{\rm risk}$、test；校准器和所有策略在 $C_{\rm risk}$ 前冻结。先按原题、会话、代码仓库或模板族分组，再划分；同题的全部模型结果和重复采样不能跨 split。ID 不重叠只是格式检查，不排除语义泄漏。

训练集拟合质量/费用模型，概率校准集拟合校准器，validation 选架构、特征、正则与固定预算/阈值网格；风险集用于独立认证，test 只用于最后报告。另留时间外和域外测试。不得依据 test 标签改阈值后仍称其为独立测试结果。

五份划分适用于“训练＋概率校准＋有限样本风险认证”的完整研究，不是现在做公式推导的先决条件。冻结 LiveBench 先验的代理实验无需训练标签；不训练概率、不认证风险的首轮实测可按 [自行测试步骤](ROUTING_SELFTEST_STEPS.zh.md)使用 train/validation/test。这些简化实验不可沿用五份划分才支持的认证结论。

### 10.2 简单基线与控制消融

应固定池和题目，比较：原版 0.15.0、当前开发算法、validation best-single/cheapest-single、固定随机、query 无关预算混合、简单域路由、查询特征逻辑回归或 KNN，再与 hindsight Oracle 对照。

域路由的域标签必须在推理时可见或由冻结分类器预测；分类开销计费。在 test 中按域寻找事后最佳模型，应单列为 domain/dataset oracle，不能当可部署基线。

对候选锚、质量过滤、依赖剪枝、成本尺度、预测器和校准器分别做单因素消融。所有其他输入及阈值固定，并保留完整结果。第 7 节已经开展的搜索实验只改变搜索方式，尚未测量这些真实质量消融。

### 10.3 费用与质量采集

记录 provider/model/version/endpoint、采集时间、模板、完整 query-context、实际 effort/输出上限、解码参数、重试规则、每次 attempt ID、成功/失败、原始 usage、官方规则快照和计算版本。标签应来自客观测试或独立评价标准，评价者应看不到模型身份；不要将 API 成功返回当成回答正确。

按用户确定的口径，每个精确动作以其官方计费函数计算费用：

$$
C_i^{\rm priced}=\sum_{a\in\text{部署实际 attempts}}F_{m_a,v_a}(U_a,Z_a).
$$

当规则确实是分桶线性计价时，可展开为 $F=\sum_bu_bp_b/\mathrm{unit}_b+C_{\rm nonToken}$，但不能将所有厂商都约化为同一输入/输出单价。保存来源 URL、查阅与生效日期、币种/计价单位、服务/上下文档位、时段和缓存 TTL；不同币种需要冻结汇率及来源。没有 invoice 不阻止 `usage-priced` 实验；此时称“官方规则计价费用”，不冒称已付账单。账单只作可选对账。

例如 [DeepSeek 官方定价](https://api-docs.deepseek.com/quick_start/pricing/)区分缓存命中/未命中输入与输出；[Claude 官方缓存说明](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)给出读取、写入与 TTL 的计费结构；[Claude 官方推理计费说明](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost)说明 usage 的输出计量可能已经包含 thinking，不能再加一次。本报告不固定这些页面的动态价格数字，测试时须保存对应动作的官方快照；别名改指向的新模型不能沿用旧版本基准分作为已验证能力。

费用包含部署实际发生且按规则收费的级联、路由、失败/重试、工具和部署内 judge。研究用评分 judge、全矩阵采集、训练与人工标注属于实验建设成本，另列，不自动加到假设只调用一个模型的服务费用。失败请求不一律假定收费或免费，按官方规则和实际 usage 处理。未知费用保留未知，不按 0 补齐；仅官方价格而没有实际 usage 时只能报告预估费用。

全矩阵采集、训练和人工标注费用属于实验建设成本；用已录矩阵模拟“只选一个模型”的服务费用另列。不可把调用了所有模型的采集账单与单模型部署成本混为一谈。新增付费采集须另设预算并获得调用授权。

### 10.4 指标与统计报告

主指标为同预算质量、质量非劣下成本、连续 micro/macro 平均分、官方规则计价总费用与 Oracle gap；二元任务另报正确率和正确专家桶召回。补充端到端失败率、P50/P95 延迟、适用的校准指标和预算违例。预算网格及主比较应预先固定。

在同一题目上计算策略的配对质量和费用差，报告效应大小及置信区间；相关题目按原始组做 paired bootstrap，并在每次抽样重新计算宏领域指标。exact McNemar 检验只用于相互独立的二值题对；相关模板、会话使用组重采样。多策略比较应校正多重检验。[routing-paired-statistics.mjs](../scripts/routing-paired-statistics.mjs)已实现连续分、按领域分层的组配对 bootstrap 和预设比较族的单侧区间；[analyze-paired.mjs](experiments/20261004-selftest/analyze-paired.mjs)可核验实测声明与冻结选择哈希。其已通过人工输入测试，但并未取得真实同题收益，声明字段也不能认证数据真实性或预注册时间。原二元 evaluator 不等于这个统计工具；有限样本风险认证与概率校准尚未实现。

若将来声称“同质量更便宜”，须预先规定质量非劣界 $\varepsilon_{\rm NI}$，要求配对质量差的单侧下界 $\ge-\varepsilon_{\rm NI}$，且配对费用差的单侧上界 $<0$。质量差异不显著不能被解释为质量相同。

执行现有工具时，还使用更严格的浮点边界保护：`qualityMarginLowerBound` 非 `null` 且 $\ge0$，费用差上界 $<-32\cdot\mathrm{Number.EPSILON}\cdot\max(\overline C_s,\overline C_r)$；$\overline C_s,\overline C_r$ 为策略与参考的 mean cost。该 guard 防止纯舍入噪声被判为严格节省，不是业务非劣界，也不把近似 bootstrap 升格为有限样本认证。

小样本专家桶须公布分母；空桶为 `null`，而非 0。部署实验还须明确失败、超时和未回答如何计入损失，避免选择性丢弃困难样本。

## 11 实施边界与下一阶段准入

当前已实现：代理评分、能力/质量候选范围、依赖交接项、精确/beam、价格证据与预算界、离线结果矩阵指标、连续分配对统计及自测辅助工具。本轮完善的是数学文档、离线重跑与冻结 LiveBench 先验研究，不改变生产路由行为。

尚未实现或实测：query-context 质量学习、模型×推理等级联合动作、概率校准、独立风险认证、训练后的部署域路由、自动化全链路 usage 计价采集、真实多模型质量消融及真实数据统计检验。已有评分足够开始推导与先验实验，不足以将这些下一阶段目标标为完成。

目前不需要继续寻找最新逐题文件，也不需要先拿账单。下一阶段按自测步骤固定用户真实模型池，收集少量同题质量与实际 usage，再做以下验证：

| 验证 | 要回答的问题 | 准入或结论边界 |
| --- | --- | --- |
| 模型身份与调用参数 | 分数对应的版本、实际 effort/上限是否一致？ | 请求日志核对；不一致时只能称模型选择投影，不能称模型×effort 优化 |
| 同题质量—费用 | 新策略是否在预设质量非劣界内更便宜？ | 独立题/组、冻结价格×usage；质量 margin 下界非空且≥0，费用上界通过第 10.4 节严格负值 guard；不达标如实报告 |
| 估价误差与预算 | $\widehat C$ 与 $C^{\rm priced}$ 相差多少？ | 报误差分布与预算违例；规划可行不冒称实际硬预算保证 |
| 全 DAG/交接/重试 | 分工是否改善最终答案，而非阶段分之和？ | 固定题与执行条件，评价端到端质量、总费用、失败/重试和延迟 |
| 搜索扩展与缺失证据 | 大候选池、混合质量短缺、未知价格是否稳健？ | 独立反例与枚举对照；现有 E2 的全已知价/零短缺结果不覆盖这些情形 |

只有独立数据支持时，才将学习估计接入当前分配器。若候选筛选漏掉重要正确专家、预算估价偏差不可控或风险集不支持认证，应保留已验证路径并报告限制，不自动扩大付费探索。理论推导完成、代理实验完成、真实验证完成是三个不同里程碑。

## 12 一手参考文献

1. Ong et al. RouteLLM Learning to Route LLMs with Preference Data. arXiv 2406.18665v4，2025-02-23：[论文](https://arxiv.org/abs/2406.18665v4)。
2. Hu et al. RouterBench A Benchmark for Multi LLM Routing System. arXiv 2403.12031v2，2024-03-28：[论文](https://arxiv.org/abs/2403.12031v2)。
3. Li et al. LLMRouterBench A Massive Benchmark and Unified Framework for LLM Routing. arXiv 2601.07206v1，2026-01-12：[论文](https://arxiv.org/abs/2601.07206v1)。
4. Guo et al. On Calibration of Modern Neural Networks. ICML 2017；arXiv 1706.04599v2，2017-08-03：[正式论文](https://proceedings.mlr.press/v70/guo17a.html)。
5. Angelopoulos et al. Learn then Test Calibrating Predictive Algorithms to Achieve Risk Control. arXiv 2110.01052v5，2022-09-29：[论文](https://arxiv.org/abs/2110.01052v5)。

## 附录 代码与数学对象的对应

| 代码入口 | 对应内容 |
| --- | --- |
| [router.mjs](../.dsh-plugin/shared/router.mjs) 的 taskTokenBudget / taskCost | token 代理与费用 |
| router.mjs 的 candidateUtility / weightsForTask | 单步效用及阶段权重 |
| router.mjs 的 candidatePool | 能力、质量、支配与截断范围 |
| router.mjs 的 reasoningDecision | 单路线预先适配等级 |
| [assignment-solver.mjs](../.dsh-plugin/shared/assignment-solver.mjs) | 词典序、后缀费用界、精确/beam |
| [routing-optimizer.test.mjs](../tests/routing-optimizer.test.mjs) | 固定反例和独立枚举回归 |
| [routing-search-experiment.mjs](../scripts/routing-search-experiment.mjs) | 本轮搜索控制实验与原始记录 |
| [routing-evaluation.mjs](../scripts/routing-evaluation.mjs) | 外部完整结果矩阵的指标，不是训练器 |
| [routing-paired-statistics.mjs](../scripts/routing-paired-statistics.mjs) | 连续分、按独立组重采样的近似配对统计，不是有限样本风险认证器 |
| [ROUTING_SELFTEST_STEPS.zh.md](ROUTING_SELFTEST_STEPS.zh.md) | 冻结选择、同题实测与官方费用记录步骤 |
| [livebench-prior-study.mjs](../scripts/livebench-prior-study.mjs) | 聚合质量画像的 best-single 与经验领域上包络，不是部署策略回放 |

源码处于未提交开发状态，应以实验记录中的文件 SHA256 识别对象，而不是仅凭版本号认定字节相同。历史 npm 稳定版与 Git 标签不因本报告而改动。
