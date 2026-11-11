import test from 'node:test'
import assert from 'node:assert/strict'
import { registerTeamTools } from '../packages/orchestration/src/team-sdk-tools.mjs'

const exec = botId => ({ agent: { botId, session: { id: `session-${botId}` }, ctx: { sessionProjections: { stateOf: () => ({ openTurnStartSeq: 7 }) } } }, callId: 'call-one', signal: new AbortController().signal })

function harness({ names = null, throwOn = null } = {}) {
  const tools = new Map()
  const ctx = { tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } } }
  const calls = []
  const service = {
    canUse: () => true,
    coordinateBots: async request => { calls.push(['coordinateBots', request]); if (throwOn === 'coordinateBots') throw Object.assign(new Error('cycle'), { code: 'TEAM_CYCLE' }); return { assignments: [{ targetBot: request.args.targets[0], state: 'queued' }] } },
    assignmentStatus: async request => { calls.push(['assignmentStatus', request]); return { assignments: [] } },
    listBots: async request => { calls.push(['listBots', request]); return { bots: [] } },
    listThreads: async request => { calls.push(['listThreads', request]); return { threads: [] } },
  }
  const release = registerTeamTools(ctx, { service, botIdFor: e => e?.agent?.botId ?? null, ...(names ? { names } : {}) })
  return { tools, release, calls, service }
}

test('the SDK door registers the team tools and derives the caller from the live session', async () => {
  const { tools, calls } = harness()
  assert.deepEqual([...tools.keys()].sort(), ['assignment_status', 'coordinate_bots', 'list_threads'])
  const answer = await tools.get('coordinate_bots').execute({ bot_ids: ['worker'], message: 'do it' }, exec('main'))
  assert.deepEqual(answer, { assignments: [{ targetBot: 'worker', state: 'queued' }] })
  const [method, request] = calls[0]
  assert.equal(method, 'coordinateBots')
  assert.equal(request.callerBotId, 'main') // from the session, never an argument
  assert.equal(request.sessionId, 'session-main')
  assert.deepEqual(request.args.targets, ['worker']) // projected business args
})

test('the parent can withhold the vendored list_bots from the integrated door by name', () => {
  const { tools } = harness({ names: ['coordinate_bots', 'assignment_status', 'list_threads'] })
  assert.deepEqual([...tools.keys()].sort(), ['assignment_status', 'coordinate_bots', 'list_threads'])
})

test('an unidentifiable caller and a service refusal are returned as values, never crashes', async () => {
  const { tools } = harness()
  const anon = await tools.get('list_threads').execute({}, { agent: {} })
  assert.equal(anon.error.code, 'unknown_subject')
  const refused = harness({ throwOn: 'coordinateBots' })
  const answer = await refused.tools.get('coordinate_bots').execute({ bot_ids: ['worker'], message: 'x' }, exec('main'))
  assert.equal(answer.error.code, 'TEAM_CYCLE')
})

test('release unregisters every tool', () => {
  const { tools, release } = harness()
  assert.equal(tools.size, 3)
  release()
  assert.equal(tools.size, 0)
})

test('registerTeamTools refuses a Host without a registry or a caller resolver', () => {
  assert.throws(() => registerTeamTools({}, { service: { coordinateBots() {} }, botIdFor: () => 'x' }), /TEAM_TOOLS_REQUIRE_CTX/)
  assert.throws(() => registerTeamTools({ tools: { register: () => () => {} } }, { botIdFor: () => 'x' }), /TEAM_TOOLS_REQUIRE_SERVICE/)
  assert.throws(() => registerTeamTools({ tools: { register: () => () => {} } }, { service: { coordinateBots() {} } }), /TEAM_TOOLS_REQUIRE_BOT_ID_FOR/)
})
