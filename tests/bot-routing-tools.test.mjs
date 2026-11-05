import test from 'node:test'
import assert from 'node:assert/strict'
import { registerBotRoutingTools } from '../packages/orchestration/src/bot-routing-tools.mjs'

/**
 * The model-originated dispatch surface.
 *
 * The tool decides nothing: it asks the service, which reads committed state. What is tested here is
 * the boundary — who may ask, what the model is allowed to say, and that a refusal never turns into
 * a task.
 */

function harness({ routing, allowedBotIds = ['main'] }) {
  const tools = new Map()
  const ctx = { tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } } }
  const release = registerBotRoutingTools(ctx, { routing, allowedBotIds, botIdFor: exec => exec?.agent?.botId ?? null })
  return { tools, release }
}

const exec = botId => ({ agent: { botId, session: { id: `session-${botId}` } } })

test('routing tools: a service without a dispatch is refused instead of half-registered', () => {
  assert.throws(() => registerBotRoutingTools({ tools: { register: () => () => {} } }, { routing: { decide: () => ({}) } }), /BOT_ROUTING_TOOLS_REQUIRE_DISPATCH/)
  assert.throws(() => registerBotRoutingTools({ tools: { register: () => () => {} } }, {}), /BOT_ROUTING_TOOLS_REQUIRE_DISPATCH/)
})

test('routing tools: the dispatch tool passes only the task, and the caller comes from the session', async () => {
  const seen = []
  const { tools, release } = harness({ routing: { dispatch: payload => { seen.push(payload); return { dispatched: true, botId: 'worker' } } } })
  assert.deepEqual([...tools.keys()], ['bot_route_task', 'bot_dispatch'])
  const answer = await tools.get('bot_dispatch').execute({
    text: '整理日志', pinnedBotId: 'worker', requiresMachine: true, machineId: 'm1',
    requiredTools: ['fs_read'], acceptance: ['核对'], requestKey: 'key-1',
  }, exec('main'))
  assert.equal(answer.dispatched, true)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].text, '整理日志')
  assert.equal(seen[0].pinnedBotId, 'worker')
  assert.equal(seen[0].requiresMachine, true)
  assert.equal(seen[0].machineId, 'm1')
  assert.deepEqual(seen[0].requiredTools, ['fs_read'])
  assert.deepEqual(seen[0].acceptance, ['核对'])
  assert.equal(seen[0].requestKey, 'key-1')
  // The requester is derived from the live session, never from the arguments.
  assert.equal(seen[0].requesterBotId, 'main')
  assert.equal(Object.hasOwn(seen[0], 'subject'), false)
  assert.equal(Object.hasOwn(seen[0], 'botId'), false)
  release()
  assert.equal(tools.size, 0)
})

test('routing tools: a Bot outside the allowlist is refused before anything is dispatched', async () => {
  let asked = 0
  const { tools } = harness({ routing: { dispatch: () => { asked += 1; return { dispatched: true } } } })
  const denied = await tools.get('bot_dispatch').execute({ text: '整理日志' }, exec('worker'))
  assert.equal(denied.dispatched, false)
  assert.equal(denied.reason, 'BOT_ROUTING_DISPATCH_DENIED:worker')
  const anonymous = await tools.get('bot_dispatch').execute({ text: '整理日志' }, { agent: {} })
  assert.equal(anonymous.dispatched, false)
  assert.equal(anonymous.reason, 'BOT_ROUTING_DISPATCH_UNKNOWN_SUBJECT')
  assert.equal(asked, 0)
})

test('routing tools: the allowlist may be read live, and an empty one refuses everyone', async () => {
  let asked = 0
  const live = harness({ routing: { dispatch: () => { asked += 1; return { dispatched: true } } }, allowedBotIds: () => ['chief'] })
  assert.equal((await live.tools.get('bot_dispatch').execute({ text: 'x' }, exec('chief'))).dispatched, true)
  assert.equal((await live.tools.get('bot_dispatch').execute({ text: 'x' }, exec('worker'))).dispatched, false)
  const none = harness({ routing: { dispatch: () => { asked += 1; return { dispatched: true } } }, allowedBotIds: [] })
  assert.equal((await none.tools.get('bot_dispatch').execute({ text: 'x' }, exec('main'))).dispatched, false)
  assert.equal(asked, 1)
})

test('routing tools: a refusal from the service is reported as a refusal, not as a dispatch', async () => {
  const { tools } = harness({ routing: { dispatch: () => { throw Object.assign(new Error('BOT_ROUTING_NO_ELIGIBLE:BOT_DISABLED'), { code: 'BOT_ROUTING_NO_ELIGIBLE' }) } } })
  await assert.rejects(tools.get('bot_dispatch').execute({ text: '整理日志' }, exec('main')), /BOT_ROUTING_NO_ELIGIBLE:BOT_DISABLED/)
})

test('routing tools: the answer is plain JSON a model can read back', async () => {
  const { tools } = harness({ routing: { dispatch: () => ({ dispatched: true, botId: 'worker', planId: 'task-1', packages: [{ id: 'p1', taskId: 'task-1', state: 'ready' }] }) } })
  const answer = await tools.get('bot_dispatch').execute({ text: '整理日志' }, exec('main'))
  assert.deepEqual(JSON.parse(JSON.stringify(answer)), { dispatched: true, botId: 'worker', planId: 'task-1', packages: [{ id: 'p1', taskId: 'task-1', state: 'ready' }] })
})
