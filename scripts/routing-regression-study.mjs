#!/usr/bin/env node
/** Reproduce seven fixed synthetic counterexamples against local 0.15.0 source. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildPlan } from '../.dsh-plugin/shared/router.mjs'
import { normalizeLiveBenchPayload } from '../.dsh-plugin/shared/livebench.mjs'

const BASELINE_VERSION = '0.15.0'
const SOURCE_DIRECTORY = fileURLToPath(new URL('../', import.meta.url))
const ROUTER_PATH = '.dsh-plugin/shared/router.mjs'
const NORMALIZER_PATH = '.dsh-plugin/shared/livebench.mjs'
const stableTextOrder = (left, right) => left < right ? -1 : left > right ? 1 : 0

/** Inputs are fixed and shared by both versions; no model is invoked. */
export function createRegressionCases() {
  const architecture = '\u8bf7\u8bbe\u8ba1\u4e00\u4e2a\u590d\u6742\u5de5\u7a0b\u67b6\u6784\u5e76\u5b9e\u73b0\u4ee3\u7801'
  const simple = '\u8bf7\u7b80\u8981\u89e3\u91ca\u7f13\u5b58'
  const crowded = [
    ...Array.from({ length: 12 }, (_, index) => ({ provider: 'p', model: `High-${index}`,
      quality: 0.98 + index * 0.001, latency: 0.01 + index * 0.001, risk: 0,
      specialties: ['code', 'reasoning'], pricing: { input: 1, output: 1 } })),
    { provider: 'p', model: 'Cheap', quality: 0.85, latency: 1, risk: 1,
      specialties: [], pricing: { input: 0.01, output: 0.01 } },
  ]
  const handoff = { text: architecture, available: [
    { provider: 'p', model: 'A', quality: 0.9, latency: 0.5, risk: 0.2,
      pricing: { input: 0.999, output: 0.999 }, specialties: ['reasoning', 'code'] },
    { provider: 'p', model: 'B', quality: 0.9, latency: 0.5, risk: 0.2,
      pricing: { input: 1, output: 1 }, specialties: ['reasoning', 'code'] },
  ], liveBench: { source: 'synthetic-fixture', models: {
    a: { scores: { reasoning: 0.77, code: 0.9001 }, overall: 0.9 },
    b: { scores: { reasoning: 0.9, code: 0.9 }, overall: 0.9 },
  } } }
  const evidence = { text: architecture,
    available: [{ provider: 'p', model: 'm', pricing: { input: 1, output: 1 } }],
    liveBench: { models: { m: { scores: { code: 0.9 } } } },
  }
  return [
    { name: 'budget-candidate-retention', input: { text: architecture, available: crowded, budgetUsd: 0.001 } },
    { name: 'dependency-handoff', input: handoff },
    { name: 'irrelevant-price-outlier', input: { text: simple, available: [
      { provider: 'p', model: 'Cheap', quality: 0.8, latency: 0.5, risk: 0.2, pricing: { input: 0.1, output: 0.2 } },
      { provider: 'p', model: 'Expensive', quality: 0.9, latency: 0.5, risk: 0.2, pricing: { input: 1, output: 2 } },
      { provider: 'p', model: 'Dominated', quality: 0.75, latency: 1, risk: 1, pricing: { input: 10000, output: 10000 } },
    ] } },
    { name: 'task-specific-quality-evidence', input: structuredClone(evidence) },
    { name: 'normalized-category-evidence', input: { ...structuredClone(evidence),
      liveBench: normalizeLiveBenchPayload({ models: [{ model: 'm', code: 90 }] }, 1) } },
    { name: 'image-ineligible-baseline', input: { text: '\u8bf7\u5206\u6790\u56fe\u7247\u4e2d\u7684\u5185\u5bb9', available: [
      { provider: 'p', model: 'Text Only', quality: 0.99, inputModalities: ['text'], pricing: { input: 100, output: 100 } },
      { provider: 'p', model: 'Vision', quality: 0.9, inputModalities: ['text', 'image'], pricing: { input: 1, output: 1 } },
    ] } },
    { name: 'budget-rounding-boundary', input: { text: simple, budgetUsd: 0.0009967,
      available: [{ provider: 'p', model: 'm', quality: 0.9, pricing: { input: 1.0006, output: 1.0006 } }] } },
  ]
}

function planSummary(plan) {
  return { assignments: plan.subtasks.map(item => item.recommended), estimatedCost: plan.estimatedCost,
    budgetFeasible: plan.optimization.budgetFeasible, budgetExceeded: plan.optimization.budgetExceeded,
    handoffs: plan.optimization.handoffCount, baselineAllStrongCost: plan.optimization.baselineAllStrongCost,
    estimatedSavings: plan.optimization.estimatedSavings, qualityEvidenceComplete: plan.optimization.qualityEvidenceComplete,
    qualitySources: plan.subtasks.map(item => item.qualitySource), search: plan.optimization.search ?? null }
}

function assertWithinSource(root, absolutePath) {
  const path = relative(root, absolutePath)
  if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) {
    throw new RangeError('A local module dependency escapes the explicitly supplied source directory')
  }
  return path.split(sep).join('/')
}

/** Hash package.json and reachable relative imports, preserving actual file bytes. */
async function sourceManifest(directory, entryPaths) {
  const root = resolve(directory)
  const pending = entryPaths.map(path => resolve(root, path))
  const files = new Map()
  const packagePath = resolve(root, 'package.json')
  const packageBytes = await readFile(packagePath)
  files.set('package.json', { path: 'package.json', bytes: packageBytes.length,
    sha256: createHash('sha256').update(packageBytes).digest('hex') })
  while (pending.length) {
    const absolutePath = pending.pop()
    const path = assertWithinSource(root, absolutePath)
    if (files.has(path)) continue
    const bytes = await readFile(absolutePath)
    files.set(path, { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
    const source = bytes.toString('utf8')
    const staticImports = /\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"](\.{1,2}\/[^'"]+)['"]/g
    const literalDynamicImports = /\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g
    for (const pattern of [staticImports, literalDynamicImports]) {
      for (const match of source.matchAll(pattern)) {
        const dependency = fileURLToPath(new URL(match[1], pathToFileURL(absolutePath)))
        assertWithinSource(root, dependency)
        pending.push(dependency)
      }
    }
  }
  const ordered = [...files.values()].sort((left, right) => stableTextOrder(left.path, right.path))
  const sha256 = createHash('sha256').update(ordered.map(file => `${file.path}\0${file.sha256}\n`).join('')).digest('hex')
  return { algorithm: 'SHA-256', sha256, files: ordered,
    scope: 'package.json plus reachable local static or literal-dynamic module imports; bare imports and computed imports are not fingerprinted' }
}

/** Baseline version validation completes before executing any baseline module. */
export async function runRoutingRegressionStudy({ baselineDirectory } = {}) {
  if (typeof baselineDirectory !== 'string' || !baselineDirectory.trim()) {
    throw new TypeError('Required baselineDirectory: explicitly provide a local 0.15.0 source checkout')
  }
  const baselineRoot = resolve(baselineDirectory)
  const baselinePackage = JSON.parse((await readFile(join(baselineRoot, 'package.json'), 'utf8')).replace(/^\uFEFF/, ''))
  if (baselinePackage.version !== BASELINE_VERSION) {
    throw new RangeError(`Baseline must declare version ${BASELINE_VERSION}; received ${String(baselinePackage.version)}`)
  }
  const sourcePackage = JSON.parse((await readFile(join(SOURCE_DIRECTORY, 'package.json'), 'utf8')).replace(/^\uFEFF/, ''))
  if (typeof sourcePackage.version !== 'string' || !sourcePackage.version.length) throw new TypeError('Current source package.json has no version')
  const manifests = await Promise.all([
    sourceManifest(baselineRoot, [ROUTER_PATH]),
    sourceManifest(SOURCE_DIRECTORY, [ROUTER_PATH, NORMALIZER_PATH]),
  ])
  const baselineURL = pathToFileURL(join(baselineRoot, ROUTER_PATH))
  const baselineModule = await import(baselineURL.href)
  if (typeof baselineModule.buildPlan !== 'function') throw new TypeError('Baseline router module must export buildPlan')
  const cases = createRegressionCases().map(({ name, input }) => {
    const originalOutput = baselineModule.buildPlan(structuredClone(input))
    const updatedOutput = buildPlan(structuredClone(input))
    return { name, input, original: planSummary(originalOutput), updated: planSummary(updatedOutput), originalOutput, updatedOutput }
  })
  return {
    schemaVersion: 1, kind: 'deterministic-regressions-not-answer-quality-benchmark', provenance: 'synthetic',
    claimScope: 'seven-fixed-synthetic-counterexamples-only', data: 'synthetic fixed counterexamples',
    baselineVersion: baselinePackage.version, sourceVersion: sourcePackage.version,
    sourceSHA256: { baseline: manifests[0].sha256, current: manifests[1].sha256 },
    sourceManifests: { baseline: manifests[0], current: manifests[1] },
    limitations: [
      'These seven deliberately selected synthetic counterexamples measure routing mechanism behavior, not answer correctness, model quality, accuracy gains, or typical workload frequency.',
      'Both versions receive identical complete saved inputs; estimated costs and quality values are supplied fixtures or router estimates, not measured model executions.',
      'The normalized-category-evidence input is prepared once using the current normalizer and then passed to both routers; this controls a fixed normalized input rather than comparing two normalization pipelines.',
      'Declared package versions do not attest to published release integrity; SHA-256 manifests identify the local source bytes, including uncommitted edits, within the stated manifest scope.',
      'Run each comparison in a fresh CLI process when editing either source tree, because JavaScript module imports may be cached in a long-lived importing process.',
      'Full outputs retain the routers\' live generatedAt timestamps; compare mechanism results with only these timestamp fields excluded, rather than claiming byte-identical full output across runs.',
    ],
    cases,
  }
}

const HELP = `Usage: node scripts/routing-regression-study.mjs --baseline DIR --output DIR

Compare seven fixed synthetic counterexamples using a local source checkout
whose package.json declares version 0.15.0 and the current source tree. The
baseline is imported by file URL only after checking its version. Local code in
the explicitly supplied baseline is executed; provide the intended source tree.

Write routing-regressions.json with complete inputs, old/new outputs, concise
decision summaries, versions, and SHA-256 source manifests. No model calls,
network, fees, account credentials, publishing, or system-directory discovery.
Node >=22. These are mechanism regressions, not answer-quality measurements.

Options:
  --baseline DIR  Required local 0.15.0 source directory
  --output DIR    Required destination directory
  -h, --help      Show this help
`

async function main(args) {
  if (args.length === 1 && ['-h', '--help'].includes(args[0])) {
    process.stdout.write(HELP)
    return
  }
  const options = {}
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (!['--baseline', '--output'].includes(flag)) throw new Error(`Unknown option ${flag}; use --help`)
    const value = args[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}; use --help`)
    if (Object.hasOwn(options, flag)) throw new Error(`Duplicate option ${flag}; use --help`)
    options[flag] = resolve(value)
  }
  if (!options['--baseline'] || !options['--output']) throw new Error('Required --baseline DIR and --output DIR; use --help')
  const report = await runRoutingRegressionStudy({ baselineDirectory: options['--baseline'] })
  await mkdir(options['--output'], { recursive: true })
  const outputPath = join(options['--output'], 'routing-regressions.json')
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`Saved ${report.cases.length} synthetic regression cases: ${report.baselineVersion} -> ${report.sourceVersion}.\n`)
  process.stdout.write(`Baseline source SHA256: ${report.sourceSHA256.baseline}\nCurrent source SHA256: ${report.sourceSHA256.current}\n`)
  process.stdout.write(`JSON: ${outputPath}\n`)
  process.stdout.write(`Reproduce: node scripts/routing-regression-study.mjs --baseline "${options['--baseline']}" --output "${options['--output']}"\n`)
  process.stdout.write('Fixed counterexamples describe routing mechanisms; they do not measure answer quality.\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`Routing regression study failed: ${error.message}\n`)
    process.exitCode = 1
  })
}
