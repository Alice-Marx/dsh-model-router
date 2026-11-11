import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { openUiHostNamespace } from '../packages/orchestration/src/ui-host-namespace.mjs'
import { createProductReadModel } from '../modules/bot-runtime/read-model.mjs'

test('UI namespace is owned by one Host state, survives restart and differs for a second Host at the same browser origin', async t => {
  const parent = resolve('tmp/integration/ui-host-namespace'); await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(join(parent, 'case-')), firstFile = join(directory, 'first.sqlite')
  const first = openUiHostNamespace({ Database, file: firstFile }), id = first.read().hostId
  assert.match(id, /^host-[a-f0-9]{16}$/)
  first.close()
  const restarted = openUiHostNamespace({ Database, file: firstFile }), second = openUiHostNamespace({ Database, file: join(directory, 'second.sqlite') })
  t.after(() => { restarted.close(); second.close() })
  assert.equal(restarted.read().hostId, id)
  assert.notEqual(second.read().hostId, id)
  assert.deepEqual(Object.keys(restarted.read()).sort(), ['hostId', 'schemaVersion'])
  assert.throws(() => restarted.read({ hostId: second.read().hostId }), { code: 'INVALID_UI_NAMESPACE_REQUEST' })
  assert.throws(() => restarted.read(null), { code: 'INVALID_UI_NAMESPACE_REQUEST' })
  assert.throws(() => first.read(), { code: 'UI_NAMESPACE_CLOSED' })
})

test('UI namespace goes through the authenticated owner channel and rejects caller-selected identity', async t => {
  const parent = resolve('tmp/integration/ui-host-namespace'); await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(join(parent, 'channel-'))
  const namespace = openUiHostNamespace({ Database, file: join(directory, 'host.sqlite') })
  t.after(() => namespace.close())
  let reads = 0
  const model = createProductReadModel({ runtime: { readOnly: () => undefined }, actions: {
    'ui.namespace': payload => { reads++; return namespace.read(payload) },
  } })
  for (const context of [undefined, { kind: 'bot' }, { kind: 'remote' }]) {
    await assert.rejects(model.dispatch({ action: 'ui.namespace', payload: {} }, context), { code: 'REMOTE_OWNER_REQUIRED' })
  }
  assert.equal(reads, 0)
  assert.deepEqual(await model.dispatch({ action: 'ui.namespace', payload: {} }, { kind: 'owner' }), namespace.read())
  await assert.rejects(model.dispatch({ action: 'ui.namespace', payload: { hostId: 'forged' } }, { kind: 'owner' }), { code: 'INVALID_UI_NAMESPACE_REQUEST' })
})
