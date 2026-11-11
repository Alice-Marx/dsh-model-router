import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createTeamCoordination } from '../packages/orchestration/src/team-bridge.mjs'
import { createIndependentRuntime } from '../packages/orchestration/src/bot-runtime-assembly.mjs'
import { createBotServing } from '../packages/orchestration/src/bot-serving.mjs'

function fixture(t) {
  const root = resolve('tmp/integration/team-runtime/service'); mkdirSync(root, { recursive: true }); const dir = mkdtempSync(join(root, 'case-'))
  const bots = Object.fromEntries(['main', 'worker', 'a', 'b', 'c', 'd', 'private'].map(id => [id, { id, name: id, ...(id === 'private' ? { visibility: 'admins' } : {}) }]))
  const grants = new Set(['main', 'worker']), calls = []
  const serving = createBotServing({ modeOf: () => 'independent' })
  const runtime = createIndependentRuntime({ dir: join(dir, 'runtime'), serving, integration: async () => {}, providerFor: botId => async () => { calls.push(botId); return { text: `answer-${botId}`, source: { kind: 'model', provider: botId, model: 'offline' } } } })
  const lifecycle = { committedBot: id => bots[id] ?? null, committedBots: () => Object.values(bots), committedMainBotIds: () => ['main'] }
  const directory = { forBot: id => ({ botId: id }) }, authority = { assertTool(subject, tool) { if (!bots[subject.botId] || tool === 'tool/team' && !grants.has(subject.botId)) throw Error('denied') } }
  const service = createTeamCoordination({ Database, file: join(dir, 'team.sqlite'), directory, authority, lifecycle, serving, runtime: () => runtime })
  t.after(() => { service.close(); runtime.close() })
  const input = (args = {}, over = {}) => ({ callerBotId: 'main', conversationId: 'legacy', turnId: 'host-turn-one', callId: 'host-call-one', args: { targets: ['worker'], message: 'work', thread: 'standing', reply: 'resume', consult: false, rework: false, ...args }, ...over })
  return { service, runtime, calls, bots, grants, input }
}

test('standing work executes in a real separate transcript and resumes the original sender once', async t => {
  const { service, runtime, calls, input } = fixture(t)
  const receipt = service.coordinateBots(input()), id = receipt.assignments[0].assignmentId
  await service.drain()
  assert.deepEqual(calls, ['worker', 'main'])
  const row = service.store.get(id)
  assert.equal(row.resumeState, 'delivered')
  assert.equal(runtime.history('worker').length, 0)
  assert.equal(runtime.workThreadRead('worker', row.workThreadKey, row.targetRequestId).answer, 'answer-worker')
  assert.equal(service.coordinateBots(input()).assignments[0].assignmentId, id)
  await service.drain(); assert.equal(calls.length, 2)
})

test('full fanout validates before effects, and the request key binds all child targets', t => {
  const { service, input } = fixture(t)
  assert.throws(() => service.coordinateBots(input({ targets: ['worker', 'missing'] })), { code: 'TEAM_CALLER_NOT_AUTHORIZED' })
  assert.equal(service.store.all().length, 0)
  const receipt = service.coordinateBots(input({ targets: ['worker', 'a', 'b', 'c'], requestKey: 'fanout' }))
  assert.equal(receipt.assignments.length, 4)
  assert.equal(new Set(receipt.assignments.map(row => row.assignmentId)).size, 4)
  assert.throws(() => service.coordinateBots(input({ targets: ['a'], requestKey: 'fanout' })), { code: 'TEAM_REQUEST_CONFLICT' })
  assert.throws(() => service.coordinateBots(input({ targets: ['worker', 'a', 'b', 'c', 'main'] })), { code: 'TEAM_INVALID_ARGS' })
  assert.equal(service.store.all().length, 4)
})

test('ordinary team-granted Bots reach eligible peers, with no private roster/result leakage after live changes', async t => {
  const { service, input, bots, grants } = fixture(t)
  assert.equal(service.canUse('worker'), true)
  assert.equal(service.canUse('a'), false)
  const origin = { callerBotId: 'worker', conversationId: 'legacy', turnId: 'ordinary', callId: 'one' }
  assert.equal(service.listBots(origin).bots.some(bot => bot.id === 'private'), false)
  assert.throws(() => service.coordinateBots(input({ targets: ['private'] }, origin)), { code: 'TEAM_CALLER_NOT_AUTHORIZED' })
  const receipt = service.coordinateBots(input({ targets: ['a'] }, origin))
  await service.drain()
  bots.a.hidden = true
  assert.throws(() => service.assignmentStatus({ ...origin, turnId: 'later', args: { id: receipt.assignments[0].assignmentId } }), { code: 'TEAM_ASSIGNMENT_NOT_FOUND' })
  assert.equal(service.listThreads(origin).threads.length, 0)
  assert.throws(() => service.validateResult(origin, { bots: [{ id: 'a', name: 'must be withheld' }] }), { code: 'TEAM_ACCESS_CHANGED' })
  grants.delete('worker')
  assert.throws(() => service.listBots(origin), { code: 'TEAM_CALLER_NOT_AUTHORIZED' })
})

test('status is origin scoped and same-turn polling is refused; explicit rework creates a new linked request', async t => {
  const { service, input } = fixture(t)
  const receipt = service.coordinateBots(input({ requestKey: 'first' })), id = receipt.assignments[0].assignmentId
  assert.throws(() => service.assignmentStatus({ ...input(), args: { id } }), { code: 'TEAM_STATUS_SAME_TURN' })
  await service.drain()
  const rework = service.coordinateBots(input({ message: 'correct one detail', rework: true, requestKey: 'correction' }, { turnId: 'later' }))
  assert.equal(rework.assignments[0].reworkOf, id)
  assert.notEqual(rework.assignments[0].assignmentId, id)
  assert.equal(service.assignmentStatus({ ...input(), turnId: 'after-correction-turn', args: { id } }).assignment.result, 'answer-worker')
})

test('nested lineage is looked up durably by exact work conversation, including parent request and root IDs', async t => {
  const { service, input } = fixture(t)
  const parent = service.coordinateBots(input()).assignments[0]
  service.store.admit(parent.assignmentId)
  const targetRef = { mode: 'independent', workThreadKey: parent.workThreadKey, conversationId: 'teamwt-active' }
  service.store.beginDispatch(parent.assignmentId, targetRef, 'exact-parent-request')
  const child = service.coordinateBots(input({ targets: ['a'], reply: 'none' }, { callerBotId: 'worker', conversationId: 'teamwt-active', turnId: 'nested', callId: 'nested-call' })).assignments[0]
  const row = service.store.get(child.assignmentId)
  assert.equal(row.parentAssignmentId, parent.assignmentId)
  assert.equal(row.rootAssignmentId, parent.assignmentId)
  assert.equal(row.parentRequestId, 'exact-parent-request')
  assert.deepEqual(row.lineage, ['main', 'worker', 'a'])
  assert.throws(() => service.coordinateBots(input({ targets: ['main'], reply: 'none' }, { callerBotId: 'worker', conversationId: 'teamwt-active', turnId: 'nested', callId: 'cycle' })), { code: 'TEAM_CYCLE' })
  service.stop('main')
  assert.equal(service.store.get(child.assignmentId).state, 'cancelled')
  assert.equal(service.store.get(parent.assignmentId).cancelRequestedAt !== null, true)
})

test('consult scope rejects tool actions, while a plain default chat is unaffected', t => {
  const { service, input } = fixture(t)
  const row = service.coordinateBots(input({ consult: true })).assignments[0]
  service.store.admit(row.assignmentId); service.store.beginDispatch(row.assignmentId, { mode: 'independent', conversationId: 'teamwt-consult', workThreadKey: row.workThreadKey }, 'consult-request')
  assert.throws(() => service.assertCanAct('worker', { conversationId: 'teamwt-consult' }), { code: 'TEAM_CONSULT_READ_ONLY' })
  assert.doesNotThrow(() => service.assertCanAct('worker', { conversationId: 'legacy' }))
})

test('a child result reattaches a settled parent ancestry until the real resumed turn ends', t => {
  const { service, input, grants } = fixture(t)
  for (const id of ['a', 'b', 'c', 'd']) grants.add(id)
  const begin = (row, conversationId) => { service.store.admit(row.assignmentId); service.store.beginDispatch(row.assignmentId, { mode: 'independent', conversationId, workThreadKey: row.workThreadKey }, `request-${conversationId}`) }
  const delegate = (callerBotId, conversationId, target, key) => service.coordinateBots(input({ targets: [target], requestKey: key }, { callerBotId, conversationId, turnId: `turn-${key}`, callId: key })).assignments[0]
  const first = delegate('main', 'legacy', 'worker', 'first'); begin(first, 'teamwt-worker')
  const second = delegate('worker', 'teamwt-worker', 'a', 'second'); begin(second, 'teamwt-a')
  const parent = delegate('a', 'teamwt-a', 'b', 'parent'); begin(parent, 'teamwt-b')
  const child = delegate('b', 'teamwt-b', 'c', 'child'); begin(child, 'teamwt-c')
  // B ended its own original request while C was still working.
  service.store.settle(parent.assignmentId, { outcome: 'succeeded' }); service.store.markResumeSending(parent.assignmentId); service.store.completeResume(parent.assignmentId, 'delivered')
  service.store.settle(child.assignmentId, { outcome: 'succeeded' }); service.store.markResumeSending(child.assignmentId)
  const active = service.store.activeFor('b', { conversationId: 'teamwt-b' })
  assert.equal(active.assignmentId, parent.assignmentId)
  assert.equal(active.resumeAssignmentId, child.assignmentId)
  assert.deepEqual(active.lineage, ['main', 'worker', 'a', 'b'])
  const before = service.store.all().length
  assert.throws(() => delegate('b', 'teamwt-b', 'a', 'ancestor'), { code: 'TEAM_CYCLE' })
  assert.throws(() => delegate('b', 'teamwt-b', 'b', 'self'), { code: 'TEAM_SELF_TARGET' })
  assert.equal(service.store.all().length, before)
  const lastAllowed = delegate('b', 'teamwt-b', 'd', 'fourth-edge'); begin(lastAllowed, 'teamwt-d')
  assert.equal(lastAllowed.depth, 4)
  assert.throws(() => delegate('d', 'teamwt-d', 'c', 'fifth-edge'), { code: 'TEAM_TOO_DEEP' })
  assert.equal(service.store.all().length, before + 1)
  service.stop('b')
  assert.throws(() => service.assertCanAct('b', { conversationId: 'teamwt-b' }), { code: 'TEAM_ACCESS_CHANGED' })
  assert.equal(service.store.get(child.assignmentId).resumeActive, true, 'a cancellation request does not erase a live resume frame')
  service.store.completeResume(child.assignmentId, 'uncertain', { executionFinished: false })
  assert.throws(() => service.assertCanAct('b', { conversationId: 'teamwt-b' }), { code: 'TEAM_ACCESS_CHANGED' })
})
