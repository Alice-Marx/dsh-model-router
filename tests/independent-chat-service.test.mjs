import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createIndependentChatService } from '../packages/orchestration/src/independent-chat-service.mjs'
const owner = { kind: 'owner' }, request = { botId: 'a', requestKey: 'independent-chat-reader-123456', input: 'keep this exact recovery text' }
function fixture(t) {
  const parent = resolve('tmp/integration/independent-chat-ui'); mkdirSync(parent, { recursive: true })
  const file = join(mkdtempSync(join(parent, 'service-')), 'state.sqlite')
  const pages = [], adapter = { modeOf: () => 'independent', turn: async () => ({ answer: 'ok' }), busyBots: () => [],
    conversationPage: (...args) => { pages.push(args); return { schemaVersion: 1, botId: args[0], items: [], nextCursor: null } } }
  const service = createIndependentChatService({ Database, file, lifecycle: { committedBot: id => id === 'a' ? { id } : null }, runtime: () => adapter, isProcessAlive: () => false })
  t.after(() => service.close()); return { service, file, adapter, pages }
}
test('owner view availability requires the complete runtime and never invents integration mode', t => {
  const f = fixture(t)
  assert.equal(f.service.view({ botId: 'a' }, owner).available, true)
  f.adapter.modeOf = () => null
  assert.equal(f.service.view({ botId: 'a' }, owner).mode, null)
  assert.equal(f.service.view({ botId: 'a' }, owner).available, false)
  f.adapter.modeOf = () => 'independent'; delete f.adapter.conversationPage
  assert.equal(f.service.view({ botId: 'a' }, owner).available, false)
  assert.throws(() => f.service.view({ botId: 'a', kind: 'owner' }, owner), { code: 'INDEPENDENT_CHAT_INVALID_REQUEST' })
  assert.throws(() => f.service.view({ botId: 'a' }, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
})
test('one messages request uses one atomic reader callback, with authenticated bounded cursor inputs', t => {
  const f = fixture(t)
  f.service.messages({ botId: 'a', cursor: 'stable-message-id', limit: 9 }, owner)
  assert.deepEqual(f.pages, [['a', { cursor: 'stable-message-id', limit: 9 }]])
  for (const payload of [{ botId: 'a', index: 0 }, { botId: 'a', limit: 101 }, { botId: 'absent' }]) assert.throws(() => f.service.messages(payload, owner))
  assert.throws(() => f.service.messages({ botId: 'a' }, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
})
test('read-only view and inspect observe a lost owner without updating its journal row', async t => {
  const f = fixture(t)
  f.service.send(request, owner); await f.service.whenIdle()
  const db = new Database(f.file)
  t.after(() => db.close())
  db.prepare("UPDATE bot_independent_chat_requests SET state='running',owner_id='other-dead-owner',owner_pid=9999999,input_text=?").run(request.input)
  const readOnly = { ...owner, readOnly: true }
  const view = f.service.view({ botId: 'a' }, readOnly)
  assert.equal(view.readOnly, true); assert.equal(view.available, false); assert.equal(view.pendingRequest.state, 'unknown')
  const status = f.service.inspect({ botId: 'a', requestKey: request.requestKey }, readOnly)
  assert.equal(status.state, 'unknown'); assert.equal(status.pending, true)
  assert.equal(db.prepare('SELECT state FROM bot_independent_chat_requests').get().state, 'running')
  assert.throws(() => f.service.cancel({ botId: 'a', requestKey: request.requestKey }, readOnly), { code: 'PRODUCT_READ_ONLY' })
  assert.throws(() => f.service.send(request, readOnly), { code: 'PRODUCT_READ_ONLY' })
  const recovered = f.service.inspect({ botId: 'a', requestKey: request.requestKey }, owner)
  assert.equal(recovered.pending, false); assert.equal(recovered.recoveryInput, request.input)
})
