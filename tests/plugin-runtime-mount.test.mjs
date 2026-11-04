import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectAnswer, createPluginRuntime } from '../modules/independent-runtime/index.mjs'

const stateDir = t => {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-runtime-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

const ctxWith = stream => ({ get: name => (name === 'llm' ? { stream } : undefined) })

test('plugin runtime: it stays off unless it is enabled', (t) => {
  assert.equal(createPluginRuntime({ ctx: ctxWith(() => []), stateDir: stateDir(t) }), null)
  assert.equal(createPluginRuntime({ ctx: ctxWith(() => []), settings: { enabled: false }, stateDir: stateDir(t) }), null)
})

test('plugin runtime: a missing model or llm service is refused at construction', (t) => {
  assert.throws(() => createPluginRuntime({ ctx: ctxWith(() => []), settings: { enabled: true }, stateDir: stateDir(t) }), /REQUIRES_MODEL/)
  assert.throws(() => createPluginRuntime({
    ctx: { get: () => undefined },
    settings: { enabled: true, provider: 'p', model: 'm' },
    stateDir: stateDir(t),
  }), /REQUIRES_LLM/)
})

test('plugin runtime: one turn reaches the Host model service and is stored', async (t) => {
  const prompts = []
  const ctx = ctxWith(async function* stream(request) { prompts.push(request); yield { type: 'text', text: '你好，' }; yield { type: 'text', text: '我是独立运行时。' } })
  const runtime = createPluginRuntime({ ctx, settings: { enabled: true, provider: 'deepseek', model: 'deepseek-v4' }, stateDir: stateDir(t), integration: async () => ({ answer: 'Harness' }) })
  const result = await runtime.turn({ botId: 'session-1', input: '在吗' })
  assert.equal(result.runtime, 'integration', 'an unswitched Bot still goes to the integration handler')
  assert.equal(result.answer, 'Harness')
  await runtime.move('session-1', 'independent')
  const answer = await runtime.turn({ botId: 'session-1', input: '在吗' })
  assert.equal(answer.runtime, 'independent')
  assert.equal(answer.answer, '你好，我是独立运行时。')
  assert.equal(prompts[0].provider, 'deepseek')
  assert.equal(prompts[0].model, 'deepseek-v4')
  assert.equal(prompts[0].messages.at(-1).content, '在吗')
  assert.equal(runtime.inventory(['session-1'])[0].turns, 1)
})

test('plugin runtime: an integration handler is required before anything is moved', async (t) => {
  const runtime = createPluginRuntime({ ctx: ctxWith(() => []), settings: { enabled: true, provider: 'p', model: 'm' }, stateDir: stateDir(t) })
  await assert.rejects(runtime.turn({ botId: 'b1', input: 'hi' }), /NO_INTEGRATION/)
})

test('plugin runtime: the provider adapter keeps only text chunks', async () => {
  const reply = await collectAnswer((async function* () { yield 'a'; yield { type: 'text', text: 'b' }; yield { type: 'delta', text: 'c' }; yield { type: 'tool', name: 'x' }; yield { type: 'text' } })())
  assert.deepEqual(reply, { text: 'abc' })
})
