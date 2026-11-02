import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { readProject, validateProject, validateEvidence, statusText, validateIncludedIncrements } from '../scripts/integration-progress.mjs'

const project = await readProject()
const fixture = () => structuredClone(project)

test('integration: frozen plan, source inventory, dependency graph and evidence validate', async () => {
  const result = await validateProject(project)
  assert.equal(result.catalogs.requirements.size, 32)
  assert.equal(result.catalogs.features.size, 40)
  assert.equal(result.results.size, 63)
})

for (const [name, mutate, expected] of [
  ['scope removal', value => value.scope.requirements.pop(), /frozen scope/],
  ['duplicate scope id', value => { value.scope.features[1].id = 'F01' }, /duplicate id/],
  ['altered requirement title', value => { value.scope.requirements[0].title = 'Replace user intent' }, /differs from approved scope/],
  ['weakened acceptance', value => { value.scope.acceptance[0].criteria = 'No evidence needed' }, /criteria differ from approved scope/],
  ['removed acceptance mapping', value => { value.scope.requirements[0].acceptanceIds.pop() }, /mapping differs from approved scope/],
  ['unknown acceptance mapping', value => { value.scope.features[0].acceptanceIds = ['T99'] }, /unknown acceptance/],
  ['dependency cycle', value => { value.board.tasks[0].dependsOn = ['W03'] }, /dependency cycle/],
  ['missing dependency', value => { value.board.tasks[0].dependsOn = ['W99'] }, /Unknown task dependency/],
  ['completion without proof', value => { value.board.tasks[0].status = 'completed'; value.board.tasks[0].evidence = [] }, /completion needs evidence/],
  ['passing acceptance without proof', value => { value.board.acceptanceResults[0].status = 'passed'; value.board.acceptanceResults[0].evidence = [] }, /passing needs evidence/],
  ['incomplete acceptance', value => {
    const task = value.board.tasks[0]
    task.status = 'completed'
    task.evidence = ['docs/integration/baseline.json']
    task.steps.forEach(step => { step.status = 'completed'; step.evidence = ['docs/integration/baseline.json'] })
  }, /acceptance incomplete/],
  ['temporary proof', value => { value.board.tasks[0].evidence = ['tmp/local-result.json'] }, /portable tracked path/],
  ['absolute proof', value => { value.board.tasks[0].evidence = ['C:/private/result.json'] }, /portable tracked path/],
  ['traversal proof', value => { value.board.tasks[0].evidence = ['docs/../../private.json'] }, /portable tracked path/],
  ['blocked without explanation', value => { value.board.tasks[0].status = 'blocked' }, /missing blocker/],
]) {
  test(`integration: reject ${name}`, async () => {
    const value = fixture()
    mutate(value)
    await assert.rejects(validateProject(value), expected)
  })
}

test('integration: a sibling junction cannot turn external evidence into project evidence', async t => {
  const parent = join(project.root, 'tmp/integration/progress-fixtures')
  await mkdir(parent, { recursive: true })
  const canonicalParent = await realpath(parent)
  const parentPart = relative(await realpath(project.root), canonicalParent)
  assert.ok(parentPart && parentPart !== '..' && !parentPart.startsWith(`..${sep}`) && !isAbsolute(parentPart))
  const home = await mkdtemp(join(parent, 'scope-'))
  // All recursive cleanup targets are real fixture directories under this known parent.
  t.after(async () => {
    const canonical = await realpath(home)
    const part = relative(canonicalParent, canonical)
    assert.ok(part && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part))
    await rm(home, { recursive: true, force: true })
  })
  const inside = join(home, 'project')
  const outside = join(home, 'outside')
  await mkdir(join(inside, 'evidence'), { recursive: true })
  await mkdir(outside)
  await writeFile(join(outside, 'result.json'), '{}')
  await symlink(outside, join(inside, 'evidence/link'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(validateEvidence(inside, ['evidence/link/result.json'], 'probe'), /escapes project/)
})

test('integration: progress distinguishes work completed from product acceptance', () => {
  const text = statusText(project.board, project.scope)
  assert.match(text, /Work packages completed: \d+\/20; acceptance scenarios passed: \d+\/63/)
  assert.match(text, /Passed evidence levels:/)
  assert.match(text, /do not imply product completion or release readiness/)
  assert.match(text, /M0 gates:/)
})

test('integration: empty genesis is explicit and manual baseline drift fails closed', async () => {
  assert.deepEqual(project.includedIncrements.increments, [])
  assert.equal(validateIncludedIncrements(project).count, 0)
  for (const mutate of [
    value => { value.baseline.repositories.MR.commit = '0'.repeat(40) },
    value => { value.inventory.baseline.DS = '1'.repeat(40) },
    value => { value.inventory.features.find(feature => feature.repository === 'MR').commit = '2'.repeat(40) },
  ]) {
    const drifted = fixture()
    mutate(drifted)
    await assert.rejects(validateProject(drifted), /baseline drift|baseline differs|feature commit differs/)
  }
})

// Structural unit fixtures only: hashes are not claimed as real execution evidence.
function ledgerEvidenceFixture() {
  const value = fixture(), candidate = 'c'.repeat(40), hash = 'a'.repeat(64)
  const baseline = value.includedIncrements.genesis.MR, id = `MR:${candidate}`
  const root = '/isolated/candidate', time = '2026-11-02T00:00:00.000Z'
  const featureIds = Array.from({ length: 40 }, (_value, index) => `F${String(index + 1).padStart(2, '0')}`)
  const functionalSnapshot = { schemaVersion: 1, kind: 'candidate-functional-source-snapshot', sourceRepository: 'MR',
    commits: { baseline, candidate }, includesDirtyWorktree: false, behaviorVerified: false, featureIds,
    features: featureIds.map(id => {
      const registration = value.inventory.features.find(row => row.id === id)
      const observed = registration.repository === 'MR' || id === 'F40'
      const missing = { kind: 'missing', fileCount: 0, sha256: createHash('sha256').update('[]\n').digest('hex'), files: [] }
      return { id, repository: registration.repository,
        status: observed ? 'candidate-source-reviewed-not-behavior-verified' : 'other-source-lock-only-not-observed',
        sources: observed ? [{ path: registration.sources[0]?.path ?? 'packages/cli-runtime/src',
          baseline: structuredClone(missing), candidate: structuredClone(missing) }] : [], behaviorVerified: false }
    }),
    trees: Object.fromEntries(Object.entries({ baseline, candidate }).map(([side, commit]) => [side,
      { commit, tree: 'b'.repeat(40), files: 1, entriesSha256: hash }])) }
  functionalSnapshot.sha256 = createHash('sha256').update(`${JSON.stringify(functionalSnapshot)}\n`).digest('hex')
  const regression = {
    id: 'F23-router-contract', status: 'passed', exitCode: 0, signal: null, error: null,
    startedAt: time, finishedAt: time, candidateRoot: root,
    candidateTreeSha256: hash, harnessSha256: hash, stdoutSha256: hash, stderrSha256: hash,
    logFiles: { stdout: 'tmp/integration/unit/F23-router-contract.stdout.log', stderr: 'tmp/integration/unit/F23-router-contract.stderr.log' },
    command: { executable: process.execPath, args: ['tests/fixtures/increment-regressions/f23-router-contract.mjs',
      '--source', 'mr', '--baseline', baseline, '--candidate', candidate, '--increment-id', id, '--candidate-root', root],
    cwd: 'candidate-root', shell: false, timeoutMs: 30_000 },
  }
  value.baseline.repositories.MR.commit = candidate
  value.inventory.baseline.MR = candidate
  for (const feature of value.inventory.features) if (feature.repository === 'MR') feature.commit = candidate
  value.includedIncrements.increments.push({
    id, sourceRepository: 'MR', commits: { baseline, candidate }, status: 'included',
    targetVersion: '0.26.0-preview.2', includedAt: time,
    proposal: { sha256: hash, mechanicalSha256: hash,
      generator: { path: 'scripts/integration-upstream-proposal.mjs', sha256: hash },
      inputs: ['baseline.json', 'feature-inventory.json', 'scope.json', 'tasks.json'].map(file => ({ path: `docs/integration/${file}`, sha256: hash })) },
    approvalSha256: hash,
    functionalSnapshot,
    review: { reviewer: { id: 'structural-unit-fixture', reviewedAt: time },
      files: [], features: [], requirements: [], acceptance: [],
      migrations: Object.fromEntries(['interface', 'data'].map(kind => [kind, { status: 'none', reason: 'Unit-only validation fixture.' }])),
      risks: ['config', 'data', 'cli', 'native', 'platform'].map(area => ({ area, status: 'none', reason: 'Unit-only validation fixture.' })) },
    regressions: [regression], regressionSummary: { status: 'passed', total: 1, passed: 1, failed: 0 },
  })
  return value
}

test('integration: well-shaped included regression metadata continues the ledger', () => {
  assert.equal(validateIncludedIncrements(ledgerEvidenceFixture()).count, 1)
})

for (const [name, mutate] of [
  ['pending regression evidence', row => { row.regressions[0].status = 'pending' }],
  ['failed regression evidence', row => { row.regressions[0].status = 'failed'; row.regressions[0].exitCode = 7 }],
  ['mismatched summary counts', row => { row.regressionSummary.total = 2 }],
  ['duplicate regression ids', row => { row.regressions.push(structuredClone(row.regressions[0])); row.regressionSummary.total = 2; row.regressionSummary.passed = 2 }],
  ['missing candidate-tree binding', row => { delete row.regressions[0].candidateTreeSha256 }],
  ['missing harness binding', row => { delete row.regressions[0].harnessSha256 }],
  ['signalled result reported as passed', row => { row.regressions[0].signal = 'SIGTERM' }],
  ['execution error reported as passed', row => { row.regressions[0].error = { code: 'ETIMEDOUT' } }],
  ['shell-enabled command evidence', row => { row.regressions[0].command.shell = true }],
  ['wrong candidate command evidence', row => { row.regressions[0].command.args[6] = 'd'.repeat(40) }],
  ['wrong source command evidence', row => { row.regressions[0].command.args[2] = 'ds' }],
  ['missing stdout log binding', row => { delete row.regressions[0].logFiles.stdout }],
  ['duplicate proposal inputs', row => { row.proposal.inputs[1] = structuredClone(row.proposal.inputs[0]) }],
  ['missing functional snapshot', row => { delete row.functionalSnapshot }],
  ['wrong functional snapshot candidate', row => { row.functionalSnapshot.commits.candidate = 'd'.repeat(40) }],
  ['incomplete functional snapshot', row => { row.functionalSnapshot.features.pop() }],
  ['tampered functional snapshot', row => { row.functionalSnapshot.trees.candidate.files = 9 }],
  ['functional snapshot behavior promotion', row => { row.functionalSnapshot.features[0].behaviorVerified = true }],
]) {
  test(`integration: ledger rejects ${name}`, () => {
    const value = ledgerEvidenceFixture()
    mutate(value.includedIncrements.increments[0])
    assert.throws(() => validateIncludedIncrements(value), /regression|source-input|functional snapshot/)
  })
}
