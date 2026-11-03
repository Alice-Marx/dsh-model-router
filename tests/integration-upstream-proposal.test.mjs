import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  buildProposal, parseArgs, parseNameStatusZ, parseNumstatZ, validateDocument, validateFunctionalSnapshot, writeProposal,
} from '../scripts/integration-upstream-proposal.mjs'

const execute = promisify(execFile)
const ROOT = resolve(import.meta.dirname, '..')
const GENERATED_AT = '2026-11-02T00:00:00.000Z'
const GENERATED_AT_LATER = '2026-11-02T05:00:00.000Z'

async function fixtureGit(repo, args) {
  return execute('git', ['-C', repo,
    '-c', 'user.name=K39 Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args],
  { windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
}

function gitBlob(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

async function makeSourceRepo(t) {
  const repo = await mkdtemp(join(tmpdir(), 'k39-source-repo-'))
  t.after(() => rm(repo, { recursive: true, force: true }))
  await fixtureGit(repo, ['init', '-q'])
  const write = async (path, content) => {
    await mkdir(dirname(join(repo, path)), { recursive: true })
    await writeFile(join(repo, path), content)
  }
  await write('.gitattributes', '* -text\n')
  await write('keep.txt', 'k\n')
  await write('modify.txt', 'x\n')
  await write('delete-me.txt', 'bye\n')
  await write('old name.txt', 'same\ncontent\n')
  await write('docs/integration/evidence/fake.json', '{"a":1}\n')
  await fixtureGit(repo, ['add', '-A'])
  await fixtureGit(repo, ['commit', '-q', '-m', 'baseline'])
  const baselineSha = (await fixtureGit(repo, ['rev-parse', 'HEAD'])).stdout.trim()
  const modifyBaselineBytes = await readFile(join(repo, 'modify.txt'))
  await write('modify.txt', 'y\nz\n')
  await rm(join(repo, 'delete-me.txt'))
  await rename(join(repo, 'old name.txt'), join(repo, 'renamed target.txt'))
  await write('registered/added.txt', 'r\n')
  await write('space + #name.txt', 's\n')
  await writeFile(join(repo, 'binary.bin'), Buffer.from([0, 1, 255]))
  await write('native/hook.ps1', 'Write-Host ok\n')
  await write('packages/cli-runtime/src/thing.mjs', 'export const thing = 1\n')
  await write('server.config.json', '{}\n')
  await write('data/ledger.sqlite', 'textual fixture standing for a data file\n')
  await write('.github/workflows/ci.yml', 'on: push\njobs:\n  build:\n')
  await write('evidence-file.txt', 'e\n')
  await write('docs/integration/evidence/fake.json', '{"a":2}\n')
  await fixtureGit(repo, ['add', '-A'])
  await fixtureGit(repo, ['commit', '-q', '-m', 'candidate'])
  const candidateSha = (await fixtureGit(repo, ['rev-parse', 'HEAD'])).stdout.trim()
  // Dirty the worktree after the candidate commit: none of this may enter the object diff.
  await write('modify.txt', `${'y\n'.repeat(500)}dirty\n`)
  await rm(join(repo, 'keep.txt'))
  await write('untracked.txt', 'untracked\n')
  return {
    repo, baselineSha, candidateSha,
    modifyBaselineGitBlob: gitBlob(modifyBaselineBytes),
    modifyBaselineBytes: modifyBaselineBytes.length,
  }
}

test('registered directory sources include nested files and incoming renames without including sibling prefixes', async t => {
  const fixture = await makeSourceRepo(t)
  const root = await makeProductRoot(t, fixture)
  const inventoryPath = join(root, 'docs/integration/feature-inventory.json')
  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'))
  inventory.features.find(feature => feature.id === 'F02').sources = [{ path: 'registered/', kind: 'directory' }]
  await writeFile(inventoryPath, JSON.stringify(inventory))
  await mkdir(join(fixture.repo, 'registered/deep'), { recursive: true })
  await mkdir(join(fixture.repo, 'registered-sibling'), { recursive: true })
  await writeFile(join(fixture.repo, 'registered/deep/new.txt'), 'new nested source\n')
  await writeFile(join(fixture.repo, 'registered-sibling/outside.txt'), 'outside directory boundary\n')
  await fixtureGit(fixture.repo, ['mv', 'renamed target.txt', 'registered/deep/moved.txt'])
  await fixtureGit(fixture.repo, ['add', '--', 'registered/deep/new.txt', 'registered-sibling/outside.txt'])
  await fixtureGit(fixture.repo, ['commit', '-q', '-m', 'directory source delta'])
  const candidate = (await fixtureGit(fixture.repo, ['rev-parse', 'HEAD'])).stdout.trim()
  const { document } = await buildProposal({ ...options(root, fixture), candidate })
  const files = new Map(document.files.map(file => [file.path, file]))
  for (const path of ['registered/added.txt', 'registered/deep/new.txt', 'registered/deep/moved.txt']) {
    assert.equal(files.get(path).includedInFrozenSourceFilter, true)
    assert.deepEqual(files.get(path).mapping.featureIds, ['F02'])
    assert.equal(files.get(path).mapping.kind, 'direct')
  }
  assert.equal(files.get('registered/deep/moved.txt').oldPath, 'old name.txt')
  assert.equal(files.get('registered/deep/moved.txt').change, 'renamed')
  assert.equal(files.get('registered-sibling/outside.txt').includedInFrozenSourceFilter, false)
  assert.deepEqual(files.get('registered-sibling/outside.txt').mapping.featureIds, [])
  assert.ok(document.sourceFilter.excludedFiles.includes('registered-sibling/outside.txt'))
  assert.equal(document.sourceFilter.matching, 'registered-files-or-directory-descendants')
  assert.equal(document.decision.effectiveDecision, 'not-included')
  assert.equal(document.decision.baselineChangeApproved, false)
})

async function makeProductRoot(t, fixture) {
  const root = await mkdtemp(join(tmpdir(), 'k39-product-root-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const docs = join(root, 'docs/integration')
  await mkdir(join(docs, 'evidence'), { recursive: true })
  const fakeCommit = 'f'.repeat(40)
  await writeFile(join(docs, 'baseline.json'), `${JSON.stringify({
    schemaVersion: 1,
    repositories: {
      MR: { name: 'fixture/mr-source', commit: fixture.baselineSha },
      DS: { name: 'fixture/ds-source', commit: fakeCommit },
    },
  }, null, 2)}\n`)
  await writeFile(join(docs, 'feature-inventory.json'), `${JSON.stringify({
    schemaVersion: 1,
    baseline: { MR: fixture.baselineSha, DS: fakeCommit },
    features: [
      {
        id: 'F01', title: 'fixture one', repository: 'MR', commit: fixture.baselineSha,
        sources: [{ path: 'modify.txt', gitBlob: fixture.modifyBaselineGitBlob, bytes: fixture.modifyBaselineBytes }],
        destination: 'x', acceptanceIds: ['T01'], reviewStatus: 'source-mapped', behaviorVerified: false,
      },
      {
        id: 'F02', title: 'fixture two', repository: 'MR', commit: fixture.baselineSha,
        sources: [{ path: 'registered/added.txt', gitBlob: '0'.repeat(40), bytes: 2 }],
        destination: 'x', acceptanceIds: ['T02'], reviewStatus: 'source-mapped', behaviorVerified: false,
      },
      {
        id: 'F03', title: 'fixture three (other repository)', repository: 'DS', commit: fakeCommit,
        sources: [{ path: 'evidence-file.txt', gitBlob: '0'.repeat(40), bytes: 2 }],
        destination: 'x', acceptanceIds: ['T03'], reviewStatus: 'source-mapped', behaviorVerified: false,
      },
    ],
  }, null, 2)}\n`)
  await writeFile(join(docs, 'scope.json'), `${JSON.stringify({
    schemaVersion: 1,
    requirements: [
      { id: 'R01', title: 'r1', acceptanceIds: ['T01'] },
      { id: 'R02', title: 'r2', acceptanceIds: ['T02', 'T09'] },
    ],
    features: [
      { id: 'F01', title: 'fixture one', acceptanceIds: ['T01'], decision: 'x' },
      { id: 'F02', title: 'fixture two', acceptanceIds: ['T02'], decision: 'x' },
      { id: 'F03', title: 'fixture three', acceptanceIds: ['T03'], decision: 'x' },
    ],
  }, null, 2)}\n`)
  await writeFile(join(docs, 'tasks.json'), `${JSON.stringify({
    schemaVersion: 1,
    updatedOn: '2026-11-02',
    acceptanceResults: [
      { id: 'T01', status: 'partial', evidence: ['evidence-file.txt'] },
      { id: 'T02', status: 'partial', evidence: [] },
    ],
  }, null, 2)}\n`)
  await mkdir(join(root, 'scripts'), { recursive: true })
  await cp(join(ROOT, 'scripts/integration-upstream-proposal.mjs'),
    join(root, 'scripts/integration-upstream-proposal.mjs'))
  await mkdir(join(root, 'tmp/integration'), { recursive: true })
  return root
}

function options(root, fixture, output = 'tmp/integration/out') {
  return {
    root,
    sourceId: 'mr',
    candidate: fixture.candidateSha,
    generatedAt: GENERATED_AT,
    output,
    repositories: { MR: fixture.repo, DS: join(fixture.repo, 'no-ds-checkout') },
  }
}

test('upstream proposal: mechanical diff covers add/modify/delete/rename/binary/space paths and excludes the dirty worktree', async t => {
  const fixture = await makeSourceRepo(t)
  const root = await makeProductRoot(t, fixture)
  const docsHashes = new Map()
  for (const name of ['baseline.json', 'feature-inventory.json', 'scope.json', 'tasks.json']) {
    docsHashes.set(name, createHash('sha256').update(await readFile(join(root, 'docs/integration', name))).digest('hex'))
  }
  const realBaselineBefore = await readFile(join(ROOT, 'docs/integration/baseline.json'))

  const result = await writeProposal(options(root, fixture))
  const { document } = result

  assert.equal(document.kind, 'readonly-candidate-increment-proposal')
  assert.equal(document.commits.baseline, fixture.baselineSha)
  assert.equal(document.commits.candidate, fixture.candidateSha)
  assert.equal(document.relationship.baselineIsAncestorOfCandidate, true)
  assert.equal(document.relationship.zeroDelta, false)
  assert.equal(document.observation.marker, 'local-observation-only')
  assert.equal(document.observation.remoteVerification, 'unverified')
  assert.equal(document.observation.remoteLatestClaimed, false)
  assert.equal(document.observation.candidateIncludesDirtyWorktree, false)

  const byPath = new Map(document.files.map(file => [file.path, file]))
  assert.equal(document.files.length, 13)
  assert.deepEqual(document.summary.byChange, {
    added: 9, modified: 2, deleted: 1, renamed: 1, copied: 0, typechanged: 0,
  })
  assert.equal(document.summary.totalFiles, 13)
  assert.equal(document.summary.binaryFiles, 1)
  assert.equal(document.summary.textInsertions, 13)
  assert.equal(document.summary.textDeletions, 3)

  assert.deepEqual(byPath.get('modify.txt'), {
    path: 'modify.txt', change: 'modified', status: 'M',
    added: 2, deleted: 1, binary: false, includedInFrozenSourceFilter: true,
    mapping: {
      kind: 'direct',
      basis: 'matches a frozen feature-inventory registered file or directory source of MR',
      featureIds: ['F01'], acceptanceIds: ['T01'], requirementIds: ['R01'],
    },
  })
  const deleted = byPath.get('delete-me.txt')
  assert.equal(deleted.change, 'deleted')
  assert.equal(deleted.status, 'D')
  assert.equal(deleted.deleted, 1)
  assert.equal(deleted.mapping.kind, 'unknown')
  const renamed = byPath.get('renamed target.txt')
  assert.equal(renamed.change, 'renamed')
  assert.match(renamed.status, /^R\d+$/)
  assert.equal(renamed.oldPath, 'old name.txt')
  assert.equal(renamed.added, 0)
  assert.equal(renamed.deleted, 0)
  assert.equal(renamed.mapping.kind, 'unknown')
  assert.ok(byPath.has('space + #name.txt'), 'paths with spaces must survive intact')
  assert.equal(byPath.get('space + #name.txt').change, 'added')
  const binary = byPath.get('binary.bin')
  assert.equal(binary.binary, true)
  assert.equal(binary.added, null)
  assert.equal(binary.deleted, null)
  assert.ok(!('oldPath' in binary))

  // Frozen-source mapping stays repository-scoped: F03 is a DS registration and must not leak into MR.
  const evidenceFile = byPath.get('evidence-file.txt')
  assert.equal(evidenceFile.mapping.kind, 'inferred')
  assert.deepEqual(evidenceFile.mapping.featureIds, ['F01'])
  assert.deepEqual(evidenceFile.mapping.acceptanceIds, ['T01'])
  assert.equal(evidenceFile.includedInFrozenSourceFilter, false)
  const governance = byPath.get('docs/integration/evidence/fake.json')
  assert.equal(governance.mapping.kind, 'inferred')
  assert.deepEqual(governance.mapping.featureIds, [])
  const cliFile = byPath.get('packages/cli-runtime/src/thing.mjs')
  assert.equal(cliFile.mapping.kind, 'inferred')
  assert.deepEqual(cliFile.mapping.featureIds, ['F40'])

  assert.deepEqual(document.mappingSummary, { direct: 2, inferred: 3, unknown: 8 })
  assert.deepEqual(document.sourceFilter.includedFiles, ['modify.txt', 'registered/added.txt'])
  assert.equal(document.sourceFilter.excludedCount, 11)
  assert.equal(document.sourceFilter.includedCount, 2)

  // The dirty worktree (post-candidate edits, a removed keep.txt and an untracked file) never enters the object diff.
  assert.ok(!byPath.has('keep.txt'))
  assert.ok(!byPath.has('untracked.txt'))
  assert.equal(byPath.get('modify.txt').added, 2)

  const areas = new Map(document.impactAreas.map(area => [area.area, area]))
  assert.deepEqual(areas.get('config').affectedPaths.sort(), ['.github/workflows/ci.yml', 'server.config.json'])
  assert.deepEqual(areas.get('data').affectedPaths, ['data/ledger.sqlite'])
  assert.deepEqual(areas.get('cli').affectedPaths, ['packages/cli-runtime/src/thing.mjs'])
  assert.deepEqual(areas.get('native').affectedPaths, ['native/hook.ps1'])
  assert.deepEqual(areas.get('platform').affectedPaths, ['.github/workflows/ci.yml'])
  for (const area of document.impactAreas) {
    assert.equal(area.status, 'review-required')
    assert.equal(area.behaviorVerified, false)
  }

  assert.equal(document.decision.effectiveDecision, 'not-included')
  assert.equal(document.decision.userDecision, null)
  assert.equal(document.decision.baselineChangeApproved, false)
  assert.equal(document.decision.behaviorVerified, false)
  assert.equal(document.decision.approvedCommit, null)
  assert.equal(document.behaviorVerified, false)
  assert.ok(document.acceptanceImpact.includes('T61 stays partial'))

  const outputs = (await readdir(result.outputDirectory)).sort()
  assert.deepEqual(outputs, ['manifest.json', 'proposal.json', 'proposal.md'])
  const manifest = JSON.parse(await readFile(join(result.outputDirectory, 'manifest.json'), 'utf8'))
  assert.equal(manifest.decision, 'not-included')
  assert.equal(manifest.mechanicalSha256, document.mechanicalSha256)
  assert.equal(manifest.commits.candidate, fixture.candidateSha)
  for (const output of manifest.outputs) {
    const bytes = await readFile(join(result.outputDirectory, output.path))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), output.sha256)
  }
  const markdown = await readFile(join(result.outputDirectory, 'proposal.md'), 'utf8')
  for (const path of document.files.map(file => file.path)) {
    assert.ok(markdown.includes(path.replaceAll('|', '\\|')), `markdown must list ${path}`)
  }
  assert.ok(markdown.includes('not-included'))
  assert.ok(markdown.includes('登记目录的后代路径'))
  assert.ok(!markdown.includes('direct 仅来自冻结 feature-inventory 精确路径'))

  // Read-only guarantee: fixture and real frozen inputs are byte-identical after the run.
  for (const [name, digest] of docsHashes) {
    assert.equal(createHash('sha256').update(await readFile(join(root, 'docs/integration', name))).digest('hex'), digest)
  }
  assert.deepEqual(await readFile(join(ROOT, 'docs/integration/baseline.json')), realBaselineBefore)
  assert.equal(validateDocument(document), true)
})

test('upstream proposal: candidate equal to the frozen baseline yields a real zero delta', async t => {
  const fixture = await makeSourceRepo(t)
  const root = await makeProductRoot(t, fixture)
  const result = await writeProposal({ ...options(root, fixture, 'tmp/integration/zero'), candidate: fixture.baselineSha })
  const { document } = result
  assert.deepEqual(document.files, [])
  assert.equal(document.relationship.zeroDelta, true)
  assert.equal(document.relationship.candidateEqualsBaseline, true)
  assert.equal(document.relationship.baselineIsAncestorOfCandidate, true)
  assert.equal(document.summary.totalFiles, 0)
  assert.deepEqual(document.mappingSummary, { direct: 0, inferred: 0, unknown: 0 })
  assert.deepEqual(document.sourceFilter.includedFiles, [])
  assert.ok(result.markdown.includes('真实零差分'))
  assert.equal(document.decision.effectiveDecision, 'not-included')
})

test('candidate functional snapshot covers every F from exact baseline/candidate objects, never dirty source', async t => {
  const fixture = await makeSourceRepo(t)
  const root = await makeProductRoot(t, fixture)
  const inventoryPath = join(root, 'docs/integration/feature-inventory.json')
  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'))
  inventory.features.find(row => row.id === 'F01').sources.push({ path: 'delete-me.txt', kind: 'file' })
  inventory.features.find(row => row.id === 'F02').sources = [{ path: 'registered/', kind: 'directory' }]
  await writeFile(inventoryPath, JSON.stringify(inventory))
  const { document, markdown } = await buildProposal(options(root, fixture))
  const snapshot = document.functionalSnapshot
  assert.equal(snapshot.kind, 'candidate-functional-source-snapshot')
  assert.equal(snapshot.sourceRepository, 'MR')
  assert.deepEqual(snapshot.commits, document.commits)
  assert.deepEqual(snapshot.features.map(row => row.id), ['F01', 'F02', 'F03'])
  const one = snapshot.features.find(row => row.id === 'F01')
  assert.equal(one.status, 'candidate-source-reviewed-not-behavior-verified')
  const modified = one.sources.find(row => row.path === 'modify.txt')
  assert.equal(modified.baseline.files[0].gitObject, fixture.modifyBaselineGitBlob)
  assert.equal(modified.candidate.files[0].gitObject, gitBlob(Buffer.from('y\nz\n')))
  assert.equal(modified.candidate.files[0].bytes, 4)
  const deleted = one.sources.find(row => row.path === 'delete-me.txt')
  assert.equal(deleted.baseline.kind, 'file')
  assert.equal(deleted.candidate.kind, 'missing')
  const directory = snapshot.features.find(row => row.id === 'F02').sources[0]
  assert.equal(directory.baseline.kind, 'missing')
  assert.equal(directory.candidate.kind, 'directory')
  assert.deepEqual(directory.candidate.files.map(row => row.path), ['registered/added.txt'])
  const other = snapshot.features.find(row => row.id === 'F03')
  assert.equal(other.status, 'other-source-lock-only-not-observed')
  assert.equal(other.sourceCommit, 'f'.repeat(40))
  assert.equal(other.behaviorVerified, false)
  assert.ok(snapshot.features.every(row => row.behaviorVerified === false))
  assert.equal(snapshot.includesDirtyWorktree, false)
  assert.equal(snapshot.trees.candidate.files, 14)
  assert.ok(markdown.includes(snapshot.sha256))
  assert.ok(markdown.includes('candidate-functional-source-snapshot'))
  await writeFile(join(fixture.repo, 'modify.txt'), 'another dirty current source\n')
  await writeFile(join(root, 'modify.txt'), 'unrelated product worktree\n')
  const repeated = await buildProposal(options(root, fixture))
  assert.deepEqual(repeated.document.functionalSnapshot, snapshot)
  assert.equal(repeated.document.mechanicalSha256, document.mechanicalSha256)
  for (const mutate of [
    row => { row.functionalSnapshot.features.pop() },
    row => { row.functionalSnapshot.features[0].sources[0].candidate.files[0].gitObject = '0'.repeat(40) },
    row => { row.functionalSnapshot.commits.candidate = fixture.baselineSha },
    row => { row.functionalSnapshot.features[0].behaviorVerified = true },
  ]) {
    const tampered = structuredClone(document)
    mutate(tampered)
    assert.throws(() => validateDocument(tampered), /functional snapshot/i)
  }
  for (const mutate of [
    row => { row.features[0].sources[0].candidate.fileCount = -1 },
    row => { row.features[0].sources[0].candidate.files[0].gitObject = 'invalid' },
    row => { row.features[0].sources[0].candidate.files[0].path = 'outside-registration.txt' },
    row => { row.features[0].sources[0].candidate.sha256 = '0'.repeat(64) },
    row => { row.features[0].status = 'other-source-lock-only-not-observed'; row.features[0].sources = [] },
  ]) {
    const snapshot = structuredClone(document.functionalSnapshot)
    mutate(snapshot)
    const { sha256: _digest, ...contents } = snapshot
    snapshot.sha256 = createHash('sha256').update(`${JSON.stringify(contents)}\n`).digest('hex')
    assert.throws(() => validateFunctionalSnapshot(snapshot), /functional snapshot/i)
  }
})

test('candidate functional snapshot uses DS object paths and marks MR-only F40 components unobserved', async t => {
  const fixture = await makeSourceRepo(t)
  const root = await makeProductRoot(t, fixture)
  const baselinePath = join(root, 'docs/integration/baseline.json')
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
  baseline.repositories.DS.commit = fixture.baselineSha
  await writeFile(baselinePath, JSON.stringify(baseline))
  const inventoryPath = join(root, 'docs/integration/feature-inventory.json')
  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'))
  Object.assign(inventory.features.find(row => row.id === 'F03'), {
    commit: fixture.baselineSha, sources: [{ path: 'modify.txt', kind: 'file' }],
  })
  inventory.features.push({ id: 'F40', repository: 'NEW', commit: null, sources: [] })
  await writeFile(inventoryPath, JSON.stringify(inventory))
  const scopePath = join(root, 'docs/integration/scope.json')
  const scope = JSON.parse(await readFile(scopePath, 'utf8'))
  scope.features.push({ id: 'F40', title: 'new components', acceptanceIds: [] })
  await writeFile(scopePath, JSON.stringify(scope))
  const { document } = await buildProposal({ ...options(root, fixture), sourceId: 'ds', repositories: { DS: fixture.repo } })
  const snapshot = document.functionalSnapshot
  assert.equal(snapshot.sourceRepository, 'DS')
  const selected = snapshot.features.find(row => row.id === 'F03')
  assert.equal(selected.sources[0].candidate.files[0].gitObject, gitBlob(Buffer.from('y\nz\n')))
  assert.equal(snapshot.features.find(row => row.id === 'F01').status, 'other-source-lock-only-not-observed')
  assert.equal(snapshot.features.find(row => row.id === 'F40').status, 'other-source-lock-only-not-observed')
  assert.equal(snapshot.features.find(row => row.id === 'F40').sources.length, 0)
})

test('upstream proposal: reruns with different timestamps keep the mechanical diff identical', async t => {
  const fixture = await makeSourceRepo(t)
  const root = await makeProductRoot(t, fixture)
  const first = await buildProposal({ ...options(root, fixture), generatedAt: GENERATED_AT })
  const second = await buildProposal({ ...options(root, fixture), generatedAt: GENERATED_AT_LATER })
  assert.notEqual(first.document.generatedAt, second.document.generatedAt)
  assert.deepEqual(first.document.files, second.document.files)
  assert.equal(first.document.mechanicalSha256, second.document.mechanicalSha256)
  assert.deepEqual(first.document.summary, second.document.summary)
  assert.deepEqual(first.document.mappingSummary, second.document.mappingSummary)

  // Writing twice into the same explicit directory overwrites only the three declared outputs.
  await writeProposal({ ...options(root, fixture, 'tmp/integration/rerun'), generatedAt: GENERATED_AT })
  await writeProposal({ ...options(root, fixture, 'tmp/integration/rerun'), generatedAt: GENERATED_AT_LATER })
  assert.deepEqual((await readdir(join(root, 'tmp/integration/rerun'))).sort(),
    ['manifest.json', 'proposal.json', 'proposal.md'])
  const saved = JSON.parse(await readFile(join(root, 'tmp/integration/rerun/proposal.json'), 'utf8'))
  assert.equal(saved.mechanicalSha256, first.document.mechanicalSha256)
  assert.equal(saved.generatedAt, GENERATED_AT_LATER)
})

test('upstream proposal: argument and provenance validation fail closed', async t => {
  const fixture = await makeSourceRepo(t)
  const root = await makeProductRoot(t, fixture)

  // CLI parsing: HEAD, branches and short SHAs are rejected before any Git access.
  await assert.rejects(async () => parseArgs(['--source', 'mr', '--candidate', 'HEAD', '--output', 'tmp/integration/x']),
    /complete 40-hex/)
  await assert.rejects(async () => parseArgs(['--source', 'mr', '--candidate', fixture.candidateSha.slice(0, 12), '--output', 'tmp/integration/x']),
    /complete 40-hex/)
  await assert.rejects(async () => parseArgs(['--source', 'mr', '--candidate', 'master', '--output', 'tmp/integration/x']),
    /complete 40-hex/)
  await assert.rejects(async () => parseArgs(['--source', 'main', '--candidate', fixture.candidateSha, '--output', 'tmp/integration/x']),
    /Unknown source/)
  await assert.rejects(async () => parseArgs(['--source', 'MR', '--candidate', fixture.candidateSha, '--output', 'tmp/integration/x']),
    /Unknown source/)
  await assert.rejects(async () => parseArgs(['--source', 'mr', '--candidate', fixture.candidateSha]),
    /Missing required options/)
  await assert.rejects(async () => parseArgs(['--source', 'mr', '--candidate', fixture.candidateSha, '--output', 'tmp/integration/x', 'extra']),
    /positional/)
  await assert.rejects(async () => parseArgs(['--source', 'mr', '--candidate', fixture.candidateSha, '--output', 'tmp/integration/x', '--source', 'ds']),
    /Duplicate/)
  assert.deepEqual(parseArgs(['--help']), { help: true })
  const parsed = parseArgs(['--source', 'mr', '--candidate', fixture.candidateSha.toUpperCase(), '--output', 'tmp/integration/x'])
  assert.equal(parsed.candidate, fixture.candidateSha)
  const isolated = parseArgs(['--source', 'mr', '--candidate', fixture.candidateSha, '--output', 'tmp/integration/x',
    '--root', root, '--source-root', fixture.repo])
  assert.equal(isolated.root, root)
  assert.equal(isolated.sourceRoot, fixture.repo)

  // Candidate object must exist locally; no fetch is attempted.
  await assert.rejects(() => buildProposal({ ...options(root, fixture), candidate: '0'.repeat(40) }),
    /not present in the local source repository object database/)
  // Baseline override may only confirm equality with the frozen lock.
  await assert.rejects(() => buildProposal({ ...options(root, fixture), baseline: '1'.repeat(40) }),
    /differs from the frozen MR baseline/)
  const equalBaseline = await buildProposal({ ...options(root, fixture), baseline: fixture.baselineSha })
  assert.equal(equalBaseline.document.commits.baseline, fixture.baselineSha)

  // Output location is restricted to non-link directories under tmp/integration.
  for (const output of ['docs/out', 'tmp/other/x', 'tmp/integration', 'tmp/integration/', 'tmp/integration/../escape',
    'C:/tmp/integration/x', 'tmp\\integration\\x', 'tmp/integration/../integration/x']) {
    await assert.rejects(() => writeProposal({ ...options(root, fixture), output }), Error,
      `output must be rejected: ${output}`)
  }
  await mkdir(join(root, 'tmp/integration/foreign'), { recursive: true })
  await writeFile(join(root, 'tmp/integration/foreign/other.txt'), 'keep me\n')
  await assert.rejects(() => writeProposal({ ...options(root, fixture, 'tmp/integration/foreign') }),
    /unrelated entries/)

  const linkPath = join(root, 'tmp/integration/link-out')
  const realPath = join(root, 'tmp/integration/real-out')
  await mkdir(realPath, { recursive: true })
  let linkCreated = false
  try {
    await symlink(realPath, linkPath, 'junction')
    linkCreated = true
  } catch (error) {
    t.skip(`symbolic link creation is not permitted on this system (${error.code}); skipping the link-escape assertion`)
  }
  if (linkCreated || existsSync(linkPath)) {
    await assert.rejects(() => writeProposal({ ...options(root, fixture, 'tmp/integration/link-out') }),
      /symbolic link|resolves outside/)
  }
})

test('upstream proposal: NUL-stream parsers keep tab and space paths intact without splitting on spaces', () => {
  const nameStatus = parseNameStatusZ(Buffer.from('M\0tab\tname with spaces.txt\0R100\0a\told\0c d\0', 'utf8'))
  assert.deepEqual(nameStatus, [
    { status: 'M', oldPath: null, newPath: 'tab\tname with spaces.txt' },
    { status: 'R100', oldPath: 'a\told', newPath: 'c d' },
  ])
  const numstat = parseNumstatZ(Buffer.from(
    '3\t1\tpath\twith\ttabs\0' + '-\t-\tb.bin\0' + '0\t0\t\0old name\tx\0new name\0', 'utf8'))
  assert.deepEqual(numstat, [
    { added: 3, deleted: 1, oldPath: null, newPath: 'path\twith\ttabs' },
    { added: null, deleted: null, oldPath: null, newPath: 'b.bin' },
    { added: 0, deleted: 0, oldPath: 'old name\tx', newPath: 'new name' },
  ])
  assert.throws(() => parseNameStatusZ(Buffer.from('WHAT\0x\0', 'utf8')), /Malformed name-status/)
  assert.throws(() => parseNumstatZ(Buffer.from('bogus\0', 'utf8')), /Malformed numstat/)
  assert.throws(() => parseNumstatZ(Buffer.from('1\t2\t\0only-one\0', 'utf8')), /Malformed rename\/copy numstat/)
})

function existsSync(path) {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}
