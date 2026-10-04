import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Research-only: these are model/task aggregates, never a question-level matrix.
export const PINNED_LIVEBENCH_SOURCE = Object.freeze({
  release: '2026-06-25',
  revision: 'caa4253c8a3aa93b5c7ec234e681d4f120a20240',
  files: {
    scores: { name: 'table_2026_06_25.csv', sha256: '1021e4ef211ccba609d6da2c22032f46d695c1546508cf144a58a2f3d6960f3d' },
    costs: { name: 'cost_2026_06_25.csv', sha256: 'd572014a891e76ef3f30896f66cc873ec02eb5c7d10909a6796efe450ad05ba9' },
    categories: { name: 'categories_2026_06_25.json', sha256: 'dad300ad18655b69db720e1b88fc5a5eac06c5b2f0e52c2bf50f10ff057674f3' }
  },
  scoreFormula: 'https://github.com/LiveBench/new-livebench/blob/caa4253c8a3aa93b5c7ec234e681d4f120a20240/src/Table/Averaging.js',
  costFormula: 'https://github.com/LiveBench/new-livebench/blob/caa4253c8a3aa93b5c7ec234e681d4f120a20240/src/lib/compute.js'
})

const MAX_INPUT_BYTES = 16 * 1024 * 1024
const sha256 = value => createHash('sha256').update(value).digest('hex')
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0
const FRONTIER_RELATIVE_TOLERANCE = 32 * Number.EPSILON
// Neumaier compensation reduces summation-order noise without display rounding.
function compensatedSum(values) {
  let sum = 0, correction = 0
  for (const value of values) {
    const next = sum + value
    if (!Number.isFinite(next)) return next
    correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum
    sum = next
  }
  return sum + correction
}
const mean = values => values.length ? compensatedSum(values) / values.length : null
const display = value => value === null ? null : value.toFixed(2)

function compareMetric(a, b, scaleFloor) {
  const tolerance = FRONTIER_RELATIVE_TOLERANCE * Math.max(scaleFloor, Math.abs(a), Math.abs(b))
  return Math.abs(a - b) <= tolerance ? 0 : a < b ? -1 : 1
}

/** Strict RFC-4180-style CSV reader; no coercion, eval, or spreadsheet execution. */
export function parseAggregateCsv(text, label = 'CSV') {
  if (typeof text !== 'string') throw new TypeError(`${label}: expected CSV text`)
  if (Buffer.byteLength(text) > MAX_INPUT_BYTES) throw new Error(`${label}: input exceeds ${MAX_INPUT_BYTES} bytes`)
  if (text.includes('\0')) throw new Error(`${label}: NUL is not allowed`)
  if (text.startsWith('\uFEFF')) text = text.slice(1)
  const rows = []
  let row = [], field = '', state = 'start', touched = false
  const finishField = () => { row.push(field); field = ''; state = 'start' }
  const finishRow = () => {
    finishField()
    if (!(row.length === 1 && row[0] === '' && !touched)) rows.push(row)
    row = []; touched = false
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (state === 'quoted') {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else state = 'closed'
      } else field += char
      continue
    }
    if (char === ',' || char === '\n' || char === '\r') {
      if (char === ',') { finishField(); touched = true }
      else {
        finishRow()
        if (char === '\r' && text[i + 1] === '\n') i++
      }
      continue
    }
    if (state === 'closed') throw new Error(`${label}: characters after a closing quote`)
    touched = true
    if (char === '"') {
      if (state !== 'start') throw new Error(`${label}: quote inside an unquoted field`)
      state = 'quoted'
    } else { field += char; state = 'unquoted' }
  }
  if (state === 'quoted') throw new Error(`${label}: unterminated quoted field`)
  if (touched || row.length || field !== '' || state === 'closed') finishRow()
  if (!rows.length) throw new Error(`${label}: missing header`)
  const headers = rows.shift()
  if (headers.some(header => !header || header !== header.trim() || /[\r\n\u0000-\u001f]/u.test(header))) {
    throw new Error(`${label}: empty, padded, or control-character header`)
  }
  if (new Set(headers).size !== headers.length) throw new Error(`${label}: duplicate header`)
  if (!headers.includes('model')) throw new Error(`${label}: missing model header`)
  const models = new Map()
  for (const [index, values] of rows.entries()) {
    if (values.length !== headers.length) throw new Error(`${label}: row ${index + 2} has ${values.length} fields; expected ${headers.length}`)
    const record = Object.fromEntries(headers.map((header, i) => [header, values[i]]))
    const model = record.model
    if (!model || model !== model.trim() || /[\u0000-\u001f\u007f]/u.test(model)) throw new Error(`${label}: invalid exact model ID in row ${index + 2}`)
    if (models.has(model)) throw new Error(`${label}: duplicate model ${model}`)
    models.set(model, record)
  }
  return { headers, models }
}

// Canonical decimal digits × 10^power; never allocate a power-of-ten expansion.
function decimalParts(match) {
  const fraction = match[3] ?? match[4] ?? ''
  let digits = `${match[2] ?? ''}${fraction}`.replace(/^0+/u, '')
  if (!digits) return { negative: false, digits: '0', power: 0 }
  const exponent = Number(match[5] ?? 0)
  if (!Number.isSafeInteger(exponent)) return null
  const withoutTrailingZeros = digits.replace(/0+$/u, '')
  const power = exponent - fraction.length + digits.length - withoutTrailingZeros.length
  digits = withoutTrailingZeros
  return { negative: match[1] === '-', digits, power }
}

function exceedsIntegerBound(decimal, bound) {
  if (decimal.digits === '0') return false
  const integerPlaces = decimal.digits.length + decimal.power
  if (integerPlaces !== bound.length) return integerPlaces > bound.length
  const prefix = decimal.digits.slice(0, bound.length).padEnd(bound.length, '0')
  // Canonical digits have no trailing zero, so any remaining suffix is positive.
  return prefix > bound || (prefix === bound && decimal.digits.length > bound.length)
}

function numericCell(record, column, kind, model) {
  const cell = record?.[column]
  if (cell === undefined || cell.trim() === '') return null
  const valueText = cell.trim()
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/u.exec(valueText)
  if (!match) {
    throw new Error(`${model}: ${column} is not a finite decimal ${kind}`)
  }
  const value = Number(valueText)
  const decimal = Number.isFinite(value) ? decimalParts(match) : null
  const zero = decimal?.digits === '0'
  const valid = decimal !== null && !decimal.negative && (value !== 0 || zero) &&
    (kind === 'score' ? !exceedsIntegerBound(decimal, '100') :
      kind === 'count' ? !zero && decimal.power >= 0 && !exceedsIntegerBound(decimal, '9007199254740991') && Number.isSafeInteger(value) : true)
  if (!valid) throw new Error(`${model}: invalid ${kind} in ${column}: ${valueText}`)
  return value
}

function validateCategories(categories) {
  if (!categories || typeof categories !== 'object' || Array.isArray(categories)) throw new Error('categories must be a nonempty object of task arrays')
  const entries = Object.entries(categories)
  if (!entries.length) throw new Error('categories must not be empty')
  const seen = new Set()
  for (const [category, tasks] of entries) {
    if (!category || category !== category.trim() || !Array.isArray(tasks) || !tasks.length) throw new Error('invalid category or empty task array')
    for (const task of tasks) {
      if (typeof task !== 'string' || !task || task !== task.trim() || /[\u0000-\u001f]/u.test(task) || task === 'model' || task.startsWith('nq_')) throw new Error(`invalid task in ${category}`)
      if (seen.has(task)) throw new Error(`duplicate category task: ${task}`)
      seen.add(task)
    }
  }
  return { entries, tasks: [...seen] }
}

function finiteSum(values, label) {
  const result = compensatedSum(values)
  if (!Number.isFinite(result)) throw new Error(`${label}: aggregate overflow`)
  return result
}

function summarizeScope(tasks, taskScores, taskCosts) {
  const scores = tasks.map(task => taskScores[task]).filter(value => value !== null)
  const costs = tasks.map(task => taskCosts[task].totalCostUsd).filter(value => value !== null)
  const counts = tasks.map(task => taskCosts[task].questionCount).filter(value => value !== null)
  const totalCostUsd = costs.length === tasks.length ? finiteSum(costs, 'cost') : null
  const questionCount = counts.length === tasks.length ? finiteSum(counts, 'count') : null
  if (questionCount !== null && !Number.isSafeInteger(questionCount)) throw new Error('aggregate question count exceeds safe integer range')
  const scorePct = mean(scores)
  return {
    tasksExpected: tasks.length,
    scoredTasks: scores.length,
    costedTasks: costs.length,
    countedTasks: counts.length,
    scoreComplete: scores.length === tasks.length,
    costComplete: costs.length === tasks.length && counts.length === tasks.length,
    scorePct,
    scoreDisplay: display(scorePct),
    totalCostUsd,
    questionCount,
    costPerQuestionUsd: totalCostUsd !== null && questionCount !== null ? totalCostUsd / questionCount : null
  }
}

/** Descriptive audit only. This function does not estimate or validate routing gains. */
export function auditLiveBenchAggregates({ scoresCsv, costsCsv, categories }) {
  const { entries, tasks } = validateCategories(categories)
  const scores = parseAggregateCsv(scoresCsv, 'scores CSV')
  const costs = parseAggregateCsv(costsCsv, 'costs CSV')
  // Validate every supplied task value, including models present in only one file.
  const models = [...new Set([...scores.models.keys(), ...costs.models.keys()])].sort(compareText)
  const rows = models.map(model => {
    const scoreRecord = scores.models.get(model)
    const costRecord = costs.models.get(model)
    const taskScores = Object.fromEntries(tasks.map(task => [task, numericCell(scoreRecord, task, 'score', model)]))
    const taskCosts = Object.fromEntries(tasks.map(task => {
      const totalCostUsd = numericCell(costRecord, task, 'cost', model)
      const questionCount = numericCell(costRecord, `nq_${task}`, 'count', model)
      return [task, { totalCostUsd, questionCount, costPerQuestionUsd: totalCostUsd !== null && questionCount !== null ? totalCostUsd / questionCount : null }]
    }))
    const domains = Object.fromEntries(entries.map(([category, domainTasks]) => [category, summarizeScope(domainTasks, taskScores, taskCosts)]))
    const scope = summarizeScope(tasks, taskScores, taskCosts)
    const overallScorePct = scope.scoreComplete ? mean(Object.values(domains).map(domain => domain.scorePct)) : null
    const missingScores = tasks.filter(task => taskScores[task] === null)
    const missingCosts = tasks.filter(task => taskCosts[task].totalCostUsd === null)
    const missingCounts = tasks.filter(task => taskCosts[task].questionCount === null)
    const zeroCostTasks = tasks.filter(task => taskCosts[task].totalCostUsd === 0)
    const ineligibilityReasons = []
    if (!scoreRecord) ineligibilityReasons.push('missing-score-row')
    if (!costRecord) ineligibilityReasons.push('missing-cost-row')
    if (missingScores.length) ineligibilityReasons.push('incomplete-task-scores')
    if (missingCosts.length) ineligibilityReasons.push('incomplete-task-costs')
    if (missingCounts.length) ineligibilityReasons.push('incomplete-question-count-vector')
    return {
      model, taskScores, taskCosts, domains,
      coverage: { tasksExpected: tasks.length, scoredTasks: scope.scoredTasks, costedTasks: scope.costedTasks, countedTasks: scope.countedTasks, missingScores, missingCosts, missingCounts, zeroCostTasks },
      reportedAllTaskCostsZero: zeroCostTasks.length === tasks.length,
      overallScorePct, overallScoreDisplay: display(overallScorePct),
      totalCostUsd: scope.totalCostUsd, questionCount: scope.questionCount, costPerQuestionUsd: scope.costPerQuestionUsd,
      questionCountVector: missingCounts.length ? null : tasks.map(task => taskCosts[task].questionCount),
      completeStaticProfile: ineligibilityReasons.length === 0,
      commonCompleteEligible: false, ineligibilityReasons,
      pricedComparableEligible: false, pricedIneligibilityReasons: []
    }
  })
  const cohortMap = new Map()
  for (const row of rows) {
    if (row.questionCountVector === null) continue
    const key = JSON.stringify(row.questionCountVector)
    if (!cohortMap.has(key)) cohortMap.set(key, { key, questionCounts: row.questionCountVector, models: [] })
    cohortMap.get(key).models.push(row.model)
  }
  // Cohort choice uses counts only, not score or cost outcomes.
  const cohorts = [...cohortMap.values()].sort((a, b) => b.models.length - a.models.length || compareText(a.key, b.key))
  const referenceKey = cohorts[0]?.key ?? null
  for (const row of rows) {
    if (row.questionCountVector !== null && JSON.stringify(row.questionCountVector) !== referenceKey) row.ineligibilityReasons.push('different-question-count-vector')
    row.commonCompleteEligible = row.ineligibilityReasons.length === 0
    row.pricedIneligibilityReasons = [...row.ineligibilityReasons]
    if (row.totalCostUsd === 0) row.pricedIneligibilityReasons.push('zeroReportedCostNotVerifiedFree')
    else if (row.costPerQuestionUsd === 0) row.pricedIneligibilityReasons.push('nonPositiveComputedAverageCost')
    row.pricedComparableEligible = row.pricedIneligibilityReasons.length === 0 && row.costPerQuestionUsd > 0
  }
  const eligible = rows.filter(row => row.commonCompleteEligible)
  const pricedEligible = rows.filter(row => row.pricedComparableEligible)
  const frontier = pricedEligible.filter(row => !pricedEligible.some(other => {
    const costOrder = compareMetric(other.costPerQuestionUsd, row.costPerQuestionUsd, 0)
    const qualityOrder = compareMetric(other.overallScorePct, row.overallScorePct, 1)
    return costOrder <= 0 && qualityOrder >= 0 && (costOrder < 0 || qualityOrder > 0)
  })).sort((a, b) => a.costPerQuestionUsd - b.costPerQuestionUsd || b.overallScorePct - a.overallScorePct || compareText(a.model, b.model))
  return {
    schemaVersion: 1,
    evidenceLevel: 'model-by-task-aggregates-only',
    latestQuestionMatrixAvailable: false,
    sameQuestionIdentityEstablished: false,
    pairedInferenceAvailable: false,
    routingBenefitClaimSupported: false,
    categories: Object.fromEntries(entries.map(([category, domainTasks]) => [category, [...domainTasks]])),
    taskOrder: tasks,
    coverage: {
      models: rows.length, scoreRows: scores.models.size, costRows: costs.models.size,
      domains: entries.length, tasks: tasks.length,
      scoreOnlyModels: rows.filter(row => !costs.models.has(row.model)).length,
      costOnlyModels: rows.filter(row => !scores.models.has(row.model)).length,
      completeStaticProfiles: rows.filter(row => row.completeStaticProfile).length,
      incompleteProfiles: rows.filter(row => !row.completeStaticProfile).length,
      completeCountVectors: rows.filter(row => row.questionCountVector !== null).length,
      differentCountVectorModels: rows.filter(row => row.ineligibilityReasons.includes('different-question-count-vector')).length,
      modelsWithReportedZeroCostTasks: rows.filter(row => row.coverage.zeroCostTasks.length > 0).length,
      modelsWithAllTaskCostsReportedZero: rows.filter(row => row.reportedAllTaskCostsZero).length,
      commonCompleteEligibleModels: eligible.length,
      pricedComparableEligibleModels: pricedEligible.length,
      frontierModels: frontier.length
    },
    reportedZeroCosts: {
      modelsWithAnyZeroTaskCost: rows.filter(row => row.coverage.zeroCostTasks.length > 0).map(row => row.model),
      allTaskCostsReportedZeroModels: rows.filter(row => row.reportedAllTaskCostsZero).map(row => row.model),
      commonCompleteModelsExcludedFromPricedFrontier: eligible.filter(row => row.totalCostUsd === 0).map(row => row.model),
      interpretation: 'Published zero is preserved as data, not treated as missing or inferred to be verified free production access.'
    },
    commonCompleteCohort: {
      selection: 'modal complete question-count vector across all cost rows; lexicographic vector tie-break, independent of scores and costs',
      questionCounts: cohorts[0]?.questionCounts ?? null,
      questionIdentityEstablished: false,
      cohorts: cohorts.map(({ key, ...cohort }) => ({ ...cohort, reference: key === referenceKey }))
    },
    models: rows,
    frontierEligibility: 'pricedComparableEligible: complete task scores/costs/counts, reference full count vector, strictly positive reported aggregate cost',
    numericPolicy: {
      inputValidation: 'Exact decimal sign and bounds; positive integer counts at most Number.MAX_SAFE_INTEGER; nonzero Number underflow is rejected.',
      aggregation: 'Neumaier compensated sums and means; binary64 values are retained without display rounding.',
      frontierQualityTolerance: '32 * Number.EPSILON * max(1, abs(Qa), abs(Qb)); Q is on the 0..100 scale.',
      frontierCostTolerance: '32 * Number.EPSILON * max(abs(Ca), abs(Cb)); C is USD/question, with no absolute USD floor.',
      frontierTies: 'Differences within each metric tolerance are equal for dominance; strict improvement must exceed tolerance in at least one metric.',
      display: 'Two decimal quality formatting does not affect aggregation or frontier comparisons.'
    },
    descriptiveStaticFrontier: frontier.map(row => ({ model: row.model, overallScorePct: row.overallScorePct, overallScoreDisplay: row.overallScoreDisplay, costPerQuestionUsd: row.costPerQuestionUsd })),
    assumptions: [
      'Task scores are bounded aggregate scores on 0..100, not assumed to be binary correctness rates.',
      'Within each category, task scores receive equal weight; complete category means receive equal weight in overall quality.',
      'Incomplete categories retain a descriptive available-task mean, but any missing task score excludes the overall static profile.',
      'Costs are released task-total USD divided by released question counts; overall cost is sum of all task totals / sum of all task counts, not a mean of category costs.',
      'Provided zero USD is valid raw data but is excluded from the priced frontier; absent costs and counts remain null and never become free observations.',
      'Model IDs, including effort and thinking variants, are preserved exactly; Pareto comparisons use retained binary64 values with the disclosed tiny arithmetic tolerances and retain numerical ties.'
    ],
    limitations: [
      'Equal question-count vectors do not establish that models answered identical questions or used identical evaluation conditions.',
      'These aggregates cannot support question-paired confidence intervals, per-question routing simulation, or routing-benefit claims.',
      'Released costs are historical author-reported aggregates, not verified billing receipts; no current pricing or retokenized answer-string estimate is mixed in.',
      'An explicitly released zero USD aggregate is flagged but does not establish free, available, or reproducible production access.',
      'Model and task aggregates omit question identities, joint outcomes, failures, and collection-level provenance needed for a true same-question matrix.',
      'A descriptive priced static frontier compares only positive-cost profiles in the selected complete count cohort, not every model on the leaderboard.',
      'The source algorithm contains legacy model-specific score exceptions; this audit applies the declared general category-mean formula without such overrides.'
    ]
  }
}

function within(directory, target) {
  const relative = path.relative(directory, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function projectedRealPath(target) {
  try { return await realpath(target) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const parent = path.dirname(target)
    if (parent === target) throw error
    return path.join(await projectedRealPath(parent), path.basename(target))
  }
}

export async function runCli(args = process.argv.slice(2)) {
  const flags = new Map()
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1]
    if (!['--input-dir', '--output'].includes(flag) || !value || value.startsWith('--') || flags.has(flag)) throw new Error('Usage: node scripts/livebench-aggregate-audit.mjs --input-dir PATH --output FILE.json')
    flags.set(flag, value)
  }
  if (flags.size !== 2) throw new Error('Both --input-dir and --output are required')
  const requestedInputDir = path.resolve(flags.get('--input-dir'))
  const inputDir = await realpath(requestedInputDir)
  const output = path.resolve(flags.get('--output'))
  if (within(requestedInputDir, output) || within(inputDir, output) || within(inputDir, await projectedRealPath(output))) throw new Error('Refusing output inside input directory')
  const inputs = Object.fromEntries(await Promise.all(Object.entries(PINNED_LIVEBENCH_SOURCE.files).map(async ([kind, file]) => {
    const inputPath = path.join(inputDir, file.name)
    const actualPath = await realpath(inputPath)
    if (!within(inputDir, actualPath)) throw new Error(`Input file escapes input directory: ${file.name}`)
    const bytes = await readFile(actualPath)
    if (bytes.length > MAX_INPUT_BYTES) throw new Error(`Input too large: ${file.name}`)
    return [kind, { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), name: file.name, bytes: bytes.length, sha256: sha256(bytes) }]
  })))
  const audit = auditLiveBenchAggregates({ scoresCsv: inputs.scores.text, costsCsv: inputs.costs.text, categories: JSON.parse(inputs.categories.text) })
  const hashesMatch = Object.entries(inputs).every(([kind, input]) => input.sha256 === PINNED_LIVEBENCH_SOURCE.files[kind].sha256)
  audit.source = {
    release: hashesMatch ? PINNED_LIVEBENCH_SOURCE.release : null,
    revision: hashesMatch ? PINNED_LIVEBENCH_SOURCE.revision : null,
    verifiedPinnedOfficialInputHashes: hashesMatch,
    status: hashesMatch ? 'byte-identical-to-pinned-official-release' : 'local-inputs-not-verified-against-pinned-release',
    formulaReferences: { scores: PINNED_LIVEBENCH_SOURCE.scoreFormula, costs: PINNED_LIVEBENCH_SOURCE.costFormula },
    inputs: Object.fromEntries(Object.entries(inputs).map(([kind, { text, ...metadata }]) => [kind, metadata]))
  }
  await mkdir(path.dirname(output), { recursive: true })
  // A second check after directory creation also catches existing symlink parents.
  if (within(inputDir, await projectedRealPath(output))) throw new Error('Refusing output inside input directory')
  await writeFile(output, `${JSON.stringify(audit, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return audit
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().then(audit => console.log(JSON.stringify({ coverage: audit.coverage, evidenceLevel: audit.evidenceLevel, latestQuestionMatrixAvailable: audit.latestQuestionMatrixAvailable })))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
