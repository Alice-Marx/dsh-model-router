import test from 'node:test'
import assert from 'node:assert/strict'
import { createGrantRefreshQueue } from '../packages/orchestration/src/grant-refresh-queue.mjs'
import { attachDsLifecycle } from '../packages/orchestration/src/ds-lifecycle.mjs'
import { createPrincipalDirectory } from '../packages/orchestration/src/principals.mjs'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'

const gate = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('Host teardown waits for the already admitted grant read and refuses later notifications', async () => {
  const entered = gate(), release = gate()
  let calls = 0, drained = false
  const queue = createGrantRefreshQueue({ lifecycle: () => ({ async refreshGrants() { calls++; entered.resolve(); await release.promise } }) })
  queue.request()
  await entered.promise
  const close = queue.close().then(() => { drained = true })
  queue.request()
  await Promise.resolve()
  assert.equal(drained, false)
  release.resolve()
  await close
  assert.equal(drained, true)
  assert.equal(calls, 1)
  await queue.close()
})

test('notifications received during a read coalesce into one subsequent committed read', async () => {
  const entered = gate(), release = gate(), second = gate()
  let calls = 0
  const queue = createGrantRefreshQueue({ lifecycle: () => ({ async refreshGrants() {
    calls++
    if (calls === 1) { entered.resolve(); await release.promise }
    else second.resolve()
  } }) })
  queue.request()
  await entered.promise
  for (let i = 0; i < 30; i++) queue.request()
  release.resolve()
  await second.promise
  await queue.close()
  assert.equal(calls, 2)
})

test('a failed refresh and even a throwing diagnostic are observed without an unhandled rejection', async () => {
  const observed = gate()
  const failure = new Error('committed state unavailable')
  const queue = createGrantRefreshQueue({ lifecycle: () => ({ async refreshGrants() { throw failure } }),
    onError(cause) { assert.equal(cause, failure); observed.resolve(); throw new Error('logger unavailable') } })
  queue.request()
  await observed.promise
  await queue.close()
})

test('a failed committed-state read revokes the real Bot grant until a later successful refresh', async () => {
  const authority = createAuthority(), directory = createPrincipalDirectory(authority)
  const saved = { version: 1, revision: 1, bots: { a: { id: 'a', sessionId: 'a' } }, rooms: {} }
  const failure = new Error('disk read failed')
  let unreadable = false
  const runtime = { load: async () => {}, save: async () => {}, refresh: async () => {}, resolveAgent: async id => ({ session: { id } }) }
  const lifecycle = attachDsLifecycle({ runtime, directory, grantFor: () => ({ tools: ['model/infer'], modelRoutes: [{ provider: 'offline', model: 'one' }] }),
    readSaved: async () => { if (unreadable) throw failure; return saved } })
  try {
    await runtime.load()
    const subject = directory.forBot('a')
    authority.assertTool(subject, 'model/infer')
    unreadable = true
    await assert.rejects(lifecycle.refreshGrants(), error => error === failure)
    assert.equal(lifecycle.status().healthy, false)
    assert.throws(() => authority.assertTool(subject, 'model/infer'))
    unreadable = false
    await lifecycle.refreshGrants()
    assert.equal(lifecycle.status().healthy, true)
    authority.assertTool(subject, 'model/infer')
  } finally { lifecycle.close(); authority.dispose() }
})
