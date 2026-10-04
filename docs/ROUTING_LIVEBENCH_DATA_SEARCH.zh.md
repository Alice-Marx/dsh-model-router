# LiveBench 逐题文件：扩展检索与候选审计

核查日期：2026-10-04（Asia/Shanghai）。这是数据调查，不是路由收益实验。

## 结论

**已实际下载第三方逐题附件和调用日志，但在本次核查范围内，仍未取得官方最新 `2026-06-25` 的完整同题多模型质量—费用矩阵。** 不要求用户提供其没有的文件；不把旧题新上传、答案对、单模型改提示词实验或排行榜均分冒称所需矩阵。

最新官方聚合数据的审计见 [前一阶段报告](ROUTING_LIVEBENCH_VALIDATION.zh.md)。本报告扩大检索范围，不改变此前“真实收益尚未验证”的结论；没有调用付费模型、联系第三方、使用用户令牌或发布版本。

## 1 实际取得的候选文件

| 来源 | 已下载内容／实际检查 | 能用来做什么 | 当前不能用来做什么 |
|---|---|---|---|
| [TuringCorp 提交 #449](https://github.com/LiveBench/LiveBench/issues/449) | 两个 ZIP；每包 13 个答案 JSONL、682 行；两包按任务+ID有682对答案 | 检查答案格式与提供者用量记录 | 无逐题评分；全部 `cost_usd=null`；无法验证质量—费用收益 |
| [Neuromantix 提交仓库](https://github.com/ModernOps888/neuromantix-livebench/tree/38c100343fbbc9b65e25ebfdead8e1d1339a18e1) | 一个 ZIP；400条答案、300条judgment、5任务、1个提交动作 | 审查历史逐题评分覆盖 | 明确使用2024-11-25题集；无费用／token；不是多模型矩阵 |
| [Redwood 原始实验](https://github.com/redwoodresearch/astra-filler-tokens/tree/56089d101e604b58468a0524bb937c57a8a097f6) | 实际下载的日志有8328调用；其中LiveBench1854调用＝618题×3提示词条件 | 检查旧题的单模型、修改提示词实验及实际API用量 | LiveBench部分仅 `gpt-6-astra`；旧题；不是官方新题多模型回放，未见USD金额 |

这三组均是来源提供者公开的自有记录；本轮只读解析，不执行他们的程序，也未独立重跑评分器。原文仅作本地研究归档，不将仓库代码许可自动扩大为所有题目/回答的再分发许可。

### 1.1 TuringCorp：包名日期与题目身份分开

提交帖和包名自称 `2026-01-08`；但682个 `(category, task, question_id)` 全部在官方旧公开题库中找到，题目 `livebench_release_date` 分布为：2024-06-24有246，2024-07-26有50，2024-08-31有86，2024-11-25有300。没有2026新题ID的证据。包不含原始prompt，**ID匹配不证明实际执行提示词完全相同**，也不能仅由题目初次发布日证明某次题集筛选的完整组成。

题目对齐使用官方HF viewer全部分页，五个非coding test split均已读完；取数后各仓库SHA仍与取数前一致。viewer不提供对应Parquet精确revision身份，因此报告为“当次viewer快照中的ID/题目日期匹配”，不冒称固定Parquet字节复现。详情在归档 `summary-question-alignment.json`（分页覆盖）与 `summary-deeper.json`（正确字段的最终日期核对）。早期中间摘要错误读取 `livebench_release` 得到null；最终使用实际字段 `livebench_release_date`，中间稿保留而不作为结论。

两包各682条都含输入/输出/缓存token记录；缓存计数均为0，费用全部未知。无法确认多模型编排的内部调用、隐藏推理、重试及用量是否全部进入这些字段，不以外层token数量直接推断总账。

一致性缺口：提交帖Junior/Senior总分为81.6/85.2，包内SCORES为80.5/84.0；Math为81.1/86.8与75.5/80.4。应先由提供者解释评分文件／配置对应关系；这些差异本身不证明造假，也不能由无逐题标签的摘要自行修复。

### 1.2 Neuromantix：上传时间不等于新题与完整评分

作者明确标2024-11-25。实际包内AMPS_Hard有150答案但100评分，zebra_puzzle有100答案但50评分；两任务各50个answer-only ID。其余三个任务各50答案／评分。缺失标签保留未知，不填0，不用有标签子集代替声称的全部分母；无逐题费用，且只有一个提交动作。

### 1.3 Redwood：有调用记录，但协议和动作池不同

固定源码提交2026-09-28。实际LiveBench日志是618个旧题、同一模型、条件`B/0`、`CB/300`、`CB/1000`各618调用；618题三条件ID交集完整。都有布尔correct、输入/输出token及API返回记录，不能把三个提示词条件说成三个模型。

618题元信息的首次release为2024-06-24（382）、2024-07-26（50）、2024-08-31（136）、2024-11-25（50）。作者去除了原题CoT/输出格式句，禁止推理，并按gold答案长度设输出上限；这不是本项目的原题直接回答协议。公开日志的billing只有payer字段，未见USD金额。故可做来源实验的描述性复核，不能直接用于当前选模算法或最新版收益验证。

## 2 实际检索范围与证据

| 核查入口 | 覆盖与结果 | 可复核资料 |
|---|---|---|
| 官方HF组织 | 10公开数据集；10 refs列表均只有main与convert/parquet、无tags/额外分支；main历史返回107提交，无后续分页；最新main提交止于2025-04-07 | `manifest-hf.json`、`summary-hf.json`；[组织API](https://huggingface.co/api/datasets?author=livebench&limit=100&full=true) |
| 官方GitHub分支 | 两页API枚举120分支；bare/blob过滤克隆的全部120分支tip SHA与API逐一一致；递归树未见jsonl/parquet/csv/zip/tar/sqlite/db格式结果文件 | `summary-alltrees.json`；[分支API](https://api.github.com/repos/LiveBench/LiveBench/branches?per_page=100&page=1) |
| 官方GitHub发布 | releases API返回空数组，无可从此入口获取的发布资产 | `official-releases.json`；[releases API](https://api.github.com/repos/LiveBench/LiveBench/releases?per_page=100) |
| 最新题集线索 | #540是历史运行元信息请求；#513是hosted evaluation请求。核查时两者comments均0，未附逐题结果 | [#540](https://github.com/LiveBench/LiveBench/issues/540)、[#513](https://github.com/LiveBench/LiveBench/issues/513)，原API快照归档 |
| 新上传镜像 | lthn评分文件LFS SHA与官方2025评分相同；Distillio题目LFS SHA与官方2025 coding相同。没有重复下载244.8MB旧题文件 | `summary-hf.json`；[lthn](https://huggingface.co/datasets/lthn/livebench-model_judgment/tree/1c7a95d00f89e5dd07a2d3699278f6ba0da493cd)、[Distillio](https://huggingface.co/datasets/Distillio/Livebench/tree/a5adcf34a862856cb02a55af9344e2a315d99b02) |
| 同名候选 | mm-eval为2024月份的多模态LiveBench；aleeyanger只有1.51GB无schema说明的LiveBG压缩包，未下载，不声称已检查包内内容 | 各metadata快照；[mm-eval](https://huggingface.co/datasets/mm-eval/LiveBench)、[aleeyanger](https://huggingface.co/datasets/aleeyanger/live_bench) |
| 其他路由自报 | SCX模型卡给出LiveBench聚合路由分与本地`results/report.json`名称；不等于公开完整逐题质量/费用文件 | [作者模型卡](https://huggingface.co/scx-admin/scx-router-v0.1)；本轮未下载模型权重或训练 |

上述“未找到”仅涵盖被核查的匿名公开入口及当前可达分支tip，**不涵盖私有/gated/已删除/不可达历史、未知名称仓库或全网所有附件**。未对所有120分支的全部历史提交做内容搜索。下载/解析的路径与哈希可复核；第三方来源真实性、模型配置、评分准确性仍需独立证明。

官方README仍提示全类别公开题需用2024-11-25，而新站费用生成说明提到`livebench-private`。因此，不能仅靠升级下载脚本得到2026完整题集。[官方README](https://github.com/LiveBench/LiveBench/blob/8f8e5c381a16e3f24257776edd53471fe86f8091/README.md)、[新站数据说明](https://github.com/LiveBench/new-livebench/blob/caa4253c8a3aa93b5c7ec234e681d4f120a20240/README.md)

## 3 原文件身份与重放

| 文件 | bytes | SHA256 |
|---|---:|---|
| `turingcorp-team-junior-v1_livebench-20260108.zip` | 290630 | `4fdfaba07ef69928ea0cb1764fc6c1d261d16bd1f9b3f25e1fc26e655210ce51` |
| `turingcorp-team-senior-v1_livebench-20260108.zip` | 279738 | `a74ddb9109bdb57fa83eb99e29b74e5a1428c2c804bf41780e34f0a13be95161` |

其余文件字节数、URL、SHA256见本机raw中分阶段manifest；最终归档manifest覆盖所有原始文件。ZIP不提取、不执行；只用标准库读JSONL，检查路径和解压后总量。Gzip日志设40MB展开上限。原始文件只写新路径，不改旧档案。

归档的`collect-public.mjs`、`audit-files.py`是本轮自行编写的取数/检查工具，不是下载的第三方代码。`deeper`可离线重做最终ID日期与覆盖统计；`alltrees`只读已克隆的Git对象树。最初树命令使用`--long`读取对象大小可能触发blob懒获取，已中断并改用无`--long`的树元信息检查；未执行来源仓库的程序。HF的Node传输失败后，用本机requests直连成功，未安装新依赖或使用私有认证。

## 4 下一步与不越界的停止条件

现有文件无法补出官方2026-06-25完整矩阵。下一条有明确价值的路线是向维护者索取该release的版本化逐题评分、同题匿名ID、精确动作、用量/费用和可本地读取的题目特征；如果不能公开prompt，单靠ID+标签仍不够重放query-dependent选模。

已在本地归档拟好数据请求草稿，**尚未发送**。对外联系需要用户授权；任何重新付费评测还需要模型池、题集与预算上限。取得合格数据前，不执行配对收益检验、不报告节省百分比、不改生产能力先验；可用的旧题/改协议数据只按其真实范围另立实验。

2026-10-04用户决定结束检索，之后自行实测。本轮到此停止，不再联系维护者或补测。自测记录建议保留 `(release, category, task, question_id)`、prompt、精确模型/effort、生成参数、逐题quality、计费用量或costUsd、评分器版本、运行时间以及全部失败/重试。费用未知保留null；路由选择先冻结再连接标签，避免测试结果参与选模。未来实验需依据实际模型池重新审计协议，不自动把现有候选作为训练标签。
