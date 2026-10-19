# 路由算法优化：实施与使用

本轮把任务相关证据、模型与推理档位联合选择、真实资源估计和依赖感知搜索接入规划器，并提供可选的 JSON 结构验收级联。它们改进的是有证据约束的规划和执行行为；真实回答质量提高多少、总费用降低多少，仍需独立留出任务上的同题实测。

## 已实现的行为

- **任务相关质量证据**：按 provider、model、reasoningEffort、channel、任务类型精确匹配，再用查询的哈希词法特征检索相似训练任务。不同任务组才计为不同邻居；样本不足或查询不相似时回退原有估计，不给未调用模型补造标签。输出的邻居离散程度不是校准后的答对概率。
- **模型 × effort 联合选择**：同一 API 模型至少有两个档位各自具备可用任务证据时，才把这些档位展开成独立动作。冷启动保留原档位选择方式；同一模型切换 effort 不计为跨模型交接。
- **真实资源估计**：从成功且用量完整的工作包学习输入比例、输出 token 和耗时的经验分布，规划时使用可用的 P90 估计。计数不足、模型身份不符或用量不完整时回退启发式估计。经验分位数不保证整次运行不超预算。
- **有界 DAG 搜索**：默认候选组合数不超过 4096 时精确枚举；更大空间保留未来依赖所需的模型边界，安全压缩被支配前缀，再按未来交接的乐观估计限宽，默认宽度 256。有限预算继续保护可负担前缀，未知价格不能证明预算可行。
- **effort 执行一致性**：API 调用传递路由允许列表中的精确 effort ID，并记录计划值、请求值及状态。`requested` 只代表 SDK 请求已携带该控制，不证明提供方实际使用了该强度。CLI 规划使用厂商默认档位；显式传入尚未支持的 CLI effort 时记录 `unsupported`，换模型时不会继承原模型的档位。

搜索结果中的 `strategy`、`expandedStates`、`dominancePruned`、`beamPruned`、`peakFrontier` 和 `beamWidth` 可用于审计。`exact` 的范围仅是传入的保留候选空间；beam 路径的 `approximate: true`、`boundCertified: false` 不提供全池最优或目标差距保证。

## 导入离线质量证据

在源码项目根目录运行：

```powershell
node scripts/build-routing-evidence.mjs --input data.json --output evidence.json
```

此命令只处理本地文件，不调用模型、不联网、不自动收集历史。输入顶层是 `{ "runs": [...], "observations": [...], "matrix": {...} }`，三项均可省略。输入文件上限 10 MB，`runs` 和最终展开的 `observations` 各不超过 10000 条；输入输出路径必须不同。

一条 `observations` 的字段示例如下。示例不代表真实测量；`timestamp` 应使用实际采样的 Unix 毫秒时间，`quality` 应来自可追溯的客观验收。

```json
{
  "observations": [
    {
      "id": "task-001:model-a:medium",
      "groupId": "task-001",
      "text": "修复缓存失效后返回旧值的问题",
      "type": "code",
      "provider": "configured-provider-id",
      "model": "configured-model-id",
      "reasoningEffort": "medium",
      "channel": "harness-llm",
      "quality": 1,
      "split": "train",
      "timestamp": 1792281600000,
      "provenance": {
        "kind": "objective",
        "source": "unit-tests",
        "reference": "audit/run-001"
      }
    }
  ]
}
```

每条记录必须有上述身份、任务文本、类型、评分、时间、训练划分和来源字段。`reasoningEffort: ""` 表示档位未知；不能替换为任意已知档位。`channel: "api"` 会归一为 `harness-llm`。质量分须在 `[0,1]` 内，来源须声明 `kind: "objective"` 和非空 `source`、`reference`；点赞、自评、模型裁判和主观偏好不能直接当作这类标签。

`runs` 接受运行账本形状：run 含 `id`、`task`、`createdAt`、`finishedAt`、`packages`；工作包含 `id`、`provider`、`model`、`channel`、`type`、`purpose`、`ran: true`、`ok: true`、`usage`、`inputChars`、`finishedAt`，可含 `durationMs`。资源学习要求有效的非负 `usage.inputTokens`、`usage.outputTokens` 和实际正整数输入字符数。可选的 cache 计数必须是与未缓存输入互斥的读、写类别，不能把已包含缓存的总数再相加。缺失或未知计数不应补零。时间须落在有效窗口及所属 run 的起止范围内；失败、用量不完整、身份不符、重复或多次质量调用合并后的工作包不作为单动作资源样本。资源拒绝原因保留在产物 `stats` 中，账本中的评分不会自动变成质量标签。

同题多动作也可用矩阵输入：`matrix` 必须含 `split: "train"` 和 `tasks`；每个 task 含 `id`、`groupId`、`text`、`type`、`timestamp`、`results`。每个 result 含 `action: {provider, model, reasoningEffort, channel}`、`quality`、`provenance`，可另给唯一 `id`。只写实际测量的动作，未调用的动作保持未知。

重复 id、同一任务组的重复动作、未来或过期时间、非法客观记录和未经显式允许的 synthetic 记录会使 CLI 的质量导入失败。测试、验证、校准任务须按 `groupId` 在生成训练输入前分离；它们不能作为训练邻居导入。默认时间窗口为 180 天。

`--min-samples N` 可用于离线实验，默认 8；`--now TIMESTAMP` 固定评估时间以便复现；`--allow-synthetic` 只用于测试夹具。**生产 Host 重新构建证据时固定采用至少 8 个匹配样本的门槛**，不会沿用离线降低的门槛；质量预测还要求这些样本来自不同且足够相似的任务组。上面的单条示例不足以触发质量预测。

将生成文件的 JSON 文本填入插件设置的 `routingEvidenceJson`（最多 200000 字符）。Host 只从导入产物接收质量样本；资源统计从本机运行账本重新学习。`resourceLearningEnabled` 默认 `true`，关闭后停止使用账本重建资源证据。没有可用证据时保持原有冷启动回退。

输出产物不保留任务和答案明文，但词法哈希不保证匿名。`revision` 是内容变化标识，不是来源认证或签名；严格解析只能校验声明的格式，不能证明评分和来源真实。

## 可选结构验收与一次升级

`qualityEscalationEnabled` 默认 `false`。在 `qualityGateJson` 中填写 JSON 文本，例如：

```json
{
  "kind": "json-object",
  "requiredKeys": ["answer"],
  "fieldTypes": {"answer": "string", "sources": "array"}
}
```

空文本或 `{}` 表示没有 gate。仅支持 `json-object`，只接受完整 JSON 对象，不从散文或 Markdown 代码块提取 JSON。`requiredKeys` 最多 32 个安全键；`fieldTypes` 支持 `string`、`number`、`boolean`、`object`、`array`、`null`，只检查存在的自身字段；需要必填的字段须同时列入 `requiredKeys`。未知配置字段、非法类型和危险键会被拒绝。JSON 数字必须有限。

gate 检查结构，不判断回答是否正确。首次通过、没有 gate、升级关闭、请求失败、取消、阻塞、暂停或截断，都不会因此多调用模型。只有显式启用升级、首次结构验收失败、存在不同 provider/model 的已配置合格 API 替代路线，并通过预算与计费批准，才最多再调用一次；不循环重跑同一模型。

当前自动质量升级适用于普通 API 工作包：原路线和替代路线均须显式配置 `execution: "api"`，或属于没有官方工具映射的提供方；两者都排除显式 `subscription-first`、`subscription-only` 和 `execution: "official"`，也排除计费计划识别出的任何订阅（含编程套餐名称与关联 `apiRoute`）。有官方工具映射的 API 路线可用 `subscription: "none"` 明确普通 API 身份。替代路线的已知质量先验须高于原路线。CLI、编程套餐订阅调用和 direct 强制指定模型不会自动换模型升级。首次调用已经产生的 usage、价格快照和报告费用会保留在 `qualityAttempts` 中；批准回调失败、第二次失败或两次之间取消，都不能抹掉首次消耗。不同模型的 token 不合并成一个虚假的单模型账单。部分费用未知时 `costUsd` 保持 `null`，已知部分另以 `knownCostUsd` 计入日/月已知小计，并保留未知标记。

## 验证与解释边界

```powershell
npm run test:routing-algorithm
node --test tests/routing-search-experiment.test.mjs tests/routing-search-summary.test.mjs tests/routing-search-frontier.test.mjs tests/routing-optimizer.test.mjs
```

搜索回归同时检查独立穷举 oracle、预算、随机 DAG、档位交接和顺序稳定性。已知 6561 组合反例恢复了零交接解；1728 组合反例的无预算 beam 路径也与 oracle 一致。不过宽度 1 的紧预算条件仍可能损失目标效用，测试继续保留这一差距。固定池上的这些结果不能代替真实模型质量与总成本评估。
