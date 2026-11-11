import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { withIndependentChatNative } from './fixtures/independent-chat-native.mjs'
const Database = createRequire(import.meta.url)('better-sqlite3')
const gate = () => { let resolve; return { promise: new Promise(done => { resolve = done }), resolve: () => resolve() } }
const requestKey = 'independent-native-owner-123456'

test('nativeweb owner HTTP dispatch reaches real SQLite, SDK and stable message pages exactly once', async () => {
  await withIndependentChatNative(async f => {
    for (const action of ['send', 'inspect', 'cancel', 'view', 'messages']) {
      const denied = await f.action(`independentChat.${action}`, { botId: 'a', requestKey, input: 'forged owner', kind: 'owner' }, { authenticated: false })
      assert.equal(denied.response.status, 403); assert.equal(denied.value.error.code, 'REMOTE_OWNER_REQUIRED')
    }
    const forged = await f.action('independentChat.send', { botId: 'a', requestKey, input: 'hello', subject: 'owner', operation: 'run' })
    assert.equal(forged.value.error.code, 'INDEPENDENT_CHAT_INVALID_REQUEST')
    const aborted = new AbortController(); aborted.abort()
    const cancelledBefore = await f.action('independentChat.send', { botId: 'a', requestKey: 'aborted-native-owner-123456', input: 'never admitted' }, { signal: aborted.signal })
    assert.equal(cancelledBefore.value.ok, false)
    const view = await f.action('independentChat.view', { botId: 'a' })
    assert.equal(view.value.value.available, true)
    const input = { botId: 'a', requestKey, input: '真实公共聊天通道，只调用一次' }
    const first = await f.action('independentChat.send', input), retry = await f.action('independentChat.send', input)
    assert.equal(first.value.value.durableInput, true); assert.equal(retry.value.value.requestKey, requestKey)
    await f.ctx.get('botIndependentChat').whenIdle()
    const outcome = await f.action('independentChat.inspect', { botId: 'a', requestKey })
    assert.equal(outcome.value.value.state, 'succeeded', JSON.stringify(outcome.value)); assert.equal(outcome.value.value.stopConfirmed, false)
    assert.equal(f.ctx.upstream.length, 1); assert.equal(f.readRows('router_model_calls').length, 1)
    const page = await f.action('independentChat.messages', { botId: 'a', limit: 1 })
    assert.equal(page.value.value.items.length, 1); assert.equal(page.value.value.items[0].content, 'model answer')
    const older = await f.action('independentChat.messages', { botId: 'a', limit: 1, cursor: page.value.value.nextCursor })
    assert.equal(older.value.value.items[0].content, input.input)
    assert.notEqual(older.value.value.items[0].messageId, page.value.value.items[0].messageId)
    const db = new Database(f.storageFile, { readonly: true })
    try { assert.equal(db.prepare('SELECT count(*) AS n FROM bot_independent_chat_requests').get().n, 1) } finally { db.close() }
    await f.runtime.move('a', 'integration')
    const integrated = await f.action('independentChat.view', { botId: 'a' })
    assert.equal(integrated.value.value.mode, 'integration'); assert.equal(integrated.value.value.available, false)
    const blocked = await f.action('independentChat.send', { botId: 'a', requestKey: 'different-native-intent-123456', input: 'must refuse' })
    assert.equal(blocked.value.error.code, 'RUNTIME_MODE_MISMATCH')
  })
})

test('native owner cancellation settles the real local loop without claiming confirmed tool stop', async () => {
  await withIndependentChatNative(async f => {
    const hold = gate(), entered = gate()
    f.ctx.state.beforeRequest = async () => { entered.resolve(); await hold.promise }
    const key = 'independent-native-cancel-123456'
    await f.action('independentChat.send', { botId: 'a', requestKey: key, input: 'long running offline model' })
    await Promise.race([entered.promise, f.ctx.get('botIndependentChat').whenIdle().then(async () => { throw new Error(`Provider was not entered: ${JSON.stringify((await f.action('independentChat.inspect', { botId: 'a', requestKey: key })).value)}`) })])
    const cancel = await f.action('independentChat.cancel', { botId: 'a', requestKey: key })
    assert.equal(cancel.value.value.cancelRequested, true); assert.equal(cancel.value.value.stopConfirmed, false)
    assert.equal(cancel.value.value.finished, false)
    hold.resolve(); await f.ctx.get('botIndependentChat').whenIdle()
    const end = await f.action('independentChat.inspect', { botId: 'a', requestKey: key })
    assert.equal(end.value.value.cancelRequested, true); assert.equal(end.value.value.stopConfirmed, false); assert.equal(end.value.value.finished, true)
    assert.equal(f.ctx.upstream.length, 1)
  })
})
