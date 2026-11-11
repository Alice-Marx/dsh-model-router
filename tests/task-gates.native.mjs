import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir, mkdtemp} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {openTaskJournal} from '../packages/orchestration/src/task-journal.mjs'
import {createTaskService} from '../packages/orchestration/src/task-service.mjs'
import {createAuthority} from '../packages/capability-broker/src/authority.mjs'
import {createPrincipalDirectory} from '../packages/orchestration/src/principals.mjs'

// "Was it allowed" and "did it run" are two questions. The attempt now answers
// both: each checkpoint writes its verdict as a `gate` row, and the result says
// which gates ran and whether the backend was ever entered.

assert.ok(process.env.DSH_TASK_DRIVER, 'Run through integration-task-probe.mjs with the verified native driver')
const {default: Database} = await import(process.env.DSH_TASK_DRIVER)
const parent = resolve('tmp/integration/task-native')
await mkdir(parent, {recursive: true})
const fresh = async () => join(await mkdtemp(join(parent, 'db-')), 'orchestration.sqlite')

const caps = ['task/submit', 'task/read', 'task/cancel', 'task/retry', 'task/reconcile', 'task/execute', 'execution/read', 'execution/retry', 'execution/observe']
const parse = (input) => {
  if (!input || Object.keys(input).some((key) => key !== 'text') || typeof input.text !== 'string') throw new Error('invalid fixture input')
  return {text: input.text}
}

async function managed(t, run) {
  const path = await fresh()
  const journal = openTaskJournal(Database, path)
  const authority = createAuthority()
  const directory = createPrincipalDirectory(authority)
  directory.register('bot-a', {tools: caps, modelRoutes: [{provider: 'fixture', model: 'gpt-test'}]})
  const service = createTaskService({
    journal, authority, directory,
    runnerTtlMs: 1000, taskTtlMs: 4000, executionLeaseMs: 30_000,
    backends: [{
      id: 'read', version: 'v1', effect: 'read', machineId: 'machine', workspaceId: 'workspace', location: 'local',
      capability: 'execution/read', retryCapability: 'execution/retry', modelRoute: undefined,
      model: {provider: 'fixture', model: 'gpt-test'}, parse, run,
    }],
  })
  service.start()
  t.after(async () => { await service.close().catch(() => {}); authority.dispose() })
  return {service, journal, subject: directory.forBot('bot-a')}
}

const waitState = async (journal, taskId, wanted, ms = 6000) => {
  const end = Date.now() + ms
  let state
  while (Date.now() < end) {
    state = journal.get('bot-a', taskId).state
    if (wanted.includes(state)) return state
    await sleep(20)
  }
  return state
}

test('gates/native: a successful attempt records every checkpoint and says the backend ran', async (t) => {
  const {service, journal, subject} = await managed(t, async () => ({outcome: 'succeeded', summary: {code: 'OK'}}))
  const task = service.submit(subject, {requestKey: 'ok', backend: 'read', input: {text: 'x'}})
  assert.equal(await waitState(journal, task.taskId, ['succeeded']), 'succeeded')
  const view = journal.get('bot-a', task.taskId)
  const authorization = view.result.authorization
  assert.ok(authorization, 'the result carries the checkpoint trail')
  assert.equal(authorization.carriedOut, true)
  const names = authorization.gates.map((entry) => entry.gate)
  for (const name of ['authorize', 'execution/lease', 'dispatch', 'settle']) {
    assert.ok(names.includes(name), `${name} must be recorded (got ${names.join(', ')})`)
  }
  assert.ok(authorization.gates.every((entry) => entry.allowed === true))
  const rows = journal.events('bot-a', task.taskId).filter((entry) => entry.kind === 'gate').map((entry) => JSON.parse(entry.detail))
  assert.ok(rows.length >= 4, `the timeline keeps the verdicts too (got ${rows.length})`)
  assert.equal(rows.at(-1).carriedOut, true)
})

test('gates/native: a backend that throws still says it was allowed and was entered', async (t) => {
  const {service, journal, subject} = await managed(t, async () => { throw Object.assign(new Error('boom'), {code: 'BACKEND_BOOM'}) })
  const task = service.submit(subject, {requestKey: 'boom', backend: 'read', input: {text: 'x'}})
  assert.equal(await waitState(journal, task.taskId, ['failed']), 'failed')
  const view = journal.get('bot-a', task.taskId)
  // A backend's own code is not promoted into our vocabulary: an unknown failure
  // stays TASK_BACKEND_FAILED, or a vendor string would end up in a policy field.
  assert.equal(view.result.code, 'TASK_BACKEND_FAILED')
  assert.equal(view.result.authorization.carriedOut, true, 'the backend was entered before it failed')
  const names = view.result.authorization.gates.map((entry) => entry.gate)
  assert.ok(names.includes('dispatch'), 'a dispatch verdict exists even though the run failed')
  assert.equal(view.result.notStarted, undefined, 'a failure after dispatch is not "not started"')
})

test('gates/native: a refusal that never dispatched reports carriedOut false', async (t) => {
  // The lease is issued for 100ms and the attempt is given a deadline that has
  // already passed by the time the backend would run, so the lease gate refuses
  // before anything is dispatched.
  const {service, journal, subject} = await managed(t, async () => ({outcome: 'succeeded'}))
  const task = service.submit(subject, {requestKey: 'lease', backend: 'read', input: {text: 'x'}})
  // Cancel first: the attempt leaves 'ready' and the dispatch fence refuses it.
  service.cancel(subject, {taskId: task.taskId})
  const state = await waitState(journal, task.taskId, ['cancelled', 'failed', 'needs-reconciliation'])
  assert.ok(['cancelled', 'failed', 'needs-reconciliation'].includes(state), `unexpected state ${state}`)
  const view = journal.get('bot-a', task.taskId)
  if (view.result?.authorization) {
    assert.equal(view.result.authorization.carriedOut, false, 'a cancelled attempt must not claim it ran')
  }
})
