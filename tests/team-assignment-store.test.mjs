import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createTeamAssignmentStore, computeBriefHash, standingThreadKey, assertNoCycle, assertDepth } from '../packages/orchestration/src/team-assignment-store.mjs'
const spec = (over = {}) => ({ parentBot: 'main', targetBot: 'worker', originKey: 'original', origin: { mode: 'independent', contextId: 'legacy', conversationId: 'legacy' }, workThreadKey: 'standing-one', mode: 'work', reply: 'resume', briefHash: computeBriefHash('work', 'task'), brief: 'task', requestKey: 'one', lineage: ['main', 'worker'], depth: 1, rootBot: 'main', createdByTurn: 'turn-one', ...over })
function fixture(t, options = {}) { const root = resolve('tmp/integration/team-runtime/store'); mkdirSync(root, { recursive: true }); const file = options.file ?? join(mkdtempSync(join(root, 'db-')), 'assignments.sqlite'); const store = createTeamAssignmentStore({ Database, file, ...options }); t.after(() => store.close()); return { store, file } }
const running = (store, row) => { store.admit(row.assignmentId); store.beginDispatch(row.assignmentId, { mode: 'independent', workThreadKey: row.workThreadKey }, `target-${row.assignmentId}`) }

test('atomic fanout idempotency binds the full request, independent of child IDs', t => {
  const { store } = fixture(t)
  const specs = [spec(), spec({ targetBot: 'second', workThreadKey: 'standing-two' })]
  const first = store.createBatch(specs, { requestKey: 'fanout' })
  assert.equal(first.assignments.length, 2)
  assert.notEqual(first.assignments[0].assignmentId, first.assignments[1].assignmentId)
  const replay = store.createBatch(specs, { requestKey: 'fanout' })
  assert.deepEqual(replay.assignments.map(row => row.assignmentId), first.assignments.map(row => row.assignmentId))
  assert.equal(store.createBatch([spec()], { requestKey: 'fanout' }).status, 'conflict')
  assert.equal(store.all().length, 2)
  assert.equal(first.assignments[0].rootAssignmentId, first.assignments[0].assignmentId)
})

test('duplicate briefs are scoped to a Host turn; explicit rework links corrections across turns', t => {
  const { store } = fixture(t)
  const first = store.create(spec()).assignment
  assert.equal(store.create(spec({ requestKey: 'other-call' })).assignment.duplicate, true)
  assert.throws(() => store.create(spec({ requestKey: 'rework-open', rework: true })), { code: 'TEAM_REWORK_NOT_TERMINAL' })
  running(store, first); store.settle(first.assignmentId, { outcome: 'succeeded', resultText: 'answer' })
  const rework = store.create(spec({ requestKey: 'correction', rework: true, brief: 'fix a detail', briefHash: computeBriefHash('work', 'fix a detail'), createdByTurn: 'later' })).assignment
  assert.equal(rework.reworkOf, first.assignmentId)
  assert.notEqual(rework.assignmentId, first.assignmentId)
  assert.notEqual(store.create(spec({ requestKey: 'new-turn', createdByTurn: 'new-turn' })).assignment.assignmentId, first.assignmentId)
})

test('a fanout whose final rework is invalid inserts none of its first children', t => {
  const { store } = fixture(t)
  store.create(spec())
  assert.throws(() => store.createBatch([spec({ targetBot: 'other', workThreadKey: 'other' }), spec({ rework: true })], { requestKey: 'bad-batch' }), { code: 'TEAM_REWORK_NOT_TERMINAL' })
  assert.equal(store.all().length, 1)
})

test('restart keeps queued requests, fences admission and ambiguous delivery, and never rearms running requests', t => {
  const first = fixture(t), { store } = first
  const queued = store.create(spec()).assignment
  const admitting = store.create(spec({ requestKey: 'admit', workThreadKey: 'admit' })).assignment; store.admit(admitting.assignmentId)
  const active = store.create(spec({ requestKey: 'running', workThreadKey: 'running' })).assignment; running(store, active)
  const sending = store.create(spec({ requestKey: 'sending', workThreadKey: 'sending' })).assignment; running(store, sending); store.settle(sending.assignmentId, { outcome: 'succeeded' }); store.markResumeSending(sending.assignmentId)
  store.close()
  const restarted = fixture(t, { file: first.file }).store
  assert.equal(restarted.recover().fenced, 2)
  assert.equal(restarted.get(queued.assignmentId).state, 'queued')
  assert.equal(restarted.get(admitting.assignmentId).state, 'unknown')
  assert.equal(restarted.get(active.assignmentId).state, 'running')
  assert.equal(restarted.get(sending.assignmentId).resumeState, 'uncertain')
  assert.equal(restarted.get(sending.assignmentId).state, 'settled')
})

test('second live owner is refused; an old stolen owner cannot read or mutate', t => {
  const { store, file } = fixture(t)
  const row = store.create(spec()).assignment
  assert.throws(() => createTeamAssignmentStore({ Database, file }), { code: 'TEAM_STORE_ALREADY_OWNED' })
  const replacement = fixture(t, { file, isProcessAlive: () => false }).store
  assert.throws(() => store.admit(row.assignmentId), { code: 'TEAM_STORE_OWNER_LOST' })
  assert.throws(() => store.get(row.assignmentId), { code: 'TEAM_STORE_OWNER_LOST' })
  assert.equal(replacement.get(row.assignmentId).state, 'queued')
})

test('a stop before dispatch cancels; a stop after dispatch stays intent until exact receipt', t => {
  const { store } = fixture(t)
  const queued = store.create(spec()).assignment
  store.requestCancel(queued.assignmentId)
  assert.equal(store.get(queued.assignmentId).state, 'cancelled')
  const active = store.create(spec({ requestKey: 'active', workThreadKey: 'active' })).assignment; running(store, active)
  store.requestCancel(active.assignmentId)
  assert.equal(store.get(active.assignmentId).state, 'running')
  store.settle(active.assignmentId, { outcome: 'cancelled' })
  assert.equal(store.get(active.assignmentId).resumeState, 'withheld')
  assert.equal(store.markResumeSending(active.assignmentId), false)
})

test('depth means four delegation edges; notices cannot waive ancestry cycles', () => {
  assert.doesNotThrow(() => assertDepth(['root', 'a', 'b', 'c'], 4))
  assert.throws(() => assertDepth(['root', 'a', 'b', 'c', 'd'], 4), { code: 'TEAM_TOO_DEEP' })
  assert.throws(() => assertNoCycle(['root', 'a'], 'root', 'notice'), { code: 'TEAM_CYCLE' })
  assert.notEqual(standingThreadKey('a', 'b', 'one'), standingThreadKey('a', 'b', 'two'))
})

test('a resume frame persists across awaits and an uncertain live execution stays fenced until Host recovery', t => {
  const first = fixture(t), { store } = first
  const parent = store.create(spec({ reply: 'none' })).assignment; running(store, parent)
  const child = store.create(spec({ parentBot: 'worker', targetBot: 'main', originKey: 'parent-work', origin: { mode: 'independent', conversationId: 'parent-work' }, requestKey: 'child', parentAssignmentId: parent.assignmentId, rootAssignmentId: parent.assignmentId })).assignment
  store.settle(parent.assignmentId, { outcome: 'succeeded' })
  running(store, child); store.settle(child.assignmentId, { outcome: 'succeeded' }); store.markResumeSending(child.assignmentId)
  assert.equal(store.activeFor('worker', { conversationId: 'parent-work' }).assignmentId, parent.assignmentId)
  store.completeResume(child.assignmentId, 'uncertain', { executionFinished: false })
  assert.equal(store.get(child.assignmentId).resumeActive, true)
  assert.equal(store.activeFor('worker', { conversationId: 'parent-work' }).cancelRequestedAt !== null, true)
  store.close()
  const recovered = fixture(t, { file: first.file }).store
  recovered.recover()
  assert.equal(recovered.activeFor('worker', { conversationId: 'parent-work' }), null)
  assert.equal(recovered.get(child.assignmentId).resumeState, 'uncertain')
  assert.equal(recovered.resumeDue().length, 0)
})
