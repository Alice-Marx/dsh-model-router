// Turn-fence tests for the ACP adapter: one slot per adapter, one settlement per
// turn, and an honest not-run/unknown split.
//
// These tests drive a controlled launcher seam: a fake native supervisor plus a
// scripted offline agent that speaks the ACP wire, so the *timing* of admission,
// launch, dispatch, settlement, cancel and stop is deterministic and provable
// with explicit Promise gates. The seam is not the real-machine evidence — the
// real offline Node child through the real native supervisor is proven in
// tests/bot-acp-session.native.mjs, which runs serially.
//
// No agent CLI, no network, no user profile, no credential, no desktop.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createAcpAdapter } from '../packages/bot-acp/src/acp-adapter.mjs'

const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url))
const REPO = resolve(TESTS_DIR, '..')
const FIXTURE = join(TESTS_DIR, 'fixtures', 'bot-acp-agent-fixture.mjs')
const RUNS = join(REPO, 'tmp', 'integration', 'bot-acp-turn-fence', `seam-${process.pid}`)
const MODEL = 'fixture-model-a'

const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const delay = ms => new Promise(resolve => { setTimeout(resolve, ms) })
/** Let queued microtasks and timers run: an explicit gate, never a fixed sleep. */
const tick = async (times = 4) => { for (let index = 0; index < times; index++) await delay(0) }
const until = async (probe, timeoutMs = 10_000) => {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const value = probe()
    if (value) return value
    await delay(10)
  }
  return probe()
}
const rejection = async promise => {
  try { await promise } catch (error) { return error }
  throw new Error('expected the call to reject')
}

let entryCache = null
const pinnedEntry = async () => {
  entryCache ??= {
    executable: process.execPath, sha256: await sha256(process.execPath), version: process.versions.node,
    script: FIXTURE, scriptSha256: await sha256(FIXTURE),
  }
  return entryCache
}

const textOf = prompt => {
  const block = Array.isArray(prompt) ? prompt.find(entry => entry?.type === 'text') : null
  return typeof block?.text === 'string' ? block.text : ''
}

// ---- the scripted offline agent ------------------------------------------------
/**
 * @param {object} scenario
 * @param {number} [scenario.initializeDelayMs] slow handshake (a stop can land mid-launch)
 * @param {number} [scenario.promptDelayMs] slow answer
 * @param {boolean} [scenario.promptHangs] never answer the prompt
 * @param {boolean} [scenario.promptFails] answer the prompt with a wire error
 * @param {boolean} [scenario.promptWriteFails] refuse the prompt write
 * @param {number} [scenario.lateResponseMs] later, answer an already-settled id
 * @param {boolean} [scenario.sessionNewFails] refuse session/new
 */
const createFakeAgent = (scenario = {}) => {
  const state = { requests: [], prompts: [], sessions: [], cancels: 0 }
  const supervisors = []
  let supervisor = null
  let openPrompt = null
  const pendingAsks = new Map()
  let askSeq = 0
  const emit = value => supervisor?.events.emit('message', value)
  const reply = (id, result) => emit({ jsonrpc: '2.0', id, result })
  const fail = (id, code, message) => emit({ jsonrpc: '2.0', id, error: { code, message } })
  const notify = (method, params) => emit({ jsonrpc: '2.0', method, params })
  const chunk = (sessionId, text) => notify('session/update', { sessionId, update: { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text } } })
  /** Send one server-to-client request and wait for the client's answer. */
  const ask = (method, params) => new Promise(resolve => {
    const id = 900000 + ++askSeq
    pendingAsks.set(id, resolve)
    emit({ jsonrpc: '2.0', id, method, params })
  })
  const sessionNewResult = () => ({
    sessionId: `sess-${state.sessions.length}`,
    models: { availableModels: [{ modelId: MODEL, name: 'Model A' }, { modelId: 'fixture-model-b', name: 'Model B' }], currentModelId: MODEL },
    modes: [{ id: 'default' }, { id: 'auto-edit' }],
  })
  return {
    state, supervisors,
    get supervisor() { return supervisor },
    bind: value => { supervisor = value; supervisors.push(value) },
    receive: async value => {
      if (value.method === undefined && value.id !== undefined) {
        // A response to an ask this agent sent.
        const resolveAsk = pendingAsks.get(value.id)
        if (resolveAsk) { pendingAsks.delete(value.id); resolveAsk(value) }
        return
      }
      state.requests.push({ method: value.method, params: value.params })
      switch (value.method) {
        case 'initialize': {
          if (scenario.initializeDelayMs) await delay(scenario.initializeDelayMs)
          reply(value.id, {
            protocolVersion: 1, authMethods: [], agentInfo: { name: 'fake-acp-agent', version: '9.9' },
            agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} } },
          })
          return
        }
        case 'authenticate': reply(value.id, {}); return
        case 'session/new': {
          state.sessions.push({ kind: 'new' })
          if (scenario.sessionNewFails) { fail(value.id, -32602, 'session/new refused'); return }
          reply(value.id, sessionNewResult())
          return
        }
        case 'session/prompt': {
          const params = value.params ?? {}
          state.prompts.push({ id: value.id, sessionId: params.sessionId, text: textOf(params.prompt) })
          if (scenario.promptWriteFails) throw new Error('AGENT_WRITE_REFUSED')
          openPrompt = { id: value.id, sessionId: params.sessionId }
          if (scenario.permissionAsk) {
            // Ask for permission and hold the turn open until the Host answers.
            await ask('session/request_permission', {
              sessionId: params.sessionId,
              toolCall: { toolCallId: 'tool-1', title: 'run a command', kind: 'execute', rawInput: { command: 'echo hi' }, status: 'pending' },
              options: [
                { optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' },
                { optionId: 'reject-once', kind: 'reject_once', name: 'Reject once' },
              ],
            })
          }
          if (scenario.promptDelayMs) await delay(scenario.promptDelayMs)
          if (scenario.promptHangs) return
          if (scenario.promptFails) { fail(value.id, -32603, 'prompt refused'); return }
          chunk(params.sessionId, 'fixture reply. ')
          reply(value.id, { stopReason: 'end_turn' })
          if (scenario.lateResponseMs) {
            const settled = value.id
            setTimeout(() => {
              // A late answer for an id this side already settled, plus traffic
              // naming a session that no longer exists.
              emit({ jsonrpc: '2.0', id: settled, result: { stopReason: 'end_turn', usage: { inputTokens: 99, outputTokens: 99 } } })
              chunk('stale-session', 'late injected text. ')
            }, scenario.lateResponseMs)
          }
          return
        }
        case 'session/cancel': {
          state.cancels++
          if (openPrompt) {
            const settled = openPrompt
            openPrompt = null
            reply(settled.id, { stopReason: 'cancelled' })
          }
          return
        }
        case 'session/set_model':
        case 'session/set_config_option': reply(value.id, { models: { availableModels: [{ modelId: MODEL }], currentModelId: value.params?.modelId ?? value.params?.value } }); return
        case 'session/set_mode': reply(value.id, {}); return
        case 'session/close': reply(value.id, {}); return
        default: fail(value.id, -32601, 'method not found')
      }
    },
  }
}

// ---- the fake native supervisor ------------------------------------------------
/**
 * @param {object} options
 * @param {'ok'|'fail'|'delay'} [options.spawn] spawn posture
 * @param {boolean} [options.stopControl] emit a `stopped` control at all
 * @param {boolean} [options.treeStopped] what the fake job object reports
 */
const createFakeSupervisor = (agent, { spawn = 'ok', stopControl = true, treeStopped = true, pid = 4242 } = {}) => {
  const events = new EventEmitter()
  let closed = false
  let exitResolve
  const exit = new Promise(resolve => { exitResolve = resolve })
  const stoppedControl = (reason) => ({ control: 'stopped', exitCode: 0, reason, treeStopped, pid, containment: 'fake-job' })
  const finish = reason => {
    if (closed) return
    closed = true
    if (stopControl) events.emit('control', stoppedControl(reason))
    events.emit('closed', { code: 0, signal: null })
    exitResolve({ code: 0, signal: null })
  }
  const supervisor = {
    events, exit, sent: [], ended: false, killed: false,
    waitControl: (name, timeoutMs = 15_000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error(`FAKE_${String(name).toUpperCase()}_TIMEOUT`)) }, timeoutMs)
      const cleanup = () => { clearTimeout(timer); events.off('control', onControl); events.off('closed', onClosed); events.off('failure', onFailure) }
      const onControl = value => { if (value.control === name) { cleanup(); resolve(value) } }
      const onClosed = () => { cleanup(); reject(new Error(`FAKE_${String(name).toUpperCase()}_FAILED`)) }
      const onFailure = error => { cleanup(); reject(error) }
      events.on('control', onControl); events.once('closed', onClosed); events.once('failure', onFailure)
    }),
    send: async value => {
      if (closed) throw new Error('FAKE_SUPERVISOR_CLOSED')
      supervisor.sent.push(value)
      await agent.receive(value)
    },
    end: () => { if (supervisor.ended || closed) return; supervisor.ended = true; finish('ended') },
    child: { kill: () => { if (supervisor.killed || closed) return; supervisor.killed = true; finish('killed') } },
  }
  if (spawn === 'fail') queueMicrotask(() => events.emit('failure', new Error('FAKE_SPAWN_FAILED')))
  else if (spawn === 'delay') supervisor.releaseSpawn = () => events.emit('control', { control: 'spawned', pid })
  else queueMicrotask(() => events.emit('control', { control: 'spawned', pid }))
  return supervisor
}

const createFakeLauncher = (agent, options) => ({
  probe: async () => ({ available: options.probeAvailable !== false, reason: options.probeAvailable === false ? 'no-helper' : null, helper: 'fake-helper', supervisor: 'fake-supervisor' }),
  protect: async () => {},
  supervise: () => {
    const supervisor = createFakeSupervisor(agent, options)
    agent.bind(supervisor)
    return supervisor
  },
})

// ---- adapter under test --------------------------------------------------------
let runCounter = 0
const makeAdapter = async (name, { engine = {}, scenario = {}, supervisor: supervisorOptions = {}, hooks = {} } = {}) => {
  const id = `f${++runCounter}-${name}`
  const runDir = join(RUNS, id)
  const workspace = join(runDir, 'ws')
  await mkdir(workspace, { recursive: true })
  const authority = createAuthority()
  const subject = {}
  authority.register(subject, { botId: `bot-${id}`, tools: ['read_notes'], modelRoutes: [{ provider: 'fixture', model: MODEL }] })
  const agent = createFakeAgent(scenario)
  const settlements = []
  const launcher = createFakeLauncher(agent, supervisorOptions)
  const allHooks = {
    onBeforeRequest: async evidence => hooks.onBeforeRequest ? hooks.onBeforeRequest(evidence) : undefined,
    onObserve: async evidence => hooks.onObserve ? hooks.onObserve(evidence) : undefined,
    onSettle: async evidence => { settlements.push(evidence); return hooks.onSettle ? hooks.onSettle(evidence) : undefined },
    onClose: async evidence => hooks.onClose ? hooks.onClose(evidence) : undefined,
  }
  const adapter = await createAcpAdapter({
    authority, subject,
    binding: { taskId: `task-${id}`, attemptId: `att-${id}`, machineId: 'mach-local', workspaceId: `wsid-${id}`, location: 'local' },
    operationId: `op-${id}`,
    entry: await pinnedEntry(),
    spawnArgs: ['--fixture-mode=default'],
    runtimeRoot: join(runDir, 'runtime'),
    workspace,
    model: { catalogProvider: 'fixture', catalogModel: MODEL },
    billing: 'subscription',
    deadlineMs: 30_000,
    launcher,
    hooks: allHooks,
    ...engine,
  })
  return { adapter, agent, authority, subject, settlements, workspace }
}

/** Stop an adapter and wait for its terminal state; never leave a turn behind. */
const shutdown = async adapter => {
  if (adapter.closed) return adapter.snapshot().stopEvidence ?? null
  return adapter.stop('test-done')
}

/** Wait until the prompt has really been issued: the slot alone is not dispatch. */
const untilDispatched = async adapter => {
  await until(() => adapter.snapshot().turn?.dispatched === true)
  return adapter.snapshot().turn
}

describe('one turn slot per adapter', () => {
  test('a same-tick second submit is refused with zero extra admission, launch or prompt', async () => {
    let release
    const { adapter, agent, settlements } = await makeAdapter('same-tick', {
      hooks: { onBeforeRequest: () => new Promise(resolve => { release = resolve }) },
    })
    await adapter.start()
    const sessionsBefore = agent.state.sessions.length
    // Both calls are made in the same tick, with no await between them, while
    // the first is still waiting for Host admission.
    const first = adapter.submitTurn({ text: 'one' })
    const second = adapter.submitTurn({ text: 'two' })
    assert.equal(agent.state.prompts.length, 0)
    assert.equal(adapter.busy, true)
    const secondError = await rejection(second)
    assert.match(secondError.message, /ACP_TURN_IN_PROGRESS/)
    // Zero extra admission, launch or prompt for the refused call.
    assert.equal(agent.state.prompts.length, 0)
    assert.equal(agent.state.sessions.length, sessionsBefore)
    assert.equal(settlements.length, 0)
    release()
    const turn = await first
    assert.equal(turn.ok, true)
    assert.equal(agent.state.prompts.length, 1)
    assert.equal(agent.state.sessions.length, sessionsBefore)
    assert.equal(settlements.length, 1)
    assert.equal(adapter.snapshot().turnsAdmitted, 1)
    assert.equal(adapter.snapshot().turnsDispatched, 1)
    assert.equal(adapter.snapshot().launches, 1)
    await shutdown(adapter)
  }, 30_000)

  test('a slow admission keeps the slot observably pending and dispatches exactly once', async () => {
    let release
    const { adapter, agent, settlements } = await makeAdapter('slow-admission', {
      hooks: { onBeforeRequest: () => new Promise(resolve => { release = resolve }) },
    })
    await adapter.start()
    const first = adapter.submitTurn({ text: 'one' })
    await tick()
    // The slot is held before the first await, so the turn is pending even
    // though nothing has been admitted yet.
    assert.equal(adapter.busy, true)
    assert.equal(adapter.snapshot().turn.dispatched, false)
    const second = await rejection(adapter.submitTurn({ text: 'two' }))
    assert.match(second.message, /ACP_TURN_IN_PROGRESS/)
    assert.equal(agent.state.prompts.length, 0)
    assert.equal(settlements.length, 0)
    release()
    const turn = await first
    assert.equal(turn.ok, true)
    assert.equal(agent.state.prompts.length, 1)
    assert.equal(settlements.length, 1)
    assert.equal(adapter.snapshot().turnsDispatched, 1)
    await shutdown(adapter)
  }, 30_000)

  test('a refused admission releases the slot, records no settlement, and is safely re-callable', async () => {
    let refuse = true
    const { adapter, agent, settlements } = await makeAdapter('refused-admission', {
      hooks: { onBeforeRequest: async () => { if (refuse) throw new Error('FUNDING_REFUSED') } },
    })
    await adapter.start()
    const refused = await rejection(adapter.submitTurn({ text: 'one' }))
    assert.match(refused.message, /FUNDING_REFUSED/)
    // Nothing was dispatched, so there is no settlement to record: the Host
    // already knows it refused its own request.
    assert.equal(settlements.length, 0)
    assert.equal(agent.state.prompts.length, 0)
    assert.equal(adapter.busy, false)
    // The slot is free: the same call can be made again once the Host agrees.
    refuse = false
    const turn = await adapter.submitTurn({ text: 'one' })
    assert.equal(turn.ok, true)
    assert.equal(agent.state.prompts.length, 1)
    assert.equal(settlements.length, 1)
    await shutdown(adapter)
  }, 30_000)
})

describe('settlement is durable before it is public', () => {
  test('a slow settlement hook keeps the turn pending until it has recorded', async () => {
    let release
    const entered = []
    const order = []
    const { adapter, settlements } = await makeAdapter('slow-settle', {
      hooks: {
        onSettle: async evidence => {
          entered.push(evidence)
          order.push('settle-start')
          await new Promise(resolve => { release = resolve })
          order.push('settle-end')
        },
      },
    })
    await adapter.start()
    const pending = adapter.submitTurn({ text: 'one' })
    adapter.events.on('turn', () => order.push('turn-event'))
    await until(() => entered.length === 1)
    // The peer already answered, the Host hook has not: the turn is pending.
    assert.equal(adapter.busy, true)
    assert.equal(adapter.snapshot().settlement.inFlight, 1)
    release()
    const turn = await pending
    assert.equal(turn.ok, true)
    assert.equal(adapter.busy, false)
    assert.equal(settlements.length, 1)
    // The public answer only exists after the durable record.
    assert.deepEqual(order, ['settle-start', 'settle-end', 'turn-event'])
    await shutdown(adapter)
  }, 30_000)

  test('a refused settlement hook refuses the success with the original native result', async () => {
    const { adapter, settlements } = await makeAdapter('refused-settle', {
      hooks: { onSettle: async () => { throw new Error('LEDGER_WRITE_FAILED') } },
    })
    await adapter.start()
    const failure = await rejection(adapter.submitTurn({ text: 'one' }))
    assert.match(failure.message, /ACP_SETTLEMENT_FAILED: LEDGER_WRITE_FAILED/)
    // The original native result travels with the refusal, unaltered.
    assert.equal(failure.evidence.ok, true)
    assert.equal(failure.evidence.outcome, 'succeeded')
    assert.equal(failure.evidence.stopReason, 'end_turn')
    assert.equal(failure.evidence.dispatched, true)
    // No money and no usage were invented to paper over the failure.
    assert.equal(failure.evidence.costUsd, null)
    assert.equal(failure.evidence.costStatus, 'unknown')
    assert.equal(failure.evidence.usageStatus, 'unknown')
    assert.equal(failure.evidence.usage.reported, false)
    assert.equal(failure.evidence.usage.inputTokens, null)
    assert.equal(failure.evidence.usage.outputTokens, null)
    // One settlement, one turn: the adapter retires instead of opening a new
    // request on a turn the ledger never recorded.
    assert.equal(settlements.length, 1)
    assert.equal(adapter.snapshot().turnsSettled, 1)
    assert.equal(adapter.busy, false)
    const stop = await until(() => (adapter.closed ? adapter.snapshot().stopEvidence ?? null : null), 15_000)
    assert.ok(stop)
    assert.equal(stop.treeStopped, true)
    assert.equal(stop.reason, 'settle-hook-failed')
    assert.deepEqual(stop.turns, { admitted: 1, dispatched: 1, settled: 1 })
    const after = await rejection(adapter.submitTurn({ text: 'never runs' }))
    assert.match(after.message, /ACP_STOPPED/)
  }, 30_000)

  test('a stop waits for the slow settlement and really stops the tree first', async () => {
    const order = []
    const { adapter, agent } = await makeAdapter('stop-waits-for-settle', {
      scenario: { promptHangs: true },
      hooks: {
        onSettle: async () => { order.push('settle-start'); await delay(40); order.push('settle-end') },
        onClose: async () => order.push('close'),
      },
    })
    await adapter.start()
    const pending = adapter.submitTurn({ text: 'one' }).catch(() => {})
    await untilDispatched(adapter)
    // The tree end is observed before the stop is requested, so the recorded
    // order proves what really happened first.
    const supervisor = agent.supervisor
    const originalEnd = supervisor.end.bind(supervisor)
    supervisor.end = () => { order.push('tree-end'); originalEnd() }
    const stop = await adapter.stop('host-stop')
    supervisor.end = originalEnd
    await pending
    assert.equal(stop.treeStopped, true)
    // The native tree is really stopped before the slow settlement hook is
    // waited on, and the close evidence is only reported afterwards.
    assert.deepEqual(order, ['tree-end', 'settle-start', 'settle-end', 'close'])
    await shutdown(adapter)
  }, 30_000)
})

describe('one terminal settlement per turn', () => {
  test('a refused pin never creates an adapter and never spawns a process', async () => {
    const agent = createFakeAgent({})
    const workspace = join(RUNS, 'pin-refused-ws')
    await mkdir(workspace, { recursive: true })
    const authority = createAuthority()
    const subject = {}
    authority.register(subject, { botId: 'bot-pin', tools: [], modelRoutes: [{ provider: 'fixture', model: MODEL }] })
    const entry = { ...(await pinnedEntry()), sha256: '0'.repeat(64) }
    await assert.rejects(() => createAcpAdapter({
      authority, subject,
      binding: { taskId: 't', attemptId: 'a', machineId: 'm', workspaceId: 'w', location: 'local' },
      operationId: 'op-pin-refused',
      entry,
      runtimeRoot: join(RUNS, 'pin-refused-runtime'),
      workspace,
      model: { catalogProvider: 'fixture', catalogModel: MODEL },
      launcher: createFakeLauncher(agent, {}),
    }), /ACP_ENTRY_CHANGED/)
    assert.equal(agent.supervisors.length, 0)
    assert.equal(agent.state.prompts.length, 0)
  }, 30_000)

  test('an unavailable native peer never creates an adapter', async () => {
    const agent = createFakeAgent({})
    const workspace = join(RUNS, 'peer-unavailable-ws')
    await mkdir(workspace, { recursive: true })
    const authority = createAuthority()
    const subject = {}
    authority.register(subject, { botId: 'bot-peer', tools: [], modelRoutes: [{ provider: 'fixture', model: MODEL }] })
    await assert.rejects(async () => createAcpAdapter({
      authority, subject,
      binding: { taskId: 't', attemptId: 'a', machineId: 'm', workspaceId: 'w', location: 'local' },
      operationId: 'op-peer-unavailable',
      entry: await pinnedEntry(),
      runtimeRoot: join(RUNS, 'peer-unavailable-runtime'),
      workspace,
      model: { catalogProvider: 'fixture', catalogModel: MODEL },
      launcher: createFakeLauncher(agent, { probeAvailable: false }),
    }), /NATIVE_PEER_UNAVAILABLE/)
    assert.equal(agent.supervisors.length, 0)
  }, 30_000)

  test('a failed launch settles the turn as not-run and sends no prompt', async () => {
    const { adapter, agent, settlements } = await makeAdapter('launch-fail', { supervisor: { spawn: 'fail' } })
    const failure = await rejection(adapter.submitTurn({ text: 'one' }))
    assert.match(failure.message, /FAKE_SPAWN_FAILED/)
    assert.equal(agent.state.prompts.length, 0)
    assert.equal(agent.state.sessions.length, 0)
    assert.equal(settlements.length, 1)
    assert.equal(settlements[0].ok, false)
    assert.equal(settlements[0].outcome, 'not-run')
    assert.equal(settlements[0].stopReason, 'not-dispatched')
    assert.equal(settlements[0].dispatched, false)
    assert.equal(settlements[0].costUsd, null)
    assert.equal(settlements[0].costStatus, 'unknown')
    assert.equal(adapter.snapshot().launches, 0)
    assert.equal(adapter.snapshot().turnsDispatched, 0)
    await shutdown(adapter)
  }, 30_000)

  test('a refused session/new settles the turn as not-run and opens no session', async () => {
    const { adapter, agent, settlements } = await makeAdapter('session-new-fail', { scenario: { sessionNewFails: true } })
    const failure = await rejection(adapter.submitTurn({ text: 'one' }))
    assert.match(failure.message, /session\/new refused/)
    assert.equal(agent.state.prompts.length, 0)
    assert.equal(agent.state.sessions.length, 1)
    assert.equal(settlements.length, 1)
    assert.equal(settlements[0].outcome, 'not-run')
    assert.equal(settlements[0].dispatched, false)
    assert.equal(adapter.snapshot().turnsDispatched, 0)
    await shutdown(adapter)
  }, 30_000)

  test('a turn refused before dispatch settles as not-run, never as a completion', async () => {
    const { adapter, agent, settlements } = await makeAdapter('turn-limit', { engine: { limits: { maxTurns: 0 } } })
    await adapter.start()
    const failure = await rejection(adapter.submitTurn({ text: 'one' }))
    assert.match(failure.message, /ACP_SESSION_TURN_LIMIT/)
    assert.equal(agent.state.prompts.length, 0)
    assert.equal(settlements.length, 1)
    assert.equal(settlements[0].outcome, 'not-run')
    assert.equal(settlements[0].stopReason, 'not-dispatched')
    // A dispatch count that counts completions would have claimed one here.
    assert.equal(adapter.snapshot().turnsDispatched, 0)
    assert.equal(adapter.snapshot().turnsSettled, 1)
    await shutdown(adapter)
  }, 30_000)

  test('a write that fails after dispatch is unknown, never not-run and never replayed', async () => {
    const { adapter, agent, settlements } = await makeAdapter('write-fail', { scenario: { promptWriteFails: true } })
    const turn = await adapter.submitTurn({ text: 'one' })
    // The prompt was issued: whether the peer received it is unknown, so the
    // outcome says unknown and nothing is retried automatically.
    assert.equal(turn.ok, false)
    assert.equal(turn.outcome, 'unknown')
    assert.equal(turn.stopReason, 'dispatch-unknown')
    assert.equal(turn.dispatched, true)
    assert.match(turn.errorText, /AGENT_WRITE_REFUSED/)
    assert.equal(turn.costUsd, null)
    assert.equal(turn.costStatus, 'unknown')
    assert.equal(settlements.length, 1)
    assert.equal(settlements[0].outcome, 'unknown')
    // No second attempt is made on the caller's behalf.
    assert.equal(agent.state.prompts.length, 1)
    assert.equal(adapter.snapshot().turnsDispatched, 1)
    assert.equal(adapter.snapshot().turnsSettled, 1)
    await shutdown(adapter)
  }, 30_000)

  test('a peer exit after dispatch is unknown, and the late process retires quietly', async () => {
    const { adapter, agent, settlements } = await makeAdapter('peer-exit', { scenario: { promptHangs: true } })
    const pending = adapter.submitTurn({ text: 'one' })
    // The peer dies without answering: the request may have been acted on.
    await untilDispatched(adapter)
    agent.supervisor.events.emit('closed', { code: 3, signal: null })
    const turn = await pending
    assert.equal(turn.ok, false)
    assert.equal(turn.outcome, 'unknown')
    assert.equal(turn.stopReason, 'exit-before-result')
    assert.equal(settlements.length, 1)
    await shutdown(adapter)
  }, 30_000)
})

describe('generations: late and retired traffic', () => {
  test('a late response for a settled id is counted and never settles twice', async () => {
    const { adapter, agent, settlements } = await makeAdapter('late-response', { scenario: { lateResponseMs: 60 } })
    await adapter.start()
    const first = await adapter.submitTurn({ text: 'one' })
    assert.equal(first.ok, true)
    // The late answer for an id this side already settled is counted, not replayed.
    await until(() => adapter.snapshot().transport.rpc.duplicateResponses >= 1)
    const rpc = adapter.snapshot().transport.rpc
    assert.equal(rpc.lateResponses >= 1, true)
    // The injected late text belongs to no live turn.
    await delay(120)
    const second = await adapter.submitTurn({ text: 'two' })
    assert.equal(second.ok, true)
    assert.equal(second.text, 'fixture reply. ')
    assert.equal(second.usage.reported, false)
    assert.equal(settlements.length, 2)
    assert.equal(adapter.snapshot().turnsSettled, 2)
    await shutdown(adapter)
  }, 30_000)

  test('a retired process never settles the turn that replaced it', async () => {
    const { adapter, agent, settlements } = await makeAdapter('old-generation', { scenario: { promptHangs: true } })
    await adapter.start()
    const first = adapter.submitTurn({ text: 'one' })
    await until(() => adapter.busy)
    // Retire generation 1 without a turn running: the adapter relaunches on the
    // next turn, exactly as it does after a real peer exit.
    const retired = agent.supervisors[0]
    retired.events.emit('closed', { code: 0, signal: null })
    await until(() => adapter.snapshot().session?.closed === true)
    assert.equal((await first).stopReason, 'exit-before-result')
    assert.equal(settlements.length, 1)

    const second = adapter.submitTurn({ text: 'two' })
    await until(() => agent.state.prompts.length === 2)
    assert.equal(adapter.snapshot().generation, 2)
    // A late control frame from the retired process must not answer the new turn.
    retired.events.emit('control', { control: 'stopped', exitCode: 0, reason: 'late-stop', treeStopped: true, pid: 1, containment: 'fake-job' })
    await tick()
    assert.equal(adapter.busy, true)
    assert.equal(settlements.length, 1)
    // The live process ends the turn for real.
    agent.supervisors[1].child.kill()
    const turn = await second
    assert.equal(turn.ok, false)
    assert.equal(turn.stopReason, 'exit-before-result')
    assert.equal(settlements.length, 2)
    assert.equal(adapter.snapshot().turnsSettled, 2)
    await shutdown(adapter)
  }, 30_000)
})

describe('cancel and stop at every stage', () => {
  test('a cancel during a pending admission settles not-run and never dispatches', async () => {
    let release
    const { adapter, agent, settlements } = await makeAdapter('cancel-admission', {
      hooks: { onBeforeRequest: () => new Promise(resolve => { release = resolve }) },
    })
    await adapter.start()
    const first = adapter.submitTurn({ text: 'one' })
    await tick()
    assert.equal(adapter.cancel(), true)
    await tick()
    assert.equal(adapter.busy, false)
    assert.equal(settlements.length, 1)
    assert.equal(settlements[0].outcome, 'not-run')
    assert.equal(settlements[0].stopReason, 'cancelled-before-dispatch')
    assert.equal(settlements[0].dispatched, false)
    assert.ok(settlements[0].cancelRequestedAt !== null)
    // The admission that resolves afterwards must not dispatch a cancelled turn.
    release()
    const late = await rejection(first)
    assert.match(late.message, /ACP_TURN_NOT_DISPATCHED: the turn was settled as cancelled-before-dispatch/)
    assert.equal(agent.state.prompts.length, 0)
    assert.equal(settlements.length, 1)
    assert.equal(adapter.snapshot().turnsDispatched, 0)
    await shutdown(adapter)
  }, 30_000)

  test('a cancel after dispatch is a request, and the agent confirms it', async () => {
    const { adapter, agent, settlements } = await makeAdapter('cancel-dispatched', { scenario: { promptHangs: true } })
    await adapter.start()
    const pending = adapter.submitTurn({ text: 'one' })
    await untilDispatched(adapter)
    const observed = []
    adapter.events.on('cancel-requested', detail => observed.push(detail))
    assert.equal(adapter.cancel(), true)
    const turn = await pending
    assert.equal(turn.ok, true)
    assert.equal(turn.outcome, 'cancelled')
    assert.equal(turn.stopReason, 'cancelled')
    assert.equal(agent.state.cancels, 1)
    assert.equal(observed.length, 1)
    assert.equal(settlements.length, 1)
    await shutdown(adapter)
  }, 30_000)

  test('a stop during a pending launch leaves no late spawn and reports the real tree', async () => {
    const { adapter, agent, settlements } = await makeAdapter('stop-during-launch', { supervisor: { spawn: 'delay' } })
    const pending = rejection(adapter.submitTurn({ text: 'one' }))
    await until(() => agent.supervisor !== null)
    assert.equal(adapter.busy, true)
    const stopping = adapter.stop('stop-during-launch')
    // The spawn completes after the stop was requested.
    agent.supervisor.releaseSpawn()
    const failure = await pending
    assert.match(failure.message, /ACP_STOPPED/)
    const stop = await stopping
    assert.equal(stop.treeStopped, true)
    assert.equal(stop.status, 'confirmed')
    assert.equal(stop.reason, 'stop-during-launch')
    assert.equal(agent.state.prompts.length, 0)
    assert.equal(agent.state.sessions.length, 0)
    // The launch never became usable, so no launch is counted and the process it
    // did spawn is the one the stop evidence names.
    assert.equal(adapter.snapshot().launches, 0)
    assert.equal(stop.pid, 4242)
    assert.equal(settlements.length, 1)
    assert.equal(settlements[0].outcome, 'not-run')
    assert.equal(settlements[0].dispatched, false)
    assert.equal(agent.supervisor.ended, true)
  }, 30_000)

  test('a stop with no confirmed tree stop is reported unconfirmed, never as confirmed', async () => {
    const { adapter } = await makeAdapter('stop-unconfirmed', {
      scenario: { promptHangs: true },
      supervisor: { stopControl: false },
    })
    await adapter.start()
    const pending = adapter.submitTurn({ text: 'one' }).catch(() => {})
    await untilDispatched(adapter)
    const stop = await adapter.stop('host-stop')
    // Only the launcher's own accounting confirms a tree stop; ending a pipe is
    // not a confirmation, and neither is a cancel request.
    assert.equal(stop.treeStopped, false)
    assert.equal(stop.status, 'unconfirmed')
    assert.equal(stop.nativeStopReason, 'no-stopped-control')
    assert.equal(stop.stopRequestedIsNotConfirmation, true)
    await pending
    await shutdown(adapter)
  }, 30_000)

  test('a revoked grant during a pending admission settles and retires the adapter', async () => {
    let release
    const { adapter, authority, subject, agent, settlements } = await makeAdapter('revoke-admission', {
      hooks: { onBeforeRequest: () => new Promise(resolve => { release = resolve }) },
    })
    await adapter.start()
    const first = adapter.submitTurn({ text: 'one' })
    await tick()
    authority.revoke(subject)
    // The guard retires the adapter while the admission is still pending.
    await until(() => adapter.closed, 15_000)
    release()
    const refusal = await rejection(first)
    assert.match(refusal.message, /ACP_TURN_NOT_DISPATCHED: the turn was settled as grant-revoked/)
    // The grant was re-judged across the admission boundary, before anything was
    // dispatched: the turn is refused, not run.
    assert.equal(settlements.length, 1)
    assert.equal(settlements[0].outcome, 'unknown')
    assert.equal(settlements[0].stopReason, 'grant-revoked')
    assert.equal(settlements[0].dispatched, false)
    assert.equal(agent.state.prompts.length, 0)
    await shutdown(adapter)
  }, 30_000)

  test('a grant revoked while the turn runs settles it and retires the adapter', async () => {
    const { adapter, authority, subject, agent, settlements } = await makeAdapter('revoke-running', { scenario: { promptHangs: true } })
    await adapter.start()
    const pending = adapter.submitTurn({ text: 'one' })
    await untilDispatched(adapter)
    authority.revoke(subject)
    const turn = await pending
    assert.equal(turn.ok, false)
    assert.equal(turn.stopReason, 'grant-revoked')
    assert.equal(turn.dispatched, true)
    assert.equal(settlements.length, 1)
    const stop = await until(() => (adapter.closed ? adapter.snapshot().stopEvidence ?? null : null), 15_000)
    assert.ok(stop)
    assert.equal(stop.treeStopped, true)
    assert.equal(stop.reason, 'grant-revoked')
  }, 30_000)

  test('an expired permission ask denies by default', async () => {
    const { adapter } = await makeAdapter('permission-expiry', {
      scenario: { permissionAsk: true },
      engine: { limits: { permissionTimeoutMs: 1000 }, onPermissionRequest: () => new Promise(() => {}) },    })
    await adapter.start()
    const turn = await adapter.submitTurn({ text: 'one' })
    // The Host never answered: the ask expires and denies, and the agent is told
    // the ask was cancelled rather than left hanging.
    const permissions = adapter.snapshot().permissions
    assert.equal(permissions.asks, 1)
    assert.equal(permissions.timeouts, 1)
    assert.equal(permissions.allowed, 0)
    assert.equal(permissions.denied >= 1, true)
    assert.equal(turn.text, 'fixture reply. ')
    await shutdown(adapter)
  }, 30_000)
})

describe('session and model identity fences', () => {
  test('no session or model call may run while a turn is pending', async () => {
    const { adapter, agent } = await makeAdapter('identity-fence', { scenario: { promptHangs: true } })
    await adapter.start()
    const pending = adapter.submitTurn({ text: 'one' })
    await untilDispatched(adapter)
    for (const [label, call] of [
      ['start', () => adapter.start()],
      ['startFresh', () => adapter.startFresh()],
      ['selectModel', () => adapter.selectModel(MODEL)],
      ['setMode', () => adapter.setMode('auto-edit')],
    ]) {
      const error = await rejection(call())
      assert.match(error.message, /ACP_TURN_IN_PROGRESS/, label)
      assert.match(error.message, new RegExp(label), label)
    }
    // Nothing was sent to the agent on the session's behalf.
    assert.equal(agent.state.sessions.length, 1)
    assert.equal(agent.state.prompts.length, 1)
    await shutdown(adapter)
    await pending.catch(() => {})
  }, 30_000)

  test('a model the Host did not commit is refused, and the committed one is re-asserted', async () => {
    const { adapter, agent } = await makeAdapter('model-binding')
    await adapter.start()
    const refused = await rejection(adapter.selectModel('fixture-model-b'))
    assert.match(refused.message, /ACP_MODEL_BINDING_CHANGED/)
    // No selection was sent: a peer advertising another model is not authority.
    assert.equal(agent.state.requests.some(entry => entry.method === 'session/set_model'), false)
    assert.equal(agent.state.requests.some(entry => entry.method === 'session/set_config_option'), false)
    const selected = await adapter.selectModel(MODEL)
    assert.equal(selected.modelId, MODEL)
    assert.equal(agent.state.requests.filter(entry => entry.method === 'session/set_model').length, 1)
    const turn = await adapter.submitTurn({ text: 'one' })
    assert.equal(turn.ok, true)
    assert.equal(turn.model.catalogModel, MODEL)
    await shutdown(adapter)
  }, 30_000)
})
