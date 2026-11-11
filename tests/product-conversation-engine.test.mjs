import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { normalizeConversationEngines } from '../packages/bot-engines/src/host-registrations.mjs'

const script = fileURLToPath(new URL('./fixtures/bot-engine-claude-fixture.mjs', import.meta.url))
const profile = async () => ({ id: 'claude-fixture', driver: 'claude', provider: 'native-claude', model: 'fixture-model-a', name: 'Claude native fixture',
  entry: { executable: process.execPath, sha256: createHash('sha256').update(await readFile(process.execPath)).digest('hex'), version: process.versions.node,
    script, scriptSha256: createHash('sha256').update(await readFile(script)).digest('hex') },
  credentialRef: 'ds-secret/NATIVE_FIXTURE_AUTH', deadlineMs: 120000 })

test('Host engine profiles reject request-supplied authority and duplicate providers before registration', async () => {
  const value = await profile()
  assert.throws(() => normalizeConversationEngines([{ ...value, command: 'untrusted' }]), { code: 'CONVERSATION_ENGINE_CONFIG_INVALID' })
  assert.throws(() => normalizeConversationEngines([{ ...value, entry: { ...value.entry, executable: './local' } }]), { code: 'CONVERSATION_ENGINE_ENTRY_INVALID' })
  assert.throws(() => normalizeConversationEngines([{ ...value, credentialRef: 'raw secret value' }]), { code: 'CONVERSATION_ENGINE_CREDENTIAL_REF_INVALID' })
  assert.throws(() => normalizeConversationEngines([value, { ...value, id: 'other' }]), { code: 'CONVERSATION_ENGINE_DUPLICATE' })
})

test('whole product binds the configured Claude route and settles two owner chat requests on one native session', async () => {
  await withProductIndependent(async ({ ctx, product, runtime, bind, dispatch, readRows, home }) => {
    const catalog = ctx.get('botConversationEngines').catalog()
    assert.equal(catalog.length, 1)
    assert.equal(catalog[0].status, 'configured')
    assert.equal(JSON.stringify(catalog).includes('credentialRef'), false)
    assert.equal(JSON.stringify(catalog).includes(process.execPath), false)
    await product.rt.secretEndpoint('secret-set', { name: 'NATIVE_FIXTURE_AUTH', value: JSON.stringify({ offlineFixture: 'not-a-real-credential' }), scope: [] })
    await bind('a', 'native-claude', 'fixture-model-a')
    let view = await dispatch('binding.inspect', { botId: 'a' })
    assert.deepEqual(view.record.catalog.models.find(model => model.provider === 'native-claude').fundingModes, ['subscription'])
    await assert.rejects(dispatch('binding.save', { botId: 'a', expectedRevision: view.record.revision,
      settings: { ...view.record.settings, funding: { mode: 'api', scopeId: view.record.settings.funding.scopeId,
        pricing: { input: 1, output: 2 }, request: { maxInputTokens: 4096, maxOutputTokens: 100 },
        dailyBudgetUsd: 1, monthlyBudgetUsd: 10, subscription: null } } }), { code: 'BOT_SETTINGS_SCOPE_DENIED' })
    assert.equal(readRows('router_model_calls').length, 0)
    assert.equal((await dispatch('binding.inspect', { botId: 'a' })).record.revision, view.record.revision)
    const settings = { ...view.record.settings, funding: { mode: 'subscription', scopeId: view.record.settings.funding.scopeId,
      pricing: null, request: null, dailyBudgetUsd: null, monthlyBudgetUsd: null, subscription: { dailyCalls: 5, monthlyCalls: 50 } } }
    await dispatch('binding.save', { botId: 'a', expectedRevision: view.record.revision, settings })
    await runtime.move('a', 'independent')
    const toolView=ctx.get('botIndependentToolHost').forBot('a')
    assert.deepEqual(toolView.schemas(),[],'native text capability negotiation does not send unsupported tool declarations')
    assert.ok((await dispatch('binding.inspect',{botId:'a'})).record.grant.tools.includes('task/read'),'Main tool authorization is retained')
    assert.ok(toolView.unavailable().some(item=>item.code==='MODEL_TOOLS_UNSUPPORTED'))
    const call = async (key, input) => {
      await dispatch('independentChat.send', { botId: 'a', requestKey: key, input })
      await ctx.get('botIndependentChat').whenIdle()
      const status = await dispatch('independentChat.inspect', { botId: 'a', requestKey: key })
      assert.equal(status.state, 'succeeded', JSON.stringify(status))
      return status
    }
    await call('native-product-owner-first-20261109', 'first native product turn')
    const evidenceFile = join(home, 'model-router/conversation-engines/claude-fixture/workspace/fixture-evidence.json')
    const first = JSON.parse(await readFile(evidenceFile, 'utf8'))
    assert.match(first.argv.systemPrompt, /Chief/)
    assert.match(first.argv.systemPrompt, /Research/)
    assert.deepEqual(JSON.parse(await readFile(join(dirname(first.argv.systemPromptFile), '.claude/.credentials.json'), 'utf8')), { offlineFixture: 'not-a-real-credential' })
    assert.equal(first.argv.builtinTools, '')
    await call('native-product-owner-second-20261109', 'second native product turn')
    const second = JSON.parse(await readFile(evidenceFile, 'utf8'))
    assert.equal(second.pid, first.pid)
    assert.deepEqual(second.turns.map(turn => turn.text), ['first native product turn', 'second native product turn'])
    const messages = await dispatch('independentChat.messages', { botId: 'a' })
    assert.deepEqual(messages.items.filter(row => row.role === 'assistant').map(row => row.content), ['echo: first native product turn', 'echo: second native product turn'])
    const receipts = readRows('router_model_calls')
    assert.equal(receipts.length, 2)
    assert.deepEqual(receipts.map(row => [row.botId, row.provider, row.model, row.funding, row.state]), [
      ['a', 'native-claude', 'fixture-model-a', 'subscription', 'settled'], ['a', 'native-claude', 'fixture-model-a', 'subscription', 'settled'],
    ])
    assert.equal(readRows('router_runs').length, 2)
    assert.equal(ctx.upstream.length, 0, 'the original offline API transport was never used as fallback')
    await dispatch('independentChat.send', { botId: 'a', requestKey: 'native-product-owner-second-20261109', input: 'second native product turn' })
    assert.equal(readRows('router_model_calls').length, 2)
    const reset = { botId: 'a', requestKey: 'native-product-new-context-20261109' }
    await dispatch('independentChat.newConversation', reset)
    await ctx.get('botIndependentChat').whenIdle()
    const resetStatus = await dispatch('independentChat.inspect', reset)
    assert.equal(resetStatus.state, 'succeeded', JSON.stringify(resetStatus))
    assert.equal(resetStatus.operationKind, 'new-conversation')
    assert.equal(readRows('router_model_calls').length, 2, 'opening a conversation makes no model or financial call')
    const openedContext = runtime.contextOf('a').contextId
    await dispatch('independentChat.newConversation', reset)
    assert.equal(runtime.contextOf('a').contextId, openedContext)
    await call('native-product-owner-third-20261109', 'first turn of the new context')
    const third = JSON.parse(await readFile(evidenceFile, 'utf8'))
    assert.notEqual(third.pid, first.pid)
    assert.deepEqual(third.turns.map(turn => turn.text), ['first turn of the new context'], 'old history must not be replayed into a new native context')
    assert.equal((await dispatch('independentChat.messages', { botId: 'a' })).items.filter(row => row.role === 'assistant').length, 3, 'the older conversation remains readable')
    assert.equal(readRows('router_model_calls').length, 3)
    await product.rt.secretEndpoint('secret-delete', { name: 'NATIVE_FIXTURE_AUTH' })
    await dispatch('independentChat.send', { botId: 'a', requestKey: 'native-product-revoked-20261109', input: 'must not use a removed credential' })
    await ctx.get('botIndependentChat').whenIdle()
    assert.equal((await dispatch('independentChat.inspect', { botId: 'a', requestKey: 'native-product-revoked-20261109' })).state, 'unknown')
    assert.equal(readRows('router_model_calls').length, 3, 'credential removal refuses before another model receipt or reservation')
    assert.equal(JSON.parse(await readFile(evidenceFile, 'utf8')).turns.length, 1)
    await bind('a','alpha','one')
    assert.deepEqual(toolView.schemas().map(tool=>tool.name).sort(),['bot_task_cancel','bot_task_status',
      'data_load','data_describe','data_sql','data_show','data_export',
      'coordinate_bots','assignment_status','list_bots','list_threads'].sort(),'an API route restores supported tool declarations without changing Main authorization')
    assert.equal(readRows('router_model_calls').length,3,'changing the default route does not send a message')
  }, { conversationEngines: [await profile()] })
}, { timeout: 120000 })

