// Native tests for the ACP session core.
//
// Everything here runs against REAL offline child processes through the trusted
// launcher seam (PowerShell native-peer supervise on Windows): the fixture at
// tests/fixtures/bot-acp-agent-fixture.mjs is a plain Node process speaking the
// ACP wire. No agent CLI, no network, no user profile, no credentials.
//
// Run serially (machine memory limits): node --test --test-concurrency=1

import { once } from 'node:events'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createAcpAdapter, pinAcpEntry } from '../packages/bot-acp/src/acp-adapter.mjs'

const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url))
const REPO = resolve(TESTS_DIR, '..')
const FIXTURE = join(TESTS_DIR, 'fixtures', 'bot-acp-agent-fixture.mjs')
const RUNS = join(REPO, 'tmp', 'integration', 'bot-acp', `native-${Date.now().toString(36)}-${process.pid}`)
const MODEL = 'fixture-model-a'

const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex')

let entryCache = null
const pinnedEntry = async () => {
  entryCache ??= { executable: process.execPath, sha256: await sha256(process.execPath), version: process.versions.node, script: FIXTURE, scriptSha256: await sha256(FIXTURE) }
  return entryCache
}

const evidenceOf = async workspace => JSON.parse(await readFile(join(workspace, 'fixture-evidence.json'), 'utf8'))
/** Turns the real child recorded. An absent file means it received nothing at all. */
const turnsOf = async workspace => {
  try { return (await evidenceOf(workspace)).turns } catch (error) { if (error?.code === 'ENOENT') return []; throw error }
}

let runCounter = 0
/**
 * @param {string} name scenario name
 * @param {object} options
 * @param {string} [options.mode] fixture posture passed as Host-constructed argv
 * @param {object} [options.engine] createAcpAdapter overrides
 * @param {Function} [options.onPermissionRequest]
 * @param {string[]} [options.modelRoutes]
 * @param {string} [options.spawnArgs]
 */
async function makeAdapter(name, { mode = 'default', engine = {}, onPermissionRequest, modelRoutes, spawnArgs } = {}) {
  const id = `a${++runCounter}-${name}`
  const runDir = join(RUNS, id)
  const workspace = join(runDir, 'ws')
  await mkdir(workspace, { recursive: true })
  const authority = createAuthority()
  const subject = {}
  authority.register(subject, {
    botId: `bot-${id}`,
    tools: ['read_notes'],
    modelRoutes: modelRoutes ?? [{ provider: 'fixture', model: MODEL }],
  })
  const adapter = await createAcpAdapter({
    authority,
    subject,
    binding: { taskId: `task-${id}`, attemptId: `att-${id}`, machineId: 'mach-local', workspaceId: `wsid-${id}`, location: 'local' },
    operationId: `op-${id}`,
    entry: await pinnedEntry(),
    spawnArgs: spawnArgs ?? [`--fixture-mode=${mode}`],
    runtimeRoot: join(runDir, 'runtime'),
    workspace,
    model: { catalogProvider: 'fixture', catalogModel: MODEL },
    billing: 'subscription',
    deadlineMs: 90_000,
    onPermissionRequest,
    ...engine,
  })
  return { adapter, authority, subject, workspace, runDir }
}

const until = async (probe, timeoutMs = 10_000) => {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const value = probe()
    if (value) return value
    await new Promise(settle => setTimeout(settle, 25))
  }
  return probe()
}

/** Stop an adapter and wait for its terminal state; never leave a child behind. */
const shutdown = async adapter => {
  if (adapter.closed) return adapter.snapshot().stopEvidence ?? null
  const stop = await adapter.stop('test-done')
  await until(() => !adapter.busy, 5_000)
  return stop
}
describe('pinAcpEntry', () => {
  test('accepts a digest-pinned interpreter+script entry and proves the version', async () => {
    const home = join(RUNS, 'pin-ok')
    await mkdir(home, { recursive: true })
    const entry = await pinAcpEntry(await pinnedEntry(), home)
    assert.equal(entry.version, process.versions.node)
    assert.match(entry.versionOutput, /acp-agent-fixture/)
    assert.equal(entry.script, FIXTURE)
    assert.equal(entry.scriptSha256, (await pinnedEntry()).scriptSha256)
  }, 30_000)

  test('refuses a changed executable digest', async () => {
    const home = join(RUNS, 'pin-bad-exe')
    await mkdir(home, { recursive: true })
    const entry = { ...(await pinnedEntry()), sha256: '0'.repeat(64) }
    await assert.rejects(() => pinAcpEntry(entry, home), /ACP_ENTRY_CHANGED/)
  }, 30_000)

  test('refuses a changed script digest', async () => {
    const home = join(RUNS, 'pin-bad-script')
    await mkdir(home, { recursive: true })
    const entry = { ...(await pinnedEntry()), scriptSha256: 'f'.repeat(64) }
    await assert.rejects(() => pinAcpEntry(entry, home), /ACP_ENTRY_SCRIPT_CHANGED/)
  }, 30_000)

  test('refuses a version the binary does not report', async () => {
    const home = join(RUNS, 'pin-bad-version')
    await mkdir(home, { recursive: true })
    const entry = { ...(await pinnedEntry()), version: '0.0.0-none' }
    await assert.rejects(() => pinAcpEntry(entry, home), /ACP_VERSION_MISMATCH/)
  }, 30_000)

  test('refuses an entry that is not an absolute pinned path', async () => {
    const home = join(RUNS, 'pin-relative')
    await mkdir(home, { recursive: true })
    await assert.rejects(() => pinAcpEntry({ executable: 'node', sha256: 'a'.repeat(64), version: '1' }, home), /PINNED_ACP_ENTRY_REQUIRED/)
  }, 30_000)
})

describe('session lifecycle over the native supervisor', () => {
  test('runs two turns on one session and keeps usage/cost unknown when unreported', async () => {
    const { adapter, workspace } = await makeAdapter('two-turns', { mode: 'default', spawnArgs: ['--fixture-mode=default', '--fixture-fragment', '--fixture-unicode'] })
    const deltas = []
    adapter.events.on('delta', delta => deltas.push(delta.delta))
    const opened = await adapter.start()
    assert.equal(opened.ok, true)
    assert.equal(opened.resumed, false)
    assert.match(adapter.sessionId, /^fixture-session-/)
    assert.equal(adapter.agentCapabilities.loadSession, true)
    assert.equal(adapter.agentCapabilities.agentName, 'acp-agent-fixture')

    const first = await adapter.submitTurn({ text: 'hello there' })
    assert.equal(first.ok, true)
    assert.equal(first.outcome, 'succeeded')
    assert.equal(first.stopReason, 'end_turn')
    assert.equal(first.sessionId, adapter.sessionId)
    assert.match(first.text, /fixture reply part 2\./)
    assert.equal(first.usage.reported, false)
    assert.equal(first.usage.status, 'unknown')
    assert.equal(first.costUsd, null)
    assert.equal(first.costStatus, 'unknown')
    assert.ok(deltas.length >= 2)

    const second = await adapter.submitTurn({ text: 'usage-known please' })
    assert.equal(second.ok, true)
    assert.equal(second.usage.reported, true)
    assert.equal(second.usage.inputTokens, 31)
    assert.equal(second.usage.outputTokens, 12)
    assert.equal(second.costUsd, null)

    const evidence = await evidenceOf(workspace)
    assert.equal(evidence.sessions.filter(entry => entry.kind === 'new').length, 1)
    assert.equal(evidence.turns.length, 2)
    assert.equal(evidence.turns[1].sessionId, adapter.sessionId)

    const snapshot = adapter.snapshot()
    assert.equal(snapshot.identity.botId, 'bot-a1-two-turns')
    assert.equal(snapshot.identity.operationId, 'op-a1-two-turns')
    assert.equal(snapshot.billing.amountStatus, 'unknown')
    assert.equal(snapshot.clientCapabilities.fileSystem, false)
    assert.equal(snapshot.clientCapabilities.terminal, false)
    assert.equal(snapshot.turnsDispatched, 2)
    assert.ok(snapshot.limitations.length >= 4)

    const stop = await shutdown(adapter)
    assert.equal(stop.treeStopped, true)
    assert.equal(stop.status, 'confirmed')
    assert.equal(stop.containment, 'windows-job')
    assert.equal(stop.stopRequestedIsNotConfirmation, true)
  }, 120_000)

  test('resumes an advertised session', async () => {
    const { adapter } = await makeAdapter('resume-ok', { mode: 'default' })
    await adapter.start()
    const sessionId = adapter.sessionId
    const stop = await shutdown(adapter)
    assert.equal(stop.treeStopped, true)

    const resumed = await makeAdapter('resume-ok-2', { mode: 'default', engine: { resumeSessionId: sessionId } })
    const opened = await resumed.adapter.start()
    assert.equal(opened.ok, true)
    assert.equal(opened.resumed, true)
    assert.equal(opened.sessionId, sessionId)
    const turn = await resumed.adapter.submitTurn({ text: 'continue' })
    assert.equal(turn.ok, true)
    await shutdown(resumed.adapter)
  }, 120_000)

  test('a refused resume never opens a new session or replays the turn', async () => {
    const { adapter, workspace } = await makeAdapter('resume-refused', { mode: 'load-refuse', engine: { resumeSessionId: 'gone-session' } })
    const opened = await adapter.start()
    assert.equal(opened.ok, false)
    assert.equal(opened.stopReason, 'resume-refused')
    assert.equal(adapter.sessionId, null)
    await assert.rejects(adapter.submitTurn({ text: 'do it again' }), /ACP_RESUME_REFUSED/)
    const evidence = await evidenceOf(workspace)
    assert.equal(evidence.sessions.some(entry => entry.kind === 'new'), false)
    assert.equal(evidence.turns.length, 0)
    const stop = await shutdown(adapter)
    assert.equal(stop.treeStopped, true)
  }, 120_000)

  test('a resume the agent does not advertise is refused, not attempted', async () => {
    const { adapter, workspace } = await makeAdapter('resume-unsupported', { mode: 'no-load', engine: { resumeSessionId: 'gone-session' } })
    const opened = await adapter.start()
    assert.equal(opened.ok, false)
    assert.equal(opened.stopReason, 'resume-unsupported')
    const evidence = await evidenceOf(workspace)
    assert.equal(evidence.sessions.some(entry => entry.kind === 'load'), false)
    await shutdown(adapter)
  }, 120_000)

  test('refuses a session/new that answers without a sessionId', async () => {
    const { adapter } = await makeAdapter('no-session-id', { mode: 'no-session-id' })
    await assert.rejects(adapter.start(), /no sessionId/)
    await shutdown(adapter)
  }, 120_000)

  test('refuses a protocol version it does not speak', async () => {
    const { adapter } = await makeAdapter('wrong-protocol', { mode: 'wrong-protocol' })
    await assert.rejects(adapter.start(), /protocol version mismatch/)
    await shutdown(adapter)
  }, 120_000)
})

describe('model and mode negotiation', () => {
  test('re-asserts the committed model through an advertised config option with zero prompts', async () => {
    // The committed model may be re-asserted through whatever option the agent
    // advertised, and no prompt is sent for the selection itself.
    const { adapter, workspace } = await makeAdapter('model-option', {
      mode: 'model-option',
      modelRoutes: [{ provider: 'fixture', model: MODEL }, { provider: 'fixture', model: 'fixture-model-b' }],
    })
    await adapter.start()
    const selected = await adapter.selectModel(MODEL)
    assert.equal(selected.modelId, MODEL)
    const evidence = await evidenceOf(workspace)
    assert.equal(evidence.sessions.some(entry => entry.kind === 'new'), true)
    assert.equal(evidence.turns.length, 0)

    const turn = await adapter.submitTurn({ text: 'go' })
    assert.equal(turn.ok, true)
    await shutdown(adapter)
  }, 120_000)
  test('an adapter whose committed model the Host never authorized fails closed', async () => {
    // The guard re-asserts the committed model route on every tick, so a grant
    // that does not cover it retires the adapter instead of running a turn.
    const { adapter } = await makeAdapter('model-unauthorized', {
      mode: 'model-option',
      modelRoutes: [{ provider: 'fixture', model: 'fixture-model-b' }],
    })
    await assert.rejects(adapter.start(), /MODEL_DENIED/)
    await shutdown(adapter)
  }, 120_000)

  test('re-asserts the committed model and refuses a binding the Host did not commit', async () => {
    // The session's model identity is the Host-committed catalogModel. A peer
    // advertising another model is not authority: a different binding needs a
    // rebuilt, re-authorized adapter, never a silent live switch.
    const { adapter, workspace } = await makeAdapter('model-binding', {
      mode: 'model-option',
      modelRoutes: [{ provider: 'fixture', model: MODEL }, { provider: 'fixture', model: 'fixture-model-b' }],
    })
    await adapter.start()
    await assert.rejects(adapter.selectModel('fixture-model-b'), /ACP_MODEL_BINDING_CHANGED/)
    const afterRefusal = await evidenceOf(workspace)
    // Zero prompts: nothing was asked of the agent.
    assert.equal(afterRefusal.turns.length, 0)
    assert.equal(afterRefusal.sessions.filter(entry => entry.kind === 'new').length, 1)

    const selected = await adapter.selectModel(MODEL)
    assert.equal(selected.modelId, MODEL)
    const turn = await adapter.submitTurn({ text: 'go' })
    assert.equal(turn.ok, true)
    assert.equal(turn.model.catalogModel, MODEL)
    await shutdown(adapter)
  }, 120_000)

  test('sets an advertised session mode and refuses one it does not advertise', async () => {
    const { adapter } = await makeAdapter('modes', { mode: 'modes' })
    await adapter.start()
    assert.deepEqual(await adapter.setMode('auto-edit'), { modeId: 'auto-edit' })
    await assert.rejects(adapter.setMode('yolo'), /ACP_MODE_NOT_ADVERTISED/)
    await shutdown(adapter)
  }, 120_000)
})

describe('permissions over the native supervisor', () => {
  test('cancels a permission ask with no Host handler', async () => {
    const { adapter } = await makeAdapter('perm-no-handler', { mode: 'default' })
    await adapter.start()
    const turn = await adapter.submitTurn({ text: 'permission please' })
    assert.equal(turn.ok, true)
    assert.match(turn.text, /denied\./)
    // The adapter itself denies when the Host supplies no handler: the ask
    // reaches the policy and is answered deny, never approved.
    assert.equal(adapter.snapshot().permissions.denied, 1)
    assert.equal(adapter.snapshot().permissions.allowed, 0)
    await shutdown(adapter)
  }, 120_000)

  test('answers with the Host-selected allow option', async () => {
    const { adapter } = await makeAdapter('perm-allow', { mode: 'default', onPermissionRequest: async () => ({ behavior: 'allow' }) })
    await adapter.start()
    const turn = await adapter.submitTurn({ text: 'permission please' })
    assert.equal(turn.ok, true)
    assert.match(turn.text, /allowed\./)
    assert.equal(adapter.snapshot().permissions.allowed, 1)
    await shutdown(adapter)
  }, 120_000)

  test('cancels the ask when the Host denies', async () => {
    const { adapter } = await makeAdapter('perm-deny', { mode: 'default', onPermissionRequest: async () => ({ behavior: 'deny', message: 'not granted' }) })
    await adapter.start()
    const turn = await adapter.submitTurn({ text: 'permission please' })
    assert.equal(turn.ok, true)
    assert.match(turn.text, /denied\./)
    assert.equal(adapter.snapshot().permissions.denied, 1)
    assert.equal(adapter.snapshot().permissions.allowed, 0)
    await shutdown(adapter)
  }, 120_000)

  test('cancels an unanswered ask after the deadline', async () => {
    const { adapter } = await makeAdapter('perm-timeout', {
      mode: 'default',
      onPermissionRequest: () => new Promise(() => {}),
      engine: { limits: { permissionTimeoutMs: 1500 } },
    })
    await adapter.start()
    const turn = await adapter.submitTurn({ text: 'permission please' })
    assert.equal(turn.ok, true)
    assert.match(turn.text, /denied\./)
    assert.equal(adapter.snapshot().permissions.timeouts, 1)
    await shutdown(adapter)
  }, 120_000)

  test('refuses fs and terminal methods the client never advertised', async () => {
    const { adapter, workspace } = await makeAdapter('client-methods', { mode: 'default' })
    await adapter.start()
    const fsTurn = await adapter.submitTurn({ text: 'fs-read now' })
    assert.equal(fsTurn.ok, true)
    const terminalTurn = await adapter.submitTurn({ text: 'terminal now' })
    assert.equal(terminalTurn.ok, true)
    const evidence = await evidenceOf(workspace)
    const fileAsk = evidence.asks.find(ask => ask.method === 'fs/read_text_file')
    const terminalAsk = evidence.asks.find(ask => ask.method === 'terminal/create')
    assert.ok(fileAsk, 'the agent really asked fs/read_text_file')
    assert.ok(terminalAsk, 'the agent really asked terminal/create')
    await shutdown(adapter)
  }, 120_000)
})

describe('cancellation and stop evidence', () => {
  test('a confirmed cancel settles the turn and the stop is proven separately', async () => {
    const { adapter } = await makeAdapter('cancel', { mode: 'default' })
    await adapter.start()
    const pending = adapter.submitTurn({ text: 'slow down' })
    await until(() => adapter.busy)
    const observed = []
    adapter.events.on('cancel-requested', detail => observed.push(detail))
    assert.equal(adapter.cancel(), true)
    const turn = await pending
    assert.equal(turn.ok, true)
    assert.equal(turn.outcome, 'cancelled')
    assert.equal(turn.stopReason, 'cancelled')
    assert.ok(turn.cancelRequestedAt !== null)
    assert.equal(observed.length, 1)
    const stop = await shutdown(adapter)
    assert.equal(stop.treeStopped, true)
    assert.equal(stop.status, 'confirmed')
    assert.ok(stop.cancelRequestedAt !== null)
  }, 120_000)

  test('an unanswered cancel ends in a real process tree stop', async () => {
    const { adapter } = await makeAdapter('cancel-ignore', {
      mode: 'cancel-ignore',
      engine: { limits: { cancelTimeoutMs: 3_000 } },
    })
    await adapter.start()
    const pending = adapter.submitTurn({ text: 'cancel-ignore please' })
    await until(() => adapter.busy)
    assert.equal(adapter.cancel(), true)
    const turn = await pending
    assert.equal(turn.outcome, 'cancelled')
    const stop = await until(() => (adapter.closed ? adapter.snapshot().stopEvidence ?? null : null), 15_000)
    assert.ok(stop, 'the stop evidence was reported')
    assert.equal(stop.treeStopped, true)
    assert.equal(stop.status, 'confirmed')
    assert.equal(stop.reason, 'cancel-timeout')
  }, 120_000)

  test('a peer that exits before its result settles the turn as an exit', async () => {
    const { adapter } = await makeAdapter('exit-early', { mode: 'exit-early' })
    await adapter.start()
    const turn = await adapter.submitTurn({ text: 'hello' })
    assert.equal(turn.ok, false)
    assert.equal(turn.stopReason, 'exit-before-result')
    await shutdown(adapter)
  }, 120_000)

  test('a revoked grant settles the turn and stops the adapter', async () => {
    const { adapter, authority, subject } = await makeAdapter('grant-revoked', { mode: 'default' })
    await adapter.start()
    const pending = adapter.submitTurn({ text: 'slow down' })
    await until(() => adapter.busy)
    authority.revoke(subject)
    const turn = await pending
    assert.equal(turn.ok, false)
    assert.equal(turn.stopReason, 'grant-revoked')
    const stop = await until(() => (adapter.closed ? adapter.snapshot().stopEvidence ?? null : null), 15_000)
    assert.ok(stop)
    assert.equal(stop.treeStopped, true)
  }, 120_000)
})

describe('wire discipline', () => {
  test('counts a duplicate response, an unknown id and a non-RPC message without settling twice', async t => {
    const { adapter } = await makeAdapter('dup-response', { mode: 'default' })
    t.after(()=>shutdown(adapter))
    await adapter.start()
    const turn = await adapter.submitTurn({ text: 'dup-response' })
    assert.equal(turn.ok, true)
    // A result resolves the turn before the next separately queued stdout line
    // must arrive. Wait for actual receiver evidence, never a fixed sleep or a
    // relaxed counter, then prove the duplicate did not settle a second turn.
    assert.equal(await until(()=>adapter.snapshot().transport.rpc.duplicateResponses>=1),true)
    assert.equal((await shutdown(adapter)).turns.settled,1)

    const unknown = await makeAdapter('unknown-id', { mode: 'default' })
    t.after(()=>shutdown(unknown.adapter))
    await unknown.adapter.start()
    const unknownTurn = await unknown.adapter.submitTurn({ text: 'unknown-id please' })
    assert.equal(unknownTurn.ok, true)
    assert.equal(await until(()=>unknown.adapter.snapshot().transport.rpc.unknownResponses>=1),true)
    assert.equal((await shutdown(unknown.adapter)).turns.settled,1)

    const notRpc = await makeAdapter('not-rpc', { mode: 'default' })
    t.after(()=>shutdown(notRpc.adapter))
    await notRpc.adapter.start()
    const notRpcTurn = await notRpc.adapter.submitTurn({ text: 'not-rpc please' })
    assert.equal(notRpcTurn.ok, true)
    assert.equal(await until(()=>notRpc.adapter.snapshot().transport.rpc.malformed>=1),true)
    assert.equal((await shutdown(notRpc.adapter)).turns.settled,1)
  }, 180_000)

  test('an unparseable line fails the connection instead of hanging the turn', async () => {
    const { adapter } = await makeAdapter('garbage', { mode: 'default' })
    await adapter.start()
    const turn = await adapter.submitTurn({ text: 'garbage please' })
    assert.equal(turn.ok, false)
    await shutdown(adapter)
  }, 120_000)

  test('an oversized frame fails the connection instead of buffering it', async () => {
    const { adapter } = await makeAdapter('oversize', { mode: 'default' })
    await adapter.start()
    const turn = await adapter.submitTurn({ text: 'oversize please' })
    assert.equal(turn.ok, false)
    await shutdown(adapter)
  }, 120_000)
})

describe('turn input and authority boundaries', () => {
  test('accepts text only', async () => {
    const { adapter } = await makeAdapter('input', { mode: 'default' })
    await adapter.start()
    await assert.rejects(adapter.submitTurn({ text: 'hi', executable: 'cmd.exe' }), /only \{ text \}/)
    await assert.rejects(adapter.submitTurn({ text: '  ' }), /ACP_TURN_TEXT_INVALID/)
    await assert.rejects(adapter.submitTurn({ text: 'x'.repeat(65_000) }), /ACP_TURN_TEXT_INVALID/)
    await assert.rejects(adapter.submitTurn({ text: 'ok', botId: 'someone-else', owner: 'admin' }), /only \{ text \}/)
    await shutdown(adapter)
  }, 120_000)

  test('re-asserts the Host model authorization on every turn', async () => {
    const { adapter, authority, subject } = await makeAdapter('per-turn', { mode: 'default' })
    await adapter.start()
    const first = await adapter.submitTurn({ text: 'one' })
    assert.equal(first.ok, true)
    authority.replaceGrant(subject, { tools: ['read_notes'], modelRoutes: [] })
    await assert.rejects(adapter.submitTurn({ text: 'two' }), /MODEL_DENIED/)
    await shutdown(adapter)
  }, 120_000)

  test('stops at the session turn limit', async () => {
    const { adapter } = await makeAdapter('turn-limit', { mode: 'default', engine: { limits: { maxTurns: 2 } } })
    await adapter.start()
    assert.equal((await adapter.submitTurn({ text: 'one' })).ok, true)
    assert.equal((await adapter.submitTurn({ text: 'two' })).ok, true)
    await assert.rejects(adapter.submitTurn({ text: 'three' }), /ACP_SESSION_TURN_LIMIT/)
    await shutdown(adapter)
  }, 120_000)

  test('reports Host hooks with identity and no fabricated cost', async () => {
    const seen = []
    const { adapter } = await makeAdapter('hooks', {
      mode: 'default',
      engine: {
        hooks: {
          onBeforeRequest: async evidence => seen.push(['before', evidence]),
          onObserve: async evidence => seen.push(['observe', evidence]),
          onSettle: async evidence => seen.push(['settle', evidence]),
          onClose: async evidence => seen.push(['close', evidence]),
        },
      },
    })
    await adapter.start()
    const turn = await adapter.submitTurn({ text: 'hook me' })
    assert.equal(turn.ok, true)
    await shutdown(adapter)
    const kinds = seen.map(entry => entry[0])
    assert.deepEqual(kinds.filter(kind => kind === 'before').length, 1)
    assert.equal(kinds.includes('observe'), true)
    assert.equal(kinds.includes('settle'), true)
    assert.equal(kinds.includes('close'), true)
    const before = seen.find(entry => entry[0] === 'before')[1]
    assert.equal(before.source, 'acp')
    assert.equal(before.driver, 'acp')
    assert.match(before.operationId, /^op-a\d+-hooks$/)
    assert.equal(before.entry.sha256, (await pinnedEntry()).sha256)
    const settle = seen.find(entry => entry[0] === 'settle')[1]
    assert.equal(settle.costUsd, null)
    assert.equal(settle.costStatus, 'unknown')
    assert.equal(settle.usageStatus, 'unknown')
    const close = seen.find(entry => entry[0] === 'close')[1]
    assert.equal(close.treeStopped, true)
  }, 120_000)
})

describe('authentication', () => {
  test('fails a required authentication the agent cannot satisfy', async () => {
    const { adapter } = await makeAdapter('auth-fail', {
      mode: 'auth-fail',
      engine: { auth: { pickMethod: () => 'fixture-token', onAuthFailure: 'fail' } },
    })
    await assert.rejects(adapter.start(), /Login expired/)
    await shutdown(adapter)
  }, 120_000)

  test('continues past an optional authentication', async () => {
    const { adapter } = await makeAdapter('auth-continue', {
      mode: 'auth-fail',
      engine: { auth: { pickMethod: () => 'fixture-token', onAuthFailure: 'continue' } },
    })
    const opened = await adapter.start()
    assert.equal(opened.ok, true)
    const turn = await adapter.submitTurn({ text: 'hello' })
    assert.equal(turn.ok, true)
    await shutdown(adapter)
  }, 120_000)
})

// Real-machine turn fence: the same rules the seam suite proves with a fake
// supervisor, here against a real offline Node child through the real native
// supervisor. Everything waits for a terminal state; nothing is left running.
describe('turn fence over the native supervisor', () => {
  test('a same-tick second submit causes exactly one launch and one prompt', async () => {
    let release
    const { adapter, workspace } = await makeAdapter('fence-same-tick', {
      mode: 'default',
      engine: { hooks: { onBeforeRequest: () => new Promise(resolve => { release = resolve }) } },
    })
    const first = adapter.submitTurn({ text: 'one' })
    // Both calls in the same tick, while the first is still in Host admission.
    const second = adapter.submitTurn({ text: 'two' }).then(() => null, error => error)
    assert.equal(adapter.busy, true)
    const secondError = await second
    assert.match(secondError.message, /ACP_TURN_IN_PROGRESS/)
    release()
    const turn = await first
    assert.equal(turn.ok, true)
    const evidence = await evidenceOf(workspace)
    assert.equal(evidence.sessions.filter(entry => entry.kind === 'new').length, 1)
    assert.equal(evidence.turns.length, 1)
    const snapshot = adapter.snapshot()
    assert.equal(snapshot.launches, 1)
    assert.equal(snapshot.turnsAdmitted, 1)
    assert.equal(snapshot.turnsDispatched, 1)
    await shutdown(adapter)
  }, 120_000)

  test('a stop during a real launch stops the real tree and sends no prompt', async () => {
    const { adapter, workspace } = await makeAdapter('fence-stop-launch', { mode: 'slow-init' })
    const settled = []
    adapter.events.on('turn', evidence => settled.push(evidence))
    const pending = adapter.submitTurn({ text: 'hello' }).then(() => null, error => error)
    // The child is really running and its handshake is really in flight: the
    // initialize request has been issued to the real pipe.
    await until(() => adapter.snapshot().transport.rpc?.requests >= 1)
    const stopping = adapter.stop('stop-during-launch')
    const failure = await pending
    // The handshake dies with the tree; the turn itself was settled as not-run.
    assert.match(failure.message, /ACP_STOPPED|ACP_TURN_NOT_DISPATCHED|exited/)
    const stop = await stopping
    assert.equal(stop.treeStopped, true)
    assert.equal(stop.status, 'confirmed')
    assert.equal(stop.reason, 'stop-during-launch')
    assert.equal(settled.length, 1)
    assert.equal(settled[0].outcome, 'not-run')
    assert.equal(settled[0].stopReason, 'stop-during-launch')
    assert.equal(settled[0].dispatched, false)
    assert.deepEqual(await turnsOf(workspace), [])
    assert.equal(adapter.snapshot().turnsDispatched, 0)
    assert.equal(adapter.snapshot().turnsSettled, 1)
    assert.equal(adapter.snapshot().turn, null)
  }, 120_000)

  test('a late response from a settled turn never settles it twice or pollutes the next', async () => {
    const { adapter, workspace } = await makeAdapter('fence-late-response', { mode: 'late-response' })
    await adapter.start()
    const first = await adapter.submitTurn({ text: 'hello' })
    assert.equal(first.ok, true)
    assert.equal(first.usage.reported, false)
    await until(() => adapter.snapshot().transport.rpc.duplicateResponses >= 1)
    assert.equal(adapter.snapshot().transport.rpc.lateResponses >= 1, true)
    // The late frame names a session that no longer exists and answers an id the
    // client already settled: the next turn is untouched by it.
    await new Promise(resolve => setTimeout(resolve, 600))
    const second = await adapter.submitTurn({ text: 'again' })
    assert.equal(second.ok, true)
    assert.equal(second.text, 'fixture reply part 1. fixture reply part 2.')
    assert.equal(second.usage.reported, false)
    assert.equal(adapter.snapshot().turnsSettled, 2)
    const evidence = await evidenceOf(workspace)
    assert.equal(evidence.turns.length, 2)
    await shutdown(adapter)
  }, 120_000)

  test('a cancel during a pending admission settles not-run and sends no prompt', async () => {
    let release
    const { adapter, workspace } = await makeAdapter('fence-cancel-admission', {
      mode: 'default',
      engine: { hooks: { onBeforeRequest: () => new Promise(resolve => { release = resolve }) } },
    })
    await adapter.start()
    const pending = adapter.submitTurn({ text: 'hello' }).then(() => null, error => error)
    await until(() => adapter.busy)
    assert.equal(adapter.cancel(), true)
    await until(() => !adapter.busy)
    const evidence = await evidenceOf(workspace)
    assert.equal(evidence.turns.length, 0)
    assert.equal(adapter.snapshot().turnsDispatched, 0)
    assert.equal(adapter.snapshot().turnsSettled, 1)
    // The admission that resolves afterwards must not dispatch a cancelled turn.
    release()
    const refusal = await pending
    assert.match(refusal.message, /ACP_TURN_NOT_DISPATCHED: the turn was settled as cancelled-before-dispatch/)
    const evidenceAfter = await evidenceOf(workspace)
    assert.equal(evidenceAfter.turns.length, 0)
    await shutdown(adapter)
  }, 120_000)

  test('a refused admission is re-callable and dispatches exactly once', async () => {
    let refuse = true
    const { adapter, workspace } = await makeAdapter('fence-refused-admission', {
      mode: 'default',
      engine: { hooks: { onBeforeRequest: async () => { if (refuse) throw new Error('FUNDING_REFUSED') } } },
    })
    await adapter.start()
    await assert.rejects(adapter.submitTurn({ text: 'hello' }), /FUNDING_REFUSED/)
    let evidence = await evidenceOf(workspace)
    assert.equal(evidence.turns.length, 0)
    assert.equal(adapter.busy, false)
    assert.equal(adapter.snapshot().turnsAdmitted, 0)
    // The slot is free: the same adapter is called again once the Host agrees.
    refuse = false
    const turn = await adapter.submitTurn({ text: 'hello' })
    assert.equal(turn.ok, true)
    evidence = await evidenceOf(workspace)
    assert.equal(evidence.turns.length, 1)
    assert.equal(adapter.snapshot().turnsAdmitted, 1)
    assert.equal(adapter.snapshot().turnsDispatched, 1)
    await shutdown(adapter)
  }, 120_000)

  test('a slow settlement keeps the turn pending until the Host has recorded it', async () => {
    const order = []
    let release
    const { adapter } = await makeAdapter('fence-slow-settle', {
      mode: 'default',
      engine: {
        hooks: {
          onSettle: async () => { order.push('settle-start'); await new Promise(resolve => { release = resolve }); order.push('settle-end') },
          onClose: async () => order.push('close'),
        },
      },
    })
    await adapter.start()
    const pending = adapter.submitTurn({ text: 'hello' })
    adapter.events.on('turn', () => order.push('turn-event'))
    await until(() => order.includes('settle-start'))
    // The child already answered; the Host hook has not finished.
    assert.equal(adapter.busy, true)
    assert.equal(adapter.snapshot().settlement.inFlight, 1)
    release()
    const turn = await pending
    assert.equal(turn.ok, true)
    assert.equal(adapter.busy, false)
    assert.deepEqual(order, ['settle-start', 'settle-end', 'turn-event'])
    await shutdown(adapter)
  }, 120_000)

  test('a refused settlement refuses the success and retires the adapter', async () => {
    const { adapter } = await makeAdapter('fence-refused-settle', {
      mode: 'default',
      engine: { hooks: { onSettle: async () => { throw new Error('LEDGER_WRITE_FAILED') } } },
    })
    await adapter.start()
    const failure = await adapter.submitTurn({ text: 'hello' }).then(() => null, error => error)
    assert.match(failure.message, /ACP_SETTLEMENT_FAILED: LEDGER_WRITE_FAILED/)
    assert.equal(failure.evidence.ok, true)
    assert.equal(failure.evidence.costUsd, null)
    assert.equal(failure.evidence.costStatus, 'unknown')
    assert.equal(failure.evidence.usageStatus, 'unknown')
    assert.equal(adapter.snapshot().turnsSettled, 1)
    assert.equal(adapter.busy, false)
    const stop = await until(() => (adapter.closed ? adapter.snapshot().stopEvidence ?? null : null), 20_000)
    assert.ok(stop)
    assert.equal(stop.treeStopped, true)
    assert.equal(stop.reason, 'settle-hook-failed')
    assert.deepEqual(stop.turns, { admitted: 1, dispatched: 1, settled: 1 })
  }, 120_000)

  test('no session or model call may run while a real turn is pending', async () => {
    const { adapter, workspace } = await makeAdapter('fence-identity', { mode: 'modes' })
    await adapter.start()
    const pending = adapter.submitTurn({ text: 'slow down' }).then(() => null, () => null)
    await until(() => adapter.busy && adapter.snapshot().turn?.dispatched === true)
    for (const [label, call] of [
      ['start', () => adapter.start()],
      ['startFresh', () => adapter.startFresh()],
      ['selectModel', () => adapter.selectModel(MODEL)],
      ['setMode', () => adapter.setMode('auto-edit')],
    ]) {
      const error = await call().then(() => null, value => value)
      assert.match(error.message, /ACP_TURN_IN_PROGRESS/, label)
    }
    const evidence = await evidenceOf(workspace)
    assert.equal(evidence.sessions.filter(entry => entry.kind === 'new').length, 1)
    assert.equal(evidence.turns.length, 1)
    await shutdown(adapter)
    await pending
  }, 120_000)
})
