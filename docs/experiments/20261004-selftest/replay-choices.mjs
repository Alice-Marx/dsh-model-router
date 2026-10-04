#!/usr/bin/env node
// Pure local planner replay. This is not a provider/model execution adapter.
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SOURCE_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const ROUTER_PATH = '.dsh-plugin/shared/router.mjs'
export const EXPERIMENT_SCOPE = 'first-stage-fixed-generation-model-choice-projection'
const PLANNER_FIELDS = ['available', 'mode', 'preset', 'pricing', 'liveBench', 'budgetUsd', 'cacheReadRatio', 'cacheWriteRatio']
const ROUTE_FIELDS = ['provider', 'model', 'reasoningEfforts', 'defaultReasoningEffort', 'reasoningKnown',
  'quality', 'qualityBias', 'qualitySource', 'latency', 'risk', 'specialties', 'pricing', 'price', 'pricingSource', 'inputModalities']

function fail(path, message) { throw new TypeError(`${path}: ${message}`) }
function record(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, 'must be a plain object')
}
function fields(value, allowed, required, path) {
  record(value, path)
  for (const name of Object.keys(value)) if (!allowed.includes(name)) fail(`${path}.${name}`, 'unexpected field')
  for (const name of required) if (!Object.hasOwn(value, name)) fail(`${path}.${name}`, 'required field is missing')
}
function text(value, path) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) fail(path, 'must be a non-empty string without surrounding whitespace')
}
function number(value, path, minimum = 0, maximum = Number.MAX_VALUE) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(path, `must be a finite number between ${minimum} and ${maximum}`)
  }
}
function textArray(value, path) {
  if (!Array.isArray(value)) fail(path, 'must be an array of unique strings')
  const seen = new Set()
  for (const [index, item] of value.entries()) {
    text(item, `${path}[${index}]`)
    if (seen.has(item)) fail(path, 'duplicate values are prohibited')
    seen.add(item)
  }
}
function price(value, path) {
  fields(value, ['input', 'output', 'cacheRead', 'cacheWrite', 'currency'], ['input', 'output'], path)
  for (const name of ['input', 'output', 'cacheRead', 'cacheWrite']) {
    if (Object.hasOwn(value, name)) number(value[name], `${path}.${name}`)
  }
  if (Object.hasOwn(value, 'currency') && value.currency !== 'USD') fail(`${path}.currency`, 'must be USD; convert explicitly before replay')
}

export function validateReplayInput(input) {
  fields(input, ['schemaVersion', 'protocolId', 'queries', 'plannerInput'], ['schemaVersion', 'protocolId', 'queries', 'plannerInput'], 'input')
  if (input.schemaVersion !== 1) fail('input.schemaVersion', 'must equal 1')
  text(input.protocolId, 'input.protocolId')
  if (!Array.isArray(input.queries) || input.queries.length === 0) fail('input.queries', 'must be a non-empty array')
  const ids = new Set()
  const groups = new Map()
  for (const [index, query] of input.queries.entries()) {
    const path = `input.queries[${index}]`
    fields(query, ['id', 'groupId', 'domain', 'text'], ['id', 'groupId', 'domain', 'text'], path)
    for (const name of ['id', 'groupId', 'domain']) text(query[name], `${path}.${name}`)
    if (typeof query.text !== 'string' || !query.text.trim()) fail(`${path}.text`, 'must be non-empty query text; original whitespace is preserved')
    if (ids.has(query.id)) fail(`${path}.id`, 'duplicate IDs are prohibited')
    ids.add(query.id)
    if (groups.has(query.groupId) && groups.get(query.groupId) !== query.domain) fail(`${path}.groupId`, 'a group cannot span domains')
    groups.set(query.groupId, query.domain)
  }
  const planner = input.plannerInput
  fields(planner, PLANNER_FIELDS, PLANNER_FIELDS, 'input.plannerInput')
  if (!['collective', 'single', 'team'].includes(planner.mode)) fail('input.plannerInput.mode', 'must be collective, single, or team; mode does not guarantee a single node')
  if (!['economy', 'balanced', 'quality'].includes(planner.preset)) fail('input.plannerInput.preset', 'must be economy, balanced, or quality')
  if (planner.liveBench !== null) fail('input.plannerInput.liveBench', 'must be null; do not inject test outcomes into planner evidence')
  number(planner.budgetUsd, 'input.plannerInput.budgetUsd')
  number(planner.cacheReadRatio, 'input.plannerInput.cacheReadRatio', 0, 1)
  number(planner.cacheWriteRatio, 'input.plannerInput.cacheWriteRatio', 0, 1)
  if (planner.cacheReadRatio + planner.cacheWriteRatio > 1) fail('input.plannerInput', 'cacheReadRatio + cacheWriteRatio must not exceed 1')
  record(planner.pricing, 'input.plannerInput.pricing')
  for (const [id, value] of Object.entries(planner.pricing)) {
    text(id, 'input.plannerInput.pricing key')
    price(value, `input.plannerInput.pricing[${JSON.stringify(id)}]`)
  }
  if (!Array.isArray(planner.available) || planner.available.length === 0) fail('input.plannerInput.available', 'must be a non-empty model pool')
  const routes = new Set()
  for (const [index, route] of planner.available.entries()) {
    const path = `input.plannerInput.available[${index}]`
    fields(route, ROUTE_FIELDS, ['provider', 'model'], path)
    text(route.provider, `${path}.provider`)
    text(route.model, `${path}.model`)
    const key = `${route.provider}/${route.model}`
    if (routes.has(key)) fail(path, 'duplicate provider/model route IDs are prohibited, including different effort variants')
    routes.add(key)
    for (const name of ['quality', 'latency', 'risk']) if (Object.hasOwn(route, name)) number(route[name], `${path}.${name}`, 0, 1)
    if (Object.hasOwn(route, 'qualityBias')) number(route.qualityBias, `${path}.qualityBias`, -0.05, 0.05)
    if (Object.hasOwn(route, 'reasoningKnown') && typeof route.reasoningKnown !== 'boolean') fail(`${path}.reasoningKnown`, 'must be boolean')
    for (const name of ['reasoningEfforts', 'specialties', 'inputModalities']) if (Object.hasOwn(route, name)) textArray(route[name], `${path}.${name}`)
    if (Object.hasOwn(route, 'defaultReasoningEffort')) {
      text(route.defaultReasoningEffort, `${path}.defaultReasoningEffort`)
      if (!route.reasoningEfforts?.includes(route.defaultReasoningEffort)) fail(`${path}.defaultReasoningEffort`, 'must occur in reasoningEfforts')
    }
    for (const name of ['qualitySource', 'pricingSource']) if (Object.hasOwn(route, name)) text(route[name], `${path}.${name}`)
    if (Object.hasOwn(route, 'pricing') && Object.hasOwn(route, 'price')) fail(path, 'provide pricing or price, not both')
    for (const name of ['pricing', 'price']) if (Object.hasOwn(route, name) && route[name] !== null) price(route[name], `${path}.${name}`)
  }
  return input
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
async function sourceManifest(root) {
  const files = []
  async function add(path) {
    const bytes = await readFile(join(root, path))
    files.push({ path: path.replaceAll('\\', '/'), bytes: bytes.length, sha256: sha256(bytes) })
  }
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && entry.name.endsWith('.mjs')) await add(relative(root, path))
    }
  }
  const packageBytes = await readFile(join(root, 'package.json'))
  const metadata = JSON.parse(packageBytes.toString('utf8').replace(/^\uFEFF/, ''))
  text(metadata.version, `${root}/package.json.version`)
  files.push({ path: 'package.json', bytes: packageBytes.length, sha256: sha256(packageBytes) })
  await walk(join(root, '.dsh-plugin', 'shared'))
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  return { version: metadata.version, algorithm: 'SHA-256',
    sha256: sha256(files.map(file => `${file.path}\0${file.sha256}\n`).join('')), files,
    scope: 'package.json and regular .mjs files recursively under .dsh-plugin/shared; symlinks and dependencies elsewhere are not fingerprinted' }
}
function project(plan) {
  if (!plan || !Array.isArray(plan.subtasks)) fail('buildPlan output', 'must contain a subtasks array')
  return { selected: plan.selected === null || plan.selected === undefined ? null
    : { provider: plan.selected.provider, model: plan.selected.model },
  nodeCount: plan.subtasks.length,
  executionNodeCount: plan.subtasks.filter(node => node.purpose === 'execution').length,
  plan }
}

export async function replayChoices(input, baselineDirectory, inputSha256 = sha256(JSON.stringify(input))) {
  validateReplayInput(input)
  text(baselineDirectory, 'baselineDirectory')
  const baselineRoot = resolve(baselineDirectory)
  const [baselineManifest, currentManifest] = await Promise.all([sourceManifest(baselineRoot), sourceManifest(SOURCE_ROOT)])
  const [baseline, current] = await Promise.all([
    import(pathToFileURL(join(baselineRoot, ROUTER_PATH)).href),
    import(pathToFileURL(join(SOURCE_ROOT, ROUTER_PATH)).href),
  ])
  if (typeof baseline.buildPlan !== 'function' || typeof current.buildPlan !== 'function') fail('router module', 'both local modules must export buildPlan')
  const queries = input.queries.map(query => {
    const frozenInput = { ...input.plannerInput, text: query.text }
    return { ...query,
      baseline: project(baseline.buildPlan(structuredClone(frozenInput))),
      current: project(current.buildPlan(structuredClone(frozenInput))) }
  })
  return { schemaVersion: 1, protocolId: input.protocolId, experimentScope: EXPERIMENT_SCOPE,
    inputSha256, replayInput: structuredClone(input),
    sourceVersions: { baseline: baselineManifest.version, current: currentManifest.version },
    sourceManifests: { baseline: baselineManifest, current: currentManifest }, queries,
    limitations: [
      'This projects plan.selected provider/model onto separately collected original-question outcomes at fixed generation settings. It does not execute models or validate effort, output caps, DAG prompts, dependency handoffs, retries, synthesis, or final production quality.',
      'plan.selected is the first work package, possibly analysis. Neither mode nor executionNodeCount guarantees a single-node plan; nodeCount records all packages.',
      'Planner estimated costs are not measured, invoiced, or replayed deployment costs. Query text and planner metadata are caller-supplied; this tool does not certify absence of test-label leakage in their content.',
      'The supplied baseline directory is trusted executable local source. Versions and byte hashes do not authenticate the intended old release; passing the current directory is only an interface smoke test.',
      'Run a fresh CLI process against frozen source trees. Full plans retain dynamic generatedAt timestamps; exclude only those fields when comparing deterministic decisions.',
    ] }
}

const HELP = `Usage: node docs/experiments/20261004-selftest/replay-choices.mjs <replay-input.json> <baseline-dir>

Offline local buildPlan replay; JSON output goes only to stdout. No model calls,
network requests, credential reads, or output-file writes are implemented.
Use only trusted frozen local source: importing a supplied module executes it.
Input: {schemaVersion:1, protocolId, queries:[{id,groupId,domain,text}],
 plannerInput:{available,mode,preset,pricing,liveBench:null,budgetUsd,
 cacheReadRatio,cacheWriteRatio}}. All listed fields are required.
Queries allow exactly those four fields, never labels/results/outcomes/cost.
Routes require unique exact provider/model IDs; optional score metadata is [0,1]
and prices use input/output/cacheRead/cacheWrite in non-negative USD per million
tokens. Optional effort arrays contain exact unique string IDs.
Scope: ${EXPERIMENT_SCOPE}; not effort or DAG validation.
`

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    if (args.length === 1 && args[0] === '--help') process.stdout.write(HELP)
    else {
      if (args.length !== 2 || args.some(arg => arg.startsWith('--'))) throw new TypeError('Required <replay-input.json> <baseline-dir>; use --help')
      const bytes = await readFile(args[0])
      const input = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
      const output = await replayChoices(input, args[1], sha256(bytes))
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
