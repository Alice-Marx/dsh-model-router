import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createIndependentRuntime } from '../packages/orchestration/src/bot-runtime-assembly.mjs'
import { createBotServing } from '../packages/orchestration/src/bot-serving.mjs'
import { createBotLoop } from '../packages/orchestration/src/bot-loop.mjs'
import { openBotSessionStore } from '../packages/orchestration/src/bot-session-store.mjs'

const SOURCE = { kind: 'model', provider: 'offline', model: 'fixture' }
function boot(t, provider, options = {}) {
  const parent = resolve('tmp/integration/team-runtime/work-thread'); mkdirSync(parent, { recursive: true })
  const dir = options.dir ?? mkdtempSync(join(parent, 'rt-'))
  const runtime = createIndependentRuntime({ dir, integration: async () => { throw Error('wrong mode') }, providerFor: () => provider, toolsFor: options.toolsFor ?? (() => null), serving: createBotServing({ modeOf: () => 'independent' }), retireConversation: async () => ({ confirmed: true, stopped: true, retired: true, outcome: 'confirmed' }) })
  t.after(() => runtime.close())
  return { runtime, dir }
}
const request = (over = {}) => ({ botId: 'worker', workThreadId: 'wt-one', conversationId: 'teamwt-one', requestId: 'request-one', input: 'one', ...over })

test('exact request user/answer survives restart; replay is a read, default transcript stays untouched', async t => {
  let calls = 0
  const first = boot(t, async () => ({ text: `answer-${++calls}`, source: SOURCE }))
  assert.equal((await first.runtime.workThreadTurn(request())).answer, 'answer-1')
  assert.equal(first.runtime.history('worker').length, 0)
  first.runtime.close()
  const second = boot(t, async () => { throw Error('must not dispatch replay') }, { dir: first.dir })
  assert.equal((await second.runtime.workThreadTurn(request())).replayed, true)
  assert.equal(second.runtime.workThreadRead('worker', 'wt-one', 'request-one').answer, 'answer-1')
  assert.equal(second.runtime.workThreadRead('worker', 'wt-one', 'missing').hasConfirmedAnswer, false)
  await assert.rejects(second.runtime.workThreadTurn(request({ input: 'changed' })), { code: 'BOT_REQUEST_CONFLICT' })
  assert.equal(calls, 1)
})

test('an incomplete old request never acquires a later request answer and never reruns', async t => {
  let calls = 0
  const { runtime } = boot(t, async () => { if (++calls === 1) throw Object.assign(Error('provider failed'), { code: 'MODEL_FAILURE' }); return { text: 'later answer', source: SOURCE } })
  await assert.rejects(runtime.workThreadTurn(request()), { code: 'MODEL_FAILURE' })
  await runtime.workThreadTurn(request({ requestId: 'request-two', input: 'two' }))
  assert.equal(runtime.workThreadRead('worker', 'wt-one', 'request-one').hasBrief, true)
  assert.equal(runtime.workThreadRead('worker', 'wt-one', 'request-one').answer, null)
  assert.equal(runtime.workThreadRead('worker', 'wt-one', 'request-two').answer, 'later answer')
  await assert.rejects(runtime.workThreadTurn(request()), { code: 'BOT_REQUEST_OUTCOME_UNKNOWN' })
  assert.equal(calls, 2)
})

test('work-thread partitions include the Bot and the single-writer admission is real', async t => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const { runtime } = boot(t, async ({ botId }) => { if (botId === 'worker') await gate; return { text: botId, source: SOURCE } })
  const pending = runtime.workThreadTurn(request())
  await assert.rejects(runtime.workThreadTurn(request({ workThreadId: 'wt-two', requestId: 'two' })), { code: 'BOT_BUSY' })
  await runtime.workThreadTurn(request({ botId: 'other' }))
  release(); await pending
  assert.equal(runtime.workThreadRead('other', 'wt-one', 'request-one').answer, 'other')
  assert.equal(runtime.workThreadRead('worker', 'wt-one', 'request-one').answer, 'worker')
  assert.throws(() => runtime.workThreadRead('worker', '../bad', 'x'), { code: 'INVALID_WORK_THREAD_ID' })
})

test('consult offers no tools and refuses invented tool calls without side effects', async t => {
  let calls = 0
  const { runtime } = boot(t, async ({ tools }) => { assert.equal(tools, undefined); return { toolCalls: [{ id: 'invented', name: 'write', args: {} }], source: SOURCE } }, { toolsFor: () => ({ schemas: () => [{ name: 'write' }], call: async () => { calls++ } }) })
  await assert.rejects(runtime.workThreadTurn(request({ consult: true })), { code: 'BOT_LOOP_TOOLS_UNAVAILABLE' })
  assert.equal(calls, 0)
})

test('resume dedupes in the original context and refuses a retired origin', async t => {
  let calls = 0
  const { runtime } = boot(t, async () => ({ text: `answer-${++calls}`, source: SOURCE }))
  const origin = runtime.captureTeamOrigin({ botId: 'worker' })
  const resume = { botId: 'worker', origin, input: 'team result', requestId: 'resume-one' }
  await runtime.resumeTeamTurn(resume)
  assert.equal((await runtime.resumeTeamTurn(resume)).replayed, true)
  assert.equal(calls, 1)
  assert.deepEqual(await runtime.resumeTeamTurn({ ...resume, origin: { ...origin, contextId: 'retired' }, requestId: 'resume-two' }), { started: false, retired: true })
})

test('runtime close aborts a live work-thread and releases admission', async t => {
  const { runtime } = boot(t, ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })))
  const pending = runtime.workThreadTurn(request())
  runtime.close()
  await assert.rejects(pending, { code: 'BOT_LOOP_CANCELLED' })
  assert.deepEqual(runtime.busyBots(), [])
})

test('structured tool failures keep isError in durable history; ordinary data fields do not become errors', async () => {
  const root = resolve('tmp/integration/team-runtime/tool-results'); mkdirSync(root, { recursive: true })
  for (const [name, value, expected] of [['failure', { error: { code: 'TEAM_ACCESS_CHANGED', message: 'denied' } }, true], ['data', { error: 'a column name', rows: [[1, false, null]] }, false]]) {
    const store = openBotSessionStore({ dir: mkdtempSync(join(root, `${name}-`)) })
    let calls = 0
    const loop = createBotLoop({ store, provider: async () => ++calls === 1 ? { source: SOURCE, toolCalls: [{ id: 'one', name: 'fixture', args: {} }] } : { source: SOURCE, text: 'complete' }, tools: { call: async () => value } })
    await loop.run({ botId: 'worker', input: 'test tool result' })
    const message = store.get('worker').messages.find(row => row.role === 'tool')
    assert.equal(message.isError === true, expected)
    assert.deepEqual(JSON.parse(message.content), value)
  }
})
