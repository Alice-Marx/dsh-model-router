import { lstat, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateFunctionalSnapshot } from './integration-upstream-proposal.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TASK_STATES = new Set(['planned', 'in_progress', 'blocked', 'completed'])
const RESULT_STATES = new Set(['not_run', 'partial', 'passed', 'failed', 'blocked'])
const COUNTS = { requirements: 32, features: 40, acceptance: 63 }
const FULL_SHA = /^[0-9a-f]{40}$/
const HASH = /^[0-9a-f]{64}$/
const RISK_AREAS = ['config', 'data', 'cli', 'native', 'platform']
const INCREMENT_INPUTS = ['baseline.json', 'feature-inventory.json', 'scope.json', 'tasks.json']
  .map(file => `docs/integration/${file}`).sort()
const portable = path => typeof path === 'string' && path && !path.includes('\\') && !path.includes(':')
  && !isAbsolute(path) && !path.split('/').some(part => !part || part === '.' || part === '..')
// Approved frozen genesis. MR is the approved master-plan genesis; DS is read from the
// current baseline lock and master plan §2.1 (de55888a...). Every ledger must continue from
// exactly these two commits; this pins the named genesis instead of only shape-checking it.
const APPROVED_GENESIS = Object.freeze({
  MR: 'de82df4e737954ba0458d597ea82f9a6666c1a9b',
  DS: 'de55888a93983fc51c94f7d22bc94b4f8293205d',
})

function requireFullCommits(commits, label) {
  requireValue(commits && FULL_SHA.test(commits.MR ?? '') && FULL_SHA.test(commits.DS ?? ''),
    `${label}: complete MR and DS commit SHAs are required`)
}

export function validateIncludedIncrements({ baseline, inventory, includedIncrements }) {
  const ledger = includedIncrements
  requireValue(baseline?.schemaVersion === 1 && inventory?.schemaVersion === 1,
    'Baseline and inventory are required for increment-ledger validation')
  requireValue(ledger?.schemaVersion === 1 && ledger.kind === 'included-increment-ledger'
    && ledger.planVersion === baseline.planVersion, 'Invalid included-increment ledger identity')
  requireValue(ledger.genesis?.MR === APPROVED_GENESIS.MR && ledger.genesis?.DS === APPROVED_GENESIS.DS,
    `ledger genesis must equal the approved frozen genesis (MR ${APPROVED_GENESIS.MR}, DS ${APPROVED_GENESIS.DS}); `
    + `got MR ${ledger.genesis?.MR ?? 'missing'}, DS ${ledger.genesis?.DS ?? 'missing'}`)
  requireValue(Array.isArray(ledger.increments), 'ledger increments must be an array')
  const current = { MR: ledger.genesis.MR, DS: ledger.genesis.DS }
  const ids = new Set()
  for (const increment of ledger.increments) {
    requireValue(increment && typeof increment.id === 'string' && increment.id && !ids.has(increment.id),
      'ledger increment ids must be unique and non-empty')
    ids.add(increment.id)
    const source = increment.sourceRepository
    requireValue(source === 'MR' || source === 'DS', `${increment.id}: invalid source repository`)
    requireValue(increment.id === `${source}:${increment.commits?.candidate ?? ''}`,
      `${increment.id}: increment id must be exactly SOURCE:candidate`)
    requireValue(FULL_SHA.test(increment.commits?.baseline ?? '') && FULL_SHA.test(increment.commits?.candidate ?? '')
      && increment.commits.baseline === current[source] && increment.commits.candidate !== increment.commits.baseline,
    `${increment.id}: increment does not continue the ${source} baseline chain`)
    requireValue(increment.status === 'included' && increment.regressionSummary?.status === 'passed',
      `${increment.id}: only increments with passed affected regressions may be ledgered`)
    requireValue(typeof increment.targetVersion === 'string' && increment.targetVersion.trim(),
      `${increment.id}: target version is required`)
    requireValue(HASH.test(increment.proposal?.sha256 ?? '') && HASH.test(increment.proposal?.mechanicalSha256 ?? '')
      && HASH.test(increment.approvalSha256 ?? ''), `${increment.id}: proposal/approval hashes are required`)
    requireValue(increment.proposal.generator?.path === 'scripts/integration-upstream-proposal.mjs'
      && HASH.test(increment.proposal.generator?.sha256 ?? '')
      && Array.isArray(increment.proposal.inputs) && increment.proposal.inputs.length === 4
      && increment.proposal.inputs.every(input => HASH.test(input.sha256 ?? ''))
      && JSON.stringify(increment.proposal.inputs.map(input => input.path).sort()) === JSON.stringify(INCREMENT_INPUTS),
    `${increment.id}: generator and source-input bindings are incomplete`)
    const snapshot = increment.functionalSnapshot
    requireValue(snapshot?.schemaVersion === 1 && snapshot.kind === 'candidate-functional-source-snapshot'
      && snapshot.sourceRepository === source && snapshot.includesDirtyWorktree === false
      && snapshot.behaviorVerified === false && snapshot.commits?.baseline === increment.commits.baseline
      && snapshot.commits?.candidate === increment.commits.candidate,
    `${increment.id}: functional snapshot candidate binding is incomplete`)
    try {
      validateFunctionalSnapshot(snapshot, { sourceRepository: source, commits: increment.commits })
    } catch (error) {
      throw new Error(`${increment.id}: functional snapshot validation failed: ${error.message}`)
    }
    const featureIds = Array.from({ length: COUNTS.features }, (_value, index) => `F${String(index + 1).padStart(2, '0')}`)
    requireValue(Array.isArray(snapshot.features)
      && JSON.stringify(snapshot.featureIds) === JSON.stringify(featureIds)
      && JSON.stringify(snapshot.features.map(feature => feature.id)) === JSON.stringify(featureIds)
      && snapshot.features.every(feature => feature.behaviorVerified === false && Array.isArray(feature.sources)
        && ['candidate-source-reviewed-not-behavior-verified', 'other-source-lock-only-not-observed'].includes(feature.status)
        && (feature.status !== 'other-source-lock-only-not-observed' || feature.sources.length === 0)),
    `${increment.id}: functional snapshot must cover all forty frozen F rows without behavioral promotion`)
    const { sha256: snapshotDigest, ...snapshotContents } = snapshot
    requireValue(HASH.test(snapshotDigest ?? '')
      && createHash('sha256').update(`${JSON.stringify(snapshotContents)}\n`).digest('hex') === snapshotDigest,
    `${increment.id}: functional snapshot content digest mismatch`)
    for (const side of ['baseline', 'candidate']) {
      const tree = snapshot.trees?.[side]
      requireValue(tree?.commit === increment.commits[side] && FULL_SHA.test(tree.tree ?? '')
        && Number.isSafeInteger(tree.files) && tree.files >= 0 && HASH.test(tree.entriesSha256 ?? ''),
      `${increment.id}: functional snapshot ${side} tree binding is incomplete`)
    }
    requireValue(typeof increment.review?.reviewer?.id === 'string' && increment.review.reviewer.id.trim()
      && !Number.isNaN(Date.parse(increment.review.reviewer.reviewedAt ?? '')),
    `${increment.id}: reviewer identity and review time are required`)
    requireValue(Array.isArray(increment.review.files) && Array.isArray(increment.review.features)
      && Array.isArray(increment.review.requirements) && Array.isArray(increment.review.acceptance),
    `${increment.id}: candidate-bound file/F/R/T reviews are required`)
    for (const kind of ['interface', 'data']) {
      const migration = increment.review.migrations?.[kind]
      requireValue(migration && ['required', 'none'].includes(migration.status)
        && typeof migration.reason === 'string' && migration.reason.trim()
        && (migration.status === 'none' || (typeof migration.plan === 'string' && migration.plan.trim())),
      `${increment.id}: ${kind} migration review is incomplete`)
    }
    const risks = increment.review.risks
    requireValue(Array.isArray(risks) && risks.length === RISK_AREAS.length
      && RISK_AREAS.every(area => risks.some(risk => risk.area === area
        && ['accepted', 'mitigated', 'none'].includes(risk.status)
        && typeof risk.reason === 'string' && risk.reason.trim())),
    `${increment.id}: all five risk areas need an explicit reviewer disposition`)
    requireValue(Array.isArray(increment.regressions) && increment.regressions.length > 0
      && increment.regressions.every(regression => regression.status === 'passed' && regression.exitCode === 0
        && HASH.test(regression.stdoutSha256 ?? '') && HASH.test(regression.stderrSha256 ?? '')
        && regression.command?.executable && Array.isArray(regression.command?.args)),
    `${increment.id}: passed affected-regression evidence is incomplete`)
    const summary = increment.regressionSummary, regressions = increment.regressions
    requireValue(summary.total === regressions.length && summary.passed === regressions.length && summary.failed === 0,
      `${increment.id}: regression summary counts differ from the evidence`)
    const regressionIds = new Set(), candidateTrees = new Set()
    for (const regression of regressions) {
      const label = `${increment.id}: regression ${regression.id}`
      requireValue(typeof regression.id === 'string' && /^[A-Za-z0-9.-]+$/.test(regression.id)
        && !regressionIds.has(regression.id), `${label}: regression ids must be unique and portable`)
      regressionIds.add(regression.id)
      requireValue(HASH.test(regression.candidateTreeSha256 ?? '') && HASH.test(regression.harnessSha256 ?? '')
        && typeof regression.candidateRoot === 'string' && regression.candidateRoot.trim(),
      `${label}: candidate-tree and harness regression bindings are required`)
      candidateTrees.add(regression.candidateTreeSha256)
      requireValue(regression.signal === null && regression.error === null,
        `${label}: signalled or erroneous regression cannot be passed`)
      requireValue(Number.isFinite(Date.parse(regression.startedAt)) && Number.isFinite(Date.parse(regression.finishedAt))
        && Date.parse(regression.finishedAt) >= Date.parse(regression.startedAt), `${label}: regression timing is invalid`)
      const command = regression.command, args = command.args
      const expectedArgs = ['--source', source.toLowerCase(), '--baseline', increment.commits.baseline,
        '--candidate', increment.commits.candidate, '--increment-id', increment.id, '--candidate-root', regression.candidateRoot]
      requireValue(typeof command.executable === 'string' && command.executable.trim()
        && command.shell === false && command.cwd === 'candidate-root' && command.timeoutMs === 30_000
        && args.length === expectedArgs.length + 1 && portable(args[0])
        && args[0].startsWith('tests/fixtures/increment-regressions/') && args[0].endsWith('.mjs')
        && args.slice(1).every((arg, index) => arg === expectedArgs[index]), `${label}: regression command is not candidate-bound`)
      for (const stream of ['stdout', 'stderr']) {
        const path = regression.logFiles?.[stream]
        requireValue(portable(path) && path.startsWith('tmp/integration/')
          && path.endsWith(`/${regression.id}.${stream}.log`), `${label}: regression ${stream} log binding is invalid`)
      }
    }
    requireValue(candidateTrees.size === 1, `${increment.id}: regression candidate-tree bindings differ`)
    current[source] = increment.commits.candidate
  }
  for (const source of ['MR', 'DS']) {
    requireValue(baseline.repositories?.[source]?.commit === current[source],
      `${source} baseline drift: baseline ${baseline.repositories?.[source]?.commit ?? 'missing'} has no matching ledger chain (expected ${current[source]})`)
    requireValue(inventory.baseline?.[source] === current[source],
      `${source} inventory baseline differs from the ledgered baseline`)
  }
  for (const feature of inventory.features ?? []) {
    if (feature.repository === 'new') requireValue(feature.commit === null, `${feature.id}: new component commit must be null`)
    else requireValue(feature.commit === current[feature.repository], `${feature.id}: feature commit differs from ledgered baseline`)
  }
  return { current, count: ledger.increments.length }
}

// Shape validation is not byte evidence: normal gates also require the recorded
// stdout/stderr artifacts to exist unchanged, with no linked path components.
export async function validateIncludedRegressionEvidence(root, includedIncrements) {
  const canonicalRoot = await realpath(root)
  for (const increment of includedIncrements.increments) {
    for (const regression of increment.regressions) {
      for (const stream of ['stdout', 'stderr']) {
        const path = regression.logFiles[stream]
        requireValue(portable(path), `${increment.id}: invalid regression log path`)
        let current = canonicalRoot
        for (const [index, part] of path.split('/').entries()) {
          current = join(current, part)
          const info = await lstat(current)
          requireValue(!info.isSymbolicLink() && (index === path.split('/').length - 1 ? info.isFile() : info.isDirectory()),
            `${increment.id}: linked or invalid regression log path`)
        }
        requireValue(createHash('sha256').update(await readFile(current)).digest('hex') === regression[`${stream}Sha256`],
          `${increment.id}: regression ${stream} bytes differ from recorded evidence`)
      }
    }
  }
}

// An exclusive marker covers the multi-file publication window, including a hard
// process exit before any ledger write. Never infer recovery from partial bytes.
export async function assertNoInclusionTransaction(root) {
  const path = join(root, 'docs/integration/inclusion-transaction.json')
  let bytes
  try { bytes = await readFile(path) } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  let state = 'malformed'
  try { state = JSON.parse(bytes.toString('utf8')).state ?? state } catch { /* fail closed */ }
  throw new Error(`Inclusion transaction requires bounded recovery inspection: ${state}`)
}

function requireValue(ok, message) {
  if (!ok) throw new Error(message)
}

function indexed(items, label) {
  requireValue(Array.isArray(items), `${label} must be an array`)
  const result = new Map()
  for (const item of items) {
    requireValue(item && typeof item.id === 'string', `${label}: missing id`)
    requireValue(!result.has(item.id), `${label}: duplicate id ${item.id}`)
    result.set(item.id, item)
  }
  return result
}

/** Evidence must survive a checkout, and must not resolve through an external symlink. */
export async function validateEvidence(root, entries, label) {
  requireValue(Array.isArray(entries), `${label}: evidence must be an array`)
  const canonicalRoot = await realpath(root)
  for (const entry of entries) {
    requireValue(typeof entry === 'string' && entry && !entry.includes('\\')
      && !isAbsolute(entry) && !/^[A-Za-z]:/.test(entry)
      && !entry.split('/').some(part => part === '..' || part === '.' || part === '')
      && !['tmp', 'node_modules', '.git'].includes(entry.split('/')[0]), `${label}: evidence must be a portable tracked path`)
    const canonical = await realpath(join(root, entry))
    const part = relative(canonicalRoot, canonical)
    requireValue(part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part), `${label}: evidence escapes project`)
    requireValue((await stat(canonical)).isFile(), `${label}: evidence must name a file`)
  }
}

export async function validateProject({ board, scope, inventory, baseline, includedIncrements, root = ROOT }) {
  requireValue(board?.schemaVersion === 1 && scope?.schemaVersion === 1 && inventory?.schemaVersion === 1, 'Unsupported project schema')
  validateIncludedIncrements({ baseline, inventory, includedIncrements })
  await validateIncludedRegressionEvidence(root, includedIncrements)
  requireValue(board.planVersion === '1.1' && scope.planVersion === board.planVersion, 'Plan versions differ')
  requireValue(scope.source?.path === 'docs/integration/plan/20261026_requirements_acceptance.md', 'Missing approved scope source')
  await validateEvidence(root, [scope.source.path], 'approved scope')
  const approvedBytes = await readFile(join(root, scope.source.path))
  requireValue(createHash('sha256').update(approvedBytes).digest('hex') === scope.source.sha256, 'Approved scope source checksum changed')
  const catalogs = {}
  for (const [name, count] of Object.entries(COUNTS)) {
    const map = catalogs[name] = indexed(scope[name], name)
    requireValue(map.size === count, `${name}: frozen scope requires ${count} items`)
    const prefix = { requirements: 'R', features: 'F', acceptance: 'T' }[name]
    for (let n = 1; n <= count; n++) requireValue(map.has(`${prefix}${String(n).padStart(2, '0')}`), `${name}: missing id ${n}`)
  }
  for (const name of ['requirements', 'features']) {
    for (const item of catalogs[name].values()) {
      requireValue(Array.isArray(item.acceptanceIds) && item.acceptanceIds.length, `${item.id}: no acceptance mapping`)
      for (const id of item.acceptanceIds) requireValue(catalogs.acceptance.has(id), `${item.id}: unknown acceptance ${id}`)
    }
  }
  for (const name of ['requirements', 'features', 'acceptance']) {
    const prefix = { requirements: 'R', features: 'F', acceptance: 'T' }[name]
    const rows = new Map(approvedBytes.toString('utf8').split('\n')
      .filter(line => new RegExp(`^\\| ${prefix}\\d{2} \\|`).test(line))
      .map(line => line.split('|').slice(1, -1).map(part => part.trim()))
      .map(row => [row[0], row]))
    for (const item of catalogs[name].values()) {
      const row = rows.get(item.id)
      requireValue(row?.[1] === item.title, `${item.id}: differs from approved scope`)
      if (name === 'acceptance') requireValue(row[2] === item.criteria, `${item.id}: criteria differ from approved scope`)
      else {
        const expanded = row.at(-1).replace(/T(\d{2})[–-]T(\d{2})/g, (_all, start, end) =>
          Array.from({ length: Number(end) - Number(start) + 1 }, (_v, i) => `T${String(Number(start) + i).padStart(2, '0')}`).join(' '))
        const expected = [...new Set(expanded.match(/\bT\d{2}\b/g) ?? [])]
        requireValue(JSON.stringify(expected) === JSON.stringify(item.acceptanceIds), `${item.id}: acceptance mapping differs from approved scope`)
      }
    }
  }
  const sources = indexed(inventory.features, 'inventory')
  requireValue(sources.size === COUNTS.features, 'Inventory must cover all frozen feature groups')
  for (const id of catalogs.features.keys()) requireValue(sources.has(id), `Inventory missing ${id}`)

  const tasks = indexed(board.tasks, 'tasks')
  requireValue(tasks.size === 20, 'Work breakdown requires W01–W20')
  for (let i = 1; i <= 20; i++) requireValue(tasks.has(`W${String(i).padStart(2, '0')}`), `Missing work package ${i}`)
  requireValue(/^M[0-9]$/.test(board.activeMilestone), 'Unknown active milestone')
  const visiting = new Set()
  const visited = new Set()
  const visit = id => {
    requireValue(tasks.has(id), `Unknown task dependency ${id}`)
    requireValue(!visiting.has(id), `Task dependency cycle at ${id}`)
    if (visited.has(id)) return
    visiting.add(id)
    const task = tasks.get(id)
    requireValue(Array.isArray(task.dependsOn), `${id}: dependencies must be an array`)
    for (const dependency of task.dependsOn) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of tasks.keys()) visit(id)

  const results = indexed(board.acceptanceResults, 'acceptance results')
  requireValue(results.size === COUNTS.acceptance, 'Acceptance results must cover every scenario')
  for (const [id, result] of results) {
    requireValue(catalogs.acceptance.has(id) && RESULT_STATES.has(result.status), `${id}: invalid acceptance status`)
    await validateEvidence(root, result.evidence, id)
    if (result.status === 'passed') {
      requireValue(result.evidence.length > 0, `${id}: passing needs evidence`)
      requireValue(['document', 'unit', 'sdk-probe', 'integration', 'live-product', 'live-platform', 'release'].includes(result.level), `${id}: passing needs an evidence level`)
      requireValue(typeof result.verifiedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(result.verifiedOn), `${id}: passing needs a verification date`)
      requireValue(typeof result.environment === 'string' && result.environment.trim(), `${id}: passing needs an environment`)
    }
  }
  for (const task of tasks.values()) {
    requireValue(/^M[0-9]$/.test(task.milestone), `${task.id}: invalid milestone`)
    requireValue(TASK_STATES.has(task.status), `${task.id}: invalid task status`)
    requireValue(Array.isArray(task.acceptanceIds) && task.acceptanceIds.length, `${task.id}: no acceptance criteria`)
    for (const id of task.acceptanceIds) requireValue(results.has(id), `${task.id}: unknown acceptance ${id}`)
    await validateEvidence(root, task.evidence, task.id)
    const steps = indexed(task.steps, `${task.id} steps`)
    for (const step of steps.values()) {
      requireValue(step.id.startsWith(`${task.id}.`) && TASK_STATES.has(step.status), `${step.id}: invalid step`)
      await validateEvidence(root, step.evidence, step.id)
      if (step.status === 'completed') requireValue(step.evidence.length > 0, `${step.id}: completion needs evidence`)
      if (step.status === 'blocked') requireValue(typeof step.blocker === 'string' && step.blocker.trim(), `${step.id}: missing blocker`)
    }
    if (task.status === 'completed') {
      requireValue(task.evidence.length > 0, `${task.id}: completion needs evidence`)
      requireValue(task.dependsOn.every(id => tasks.get(id).status === 'completed'), `${task.id}: dependencies incomplete`)
      requireValue([...steps.values()].every(item => item.status === 'completed'), `${task.id}: steps incomplete`)
      requireValue(task.acceptanceIds.every(id => results.get(id).status === 'passed'), `${task.id}: acceptance incomplete`)
    }
    if (task.status === 'blocked') requireValue(typeof task.blocker === 'string' && task.blocker.trim(), `${task.id}: missing blocker`)
  }
  const gates = indexed(board.gates, 'gates')
  requireValue(['G1', 'G2', 'G3', 'G4'].every(id => gates.has(id)) && gates.size === 4, 'Four M0 gates required')
  for (const gate of gates.values()) {
    requireValue(TASK_STATES.has(gate.status), `${gate.id}: invalid gate status`)
    await validateEvidence(root, gate.evidence, gate.id)
    if (gate.status === 'completed') requireValue(gate.evidence.length > 0, `${gate.id}: no evidence`)
  }
  // No later milestone can be marked complete while the M0 gates are open.
  if ([...tasks.values()].some(item => item.milestone !== 'M0' && item.status === 'completed')) {
    requireValue([...gates.values()].every(item => item.status === 'completed'), 'M0 gates are incomplete')
  }
  return { tasks, results, gates, catalogs }
}

export function statusText(board, scope) {
  const taskCount = board.tasks.filter(item => item.status === 'completed').length
  const passed = board.acceptanceResults.filter(item => item.status === 'passed').length
  const steps = board.tasks.filter(item => item.milestone === 'M0').flatMap(item => item.steps)
  const lines = [
    `DSH Bot integration · plan ${board.planVersion} · active ${board.activeMilestone}`,
    `Work packages completed: ${taskCount}/20; acceptance scenarios passed: ${passed}/${scope.acceptance.length}`,
    `Passed evidence levels: ${[...new Set(board.acceptanceResults.filter(item => item.status === 'passed').map(item => item.level))].sort().map(level => `${level} ${board.acceptanceResults.filter(item => item.status === 'passed' && item.level === level).length}`).join(', ') || 'none'}`,
    `Recorded M0 steps completed: ${steps.filter(item => item.status === 'completed').length}/${steps.length}`,
    'Work-package counts do not imply product completion or release readiness.', '',
  ]
  for (let i = 0; i <= 9; i++) {
    const tasks = board.tasks.filter(item => item.milestone === `M${i}`)
    lines.push(`M${i}: ${tasks.map(item => `${item.id} ${item.status}`).join(' | ')}`)
  }
  lines.push('', 'M0 gates: '+board.gates.map(item => `${item.id} ${item.status}`).join(' | '))
  for (const task of board.tasks.filter(item => item.status === 'in_progress' || item.status === 'blocked')) {
    lines.push('', `${task.id} ${task.title}`)
    for (const step of task.steps) lines.push(`  ${step.id} ${step.status} ${step.title}${step.blocker ? ` — ${step.blocker}` : ''}`)
  }
  return lines.join('\n')+'\n'
}

export async function readProject(root = ROOT) {
  await assertNoInclusionTransaction(root)
  const base = join(root, 'docs', 'integration')
  const read = async name => JSON.parse(await readFile(join(base, name), 'utf8'))
  const [board, scope, inventory, baseline, includedIncrements] = await Promise.all([
    read('tasks.json'), read('scope.json'), read('feature-inventory.json'),
    read('baseline.json'), read('included-increments.json'),
  ])
  return { root, board, scope, inventory, baseline, includedIncrements }
}

export async function main(args = process.argv.slice(2)) {
  let root = ROOT
  const positional = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--root' && args[index + 1] && !args[index + 1].startsWith('--')) {
      root = resolve(args[index + 1])
      index += 1
    } else positional.push(args[index])
  }
  const command = positional[0] ?? 'status'
  requireValue(['status', 'check', 'report'].includes(command) && positional.length <= 1,
    'Usage: node scripts/integration-progress.mjs [status|check|report] [--root <project-root>]')
  const project = await readProject(root)
  await validateProject(project)
  if (command === 'check') {
    process.stdout.write(`Integration tracking valid: 32 requirements, 40 features, 63 acceptance scenarios, 20 work packages; included increments ${project.includedIncrements.increments.length}.\n`)
    return
  }
  const report = statusText(project.board, project.scope)
  if (command === 'report') await writeFile(join(root, 'docs/integration/STATUS.txt'), report)
  process.stdout.write(report)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
}
