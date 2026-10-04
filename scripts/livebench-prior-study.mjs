#!/usr/bin/env node
// Quality-only, in-sample description of published model/task aggregates.
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditLiveBenchAggregates, PINNED_LIVEBENCH_SOURCE } from './livebench-aggregate-audit.mjs'

const MAX_INPUT_BYTES = 16 * 1024 * 1024
const SOURCE_DIRECTORY = fileURLToPath(new URL('../', import.meta.url))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0

function compensatedMean(values) {
  if (!values.length) throw new Error('Cannot average an empty quality vector')
  let sum = 0, correction = 0
  for (const value of values) {
    const next = sum + value
    correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum
    sum = next
  }
  return (sum + correction) / values.length
}
function maximum(profiles, scoreFor) {
  const value = profiles.reduce((largest, profile) => Math.max(largest, scoreFor(profile)), -Infinity)
  const tiedModels = profiles.filter(profile => scoreFor(profile) === value).map(profile => profile.model).sort(compareText)
  return { model: tiedModels[0], scorePct: value, tiedModels }
}

/** No prices enter these calculations. Cohort membership is the shared audit's exact predicate. */
export function buildLiveBenchPriorStudy({ scoresCsv, costsCsv, categories }) {
  const audit = auditLiveBenchAggregates({ scoresCsv, costsCsv, categories })
  const domains = Object.keys(audit.categories)
  const eligible = audit.models.filter(model => model.commonCompleteEligible)
  if (!eligible.length) throw new Error('No commonCompleteEligible quality profiles; maxima are unavailable')
  const profiles = eligible.map(row => {
    const domainScoresPct = Object.fromEntries(domains.map(domain => [domain,
      compensatedMean(audit.categories[domain].map(task => row.taskScores[task]))]))
    return { model: row.model,
      taskScoresPct: Object.fromEntries(audit.taskOrder.map(task => [task, row.taskScores[task]])),
      domainScoresPct,
      equalDomainMeanScorePct: compensatedMean(domains.map(domain => domainScoresPct[domain])),
      questionCountVector: [...row.questionCountVector] }
  }).sort((left, right) => compareText(left.model, right.model))
  const best = maximum(profiles, profile => profile.equalDomainMeanScorePct)
  const bestProfile = profiles.find(profile => profile.model === best.model)
  const byDomain = domains.map(domain => {
    const upper = maximum(profiles, profile => profile.domainScoresPct[domain])
    const baseline = bestProfile.domainScoresPct[domain]
    return { domain, taskCount: audit.categories[domain].length, domainWeight: 1 / domains.length,
      bestSingleModel: best.model, bestSingleScorePct: baseline,
      domainMaximumModel: upper.model, domainMaximumScorePct: upper.scorePct,
      domainMaximumTiedModels: upper.tiedModels,
      differencePercentagePoints: upper.scorePct - baseline }
  })
  const envelope = compensatedMean(byDomain.map(domain => domain.domainMaximumScorePct))
  return {
    schemaVersion: 1,
    experimentScope: 'in-sample-descriptive-aggregate-domain-adaptation-quality-only',
    evidenceLevel: 'model-by-task-aggregate-scores-not-question-outcomes',
    independentTest: false, sameQuestionIdentityEstablished: false,
    queryAdaptiveRoutingEvaluated: false, deployedLearnedClassifierEvaluated: false,
    costsUsedInSelectionOrResults: false, qualityCostBenefitClaimSupported: false,
    significanceInferenceAvailable: false, pairedInferenceAvailable: false,
    protocol: {
      eligibility: 'Exactly commonCompleteEligible from auditLiveBenchAggregates, not pricedComparableEligible; released zero costs do not exclude a quality profile.',
      cohortSelection: audit.commonCompleteCohort.selection,
      countVectorInterpretation: 'Matching complete count vectors do not prove identical question IDs, conditions, or generation settings.',
      domainWeightPolicy: 'Equal domains, fixed before comparison; within each domain, equal task scores, not question-count weighting.',
      formulas: {
        domainScore: 'q[m,d] = sum(scorePct[m,t] for t in T[d]) / (100 * |T[d]|)',
        bestSingle: 'B = max_m (sum_d q[m,d] / D)',
        empiricalUpperEnvelope: 'E = sum_d max_m q[m,d] / D',
        differencePercentagePoints: '100 * (E - B); calculations retain the equivalent 0..100 score scale',
      },
      scoreInterpretation: 'q is a normalized bounded aggregate benchmark score, not a probability of a correct answer.',
      numericPolicy: {
        aggregation: 'Neumaier compensated means of retained binary64 values; no display rounding before selection.',
        maximum: 'Strict numerical maximum of unrounded retained binary64 scores.',
        tieTolerance: 0,
        tieBreak: 'Exact numerical equality only, then lexicographically smallest exact model ID using ECMAScript UTF-16 code-unit order (<); no locale comparison or ID normalization.',
        identity: 'Model versions, effort and thinking variants remain separate exact strings.',
      },
      domainWeights: Object.fromEntries(domains.map(domain => [domain, 1 / domains.length])),
      withinDomainTaskWeights: Object.fromEntries(domains.map(domain => [domain,
        Object.fromEntries(audit.categories[domain].map(task => [task, 1 / audit.categories[domain].length]))])),
    },
    coverage: { modelsInAudit: audit.models.length, commonCompleteEligibleModels: profiles.length,
      excludedModels: audit.models.filter(row => !row.commonCompleteEligible).map(row => ({ model: row.model, reasons: [...row.ineligibilityReasons] })),
      domains: domains.length, tasks: audit.taskOrder.length },
    categories: structuredClone(audit.categories), taskOrder: [...audit.taskOrder],
    referenceQuestionCountVector: [...audit.commonCompleteCohort.questionCounts],
    bestSingle: { model: best.model, tiedModels: best.tiedModels, equalDomainMeanScorePct: best.scorePct,
      normalizedAggregateScore: best.scorePct / 100 },
    domainWiseEmpiricalUpperEnvelope: { equalDomainMeanScorePct: envelope, normalizedAggregateScore: envelope / 100,
      selectedModelsByDomain: Object.fromEntries(byDomain.map(domain => [domain.domain, domain.domainMaximumModel])),
      distinctSelectedModels: [...new Set(byDomain.map(domain => domain.domainMaximumModel))].sort(compareText) },
    differencePercentagePoints: envelope - best.scorePct,
    byDomain, qualityProfiles: profiles,
    limitations: [
      'Both maximizers are selected and evaluated on these same published aggregates. This is in-sample descriptive adaptation, not an independent test or an estimate of generalization benefit.',
      'The domain-wise empirical upper envelope uses known domain labels and hindsight domain maxima. It is not a deployed learned classifier, question-adaptive router, or a universal upper bound on all possible routing policies.',
      'Equal complete question-count vectors do not establish same-question identities or comparable collection conditions. No question rows, correctness probabilities, confidence intervals, significance tests, bootstrap, or paired inference are fabricated.',
      'The shared audit parses author cost fields for its completeness/count-cohort predicate. Their amounts are not used in quality means, weights, maxima or reported results; no pricing query, official usage-cost calculation, or cost-saving claim is made.',
      'Exact model IDs preserve model versions and effort/thinking variants; combining them would alter the fixed descriptive candidate pool.',
      'The calculation applies the general equal-task-within-domain and equal-domain formula, not legacy model-specific website score exceptions.',
    ],
  }
}

function within(directory, target) {
  const relative = path.relative(directory, target)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}
async function projectedRealPath(target) {
  try { return await realpath(target) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const parent = path.dirname(target)
    if (parent === target) throw error
    return path.join(await projectedRealPath(parent), path.basename(target))
  }
}

export async function loadLiveBenchPriorStudy(inputDirectory) {
  const inputDir = await realpath(path.resolve(inputDirectory))
  const inputs = Object.fromEntries(await Promise.all(Object.entries(PINNED_LIVEBENCH_SOURCE.files).map(async ([kind, file]) => {
    const actualPath = await realpath(path.join(inputDir, file.name))
    if (!within(inputDir, actualPath)) throw new Error(`Input file escapes input directory: ${file.name}`)
    const bytes = await readFile(actualPath)
    if (bytes.length > MAX_INPUT_BYTES) throw new Error(`Input too large: ${file.name}`)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return [kind, { text, name: file.name, bytes: bytes.length, sha256: sha256(bytes) }]
  })))
  const result = buildLiveBenchPriorStudy({ scoresCsv: inputs.scores.text, costsCsv: inputs.costs.text,
    categories: JSON.parse(inputs.categories.text.replace(/^\uFEFF/, '')) })
  const hashesMatch = Object.entries(inputs).every(([kind, input]) => input.sha256 === PINNED_LIVEBENCH_SOURCE.files[kind].sha256)
  result.source = { release: hashesMatch ? PINNED_LIVEBENCH_SOURCE.release : null,
    revision: hashesMatch ? PINNED_LIVEBENCH_SOURCE.revision : null,
    verifiedPinnedOfficialInputHashes: hashesMatch,
    scoreFormulaReference: PINNED_LIVEBENCH_SOURCE.scoreFormula,
    inputs: Object.fromEntries(Object.entries(inputs).map(([kind, { text, ...metadata }]) => [kind, {
      ...metadata,
      role: kind === 'costs' ? 'Shared audit completeness and complete question-count cohort only; released monetary amounts are not analyzed.'
        : kind === 'scores' ? 'Published model-by-task aggregate scores.' : 'Fixed domain/task membership and weights.',
      pinnedSourceUrl: hashesMatch ? `https://raw.githubusercontent.com/LiveBench/new-livebench/${PINNED_LIVEBENCH_SOURCE.revision}/public/${metadata.name}` : null,
    }])) }
  const scripts = await Promise.all(['scripts/livebench-prior-study.mjs', 'scripts/livebench-aggregate-audit.mjs'].map(async file => {
    const bytes = await readFile(path.join(SOURCE_DIRECTORY, file))
    return { path: file, bytes: bytes.length, sha256: sha256(bytes) }
  }))
  result.implementation = { algorithm: 'SHA-256', scripts,
    sha256: sha256(scripts.map(script => `${script.path}\0${script.sha256}\n`).join('')) }
  return result
}

const HELP = `Usage: node scripts/livebench-prior-study.mjs --input-dir PATH --output-dir NEW_DIRECTORY

Read table/cost/categories snapshot files locally, select commonCompleteEligible
profiles, and describe equal-domain best-single and domain-wise empirical upper
envelope quality. Cost amounts do not enter selection or results. No network,
model calls, credentials, question-level simulation, bootstrap, or xlsx output.
Write NEW_DIRECTORY/aggregate-prior-study.json; refuse existing directories and
any output within the input tree (including resolved symlink paths).
The output parent must exist. Results are in-sample descriptions, not deployed
query-adaptive routing, independent test evidence, or quality-cost benefits.
`
export async function runPriorStudyCli(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(HELP); return null }
  const flags = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1]
    if (!['--input-dir', '--output-dir'].includes(key) || !value || value.startsWith('--') || flags.has(key)) throw new Error('Required --input-dir PATH --output-dir NEW_DIRECTORY; use --help')
    flags.set(key, value)
  }
  if (flags.size !== 2) throw new Error('Required --input-dir PATH --output-dir NEW_DIRECTORY; use --help')
  const requestedInputDir = path.resolve(flags.get('--input-dir'))
  const inputDir = await realpath(requestedInputDir)
  const outputDir = path.resolve(flags.get('--output-dir'))
  if (within(requestedInputDir, outputDir) || within(inputDir, outputDir) || within(inputDir, await projectedRealPath(outputDir))) throw new Error('Refusing output inside input directory')
  // All parsing, audit and source hashing completes before creating output.
  const report = await loadLiveBenchPriorStudy(inputDir)
  await mkdir(outputDir)
  if (within(inputDir, await realpath(outputDir))) throw new Error('Refusing output inside input directory')
  await writeFile(path.join(outputDir, 'aggregate-prior-study.json'), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return report
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPriorStudyCli().then(report => {
    if (report) console.log(JSON.stringify({ coverage: report.coverage, bestSingle: report.bestSingle,
      domainWiseEmpiricalUpperEnvelope: report.domainWiseEmpiricalUpperEnvelope,
      differencePercentagePoints: report.differencePercentagePoints }))
  }).catch(error => { console.error(error.message); process.exitCode = 1 })
}
