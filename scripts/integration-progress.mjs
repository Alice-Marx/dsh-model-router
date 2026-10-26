import { readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TASK_STATES = new Set(['planned', 'in_progress', 'blocked', 'completed'])
const RESULT_STATES = new Set(['not_run', 'partial', 'passed', 'failed', 'blocked'])
const COUNTS = { requirements: 32, features: 40, acceptance: 63 }

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

export async function validateProject({ board, scope, inventory, root = ROOT }) {
  requireValue(board?.schemaVersion === 1 && scope?.schemaVersion === 1 && inventory?.schemaVersion === 1, 'Unsupported project schema')
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
  const base = join(root, 'docs', 'integration')
  const read = async name => JSON.parse(await readFile(join(base, name), 'utf8'))
  const [board, scope, inventory] = await Promise.all([read('tasks.json'), read('scope.json'), read('feature-inventory.json')])
  return { root, board, scope, inventory }
}

export async function main(args = process.argv.slice(2)) {
  const command = args[0] ?? 'status'
  requireValue(['status', 'check', 'report'].includes(command) && args.length <= 1, 'Usage: node scripts/integration-progress.mjs [status|check|report]')
  const project = await readProject()
  await validateProject(project)
  if (command === 'check') {
    process.stdout.write('Integration tracking valid: 32 requirements, 40 features, 63 acceptance scenarios, 20 work packages.\n')
    return
  }
  const report = statusText(project.board, project.scope)
  if (command === 'report') await writeFile(join(ROOT, 'docs/integration/STATUS.txt'), report)
  process.stdout.write(report)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
}
