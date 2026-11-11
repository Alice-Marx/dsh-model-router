import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createProductReadModel } from '../modules/bot-runtime/read-model.mjs'

test('every declared product action reaches its registered handler through the real dispatcher', async () => {
  const contract = JSON.parse(await readFile(new URL('../contracts/product-action/v1/actions.json', import.meta.url), 'utf8'))
  const names = Object.keys(contract.actions)
  assert.ok(names.length >= 70)
  const calls = []
  const actions = Object.fromEntries(names.map(name => [name, (payload, context) => {
    calls.push(name)
    assert.equal(context.kind, 'owner')
    assert.equal(payload.marker, name)
    return name
  }]))
  const model = createProductReadModel({ runtime: { readOnly: () => undefined }, actions })
  for (const action of names) assert.equal(await model.dispatch({ action, payload: { marker: action } }, { kind: 'owner' }), action)
  assert.deepEqual(calls, names)
})

test('read-only recovery permits observation with trusted readOnly context but blocks chat sends and cancellations', async () => {
  const reads = ['independentChat.view', 'independentChat.inspect', 'independentChat.messages']
  const writes = ['independentChat.send', 'independentChat.cancel', 'independentChat.newConversation', 'botProfile.save']
  const calls = []
  let readOnlyChecks = 0
  const actions = Object.fromEntries([...reads, ...writes].map(name => [name, (_payload, context) => { calls.push(name); return context }]))
  const model = createProductReadModel({ runtime: { readOnly: () => { readOnlyChecks++; return 'recovery pending' } }, actions })
  for (const action of reads) {
    const context = await model.dispatch({ action }, { kind: 'owner', readOnly: false, ownerId: 'owner' })
    assert.equal(context.readOnly, true)
    assert.equal(context.ownerId, 'owner')
  }
  for (const action of writes) await assert.rejects(model.dispatch({ action }, { kind: 'owner' }), { code: 'PRODUCT_READ_ONLY' })
  assert.deepEqual(calls, reads)
  assert.equal(readOnlyChecks, reads.length + writes.length)
})

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
