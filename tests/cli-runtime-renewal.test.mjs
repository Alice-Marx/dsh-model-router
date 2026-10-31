import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'

const binding = { taskId: 't', attemptId: 'a', machineId: 'm', workspaceId: 'w', location: 'local' }
function setup(options) {
  const authority = createAuthority(options), subject = {}
  authority.register(subject, { botId: 'bot-a', tools: ['wait'] })
  return { authority, subject, lease: authority.issue(subject, { binding, tools: ['wait'], ttlMs: 60 }) }
}

test('host renewal cannot revive expired/released leases or cross a binding/revision', () => {
  let now = 0
  const { authority, subject, lease } = setup({ now: () => now, maxTtlMs: 100 })
  assert.throws(() => authority.renew(lease.token, { ...binding, taskId: 'other' }, { ttlMs: 10 }), /BINDING_MISMATCH/)
  assert.throws(() => authority.renew(lease.token, binding, { ttlMs: 101 }), /INVALID_TTL/)
  assert.deepEqual(authority.renew(lease.token, binding, { ttlMs: 100 }), { ttlMs: 100 })
  now = 100
  assert.throws(() => authority.renew(lease.token, binding, { ttlMs: 100 }), /LEASE_EXPIRED/)
  const next = authority.issue(subject, { binding, tools: ['wait'], ttlMs: 50 })
  authority.replaceGrant(subject, { tools: ['wait'] })
  assert.throws(() => authority.renew(next.token, binding), /UNKNOWN_LEASE/)
  const released = authority.issue(subject, { binding, tools: ['wait'], ttlMs: 50 })
  authority.release(released.token)
  assert.throws(() => authority.renew(released.token, binding), /UNKNOWN_LEASE/)
  authority.dispose()
})

test('an active run rechecks its renewed expiry; the original timer does not cancel it early', async t => {
  const { authority, lease } = setup({ maxTtlMs: 500 })
  t.after(() => authority.dispose())
  const result = authority.run(lease.token, binding, 'wait', async ({ signal }) => { await sleep(120); signal.throwIfAborted(); return 'done' })
  authority.renew(lease.token, binding, { ttlMs: 400 })
  assert.equal(await result, 'done')
})

test('renewed active operations still abort on expiry and revoke; late success remains refused', async t => {
  const { authority, subject, lease } = setup({ maxTtlMs: 500 })
  t.after(() => authority.dispose())
  authority.renew(lease.token, binding, { ttlMs: 400 })
  let started, aborted
  const running = new Promise(resolve => { started = resolve })
  const cancelled = new Promise(resolve => { aborted = resolve })
  const result = authority.run(lease.token, binding, 'wait', async ({ signal }) => {
    started(); signal.addEventListener('abort', aborted, { once: true }); await cancelled; return 'late-success'
  })
  await running; authority.revoke(subject)
  await assert.rejects(result, /SUBJECT_REVOKED/)
  assert.throws(() => authority.renew(lease.token, binding), /UNKNOWN_LEASE/)
  const next = setup({ maxTtlMs: 500 }); t.after(() => next.authority.dispose())
  next.authority.renew(next.lease.token, binding, { ttlMs: 25 })
  await assert.rejects(next.authority.run(next.lease.token, binding, 'wait', async ({ signal }) => { await sleep(60); signal.throwIfAborted() }), /LEASE_EXPIRED/)
})
