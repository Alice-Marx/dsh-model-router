import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { buildDsManifest, materializeCandidate, parseArgs, selectAffectedRegressions } from '../scripts/integration-upstream-include.mjs'
import { verifyProductSource } from '../scripts/integration-product-source.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const MR_BASELINE = 'de82df4e737954ba0458d597ea82f9a6666c1a9b'
const DS_BASELINE = 'de55888a93983fc51c94f7d22bc94b4f8293205d'
const DS_ROOT = join(ROOT, 'tmp/integration/upstream/ds-bot-frozen')
const LOCKS = [
  'docs/integration/baseline.json',
  'docs/integration/feature-inventory.json',
  'docs/integration/included-increments.json',
]
const REAL_PROTECTED = [
  'docs/integration/baseline.json',
  'docs/integration/feature-inventory.json',
  'modules/bot-runtime/SOURCE.json',
  'pnpm-lock.yaml',
]
const SCRIPTS = [
  'integration-upstream-proposal.mjs',
  'integration-upstream-include.mjs',
  'integration-inventory.mjs',
  'integration-progress.mjs',
  'integration-f-difference.mjs',
]
const EVIDENCE_ROOT = process.env.K44_EVIDENCE_DIR ? resolve(process.env.K44_EVIDENCE_DIR) : null

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function realProtectedHashes() {
  return Object.fromEntries(await Promise.all(REAL_PROTECTED.map(async path => [path, sha256(await readFile(join(ROOT, path)))])))
}

async function isolatedLockBytes(root) {
  return new Map(await Promise.all(LOCKS.map(async path => [path, await readFile(join(root, path))])))
}

function assertLocksEqual(actual, expected) {
  for (const [path, bytes] of expected) assert.deepEqual(actual.get(path), bytes, `${path} must remain byte-identical`)
}

function commandRecord(executable, args, options, result) {
  const stdout = Buffer.from(result.stdout ?? '')
  const stderr = Buffer.from(result.stderr ?? '')
  return {
    executable,
    args,
    cwd: options.cwd,
    shell: false,
    exitCode: result.error ? (typeof result.error.code === 'number' ? result.error.code : null) : 0,
    signal: result.error?.signal ?? null,
    stdout: stdout.toString('utf8'),
    stderr: stderr.toString('utf8'),
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    error: result.error?.message ?? null,
  }
}

async function invoke(fixture, executable, args, options = {}) {
  const result = await new Promise(resolveResult => {
    execFile(executable, args, {
      ...options,
      shell: false,
      windowsHide: true,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    }, (error, stdout, stderr) => resolveResult({ error, stdout, stderr }))
  })
  const record = commandRecord(executable, args, options, result)
  fixture.commands.push(record)
  if (EVIDENCE_ROOT) fixture.commandStreams.push({ stdout: Buffer.from(result.stdout ?? ''), stderr: Buffer.from(result.stderr ?? '') })
  return record
}

async function checked(fixture, executable, args, options = {}) {
  const result = await invoke(fixture, executable, args, options)
  assert.equal(result.exitCode, 0, `${executable} ${args.join(' ')} failed: ${result.stderr}`)
  return result
}

async function cli(fixture, script, args) {
  const before = EVIDENCE_ROOT ? await commandArtifacts(fixture, args) : null
  const result = await invoke(fixture, process.execPath, [join(ROOT, 'scripts', script), ...args], { cwd: fixture.root })
  if (EVIDENCE_ROOT) {
    fixture.commandStreams.at(-1).artifacts = { before, after: await commandArtifacts(fixture, args) }
  }
  return result
}

async function commandArtifacts(fixture, args) {
  const paths = new Set([...LOCKS, 'docs/integration/scope.json', 'docs/integration/tasks.json',
    'modules/bot-runtime/SOURCE.json', 'docs/integration/inclusion-transaction.json',
    'docs/releases/0.26.0-preview.1-f-difference.json', 'docs/releases/0.26.0-preview.1-f-difference.md'])
  for (const flag of ['--proposal', '--approval']) {
    const index = args.indexOf(flag)
    if (index !== -1) paths.add(args[index + 1])
  }
  const outputIndex = args.indexOf('--output')
  if (outputIndex !== -1) {
    for (const name of ['proposal.json', 'proposal.md', 'transaction.json', 'inclusion-result.json',
      'recovery-result.json', 'SOURCE.candidate.json']) paths.add(`${args[outputIndex + 1]}/${name}`)
  }
  const files = new Map(), absent = []
  for (const path of [...paths].sort()) {
    const absolute = resolve(fixture.root, path), local = relative(fixture.root, absolute).replaceAll('\\', '/')
    assert.ok(local && !local.startsWith('../') && local !== '..' && !local.includes(':') &&
      (local.startsWith('docs/integration/') || local.startsWith('docs/releases/') ||
        local.startsWith('tmp/integration/') || local === 'modules/bot-runtime/SOURCE.json'),
    `Only explicit fixture governance/CLI artifacts may be retained: ${path}`)
    try { files.set(local, await readFile(absolute)) }
    catch (error) { if (error.code !== 'ENOENT') throw error; absent.push(local) }
  }
  return { files, absent }
}

async function writeJson(root, path, value) {
  const absolute = join(root, path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`)
}

async function copyInto(root, path) {
  const target = join(root, path)
  await mkdir(dirname(target), { recursive: true })
  await cp(join(ROOT, path), target, { recursive: true })
}

async function persist(fixture, name) {
  if (!EVIDENCE_ROOT) return
  const directory = join(EVIDENCE_ROOT, name)
  await mkdir(directory, { recursive: true })
  await writeJson(directory, 'commands.json', {
    schemaVersion: 1,
    kind: 'k44-isolated-cli-command-evidence',
    baseline: fixture.baseline,
    candidate: fixture.candidate,
    construction: {
      mr: 'git archive of the frozen MR object extracted into a temporary root; copied Git objects only; candidate committed only in that temporary root',
      ds: 'the frozen DS checkout is used read-only for inventory reconstruction; no upstream install or script is run',
      overlays: ['docs', 'modules/bot-runtime', 'registered current MR sources', 'F40 current component paths', 'five integration scripts'],
      dirtyWorktree: 'post-candidate router append and k44-dirty-untracked.txt are deliberately not in the object diff',
    },
    realProtectedBefore: fixture.realProtectedBefore,
    realProtectedAfter: await realProtectedHashes(),
    commands: fixture.commands,
  })
}

async function persistArtifact(fixture, group, source, name) {
  if (!EVIDENCE_ROOT) return
  const directory = join(EVIDENCE_ROOT, group)
  await mkdir(directory, { recursive: true })
  await cp(join(fixture.root, source), join(directory, name))
}

async function evidenceState(fixture, output) {
  const files = new Map(), absent = []
  for (const path of [...LOCKS, 'modules/bot-runtime/SOURCE.json', 'docs/integration/inclusion-transaction.json',
    ...(output ? [`${output}/transaction.json`, `${output}/inclusion-result.json`, `${output}/recovery-result.json`] : [])]) {
    try { files.set(path, await readFile(join(fixture.root, path))) }
    catch (error) { if (error.code !== 'ENOENT') throw error; absent.push(path) }
  }
  const vendor = 'modules/bot-runtime/vendor/ds-bot'
  try {
    for (const [path, bytes] of await directoryBytes(join(fixture.root, vendor))) files.set(`${vendor}/${path}`, bytes)
  } catch (error) { if (error.code !== 'ENOENT') throw error; absent.push(vendor) }
  return { files, absent }
}

async function evidenceCheckpoint(fixture, name, output) {
  if (!EVIDENCE_ROOT) return
  assert.ok(!fixture.checkpoints.has(name), `Duplicate evidence checkpoint: ${name}`)
  fixture.checkpoints.set(name, await evidenceState(fixture, output))
}

async function retainFixture(fixture, testName) {
  if (!EVIDENCE_ROOT) return
  const slug = `${testName.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 72)}-${sha256(Buffer.from(testName)).slice(0, 10)}`
  const parent = join(EVIDENCE_ROOT, 'fixture-bundles')
  await mkdir(parent, { recursive: true })
  const directory = join(parent, slug)
  // Each test owns an exclusive directory; never overwrite an earlier bundle.
  await mkdir(directory)
  const files = []
  const save = async (path, bytes) => {
    assert.ok(!path.split('/').some(part => !part || part === '.' || part === '..' || part === '.git'))
    const target = join(directory, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes, { flag: 'wx' })
    assert.deepEqual(await readFile(target), bytes, `Evidence copy differs: ${path}`)
    files.push({ path, size: bytes.length, sha256: sha256(bytes) })
  }
  const copyTree = async (absolute, path) => {
    const info = await lstat(absolute)
    assert.equal(info.isSymbolicLink(), false, `Evidence link refused: ${path}`)
    if (info.isDirectory()) {
      for (const entry of (await readdir(absolute)).sort()) {
        assert.notEqual(entry, '.git', 'Git metadata must never enter fixture evidence')
        await copyTree(join(absolute, entry), `${path}/${entry}`)
      }
    } else {
      assert.ok(info.isFile(), `Unsupported evidence file: ${path}`)
      await save(path, await readFile(absolute))
    }
  }
  const stateRows = []
  for (const [name, state] of [...fixture.checkpoints, ['final', await evidenceState(fixture)]]) {
    for (const [path, bytes] of state.files) await save(`states/${name}/${path}`, bytes)
    stateRows.push({ name, absent: state.absent, fileCount: state.files.size })
  }
  // Only explicit fixture CLI output; never its copied .git, user home or environment.
  const outputs = join(fixture.root, 'tmp/integration')
  try { await copyTree(outputs, 'cli-output') }
  catch (error) { if (error.code !== 'ENOENT') throw error; stateRows.push({ name: 'cli-output', absent: ['tmp/integration'], fileCount: 0 }) }
  assert.equal(fixture.commandStreams.length, fixture.commands.length)
  const commands = []
  for (const [index, command] of fixture.commands.entries()) {
    const stem = `commands/${String(index + 1).padStart(4, '0')}`
    const streams = fixture.commandStreams[index]
    assert.equal(sha256(streams.stdout), command.stdoutSha256)
    assert.equal(sha256(streams.stderr), command.stderrSha256)
    await save(`${stem}.stdout.log`, streams.stdout)
    await save(`${stem}.stderr.log`, streams.stderr)
    const artifacts = {}
    for (const [phase, state] of Object.entries(streams.artifacts ?? {})) {
      const captured = []
      for (const [path, bytes] of state.files) {
        const retainedPath = `${stem}.${phase}/${path}`
        await save(retainedPath, bytes)
        captured.push({ path, retainedPath, size: bytes.length, sha256: sha256(bytes) })
      }
      artifacts[phase] = { files: captured, absent: state.absent }
    }
    commands.push({ ...command, stdoutPath: `${stem}.stdout.log`, stderrPath: `${stem}.stderr.log`, artifacts })
  }
  await save('commands.json', Buffer.from(`${JSON.stringify({ schemaVersion: 1, commands }, null, 2)}\n`))
  const manifest = {
    schemaVersion: 1, kind: 'bounded-isolated-inclusion-cli-artifacts', testName,
    baseline: { MR: MR_BASELINE, DS: DS_BASELINE }, candidate: { MR: fixture.candidate, DS: fixture.dsCandidate ?? null },
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    realProtectedBefore: fixture.realProtectedBefore, realProtectedAfter: await realProtectedHashes(),
    states: stateRows, commandCount: commands.length, files: files.sort((a, b) => a.path.localeCompare(b.path)),
    limits: 'Local synthetic fixture only; no real upstream adoption, full installed Host, external platform, migration or release acceptance.',
    actualModelCalls: 0, formalAcceptancePromoted: false,
  }
  assert.deepEqual(manifest.realProtectedAfter, manifest.realProtectedBefore)
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
}

async function makeFixture(t, { breakCandidateBehavior = false } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'k44-include-e2e-'))
  const root = join(home, 'project')
  await mkdir(root, { recursive: true })
  const fixture = {
    home,
    root,
    baseline: MR_BASELINE,
    candidate: null,
    commands: [],
    commandStreams: [],
    checkpoints: new Map(),
    realProtectedBefore: await realProtectedHashes(),
  }
  t.after(async () => {
    // On a retention error keep the unique fixture home, and let the failing
    // hook report the error alongside (not instead of) the original test error.
    try { await retainFixture(fixture, t.name) }
    catch (error) { t.diagnostic(`Evidence retention failed; fixture preserved at ${home}: ${error.message}`); throw error }
    await rm(home, { recursive: true, force: true })
  })

  const archive = join(home, 'mr-baseline.tar')
  await checked(fixture, 'git', ['-C', ROOT, 'archive', '--format=tar', `--output=${archive}`, MR_BASELINE], { cwd: home })
  await checked(fixture, 'tar', ['-xf', 'mr-baseline.tar', '-C', root], { cwd: home })
  // A linked worktree has a .git pointer file. Copying that file redirects
  // fixture refs/index writes into the source worktree instead of isolating it.
  // Import only the frozen objects into a fresh, fixture-owned repository.
  await checked(fixture, 'git', ['init', '-q', root], { cwd: home })
  await checked(fixture, 'git', ['-C', root, 'config', 'core.autocrlf', 'false'], { cwd: home })
  await checked(fixture, 'git', ['-C', root, 'fetch', '--no-tags', ROOT, MR_BASELINE], { cwd: home })
  assert.equal((await lstat(join(root, '.git'))).isDirectory(), true, 'Fixture must own its Git directory')
  const fixtureGit = await checked(fixture, 'git', ['-C', root, 'rev-parse', '--absolute-git-dir'], { cwd: home })
  assert.equal(resolve(fixtureGit.stdout.trim()), resolve(root, '.git'), 'Fixture Git must not point at source metadata')
  await checked(fixture, 'git', ['-C', root, 'update-ref', 'refs/heads/k44-fixture', MR_BASELINE], { cwd: root })
  await checked(fixture, 'git', ['-C', root, 'symbolic-ref', 'HEAD', 'refs/heads/k44-fixture'], { cwd: root })
  await checked(fixture, 'git', ['-C', root, 'read-tree', MR_BASELINE], { cwd: root })

  const write = async (path, content) => {
    const absolute = join(root, path)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, content)
  }
  await mkdir(join(root, 'packages/cli-runtime/src/k44/nested'), { recursive: true })
  await write('packages/cli-runtime/src/k44/nested/added.mjs', 'export const k44Nested = true\n')
  await checked(fixture, 'git', ['-C', root, 'mv', 'README.md', 'packages/cli-runtime/src/k44/renamed.md'], { cwd: root })
  await write('packages/cli-runtime/src/k44/binary.bin', Buffer.from([0, 1, 2, 255, 254]))
  const contracts = await readFile(join(ROOT, 'packages/cli-runtime/src/contracts.mjs'), 'utf8')
  await write('packages/cli-runtime/src/contracts.mjs', breakCandidateBehavior
    ? contracts.replace('value >= 0 ? value : null', 'value >= 0 ? value : 0') : contracts)
  await write('k44-unknown.txt', 'reviewer must dispose this unknown file\n')
  await write('config/k44-interface.json', '{"schemaVersion":2,"interface":"fixture-migration-required"}\n')
  await write('data/k44-state.json', '{"schemaVersion":2,"data":"fixture-migration-required"}\n')
  await cp(join(root, '.dsh-plugin/shared/router.mjs'), join(home, 'router.before-candidate.mjs'))
  const router = await readFile(join(root, '.dsh-plugin/shared/router.mjs'), 'utf8')
  await write('.dsh-plugin/shared/router.mjs', `${router}// K44 isolated candidate interface review\n`)
  await checked(fixture, 'git', ['-C', root, 'add', '-A'], { cwd: root })
  await checked(fixture, 'git', [
    '-C', root,
    '-c', 'user.name=K44 Fixture',
    '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false',
    '-c', 'core.autocrlf=false',
    'commit', '-q', '-m', 'K44 isolated non-zero candidate',
  ], { cwd: root })
  fixture.candidate = (await checked(fixture, 'git', ['-C', root, 'rev-parse', 'HEAD'], { cwd: root })).stdout.trim()
  assert.match(fixture.candidate, /^[0-9a-f]{40}$/)
  assert.notEqual(fixture.candidate, MR_BASELINE)

  await copyInto(root, 'docs')
  const board = JSON.parse(await readFile(join(ROOT, 'docs/integration/tasks.json'), 'utf8'))
  const evidencePaths = new Set()
  const collectEvidence = value => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'evidence' && Array.isArray(child)) for (const path of child) evidencePaths.add(path)
      else collectEvidence(child)
    }
  }
  collectEvidence(board)
  for (const path of evidencePaths) {
    if (!path.startsWith('docs/')) await copyInto(root, path)
  }
  await copyInto(root, 'modules/bot-runtime')
  for (const path of [
    'packages/orchestration/src',
    'packages/cli-runtime/src',
    'packages/capability-broker/src',
    'remote-computer-agent/src',
    'native/windows-desktop',
    'deploy/remote-agent',
  ]) await copyInto(root, path)
  const inventory = JSON.parse(await readFile(join(ROOT, 'docs/integration/feature-inventory.json'), 'utf8'))
  for (const feature of inventory.features) {
    if (feature.repository !== 'MR') continue
    for (const source of feature.sources) {
      if (source.kind !== 'directory') await copyInto(root, source.path)
    }
  }
  for (const script of SCRIPTS) await copyInto(root, `scripts/${script}`)
  for (const file of [
    'f23-router-contract.mjs', 'f40-cli-runtime-contract.mjs', 'ds-vendor-contract.mjs',
  ]) await copyInto(root, `tests/fixtures/increment-regressions/${file}`)
  await mkdir(join(root, 'tmp/integration'), { recursive: true })
  await write('.dsh-plugin/shared/router.mjs', `${await readFile(join(root, '.dsh-plugin/shared/router.mjs'), 'utf8')}\n// dirty after candidate; excluded from object diff\n`)
  await write('k44-dirty-untracked.txt', 'untracked after candidate; excluded from object diff\n')
  await evidenceCheckpoint(fixture, 'before-inclusion')
  return fixture
}

test('candidate materialization preserves raw blobs despite CRLF and archive attributes, excluding dirty bytes', async t => {
  const home = await mkdtemp(join(tmpdir(), 'chief-candidate-objects-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const root = join(home, 'source'), target = join(home, 'candidate')
  await mkdir(root)
  const fixture = { commands: [], commandStreams: [] }
  await checked(fixture, 'git', ['init', '-q', root])
  await checked(fixture, 'git', ['-C', root, 'config', 'core.autocrlf', 'true'])
  const files = new Map([
    ['plain.mjs', Buffer.from('export const value = 1\n')],
    [process.platform === 'win32' ? 'space name.txt' : 'space tab\tname.txt', Buffer.from('line one\nline two\n')],
    ['binary.bin', Buffer.from([0, 255, 13, 10, 128])],
    ['ignored.txt', Buffer.from('must still be materialized\n')],
    ['substitute.txt', Buffer.from('$Format:%H$\n')],
    ['.gitattributes', Buffer.from('ignored.txt export-ignore\nsubstitute.txt export-subst\n')],
  ])
  for (const [path, bytes] of files) await writeFile(join(root, path), bytes)
  await checked(fixture, 'git', ['-C', root, 'add', '--', ...files.keys()])
  await checked(fixture, 'git', ['-C', root, '-c', 'user.name=Offline Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-qm', 'isolated candidate objects'])
  const candidate = (await checked(fixture, 'git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim()
  await writeFile(join(root, 'plain.mjs'), 'throw new Error("dirty governance must not execute")\n')
  await writeFile(join(root, 'dirty-only.txt'), 'not a candidate file')
  const result = await materializeCandidate(root, candidate, target)
  assert.equal(result.fileCount, files.size)
  assert.match(result.candidateTreeSha256, /^[0-9a-f]{64}$/)
  for (const [path, bytes] of files) assert.deepEqual(await readFile(join(target, path)), bytes, path)
  await assert.rejects(readFile(join(target, 'dirty-only.txt')), { code: 'ENOENT' })
  await assert.rejects(materializeCandidate(root, candidate, target), /empty non-link/)
})

async function propose(fixture) {
  const result = await cli(fixture, 'integration-upstream-proposal.mjs', [
    '--root', fixture.root,
    '--source-root', fixture.root,
    '--source', 'mr',
    '--candidate', fixture.candidate,
    '--output', 'tmp/integration/proposal',
  ])
  assert.equal(result.exitCode, 0, result.stderr)
  const path = join(fixture.root, 'tmp/integration/proposal/proposal.json')
  const bytes = await readFile(path)
  return { value: JSON.parse(bytes.toString('utf8')), sha256: sha256(bytes) }
}

function approvalFor(proposal) {
  const document = proposal.value
  const fileReviews = document.files.map(file => ({
    path: file.path,
    ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
    disposition: file.mapping.kind === 'unknown' ? 'no-frt-impact' : 'mapping-confirmed',
    reason: file.mapping.kind === 'unknown'
      ? 'K44 reviewer: fixture-only auxiliary/unknown path has no additional F/R/T impact; migration fields are reviewed separately.'
      : `K44 reviewer: confirm ${file.mapping.kind} mapping ${file.mapping.featureIds.join(', ') || 'none'} for this exact candidate.`,
    ...(file.mapping.kind === 'unknown' ? { featureIds: [], requirementIds: [], acceptanceIds: [] } : {}),
  }))
  const rows = (id, kind) => ({ id, status: 'affected', reason: `K44 reviewer: ${kind} impact is bound to candidate ${document.commits.candidate}.` })
  return {
    schemaVersion: 1,
    kind: 'candidate-increment-approval',
    decision: 'include',
    sourceRepository: 'MR',
    commits: { ...document.commits },
    proposal: {
      sha256: proposal.sha256,
      mechanicalSha256: document.mechanicalSha256,
      generator: document.generator,
      inputs: document.inputs.map(input => ({ path: input.path, sha256: input.sha256 })),
    },
    reviewer: { id: 'k44-human-review-fixture', reviewedAt: '2026-11-02T08:00:00.000Z' },
    targetVersion: '0.26.0-preview.2',
    fileReviews,
    featureReviews: document.featureCoverage.map(entry => rows(entry.featureId, 'F')),
    requirementReviews: [...new Set(document.featureCoverage.flatMap(entry => entry.requirementIds))].map(id => rows(id, 'R')),
    acceptanceReviews: [...new Set(document.featureCoverage.flatMap(entry => entry.acceptanceIds))].map(id => rows(id, 'T')),
    migrations: {
      interface: {
        status: 'required',
        reason: 'config/k44-interface.json changes the fixture interface schema and router.mjs needs interface review.',
        plan: 'Migrate schemaVersion 1 fixture calls to schemaVersion 2 before enabling the candidate.',
      },
      data: {
        status: 'required',
        reason: 'data/k44-state.json changes the fixture persisted data shape.',
        plan: 'Export schemaVersion 1 fixture state, transform and verify it as schemaVersion 2 before activation.',
      },
    },
    risks: ['config', 'data', 'cli', 'native', 'platform'].map(area => ({
      area,
      status: area === 'config' || area === 'data' ? 'mitigated' : 'none',
      reason: area === 'config' || area === 'data'
        ? `K44 reviewer: ${area} migration plan and affected F40 regression are mandatory before inclusion.`
        : `K44 reviewer: no ${area} path matched, but behavioral absence is not inferred; explicit review found no additional fixture risk.`,
    })),
    regressionIds: ['F23-router-contract', 'F40-cli-runtime-contract'],
  }
}

async function writeApproval(fixture, name, approval) {
  const path = `tmp/integration/approvals/${name}.json`
  await writeJson(fixture.root, path, approval)
  return path
}

async function directoryBytes(directory, prefix = '') {
  const files = new Map()
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false, entry.name)
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      for (const [child, bytes] of await directoryBytes(join(directory, entry.name), path)) files.set(child, bytes)
    } else files.set(path, await readFile(join(directory, entry.name)))
  }
  return new Map([...files].sort(([a], [b]) => a.localeCompare(b)))
}

async function makeDsFixture(t, { breakCandidateBehavior = false } = {}) {
  const fixture = await makeFixture(t)
  fixture.dsRoot = join(fixture.home, 'ds-source')
  await materializeCandidate(DS_ROOT, DS_BASELINE, fixture.dsRoot)
  await checked(fixture, 'git', ['init', '-q', fixture.dsRoot])
  await checked(fixture, 'git', ['-C', fixture.dsRoot, 'config', 'core.autocrlf', 'false'])
  await checked(fixture, 'git', ['-C', fixture.dsRoot, 'fetch', '--no-tags', DS_ROOT, DS_BASELINE])
  await checked(fixture, 'git', ['-C', fixture.dsRoot, 'update-ref', 'refs/heads/t61-ds-fixture', DS_BASELINE])
  await checked(fixture, 'git', ['-C', fixture.dsRoot, 'symbolic-ref', 'HEAD', 'refs/heads/t61-ds-fixture'])
  await checked(fixture, 'git', ['-C', fixture.dsRoot, 'read-tree', DS_BASELINE])
  const rosterPath = join(fixture.dsRoot, 'ds-bot/src/host/roster.js')
  const roster = await readFile(rosterPath, 'utf8')
  assert.ok(roster.includes('return state.workspaceId'))
  await writeFile(rosterPath, breakCandidateBehavior
    ? roster.replace('return state.workspaceId', 'return "broken-candidate-workspace"')
    : `${roster}\n// DS candidate behavior-preserving fixture change\n`)
  await writeFile(join(fixture.dsRoot, 'ds-bot/t61-added.bin'), Buffer.from([0, 255, 13, 10, 128]))
  await rm(join(fixture.dsRoot, 'ds-bot/README.md'))
  await checked(fixture, 'git', ['-C', fixture.dsRoot, 'add', '--', 'ds-bot/src/host/roster.js', 'ds-bot/t61-added.bin', 'ds-bot/README.md'])
  await checked(fixture, 'git', ['-C', fixture.dsRoot, '-c', 'user.name=T61 Offline Fixture',
    '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'DS isolated add change delete candidate'])
  fixture.dsCandidate = (await checked(fixture, 'git', ['-C', fixture.dsRoot, 'rev-parse', 'HEAD'])).stdout.trim()
  fixture.sourceBefore = await readFile(join(fixture.root, 'modules/bot-runtime/SOURCE.json'))
  fixture.manifestAfter = await buildDsManifest(fixture.dsRoot, JSON.parse(fixture.sourceBefore), fixture.dsCandidate)
  fixture.sourceAfter = Buffer.from(`${JSON.stringify(fixture.manifestAfter, null, 2)}\n`)
  // Candidate governance must ignore dirty working-tree bytes, including executable DS source.
  await writeFile(rosterPath, 'throw new Error("dirty DS worktree must never execute")\n')
  await writeFile(join(fixture.dsRoot, 'ds-bot/dirty-only.txt'), 'not in candidate\n')
  return fixture
}

async function proposeDs(fixture) {
  const result = await cli(fixture, 'integration-upstream-proposal.mjs', ['--root', fixture.root,
    '--source-root', fixture.dsRoot, '--source', 'ds', '--candidate', fixture.dsCandidate,
    '--output', 'tmp/integration/ds-proposal'])
  assert.equal(result.exitCode, 0, result.stderr)
  const bytes = await readFile(join(fixture.root, 'tmp/integration/ds-proposal/proposal.json'))
  return { value: JSON.parse(bytes), sha256: sha256(bytes) }
}

function dsApprovalFor(fixture, proposal) {
  return { ...approvalFor(proposal), sourceRepository: 'DS', regressionIds: ['DS-vendor-contract'],
    migrations: Object.fromEntries(['interface', 'data'].map(kind => [kind,
      { status: 'none', reason: `Offline DS candidate preserves the ${kind} contract; behavior regression remains mandatory.` }])),
    dsMigration: { status: 'required', reason: 'Publish exact candidate DS vendor and SOURCE with add/change/delete.',
      plan: 'Stage raw Git objects, bind both manifests, run roster behavior, publish atomically under marker; restore original bytes on failure.',
      vendorSource: 'candidate',
      before: { manifestSha256: sha256(fixture.sourceBefore), fileCount: JSON.parse(fixture.sourceBefore).files.length },
      after: { manifestSha256: sha256(fixture.sourceAfter), fileCount: fixture.manifestAfter.files.length } } }
}

function dsIncludeArgs(fixture, approval, output) {
  return ['--root', fixture.root, '--source-root', fixture.dsRoot, '--mr-root', fixture.root,
    '--ds-root', fixture.dsRoot, '--source', 'ds', '--candidate', fixture.dsCandidate,
    '--proposal', 'tmp/integration/ds-proposal/proposal.json', '--approval', approval, '--output', output]
}

test('DS include CLI: exact candidate add/change/delete publishes vendor SOURCE and locks while retaining original bytes', async t => {
  const fixture = await makeDsFixture(t), proposal = await proposeDs(fixture)
  const vendor = join(fixture.root, 'modules/bot-runtime/vendor/ds-bot'), beforeVendor = await directoryBytes(vendor)
  const approval = await writeApproval(fixture, 'ds-valid', dsApprovalFor(fixture, proposal))
  const output = 'tmp/integration/ds-include-valid'
  const included = await cli(fixture, 'integration-upstream-include.mjs', dsIncludeArgs(fixture, approval, output))
  assert.equal(included.exitCode, 0, included.stderr)
  const result = JSON.parse(await readFile(join(fixture.root, output, 'inclusion-result.json')))
  assert.equal(result.status, 'included')
  assert.deepEqual(result.dsMigration.added, ['vendor/ds-bot/t61-added.bin'])
  assert.deepEqual(result.functionalSnapshot, proposal.value.functionalSnapshot)
  assert.equal(result.functionalSnapshot.features.length, 40)
  assert.equal(result.functionalSnapshot.sourceRepository, 'DS')
  assert.equal(result.functionalSnapshot.features.find(row => row.id === 'F40').status, 'other-source-lock-only-not-observed')
  assert.deepEqual(result.dsMigration.deleted, ['vendor/ds-bot/README.md'])
  assert.equal(result.regressions.length, 1)
  assert.equal(result.regressions[0].id, 'DS-vendor-contract')
  assert.equal(result.regressions[0].status, 'passed')
  assert.equal(result.regressions[0].exitCode, 0)
  assert.deepEqual(await readFile(join(fixture.root, 'modules/bot-runtime/SOURCE.json')), fixture.sourceAfter)
  const sourceRoot = join(fixture.root, 'modules/bot-runtime')
  assert.equal((await verifyProductSource(sourceRoot)).frozenCommit, fixture.dsCandidate)
  const tampered = structuredClone(fixture.manifestAfter)
  tampered.license = 'unapproved-metadata'
  await writeJson(fixture.root, 'modules/bot-runtime/SOURCE.json', tampered)
  await assert.rejects(verifyProductSource(sourceRoot), /approved after-manifest/)
  await writeFile(join(sourceRoot, 'SOURCE.json'), fixture.sourceAfter)
  const candidateFile = join(vendor, 't61-added.bin'), candidateBytes = await readFile(candidateFile)
  await writeFile(candidateFile, Buffer.from('tampered vendor'))
  await assert.rejects(verifyProductSource(sourceRoot), /Frozen source changed/)
  await writeFile(candidateFile, candidateBytes)
  await writeFile(join(vendor, 'unapproved.txt'), 'extra vendor')
  await assert.rejects(verifyProductSource(sourceRoot), /Untracked vendor file/)
  await rm(join(vendor, 'unapproved.txt'))
  const originalLedger = await readFile(join(fixture.root, LOCKS[2]))
  const badLedger = JSON.parse(originalLedger)
  badLedger.increments[0].status = 'regression-pending'
  await writeJson(fixture.root, LOCKS[2], badLedger)
  await assert.rejects(verifyProductSource(sourceRoot), /only increments with passed/)
  await writeFile(join(fixture.root, LOCKS[2]), originalLedger)
  assert.equal((await verifyProductSource(sourceRoot)).files, fixture.manifestAfter.files.length)
  const published = await directoryBytes(vendor)
  assert.equal(published.size, fixture.manifestAfter.files.length)
  for (const file of fixture.manifestAfter.files) assert.equal(sha256(published.get(file.path.slice('vendor/ds-bot/'.length))), file.sha256)
  assert.equal(published.has('README.md'), false)
  assert.equal(published.has('dirty-only.txt'), false)
  assert.deepEqual(await directoryBytes(join(fixture.root, output, 'ds-vendor-original')), beforeVendor)
  assert.deepEqual(await readFile(join(fixture.root, output, 'originals/modules/bot-runtime/SOURCE.json')), fixture.sourceBefore)
  const baseline = JSON.parse(await readFile(join(fixture.root, LOCKS[0])))
  const inventory = JSON.parse(await readFile(join(fixture.root, LOCKS[1])))
  const ledger = JSON.parse(await readFile(join(fixture.root, LOCKS[2])))
  assert.equal(baseline.repositories.DS.commit, fixture.dsCandidate)
  assert.equal(baseline.repositories.MR.commit, MR_BASELINE)
  assert.equal(inventory.baseline.DS, fixture.dsCandidate)
  assert.ok(inventory.features.filter(item => item.repository === 'DS').every(item => item.commit === fixture.dsCandidate))
  assert.equal(ledger.increments[0].sourceRepository, 'DS')
  assert.deepEqual(ledger.increments[0].functionalSnapshot, result.functionalSnapshot)
  assert.deepEqual(ledger.increments[0].review.dsMigration, result.review.dsMigration)
  await assert.rejects(readFile(join(fixture.root, 'docs/integration/inclusion-transaction.json')), { code: 'ENOENT' })
  for (const [script, args] of [
    ['integration-progress.mjs', ['--root', fixture.root, 'check']],
    ['integration-inventory.mjs', ['--root', fixture.root, '--mr-root', fixture.root, '--ds-root', fixture.dsRoot, '--write']],
    ['integration-f-difference.mjs', ['--root', fixture.root, '--write']],
    ['integration-f-difference.mjs', ['--root', fixture.root, '--check']],
  ]) {
    const gate = await cli(fixture, script, args)
    assert.equal(gate.exitCode, 0, `${script}: ${gate.stderr}`)
  }
  assert.deepEqual(await realProtectedHashes(), fixture.realProtectedBefore)
})

test('DS include CLI: missing or stale manifest bindings reject without changing any lock SOURCE or vendor bytes', async t => {
  const fixture = await makeDsFixture(t), proposal = await proposeDs(fixture), valid = dsApprovalFor(fixture, proposal)
  const vendor = join(fixture.root, 'modules/bot-runtime/vendor/ds-bot'), beforeVendor = await directoryBytes(vendor)
  const beforeLocks = await isolatedLockBytes(fixture.root)
  const cases = [
    ['missing', { ...valid, dsMigration: undefined }],
    ['stale-before', { ...valid, dsMigration: { ...valid.dsMigration, before: { ...valid.dsMigration.before, manifestSha256: '0'.repeat(64) } } }],
    ['stale-after', { ...valid, dsMigration: { ...valid.dsMigration, after: { ...valid.dsMigration.after, manifestSha256: '1'.repeat(64) } } }],
    ['wrong-count', { ...valid, dsMigration: { ...valid.dsMigration, after: { ...valid.dsMigration.after, fileCount: valid.dsMigration.after.fileCount + 1 } } }],
  ]
  for (const [name, document] of cases) {
    const approval = await writeApproval(fixture, `ds-${name}`, document)
    const rejected = await cli(fixture, 'integration-upstream-include.mjs', dsIncludeArgs(fixture, approval, `tmp/integration/ds-rejected-${name}`))
    assert.notEqual(rejected.exitCode, 0, name)
    assert.match(rejected.stderr, /dsMigration|manifest binding is stale/)
    assertLocksEqual(await isolatedLockBytes(fixture.root), beforeLocks)
    assert.deepEqual(await readFile(join(fixture.root, 'modules/bot-runtime/SOURCE.json')), fixture.sourceBefore)
    assert.deepEqual(await directoryBytes(vendor), beforeVendor)
    await assert.rejects(readFile(join(fixture.root, 'docs/integration/inclusion-transaction.json')), { code: 'ENOENT' })
  }
  assert.deepEqual(await realProtectedHashes(), fixture.realProtectedBefore)
})

test('DS include CLI: candidate behavior failure retains staged candidate and restores original SOURCE vendor and all locks', async t => {
  const fixture = await makeDsFixture(t, { breakCandidateBehavior: true }), proposal = await proposeDs(fixture)
  const beforeLocks = await isolatedLockBytes(fixture.root)
  const vendor = join(fixture.root, 'modules/bot-runtime/vendor/ds-bot'), beforeVendor = await directoryBytes(vendor)
  const approval = await writeApproval(fixture, 'ds-bad-behavior', dsApprovalFor(fixture, proposal)), output = 'tmp/integration/ds-behavior-failed'
  const rejected = await cli(fixture, 'integration-upstream-include.mjs', dsIncludeArgs(fixture, approval, output))
  assert.notEqual(rejected.exitCode, 0)
  assert.match(rejected.stderr, /Affected regression failed: DS-vendor-contract/)
  const result = JSON.parse(await readFile(join(fixture.root, output, 'inclusion-result.json')))
  assert.equal(result.status, 'failed')
  assert.equal(result.recovery, 'rolled-back')
  assert.equal(result.regressions[0].status, 'failed')
  assert.notEqual(result.regressions[0].exitCode, 0)
  assert.equal(JSON.parse(await readFile(join(fixture.root, output, 'transaction.json'))).state, 'failed-rolled-back')
  assertLocksEqual(await isolatedLockBytes(fixture.root), beforeLocks)
  assert.deepEqual(await readFile(join(fixture.root, 'modules/bot-runtime/SOURCE.json')), fixture.sourceBefore)
  assert.deepEqual(await directoryBytes(vendor), beforeVendor)
  assert.match(await readFile(join(fixture.root, output, 'ds-vendor-candidate/src/host/roster.js'), 'utf8'), /broken-candidate-workspace/)
  assert.deepEqual(await realProtectedHashes(), fixture.realProtectedBefore)
})

async function interruptedInclude(fixture, approval, output, point, action = 'crash') {
  const path = `tmp/integration/interruption-${point}-${action}.json`
  await writeJson(fixture.root, path, { point, action, options: { root: fixture.root, sourceId: 'ds',
    sourceRoot: fixture.dsRoot, mrRoot: fixture.root, dsRoot: fixture.dsRoot, candidate: fixture.dsCandidate,
    proposal: 'tmp/integration/ds-proposal/proposal.json', approval, output } })
  return invoke(fixture, process.execPath, [join(ROOT, 'tests/fixtures/inclusion-transaction-crash.mjs'), join(fixture.root, path)], { cwd: fixture.root })
}

async function assertNormalGatesBlocked(fixture) {
  for (const [script, args] of [
    ['integration-progress.mjs', ['--root', fixture.root, 'check']],
    ['integration-inventory.mjs', ['--root', fixture.root, '--mr-root', fixture.root, '--ds-root', fixture.dsRoot ?? DS_ROOT]],
    ['integration-f-difference.mjs', ['--root', fixture.root]],
  ]) {
    const gate = await cli(fixture, script, args)
    assert.notEqual(gate.exitCode, 0, script)
    assert.match(gate.stderr, /requires bounded recovery inspection/)
  }
  await assert.rejects(verifyProductSource(join(fixture.root, 'modules/bot-runtime')), /requires bounded recovery inspection/)
}

test('DS include CLI: partial publication exceptions restore every original byte and retain the failed candidate', async t => {
  const fixture = await makeDsFixture(t), proposal = await proposeDs(fixture)
  const approval = await writeApproval(fixture, 'ds-partial', dsApprovalFor(fixture, proposal))
  const beforeLocks = await isolatedLockBytes(fixture.root)
  const vendor = join(fixture.root, 'modules/bot-runtime/vendor/ds-bot'), beforeVendor = await directoryBytes(vendor)
  for (const point of ['vendor-original-moved', 'vendor-published', 'source-published', 'baseline-published', 'inventory-published', 'ledger-published']) {
    const output = `tmp/integration/ds-partial-${point}`
    const failed = await interruptedInclude(fixture, approval, output, point, 'throw')
    assert.notEqual(failed.exitCode, 0)
    assert.match(failed.stderr, /INCLUSION_TEST_PARTIAL_WRITE/)
    const result = JSON.parse(await readFile(join(fixture.root, output, 'inclusion-result.json')))
    assert.equal(result.recovery, 'rolled-back')
    await evidenceCheckpoint(fixture, `exception-${point}`, output)
    assertLocksEqual(await isolatedLockBytes(fixture.root), beforeLocks)
    assert.deepEqual(await readFile(join(fixture.root, 'modules/bot-runtime/SOURCE.json')), fixture.sourceBefore)
    assert.deepEqual(await directoryBytes(vendor), beforeVendor)
    if (point !== 'vendor-original-moved') {
      const failedCandidate = await directoryBytes(join(fixture.root, output, 'ds-vendor-failed'))
      assert.equal(failedCandidate.has('t61-added.bin'), true)
      assert.equal(failedCandidate.has('README.md'), false)
    }
    await assert.rejects(readFile(join(fixture.root, 'docs/integration/inclusion-transaction.json')), { code: 'ENOENT' })
  }
  assert.deepEqual(await realProtectedHashes(), fixture.realProtectedBefore)
})

test('DS include CLI: hard process exits block normal gates until explicit marker-bound recovery restores original bytes', async t => {
  const fixture = await makeDsFixture(t), proposal = await proposeDs(fixture)
  const approval = await writeApproval(fixture, 'ds-crash', dsApprovalFor(fixture, proposal))
  const beforeLocks = await isolatedLockBytes(fixture.root)
  const vendor = join(fixture.root, 'modules/bot-runtime/vendor/ds-bot'), beforeVendor = await directoryBytes(vendor)
  for (const point of ['candidate-staged', 'vendor-original-moved', 'vendor-published', 'source-published', 'baseline-published', 'inventory-published', 'ledger-published']) {
    const output = `tmp/integration/ds-crash-${point}`
    const crashed = await interruptedInclude(fixture, approval, output, point)
    assert.equal(crashed.exitCode, 86, crashed.stderr)
    const marker = await readFile(join(fixture.root, 'docs/integration/inclusion-transaction.json'))
    await evidenceCheckpoint(fixture, `crash-${point}-before-recovery`, output)
    await assertNormalGatesBlocked(fixture)
    const reinclusion = await cli(fixture, 'integration-upstream-include.mjs', dsIncludeArgs(fixture, approval, `tmp/integration/ds-retry-${point}`))
    assert.notEqual(reinclusion.exitCode, 0)
    assert.match(reinclusion.stderr, /requires bounded recovery inspection/)
    const args = ['--root', fixture.root, '--output', output, '--marker-sha256', sha256(marker), '--reason', `Offline crash recovery at ${point}`]
    if (point === 'baseline-published') {
      const beforePartial = await isolatedLockBytes(fixture.root)
      const stale = [...args]; stale[stale.indexOf('--marker-sha256') + 1] = '0'.repeat(64)
      const rejected = await cli(fixture, 'integration-upstream-recover.mjs', stale)
      assert.notEqual(rejected.exitCode, 0)
      assert.match(rejected.stderr, /marker binding is stale/)
      await evidenceCheckpoint(fixture, `crash-${point}-stale-marker-rejected`, output)
      const currentBaseline = await readFile(join(fixture.root, LOCKS[0]))
      await writeFile(join(fixture.root, LOCKS[0]), 'unrelated user bytes\n')
      const unrelated = await cli(fixture, 'integration-upstream-recover.mjs', args)
      assert.notEqual(unrelated.exitCode, 0)
      assert.match(unrelated.stderr, /unrelated current bytes/)
      assert.equal(await readFile(join(fixture.root, LOCKS[0]), 'utf8'), 'unrelated user bytes\n')
      await evidenceCheckpoint(fixture, `crash-${point}-unrelated-bytes-rejected`, output)
      await writeFile(join(fixture.root, LOCKS[0]), currentBaseline)
      assertLocksEqual(await isolatedLockBytes(fixture.root), beforePartial)
      assert.deepEqual(await readFile(join(fixture.root, 'docs/integration/inclusion-transaction.json')), marker)
    }
    const recovered = await cli(fixture, 'integration-upstream-recover.mjs', args)
    assert.equal(recovered.exitCode, 0, `${point}: ${recovered.stderr}`)
    assert.equal(JSON.parse(await readFile(join(fixture.root, output, 'recovery-result.json'))).status, 'rolled-back')
    assertLocksEqual(await isolatedLockBytes(fixture.root), beforeLocks)
    assert.deepEqual(await readFile(join(fixture.root, 'modules/bot-runtime/SOURCE.json')), fixture.sourceBefore)
    assert.deepEqual(await directoryBytes(vendor), beforeVendor)
    assert.equal((await verifyProductSource(join(fixture.root, 'modules/bot-runtime'))).frozenCommit, DS_BASELINE)
    const gate = await cli(fixture, 'integration-progress.mjs', ['--root', fixture.root, 'check'])
    assert.equal(gate.exitCode, 0, gate.stderr)
    await assert.rejects(readFile(join(fixture.root, 'docs/integration/inclusion-transaction.json')), { code: 'ENOENT' })
    await evidenceCheckpoint(fixture, `crash-${point}-after-recovery`, output)
  }
  assert.deepEqual(await realProtectedHashes(), fixture.realProtectedBefore)
})

test('normal entry points reject malformed and recovery-required markers without changing locked bytes', async t => {
  const fixture = await makeFixture(t), before = await isolatedLockBytes(fixture.root)
  const marker = join(fixture.root, 'docs/integration/inclusion-transaction.json')
  for (const bytes of ['{malformed', JSON.stringify({ state: 'recovery-required' }), JSON.stringify({ state: 'completed' })]) {
    await writeFile(marker, bytes)
    await assertNormalGatesBlocked(fixture)
    assertLocksEqual(await isolatedLockBytes(fixture.root), before)
    assert.equal(await readFile(marker, 'utf8'), bytes)
  }
  await rm(marker)
  assert.deepEqual(await realProtectedHashes(), fixture.realProtectedBefore)
})

for (const fault of ['rollback-write', 'recovery-write']) {
  test(`DS include CLI: ${fault} failure keeps gates blocked and a new marker-bound recovery restores original bytes`, async t => {
    const fixture = await makeDsFixture(t), proposal = await proposeDs(fixture)
    const approval = await writeApproval(fixture, fault, dsApprovalFor(fixture, proposal))
    const output = `tmp/integration/ds-${fault}-failure`
    const beforeLocks = await isolatedLockBytes(fixture.root)
    const vendor = join(fixture.root, 'modules/bot-runtime/vendor/ds-bot'), beforeVendor = await directoryBytes(vendor)
    const failed = await interruptedInclude(fixture, approval, output, 'baseline-published',
      fault === 'rollback-write' ? 'rollback-write-failure' : 'crash')
    if (fault === 'rollback-write') {
      assert.notEqual(failed.exitCode, 0)
      assert.match(failed.stderr, /INCLUSION_TEST_ROLLBACK_WRITE/)
      const result = JSON.parse(await readFile(join(fixture.root, output, 'inclusion-result.json')))
      assert.equal(result.status, 'failed')
      assert.equal(result.recovery, 'recovery-required')
      assert.match(result.recoveryError, /EEXIST/)
    } else {
      assert.equal(failed.exitCode, 86)
      await evidenceCheckpoint(fixture, `${fault}-before-failed-recovery`, output)
      const marker = await readFile(join(fixture.root, 'docs/integration/inclusion-transaction.json'))
      const payload = `tmp/integration/${fault}-payload.json`
      await writeJson(fixture.root, payload, { root: fixture.root, output, markerSha256: sha256(marker), reason: 'Offline recovery write failure fixture' })
      const recovery = await invoke(fixture, process.execPath,
        [join(ROOT, 'tests/fixtures/inclusion-recovery-write-failure.mjs'), join(fixture.root, payload)], { cwd: fixture.root })
      assert.notEqual(recovery.exitCode, 0)
      assert.match(recovery.stderr, /EEXIST/)
      await assert.rejects(readFile(join(fixture.root, output, 'recovery-result.json')), { code: 'ENOENT' })
      await assert.rejects(readFile(join(fixture.root, output, 'recovery.lock')), { code: 'ENOENT' })
    }
    const markerPath = join(fixture.root, 'docs/integration/inclusion-transaction.json')
    const marker = await readFile(markerPath), transaction = JSON.parse(await readFile(join(fixture.root, output, 'transaction.json')))
    assert.equal(JSON.parse(marker).state, 'recovery-required')
    assert.equal(transaction.state, 'recovery-required')
    assert.match(transaction.recoveryError, /EEXIST/)
    await evidenceCheckpoint(fixture, `${fault}-failed-blocked`, output)
    await assertNormalGatesBlocked(fixture)
    const faultRecord = JSON.parse(await readFile(join(fixture.root, output, 'write-fault.json')))
    assert.ok(faultRecord.obstruction.startsWith(`${join(fixture.root, 'docs/integration')}`))
    assert.equal((await readdir(faultRecord.obstruction)).length, 0)
    await rmdir(faultRecord.obstruction)
    const recovered = await cli(fixture, 'integration-upstream-recover.mjs', [
      '--root', fixture.root, '--output', output, '--marker-sha256', sha256(marker),
      '--reason', `Retry after removing isolated ${fault} collision`,
    ])
    assert.equal(recovered.exitCode, 0, recovered.stderr)
    assert.equal(JSON.parse(await readFile(join(fixture.root, output, 'recovery-result.json'))).status, 'rolled-back')
    assertLocksEqual(await isolatedLockBytes(fixture.root), beforeLocks)
    assert.deepEqual(await readFile(join(fixture.root, 'modules/bot-runtime/SOURCE.json')), fixture.sourceBefore)
    assert.deepEqual(await directoryBytes(vendor), beforeVendor)
    assert.equal((await verifyProductSource(join(fixture.root, 'modules/bot-runtime'))).frozenCommit, DS_BASELINE)
    const gate = await cli(fixture, 'integration-progress.mjs', ['--root', fixture.root, 'check'])
    assert.equal(gate.exitCode, 0, gate.stderr)
    await assert.rejects(readFile(markerPath), { code: 'ENOENT' })
    await evidenceCheckpoint(fixture, `${fault}-after-recovery`, output)
    assert.deepEqual(await realProtectedHashes(), fixture.realProtectedBefore)
  })
}

function includeArgs(fixture, approvalPath, output, candidate = fixture.candidate) {
  return [
    '--root', fixture.root,
    '--source-root', fixture.root,
    '--mr-root', fixture.root,
    '--ds-root', DS_ROOT,
    '--source', 'mr',
    '--candidate', candidate,
    '--proposal', 'tmp/integration/proposal/proposal.json',
    '--approval', approvalPath,
    '--output', output,
  ]
}

test('include CLI: missing/stale/unresolved/incomplete approvals and wrong candidate leave every isolated lock byte-identical', async t => {
  const fixture = await makeFixture(t)
  const proposal = await propose(fixture)
  const valid = approvalFor(proposal)
  const before = await isolatedLockBytes(fixture.root)
  const cases = [
    ['missing-approval', 'tmp/integration/approvals/does-not-exist.json'],
    ['wrong-candidate', await writeApproval(fixture, 'wrong-candidate', valid), MR_BASELINE],
    ['stale-proposal-hash', await writeApproval(fixture, 'stale-proposal-hash', {
      ...valid, proposal: { ...valid.proposal, sha256: '0'.repeat(64) },
    })],
    ['approval-candidate-mismatch', await writeApproval(fixture, 'approval-candidate-mismatch', {
      ...valid, commits: { ...valid.commits, candidate: MR_BASELINE },
    })],
    ['unknown-unresolved', await writeApproval(fixture, 'unknown-unresolved', {
      ...valid, fileReviews: valid.fileReviews.filter(review => review.path !== 'k44-unknown.txt'),
    })],
    ['migration-missing', await writeApproval(fixture, 'migration-missing', {
      ...valid, migrations: { data: valid.migrations.data },
    })],
    ['target-version-missing', await writeApproval(fixture, 'target-version-missing', { ...valid, targetVersion: '' })],
    ['not-explicit-include', await writeApproval(fixture, 'not-explicit-include', { ...valid, decision: 'review-only' })],
    ['stale-generator', await writeApproval(fixture, 'stale-generator', {
      ...valid, proposal: { ...valid.proposal, generator: { ...valid.proposal.generator, sha256: '0'.repeat(64) } },
    })],
    ['stale-mechanical', await writeApproval(fixture, 'stale-mechanical', {
      ...valid, proposal: { ...valid.proposal, mechanicalSha256: '1'.repeat(64) },
    })],
    ...await Promise.all(valid.proposal.inputs.map(async (_input, inputIndex) => {
      const name = `stale-source-input-${inputIndex}`
      return [name, await writeApproval(fixture, name, { ...valid,
        proposal: { ...valid.proposal, inputs: valid.proposal.inputs.map((input, index) =>
          index === inputIndex ? { ...input, sha256: '2'.repeat(64) } : input) },
      })]
    })),
  ]
  for (const [name, approvalPath, candidate = fixture.candidate] of cases) {
    const result = await cli(fixture, 'integration-upstream-include.mjs',
      includeArgs(fixture, approvalPath, `tmp/integration/include-${name}`, candidate))
    assert.notEqual(result.exitCode, 0, `${name} unexpectedly included`)
    assertLocksEqual(await isolatedLockBytes(fixture.root), before)
  }
  assert.deepEqual(await realProtectedHashes(), fixture.realProtectedBefore)
  await persist(fixture, 'negative-approvals')
})

test('include CLI: valid explicit inclusion runs affected regression, rebuilds locks, compares release and rejects later manual drift', async t => {
  const fixture = await makeFixture(t)
  const sourceBefore = await readFile(join(fixture.root, 'modules/bot-runtime/SOURCE.json'))
  const vendorBefore = await directoryBytes(join(fixture.root, 'modules/bot-runtime/vendor/ds-bot'))
  const proposal = await propose(fixture)
  const document = proposal.value
  const files = new Map(document.files.map(file => [file.path, file]))
  assert.equal(document.commits.baseline, MR_BASELINE)
  assert.equal(document.commits.candidate, fixture.candidate)
  assert.equal(document.relationship.zeroDelta, false)
  assert.equal(files.get('packages/cli-runtime/src/k44/nested/added.mjs').mapping.featureIds[0], 'F40')
  assert.equal(files.get('packages/cli-runtime/src/k44/renamed.md').change, 'renamed')
  assert.equal(files.get('packages/cli-runtime/src/k44/renamed.md').oldPath, 'README.md')
  assert.equal(files.get('packages/cli-runtime/src/k44/renamed.md').mapping.featureIds[0], 'F40')
  assert.equal(files.get('packages/cli-runtime/src/k44/binary.bin').binary, true)
  assert.equal(files.get('k44-unknown.txt').mapping.kind, 'unknown')
  assert.equal(files.get('.dsh-plugin/shared/router.mjs').added, 1)
  assert.equal(files.has('k44-dirty-untracked.txt'), false)
  assert.ok(document.featureCoverage.some(entry => entry.featureId === 'F23'))
  assert.ok(document.featureCoverage.some(entry => entry.featureId === 'F40'))
  assert.deepEqual(selectAffectedRegressions(document).map(entry => entry.id),
    ['F23-router-contract', 'F40-cli-runtime-contract'])

  const approval = approvalFor(document ? proposal : null)
  const approvalPath = await writeApproval(fixture, 'valid', approval)
  const before = await isolatedLockBytes(fixture.root)
  const included = await cli(fixture, 'integration-upstream-include.mjs', includeArgs(fixture, approvalPath, 'tmp/integration/include-valid'))
  assert.equal(included.exitCode, 0, included.stderr)
  assert.deepEqual(await readFile(join(fixture.root, 'modules/bot-runtime/SOURCE.json')), sourceBefore)
  assert.deepEqual(await directoryBytes(join(fixture.root, 'modules/bot-runtime/vendor/ds-bot')), vendorBefore)
  assert.equal((await verifyProductSource(join(fixture.root, 'modules/bot-runtime'))).frozenCommit, DS_BASELINE)
  const result = JSON.parse(await readFile(join(fixture.root, 'tmp/integration/include-valid/inclusion-result.json'), 'utf8'))
  assert.equal(result.status, 'included')
  assert.equal(result.commits.baseline, MR_BASELINE)
  assert.equal(result.commits.candidate, fixture.candidate)
  assert.equal(result.targetVersion, '0.26.0-preview.2')
  assert.equal(result.review.migrations.interface.status, 'required')
  assert.equal(result.review.migrations.data.status, 'required')
  assert.equal(result.review.risks.length, 5)
  assert.equal(result.regressions.length, 2)
  assert.deepEqual(result.regressions.map(regression => regression.id),
    ['F23-router-contract', 'F40-cli-runtime-contract'])
  assert.ok(result.effectiveImpact.features.includes('F23') && result.effectiveImpact.features.includes('F40'))
  assert.equal(result.effectiveImpact.behaviorVerified, false)
  assert.deepEqual(result.functionalSnapshot, document.functionalSnapshot)
  assert.equal(result.functionalSnapshot.features.length, 40)
  const newComponents = result.functionalSnapshot.features.find(row => row.id === 'F40')
  assert.equal(newComponents.status, 'candidate-source-reviewed-not-behavior-verified')
  assert.ok(newComponents.sources.some(row => row.candidate.files.some(file => file.path.endsWith('/binary.bin'))))
  assert.ok(result.functionalSnapshot.features.every(row => row.behaviorVerified === false))
  for (const regression of result.regressions) {
    assert.equal(regression.status, 'passed')
    assert.equal(regression.exitCode, 0)
    assert.equal(regression.command.shell, false)
    assert.equal(regression.command.cwd, 'candidate-root')
    assert.match(regression.candidateTreeSha256, /^[0-9a-f]{64}$/)
    assert.match(regression.harnessSha256, /^[0-9a-f]{64}$/)
    assert.match(regression.candidateRoot, /k47-candidate-/)
    for (const log of Object.values(regression.logFiles)) {
      assert.equal(sha256(await readFile(join(fixture.root, log))), log.includes('.stdout.')
        ? regression.stdoutSha256 : regression.stderrSha256)
    }
  }
  const baseline = JSON.parse(await readFile(join(fixture.root, LOCKS[0]), 'utf8'))
  const inventory = JSON.parse(await readFile(join(fixture.root, LOCKS[1]), 'utf8'))
  const ledger = JSON.parse(await readFile(join(fixture.root, LOCKS[2]), 'utf8'))
  assert.equal(baseline.repositories.MR.commit, fixture.candidate)
  assert.equal(baseline.repositories.DS.commit, 'de55888a93983fc51c94f7d22bc94b4f8293205d')
  assert.equal(inventory.baseline.MR, fixture.candidate)
  assert.ok(inventory.features.filter(feature => feature.repository === 'MR').every(feature => feature.commit === fixture.candidate))
  assert.equal(ledger.increments.length, 1)
  assert.equal(ledger.increments[0].commits.candidate, fixture.candidate)
  assert.equal(ledger.increments[0].approvalSha256, sha256(await readFile(join(fixture.root, approvalPath))))
  assert.equal(ledger.increments[0].regressionSummary.status, 'passed')
  assert.deepEqual(ledger.increments[0].functionalSnapshot, result.functionalSnapshot)
  assert.notDeepEqual(await readFile(join(fixture.root, LOCKS[0])), before.get(LOCKS[0]))

  for (const [script, args] of [
    ['integration-inventory.mjs', ['--root', fixture.root, '--mr-root', fixture.root, '--ds-root', DS_ROOT, '--write']],
    ['integration-progress.mjs', ['--root', fixture.root, 'check']],
    ['integration-f-difference.mjs', ['--root', fixture.root, '--write']],
    ['integration-f-difference.mjs', ['--root', fixture.root, '--check']],
  ]) {
    const check = await cli(fixture, script, args)
    assert.equal(check.exitCode, 0, `${script} ${args.join(' ')}: ${check.stderr}`)
  }
  const difference = JSON.parse(await readFile(join(fixture.root, 'docs/releases/0.26.0-preview.1-f-difference.json'), 'utf8'))
  assert.equal(difference.includedIncrements.increments.length, 1)
  assert.equal(difference.includedIncrements.increments[0].commits.candidate, fixture.candidate)
  assert.equal(difference.includedIncrements.increments[0].targetVersion, '0.26.0-preview.2')
  assert.equal(difference.includedIncrements.increments[0].regressions[0].status, 'passed')
  assert.ok(difference.features.every(feature => feature.behaviorVerified === false))
  const differenceMarkdown = await readFile(join(fixture.root, 'docs/releases/0.26.0-preview.1-f-difference.md'), 'utf8')
  assert.match(differenceMarkdown, new RegExp(fixture.candidate))
  assert.match(differenceMarkdown, /0\.26\.0-preview\.2/)
  assert.match(differenceMarkdown, /F40-cli-runtime-contract passed exit=0/)

  const includedLocks = await isolatedLockBytes(fixture.root)
  const refuseEvidence = async name => {
    const corrupted = await isolatedLockBytes(fixture.root)
    for (const [script, args] of [
      ['integration-progress.mjs', ['--root', fixture.root, 'check']],
      ['integration-inventory.mjs', ['--root', fixture.root, '--mr-root', fixture.root, '--ds-root', DS_ROOT]],
      ['integration-f-difference.mjs', ['--root', fixture.root, '--check']],
    ]) {
      const rejected = await cli(fixture, script, args)
      assert.notEqual(rejected.exitCode, 0, `${name}: ${script} accepted invalid regression evidence`)
    }
    await assert.rejects(verifyProductSource(join(fixture.root, 'modules/bot-runtime')), undefined,
      `${name}: SOURCE gate accepted invalid regression evidence`)
    assertLocksEqual(await isolatedLockBytes(fixture.root), corrupted)
  }
  for (const [name, mutate] of [
    ['pending-proof', row => { row.regressions[0].status = 'pending' }],
    ['failed-proof', row => { row.regressions[0].status = 'failed'; row.regressions[0].exitCode = 7 }],
    ['malformed-proof', row => { delete row.regressions[0].candidateTreeSha256 }],
    ['summary-count', row => { row.regressionSummary.passed++ }],
    ['duplicate-proof', row => { row.regressions[1].id = row.regressions[0].id }],
    ['wrong-command-candidate', row => { row.regressions[0].command.args[6] = MR_BASELINE }],
    ['missing-functional-snapshot', row => { delete row.functionalSnapshot }],
    ['wrong-snapshot-candidate', row => { row.functionalSnapshot.commits.candidate = MR_BASELINE }],
    ['snapshot-behavior-promotion', row => { row.functionalSnapshot.features[0].behaviorVerified = true }],
    ['snapshot-rehashed-invalid-source', row => {
      row.functionalSnapshot.features.find(feature => feature.id === 'F40').sources[0].candidate.fileCount = -1
      const { sha256: _digest, ...contents } = row.functionalSnapshot
      row.functionalSnapshot.sha256 = sha256(`${JSON.stringify(contents)}\n`)
    }],
  ]) {
    const corrupted = structuredClone(ledger)
    mutate(corrupted.increments[0])
    await writeJson(fixture.root, LOCKS[2], corrupted)
    await refuseEvidence(name)
    await writeFile(join(fixture.root, LOCKS[2]), includedLocks.get(LOCKS[2]))
  }
  const stdoutPath = join(fixture.root, ledger.increments[0].regressions[0].logFiles.stdout)
  const stdoutBytes = await readFile(stdoutPath)
  await writeFile(stdoutPath, Buffer.concat([stdoutBytes, Buffer.from('\ntampered evidence\n')]))
  await refuseEvidence('altered-log-bytes')
  await writeFile(stdoutPath, stdoutBytes)
  await rename(stdoutPath, `${stdoutPath}.retained`)
  await refuseEvidence('missing-log')
  await rename(`${stdoutPath}.retained`, stdoutPath)
  assertLocksEqual(await isolatedLockBytes(fixture.root), includedLocks)
  const restoredGate = await cli(fixture, 'integration-progress.mjs', ['--root', fixture.root, 'check'])
  assert.equal(restoredGate.exitCode, 0, restoredGate.stderr)

  const candidateBaselineBytes = await readFile(join(fixture.root, LOCKS[0]))
  const drifted = structuredClone(baseline)
  drifted.repositories.MR.commit = MR_BASELINE
  await writeJson(fixture.root, LOCKS[0], drifted)
  for (const [script, args] of [
    ['integration-progress.mjs', ['--root', fixture.root, 'check']],
    ['integration-inventory.mjs', ['--root', fixture.root, '--mr-root', fixture.root, '--ds-root', DS_ROOT, '--write']],
    ['integration-f-difference.mjs', ['--root', fixture.root, '--check']],
  ]) {
    const rejected = await cli(fixture, script, args)
    assert.notEqual(rejected.exitCode, 0, `${script} did not reject baseline drift without a ledger record`)
    assert.match(rejected.stderr, /baseline drift|baseline differs|stale or malformed/)
  }
  await writeFile(join(fixture.root, LOCKS[0]), candidateBaselineBytes)
  assert.deepEqual(await realProtectedHashes(), fixture.realProtectedBefore)
  await persist(fixture, 'valid-inclusion')
  for (const [source, name] of [
    ['tmp/integration/proposal/proposal.json', 'proposal.json'],
    ['tmp/integration/approvals/valid.json', 'approval.json'],
    ['tmp/integration/include-valid/inclusion-result.json', 'inclusion-result.json'],
    ['tmp/integration/include-valid/F40-cli-runtime-contract.stdout.log', 'regression.stdout.log'],
    ['tmp/integration/include-valid/F40-cli-runtime-contract.stderr.log', 'regression.stderr.log'],
    ['tmp/integration/include-valid/transaction.json', 'transaction.json'],
    ['docs/integration/included-increments.json', 'included-increments.json'],
    ['docs/releases/0.26.0-preview.1-f-difference.json', 'f-difference.json'],
    ['docs/releases/0.26.0-preview.1-f-difference.md', 'f-difference.md'],
  ]) await persistArtifact(fixture, 'valid-inclusion', source, name)
})

test('include CLI: failed affected regression is recorded failed and all three locks roll back before gates pass again', async t => {
  const fixture = await makeFixture(t, { breakCandidateBehavior: true })
  const proposal = await propose(fixture)
  const approvalPath = await writeApproval(fixture, 'valid-failing-regression', approvalFor(proposal))
  const before = await isolatedLockBytes(fixture.root)
  const included = await cli(fixture, 'integration-upstream-include.mjs', includeArgs(fixture, approvalPath, 'tmp/integration/include-regression-failed'))
  assert.notEqual(included.exitCode, 0)
  assert.match(included.stderr, /Affected regression failed/)
  const result = JSON.parse(await readFile(join(fixture.root, 'tmp/integration/include-regression-failed/inclusion-result.json'), 'utf8'))
  assert.equal(result.status, 'failed')
  assert.equal(result.recovery, 'rolled-back')
  const failed = result.regressions.find(regression => regression.status === 'failed')
  assert.equal(failed.id, 'F40-cli-runtime-contract')
  assert.notEqual(failed.exitCode, 0)
  assert.equal(result.regressions.find(regression => regression.id === 'F23-router-contract').status, 'passed')
  assert.equal(result.regressionSummary, undefined)
  assertLocksEqual(await isolatedLockBytes(fixture.root), before)
  const transaction = JSON.parse(await readFile(join(fixture.root, 'tmp/integration/include-regression-failed/transaction.json'), 'utf8'))
  assert.equal(transaction.state, 'failed-rolled-back')
  for (const [script, args] of [
    ['integration-progress.mjs', ['--root', fixture.root, 'check']],
    ['integration-inventory.mjs', ['--root', fixture.root, '--mr-root', fixture.root, '--ds-root', DS_ROOT]],
  ]) {
    const check = await cli(fixture, script, args)
    assert.equal(check.exitCode, 0, `${script}: ${check.stderr}`)
  }
  assert.deepEqual(await realProtectedHashes(), fixture.realProtectedBefore)
  await persist(fixture, 'failed-regression')
  for (const [source, name] of [
    ['tmp/integration/include-regression-failed/inclusion-result.json', 'inclusion-result.json'],
    ['tmp/integration/include-regression-failed/F40-cli-runtime-contract.stdout.log', 'regression.stdout.log'],
    ['tmp/integration/include-regression-failed/F40-cli-runtime-contract.stderr.log', 'regression.stderr.log'],
    ['tmp/integration/include-regression-failed/transaction.json', 'transaction.json'],
  ]) await persistArtifact(fixture, 'failed-regression', source, name)
})

test('include CLI: a reviewer-added nonexistent scope id is rejected before any write', async t => {
  const fixture = await makeFixture(t)
  const proposal = await propose(fixture)
  const valid = approvalFor(proposal)
  const withInvalid = {
    ...valid,
    fileReviews: valid.fileReviews.map(review => (review.path === 'k44-unknown.txt'
      ? { ...review, disposition: 'frt-impact-confirmed', featureIds: ['F999'], requirementIds: [], acceptanceIds: [] }
      : review)),
    featureReviews: [...valid.featureReviews, { id: 'F999', status: 'affected', reason: 'invalid reviewer-added id' }],
  }
  const approvalPath = await writeApproval(fixture, 'invalid-scope-id', withInvalid)
  const before = await isolatedLockBytes(fixture.root)
  const result = await cli(fixture, 'integration-upstream-include.mjs', includeArgs(fixture, approvalPath, 'tmp/integration/include-invalid-id'))
  assert.notEqual(result.exitCode, 0)
  assert.match(result.stderr, /F999/)
  assertLocksEqual(await isolatedLockBytes(fixture.root), before)
  assert.deepEqual(await realProtectedHashes(), fixture.realProtectedBefore)
})

test('include CLI: unknown-only and mixed candidates select reviewer-added F R or T regressions and reject illegal ids', async t => {
  const fixture = await makeFixture(t)
  const originalLocks = await isolatedLockBytes(fixture.root)
  for (const [name, mixed, features, requirements, acceptance] of [
    ['unknown-f23', false, ['F23'], [], []],
    ['unknown-r-only', false, [], ['R14'], []],
    ['unknown-t-only', false, [], [], ['T55']],
    ['mixed-f40-and-f23', true, ['F23'], [], []],
  ]) {
    await checked(fixture, 'git', ['-C', fixture.root, 'read-tree', MR_BASELINE])
    await checked(fixture, 'git', ['-C', fixture.root, 'add', '--', 'k44-unknown.txt',
      ...(mixed ? ['packages/cli-runtime/src/contracts.mjs'] : [])])
    const tree = (await checked(fixture, 'git', ['-C', fixture.root, 'write-tree'])).stdout.trim()
    fixture.candidate = (await checked(fixture, 'git', ['-C', fixture.root, '-c', 'user.name=T61 Offline Fixture',
      '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
      'commit-tree', tree, '-p', MR_BASELINE, '-m', name])).stdout.trim()
    const proposal = await propose(fixture), mechanical = proposal.value.featureCoverage
    assert.deepEqual(mechanical.map(row => row.featureId), mixed ? ['F40'] : [])
    const valid = approvalFor(proposal), row = id => ({ id, status: 'affected', reason: `Offline explicit ${name} scope review.` })
    const unique = (existing, additions) => [...new Set([...existing.map(item => item.id), ...additions])].sort().map(row)
    valid.fileReviews = valid.fileReviews.map(review => review.path === 'k44-unknown.txt'
      ? { ...review, disposition: 'frt-impact-confirmed', featureIds: features, requirementIds: requirements, acceptanceIds: acceptance }
      : review)
    valid.featureReviews = unique(valid.featureReviews, features)
    valid.requirementReviews = unique(valid.requirementReviews, requirements)
    valid.acceptanceReviews = unique(valid.acceptanceReviews, acceptance)
    valid.regressionIds = mixed ? ['F23-router-contract', 'F40-cli-runtime-contract'] : ['F23-router-contract']
    if (!mixed) {
      for (const [kind, bad] of [['featureIds', 'F999'], ['requirementIds', 'R999'], ['acceptanceIds', 'T999']]) {
        const invalid = structuredClone(valid)
        invalid.fileReviews.find(review => review.path === 'k44-unknown.txt')[kind] = [bad]
        const approval = await writeApproval(fixture, `${name}-${bad}`, invalid)
        const rejected = await cli(fixture, 'integration-upstream-include.mjs', includeArgs(fixture, approval, `tmp/integration/${name}-${bad}`))
        assert.notEqual(rejected.exitCode, 0)
        assert.match(rejected.stderr, new RegExp(bad))
        assertLocksEqual(await isolatedLockBytes(fixture.root), originalLocks)
      }
    }
    const approval = await writeApproval(fixture, name, valid), output = `tmp/integration/${name}`
    const included = await cli(fixture, 'integration-upstream-include.mjs', includeArgs(fixture, approval, output))
    assert.equal(included.exitCode, 0, `${name}: ${included.stderr}`)
    const result = JSON.parse(await readFile(join(fixture.root, output, 'inclusion-result.json')))
    assert.deepEqual(result.regressions.map(item => item.id), valid.regressionIds)
    assert.deepEqual(result.effectiveImpact.addedFeatures, features)
    assert.deepEqual(result.effectiveImpact.addedRequirements, requirements)
    assert.deepEqual(result.effectiveImpact.addedAcceptance, acceptance)
    assert.equal(result.effectiveImpact.behaviorVerified, false)
    assert.ok(result.regressions.every(item => item.status === 'passed' && item.exitCode === 0))
    const release = await cli(fixture, 'integration-f-difference.mjs', ['--root', fixture.root, '--write'])
    assert.equal(release.exitCode, 0, release.stderr)
    const difference = JSON.parse(await readFile(join(fixture.root, 'docs/releases/0.26.0-preview.1-f-difference.json')))
    assert.deepEqual(difference.includedIncrements.increments[0].effectiveImpact, result.effectiveImpact)
    for (const [path, bytes] of originalLocks) await writeFile(join(fixture.root, path), bytes)
  }
  assert.deepEqual(await realProtectedHashes(), fixture.realProtectedBefore)
})

test('normal progress/inventory/F-difference gates reject genesis drift and a regression-pending ledger increment', async t => {
  const fixture = await makeFixture(t)
  const clean = await cli(fixture, 'integration-progress.mjs', ['--root', fixture.root, 'check'])
  assert.equal(clean.exitCode, 0, clean.stderr)
  const ledger = JSON.parse(await readFile(join(fixture.root, LOCKS[2]), 'utf8'))

  const drifted = structuredClone(ledger)
  drifted.genesis = { MR: 'a'.repeat(40), DS: 'b'.repeat(40) }
  await writeJson(fixture.root, LOCKS[2], drifted)
  for (const [script, args] of [
    ['integration-progress.mjs', ['--root', fixture.root, 'check']],
    ['integration-inventory.mjs', ['--root', fixture.root, '--mr-root', fixture.root, '--ds-root', DS_ROOT]],
    ['integration-f-difference.mjs', ['--root', fixture.root]],
  ]) {
    const rejected = await cli(fixture, script, args)
    assert.notEqual(rejected.exitCode, 0, `${script} accepted a drifted genesis`)
    assert.match(rejected.stderr, /genesis|baseline/)
  }

  const pending = structuredClone(ledger)
  pending.increments.push({
    id: `MR:${'c'.repeat(40)}`, sourceRepository: 'MR',
    commits: { baseline: ledger.genesis.MR, candidate: 'c'.repeat(40) },
    status: 'regression-pending', regressionSummary: { status: 'pending', total: 1, passed: 0, failed: 0 },
    targetVersion: '0.26.0-preview.2',
  })
  await writeJson(fixture.root, LOCKS[2], pending)
  for (const [script, args] of [
    ['integration-progress.mjs', ['--root', fixture.root, 'check']],
    ['integration-inventory.mjs', ['--root', fixture.root, '--mr-root', fixture.root, '--ds-root', DS_ROOT]],
    ['integration-f-difference.mjs', ['--root', fixture.root]],
  ]) {
    const rejected = await cli(fixture, script, args)
    assert.notEqual(rejected.exitCode, 0, `${script} accepted a regression-pending increment`)
  }
  assert.deepEqual(await realProtectedHashes(), fixture.realProtectedBefore)
})

test('include arguments require full SHA and impact selection never treats approval text as a command', async () => {
  assert.throws(() => parseArgs([
    '--source', 'mr', '--candidate', 'HEAD',
    '--proposal', 'tmp/integration/p.json', '--approval', 'tmp/integration/a.json',
    '--output', 'tmp/integration/o', '--ds-root', DS_ROOT,
  ]), /complete 40-hex/)
  assert.deepEqual(selectAffectedRegressions({
    featureCoverage: [{ featureId: 'F40', requirementIds: [], acceptanceIds: [] }],
  }).map(entry => entry.id), ['F40-cli-runtime-contract'])
  assert.equal(selectAffectedRegressions({
    featureCoverage: [{ featureId: 'F40', requirementIds: [], acceptanceIds: [] }],
  })[0].file, 'tests/fixtures/increment-regressions/f40-cli-runtime-contract.mjs')
})
