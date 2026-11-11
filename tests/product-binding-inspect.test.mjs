import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectProductBinding } from '../packages/orchestration/src/binding-product.mjs'
import { createProductReadModel } from '../modules/bot-runtime/read-model.mjs'

test('chat binding inspection uses the real owner boundary, a committed Bot and a narrow response', async () => {
  const calls = []
  const runtime = { load: async () => calls.push('load'), readOnly: () => undefined }
  const source = { runtime, lifecycle: { committedBot: id => id === 'bot-a' ? { id, name: '研究伙伴', role: '研究', model: 'fixture/exact', appliedModel: 'fixture/last-applied', workDir: 'private-path', secret: 'private-token' } : null },
    botSettings: { get: id => { calls.push(id); return { botId: id, revision: 1, settings: {}, catalog: {} } } },
    fundingAccounts: { catalog: () => [{ id: 'scope', provider: 'fixture', enabled: true }] } }
  const model = createProductReadModel({ runtime, actions: { 'binding.inspect': payload => inspectProductBinding(source, payload) } })
  await assert.rejects(model.dispatch({ action: 'binding.inspect', payload: { botId: 'bot-a' } }, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
  assert.deepEqual(calls, [])
  const value = await model.dispatch({ action: 'binding.inspect', payload: { botId: 'bot-a' } }, { kind: 'owner' })
  assert.equal(value.record.botId, 'bot-a'); assert.equal(value.bot.name, '研究伙伴')
  assert.equal(value.bot.model, 'fixture/exact'); assert.equal(value.bot.appliedModel, 'fixture/last-applied')
  assert.doesNotMatch(JSON.stringify(value), /private-path|private-token|workDir|"secret"/)
  await assert.rejects(inspectProductBinding(source, { botId: 'removed' }), { code: 'INVALID_BINDING_OWNER' })
  assert.deepEqual(calls, ['load', 'bot-a', 'load'])
  await assert.rejects(inspectProductBinding(source, { botId: 'bot-a', accountId: 'forged' }), { code: 'INVALID_BINDING_OWNER' })
})

test('an aborted chat settings read cannot reach the settings or account directory', async () => {
  const controller = new AbortController(); let reads = 0
  const source = { runtime: { load: async () => controller.abort() }, signal: controller.signal,
    lifecycle: { committedBot: () => { reads++; return {} } }, botSettings: { get: () => { reads++ } } }
  await assert.rejects(inspectProductBinding(source, { botId: 'bot-a' }))
  assert.equal(reads, 0)
})
