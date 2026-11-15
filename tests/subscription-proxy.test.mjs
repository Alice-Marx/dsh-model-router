import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { openSubscriptionProxy, subscriptionAuthUrl, SUBSCRIPTION_PROVIDERS } from '../packages/orchestration/src/subscription-proxy.mjs'
import { attachNativeLlm } from './helpers/product-native-llm.mjs'
import { subscriptionFixture } from './helpers/subscription-proxy-fixture.mjs'
const Database = createRequire(import.meta.url)('better-sqlite3'), owner = { kind: 'owner' }
async function setup(work, options = {}) {
  const base = resolve('tmp/integration/subscription-proxy-tests'); await mkdir(base, { recursive: true }); const home = await mkdtemp(join(base, 'case-'))
  const gateway = await subscriptionFixture(), host = { state: {}, upstream: [] }, release = await attachNativeLlm(host), file = join(home, 'accounts.sqlite')
  let service = openSubscriptionProxy({ Database, file, llm: host.llm, runtime: gateway.runtime, ...options })
  try { await work({ service, gateway, host, file, replace: value => { service = value } }) }
  finally { await service.close(); await release(); await gateway.close() }
}
test('OAuth-only accounts mint distinct prefixed routes; keys and raw OAuth records stay outside owner views and SQLite', async () => setup(async ({ service, gateway, host, file }) => {
  gateway.addAccount(); gateway.addAccount('fixture-second-account.json')
  gateway.addAccount('config-api-key', { runtime_only: true, source: 'config' })
  await assert.rejects(service.refresh({}, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
  const view = await service.refresh({}, owner)
  assert.equal(view.accounts.length, 2); assert.equal(service.routes().length, 2)
  const [first, second] = view.accounts
  assert.notEqual(first.provider, second.provider); assert.notEqual(first.models[0].id, second.models[0].id)
  assert.equal(first.state, 'configured'); assert.equal(first.missingModels.length, 1)
  assert.equal(service.metadata(first.provider).fundingModes[0], 'subscription')
  assert.equal((await host.llm.listModels(first.provider)).length, 1)
  const info = await host.llm.resolveModelInfo(first.provider, first.models[0].id)
  assert.deepEqual(info.reasoning.efforts.map(x => x.id), ['low', 'high', 'xhigh']); assert.equal(info.defaultMaxTokens, 64)
  assert.doesNotMatch(JSON.stringify(view), /fixture-private-oauth-token|fixture-subscription-.*key|authName|access_token|managementKey/)
  const db = new Database(file, { readonly: true }); try { assert.doesNotMatch(JSON.stringify(db.prepare('SELECT payload FROM bot_subscription_accounts').all()), /fixture-private-oauth-token|fixture-subscription-.*key/) } finally { db.close() }
  assert.ok(service.routes().every(route => !route.model.includes('unprefixed-api-model')))
}))
test('the real LLM SDK prepares and streams a subscription model through the gateway, with usage and admitted output cap', async () => setup(async ({ service, gateway, host }) => {
  gateway.addAccount(); const account = (await service.refresh({}, owner)).accounts[0]
  const prepared = await host.llm.prepareCall({ provider: account.provider, model: account.models[0].id, reasoningEffort: 'xhigh' })
  assert.equal(prepared.config.maxTokens, 64)
  const chunks = []; for await (const part of prepared.stream({ ...prepared.config, messages: [{ role: 'user', content: [{ type: 'text', text: 'offline subscription check' }] }] })) chunks.push(part)
  assert.ok(chunks.some(part => part.type === 'text-delta' && part.text === 'SUBSCRIPTION-OK'))
  assert.ok(chunks.some(part => part.type === 'usage' && part.usage.inputTokens === 12))
  assert.equal(gateway.requests[0].authorization, 'Bearer ' + gateway.key)
  assert.equal(gateway.requests[0].body.max_tokens ?? gateway.requests[0].body.max_completion_tokens, 64)
  assert.equal(gateway.requests[0].body.reasoning_effort, 'xhigh')
  assert.equal(service.list(owner).accounts[0].state, 'ready')
}))
test('login sessions survive an owner-page reopen, complete model synchronization, and never accept caller-supplied OAuth state', async () => setup(async ({ service, gateway }) => {
  assert.throws(() => service.enable({ endpoint: 'https://untrusted.invalid' }, owner), { code: 'SUBSCRIPTION_INVALID' })
  await assert.rejects(service.login({ provider: 'codex', state: 'chosen-by-model' }, owner), { code: 'SUBSCRIPTION_INVALID' })
  const login = await service.login({ provider: 'codex' }, owner)
  assert.equal(new URL(login.url).hostname, 'auth.openai.com'); assert.equal(service.list(owner).pendingLogins[0].loginId, login.loginId)
  assert.deepEqual(await service.loginStatus({ loginId: login.loginId }, owner), { status: 'pending' })
  gateway.addAccount(); gateway.completeLogin()
  const finished = await service.loginStatus({ loginId: login.loginId }, owner)
  assert.equal(finished.status, 'complete'); assert.equal(finished.view.accounts.length, 1); assert.equal(finished.view.pendingLogins.length, 0)
  const cancelled = await service.login({ provider: 'codex' }, owner)
  await service.cancelLogin({ loginId: cancelled.loginId }, owner)
  assert.equal(service.list(owner).pendingLogins.length, 0)
  await assert.rejects(service.loginStatus({ loginId: cancelled.loginId }, owner), { code: 'SUBSCRIPTION_LOGIN_EXPIRED' })
}))
test('manual callback accepts only the original loopback destination and state, relays no caller-selected provider, and waits for confirmed login', async () => setup(async ({ service, gateway }) => {
  const login = await service.login({ provider: 'codex' }, owner), state = new URL(login.url).searchParams.get('state')
  assert.equal(login.supportsCallback, true)
  for (const callbackUrl of [
    'http://localhost:1455/auth/callback?code=fixture&state=wrong-state',
    'https://attacker.invalid/auth/callback?code=fixture&state=' + state,
    'http://localhost:1455/other?code=fixture&state=' + state,
    'http://localhost:1455/auth/callback?code=fixture&state=' + state + '&state=' + state,
  ]) await assert.rejects(service.callback({ loginId: login.loginId, callbackUrl }, owner), { code: 'SUBSCRIPTION_CALLBACK_INVALID' })
  assert.equal(gateway.operations.filter(item => item.path === '/v8/management/oauth/callback').length, 0)
  const callbackUrl = 'http://localhost:1455/auth/callback?code=fixture-one-time-code&state=' + state
  await assert.rejects(service.callback({ loginId: login.loginId, callbackUrl, provider: 'claude' }, owner), { code: 'SUBSCRIPTION_INVALID' })
  await assert.rejects(service.callback({ loginId: login.loginId, callbackUrl }, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
  assert.deepEqual(await service.callback({ loginId: login.loginId, callbackUrl }, owner), { accepted: true })
  assert.deepEqual(gateway.operations.find(item => item.path === '/v8/management/oauth/callback').body, { provider: 'codex', state, code: 'fixture-one-time-code' })
  assert.doesNotMatch(JSON.stringify(service.list(owner)), /fixture-one-time-code/)
  assert.deepEqual(await service.loginStatus({ loginId: login.loginId }, owner), { status: 'pending' })
  await assert.rejects(service.callback({ loginId: login.loginId, callbackUrl }, owner), { code: 'SUBSCRIPTION_CALLBACK_SUBMITTED' })
  gateway.addAccount(); gateway.completeLogin()
  assert.equal((await service.loginStatus({ loginId: login.loginId }, owner)).status, 'complete')
}))
test('captured generations cannot dispatch after account disable, restart, logout or a stale account revision', async () => setup(async ({ service, gateway, host }) => {
  const raw = gateway.addAccount(); let account = (await service.refresh({}, owner)).accounts[0]
  const prepare = () => host.llm.prepareCall({ provider: account.provider, model: account.models[0].id })
  const first = await prepare(); raw.disabled = true; await service.refresh({}, owner)
  const firstChunks = []; for await (const part of first.stream({ ...first.config, messages: [] })) firstChunks.push(part)
  assert.equal(firstChunks.at(-1).reason.kind, 'error')
  assert.equal(gateway.requests.length, 0); assert.equal(service.routes().length, 0)
  raw.disabled = false; account = (await service.refresh({}, owner)).accounts[0]
  const second = await prepare(); gateway.restart()
  const secondChunks = []; for await (const part of second.stream({ ...second.config, messages: [] })) secondChunks.push(part)
  assert.equal(secondChunks.at(-1).reason.kind, 'error')
  assert.equal(gateway.requests.length, 0)
  await assert.rejects(service.remove({ id: account.id, expectedRevision: 0 }, owner), { code: 'SUBSCRIPTION_CONFLICT' })
  await service.remove({ id: account.id, expectedRevision: account.revision }, owner)
  assert.equal(service.routes().length, 0); assert.equal(service.list(owner).accounts.length, 0)
}))
test('redirected or non-provider authorization URLs are refused before a browser link is returned', () => {
  const codex = SUBSCRIPTION_PROVIDERS.find(p => p.id === 'codex')
  for (const url of ['javascript:alert(1)', 'http://auth.openai.com/login', 'https://openai.com.attacker.invalid/login', 'https://user:secret@auth.openai.com/login']) assert.throws(() => subscriptionAuthUrl(url, codex), { code: 'SUBSCRIPTION_AUTH_URL' })
  assert.equal(subscriptionAuthUrl('https://auth.openai.com/authorize?state=fixture', codex), 'https://auth.openai.com/authorize?state=fixture')
})
test('a corrupt persisted model cannot cross the account namespace', async () => setup(async ({ service, gateway, file }) => {
  gateway.addAccount(); const account = (await service.refresh({}, owner)).accounts[0]
  const db = new Database(file); try { const row = db.prepare('SELECT payload FROM bot_subscription_accounts WHERE id=?').get(account.id), value = JSON.parse(row.payload); value.models[0].id = 'another-account/model'; db.prepare('UPDATE bot_subscription_accounts SET payload=? WHERE id=?').run(JSON.stringify(value), account.id) } finally { db.close() }
  assert.throws(() => service.list(owner), { code: 'SUBSCRIPTION_STORE_INVALID' })
}))
