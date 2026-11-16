import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createTeamCoordination } from '../packages/orchestration/src/team-bridge.mjs'
import { createIndependentRuntime } from '../packages/orchestration/src/bot-runtime-assembly.mjs'
import { createBotServing } from '../packages/orchestration/src/bot-serving.mjs'
import { parseTeamToolArgs } from '../packages/orchestration/src/team-tool-contract.mjs'
import { integratedInputSnapshot } from '../packages/orchestration/src/team-attention.mjs'

function fixture(t) {
  const base = resolve('tmp/integration/team-attention'); mkdirSync(base, { recursive: true }); const home = mkdtempSync(join(base, 'case-'))
  const bots = Object.fromEntries(['main', 'worker', 'second', 'other'].map(id => [id, { id }]))
  const grants = new Set(Object.keys(bots)), calls = [], state = { worker: null, second: null }
  const serving = createBotServing({ modeOf: () => 'independent' })
  const runtime = createIndependentRuntime({ dir: join(home, 'runtime'), serving, integration: async () => {}, providerFor: botId => async request => {
    calls.push({ botId, input: request.messages.at(-1) }); return state[botId] ? state[botId](request) : { text: botId === 'main' ? 'FINAL' : 'PRIVATE-' + botId + '-RESULT' }
  } })
  const lifecycle = { committedBot: id => bots[id], committedBots: () => Object.values(bots), committedMainBotIds: () => ['main'] }
  const directory = { forBot: botId => ({ botId }) }, authority = { assertTool(subject, tool) { if (!bots[subject.botId] || tool === 'tool/team' && !grants.has(subject.botId)) throw Error('denied') } }
  const options = { Database, file: join(home, 'team.sqlite'), directory, authority, lifecycle, serving, runtime: () => runtime }
  let service = createTeamCoordination(options)
  t.after(() => { service.close(); runtime.close() })
  const input = (args = {}, over = {}) => ({ callerBotId: 'main', conversationId: 'legacy', turnId: 'host-turn', callId: 'call', args: { targets: ['worker'], message: 'Verify the assigned work', ...args }, ...over })
  const inbox = args => service.teamInbox({ ...input(), args })
  return { get service() { return service }, runtime, calls, state, bots, grants, input, inbox, restart() { service.close(); service = createTeamCoordination(options); service.start({ auto: false }) } }
}
const until = async predicate => { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(done => setTimeout(done, 5)) } assert.fail('coordination did not reach the expected state') }

test('parallel fanout finishes with one notification, no result bodies in the prompt, and selected inbox reads', async t => {
  const f = fixture(t); let release
  f.state.second = () => new Promise(done => { release = () => done({ text: 'PRIVATE-second-RESULT' }) })
  const receipt = f.service.coordinateBots(f.input({ targets: ['worker', 'second'], requestKey: 'fanout' }))
  f.service.tick()
  await until(() => release && f.service.store.get(receipt.assignments.find(row => row.targetBot === 'worker').assignmentId).outcome === 'succeeded')
  f.service.tick(); assert.equal(f.calls.filter(row => row.botId === 'main').length, 0)
  release(); await f.service.whenIdle(); await f.service.drain()
  const notices = f.calls.filter(row => row.botId === 'main')
  const noticeText = notices[0]?.input.content.map(part => part.text ?? '').join('\n')
  assert.equal(notices.length, 1); assert.match(noticeText, /Team collaboration inbox/)
  assert.doesNotMatch(noticeText, /PRIVATE-.*-RESULT/)
  assert.equal(f.runtime.teamOriginSnapshot('main', f.runtime.captureTeamOrigin({ botId: 'main', conversationId: 'legacy' })), 'message:empty')
  assert.ok(receipt.assignments.every(row => f.service.store.get(row.assignmentId).resumeState === 'delivered'))
  const summary = f.inbox({}); assert.equal(summary.items.length, 2); assert.doesNotMatch(JSON.stringify(summary), /PRIVATE-.*-RESULT/)
  const id = summary.items.find(row => row.targetBot === 'worker').assignmentId
  assert.equal(f.inbox({ action: 'read', ids: [id] }).items[0].result, 'PRIVATE-worker-RESULT')
  assert.equal(f.inbox({}).items.length, 2, 'a read alone must survive a lost tool response')
  f.inbox({ action: 'acknowledge', ids: [id] })
  assert.equal(f.inbox({}).items.length, 1)
  assert.equal(f.service.coordinateBots(f.input({ targets: ['worker', 'second'], requestKey: 'fanout' })).assignments[0].result, null)
  f.restart(); await f.service.drain()
  assert.equal(f.calls.filter(row => row.botId === 'main').length, 1)
  assert.equal(f.inbox({}).items.length, 1)
})

test('a newer user instruction holds the old notification, preserves the result, and never starts an extra model turn', async t => {
  const f = fixture(t), assignment = f.service.coordinateBots(f.input()).assignments[0]
  await f.runtime.move('main', 'independent')
  await f.runtime.turn({ botId: 'main', input: 'Change of plan: wait for my review.' })
  await f.service.drain()
  const row = f.service.store.get(assignment.assignmentId)
  assert.equal(row.resumeState, 'held'); assert.equal(row.resumeCode, 'TEAM_CONTEXT_CHANGED')
  assert.equal(f.calls.filter(row => row.botId === 'main').length, 1)
  assert.equal(f.inbox({}).items[0].delivery, 'held')
  assert.equal(f.inbox({ action: 'read', ids: [row.assignmentId] }).items[0].result, 'PRIVATE-worker-RESULT')
  await f.service.drain(); assert.equal(f.calls.filter(row => row.botId === 'main').length, 1)
})

test('inbox-only work does not wake the caller; reads are bounded and dismissing a result does not execute work', async t => {
  const f = fixture(t); f.state.worker = async () => ({ text: 'x'.repeat(18000) })
  const id = f.service.coordinateBots(f.input({ reply: 'inbox' })).assignments[0].assignmentId
  await f.service.drain(); assert.equal(f.calls.some(row => row.botId === 'main'), false)
  const part = f.inbox({ action: 'read', ids: [id], max_chars: 128 }).items[0]
  assert.equal(part.result.length, 128); assert.equal(part.nextOffset, 128)
  const next = f.inbox({ action: 'read', ids: [id], offset: 128, max_chars: 16000 }).items[0]
  assert.equal(next.result.length, 16000); assert.equal(next.nextOffset, 16128)
  f.inbox({ action: 'dismiss', ids: [id] })
  assert.equal(f.inbox({}).items.length, 0)
  assert.equal(f.inbox({ include_handled: true }).items[0].inboxState, 'dismissed')
  assert.equal(f.calls.length, 1)
})

test('inbox cannot read another Bot, another conversation, or a peer revoked after completion; mixed ids consume nothing', async t => {
  const f = fixture(t)
  const inbox = args => f.service.teamInbox({ ...f.input({}, { callerBotId: 'other' }), args })
  const own = f.service.coordinateBots(f.input({ reply: 'inbox' }, { callerBotId: 'other' })).assignments[0].assignmentId
  const foreign = f.service.coordinateBots(f.input({ reply: 'inbox' })).assignments[0].assignmentId
  await f.service.drain()
  assert.throws(() => inbox({ action: 'read', ids: [own, foreign] }), { code: 'TEAM_ASSIGNMENT_NOT_FOUND' })
  assert.equal(inbox({}).items.length, 1)
  f.bots.worker.visibility = 'admins'
  assert.equal(inbox({}).items.length, 0)
  assert.throws(() => inbox({ action: 'read', ids: [own] }), { code: 'TEAM_ASSIGNMENT_NOT_FOUND' })
  f.bots.worker.visibility = 'everyone'; f.grants.delete('other')
  assert.throws(() => inbox({}), { code: 'TEAM_CALLER_NOT_AUTHORIZED' })
})

test('acknowledging a pulled result before its pending notification suppresses that redundant wake', async t => {
  const f = fixture(t), id = f.service.coordinateBots(f.input()).assignments[0].assignmentId
  f.service.tick(); await f.service.whenIdle()
  assert.equal(f.service.store.get(id).outcome, 'succeeded')
  f.inbox({ action: 'read', ids: [id] }); f.inbox({ action: 'acknowledge', ids: [id] }); await f.service.drain()
  assert.equal(f.calls.some(row => row.botId === 'main'), false)
  assert.equal(f.service.store.get(id).resumeState, 'consumed')
})

test('inbox parameters reject forged authority, oversized pages and ambiguous read/list combinations', () => {
  for (const args of [{ botId: 'other' }, { action: 'read' }, { ids: ['one'] }, { limit: 51 }, { action: 'read', ids: ['one'], offset: -1 }, { action: 'read', ids: ['one'], max_chars: 16001 }, { action: 'dismiss', ids: ['one', 'one'] }]) assert.throws(() => parseTeamToolArgs('team_inbox', args), { code: 'TEAM_INVALID_ARGS' })
  assert.equal(parseTeamToolArgs('coordinate_bots', { bot_ids: ['worker'], message: 'work', reply: 'inbox' }).reply, 'inbox')
})

test('inbox metadata pages use a stable cursor even after an earlier result is acknowledged', async t => {
  const f = fixture(t)
  f.service.coordinateBots(f.input({ targets: ['worker', 'second'], reply: 'inbox' })); await f.service.drain()
  const first = f.inbox({ limit: 1 }); assert.equal(first.hasMore, true)
  f.inbox({ action: 'acknowledge', ids: [first.items[0].assignmentId] })
  const next = f.inbox({ limit: 1, before: first.nextBefore })
  assert.equal(next.items.length, 1); assert.notEqual(next.items[0].assignmentId, first.items[0].assignmentId); assert.equal(next.hasMore, false)
})

test('dismissing an uncertain result preserves its active execution and authority fence', t => {
  const f = fixture(t), id = f.service.coordinateBots(f.input()).assignments[0].assignmentId
  f.service.store.admit(id)
  f.service.store.beginDispatch(id, { mode: 'independent', workThreadKey: 'work-uncertain', conversationId: 'teamwt-uncertain' }, 'uncertain-target-request')
  f.service.store.fenceUnknown(id, 'TEAM_TARGET_STOP_UNCONFIRMED')
  assert.equal(f.inbox({}).items[0].executionUnconfirmed, true)
  f.inbox({ action: 'dismiss', ids: [id] })
  assert.equal(f.service.store.get(id).targetActive, true)
  assert.throws(() => f.service.assertCanAct('worker', { conversationId: 'teamwt-uncertain' }), { code: 'TEAM_ACCESS_CHANGED' })
  assert.equal(f.calls.length, 0)
})

test('integrated input versions ignore snapshots and team notifications, and reject unversioned interactive events', () => {
  assert.equal(integratedInputSnapshot([{ type: 'user/message', seq: 3, data: {} }, { type: 'user/message', seq: 8, data: { source: { kind: 'bot', role: 'assign-result' } } }, { type: 'user/message', seq: 9, data: { source: { form: 'snapshot' } } }]), 'sdk:3')
  assert.throws(() => integratedInputSnapshot([{ type: 'user/message', data: {} }]), { code: 'TEAM_ORIGIN_SNAPSHOT_UNAVAILABLE' })
})
