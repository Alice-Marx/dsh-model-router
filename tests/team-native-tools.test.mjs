import test from 'node:test'
import assert from 'node:assert/strict'
import { createNativeTeamTools } from '../packages/orchestration/src/native-team-tools.mjs'
import { TEAM_CODES } from '../packages/orchestration/src/team-tool-contract.mjs'

const coded = fn => { try { fn() } catch (error) { return error } return null }
function harness(over = {}) {
  const calls = []
  let validations = 0
  const service = {
    canUse: () => true,
    coordinateBots: async request => { calls.push(['coordinateBots', request]); if (over.throwOn === 'coordinateBots') throw Object.assign(new Error('nope'), { code: TEAM_CODES.CYCLE }); return { assignments: [{ targetBot: request.args.targets[0], state: 'queued', result: null }] } },
    assignmentStatus: async request => { calls.push(['assignmentStatus', request]); return { assignments: [] } },
    listBots: async request => { calls.push(['listBots', request]); return { bots: [{ id: 'worker', main: false }] } },
    listThreads: async request => { calls.push(['listThreads', request]); return { threads: [] } },
  }
  const factory = createNativeTeamTools({ service, callerBotId: 'main', conversationId: 'teamwt-xyz', validate: async () => { validations += 1 }, ...over.factory })
  return { factory, calls, validations: () => validations, handler: name => factory.handlers.find(entry => entry.definition.name === name) }
}
const context = () => ({ context: { turnId: 'turn-1', callId: 'call-1' }, signal: new AbortController().signal })

test('the native door offers exactly the four team tools', () => {
  const { factory } = harness()
  assert.deepEqual(factory.tools, ['coordinate_bots', 'assignment_status', 'list_bots', 'list_threads'])
  for (const entry of factory.handlers) {
    assert.equal(entry.definition.inputSchema.additionalProperties, false)
    assert.equal(entry.capability, 'tool/team')
  }
})

test('coordinate_bots parses, projects and calls the service with the Host identity, never an argument botId', async () => {
  const { handler, calls, validations } = harness()
  const entry = handler('coordinate_bots')
  const parsed = entry.parse({ bot_ids: ['worker'], message: 'do it' })
  const value = await entry.execute(parsed, context())
  assert.deepEqual(value, { assignments: [{ targetBot: 'worker', state: 'queued', result: null }] })
  const [method, request] = calls[0]
  assert.equal(method, 'coordinateBots')
  assert.equal(request.callerBotId, 'main')
  assert.equal(request.conversationId, 'teamwt-xyz')
  assert.deepEqual(request.args.targets, ['worker'])
  assert.equal(validations(), 2)
})

test('a parse refuses an authority key before the service is reached', () => {
  const { handler, calls } = harness()
  assert.equal(coded(() => handler('coordinate_bots').parse({ bot_ids: ['worker'], message: 'x', botId: 'worker' }))?.code, TEAM_CODES.INVALID_ARGS)
  assert.equal(calls.length, 0)
})

test('a service refusal is returned as a coded value the model can read, not a crash', async () => {
  const { handler } = harness({ throwOn: 'coordinateBots' })
  const value = await handler('coordinate_bots').execute({ bot_ids: ['worker'], message: 'x' }, context())
  assert.equal(value.error.code, TEAM_CODES.CYCLE)
})

test('read tools call their service method and take no authority key', async () => {
  const { handler, calls } = harness()
  assert.deepEqual(await handler('list_bots').execute({}, context()), { bots: [{ id: 'worker', main: false }] })
  assert.equal(calls[0][0], 'listBots')
  assert.equal(coded(() => handler('list_bots').parse({ botId: 'x' }))?.code, TEAM_CODES.INVALID_ARGS)
})

test('catalog filters current capability and post-await revoke withholds the whole result', async () => {
  let granted = false
  const service = { canUse: () => granted, coordinateBots() {}, listBots: async () => { granted = false; return { bots: [{ id: 'private-result' }] } } }
  const options = { service, callerBotId: 'worker', validate: async () => {} }
  assert.deepEqual(createNativeTeamTools(options).tools, [])
  granted = true
  const handler = createNativeTeamTools(options).handlers.find(row => row.definition.name === 'list_bots')
  const value = await handler.execute({}, context())
  assert.equal(value.error.code, 'TEAM_CALLER_NOT_AUTHORIZED')
  assert.equal(JSON.stringify(value).includes('private-result'), false)
  assert.equal(handler.render(value).isError, true)
})

test('status and errors redact every nested string without coercing JSON types', async () => {
  const service = { canUse: () => true, coordinateBots() {}, assignmentStatus: async () => ({ assignment: { result: 'fixture-secret', nested: ['fixture-secret', 0, false, null] } }) }
  const handler = createNativeTeamTools({ service, callerBotId: 'main', validate: async () => {}, redact: text => text.replaceAll('fixture-secret', '[redacted]') }).handlers.find(row => row.definition.name === 'assignment_status')
  const value = await handler.execute({}, context())
  assert.deepEqual(value.assignment.nested, ['[redacted]', 0, false, null])
  assert.equal(value.assignment.result, '[redacted]')
  assert.equal(handler.render(value).isError, undefined)
})
