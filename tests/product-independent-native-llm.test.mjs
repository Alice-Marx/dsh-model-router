import test from 'node:test'
import assert from 'node:assert/strict'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { openBotSessionStore } from '../packages/orchestration/src/bot-session-store.mjs'
import { join } from 'node:path'

test('the installed LlmRuntime accepts the independent request and preserves conversation blocks', async () => {
  await withProductIndependent(async ({ ctx, runtime, bind, readRows }) => {
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    const first = await runtime.turn({ botId: 'a', input: 'first native SDK turn' })
    assert.equal(first.answer, 'model answer')
    const second = await runtime.turn({ botId: 'a', input: 'second native SDK turn' })
    assert.equal(second.answer, 'model answer')
    assert.equal(ctx.upstream.length, 2)
    for (const row of ctx.upstream) for (const message of row.messages) {
      assert.ok(Array.isArray(message.content), 'Host canonical content is an array of typed blocks')
    }
    const previous = ctx.upstream[1].messages.find(message => message.role === 'assistant')
    assert.equal(previous.source.kind, 'model')
    assert.equal(previous.source.provider, 'alpha')
    assert.equal(previous.source.model, 'one')
    assert.equal(readRows('router_model_calls').length, 2)
  }, { nativeLlm: true })
})

test('switching the saved model does not relabel the old response provenance', async () => {
  await withProductIndependent(async ({ ctx, runtime, bind, readRows }) => {
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    await runtime.turn({ botId: 'a', input: 'answer under alpha' })
    await bind('a', 'beta', 'vendor/two')
    await runtime.turn({ botId: 'a', input: 'continue under beta' })
    const request = ctx.upstream[1]
    assert.equal(request.provider, 'beta')
    assert.equal(request.model, 'vendor/two')
    const previous = request.messages.find(message => message.role === 'assistant')
    assert.deepEqual(previous.source, { kind: 'model', provider: 'alpha', model: 'one' })
    assert.deepEqual(readRows('router_model_calls').map(row => row.model), ['one', 'vendor/two'])
  }, { nativeLlm: true })
})

test('an old transcript without model provenance remains readable as labeled recall', async () => {
  await withProductIndependent(async ({ ctx, runtime, runtimeDir, bind }) => {
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    openBotSessionStore({ dir: join(runtimeDir, 'sessions') }).append('a', [{ role: 'assistant', content: 'old response with no recorded model' }])
    await runtime.turn({ botId: 'a', input: 'continue from my old transcript' })
    const old = ctx.upstream[0].messages.find(message => message.source?.kind === 'independent-history')
    assert.equal(old.role, 'user')
    assert.equal(old.source.kind, 'independent-history')
    assert.match(old.content[0].text, /provenance unrecorded/)
    assert.match(old.content[0].text, /old response with no recorded model/)
    assert.equal(old.source.provider, undefined)
    assert.equal(old.source.model, undefined)
  }, { nativeLlm: true })
})

test('the independent SDK request reads the Bot standing instructions saved by the owner', async () => {
  await withProductIndependent(async ({ ctx, runtime, bind, dispatch }) => {
    await bind('a', 'alpha', 'one')
    await runtime.move('a', 'independent')
    const saveInstructions = async instructions => {
      const view = await dispatch('botProfile.inspect', { botId: 'a' })
      await dispatch('botProfile.save', { botId: 'a', expectedRevision: view.revision,
        base: { name: view.bot.name, role: view.bot.role, instructions: view.bot.instructions }, profile: { instructions } })
    }
    await saveInstructions('Use only verified task facts. State uncertainty explicitly.')
    assert.equal(ctx.upstream.length, 0, 'editing identity does not start a model turn')
    await runtime.turn({ botId: 'a', input: 'first instructed turn' })
    const first = ctx.upstream[0].messages.find(message => message.role === 'system')
    assert.ok(first, 'the Bot instructions must reach the real SDK request')
    assert.match(first.content.map(part => part.text).join('\n'), /Use only verified task facts/)
    await saveInstructions('Give a concise answer and list unresolved questions.')
    await runtime.turn({ botId: 'a', input: 'second instructed turn' })
    const second = ctx.upstream[1].messages.find(message => message.role === 'system')
    assert.match(second.content.map(part => part.text).join('\n'), /Give a concise answer/)
    assert.doesNotMatch(second.content.map(part => part.text).join('\n'), /Use only verified task facts/)
  }, { nativeLlm: true })
})
