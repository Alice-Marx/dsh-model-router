import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { openSubscriptionAccounts } from '../packages/orchestration/src/subscription-accounts.mjs'
import { normalizeConversationEngines } from '../packages/bot-engines/src/host-registrations.mjs'
import { subscriptionFixture, pendingSubscription } from './helpers/subscription-account-fixture.mjs'

const Database = createRequire(import.meta.url)('better-sqlite3')
const owner = { kind: 'owner' }
const legacyId = 'f'.repeat(32)
const legacy = { name: '旧账户', kind: 'codex', authFile: 'fixture-old-secret-path' }
async function setup(run) {
  const base = resolve('tmp/integration/subscription-accounts')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(join(base, 'case-'))
  const file = join(directory, 'state.sqlite')
  const db = new Database(file)
  db.exec('CREATE TABLE bot_subscription_accounts (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, health TEXT)')
  db.prepare('INSERT INTO bot_subscription_accounts VALUES(?,?,?,NULL)').run(legacyId, 1, JSON.stringify(legacy))
  db.close()
  const fixture = await subscriptionFixture(directory), usage = new Map()
  let time = 100_000, changes = 0
  const options = { Database, file, backend: fixture.backend, now: () => time,
    usedBy: provider => usage.get(provider) ?? [], checkProfiles: normalizeConversationEngines,
    onChanged: () => { changes++ } }
  const service = openSubscriptionAccounts(options)
  const dispatch = (action, input) => service[action](input, owner)
  const authorize = async fields => {
    const login = await pendingSubscription(dispatch)
    await fixture.complete(login.loginId, fields)
    const result = await dispatch('loginStatus', { loginId: login.loginId })
    assert.equal(result.status, 'complete')
    return result.view.accounts.find(account => account.id === login.loginId)
  }
  try { await run({ service, fixture, usage, dispatch, authorize, file, options, tick: ms => { time += ms }, changes: () => changes }) }
  finally { await service.close() }
}

test('a vendor authorization creates isolated routes, quotas and models and preserves old records through a restart', () => setup(async ({
  service, authorize, fixture, options, file, changes, dispatch, tick,
}) => {
  assert.throws(() => service.list({ kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
  await assert.rejects(service.login({ provider: 'codex' }, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
  const first = await authorize(), second = await authorize({ email: 'other@example.invalid' })
  assert.equal(first.state, 'configured')
  assert.notEqual(first.models[0].provider, second.models[0].provider)
  assert.equal(first.models[0].id, second.models[0].id)
  assert.equal(service.routes().length, 2)
  assert.equal(service.list(owner).accounts.find(account => account.id === legacyId).state, 'legacy')
  assert.ok(service.owns('bot-sub-' + legacyId))
  assert.equal(changes(), 2)
  const firstProfile = service.profiles()[0]
  assert.ok(await service.credentialHome(firstProfile))
  assert.throws(() => service.callback({ loginId: first.id, callbackUrl: 'http://127.0.0.1:1455/auth/callback' }, owner), { code: 'SUBSCRIPTION_CALLBACK_UNSUPPORTED' })
  const initialReading = service.accountQuotas()[0].reading
  fixture.accounts.get(first.id).windows = initialReading.windows.map(window => ({ ...window, remainingPercent: 43 }))
  await service.refreshQuotas(owner)
  assert.deepEqual(service.accountQuotas()[0].reading, initialReading)
  tick(31_000)
  await service.refreshQuotas(owner)
  assert.equal(service.accountQuotas()[0].reading.windows[0].remainingPercent, 43)
  assert.equal(service.profiles()[0].revision, firstProfile.revision)
  fixture.accounts.get(first.id).models = [{ id: first.models[0].id, name: 'Updated model display name' }]
  await dispatch('refresh', {})
  await assert.rejects(service.credentialHome(firstProfile), { code: 'SUBSCRIPTION_ROUTE_CHANGED' })
  const restarted = openSubscriptionAccounts(options)
  try { assert.deepEqual(restarted.routes(), service.routes()); assert.deepEqual(restarted.accountQuotas(), service.accountQuotas()) }
  finally { await restarted.close() }
  assert.doesNotMatch(JSON.stringify(service.list(owner)), /private-oauth-token|fixture-old-secret-path|scriptSha256/)
  const persisted = new Database(file)
  try { assert.equal(persisted.prepare('SELECT payload FROM bot_subscription_accounts WHERE id=?').get(legacyId).payload, JSON.stringify(legacy)) }
  finally { persisted.close() }
}))

test('pending authorization is shared across page reloads and cancelled or failed preparations can be retried', () => setup(async ({ service, dispatch, fixture }) => {
  const preparation = Promise.withResolvers()
  fixture.prepare = async ({ signal }) => {
    await Promise.race([preparation.promise, new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))])
  }
  const started = await dispatch('login', { provider: 'codex' })
  assert.equal(started.preparing, true)
  assert.deepEqual(service.list(owner).pendingLogins, [started])
  assert.deepEqual(await dispatch('login', { provider: 'codex' }), started)
  assert.equal((await dispatch('loginStatus', { loginId: started.loginId })).status, 'preparing')
  await dispatch('cancelLogin', { loginId: started.loginId })
  assert.ok(!fixture.operations.some(event => event.kind === 'login'))
  fixture.prepare = async () => { throw Object.assign(new Error('请安装 Codex。'), { code: 'SUBSCRIPTION_CODEX_REQUIRED' }) }
  const failed = await dispatch('login', { provider: 'codex' })
  const failure = await dispatch('loginStatus', { loginId: failed.loginId })
  assert.deepEqual(failure, { status: 'error', code: 'SUBSCRIPTION_CODEX_REQUIRED', message: '请安装 Codex。' })
  assert.equal(service.list(owner).pendingLogins.length, 0)
  fixture.prepare = async () => {}
  const retried = await pendingSubscription(dispatch)
  assert.equal(new URL(retried.url).hostname, 'auth.openai.com')
  assert.notEqual(retried.loginId, failed.loginId)
}))

test('a failed catalog admission closes authorization and discards its unpublished credentials', () => setup(async ({ service, dispatch, fixture }) => {
  const login = await pendingSubscription(dispatch)
  await fixture.complete(login.loginId, { models: Array.from({ length: 65 }, (_, index) => ({ id: 'model-' + index, name: 'Fixture ' + index })) })
  await assert.rejects(dispatch('loginStatus', { loginId: login.loginId }), { code: 'CONVERSATION_ENGINE_CONFIG_INVALID' })
  assert.equal(service.routes().length, 0)
  assert.equal(service.list(owner).pendingLogins.length, 0)
  assert.equal(fixture.accounts.size, 0)
  assert.ok(fixture.operations.some(event => event.kind === 'close' && event.id === login.loginId))
}))

test('binding protects an account from logout and an expired account withdraws its models and quota', () => setup(async ({
  service, authorize, dispatch, usage, fixture, tick,
}) => {
  const account = await authorize()
  usage.set(account.models[0].provider, [{ id: 'bot', name: 'Fixture Bot' }])
  const profile = service.profiles()[0]
  await assert.rejects(service.credentialHome({ ...profile, entry: { ...profile.entry, sha256: '0'.repeat(64) } }), { code: 'SUBSCRIPTION_ROUTE_CHANGED' })
  await assert.rejects(dispatch('remove', { id: account.id, expectedRevision: 0 }), { code: 'SUBSCRIPTION_CONFLICT' })
  await assert.rejects(dispatch('remove', { id: account.id, expectedRevision: account.revision }), { code: 'SUBSCRIPTION_IN_USE' })
  fixture.accounts.delete(account.id)
  tick(31_000)
  await service.refreshQuotas(owner)
  const expired = service.list(owner).accounts.find(item => item.id === account.id)
  assert.equal(expired.state, 'needs-login')
  assert.equal(service.routes().length, 0)
  assert.equal(service.accountQuotas()[0].reading, null)
  await assert.rejects(service.credentialHome(profile), { code: 'SUBSCRIPTION_ROUTE_CHANGED' })
  usage.clear()
  await dispatch('remove', { id: account.id, expectedRevision: expired.revision })
  assert.deepEqual(service.list(owner).accounts.map(item => item.id), [legacyId])
}))
