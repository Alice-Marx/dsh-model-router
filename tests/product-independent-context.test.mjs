import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { createIndependentChatService } from '../packages/orchestration/src/independent-chat-service.mjs'
import { createIndependentConversationReader } from '../packages/orchestration/src/independent-chat-page.mjs'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'

test('trusted context reset uses real product SDK/accounting/SQLite: zero calls on reset, old history visible, fresh projection only', async () => {
  await withProductIndependent(async ({ ctx, product, runtime, runtimeDir, bind, readRows, storageFile }) => {
    await bind('a', 'alpha', 'one'); await bind('b', 'beta', 'vendor/two')
    await runtime.move('a', 'independent'); await runtime.move('b', 'independent')
    let retirements = 0
    // Offline transport has no native tree. This is explicit trusted Host proof,
    // not an installed-Host/HTTP/dispatcher acceptance claim.
    ctx.provide('botIndependentConversationRetirement', async () => { retirements++; return { notStarted: true, possiblyApplied: false } })
    const adapter = { ...runtime, conversationPage: createIndependentConversationReader({ dir: runtimeDir }) }
    const service = createIndependentChatService({ Database, file: storageFile, lifecycle: product.lifecycle, runtime: () => adapter })
    const owner = { kind: 'owner' }
    try {
      service.send({ botId: 'a', requestKey: 'context-sdk-before-reset-20261109', input: 'old product question' }, owner)
      await service.whenIdle()
      assert.equal(ctx.upstream.length, 1); assert.equal(readRows('router_model_calls').length, 1)
      const oldIds = service.messages({ botId: 'a' }, owner).items.map(row => row.messageId)
      const b = runtime.contextOf('b')
      const payload = { botId: 'a', requestKey: 'context-sdk-new-conversation-20261109' }
      service.newConversation(payload, owner); service.newConversation(payload, owner)
      await service.whenIdle()
      assert.equal(service.inspect(payload, owner).state, 'succeeded')
      assert.equal(retirements, 1); assert.equal(ctx.upstream.length, 1); assert.equal(readRows('router_model_calls').length, 1)
      assert.deepEqual(runtime.contextOf('b'), b)
      assert.deepEqual(service.messages({ botId: 'a' }, owner).items.map(row => row.messageId), oldIds)
      service.send({ botId: 'a', requestKey: 'context-sdk-after-reset-20261109', input: 'fresh product question' }, owner)
      await service.whenIdle()
      assert.equal(ctx.upstream.length, 2); assert.equal(readRows('router_model_calls').length, 2)
      assert.deepEqual(ctx.upstream[1].messages.filter(row => row.role === 'user').map(row => row.content.map(part => part.text).join('')), ['fresh product question'])
      assert.equal(JSON.stringify(ctx.upstream[1].messages).includes('old product question'), false)
      assert.deepEqual(service.messages({ botId: 'a' }, owner).items.filter(row => row.role === 'user').map(row => row.content), ['old product question', 'fresh product question'])
      assert.equal(readRows('router_runs').length, 2)
    } finally { service.close() }
  }, { nativeLlm: true })
})
