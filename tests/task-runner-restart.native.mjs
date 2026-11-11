import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir, mkdtemp} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {openTaskJournal} from '../packages/orchestration/src/task-journal.mjs'
import {createTaskService} from '../packages/orchestration/src/task-service.mjs'
import {createAuthority} from '../packages/capability-broker/src/authority.mjs'
import {createPrincipalDirectory} from '../packages/orchestration/src/principals.mjs'

// A runner that stops silently is the worst state the task service can reach:
// the Host keeps accepting work nobody will claim, with no error and no log.
// These tests pin both halves of the fix — the stop is attributable, and a
// stopped runner is rebuilt instead of staying dead until the app restarts.

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
const readBackend = {
  id: 'read', version: 'v1', effect: 'read', machineId: 'machine', workspaceId: 'workspace', location: 'local',
  capability: 'execution/read', retryCapability: 'execution/retry', model: {provider: 'fixture', model: 'gpt-test'},
  parse, run: async () => ({outcome: 'succeeded', summary: {code: 'OK'}}),
}

async function managed(t, options = {}) {
  // A real failure has to survive the assertion that it happened at all.
  const path = await fresh()
  const journal = openTaskJournal(Database, path, {leaseClock: options.leaseClock ?? 'app', writeDeadlineMs: options.writeDeadlineMs ?? 10_000})
  const authority = createAuthority()
  const directory = createPrincipalDirectory(authority)
  const grant = options.grants ?? {tools: caps, modelRoutes: [{provider: 'fixture', model: 'gpt-test'}]}
  for (const id of ['bot-a', 'bot-b']) directory.register(id, grant)
  const service = createTaskService({
    journal, authority, directory,
    runnerTtlMs: options.runnerTtlMs ?? 1000, taskTtlMs: 4000, executionLeaseMs: 30_000,
    backends: options.backends ?? [readBackend],
    ...(options.requireStopProof ? {requireStopProof: true} : {}),
    ...(options.now ? {now: options.now} : {}),
  })
  t.after(async () => { await service.close().catch(() => {}); authority.dispose() })
  return {service, journal, authority, directory, path, a: directory.forBot('bot-a')}
}

const waitStopped = async (service, ms = 6000) => {
  const end = Date.now() + ms
  while (service.state().running && Date.now() < end) await sleep(20)
  return service.state()
}

test('runner/native: the runner reports itself running once it holds the lease', async (t) => {
  const {service} = await managed(t)
  service.start()
  const state = service.state()
  assert.equal(state.running, true)
  assert.equal(state.stopped, false)
  assert.ok(state.generation >= 1)
  assert.ok(state.events.some((entry) => entry.event === 'runner.started'))
})

test('runner/native: a lease that lapses under the runner stops it and names the reason', async (t) => {
  // A wall-clock jump, a suspended VM or an evicted heartbeat all look the same
  // from inside: the lease this runner wrote is no longer live.
  let clock = Date.now()
  const {service} = await managed(t, {now: () => clock, runnerTtlMs: 1000})
  service.start()
  clock += 5000
  const state = await waitStopped(service)
  assert.equal(state.running, false, 'a runner that cannot fence its lease must stop')
  assert.equal(state.stopReason, 'STALE_TASK_RUNNER')
  assert.ok(state.events.some((entry) => entry.event === 'runner.stopped' && entry.code === 'STALE_TASK_RUNNER'))
})

test('runner/native: restart() rebuilds a stopped runner and work is claimed again', async (t) => {
  let clock = Date.now()
  const {service, a} = await managed(t, {now: () => clock, runnerTtlMs: 1000})
  service.start()
  clock += 5000
  await waitStopped(service)

  const outcome = service.restart({reason: 'test-rebuild'})
  assert.equal(outcome.accepted, true)
  assert.equal(outcome.reason, 'test-rebuild')
  assert.ok(outcome.restarts >= 1)
  const state = service.state()
  assert.equal(state.running, true)
  assert.equal(state.stopReason, null, 'a rebuilt runner no longer reports the old reason')
  assert.ok(state.events.some((entry) => entry.event === 'runner.restarted' && entry.reason === 'test-rebuild'))

  const task = service.submit(a, { requestKey: 'after-restart', backend: 'read', input: { text: 'hi' } })
  assert.ok(task?.taskId)
})

test('runner/native: restart() reports a lease it cannot take instead of throwing', async (t) => {
  let clock = Date.now()
  const {service, journal} = await managed(t, {now: () => clock, runnerTtlMs: 1000})
  service.start()
  clock += 5000
  const stopped = await waitStopped(service)
  assert.equal(stopped.running, false)

  // Another host takes the window the rebuild would need.
  journal.claimRunner('blocking-host', 10_000, clock)
  let outcome
  assert.doesNotThrow(() => { outcome = service.restart({reason: 'blocked'}) })
  assert.equal(outcome.accepted, false)
  assert.equal(outcome.code, 'TASK_RUNNER_BUSY')
  assert.ok(outcome.retryAfterMs >= 250)
  assert.equal(service.state().running, false)
  assert.equal(service.state().stopReason, 'STALE_TASK_RUNNER', 'a failed rebuild keeps the reason it stopped for')
})

test('runner/native: while stopped, submissions are refused rather than queued forever', async (t) => {
  let clock = Date.now()
  const {service, journal, a} = await managed(t, {now: () => clock, runnerTtlMs: 1000})
  service.start()
  clock += 5000
  await waitStopped(service)
  assert.throws(() => service.submit(a, {requestKey: 'while-stopped', backend: 'read', input: {text: 'x'}}), /TASK_RUNNER_UNAVAILABLE/)
  journal.claimRunner('blocking-host', 10_000, clock)
  const rebuilt = service.restart({reason: 'manual'})
  assert.equal(rebuilt.accepted, false)
  assert.throws(() => service.submit(a, {requestKey: 'still-stopped', backend: 'read', input: {text: 'x'}}), /TASK_RUNNER_UNAVAILABLE/)
})

test('runner/native: an externally effecting backend must be taught to prove a stop', async (t) => {
  const base = {
    version: 'v1', machineId: 'm-local', workspaceId: 'w-local',
    capability: 'x/y', retryCapability: 'x/y', reconcileCapability: 'x/observe', parse,
    run: async () => ({outcome: 'succeeded'}),
    targetFor: () => ({machineId: 'm', workspaceId: 'w', remoteMachineRevision: 1, remoteBindingRevision: 1}),
    canObserve: () => true, reconcile: async () => ({outcome: 'unknown'}),
  }
  await assert.rejects(async () => managed(t, {
    requireStopProof: true,
    backends: [{...base, id: 'remote-new', effect: 'workspace-write', location: 'remote', writeContract: 'scoped-remote-file-v1'}],
  }), /STOP_PROOF_BACKEND_UNREGISTERED/)

  // The three writers that do prove a stop are still accepted, including the
  // container command that used to be missing from the list entirely.
  for (const [id, writeContract] of [['remote-write', 'scoped-remote-file-v1'], ['remote-command', 'scoped-remote-command-v1']]) {
    const made = await managed(t, {requireStopProof: true, backends: [{...base, id, effect: 'workspace-write', location: 'remote', writeContract}]})
    assert.ok(made.service)
  }
})

test('runner/native: the product opens the journal and the service on the ledger clock', async () => {
  const {readFile} = await import('node:fs/promises')
  const source = await readFile(new URL('../packages/orchestration/src/product-composition.mjs', import.meta.url), 'utf8')
  assert.match(source, /openTaskJournal\(\{leaseClock:'db'\}\)/, 'the product boot must open the journal on the ledger clock')
  assert.match(source, /leaseClock: 'db'/, 'and the service must be told the same thing')
  assert.match(source, /TASK_RUNNER_WATCHDOG_MS/, 'a stopped runner must be watched, not only logged')
  assert.match(source, /taskService\.restart\(/, 'the watchdog rebuilds instead of only reporting')
  assert.match(source, /requireStopProof: true/, 'the deployment refuses a writer that cannot prove a stop')
})

test('runner/native: a refusal names its gate, and a blocked task keeps that name', async (t) => {
  const {PolicyError} = await import('../packages/capability-broker/src/authority.mjs')
  // Backward compatible: a code-only refusal still works.
  assert.equal(new PolicyError('TOOL_DENIED').gate, undefined)
  const named = new PolicyError('TOOL_DENIED', {gate: 'backend/capability', rule: 'execution/read'})
  assert.equal(named.gate, 'backend/capability')
  assert.equal(named.rule, 'execution/read')

  const {journal} = await managed(t)
  const fence = journal.claimRunner('runner-a', 1000, 0)
  const task = journal.submit(fence, 'bot-a', 'denied', 'hash-denied',
    {backend: 'fixture', input: {text: 'x'}, target: {fixture: true}}, 5000, 1)
  journal.block(fence, 'bot-a', task.taskId, 'TOOL_DENIED', 2, {gate: 'backend/capability'})
  const record = journal.get('bot-a', task.taskId)
  assert.equal(record.state, 'blocked')
  const blocked = journal.events('bot-a', task.taskId).filter((entry) => entry.kind === 'blocked').at(-1)
  const facts = JSON.parse(blocked.detail)
  assert.equal(facts.code, 'TOOL_DENIED')
  assert.equal(facts.gate, 'backend/capability', 'the record names the checkpoint, not just the code')
  assert.equal(record.result.gate, 'backend/capability', 'the result keeps the gate too')
  assert.equal(record.result.notStarted, true, 'a refusal before dispatch says so')
})

test('runner/native: every admission check names its own gate', async () => {
  const {readFile} = await import('node:fs/promises')
  const source = await readFile(new URL('../packages/orchestration/src/task-service.mjs', import.meta.url), 'utf8')
  for (const name of ['task/execute', 'backend/capability', 'backend/retry-capability', 'backend/model-route', 'backend/input', 'execution/lease']) {
    assert.ok(source.includes(`gate('${name}'`), `${name} must name itself so a refusal is attributable`)
  }
  assert.match(source, /error\.gate=name/, 'the gate is attached where the check fails')
})
