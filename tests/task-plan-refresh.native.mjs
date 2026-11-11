import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir, mkdtemp} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {openTaskJournal} from '../packages/orchestration/src/task-journal.mjs'
import {taskHash} from '../packages/orchestration/src/task-contract.mjs'

// Plan state is derived, and it used to be re-derived for every plan on every
// journal write. A Host that has finished a dozen plans paid for all of them on
// each submit. These tests pin the cost down without changing what a plan says.

assert.ok(process.env.DSH_TASK_DRIVER, 'Run through integration-task-probe.mjs with the verified native driver')
const {default: Database} = await import(process.env.DSH_TASK_DRIVER)
const parent = resolve('tmp/integration/task-native')
await mkdir(parent, {recursive: true})
const fresh = async () => join(await mkdtemp(join(parent, 'db-')), 'orchestration.sqlite')

function counted(db) {
  const stats = {prepare: 0}
  const proxy = new Proxy(db, {
    get(target, key) {
      const value = target[key]
      if (key === 'prepare') return (...args) => { stats.prepare++; return target.prepare(...args) }
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return {proxy, stats}
}

const pkg = (id, dependsOn = []) => ({id, targetBotId: 'bot-0', objective: id, dependsOn, acceptance: ['verified'], effectClass: 'read'})
const planOf = (packages, taskId) => ({schemaVersion: 1, taskId, origin: {kind: 'private', botId: 'bot-0', sessionId: null}, planRevision: 1, packages})
const payloadOf = (item) => {
  const target = {effect: item.effectClass, machineId: 'machine-a', workspaceId: 'workspace-a'}
  return {backend: 'fixture', input: {task: item.objective}, target, targetHash: taskHash(target)}
}
const preparedOf = (value, deadline) => ({payloads: value.packages.map((item) => ({id: item.id, payload: payloadOf(item)})), deadline})

async function seeded(t, {plans = 12} = {}) {
  const path = await fresh()
  const raw = new Database(path)
  t.after(() => { try { raw.close() } catch {} })
  const {proxy, stats} = counted(raw)
  const journal = openTaskJournal(Database, path, {database: proxy})
  t.after(() => journal.close())
  const fence = journal.claimRunner('runner-a', 60_000, 0)
  let clock = 1000
  const made = []
  for (let i = 0; i < plans; i++) {
    const value = planOf([pkg('root')], `plan-${i}`)
    made.push(journal.submitPlan(fence, 'bot-0', `plan-request-${i}`, value, clock++, preparedOf(value, clock + 3_600_000)))
  }
  return {journal, stats, fence, made, next: () => clock++}
}

/** Finish a plan's single package so the plan comes to rest. */
function settle(journal, fence, planId, at) {
  const view = journal.getPlan('bot-0', planId)
  for (const entry of view.packages) {
    if (entry.state !== 'ready' || !entry.packageId) continue
    const task = journal.claim(fence, 'bot-0', entry.taskId, at)
    if (task) journal.finish(fence, 'bot-0', entry.taskId, entry.attemptId, 'succeeded', {code: 'OK'}, at + 1)
  }
  return journal.getPlan('bot-0', planId)
}

test('plan refresh/native: a Host with settled plans does not re-evaluate them all', async (t) => {
  const {journal, stats, fence, made, next} = await seeded(t, {plans: 12})
  for (const submitted of made) settle(journal, fence, submitted.planId, next())
  assert.ok(journal.listPlans('bot-0').every((entry) => ['succeeded', 'failed', 'cancelled'].includes(entry.state)), 'the fixture must start at rest')

  stats.prepare = 0
  journal.submit(fence, 'bot-0', 'one-more', 'hash-one-more',
    {backend: 'fixture', input: {text: 'x'}, target: {fixture: true}}, 4_000_000, next())
  assert.ok(stats.prepare < 40, `one submit beside twelve settled plans prepared ${stats.prepare} statements`)
})

test('plan refresh/native: a live plan still follows its members', async (t) => {
  const {journal, fence, made, next} = await seeded(t, {plans: 1})
  assert.equal(journal.getPlan('bot-0', made[0].planId).state, 'ready')
  const view = journal.getPlan('bot-0', made[0].planId)
  const entry = view.packages[0]
  journal.claim(fence, 'bot-0', entry.taskId, next())
  assert.equal(journal.getPlan('bot-0', made[0].planId).state, 'running')
  journal.finish(fence, 'bot-0', entry.taskId, entry.attemptId, 'succeeded', {code: 'OK'}, next())
  assert.equal(journal.getPlan('bot-0', made[0].planId).state, 'succeeded')
})

test('plan refresh/native: a settled plan is read, not rewritten, by an unrelated write', async (t) => {
  const {journal, fence, made, next} = await seeded(t, {plans: 1})
  const at = next()
  const settled = settle(journal, fence, made[0].planId, at)
  assert.equal(settled.state, 'succeeded')
  const before = journal.listPlans('bot-0').find((entry) => entry.planId === made[0].planId)
  journal.submit(fence, 'bot-0', 'unrelated', 'hash-unrelated',
    {backend: 'fixture', input: {text: 'x'}, target: {fixture: true}}, 4_000_000, at + 5000)
  const after = journal.listPlans('bot-0').find((entry) => entry.planId === made[0].planId)
  assert.deepEqual(after, before, 'a settled plan keeps its derived state and its updated_at')
})

test('plan refresh/native: cancelling a plan records the request once', async (t) => {
  const {journal, fence, made, next} = await seeded(t, {plans: 1})
  const at = next()
  const view = journal.getPlan('bot-0', made[0].planId)
  journal.claim(fence, 'bot-0', view.packages[0].taskId, at)
  const cancelled = journal.cancelPlan(fence, 'bot-0', made[0].planId, at + 10)
  assert.ok(['cancelling', 'cancelled'].includes(cancelled.state))
  const again = journal.cancelPlan(fence, 'bot-0', made[0].planId, at + 20)
  assert.ok(['cancelling', 'cancelled'].includes(again.state), 'a repeated cancel is idempotent')
  const events = journal.events('bot-0', view.packages[0].taskId).filter((entry) => entry.kind === 'cancel-requested')
  assert.equal(events.length, 1, 'one cancellation is one recorded request')
})
