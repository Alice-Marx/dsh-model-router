import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createTeamAssignmentStore, computeBriefHash, standingThreadKey } from '../packages/orchestration/src/team-assignment-store.mjs'
import { createTeamScheduler } from '../packages/orchestration/src/team-scheduler.mjs'
import { MODE_WORK, REPLY_RESUME } from '../packages/orchestration/src/team-tool-contract.mjs'

function fixture(t) {
  const parent = resolve('tmp/integration/team-runtime/scheduler'); mkdirSync(parent, { recursive: true })
  const file = join(mkdtempSync(join(parent, 'db-')), 'assignments.sqlite')
  const store = createTeamAssignmentStore({ Database, file })
  t.after(() => store.close())
  const state = { busy: new Set(), committed: new Set(['main', 'worker', 'a', 'b']), access: true, dispatches: [], resumes: [], reads: [], dispatch: async () => ({ started: true, outcome: 'succeeded', text: 'result' }), read: async () => ({ outcome: 'succeeded', text: 'reconciled' }), resume: async () => ({ resumed: true }), resumeError: null }
  const bridge = {
    resolveTargetRef: async assignment => ({ mode: 'independent', workThreadKey: assignment.workThreadKey }),
    dispatchTarget: async request => { state.dispatches.push(request.targetBot); return state.dispatch(request) },
    readTarget: async request => { state.reads.push(request.assignmentId); return state.read(request) },
    resumeSender: async request => { state.resumes.push({ targetBot: request.targetBot, text: request.resultText }); if (state.resumeError) throw state.resumeError; return state.resume(request) },
    cancelTarget: async () => {},
    isBusy: botId => state.busy.has(botId),
  }
  const checks = { committedBot: id => (state.committed.has(id) ? { id } : null), accessAllowed: () => state.access }
  const scheduler = createTeamScheduler({ store, bridge, checks })
  t.after(() => scheduler.close())
  const queue = (over = {}) => store.create({
    parentBot: 'main', targetBot: 'worker', workThreadKey: standingThreadKey('main', 'worker'), mode: MODE_WORK, reply: REPLY_RESUME,
    briefHash: computeBriefHash(MODE_WORK, 'do it', null, false), brief: 'do it', doneWhen: null, rework: false,
    requestKey: over.requestKey ?? `req-${Math.random().toString(36).slice(2)}`, lineage: ['main', 'worker'], depth: 2, rootBot: 'main',
  }).assignment
  return { store, scheduler, state, queue }
}
const drain = async scheduler => { for (let i = 0; i < 6; i += 1) { scheduler.tick(); await scheduler.whenIdle() } }

test('a queued assignment dispatches once, settles, and resumes the sender once', async t => {
  const { scheduler, state, queue } = fixture(t)
  queue()
  await drain(scheduler)
  assert.deepEqual(state.dispatches, ['worker'])
  assert.equal(state.resumes.length, 1)
  assert.equal(state.resumes[0].targetBot, 'worker')
})

test('a busy target is skipped and retried, never failed', async t => {
  const { scheduler, state, queue } = fixture(t)
  state.busy.add('worker')
  const row = queue()
  await drain(scheduler)
  assert.deepEqual(state.dispatches, []) // never dispatched while busy
  state.busy.delete('worker')
  await drain(scheduler)
  assert.deepEqual(state.dispatches, ['worker'])
})

test('a live revoke before dispatch cancels the assignment; nothing is dispatched or resumed', async t => {
  const { scheduler, state, queue, store } = fixture(t)
  const row = queue()
  state.access = false
  await drain(scheduler)
  assert.deepEqual(state.dispatches, [])
  assert.deepEqual(state.resumes, [])
  assert.equal(store.get(row.assignmentId).state, 'cancelled')
  assert.equal(store.get(row.assignmentId).resultCode, 'TEAM_ACCESS_CHANGED')
})

test('an unknown target outcome is fenced, never rewritten and never resumed', async t => {
  const { scheduler, state, queue, store } = fixture(t)
  state.dispatch = async () => ({ started: true, outcome: 'unknown', code: 'TEAM_TARGET_ANSWER_UNCONFIRMED' })
  const row = queue()
  await drain(scheduler)
  const done = store.get(row.assignmentId)
  assert.equal(done.state, 'unknown'); assert.equal(done.outcome, 'unknown'); assert.equal(done.resultCode, 'TEAM_TARGET_ANSWER_UNCONFIRMED')
  assert.deepEqual(state.resumes, [])
})

test('a failed target still resumes the sender, carrying the failure', async t => {
  const { scheduler, state, queue, store } = fixture(t)
  state.dispatch = async () => ({ started: true, outcome: 'failed', code: 'TEAM_TARGET_FAILED' })
  const row = queue()
  await drain(scheduler)
  const done = store.get(row.assignmentId)
  assert.equal(done.state, 'settled'); assert.equal(done.outcome, 'failed'); assert.equal(done.resumeState, 'delivered')
  assert.equal(state.resumes.length, 1)
})

test('a resume that throws after the sending marker completes uncertain and is never resent', async t => {
  const { scheduler, state, queue, store } = fixture(t)
  state.resumeError = Object.assign(new Error('lost the reply'), { code: 'TEAM_TRANSPORT_LOST' })
  const row = queue()
  await drain(scheduler)
  const done = store.get(row.assignmentId)
  assert.equal(done.state, 'settled'); assert.equal(done.resumeState, 'uncertain')
  assert.equal(state.resumes.length, 1) // at most one attempt
  await drain(scheduler)
  assert.equal(state.resumes.length, 1) // never auto-resent
})

test('a not-started dispatch (busy race) is re-armed, not settled', async t => {
  const { scheduler, state, queue, store } = fixture(t)
  state.dispatch = async () => ({ started: false, code: 'TEAM_TARGET_BUSY' })
  const row = queue()
  await drain(scheduler)
  assert.equal(store.get(row.assignmentId).state, 'queued')
})

test('a resume that provably did not start is re-armed and retried, not fenced uncertain', async t => {
  const { scheduler, state, queue, store } = fixture(t)
  let attempts = 0
  state.resume = async () => { attempts += 1; if (attempts === 1) throw Object.assign(new Error('busy'), { code: 'TEAM_TARGET_BUSY', started: false }); return { resumed: true } }
  const row = queue()
  await drain(scheduler)
  const done = store.get(row.assignmentId)
  assert.equal(done.state, 'settled')
  assert.equal(done.resumeState, 'delivered')
  assert.equal(attempts, 2) // first refused (not started, retried), second delivered
})

test('restart reconciles a running row from the target read and never re-dispatches', async t => {
  const { scheduler, state, queue, store } = fixture(t)
  const row = queue()
  store.admit(row.assignmentId)
  store.beginDispatch(row.assignmentId, { mode: 'independent', workThreadKey: row.workThreadKey }, 'teamreq-prior')
  // A fresh scheduler models a restart: the running row must be reconciled, not rerun.
  await drain(scheduler)
  assert.deepEqual(state.dispatches, []) // never re-dispatched
  assert.deepEqual(state.reads, [row.assignmentId])
  assert.equal(store.get(row.assignmentId).state, 'settled')
  assert.equal(store.get(row.assignmentId).resultText, 'reconciled')
})

test('a parent stop fences the whole subtree\'s dispatches and resumes', async t => {
  const { scheduler, state, queue, store } = fixture(t)
  const row = queue({ requestKey: 'req-stop' })
  store.admit(row.assignmentId); store.beginDispatch(row.assignmentId, { mode: 'independent', workThreadKey: row.workThreadKey }, 'teamreq-1')
  const stopped = scheduler.stop('worker')
  assert.ok(stopped.stopped.includes(row.assignmentId))
  assert.equal(store.get(row.assignmentId).cancelRequestedAt !== null, true)
})
