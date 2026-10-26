import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthority, PolicyError } from '../packages/capability-broker/src/authority.mjs'

const binding = { taskId: 'task-a', attemptId: 'attempt-1', machineId: 'machine-a', workspaceId: 'workspace-a', location: 'remote' }
function fixture(options) {
  const authority = createAuthority(options)
  const a = { id: 'agent-a' }, b = { id: 'agent-b' }
  authority.register(a, { botId: 'bot-a', tools: ['read', 'write'], modelRoutes: [{ provider: 'fixture', model: 'gpt-bound' }] })
  authority.register(b, { botId: 'bot-b', tools: ['read'], modelRoutes: [{ provider: 'fixture', model: 'gpt-other' }] })
  return { authority, a, b }
}
const code = expected => error => error instanceof PolicyError && error.code === expected

test('capability: a copied id or JSON actor does not acquire authority', () => {
  const { authority, a } = fixture()
  authority.assertTool(a, 'write')
  assert.throws(() => authority.assertTool({ ...a }, 'write'), code('UNKNOWN_SUBJECT'))
  assert.throws(() => authority.assertTool(JSON.parse('{"id":"agent-a","botId":"bot-a"}'), 'write'), code('UNKNOWN_SUBJECT'))
  assert.throws(() => authority.register({}, { botId: 'bot-a' }), code('DUPLICATE_SUBJECT'))
})

test('capability: exact model and tool grants reject substitutions', () => {
  const { authority, a, b } = fixture()
  authority.assertModel(a, 'fixture', 'gpt-bound')
  assert.throws(() => authority.assertModel(a, 'fixture', 'gpt-other'), code('MODEL_DENIED'))
  assert.throws(() => authority.assertModel(a, 'other', 'gpt-bound'), code('MODEL_DENIED'))
  assert.throws(() => authority.assertTool(b, 'write'), code('TOOL_DENIED'))
  assert.throws(() => authority.issue(b, { binding, tools: ['write'] }), code('TOOL_DENIED'))
})

test('capability: a lease is limited to its task, attempt, machine and workspace', async () => {
  const { authority, a } = fixture()
  const { token } = authority.issue(a, { binding, tools: ['read'] })
  for (const key of ['taskId', 'attemptId', 'machineId', 'workspaceId', 'location']) {
    const wrong = { ...binding, [key]: key === 'location' ? 'local' : 'different' }
    assert.throws(() => authority.list(token, wrong), code('BINDING_MISMATCH'))
  }
  assert.throws(() => authority.list(token, { ...binding, botId: 'bot-b' }), code('INVALID_BINDING'))
  assert.throws(() => authority.issue(a, { binding: { ...binding, workspaceId: 'C:/other/workspace' }, tools: ['read'] }), code('INVALID_BINDING'))
  assert.deepEqual(authority.list(token, binding), ['read'])
  let calls = 0
  await assert.rejects(authority.run(token, binding, 'write', () => { calls++ }), code('TOOL_DENIED'))
  assert.equal(calls, 0)
  assert.equal(await authority.run(token, binding, 'read', () => 'allowed'), 'allowed')
})

test('capability: expired, tampered, released and previous-process tickets fail', () => {
  let now = 0
  const { authority, a } = fixture({ now: () => now })
  const { token } = authority.issue(a, { binding, tools: ['read'], ttlMs: 5 })
  assert.throws(() => createAuthority().list(token, binding), code('UNKNOWN_LEASE'))
  assert.throws(() => authority.list('invalid', binding), code('UNKNOWN_LEASE'))
  const tampered = (token[0] === 'A' ? 'B' : 'A') + token.slice(1)
  assert.throws(() => authority.list(tampered, binding), code('UNKNOWN_LEASE'))
  now = 5
  assert.throws(() => authority.list(token, binding), code('LEASE_EXPIRED'))
  const released = authority.issue(a, { binding, tools: ['read'] })
  authority.release(released.token)
  assert.throws(() => authority.list(released.token, binding), code('UNKNOWN_LEASE'))
})

test('capability: replacing a grant invalidates existing leases without widening a sibling', () => {
  const { authority, a, b } = fixture()
  const first = authority.issue(a, { binding, tools: ['read'] })
  authority.replaceGrant(a, { tools: ['write'] })
  assert.throws(() => authority.list(first.token, binding), code('UNKNOWN_LEASE'))
  assert.throws(() => authority.assertTool(a, 'read'), code('TOOL_DENIED'))
  authority.assertTool(b, 'read')
})

test('capability: revocation aborts active work and discards a late successful return', async () => {
  const { authority, a } = fixture()
  const { token } = authority.issue(a, { binding, tools: ['read'] })
  let resolveWork
  let observed
  const work = authority.run(token, binding, 'read', ({ signal }) => {
    observed = signal
    return new Promise(resolve => { resolveWork = resolve })
  })
  authority.revoke(a)
  assert.equal(observed.aborted, true)
  resolveWork('late success')
  await assert.rejects(work, code('SUBJECT_REVOKED'))
  assert.throws(() => authority.issue(a, { binding, tools: ['read'] }), code('SUBJECT_REVOKED'))
})

test('capability: caller cancellation and authority disposal abort their owned work', async () => {
  const { authority, a } = fixture()
  const { token } = authority.issue(a, { binding, tools: ['read'] })
  const controller = new AbortController()
  controller.abort(new Error('cancelled by caller'))
  let called = false
  await assert.rejects(authority.run(token, binding, 'read', () => { called = true }, { signal: controller.signal }), /cancelled by caller/)
  assert.equal(called, false)
  let finish
  let activeSignal
  const active = authority.run(token, binding, 'read', ({ signal }) => { activeSignal = signal; return new Promise(resolve => { finish = resolve }) })
  authority.dispose()
  assert.equal(activeSignal.aborted, true)
  finish('late')
  await assert.rejects(active, code('AUTHORITY_CLOSED'))
  authority.dispose()
})

test('capability: live lease expiry propagates cancellation to a waiting handler', async () => {
  const { authority, a } = fixture()
  const { token } = authority.issue(a, { binding, tools: ['read'], ttlMs: 40 })
  await assert.rejects(authority.run(token, binding, 'read', ({ signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })), code('LEASE_EXPIRED'))
})

test('capability: route components cannot collide through slash concatenation', () => {
  const authority = createAuthority()
  const subject = {}
  authority.register(subject, { botId: 'slash-route', modelRoutes: [{ provider: 'fixture/vendor', model: 'gpt-model' }] })
  authority.assertModel(subject, 'fixture/vendor', 'gpt-model')
  assert.throws(() => authority.assertModel(subject, 'fixture', 'vendor/gpt-model'), code('MODEL_DENIED'))
})

test('capability: lease admission is bounded and expired idle leases free their slot', () => {
  let now = 0
  const { authority, a } = fixture({ now: () => now, maxLeases: 1 })
  const first = authority.issue(a, { binding, tools: ['read'], ttlMs: 5 })
  assert.throws(() => authority.issue(a, { binding, tools: ['read'] }), code('LEASE_LIMIT'))
  now = 5
  const next = authority.issue(a, { binding, tools: ['read'] })
  assert.throws(() => authority.list(first.token, binding), code('UNKNOWN_LEASE'))
  assert.deepEqual(authority.list(next.token, binding), ['read'])
})
