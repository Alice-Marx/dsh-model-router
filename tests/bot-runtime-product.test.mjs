import test from 'node:test'
import assert from 'node:assert/strict'
import { createProductReadModel, registerProductChannel } from '../modules/bot-runtime/read-model.mjs'
import { createProductApi, money, modelName } from '../apps/integration-client/api.mjs'
import { verifyProductSource } from '../scripts/integration-product-source.mjs'
import { bundleProductClient } from '../scripts/integration-product-client.mjs'

function runtime() {
  return { state: { bots: { main: { id: 'main', name: 'Main', model: 'fixture/gpt-exact', role: '主助理' } }, mainBotIds: ['main'] },
    load: async () => {}, chatOf: id => `${id}-session`, readOnly: () => undefined }
}
const lifecycle = { status: () => ({ healthy: true, revision: 3 }) }

test('bot product: vendored source matches the current DS Bot bytes and has no hidden additions', async () => {
  const result = await verifyProductSource()
  assert.equal(result.status, 'passed')
  assert.ok(result.files > 297)
})

test('bot product: missing services are explicit blockers; Bot identity comes from persisted runtime', async () => {
  const value = await createProductReadModel({ runtime: runtime(), lifecycle }).snapshot()
  assert.equal(value.schemaVersion, 1)
  assert.equal(value.mainBotId, 'main')
  assert.equal(value.bots[0].sessionId, 'main-session')
  assert.equal(value.bots[0].model, 'fixture/gpt-exact')
  for (const key of ['bindings', 'tasks', 'machines', 'usage']) {
    assert.equal(value[key].status, 'blocked'); assert.ok(value[key].reason); assert.ok(value[key].nextAction)
  }
  assert.deepEqual(value.availableActions, [])
})

test('bot product: read failures preserve explicit unknowns and do not mutate provider data', async () => {
  const items = [{ id: 'existing', state: 'needs-reconciliation' }]
  const model = createProductReadModel({ runtime: runtime(), lifecycle, providers: {
    tasks: () => ({ status: 'available', items }), machines: () => ({ status: 'available' }), usage: () => { throw new Error('database unavailable') },
  } })
  const value = await model.snapshot()
  value.tasks.items[0].state = 'succeeded'
  assert.equal(items[0].state, 'needs-reconciliation')
  assert.equal(value.machines.status, 'blocked')
  assert.match(value.usage.reason, /database unavailable/)
  assert.equal(money(null), '未知（待收据核对）')
  assert.equal(money(0), 'USD 0.000000')
  assert.equal(modelName({ provider: 'fixture', id: 'gpt-exact' }), 'fixture/gpt-exact')
})

test('bot product: actions use trusted auth context and read-only lifecycle blocks mutations', async () => {
  const rt = runtime()
  let accepted
  const model = createProductReadModel({ runtime: rt, lifecycle, actions: { 'task.cancel': (payload, context) => { accepted = { payload, context }; return 'cancelled' } } })
  assert.equal(await model.dispatch({ action: 'task.cancel', payload: { taskId: 'one', kind: 'owner' } }, { kind: 'owner', principalId: 'trusted' }), 'cancelled')
  assert.equal(accepted.context.principalId, 'trusted')
  assert.equal(accepted.payload.kind, 'owner')
  await assert.rejects(model.dispatch({ action: 'task.cancel', botId: 'forged' }, { kind: 'owner' }), /未知或格式无效/)
  await assert.rejects(model.dispatch({ action: 'binding.save', payload: {} }, { kind: 'owner' }), /尚未接入/)
  await assert.rejects(model.dispatch({ action: 'task.cancel', payload: { kind: 'owner' } }), /已认证/)
  rt.readOnly = () => 'another host owns this team'
  await assert.rejects(model.dispatch({ action: 'task.cancel', payload: {} }, { kind: 'owner' }), /another host/)
})

test('bot product: unauthenticated channel cannot read roster or invoke actions', async () => {
  let route, reads = 0, dispatched
  const ctx = { connection: { fetch: { register(value) { route = value; return () => {} } } } }
  const model = { snapshot: async () => { reads++; return { schemaVersion: 1 } }, dispatch: async (body, context) => { dispatched = { body, context }; return 'accepted' } }
  registerProductChannel(ctx, model, request => request.headers.get('x-test-auth') === 'verified' ? { kind: 'owner', principalId: 'fixture-owner' } : null)
  const request = (body, auth = false) => new Request('http://localhost/api/bot-product', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { 'x-test-auth': 'verified' } : {}) }, body: JSON.stringify(body) })
  assert.equal((await route.fetch(request({ action: 'snapshot' }))).status, 403)
  assert.equal(reads, 0)
  const allowed = await (await route.fetch(request({ action: 'snapshot' }, true))).json()
  assert.equal(allowed.ok, true); assert.equal(reads, 1)
  await route.fetch(request({ action: 'task.cancel', payload: { taskId: 'one' } }, true))
  assert.equal(dispatched.context.principalId, 'fixture-owner')
  assert.ok(dispatched.context.signal instanceof AbortSignal)
})

test('bot product: browser requests remain base-relative and carry cookies; absent host is actionable', async () => {
  let captured
  const api = createProductApi(async (url, options) => { captured = { url, options }; return Response.json({ ok: true, value: { schemaVersion: 1 } }) })
  await api.snapshot()
  assert.equal(captured.url, 'api/bot-product')
  assert.equal(captured.options.credentials, 'same-origin')
  assert.deepEqual(JSON.parse(captured.options.body), { action: 'snapshot' })
  await assert.rejects(createProductApi(async () => new Response('', { status: 404 })).snapshot(), /更新宿主/)
})

test('bot product: native viewer origin survives the protocol bridge without changing owner admission', async () => {
  let route, dispatched
  const ctx = { connection: { fetch: { register(value) { route = value; return () => {} } } } }
  registerProductChannel(ctx, { dispatch: async (body, context) => { dispatched = { body, context }; return 'accepted' } },
    request => request.headers.get('x-test-auth') === 'verified' ? { kind: 'owner' } : null)
  const request = (origin, auth = true) => new Request('http://127.0.0.1:49168/api/bot-product', { method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { 'x-test-auth': 'verified' } : {}), ...(origin === undefined ? {} : { 'x-dsh-desktop-origin': origin }) },
    body: JSON.stringify({ action: 'machine.desktop.open', payload: { machineId: 'machine-a', clientOrigin: 'https://forged.example' } }) })
  assert.equal((await route.fetch(request('dsh-app://app', false))).status, 403)
  assert.equal(dispatched, undefined)
  assert.equal((await route.fetch(request('dsh-app://app'))).status, 200)
  assert.equal(dispatched.context.clientOrigin, 'dsh-app://app')
  await route.fetch(request(undefined))
  assert.equal(dispatched.context.clientOrigin, 'http://127.0.0.1:49168')
  for (const origin of ['null', 'dsh-app://other', 'dsh-app://app/', 'https://attacker.example']) {
    assert.equal((await (await route.fetch(request(origin))).json()).error.code, 'INVALID_CLIENT_ORIGIN')
  }
  const sent = []
  const fetcher = async (url, options) => { sent.push(options); return Response.json({ ok: true, value: {} }) }
  const native = createProductApi(fetcher, { protocol: 'dsh-app:', host: 'app' })
  await native.dispatch('machine.desktop.open', {})
  await native.dispatch('machine.desktop.renew', {})
  await native.snapshot()
  await createProductApi(fetcher, { protocol: 'https:', host: 'owner.example' }).dispatch('machine.desktop.open', {})
  await createProductApi(fetcher, { protocol: 'dsh-app:', host: 'other' }).dispatch('machine.desktop.open', {})
  assert.deepEqual(sent.map(options => options.headers['x-dsh-desktop-origin']), ['dsh-app://app', 'dsh-app://app', undefined, undefined, undefined])
})

test('bot product: one real browser bundle includes every DS feature and MR advanced panel', async () => {
  const result = await bundleProductClient()
  for (const feature of ['side-chat.js', 'speech.js', 'memory-panel.js', 'schedules.js', 'capability-settings.js', 'group-settings.js', 'bot-settings.js', 'usage-page.js']) {
    assert.ok(result.inputs.some(path => path.endsWith(`/client/${feature}`)), feature)
  }
  assert.ok(result.inputs.some(path => path.endsWith('/client/router-main.jsx')))
  assert.equal((result.code.match(/window\.__ModuleLoader__\.load\(/g) ?? []).length, 1)
  assert.ok(result.code.includes('bot-product-bindings'))
  assert.ok(result.code.includes('bot-product-machines'))
})
