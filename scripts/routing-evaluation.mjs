// Offline evaluation only: all candidate outcomes and test routes are supplied.
// No strategy is trained or selected from test outcomes, except the hindsight
// oracle, which is an upper bound and cannot be deployed.

const RANDOM_SEED = 20261003
const RECALL_BUCKETS = ['1', '2-3', '4+']

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function fail(path, message) {
  throw new TypeError(`${path}: ${message}`)
}

function requireRecord(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail(path, 'must be a plain object')
  }
}

function requireText(value, path) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    fail(path, 'must be a non-empty string without surrounding whitespace')
  }
}

function requireCost(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(path, 'must be a finite, non-negative number')
  }
}

function validateDataset(dataset) {
  requireRecord(dataset, 'dataset')
  if (!['synthetic', 'recorded'].includes(dataset.provenance)) {
    fail('dataset.provenance', 'must be "synthetic" or "recorded"')
  }
  if (!Array.isArray(dataset.models) || dataset.models.length === 0) {
    fail('dataset.models', 'must be a non-empty array')
  }
  const modelSet = new Set()
  for (const [index, model] of dataset.models.entries()) {
    requireText(model, `dataset.models[${index}]`)
    if (!/^[^/\s]+\/\S+$/.test(model)) {
      fail(`dataset.models[${index}]`, 'must have the form "provider/model"')
    }
    if (modelSet.has(model)) fail('dataset.models', `duplicate model ${JSON.stringify(model)}`)
    modelSet.add(model)
  }
  const models = [...modelSet].sort(compareText)
  const ids = new Set()
  const normalized = {}
  for (const split of ['validation', 'test']) {
    if (!Array.isArray(dataset[split]) || dataset[split].length === 0) {
      fail(`dataset.${split}`, 'must be a non-empty array')
    }
    normalized[split] = [...dataset[split]].map((row, index) => {
      const path = `dataset.${split}[${index}]`
      requireRecord(row, path)
      requireText(row.id, `${path}.id`)
      requireText(row.domain, `${path}.domain`)
      if (ids.has(row.id)) {
        fail(`${path}.id`, 'must be unique across validation and test; overlapping IDs are prohibited')
      }
      ids.add(row.id)
      requireRecord(row.results, `${path}.results`)
      const keys = Reflect.ownKeys(row.results)
      if (keys.length !== models.length || keys.some(model => !modelSet.has(model))) {
        fail(`${path}.results`, 'must contain exactly the fixed model pool, with one result per model')
      }
      const results = Object.fromEntries(models.map(model => {
        const resultPath = `${path}.results[${JSON.stringify(model)}]`
        if (!Object.hasOwn(row.results, model)) fail(resultPath, 'missing result for model')
        const result = row.results[model]
        requireRecord(result, resultPath)
        if (!Object.hasOwn(result, 'correct') || typeof result.correct !== 'boolean') {
          fail(`${resultPath}.correct`, 'must be a boolean')
        }
        if (!Object.hasOwn(result, 'costUsd')) fail(`${resultPath}.costUsd`, 'missing recorded cost')
        requireCost(result.costUsd, `${resultPath}.costUsd`)
        return [model, { correct: result.correct, costUsd: result.costUsd }]
      }))
      const correctModelCount = models.filter(model => results[model].correct).length
      if (split === 'test') {
        if (typeof row.selected !== 'string' || !modelSet.has(row.selected)) {
          fail(`${path}.selected`, 'must be an externally selected model from the fixed model pool')
        }
        const routingCostUsd = Object.hasOwn(row, 'routingCostUsd') ? row.routingCostUsd : 0
        requireCost(routingCostUsd, `${path}.routingCostUsd`)
        if (!Number.isFinite(results[row.selected].costUsd + routingCostUsd)) {
          fail(`${path}.routingCostUsd`, 'selected model cost plus routing cost must remain finite')
        }
        return { id: row.id, domain: row.domain, selected: row.selected, routingCostUsd, results, correctModelCount }
      }
      return { id: row.id, domain: row.domain, results, correctModelCount }
    }).sort((left, right) => compareText(left.id, right.id))
  }
  return { provenance: dataset.provenance, models, ...normalized }
}

// Incremental means avoid overflowing a sum of individually finite costs.
function mean(values) {
  let result = 0
  for (const [index, value] of values.entries()) result += (value - result) / (index + 1)
  return result
}

function summarize(rows, selections, routingCosts, models) {
  const domains = new Map()
  const selectedCounts = new Map(models.map(model => [model, 0]))
  const buckets = Object.fromEntries(RECALL_BUCKETS.map(bucket => [bucket, {
    examples: 0, correctSelections: 0, recall: null,
  }]))
  let correct = 0
  let noCorrectModelExamples = 0
  const modelCosts = []
  const totalCosts = []
  for (const [index, row] of rows.entries()) {
    const selected = selections[index]
    const result = row.results[selected]
    const value = Number(result.correct)
    correct += value
    modelCosts.push(result.costUsd)
    totalCosts.push(result.costUsd + routingCosts[index])
    selectedCounts.set(selected, selectedCounts.get(selected) + 1)
    if (!domains.has(row.domain)) domains.set(row.domain, { examples: 0, correct: 0 })
    const domain = domains.get(row.domain)
    domain.examples += 1
    domain.correct += value
    const { correctModelCount } = row
    if (correctModelCount === 0) {
      noCorrectModelExamples += 1
    } else {
      const bucket = buckets[correctModelCount === 1 ? '1' : correctModelCount <= 3 ? '2-3' : '4+']
      bucket.examples += 1
      bucket.correctSelections += value
    }
  }
  for (const bucket of Object.values(buckets)) {
    if (bucket.examples > 0) bucket.recall = bucket.correctSelections / bucket.examples
  }
  const domainMetrics = Object.fromEntries([...domains.entries()].sort(([left], [right]) => compareText(left, right))
    .map(([domain, counts]) => [domain, { ...counts, accuracy: counts.correct / counts.examples }]))
  return {
    examples: rows.length,
    correct,
    accuracy: correct / rows.length,
    macroDomainAccuracy: mean(Object.values(domainMetrics).map(domain => domain.accuracy)),
    meanModelCostUsd: mean(modelCosts),
    meanRoutingCostUsd: mean(routingCosts),
    meanCostUsd: mean(totalCosts),
    domainMetrics,
    selectedModelCounts: Object.fromEntries(selectedCounts),
    expertRecallByCorrectModelCount: buckets,
    noCorrectModelExamples,
  }
}

function singleModelMetrics(rows, model, models) {
  const metrics = summarize(rows, rows.map(() => model), rows.map(() => 0), models)
  return {
    model,
    accuracy: metrics.accuracy,
    macroDomainAccuracy: metrics.macroDomainAccuracy,
    meanCostUsd: metrics.meanCostUsd,
  }
}

function seededRandom() {
  let seed = RANDOM_SEED
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

/**
 * Evaluate supplied outcomes without invoking models or fitting a router.
 * Best-single and cheapest-single are selected only from validation rows.
 * oracleGap is an absolute accuracy difference (oracle minus this strategy).
 * Expert recall is the proportion of selected models that are correct within
 * each number-of-correct-models bucket, not candidate recall@k.
 */
export function evaluateRouting(dataset) {
  const { provenance, models, validation, test } = validateDataset(dataset)
  const singleModels = models.map(model => singleModelMetrics(validation, model, models))
  const bestSingle = [...singleModels].sort((left, right) => right.macroDomainAccuracy - left.macroDomainAccuracy
    || left.meanCostUsd - right.meanCostUsd || compareText(left.model, right.model))[0]
  const cheapestSingle = [...singleModels].sort((left, right) => left.meanCostUsd - right.meanCostUsd
    || compareText(left.model, right.model))[0]
  const random = seededRandom()
  const selections = {
    'recorded-router': test.map(row => row.selected),
    'best-single': test.map(() => bestSingle.model),
    'cheapest-single': test.map(() => cheapestSingle.model),
    random: test.map(() => models[Math.floor(random() * models.length)]),
    oracle: test.map(row => {
      const correctModels = models.filter(model => row.results[model].correct)
      const candidates = correctModels.length ? correctModels : models
      return [...candidates].sort((left, right) => row.results[left].costUsd - row.results[right].costUsd
        || compareText(left, right))[0]
    }),
  }
  const strategies = Object.fromEntries(Object.entries(selections).map(([name, selected]) => [name,
    summarize(test, selected, test.map(row => name === 'recorded-router' ? row.routingCostUsd : 0), models),
  ]))
  for (const metrics of Object.values(strategies)) {
    metrics.oracleGap = strategies.oracle.accuracy - metrics.accuracy
    metrics.macroDomainOracleGap = strategies.oracle.macroDomainAccuracy - metrics.macroDomainAccuracy
  }
  return {
    schemaVersion: 1,
    provenance,
    claimScope: provenance === 'synthetic' ? 'synthetic-only-no-real-world-gain' : 'supplied-recorded-dataset-only',
    models,
    splits: {
      validationExamples: validation.length,
      testExamples: test.length,
      validationDomains: new Set(validation.map(row => row.domain)).size,
      testDomains: new Set(test.map(row => row.domain)).size,
    },
    baselineSelection: {
      bestSingle: { ...bestSingle, selectedOn: 'validation',
        rule: 'highest macroDomainAccuracy, then lowest meanCostUsd, then model ID' },
      cheapestSingle: { ...cheapestSingle, selectedOn: 'validation',
        rule: 'lowest meanCostUsd, then model ID' },
      random: { seed: RANDOM_SEED, order: 'model IDs and test IDs sorted lexicographically' },
      oracle: { selectedOn: 'test-hindsight', deployable: false },
    },
    metricDefinitions: {
      accuracy: 'Correct selected outputs divided by all test examples.',
      macroDomainAccuracy: 'Unweighted mean of test accuracy across domains.',
      meanCostUsd: 'Mean supplied selected model cost plus supplied routing cost (router only).',
      oracleGap: 'Oracle accuracy minus strategy accuracy; an absolute difference, not relative gain.',
      expertRecallByCorrectModelCount: 'Correct selected outputs divided by examples in each 1 / 2-3 / 4+ correct-model bucket; null for empty buckets. Zero-correct-model examples are excluded.',
    },
    strategies,
    limitations: [
      'Synthetic data verifies evaluation behavior only and does not demonstrate real-world quality or cost gains.',
      'Provenance and externally selected routes are supplied by the caller; their collection process and independence from test labels cannot be audited here.',
      'The hindsight oracle uses test outcomes and cannot be deployed or treated as an achievable routing policy.',
      'Results apply only to this fixed model pool, supplied outputs, domains, and costs; they do not establish generalization or statistical significance.',
      'Only recorded-router includes routingCostUsd, which defaults to zero when omitted. Other baseline routing overhead is unmeasured.',
      'Retries, failed calls, caching, collection costs, and other overhead are counted only if already included in supplied costs. No latency or calibration metrics are available in this schema.',
    ],
  }
}
