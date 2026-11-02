import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, link, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, truncate, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { createRouterState } from '../.dsh-plugin/shared/router-state.mjs'
import { openSqliteRouterState } from '../packages/orchestration/src/sqlite-router-state.mjs'
import { previewProfileMigration } from '../packages/orchestration/src/profile-migration-plan.mjs'
import { inspectMigrationSources } from '../packages/orchestration/src/migration-snapshot.mjs'
import { createMigrationDataArchive } from '../packages/orchestration/src/migration-data-archive.mjs'
import { createMigrationLedgerArchive } from '../packages/orchestration/src/migration-ledger-export.mjs'
import { createMigrationDomainAuditArtifact, migrationDomainAuditInputDigests, verifyMigrationDomainAuditArtifact } from '../packages/orchestration/src/migration-domain-evidence.mjs'
import { observeCapturedMigrationDomainInventory } from '../packages/orchestration/src/migration-domain-inventory.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const PRODUCT = '@ljwei-stak/dsh-model-router'
const parent = resolve('tmp/integration/migration-domain-evidence')
await mkdir(parent, { recursive: true })
const json = value => JSON.stringify(value) + '\n'
const sha = value => createHash('sha256').update(value).digest('hex')

/**
 * A real capture plus a real ledger archive. `money` selects the genuine
 * schema-5 router ledger (legacy marker migrated by the store itself, schema-5
 * user_version applied by the real task journal DDL); without it the ledger
 * source is a generic single-table library, which is the negative case.
 */
async function fixture (t, { money = true, usage = false, omitBot = false, memory = false, omitTeam = false, omitSecrets = false, decoyBot = false } = {}) {
  const dir = await mkdtemp(join(parent, 'case-'))
  const home = join(dir, 'home'), profile = join(home, 'profiles/desktop'), bot = join(home, 'bot'), sessions = join(home, 'sessions'), attachments = join(home, 'attachments'), router = join(dir, 'ledger-source')
  const handles = { database: null }
  t.after(async () => {
    try { handles.database?.close() } catch {}
    const within = relative(parent, resolve(dir))
    assert.ok(within && !isAbsolute(within) && within !== '..' && !within.startsWith('..\\') && !within.startsWith('../'))
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  })
  for (const path of [profile, bot, sessions, attachments, router]) await mkdir(path, { recursive: true })
  async function bundle (folder, name, patch) {
    const packageDir = join(dir, folder)
    await mkdir(packageDir)
    await writeFile(join(packageDir, 'package.json'), json({ name, version: '0.25.6-preview.1', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
    await writeFile(join(packageDir, 'cordis.patch.yml'), patch)
    return { packageName: name, packageDir }
  }
  const base = await bundle('base', '@fixture/base', json([{ insert: [{ id: 'web', name: 'fixture-web', config: { searchProvider: 'auto' } }] }]))
  const old = await bundle('old', PRODUCT, json([{ insert: [{ id: 'model-router-galgame', name: PRODUCT, config: { dailyBudgetUsd: 0, monthlyBudgetUsd: 100 } }] }]))
  const target = await bundle('target', PRODUCT, await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8'))
  await writeFile(join(profile, 'package.json'), json({ dsh: { profile: { bundles: [base.packageName, old.packageName] } } }))
  const plan = await previewProfileMigration({ profileDir: profile, dshHome: home, launchCwd: profile, orderedBundleLayers: [base, old], launcherLayers: [], launchEnvironment: {}, targetBundleLayer: target })
  assert.equal(plan.status, 'ready')
  const team = { version: 1, mainBotIds: ['bot-a'], bots: { 'bot-a': { id: 'bot-a', sessionId: 'bot-a', segments: [], capabilities: [] } }, rooms: {}, agents: {}, capabilities: { items: {} } }
  if (!omitTeam) await writeFile(join(bot, 'state.json'), json(team))
  if (!omitSecrets) await writeFile(join(bot, 'secrets.json'), json({ version: 1, secrets: [] }))
  if (memory) await mkdir(join(bot, 'memory'))
  const sessionDirectory = join(sessions, '_no-cwd', 'bot-a')
  await mkdir(sessionDirectory, { recursive: true })
  const sessionHeader = sessionFormatCatalog.encodeCurrentHeader({ version: 4, id: 'bot-a', createdAt: 1, isSeeded: false, delegationDepth: 0 }, 0)
  await writeFile(join(sessionDirectory, 'session.v4.jsonl'), json(sessionHeader))
  if (usage) await writeFile(join(bot, 'usage.sqlite'), 'FIXTURE-USAGE-SOURCE\n')
  const markerPath = join(router, 'state.json'), ledgerFile = join(router, 'router.sqlite')
  if (money) {
    const legacy = createRouterState({ file: markerPath })
    await legacy.update(() => {})
    const store = await openSqliteRouterState({ Database, file: ledgerFile, legacyFile: markerPath })
    const journal = store.openTaskJournal()
    journal.close()
    await store.close()
    assert.equal(await readFile(markerPath, 'utf8').then(value => JSON.parse(value).version), 4)
  }
  handles.database = new Database(ledgerFile)
  if (!money) {
    handles.database.exec('CREATE TABLE audit (id INTEGER PRIMARY KEY, note TEXT)')
    handles.database.prepare('INSERT INTO audit(note) VALUES(?)').run('PRIVATE-ROW')
  }
  const selected = [{ id: 'bot', kind: 'bot-data', root: bot }, { id: 'sessions', kind: 'sessions', root: sessions }, { id: 'attachments', kind: 'attachments', root: attachments }, { id: 'router', kind: 'ledger', root: router }]
  if (omitBot) selected.splice(0, 1)
  if (decoyBot) {
    const decoy = join(dir, 'decoy-bot')
    await mkdir(decoy)
    await writeFile(join(decoy, 'state.json'), json(team))
    await writeFile(join(decoy, 'secrets.json'), json({ version: 1, secrets: [] }))
    selected.splice(0, 1, { id: 'bot', kind: 'bot-data', root: decoy })
  }
  const dataArchive = join(dir, 'data-archive'), ledgerArchive = join(dir, 'ledger-archive')
  await createMigrationDataArchive({ inventory: await inspectMigrationSources(selected), configurationPlan: plan, privateOutput: dataArchive })
  await createMigrationLedgerArchive({ Database, database: handles.database, privateOutput: ledgerArchive })
  handles.database.close()
  handles.database = null
  const layout = { team: { sourceId: 'bot', path: 'state.json' }, router: { sourceId: 'router', path: 'state.json' }, secrets: { sourceId: 'bot', path: 'secrets.json' }, usage: null, sessions: [{ sourceId: 'sessions', compression: 'none' }], attachments: [{ sourceId: 'attachments' }], workspacePolicy: 'preserve-in-place' }
  const input = { layout, finance: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, limits: { maxSessions: 100 } }
  const captureManifestSha256 = sha(await readFile(join(dataArchive, 'capture.private.json')))
  const ledgerBytes = await readFile(join(ledgerArchive, 'archive.private.json'))
  const ledgerManifestSha256 = sha(ledgerBytes), ledgerContentDigest = JSON.parse(ledgerBytes).contentDigest
  const operationId = randomUUID(), domains = selected.map(source => ({ name: source.id, roots: [source.root] }))
  const binding = {
    operationId,
    operationDigest: sha(json({ operationId })),
    domains,
    domainsDigest: sha(json(domains)),
    profilePlanDigest: sha(json(plan)),
    captureManifestSha256,
    captureJournalDigest: sha(json({ captureManifestSha256, ledgerManifestSha256 })),
    ledgerManifestSha256,
    ledgerContentDigest,
    ...migrationDomainAuditInputDigests(input),
  }
  const privateOutput = join(dir, 'domain-evidence')
  return { dir, home, bot, sessions, attachments, router, plan, input, binding, dataArchive, ledgerArchive, privateOutput, Database, money }
}

const createAt = (f, privateOutput, input = f.input, binding = f.binding) => createMigrationDomainAuditArtifact({ privateOutput, dataArchive: f.dataArchive, ledgerArchive: f.ledgerArchive, Database, input, binding })
const verifyAt = (f, privateOutput, expected = f.binding) => verifyMigrationDomainAuditArtifact({ privateOutput, dataArchive: f.dataArchive, ledgerArchive: f.ledgerArchive, Database, expected })
const create = f => createAt(f, f.privateOutput)
const verify = (f, expected = f.binding) => verifyAt(f, f.privateOutput, expected)
const artifactOf = async f => JSON.parse(await readFile(join(f.privateOutput, 'domain-audit.private.json'), 'utf8'))
const missing = async path => readdir(path).then(() => false, () => true)
const LEDGER_TABLES = ['router_meta', 'router_migration', 'router_runs', 'router_holds']

test('domain inventory: configuration-derived obligations remain bounded and epoch-unproven', async t => {
  const f = await fixture(t)
  const result = await create(f), artifact = await artifactOf(f)
  assert.equal(artifact.schemaVersion, 2)
  const observation = artifact.inventoryObservation
  assert.equal(observation.coverage, 'configuration-derived-captured-obligations-only')
  assert.equal(observation.status, 'needs-context')
  assert.equal(observation.complete, false)
  assert.equal(observation.captureEpochStatus, 'unproven')
  assert.equal(observation.domains.find(row => row.domain === 'bot-data').state, 'observed')
  assert.equal(observation.domains.find(row => row.domain === 'team').state, 'observed')
  assert.equal(observation.domains.find(row => row.domain === 'memory').state, 'absent')
  assert.equal(observation.domains.find(row => row.domain === 'sessions').state, 'unknown')
  assert.equal(result.inventoryComplete, false)
  assert.equal(result.captureEpochStatus, 'unproven')
  assert.deepEqual(await verify(f), result)
})

test('domain inventory: matching caller roots cannot hide an omitted configuration-derived Bot home', async t => {
  const f = await fixture(t, { omitBot: true })
  await create(f)
  const observation = (await artifactOf(f)).inventoryObservation
  assert.equal(observation.status, 'blocked')
  assert.equal(observation.domains.find(row => row.domain === 'bot-data').state, 'unknown')
  assert.ok(observation.diagnostics.some(row => row.code === 'REQUIRED_CAPTURE_ROOT_MISSING'))
  assert.equal(observation.complete, false)
})

test('domain inventory: decoy Bot bytes and matching caller labels do not discharge the real home obligation', async t => {
  const f = await fixture(t, { decoyBot: true })
  const summary = await create(f), artifact = await artifactOf(f)
  assert.equal(artifact.result.status, 'audited', 'the prior declared-roots semantic audit alone cannot catch the decoy')
  assert.equal(summary.inventoryStatus, 'blocked')
  assert.ok(artifact.inventoryObservation.diagnostics.some(row => row.code === 'REQUIRED_CAPTURE_ROOT_MISSING'))
  assert.equal(artifact.inventoryObservation.domains.find(row => row.domain === 'team').state, 'unknown')
})

test('domain inventory: required missing team differs from optional secrets absent in a captured parent', async t => {
  const f = await fixture(t, { omitTeam: true, omitSecrets: true })
  await create(f)
  const observation = (await artifactOf(f)).inventoryObservation
  assert.equal(observation.domains.find(row => row.domain === 'team').state, 'absent')
  assert.equal(observation.domains.find(row => row.domain === 'secrets').state, 'absent')
  assert.ok(observation.diagnostics.some(row => row.domain === 'team' && row.code === 'REQUIRED_DOMAIN_ENTRY_MISSING'))
  assert.equal(observation.diagnostics.some(row => row.domain === 'secrets' && row.code === 'REQUIRED_DOMAIN_ENTRY_MISSING'), false)
  assert.equal(observation.status, 'blocked')
})

test('domain inventory: caller null cannot hide observed fixed team or secret locations', async t => {
  const f = await fixture(t)
  const input = { ...f.input, layout: { ...f.input.layout, team: null, secrets: null } }
  const binding = { ...f.binding, ...migrationDomainAuditInputDigests(input) }
  const summary = await createAt(f, f.privateOutput, input, binding)
  const observation = (await artifactOf(f)).inventoryObservation
  assert.equal(summary.inventoryStatus, 'blocked')
  for (const domain of ['team', 'secrets']) assert.ok(observation.diagnostics.some(row => row.domain === domain && row.code === 'FIXED_DOMAIN_LAYOUT_MISMATCH'))
})

test('domain inventory: captured memory needs its fixed selection, not empty or unrelated roots', async t => {
  const f = await fixture(t, { memory: true })
  await create(f)
  const observation = (await artifactOf(f)).inventoryObservation
  assert.equal(observation.domains.find(row => row.domain === 'memory').state, 'observed')
  assert.ok(observation.diagnostics.some(row => row.code === 'REQUIRED_MEMORY_SELECTION_MISSING'))
  const archive = JSON.parse(await readFile(join(f.dataArchive, 'capture.private.json'), 'utf8'))
  for (const [selection, expected] of [[[{ sourceId: 'bot', prefix: 'memory' }], false], [[{ sourceId: 'sessions' }], true], [[{ sourceId: 'bot', prefix: 'memory' }, { sourceId: 'bot', prefix: 'memory' }], true]]) {
    const input = { layout: { ...f.input.layout, supportingDomains: { memory: selection } } }
    const value = observeCapturedMigrationDomainInventory({ archive, configurationPlan: f.plan, input, binding: f.binding })
    assert.equal(value.diagnostics.some(row => row.domain === 'memory' && row.code === 'FIXED_DOMAIN_LAYOUT_MISMATCH'), expected)
    assert.equal(value.complete, false)
  }
})

test('domain inventory: persisted observation verdict, roots, epoch and unknown claims are regenerated', async t => {
  const f = await fixture(t)
  await create(f)
  const path = join(f.privateOutput, 'domain-audit.private.json'), before = await readFile(path)
  for (const mutate of [value => { value.complete = true }, value => { value.status = 'audited' }, value => { value.domains[0].state = 'absent' }, value => { value.epochBindingDigest = '0'.repeat(64) }, value => { value.captureFingerprint = '0'.repeat(64) }, value => { value.captureEpochStatus = 'consistent' }, value => { value.unknown = true }]) {
    const artifact = JSON.parse(before)
    mutate(artifact.inventoryObservation)
    await writeFile(path, json(artifact))
    await assert.rejects(verify(f), { code: 'MIGRATION_DOMAIN_INVENTORY_MISMATCH' })
  }
  await writeFile(path, before)
  assert.equal((await verify(f)).inventoryStatus, 'needs-context')
})

test('domain inventory: schema-one bytes remain verifiable without being upgraded into inventory evidence', async t => {
  const f = await fixture(t)
  await create(f)
  const path = join(f.privateOutput, 'domain-audit.private.json'), artifact = await artifactOf(f)
  artifact.schemaVersion = 1
  delete artifact.inventoryObservation
  const before = Buffer.from(json(artifact))
  await writeFile(path, before)
  const summary = await create(f)
  const oldSummary = { schemaVersion: 1, kind: 'migration-domain-audit-evidence', status: artifact.result.status,
    diagnostics: artifact.result.diagnostics.length, sessions: artifact.result.sessions.length,
    generations: artifact.result.generations.length, references: artifact.result.references.length,
    attachments: artifact.result.attachments.referenced, resolvedAttachments: artifact.result.attachments.resolved,
    coverage: 'captured-declared-roots-only', crossDomainConsistent: false, databaseConsistent: false,
    requiresCompleteDomainReview: true, requiresStopProof: true, applySupported: false, activationSupported: false,
    postActivationRollbackSupported: false, stopWriteProvable: false, permissionsRestored: false }
  assert.deepEqual(summary, oldSummary, 'old journal summaries must retain their exact schema-one shape')
  assert.equal(Object.hasOwn(summary, 'inventoryStatus'), false)
  assert.deepEqual(await verify(f), oldSummary)
  assert.deepEqual(await readFile(path), before)
})

test('domain inventory: unsupported configuration authority, entry types and ambiguous roots fail closed', async t => {
  const f = await fixture(t)
  const archive = JSON.parse(await readFile(join(f.dataArchive, 'capture.private.json'), 'utf8'))
  const observe = (capture, configurationPlan = f.plan) => observeCapturedMigrationDomainInventory({ archive: capture, configurationPlan, input: f.input, binding: f.binding })
  for (const plan of [{ ...f.plan, status: 'needs-context' }, { ...f.plan, runtimePaths: { ...f.plan.runtimePaths, configuredHome: '' } }, { ...f.plan, runtimePaths: { ...f.plan.runtimePaths, effectiveHome: join(f.dir, 'unrelated') } }]) {
    const value = observe(archive, plan)
    assert.equal(value.domains.find(row => row.domain === 'bot-data').state, 'unknown')
    assert.ok(value.diagnostics.some(row => row.code === 'CONFIGURATION_PATH_AUTHORITY_UNAVAILABLE'))
    assert.equal(value.complete, false)
  }
  const wrongType = structuredClone(archive)
  wrongType.sourceInventory.sources.find(source => source.id === 'bot').entries.find(entry => entry.path === 'state.json').type = 'directory'
  assert.ok(observe(wrongType).diagnostics.some(row => row.domain === 'team' && row.code === 'DOMAIN_ENTRY_TYPE_MISMATCH'))
  const ambiguous = structuredClone(archive)
  ambiguous.sourceInventory.sources.push({ ...ambiguous.sourceInventory.sources.find(source => source.id === 'bot'), id: 'duplicate' })
  assert.ok(observe(ambiguous).diagnostics.some(row => row.code === 'CAPTURE_ROOT_AMBIGUOUS'))
})

test('domain inventory: every owner binding component contributes to the capture-relative descriptor', async t => {
  const f = await fixture(t)
  const archive = JSON.parse(await readFile(join(f.dataArchive, 'capture.private.json'), 'utf8'))
  const observe = binding => observeCapturedMigrationDomainInventory({ archive, configurationPlan: f.plan, input: f.input, binding })
  const original = observe(f.binding)
  for (const key of ['operationId', 'operationDigest', 'profilePlanDigest', 'captureManifestSha256', 'captureJournalDigest', 'ledgerManifestSha256', 'ledgerContentDigest', 'domainLayoutDigest', 'domainAuditInputDigest']) {
    const changed = observe({ ...f.binding, [key]: key === 'operationId' ? f.binding.operationId + '-other' : '0'.repeat(64) })
    assert.notEqual(changed.epochBindingDigest, original.epochBindingDigest, key)
    assert.equal(changed.captureEpochStatus, 'unproven')
    assert.equal(changed.complete, false)
  }
})

test('domain inventory: schema-two observation is mandatory and legacy/schema-two field mixing is rejected', async t => {
  const f = await fixture(t)
  await create(f)
  const path = join(f.privateOutput, 'domain-audit.private.json'), before = await readFile(path)
  for (const value of [null, [], { ...JSON.parse(before), inventoryComplete: true }]) {
    await writeFile(path, json(value))
    await assert.rejects(verify(f), { code: 'MIGRATION_DOMAIN_ARTIFACT_INVALID' })
  }
  const missing = JSON.parse(before)
  delete missing.inventoryObservation
  await writeFile(path, json(missing))
  await assert.rejects(verify(f), { code: 'MIGRATION_DOMAIN_ARTIFACT_INVALID' })
  const mixed = JSON.parse(before)
  mixed.schemaVersion = 1
  await writeFile(path, json(mixed))
  await assert.rejects(verify(f), { code: 'MIGRATION_DOMAIN_ARTIFACT_INVALID' })
  await writeFile(path, before)
  assert.equal((await verify(f)).inventoryComplete, false)
})

test('domain evidence: a real capture and re-exported ledger produce a re-verifiable private artifact', async t => {
  const f = await fixture(t)
  const created = await create(f)
  const observed = await artifactOf(f)
  assert.equal(created.status, 'audited', JSON.stringify({ domain: observed.result.diagnostics.map(x => x.code), finance: observed.result.financial?.diagnostics?.map(x => x.code) }))
  assert.equal(created.coverage, 'captured-declared-roots-only')
  assert.equal(created.crossDomainConsistent, false)
  assert.equal(created.applySupported, false)
  assert.deepEqual(await verify(f), created)
  const artifact = await artifactOf(f)
  assert.deepEqual(artifact.input, f.input)
  assert.equal(artifact.result.status, 'audited')
  assert.equal(artifact.result.financial.status, 'audited')
  // The re-exported ledger is real financial evidence, not a dropped export.
  assert.notEqual(artifact.result.financial.ledger, null)
  assert.equal(artifact.result.financial.ledger.contentDigest, f.binding.ledgerContentDigest)
  assert.ok(artifact.result.financial.ledger.rows > 0)
  for (const name of LEDGER_TABLES) assert.ok(artifact.result.financial.ledger.tables.some(table => table.name === name), name)
  const publicText = JSON.stringify(created)
  for (const value of [f.dir, 'bot-a', f.binding.domainAuditInputDigest, f.binding.captureManifestSha256, 'ledgerExport', 'layout', f.binding.ledgerContentDigest]) assert.ok(!publicText.includes(value))
})

test('domain evidence: a generic audit-table library is blocked instead of masquerading as verified ledger evidence', async t => {
  const f = await fixture(t, { money: false })
  const created = await create(f)
  assert.equal(created.status, 'blocked')
  assert.equal((await verify(f)).status, 'blocked')
  const artifact = await artifactOf(f)
  assert.equal(artifact.result.financial.status, 'blocked')
  assert.equal(artifact.result.financial.ledger, null)
  const codes = artifact.result.financial.diagnostics.map(diagnostic => diagnostic.code)
  assert.ok(codes.includes('LEDGER_EXPORT_INVALID'))
  assert.ok(artifact.result.diagnostics.some(diagnostic => diagnostic.code === 'FINANCE_CONTEXT_REQUIRED' && diagnostic.severity === 'error'))
  // The negative verdict is never rewritten into an audited one.
  assert.notEqual(artifact.result.financial.status, 'audited')
})

test('domain evidence: verification uses archived canonical roots after every original domain moves', async t => {
  const f = await fixture(t)
  await create(f)
  await rename(f.home, join(f.dir, 'moved-original'))
  await rename(f.router, join(f.dir, 'moved-router'))
  assert.equal((await verify(f)).status, 'audited')
})

test('domain evidence: layout and fixed input mismatches are refused', async t => {
  const f = await fixture(t)
  await create(f)
  const changed = structuredClone(f.input)
  changed.layout.sessions[0].compression = 'zstd'
  const expected = { ...f.binding, ...migrationDomainAuditInputDigests(changed) }
  await assert.rejects(verify(f, expected), { code: 'MIGRATION_DOMAIN_OPERATION_MISMATCH' })
  await assert.rejects(createAt(f, join(f.dir, 'other'), changed, f.binding), { code: 'MIGRATION_DOMAIN_OPERATION_MISMATCH' })
  await assert.rejects(createAt(f, join(f.dir, 'inline'), { ...f.input, finance: { timeZone: 'UTC', ledgerExport: null } }, f.binding), { code: 'MIGRATION_DOMAIN_INPUT_INVALID' })
})

test('domain evidence: missing, extra and duplicate declared roots fail closed', async t => {
  for (const mode of ['missing', 'extra', 'duplicate']) {
    const f = await fixture(t)
    const expected = structuredClone(f.binding)
    if (mode === 'missing') expected.domains.pop()
    if (mode === 'extra') expected.domains.push({ name: 'extra', roots: [join(f.dir, 'not-captured')] })
    if (mode === 'duplicate') expected.domains[1].roots = [expected.domains[0].roots[0]]
    expected.domainsDigest = sha(json(expected.domains))
    await assert.rejects(createAt(f, f.privateOutput, f.input, expected), { code: 'MIGRATION_DOMAIN_ROOT_COVERAGE_MISMATCH' })
  }
})

test('domain evidence: persisted verdict, diagnostics, sessions, fingerprint and coverage cannot be forged', async t => {
  for (const [mode, code] of [['status', 'MIGRATION_DOMAIN_AUDIT_MISMATCH'], ['diagnostics', 'MIGRATION_DOMAIN_AUDIT_MISMATCH'], ['sessions', 'MIGRATION_DOMAIN_AUDIT_MISMATCH'], ['fingerprint', 'MIGRATION_DOMAIN_AUDIT_MISMATCH'], ['ledger', 'MIGRATION_DOMAIN_AUDIT_MISMATCH'], ['coverage', 'MIGRATION_DOMAIN_ARTIFACT_INVALID'], ['unknown-key', 'MIGRATION_DOMAIN_ARTIFACT_INVALID']]) {
    const f = await fixture(t)
    await create(f)
    const path = join(f.privateOutput, 'domain-audit.private.json'), artifact = JSON.parse(await readFile(path, 'utf8'))
    if (mode === 'status') artifact.result.status = artifact.result.status === 'audited' ? 'blocked' : 'audited'
    if (mode === 'diagnostics') artifact.result.diagnostics = [{ code: 'DATA_FILE_MISSING', severity: 'error' }]
    if (mode === 'sessions') artifact.result.sessions = []
    if (mode === 'fingerprint') artifact.result.fingerprint = '0'.repeat(64)
    if (mode === 'ledger') artifact.result.financial.ledger = null
    if (mode === 'coverage') artifact.coverage = 'complete-machine'
    if (mode === 'unknown-key') artifact.complete = true
    await writeFile(path, json(artifact))
    await assert.rejects(verify(f), { code }, mode)
  }
})

test('domain evidence: persisted layout, finance and limits stay pinned even when artifact digests are recomputed', async t => {
  for (const field of ['layout', 'finance', 'limits']) {
    const f = await fixture(t)
    await create(f)
    const path = join(f.privateOutput, 'domain-audit.private.json'), artifact = JSON.parse(await readFile(path, 'utf8'))
    if (field === 'layout') artifact.input.layout.sessions[0].compression = 'zstd'
    if (field === 'finance') artifact.input.finance.timeZone = 'Pacific/Honolulu'
    if (field === 'limits') artifact.input.limits.maxSessions = 99
    Object.assign(artifact.binding, migrationDomainAuditInputDigests(artifact.input))
    await writeFile(path, json(artifact))
    await assert.rejects(verify(f), { code: 'MIGRATION_DOMAIN_OPERATION_MISMATCH' }, field)
  }
})

test('domain evidence: another operation artifact or another valid archive cannot replace the bound sources', async t => {
  const f = await fixture(t), g = await fixture(t)
  await create(f)
  await create(g)
  const foreign = await readFile(join(g.privateOutput, 'domain-audit.private.json'))
  await writeFile(join(f.privateOutput, 'domain-audit.private.json'), foreign)
  await assert.rejects(verify(f), { code: 'MIGRATION_DOMAIN_OPERATION_MISMATCH' })

  const h = await fixture(t), other = await fixture(t)
  await create(h)
  await rename(h.dataArchive, join(h.dir, 'bound-archive'))
  await rename(other.dataArchive, h.dataArchive)
  await assert.rejects(verify(h), { code: 'MIGRATION_DOMAIN_CAPTURE_MISMATCH' })
})

test('domain evidence: a substituted ledger archive is refused by the pinned manifest and by archive reverification', async t => {
  const f = await fixture(t), g = await fixture(t)
  await create(f)
  await create(g)
  const names = ['README.txt', 'ledger.sqlite', 'ledger-export.private.json', 'archive.private.json']
  await rm(f.ledgerArchive, { recursive: true, force: true })
  await mkdir(f.ledgerArchive, { recursive: true })
  for (const name of names) await writeFile(join(f.ledgerArchive, name), await readFile(join(g.ledgerArchive, name)))
  // A complete, independently verifiable archive that is not this operation's archive.
  await assert.rejects(verify(f), { code: 'MIGRATION_DOMAIN_CAPTURE_MISMATCH' })
  // Re-entry refuses the conflict instead of rebuilding over the persisted bytes.
  await assert.rejects(create(f), { code: 'MIGRATION_DOMAIN_ARTIFACT_CONFLICT' })
  const persisted = await readFile(join(f.privateOutput, 'domain-audit.private.json'))

  const h = await fixture(t)
  await create(h)
  await writeFile(join(h.ledgerArchive, 'ledger.sqlite'), await readFile(join(g.ledgerArchive, 'ledger.sqlite')))
  await writeFile(join(h.ledgerArchive, 'ledger-export.private.json'), await readFile(join(g.ledgerArchive, 'ledger-export.private.json')))
  await assert.rejects(verify(h), { code: 'MIGRATION_DOMAIN_CAPTURE_MISMATCH' })
  assert.deepEqual(await readFile(join(f.privateOutput, 'domain-audit.private.json')), persisted)
})

test('domain evidence: partial artifacts are never deleted or overwritten and rebuild requires a new root', async t => {
  const f = await fixture(t)
  await create(f)
  const path = join(f.privateOutput, 'domain-audit.private.json'), original = await readFile(path), partial = original.subarray(0, 47)
  await writeFile(path, partial)
  await assert.rejects(verify(f), { code: 'MIGRATION_DOMAIN_ARTIFACT_INCOMPLETE' })
  await assert.rejects(create(f), { code: 'MIGRATION_DOMAIN_ARTIFACT_INCOMPLETE' })
  assert.deepEqual(await readFile(path), partial)
  const rebuilt = join(f.dir, 'explicit-new-evidence')
  const summary = await createAt(f, rebuilt)
  assert.equal(summary.status, 'audited')
  assert.deepEqual(await readFile(path), partial)
})

test('domain evidence: hardlinks, redirected directories, non-canonical bytes and oversized artifacts fail closed', async t => {
  const f = await fixture(t)
  await create(f)
  const path = join(f.privateOutput, 'domain-audit.private.json'), alias = join(f.dir, 'artifact-hardlink')
  await link(path, alias)
  await assert.rejects(verify(f), { code: 'MIGRATION_DOMAIN_ARTIFACT_INVALID' })
  await unlink(alias)

  const g = await fixture(t)
  await create(g)
  // The artifact name is redirected to a directory: not a regular single-link file.
  const redirectedTarget = join(g.dir, 'artifact-redirect')
  await mkdir(redirectedTarget)
  await unlink(join(g.privateOutput, 'domain-audit.private.json'))
  await symlink(redirectedTarget, join(g.privateOutput, 'domain-audit.private.json'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(verify(g), { code: 'MIGRATION_DOMAIN_ARTIFACT_INVALID' })

  const moved = await fixture(t)
  await create(moved)
  await rename(moved.privateOutput, join(moved.dir, 'moved-evidence'))
  await symlink(join(moved.dir, 'moved-evidence'), moved.privateOutput, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(verify(moved), { code: 'MIGRATION_DOMAIN_ARTIFACT_INVALID' })

  const h = await fixture(t)
  await create(h)
  const nonCanonical = join(h.privateOutput, 'domain-audit.private.json'), value = JSON.parse(await readFile(nonCanonical, 'utf8'))
  await writeFile(nonCanonical, JSON.stringify(value))
  await assert.rejects(verify(h), { code: 'MIGRATION_DOMAIN_ARTIFACT_INVALID' })

  const i = await fixture(t)
  await create(i)
  await truncate(join(i.privateOutput, 'domain-audit.private.json'), 128 * 1024 * 1024 + 1)
  await assert.rejects(verify(i), { code: 'MIGRATION_DOMAIN_ARTIFACT_LIMIT' })
})

test('domain evidence: input depth, node, byte and closed-set limits are enforced before writing', async t => {
  const f = await fixture(t)
  const call = input => migrationDomainAuditInputDigests(input)
  assert.throws(() => call(null), { code: 'MIGRATION_DOMAIN_INPUT_INVALID' })
  assert.throws(() => call({ layout: {}, unknown: true }), { code: 'MIGRATION_DOMAIN_INPUT_INVALID' })
  assert.throws(() => call({ layout: { unknownDomain: null } }), { code: 'MIGRATION_DOMAIN_INPUT_INVALID' })
  const hostile = { layout: {} }
  Object.defineProperty(hostile.layout, 'team', { enumerable: true, get: () => null })
  assert.throws(() => call(hostile), { code: 'MIGRATION_DOMAIN_INPUT_INVALID' })
  let deep = {}
  for (let index = 0; index < 70; index++) deep = { child: deep }
  assert.throws(() => call({ layout: { supportingDomains: { memory: [], context: deep } } }), { code: 'MIGRATION_DOMAIN_INPUT_INVALID' })
  assert.throws(() => call({ layout: { supportingDomains: { memory: [], context: Array(500001).fill(0) } } }), { code: 'MIGRATION_DOMAIN_INPUT_INVALID' })
  assert.throws(() => call({ layout: { supportingDomains: { memory: [], context: 'x'.repeat(1024 * 1024 + 1) } } }), { code: 'MIGRATION_DOMAIN_INPUT_INVALID' })
  await assert.rejects(createAt(f, join(f.dataArchive, 'inside-source')), { code: 'MIGRATION_PRIVATE_OUTPUT_OVERLAPS_SOURCE' })
  assert.equal(await missing(join(f.dataArchive, 'inside-source')), true)
})

test('domain evidence: needs-context and blocked remain raw verdicts with every capability false', async t => {
  const f = await fixture(t)
  const cases = [
    { input: { layout: f.input.layout, limits: f.input.limits }, status: 'needs-context', output: join(f.dir, 'needs-context') },
    { input: { ...f.input, layout: { ...f.input.layout, team: { sourceId: 'bot', path: 'absent.json' } } }, status: 'blocked', output: join(f.dir, 'blocked') },
  ]
  for (const item of cases) {
    const binding = { ...f.binding, ...migrationDomainAuditInputDigests(item.input) }
    const created = await createAt(f, item.output, item.input, binding)
    assert.equal(created.status, item.status)
    assert.equal((await verifyAt(f, item.output, binding)).status, item.status)
    assert.equal(created.coverage, 'captured-declared-roots-only')
    for (const key of ['crossDomainConsistent', 'databaseConsistent', 'applySupported', 'activationSupported', 'postActivationRollbackSupported', 'stopWriteProvable', 'permissionsRestored']) assert.equal(created[key], false)
    assert.equal(created.requiresCompleteDomainReview, true)
    assert.equal(created.requiresStopProof, true)
  }
})

test('domain evidence: a missing usage export keeps needs-context and unknown layout fields are refused', async t => {
  const f = await fixture(t, { usage: true })
  const created = await create(f)
  assert.equal(created.status, 'needs-context')
  const artifact = await artifactOf(f)
  assert.equal(artifact.result.financial.status, 'needs-context')
  assert.equal(artifact.result.financial.usage, null)
  assert.ok(artifact.result.financial.diagnostics.some(diagnostic => diagnostic.code === 'USAGE_EXPORT_REQUIRED' && diagnostic.severity === 'needs-context'))
  assert.ok(artifact.result.diagnostics.some(diagnostic => diagnostic.code === 'FINANCE_CONTEXT_REQUIRED' && diagnostic.severity === 'needs-context'))
  // A truthy layout.usage is not evidence either: it must not become audited.
  const truthy = { ...f.input, layout: { ...f.input.layout, usage: { sourceId: 'bot', path: 'usage.sqlite' } } }
  const other = await createAt(f, join(f.dir, 'truthy-usage'), truthy, { ...f.binding, ...migrationDomainAuditInputDigests(truthy) })
  assert.equal(other.status, 'needs-context')
  assert.equal((await verifyAt(f, join(f.dir, 'truthy-usage'), { ...f.binding, ...migrationDomainAuditInputDigests(truthy) })).status, 'needs-context')
  // Unknown layout fields are refused against the consumer's real field set.
  await assert.rejects(createAt(f, join(f.dir, 'unknown-layout'), { ...f.input, layout: { ...f.input.layout, usageDatabase: null } }), { code: 'MIGRATION_DOMAIN_INPUT_INVALID' })
  assert.equal(await missing(join(f.dir, 'unknown-layout')), true)
})

test('domain evidence: a root alias is not accepted as canonical root coverage', async t => {
  const f = await fixture(t), alias = join(f.dir, 'bot-alias')
  await symlink(f.bot, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const expected = structuredClone(f.binding)
  expected.domains[0].roots = [alias]
  expected.domainsDigest = sha(json(expected.domains))
  await assert.rejects(createAt(f, f.privateOutput, f.input, expected), { code: 'MIGRATION_DOMAIN_ROOT_COVERAGE_MISMATCH' })
})

test('domain evidence: the persisted artifact pins the fixed capability and coverage constants', async t => {
  const f = await fixture(t)
  await create(f)
  const artifact = await artifactOf(f)
  assert.equal(artifact.schemaVersion, 2)
  assert.equal(artifact.kind, 'private-migration-domain-audit-artifact')
  assert.equal(artifact.coverage, 'captured-declared-roots-only')
  for (const key of ['crossDomainConsistent', 'databaseConsistent', 'applySupported', 'activationSupported', 'postActivationRollbackSupported', 'stopWriteProvable', 'permissionsRestored']) assert.equal(artifact[key], false, key)
  for (const key of ['requiresCompleteDomainReview', 'requiresStopProof']) assert.equal(artifact[key], true, key)
  assert.deepEqual(Object.keys(artifact).sort(), ['activationSupported', 'applySupported', 'binding', 'coverage', 'crossDomainConsistent', 'databaseConsistent', 'input', 'inventoryObservation', 'kind', 'permissionsRestored', 'postActivationRollbackSupported', 'requiresCompleteDomainReview', 'requiresStopProof', 'result', 'schemaVersion', 'stopWriteProvable'])
})

test('domain evidence: a relaxed artifact root or file is refused on re-verification', async t => {
  if (process.platform === 'win32') {
    t.skip('POSIX permission bits have no Windows equivalent; the read-only ACL check itself is exercised on every verification here')
    return
  }
  const f = await fixture(t)
  await create(f)
  await chmod(f.privateOutput, 0o755)
  await assert.rejects(verify(f), { code: 'MIGRATION_DOMAIN_ARTIFACT_INVALID' })
  await chmod(f.privateOutput, 0o700)
  assert.equal((await verify(f)).status, 'audited')
  await chmod(join(f.privateOutput, 'domain-audit.private.json'), 0o644)
  await assert.rejects(verify(f), { code: 'MIGRATION_DOMAIN_ARTIFACT_INVALID' })
  await chmod(join(f.privateOutput, 'domain-audit.private.json'), 0o600)
  assert.equal((await verify(f)).status, 'audited')
})

test('domain evidence: Windows ACL widening is refused for both the artifact root and file', async t => {
  if (process.platform !== 'win32') { t.skip('Windows ACL regression'); return }
  const f = await fixture(t)
  await create(f)
  const icacls = join(process.env.SystemRoot || 'C:/Windows', 'System32', 'icacls.exe')
  for (const path of [f.privateOutput, join(f.privateOutput, 'domain-audit.private.json')]) {
    execFileSync(icacls, [path, '/grant', '*S-1-1-0:(R)'], { windowsHide: true, stdio: 'pipe' })
    try { await assert.rejects(verify(f), { code: 'MIGRATION_DOMAIN_ARTIFACT_INVALID' }) }
    finally { execFileSync(icacls, [path, '/remove:g', '*S-1-1-0'], { windowsHide: true, stdio: 'pipe' }) }
    assert.equal((await verify(f)).status, 'audited')
  }
})

test('domain evidence: an aliased or nested private output is never created inside a source', async t => {
  const f = await fixture(t)
  const alias = join(f.dir, 'evidence-alias')
  await symlink(f.bot, alias, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(createAt(f, alias), { code: 'MIGRATION_DOMAIN_ARTIFACT_INVALID' })
  await assert.rejects(createAt(f, join(alias, 'nested')), { code: 'MIGRATION_PRIVATE_OUTPUT_OVERLAPS_SOURCE' })
  assert.deepEqual((await readdir(f.bot)).sort(), ['secrets.json', 'state.json'])
  for (const output of [join(f.home, 'evidence'), join(f.dataArchive, 'evidence'), join(f.ledgerArchive, 'evidence'), join(f.router, 'evidence')]) {
    await assert.rejects(createAt(f, output), { code: 'MIGRATION_PRIVATE_OUTPUT_OVERLAPS_SOURCE' }, output)
  }
})

test('domain evidence: a re-entered binding with a different key order verifies identically', async t => {
  const f = await fixture(t)
  const created = await create(f)
  const reordered = {}
  for (const key of Object.keys(f.binding).reverse()) reordered[key] = f.binding[key]
  reordered.domains = f.binding.domains.map(domain => ({ roots: domain.roots, name: domain.name }))
  assert.notDeepEqual(Object.keys(reordered), Object.keys(f.binding))
  assert.deepEqual(await verify(f, reordered), created)
})

test('domain evidence: another operation identity is refused and never overwrites the artifact', async t => {
  const f = await fixture(t)
  await create(f)
  const before = await readFile(join(f.privateOutput, 'domain-audit.private.json'))
  await assert.rejects(verify(f, { ...f.binding, operationId: randomUUID() }), { code: 'MIGRATION_DOMAIN_OPERATION_MISMATCH' })
  await assert.rejects(verify(f, { ...f.binding, operationDigest: '1'.repeat(64) }), { code: 'MIGRATION_DOMAIN_OPERATION_MISMATCH' })
  await assert.rejects(createAt(f, f.privateOutput, f.input, { ...f.binding, operationId: randomUUID() }), { code: 'MIGRATION_DOMAIN_ARTIFACT_CONFLICT' })
  assert.deepEqual(await readFile(join(f.privateOutput, 'domain-audit.private.json')), before)
})

test('domain evidence: unusable output paths fail closed with stable codes and no absolute paths', async t => {
  const f = await fixture(t)
  const file = join(f.dir, 'evidence-is-a-file')
  await writeFile(file, 'NOT-A-DIRECTORY\n')
  const attempts = [
    [() => verifyAt(f, join(f.dir, 'absent-evidence')), 'MIGRATION_DOMAIN_ARTIFACT_INCOMPLETE'],
    [() => verifyAt(f, join(f.dir, 'absent', 'evidence')), 'MIGRATION_DOMAIN_ARTIFACT_INCOMPLETE'],
    [() => verifyAt(f, file), 'MIGRATION_DOMAIN_ARTIFACT_INVALID'],
    [() => createAt(f, join(f.dir, 'absent', 'evidence')), 'MIGRATION_DOMAIN_ARTIFACT_INVALID'],
    [() => createAt(f, file), 'MIGRATION_DOMAIN_ARTIFACT_INVALID'],
  ]
  for (const [run, code] of attempts) {
    const error = await run().then(() => null, error => error)
    assert.equal(error?.code, code)
    assert.equal(error.message.includes(f.dir), false, error.message)
    assert.equal(JSON.stringify(error.details ?? null).includes(f.dir), false)
  }
})
