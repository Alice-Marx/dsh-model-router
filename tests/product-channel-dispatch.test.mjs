import test from 'node:test'
import assert from 'node:assert/strict'
import { createProductReadModel } from '../modules/bot-runtime/read-model.mjs'

test('the authenticated product channel reaches the library, routines, routing and history handlers used by its pages', async () => {
  const names = ['task.inspect', 'library.list', 'library.read', 'library.write', 'routine.list', 'routine.run', 'roles.list',
    'botRoutingInspect', 'botRoutingDecide', 'botRouting.dispatch', 'botRouting.status', 'botRuntimeStatus', 'botRuntimeHistory',
    'botRuntimeMessage', 'botRuntimeMove', 'machine.artifact']
  const calls = []
  const actions = Object.fromEntries(names.map(name => [name, async (payload, context) => {
    calls.push({ name, payload, kind: context.kind })
    return { accepted: name }
  }]))
  const model = createProductReadModel({ runtime: { readOnly: () => undefined }, actions })
  for (const action of names) {
    assert.deepEqual(await model.dispatch({ action, payload: { botId: 'bot-a' } }, { kind: 'owner' }), { accepted: action })
  }
  assert.equal(calls.length, names.length)
  assert.ok(calls.every(row => row.kind === 'owner' && row.payload.botId === 'bot-a'))
})

test('product actions still require the owner and reject unregistered or unknown actions', async () => {
  let reached = false
  const model = createProductReadModel({ runtime: { readOnly: () => undefined },
    actions: { 'library.write': () => { reached = true }, 'execute-anything': () => { reached = true } } })
  await assert.rejects(model.dispatch({ action: 'library.write' }, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
  await assert.rejects(model.dispatch({ action: 'botRouting.status', payload: { requesterBotId: 'main', requestKey: 'key' } }, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
  await assert.rejects(model.dispatch({ action: 'execute-anything' }, { kind: 'owner' }), { code: 'INVALID_PRODUCT_ACTION' })
  await assert.rejects(model.dispatch({ action: 'library.upload' }, { kind: 'owner' }), { code: 'PRODUCT_ACTION_UNAVAILABLE' })
  assert.equal(reached, false)
})
