// Native tests for the Claude conversation engine adapter.
//
// Two groups, both fully offline (no claude CLI, no network, no credentials):
//
//  1. "claude engine native session" — REAL child processes through the trusted
//     launcher seam (PowerShell native-peer supervise on Windows). The fixture at
//     tests/fixtures/bot-engine-claude-fixture.mjs is a plain Node process speaking
//     the Claude Code stream-json wire. The turn-lifecycle fence cases that can be
//     proven with a real tree (same-tick double submit, stray frames during a
//     pending settlement, settlement-hook failure, tree stop ahead of a slow
//     settlement, observation-hook failure) run here.
//
//  2. "claude engine turn fence (launcher-seam)" — the same engine with a
//     substituted launcher seam: a fake probe/protect (a `node -e` relay script
//     answers the bridge bootstrap's `listening` handshake so createCliBootstrap
//     stays real) plus a gated in-memory supervisor standing in for the native
//     peer. Gates are explicit Promises — no timing-guess sleeps. These prove the
//     launch/admission/stop edge states that a healthy process never produces:
//     stuck admission, stop during admission/launch, stdin write failure, a
//     throwing supervise(), a tampered entry script, and late frames from a dead
//     process generation.
//
// Run serially (machine memory limits): node --test --test-concurrency=1

import { EventEmitter, once } from 'node:events'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createClaudeEngine, pinClaudeEntry } from '../packages/bot-engines/src/claude-engine.mjs'

const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url))
const REPO = resolve(TESTS_DIR, '..')
const FIXTURE = join(TESTS_DIR, 'fixtures', 'bot-engine-claude-fixture.mjs')
const RUNS = join(REPO, 'tmp', 'integration', 'bot-engines', `native-${Date.now().toString(36)}-${process.pid}`)
const MODEL = 'fixture-model-a'

const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const closeTo = (actual, expected, epsilon = 1e-9, label = '') =>
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) <= epsilon, `${label} expected ~${expected}, got ${actual}`)

let entryCache = null
async function pinnedEntry() {
  entryCache ??= { executable: process.execPath, sha256: await sha256(process.execPath), version: process.versions.node, script: FIXTURE, scriptSha256: await sha256(FIXTURE) }
  return entryCache
}

const HANDLER = {
  definition: { name: 'read_notes', description: 'Read committed notes', inputSchema: { type: 'object' } },
  parse: value => value ?? {},
  execute: async () => ({ ok: true }),
}

let runCounter = 0
async function makeEngine(name, overrides = {}) {
  const id = `e${++runCounter}-${name}`
  const runDir = join(RUNS, id)
  const workspace = join(runDir, 'ws')
  await mkdir(workspace, { recursive: true })
  const authority = overrides.authority ?? createAuthority()
  const subject = overrides.subject ?? {}
  authority.register(subject, { botId: `bot-${id}`, tools: ['read_notes'], modelRoutes: [{ provider: 'anthropic', model: overrides.model ?? MODEL }] })
  const engine = await createClaudeEngine({
    authority,
    subject,
    binding: { taskId: `task-${id}`, attemptId: `att-${id}`, machineId: 'mach-local', workspaceId: `wsid-${id}`, location: 'local' },
    operationId: `op-${id}`,
    entry: await pinnedEntry(),
    runtimeRoot: join(runDir, 'runtime'),
    workspace,
    model: { catalogProvider: 'anthropic', catalogModel: overrides.model ?? MODEL },
    tools: ['read_notes'],
    handlers: [HANDLER],
    deadlineMs: 90_000,
    ...overrides.engine,
  })
  return { engine, authority, subject, workspace }
}

const evidenceOf = async workspace => JSON.parse(await readFile(join(workspace, 'fixture-evidence.json'), 'utf8'))

async function waitProcessGone(engine, timeoutMs = 15_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (engine.snapshot().process === null) return true
    await new Promise(settle => setTimeout(settle, 50))
  }
  return false
}

const sawEvent = async (events, name) => {
  // Native Windows bootstrap/protection can take over 30 seconds before the
  // fixture emits anything. Stay within the engine's 90s lifetime and still
  // require a real event before testing revoke/stop; this never proves a stop.
  const startupWaitMs = process.platform === 'win32' ? 60_000 : 20_000
  try { await once(events, name, { signal: AbortSignal.timeout(startupWaitMs) }); return true }
  catch { return false }
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

// ---- launcher-seam helpers -------------------------------------------------
// A `node -e` script standing in for the native peer's `server` mode: it answers
// the first stdin JSON line with a `listening` control so the REAL bridge
// bootstrap (createCliBootstrap → nativeProcess 'server') completes its bind, then
// idles until stdin closes (bridge.close) and exits. No timing assumptions.
const RELAY_SCRIPT = [
  "let b=''",
  "process.stdin.on('data',c=>{b+=c",
  "let i",
  "while((i=b.indexOf('\\n'))>=0){const l=b.slice(0,i)",
  "b=b.slice(i+1)",
  "if(!l.trim())continue",
  "process.stdout.write(JSON.stringify({control:'listening',pid:process.pid,start:String(process.hrtime.bigint())})+'\\n')}})",
  "process.stdin.on('end',()=>process.exit(0))",
  "process.stdin.resume()",
].join(';')

/** In-memory supervisor matching the nativeProcess surface the engine uses:
 * events('control'|'message'|'failure'|'closed'), waitControl, send, end, exit,
 * child.kill. `gateSpawned` keeps waitControl('spawned') pending until end()
 * rejects it (stop-during-launch windows). `end()` plays the helper's accounting
 * role: a `stopped` control with tree evidence, then `closed`. Test hooks:
 * emit(), onSend, marks{endCalls,killCalls,sent}. */
function seamSupervisor(spec, { gateSpawned = false, stopEvidence } = {}) {
  const events = new EventEmitter()
  const pendingWaits = []
  const marks = { endCalls: 0, killCalls: 0, sent: [] }
  let ended = false
  const rejectWaits = note => { for (const wait of pendingWaits.splice(0)) wait.reject(new Error(`NATIVE_${wait.name.toUpperCase()}_FAILED: ${note}`)) }
  const exit = new Promise(resolve => events.once('closed', () => resolve({ code: 0 })))
  const supervisor = {
    events, exit, spec, marks,
    child: { kill() { marks.killCalls++; if (!ended) { ended = true; rejectWaits('killed'); events.emit('closed', { code: null, signal: 'SIGKILL' }) } } },
    waitControl(name) {
      return new Promise((resolve, reject) => {
        if (name === 'spawned' && !gateSpawned) { resolve({ control: name, pid: 4711, start: 'seam-start' }); return }
        pendingWaits.push({ name, resolve, reject })
      })
    },
    async send(value) {
      if (ended) throw new Error('NATIVE_CLOSED')
      marks.sent.push(value)
      if (supervisor.onSend) return supervisor.onSend(value)
    },
    end() {
      marks.endCalls++
      if (ended) return
      ended = true
      rejectWaits('seam ended')
      if (stopEvidence !== null) {
        events.emit('control', stopEvidence ?? { control: 'stopped', pid: 4711, exitCode: 0, reason: 'seam-tree-accounting', containment: 'seam-job-object', treeStopped: true })
      }
      events.emit('closed', { code: 0 })
    },
    emit(channel, value) { events.emit(channel, value) },
    onSend: null,
  }
  return supervisor
}

/** Launcher with a fake probe/protect/relay helper and fake supervise; the rest
 * of the engine (authority, broker, bridge bootstrap, pinned entry) stays real.
 * The helper claims the linux arg form (`<mode>` appended bare) on purpose: the
 * real win32 peer is PowerShell, where `-Mode server` is a parameter, but a
 * `node -e` relay would choke on node's own `-Mode` option. The bare mode lands
 * in the relay's argv, which it ignores — the bridge handshake stays real. */
function seamLauncher({ onSupervise } = {}) {
  const helper = { platform: 'linux', executable: process.execPath, prefix: ['-e', RELAY_SCRIPT] }
  const supervised = []
  const launcher = {
    probe: async () => ({ available: true, helper, supervisor: 'seam-supervisor' }),
    protect: async () => {},
    supervise: (passedHelper, mode, spec, context) => {
      assert.equal(mode, 'supervise', 'the engine only ever asks for supervise mode')
      assert.equal(passedHelper, helper)
      const supervisor = seamSupervisor(spec, supervised.options ?? {})
      supervised.push({ supervisor, spec, context })
      onSupervise?.(supervisor, spec, supervised.length)
      return supervisor
    },
  }
  return { launcher, supervised }
}

/** One offline CLI turn over a seam supervisor: an init frame confirming the
 * requested model, then a settling result with usage and a running-total cost. */
let seamSessionCounter = 0
function playSeamTurn(supervisor, { model = MODEL } = {}) {
  const sessionId = `seam-${++seamSessionCounter}`
  supervisor.emit('message', { type: 'system', subtype: 'init', session_id: sessionId, model, permissionMode: 'default', tools: [] })
  supervisor.emit('message', { type: 'result', subtype: 'success', is_error: false, duration_ms: 1, num_turns: 1, result: 'seam turn complete', session_id: sessionId, model, usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01 })
}

describe('pinClaudeEntry', () => {
  test('accepts a digest-pinned interpreter+script entry and proves the version', async () => {
    const home = join(RUNS, 'pin-ok')
    await mkdir(home, { recursive: true })
    const entry = await pinClaudeEntry(await pinnedEntry(), home)
    assert.equal(entry.version, process.versions.node)
    assert.match(entry.versionOutput, /dsh-claude-fixture/)
    assert.match(entry.versionOutput, new RegExp(process.versions.node))
    assert.equal(entry.script, FIXTURE)
    assert.equal(entry.scriptSha256, (await pinnedEntry()).scriptSha256)
  }, { timeout: 30_000 })

  test('refuses a changed executable digest', async () => {
    const home = join(RUNS, 'pin-bad-exe')
    await mkdir(home, { recursive: true })
    const entry = { ...(await pinnedEntry()), sha256: '0'.repeat(64) }
    await assert.rejects(() => pinClaudeEntry(entry, home), /ENGINE_ENTRY_CHANGED/)
  }, { timeout: 30_000 })

  test('refuses a changed script digest', async () => {
    const home = join(RUNS, 'pin-bad-script')
    await mkdir(home, { recursive: true })
    const entry = { ...(await pinnedEntry()), scriptSha256: 'f'.repeat(64) }
    await assert.rejects(() => pinClaudeEntry(entry, home), /ENGINE_ENTRY_SCRIPT_CHANGED/)
  }, { timeout: 30_000 })

  test('refuses a version that the entry does not actually report', async () => {
    const home = join(RUNS, 'pin-bad-version')
    await mkdir(home, { recursive: true })
    const base = await pinnedEntry()
    await assert.rejects(() => pinClaudeEntry({ ...base, version: '0.0.1-not-real' }, home), /ENGINE_VERSION_MISMATCH/)
  }, { timeout: 30_000 })

  test('refuses relative paths and non-entries outright', async () => {
    const home = join(RUNS, 'pin-invalid')
    await mkdir(home, { recursive: true })
    const base = await pinnedEntry()
    await assert.rejects(() => pinClaudeEntry({ ...base, executable: 'node.exe' }, home), { name: 'TypeError', message: /PINNED_ENGINE_ENTRY_REQUIRED/ })
    await assert.rejects(() => pinClaudeEntry({ ...base, sha256: 'short' }, home), TypeError)
    await assert.rejects(() => pinClaudeEntry({ ...base, script: 'relative.mjs', scriptSha256: 'a'.repeat(64) }, home), TypeError)
    await assert.rejects(() => pinClaudeEntry({ ...base, executable: join(home, 'missing.exe') }, home))
  }, { timeout: 30_000 })
})

describe('claude engine native session', () => {

  test('two turns on one retained, init-confirmed session; usage and cost deltas flow to Host hooks only', async () => {
    const observed = [], settled = [], before = []
    const { engine, workspace } = await makeEngine('two-turns', {
      engine: {
        hooks: {
          onBeforeRequest: value => { before.push(value) },
          onObserve: value => { observed.push(value) },
          onSettle: value => { settled.push(value) },
        },
      },
    })
    try {
      const t1 = await engine.submitTurn({ text: 'hello turn one' })
      assert.equal(t1.ok, true)
      assert.equal(t1.outcome, 'succeeded')
      assert.equal(t1.driver, 'claude')
      assert.match(t1.sessionId, /^fx-/)
      assert.equal(t1.usageStatus, 'reported')
      assert.deepEqual(t1.usage, { input: 160, output: 45, cachedInput: 30 })
      closeTo(t1.costUsd, 0.01, 1e-9, 'turn 1 cost')
      assert.equal(t1.costStatus, 'cli-reported-running-total-delta')
      assert.equal(t1.errorText, null)

      const t2 = await engine.submitTurn({ text: 'hello turn two' })
      assert.equal(t2.ok, true)
      assert.equal(t2.sessionId, t1.sessionId, 'the same retained process keeps the session')
      assert.deepEqual(t2.usage, { input: 160, output: 45, cachedInput: 30 })
      closeTo(t2.costUsd, 0.01, 1e-9, 'turn 2 cost is the running-total delta')

      const snap = engine.snapshot()
      assert.equal(snap.launches, 1, 'one retained process for both turns')
      assert.equal(snap.turnsDispatched, 2)
      assert.equal(snap.sessionConfirmedByHandshake, true)
      assert.equal(snap.identity.verification, 'init-confirmed')
      assert.equal(snap.identity.mismatch, false)
      assert.equal(snap.identity.reportedInitModel, MODEL)
      assert.equal(snap.closed, false)
      assert.ok(snap.process, 'process still retained')
      assert.equal(snap.process.resumed, false)
      assert.equal(snap.frames.init, 1)
      assert.ok(snap.frames.assistant >= 2)
      assert.equal(snap.frames.results, 2)
      assert.equal(snap.billing.amountUsd, null, 'no second ledger: the engine invents no money')
      assert.equal(snap.billing.amountStatus, 'unknown')

      assert.equal(before.length, 2, 'admission hook saw every dispatch')
      for (const value of before) {
        assert.equal(value.driver, 'claude')
        assert.equal(value.source, 'engine')
        assert.equal(value.entry.path, process.execPath)
        assert.equal(value.entry.sha256, (await pinnedEntry()).sha256)
        assert.match(value.operationId, /^op-/)
      }
      assert.equal(settled.length, 2, 'settlement hook received each turn result')
      assert.ok(observed.some(value => value.kind === 'session-confirmed'))

      const evidence = await evidenceOf(workspace)
      assert.equal(evidence.argv.print, true)
      assert.equal(evidence.argv.outputFormat, 'stream-json')
      assert.equal(evidence.argv.inputFormat, 'stream-json')
      assert.equal(evidence.argv.model, MODEL)
      assert.equal(evidence.argv.resume, null)
      // The real Windows supervisor must preserve the empty argument. allowedTools
      // auto-approves matching tools; it does not remove default Read/Edit tools.
      assert.equal(evidence.argv.builtinTools, '', 'all built-in tools disabled at CLI launch')
      assert.equal(evidence.argv.settingSources, '', 'user/project/local settings are excluded')
      assert.equal(evidence.argv.settings?.disableAllHooks, true)
      assert.equal(evidence.argv.slashCommandsDisabled, true)
      assert.ok(evidence.argv.allowedTools.includes('mcp__dsh'))
      assert.ok(evidence.argv.allowedTools.includes('mcp__dsh_task__read_notes'))
      assert.ok(evidence.argv.disallowedTools.includes('Bash'))
      assert.equal(evidence.mcp.proxyMounted, true, 'permission proxy mounted with the broker pipe')
      assert.equal(evidence.mcp.bridgeMounted, true, 'committed-grant bridge mounted')
      assert.equal(evidence.mcp.permissionPromptToolIsProxy, true)
      assert.equal(evidence.mcp.disallowedBash, true)
      assert.equal(evidence.turns.length, 2)
      assert.deepEqual(evidence.asks, [], 'no permission asks in plain turns')
    } finally { await engine.stop() }
  }, { timeout: 120_000 })

  test('permission asks: granted bridge tool allowed by host, unknown tool auto-denied, questions answered', async () => {
    const resolvedEvents = []
    const decisions = []
    const { engine } = await makeEngine('permissions', {
      engine: {
        onPermissionRequest: ask => {
          decisions.push(ask)
          return ask.kind === 'question' ? { behavior: 'answer', message: 'because the host said so' } : { behavior: 'allow' }
        },
      },
    })
    engine.events.on('permission-resolved', value => resolvedEvents.push(value))
    try {
      const allowed = await engine.submitTurn({ text: 'ask-granted:read_notes' })
      assert.equal(allowed.ok, true)
      assert.equal(allowed.usageStatus, 'reported')
      closeTo(allowed.costUsd, 0.02, 1e-9, 'bridged-tool turn cost')

      const denied = await engine.submitTurn({ text: 'please ask-unknown' })
      assert.equal(denied.ok, true, 'a denied unsupported tool does not fail the whole turn')
      assert.equal(denied.errorText, null)

      const answered = await engine.submitTurn({ text: 'question: should we continue?' })
      assert.equal(answered.ok, true)

      const snap = engine.snapshot().permissions
      assert.equal(snap.asks, 3)
      assert.equal(snap.forwarded, 2, 'only the granted tool and the question reach the host')
      assert.equal(snap.autoDeniedUnsupported, 1, 'Bash never reaches the host: it is not in the committed grants')
      assert.equal(snap.hostAllowed, 1)
      assert.equal(snap.hostDenied, 0)
      assert.equal(snap.brokerClosed, false)

      const byTool = Object.fromEntries(resolvedEvents.map(value => [value.ask.tool, value]))
      assert.equal(byTool['mcp__dsh_task__read_notes'].behavior, 'allow')
      assert.equal(byTool['mcp__dsh_task__read_notes'].source, 'user')
      assert.equal(byTool.Bash.behavior, 'deny')
      assert.equal(byTool.Bash.source, 'engine', 'unsupported tools are denied by the engine, not the host')
      assert.equal(byTool.question.behavior, 'answer')
      assert.deepEqual(decisions.map(ask => ask.kind), ['permission', 'question'])
    } finally { await engine.stop() }
  }, { timeout: 120_000 })

  test('host may answer out-of-band via respondToRequest; unknown ids and malformed decisions fail closed', async () => {
    const seen = []
    const { engine } = await makeEngine('respond', {
      engine: {
        onPermissionRequest: ask => { seen.push(ask); return new Promise(() => {}) },
      },
    })
    try {
      assert.equal(engine.respondToRequest('unknown-id', { behavior: 'allow' }), false, 'no such pending ask')
      assert.throws(() => engine.respondToRequest('bad id!', { behavior: 'allow' }), TypeError)
      assert.throws(() => engine.respondToRequest('unknown-id', { behavior: 'allow', extra: true }), TypeError)
      assert.throws(() => engine.respondToRequest('unknown-id', { behavior: 'allow-everything' }), TypeError)
      assert.throws(() => engine.respondToRequest('unknown-id', { behavior: 'answer' }), TypeError, 'answer needs a message')

      const turnPromise = engine.submitTurn({ text: 'ask-granted:read_notes' })
      await once(engine.events, 'permission-ask', { signal: AbortSignal.timeout(20_000) })
      const askId = seen.at(-1).id
      assert.equal(engine.respondToRequest(askId, { behavior: 'allow' }), true)
      const turn = await turnPromise
      assert.equal(turn.ok, true)
      const snap = engine.snapshot().permissions
      assert.equal(snap.hostAllowed, 1)
      assert.equal(snap.hostDenied, 0)
    } finally { await engine.stop() }
  }, { timeout: 120_000 })

  test('missing usage and cost stay unknown; utf8, oversize, split and stray frames are handled', async () => {
    const assistantTexts = [], deltas = []
    const { engine } = await makeEngine('frames', {
      engine: { hooks: { onSettle: () => {} } },
    })
    engine.events.on('assistant', value => assistantTexts.push(value.text))
    engine.events.on('delta', value => deltas.push(value))
    try {
      const noUsage = await engine.submitTurn({ text: 'run without no-usage reporting' })
      assert.equal(noUsage.ok, true)
      assert.equal(noUsage.usage, null)
      assert.equal(noUsage.usageStatus, 'unknown')
      assert.equal(noUsage.costUsd, null)
      assert.equal(noUsage.costStatus, 'unknown')

      const utf8 = await engine.submitTurn({ text: 'give me utf8-multiline text' })
      assert.equal(utf8.ok, true)
      assert.ok(assistantTexts.some(text => text.includes('第一行 🚀') && text.includes('\n')), 'multiline utf8 assistant text survived the wire')
      assert.ok(deltas.some(delta => delta.streamKind === 'assistant_text' && delta.delta.includes('ü')), 'utf8 deltas classified')

      const oversize = await engine.submitTurn({ text: 'send an oversize-legal payload' })
      assert.equal(oversize.ok, true, 'a 200 KB frame inside the frame limit passes through')

      const stray = await engine.submitTurn({ text: 'emit a stray second result' })
      assert.equal(stray.ok, true)
      // The turn settles on the first result; the stray twin may still be in flight
      // through the supervisor pipe, so wait briefly instead of racing it.
      const sawStray = await until(() => {
        const snap = engine.snapshot()
        return snap.frames.results >= 5 && snap.strayResults >= 1 ? snap : null
      }, 10_000)
      assert.ok(sawStray, 'both results of the stray turn were received')
      assert.equal(sawStray.frames.results, 5)
      assert.equal(sawStray.strayResults, 1, 'exactly one stray result was counted and ignored')
    } finally { await engine.stop() }
  }, { timeout: 120_000 })

  test('a model identity mismatch fails the session and closes the engine', async () => {
    const { engine } = await makeEngine('mismatch', { model: 'fixture-mismatch-a' })
    try {
      const outcome = await engine.submitTurn({ text: 'hello' })
        .then(value => ({ settled: true, value }), error => ({ rejected: true, error }))
      const snap = engine.snapshot()
      assert.equal(snap.identity.mismatch, true)
      assert.equal(snap.identity.verification, 'mismatch')
      assert.equal(snap.identity.reportedInitModel, 'fixture-actual-model')
      assert.equal(snap.identity.catalogModel, 'fixture-mismatch-a')
      assert.equal(snap.closed, true, 'a mismatched identity is fatal, never ignored')
      if (outcome.settled) {
        assert.equal(outcome.value.ok, false)
        assert.equal(outcome.value.stopReason, 'model-identity-mismatch')
        assert.equal(outcome.value.outcome, 'failed')
      } else {
        assert.match(outcome.error.message, /ENGINE_STOPPED|ENGINE_MODEL_IDENTITY_MISMATCH/)
      }
      await assert.rejects(() => engine.submitTurn({ text: 'again' }), /ENGINE_STOPPED/)
    } finally { await engine.stop() }
  }, { timeout: 120_000 })

  test('beforeRequest refusal proves zero dispatch; the engine stays usable afterwards', async () => {
    const { engine } = await makeEngine('admission', {
      engine: { hooks: { onBeforeRequest: () => { throw new Error('HOST_REFUSED_BEFORE_REQUEST') } } },
    })
    try {
      await assert.rejects(() => engine.submitTurn({ text: 'anything' }), /HOST_REFUSED_BEFORE_REQUEST/)
      let snap = engine.snapshot()
      assert.equal(snap.turnsDispatched, 0, 'nothing was dispatched')
      assert.equal(snap.launches, 0, 'not even a process was launched')
      assert.equal(snap.process, null)
      assert.equal(snap.closed, false)

      await assert.rejects(() => engine.submitTurn({ text: 'x', sneaky: 'executable' }), /INVALID_TURN_INPUT/)
      await assert.rejects(() => engine.submitTurn({ text: '' }), /INVALID_TURN_TEXT/)
      snap = engine.snapshot()
      assert.equal(snap.turnsDispatched, 0)

      const stopEvidence = await engine.stop()
      assert.equal(stopEvidence.status, 'no-process')
      assert.equal(stopEvidence.treeStopped, false)
      assert.equal(stopEvidence.pid, null)
    } finally { await engine.stop() }
  }, { timeout: 60_000 })

  test('revoking the grant mid-turn settles grant-revoked and stops the whole process tree', async () => {
    const { engine, authority, subject } = await makeEngine('revoke')
    try {
      const turnPromise = engine.submitTurn({ text: 'work slowly' })
      assert.ok(await sawEvent(engine.events, 'delta'), 'the turn really started')
      authority.revoke(subject)
      const turn = await turnPromise
      assert.equal(turn.ok, false)
      assert.equal(turn.stopReason, 'grant-revoked')
      assert.equal(turn.outcome, 'unknown')
      const evidence = await engine.stop()
      assert.equal(evidence.reason, 'grant-revoked')
      assert.equal(evidence.status, 'confirmed', 'launcher accounting confirms the tree stop')
      assert.equal(evidence.treeStopped, true)
      assert.equal(typeof evidence.pid, 'number')
      assert.equal(evidence.stopRequestedIsNotConfirmation, true)
      assert.equal(engine.snapshot().closed, true)
      await assert.rejects(() => engine.submitTurn({ text: 'once more' }), /ENGINE_STOPPED/)
    } finally { await engine.stop() }
  }, { timeout: 120_000 })

  test('host stop mid-turn settles the turn and produces real tree-stop evidence', async () => {
    const closed = []
    const { engine } = await makeEngine('host-stop', { engine: { hooks: { onClose: value => closed.push(value) } } })
    try {
      const turnPromise = engine.submitTurn({ text: 'work slowly' })
      assert.ok(await sawEvent(engine.events, 'delta'), 'the turn really started')
      const evidence = await engine.stop('test-stop')
      const turn = await turnPromise
      assert.equal(turn.ok, false)
      assert.equal(turn.stopReason, 'test-stop')
      assert.equal(turn.outcome, 'unknown')
      assert.equal(evidence.status, 'confirmed')
      assert.equal(evidence.treeStopped, true, 'only launcher accounting may confirm a tree stop')
      assert.equal(evidence.stopRequestedIsNotConfirmation, true)
      assert.equal(typeof evidence.stopRequestedAt, 'number')
      assert.ok(evidence.stopRequestedAt <= evidence.stoppedAt)
      assert.equal(closed.length, 1)
      assert.equal(closed[0].reason, 'test-stop')
      assert.equal(engine.closed, true)
    } finally { await engine.stop() }
  }, { timeout: 120_000 })

  test('an aborted host signal cancels the turn and the tree', async () => {
    const controller = new AbortController()
    const { engine } = await makeEngine('abort', { engine: { signal: controller.signal } })
    try {
      const turnPromise = engine.submitTurn({ text: 'work slowly' })
      assert.ok(await sawEvent(engine.events, 'delta'), 'the turn really started')
      controller.abort()
      const turn = await turnPromise
      assert.equal(turn.ok, false)
      assert.equal(turn.stopReason, 'cancelled')
      assert.equal(turn.outcome, 'cancelled')
      const evidence = await engine.stop()
      assert.equal(evidence.status, 'confirmed')
      assert.equal(evidence.treeStopped, true)
    } finally { await engine.stop() }
  }, { timeout: 120_000 })

  test('a refused resume (error result before init) never replays the earlier task', async () => {
    const { engine, workspace } = await makeEngine('resume-refuse')
    try {
      const first = await engine.submitTurn({ text: 'first turn exit-after-result' })
      assert.equal(first.ok, true)
      const sessionId = first.sessionId
      assert.ok(await waitProcessGone(engine), 'engine noticed the process exit')
      const second = await engine.submitTurn({ text: 'please resume-refuse' })
      assert.equal(second.ok, false)
      assert.equal(second.stopReason, 'resume-refused')
      assert.equal(second.outcome, 'unknown')
      assert.match(second.errorText, /No conversation found/)
      const snap = engine.snapshot()
      assert.equal(snap.resumeRefused, true)
      assert.equal(snap.closed, true)
      assert.equal(snap.turnsDispatched, 2, 'the refused continuation was not silently replayed')
      assert.equal(snap.launches, 2, 'a resume launch did happen')
      // The terminal frame permits immediate retirement: a post-frame diagnostic
      // write may be pre-empted by that correct stop. Assert the pre-frame committed
      // scenario, the actual supervisor stop proof and the new input on the wire.
      const stopped = await engine.stop()
      assert.equal(stopped.treeStopped, true)
      const evidence = await evidenceOf(workspace)
      assert.equal(evidence.argv.resume, sessionId, 'the relaunch really carried --resume with the confirmed id')
      assert.equal(evidence.terminalScenario, 'resume-refused')
      assert.deepEqual(evidence.turns.map(turn => turn.text), ['please resume-refuse'])
    } finally { await engine.stop() }
  }, { timeout: 120_000 })

  test('a vanished resume (exit before any frame) is also a refusal, not a replay', async () => {
    const { engine, workspace } = await makeEngine('resume-vanish')
    try {
      const first = await engine.submitTurn({ text: 'first turn exit-after-result' })
      assert.equal(first.ok, true)
      assert.ok(await waitProcessGone(engine), 'engine noticed the process exit')
      const second = await engine.submitTurn({ text: 'please resume-vanish' })
      assert.equal(second.ok, false)
      assert.equal(second.stopReason, 'resume-refused')
      assert.equal(second.outcome, 'unknown')
      assert.equal(engine.snapshot().resumeRefused, true)
      assert.equal(engine.snapshot().turnsDispatched, 2)
      // No frame is emitted here; the fixture commits the diagnostic before exit.
      await engine.stop()
      const evidence = await evidenceOf(workspace)
      assert.equal(evidence.exited, 'resume-vanished')
    } finally { await engine.stop() }
  }, { timeout: 120_000 })
})

describe('claude engine native turn fence', () => {

  test('a same-tick second submit is refused busy with zero admissions and zero launches', async () => {
    const before = []
    const { engine } = await makeEngine('fence-same-tick', {
      engine: { hooks: { onBeforeRequest: value => { before.push(value) } } },
    })
    try {
      // Two submits in the SAME tick: the first must have reserved the turn slot
      // synchronously, before its first await (the admission hook).
      const first = engine.submitTurn({ text: 'hello fence one' })
      await assert.rejects(() => engine.submitTurn({ text: 'hello fence two' }), /ENGINE_TURN_IN_PROGRESS/)
      const t1 = await first
      assert.equal(t1.ok, true)
      assert.equal(t1.outcome, 'succeeded')
      assert.equal(t1.dispatched, true)
      assert.match(t1.turnId, /^t-[0-9a-f]{16}$/)
      const snap = engine.snapshot()
      assert.equal(before.length, 1, 'the refused submit never reached admission')
      assert.equal(snap.turnsDispatched, 1)
      assert.equal(snap.launches, 1)
      assert.equal(snap.turn, null, 'the completed settlement freed the slot')
      assert.equal(snap.settlementPending, false)

      // The fence refuses without damaging the engine: the next turn is fine.
      const t2 = await engine.submitTurn({ text: 'after the fence' })
      assert.equal(t2.ok, true)
      assert.equal(t2.turnId !== t1.turnId, true)
      assert.equal(t2.operationId, t1.operationId, 'receipts bind to this engine operation')
      assert.equal(t2.operationId, engine.snapshot().operationId)
      assert.equal(before.length, 2)
      assert.equal(engine.snapshot().turnsDispatched, 2)
      assert.equal(engine.snapshot().launches, 1, 'the retained process is reused')
    } finally { await engine.stop() }
  }, { timeout: 120_000 })

  test('the slot is held until settlement completes; stray results during a pending settlement are counted, not applied', async () => {
    let releaseSettle
    const gate = new Promise(resolve => { releaseSettle = resolve })
    const { engine } = await makeEngine('fence-stray-settle', {
      engine: { hooks: { onSettle: async () => { await gate } } },
    })
    try {
      const turnPromise = engine.submitTurn({ text: 'emit a stray second result' })
      // The engine cold-launches its real PowerShell tree here (~15-20s on this
      // machine), and the turn promise is gated behind the settlement below, so
      // the only observable progress signal is the snapshot itself. 60s bounds
      // the causal wait with headroom over the measured launch latency.
      const settling = await until(() => {
        const snap = engine.snapshot()
        return snap.frames.results >= 2 && snap.strayResults >= 1 ? snap : null
      }, 60_000)
      assert.ok(settling, 'both results of the stray scenario arrived')
      assert.equal(settling.strayResults, 1, 'the late twin was counted, never settled anything')
      assert.equal(settling.settlementPending, true, 'settlement is observably pending')
      assert.ok(settling.turn, 'the turn slot is still held')
      assert.equal(settling.turn.phase, 'settling')
      assert.equal(settling.turn.dispatched, true)
      assert.equal(settling.turn.settled, true)

      // Still fenced: a submit while the Host settlement is pending is busy.
      await assert.rejects(() => engine.submitTurn({ text: 'too soon' }), /ENGINE_TURN_IN_PROGRESS/)

      releaseSettle()
      const t1 = await turnPromise
      assert.equal(t1.ok, true, 'the real result settles once, after the Host hook')
      assert.equal(engine.snapshot().turn, null)
      assert.equal(engine.snapshot().settlementPending, false)

      const t2 = await engine.submitTurn({ text: 'after settlement' })
      assert.equal(t2.ok, true, 'the engine is reusable after a completed settlement')
    } finally { releaseSettle?.(); await engine.stop() }
  }, { timeout: 120_000 })

  test('a failing Host settlement hook rejects the turn with evidence and stops the engine; success is never pretended', async () => {
    const turnEvents = [], settleFailures = []
    const { engine } = await makeEngine('fence-settle-reject', {
      engine: {
        hooks: { onSettle: () => { throw new Error('LEDGER_WRITE_FAILED') } },
      },
    })
    engine.events.on('turn', value => turnEvents.push(value))
    engine.events.on('turn-settle-failed', value => settleFailures.push(value))
    try {
      await assert.rejects(() => engine.submitTurn({ text: 'hello settle failure' }), error => {
        assert.match(error.message, /ENGINE_SETTLE_HOOK_FAILED: LEDGER_WRITE_FAILED/)
        assert.equal(error.fundingStatus, 'unknown', 'funding is honestly unknown')
        assert.equal(error.turnResult.ok, true, 'the native evidence is attached untouched')
        assert.equal(error.turnResult.outcome, 'succeeded')
        assert.equal(error.turnResult.costUsd, 0.01)
        assert.match(error.turnResult.turnId, /^t-/)
        assert.equal(error.turnResult.operationId, engine.snapshot().operationId)
        return true
      })
      assert.equal(turnEvents.length, 0, 'the public turn event never fired for a failed settlement')
      assert.equal(settleFailures.length, 1)
      assert.equal(settleFailures[0].turnResult.ok, true)
      assert.match(String(settleFailures[0].error?.message ?? ''), /LEDGER_WRITE_FAILED/)
      const snap = engine.snapshot()
      assert.equal(snap.closed, true, 'the engine stopped: no next turn, no fresh process')
      assert.match(snap.fatalError ?? '', /LEDGER_WRITE_FAILED/)
      await assert.rejects(() => engine.submitTurn({ text: 'again' }), /ENGINE_STOPPED/)
      const evidence = await engine.stop()
      assert.equal(evidence.reason, 'settle-hook-failed')
      assert.equal(evidence.status, 'confirmed', 'the real tree was still stopped with supervisor accounting')
      assert.equal(evidence.treeStopped, true)
      assert.equal(evidence.interruptedLaunches, 0)
    } finally { await engine.stop() }
  }, { timeout: 120_000 })

  test('stop() stops the native tree before waiting on a slow settlement; the pending wait stays observable', async () => {
    let releaseSettle
    const gate = new Promise(resolve => { releaseSettle = resolve })
    const treeStops = []
    const { engine } = await makeEngine('fence-stop-tree-first', {
      engine: { hooks: { onSettle: async () => { await gate } } },
    })
    engine.events.on('tree-stopped', value => treeStops.push({ at: Date.now(), evidence: value }))
    try {
      const turnPromise = engine.submitTurn({ text: 'work slowly' })
      assert.ok(await sawEvent(engine.events, 'delta'), 'the turn really started')
      const stopPromise = engine.stop('fence-stop')
      await once(engine.events, 'tree-stopped', { signal: AbortSignal.timeout(20_000) })

      // The tree is already stopped with supervisor evidence while the Host
      // settlement is still gated: the stop wait cannot hide behind the hook.
      assert.equal(treeStops.length, 1)
      assert.equal(treeStops[0].evidence.reason, 'fence-stop')
      assert.equal(treeStops[0].evidence.status, 'confirmed')
      assert.equal(treeStops[0].evidence.treeStopped, true)
      assert.equal(treeStops[0].evidence.stopRequestedIsNotConfirmation, true)
      assert.ok(treeStops[0].evidence.stopRequestedAt <= treeStops[0].evidence.stoppedAt)
      assert.ok(treeStops[0].evidence.stoppedAt <= Date.now())
      const snap = engine.snapshot()
      assert.equal(snap.settlementPending, true, 'settlement observably pending under the gate')
      assert.equal(snap.process, null, 'the tree is gone even though stop() has not returned')

      releaseSettle()
      const turn = await turnPromise
      assert.equal(turn.ok, false)
      assert.equal(turn.stopReason, 'fence-stop')
      assert.equal(turn.outcome, 'unknown', 'a dispatched-but-unresolved stop stays unknown')
      const evidence = await stopPromise
      assert.equal(evidence.status, 'confirmed')
      assert.equal(engine.snapshot().settlementPending, false)
      assert.equal(engine.snapshot().turn, null)
    } finally { releaseSettle?.(); await engine.stop() }
  }, { timeout: 120_000 })

  test('a failing observation hook is counted and emitted, never a turn or financial outcome', async () => {
    const observeFailures = []
    const { engine } = await makeEngine('fence-observe-fail', {
      engine: { hooks: { onObserve: () => { throw new Error('OBSERVER_DOWN') } } },
    })
    engine.events.on('observe-failed', value => observeFailures.push(value))
    try {
      const turn = await engine.submitTurn({ text: 'hello observe failure' })
      assert.equal(turn.ok, true, 'an observation failure never fails the turn')
      assert.equal(turn.usageStatus, 'reported')
      assert.equal(turn.usage.input, 160)
      closeTo(turn.costUsd, 0.01, 1e-9, 'settlement figures unaffected')
      assert.equal(turn.costStatus, 'cli-reported-running-total-delta')
      const failing = await until(() => engine.snapshot().observeHookFailures === 1 ? engine.snapshot() : null, 10_000)
      assert.ok(failing, 'the observe failure was counted, not swallowed')
      assert.equal(observeFailures.length, 1)
      assert.equal(observeFailures[0].kind, 'session-confirmed')
      assert.match(String(observeFailures[0].error), /OBSERVER_DOWN/)
      assert.equal(failing.observeHookFailures, 1)
      assert.equal(engine.snapshot().closed, false, 'the engine stays open')
    } finally { await engine.stop() }
  }, { timeout: 120_000 })
})

describe('claude engine turn fence (launcher-seam)', () => {

  test('a submit while admission is pending is busy: zero extra admissions, zero launches, one slot', async () => {
    const before = []
    let releaseAdmission
    const admissionGate = new Promise(resolve => { releaseAdmission = resolve })
    const seam = seamLauncher({ onSupervise: supervisor => { supervisor.onSend = () => { setImmediate(() => playSeamTurn(supervisor)) } } })
    const { engine } = await makeEngine('seam-busy-admission', {
      engine: {
        launcher: seam.launcher,
        hooks: { onBeforeRequest: async value => { before.push(value); await admissionGate } },
      },
    })
    try {
      const first = engine.submitTurn({ text: 'seam busy one' })
      assert.ok(await until(() => before.length === 1 ? before : null), 'admission started')
      // Different tick from the fence test, same fence: the slot spans admission.
      await assert.rejects(() => engine.submitTurn({ text: 'seam busy two' }), /ENGINE_TURN_IN_PROGRESS/)
      assert.equal(before.length, 1, 'the refused submit never reached admission')
      assert.equal(seam.supervised.length, 0, 'nothing was launched for either submit yet')

      releaseAdmission()
      const t1 = await first
      assert.equal(t1.ok, true)
      assert.equal(t1.dispatched, true)
      assert.equal(seam.supervised.length, 1, 'exactly one launch served both submits')
      assert.equal(engine.snapshot().turnsDispatched, 1)
    } finally { releaseAdmission?.(); await engine.stop() }
  }, { timeout: 60_000 })

  test('a stop while admission is pending settles not-run with zero launches', async () => {
    let releaseAdmission
    const admissionGate = new Promise(resolve => { releaseAdmission = resolve })
    const started = []
    const seam = seamLauncher()
    const { engine } = await makeEngine('seam-stop-admission', {
      engine: {
        launcher: seam.launcher,
        hooks: { onBeforeRequest: async () => { started.push(Date.now()); await admissionGate } },
      },
    })
    try {
      const turnPromise = engine.submitTurn({ text: 'stopped before admission finishes' })
      assert.ok(await until(() => started.length === 1 ? started : null), 'admission is in flight')
      const stopPromise = engine.stop('admission-stop')
      releaseAdmission()
      const turn = await turnPromise
      assert.equal(turn.ok, false)
      assert.equal(turn.stopReason, 'admission-stop')
      assert.equal(turn.outcome, 'not-run', 'provably nothing was dispatched')
      assert.equal(turn.dispatched, false)
      assert.equal(turn.usage, null, 'no usage is invented for a dispatch that never happened')
      assert.equal(turn.usageStatus, 'unknown')
      assert.equal(turn.costUsd, null)
      assert.equal(turn.costStatus, 'unknown')
      const evidence = await stopPromise
      assert.equal(evidence.status, 'no-process')
      assert.equal(evidence.treeStopped, false)
      assert.equal(evidence.interruptedLaunches, 0)
      assert.equal(seam.supervised.length, 0, 'not even a supervisor was created')
      assert.equal(engine.snapshot().turnsDispatched, 0)
    } finally { releaseAdmission?.(); await engine.stop() }
  }, { timeout: 60_000 })

  test('a failed stdin write settles unknown (may-dispatch), fabricates nothing, and leaves the engine reusable', async () => {
    let failNextSend = true
    const seam = seamLauncher({
      onSupervise: supervisor => {
        supervisor.onSend = () => {
          // The write failure stays synchronous (an EPIPE rejects the write itself).
          // A healthy write delivers frames only AFTER the write completes — a real
          // CLI's result cannot overtake the stdin write callback — so the seam
          // defers playback instead of emitting inside send().
          if (failNextSend) throw new Error('EPIPE: seam stdin broke')
          setImmediate(() => playSeamTurn(supervisor))
        }
      },
    })
    const { engine } = await makeEngine('seam-stdin-fail', { engine: { launcher: seam.launcher } })
    try {
      const turnPromise = engine.submitTurn({ text: 'seam stdin failure' })
      const launched = await until(() => seam.supervised.length === 1 ? seam.supervised[0] : null)
      assert.ok(launched, 'the launch completed and the prompt write was attempted')
      // The pinned entry is the only executable path; the prompt rides stdin.
      assert.equal(launched.spec.executable, process.execPath)
      assert.equal(launched.spec.args[0], FIXTURE)
      assert.ok(launched.spec.args.includes(MODEL))
      const failed = await turnPromise
      assert.equal(failed.ok, false)
      assert.equal(failed.stopReason, 'stdin-write-failed')
      assert.equal(failed.outcome, 'unknown', 'the write failed mid-flight: the CLI may have received it')
      assert.equal(failed.dispatched, false)
      assert.equal(failed.usage, null, 'no fabricated usage for an unresolved dispatch')
      assert.equal(failed.usageStatus, 'unknown')
      assert.equal(failed.costUsd, null, 'cost is not zero: it is unknown')
      assert.equal(failed.costStatus, 'unknown')
      assert.match(failed.turnId, /^t-/)
      assert.equal(engine.snapshot().turnsDispatched, 0, 'a failed write is not a dispatch')
      assert.equal(engine.snapshot().closed, false)

      failNextSend = false
      const second = await engine.submitTurn({ text: 'seam stdin recovered' })
      assert.equal(second.ok, true, 'a may-dispatch failure does not kill the engine')
      assert.equal(second.outcome, 'succeeded')
      assert.equal(second.dispatched, true)
      assert.deepEqual(second.usage, { input: 10, output: 5 })
      closeTo(second.costUsd, 0.01, 1e-9)
      assert.equal(second.turnId !== failed.turnId, true)
      assert.equal(second.operationId, failed.operationId)
      assert.equal(engine.snapshot().turnsDispatched, 1)
      assert.equal(seam.supervised.length, 1, 'the retained process was reused')
    } finally { await engine.stop() }
  }, { timeout: 60_000 })

  test('a grant revoked while a launch is pending settles not-run and ends the launching supervisor (no orphan)', async () => {
    const seam = seamLauncher()
    seam.supervised.options = { gateSpawned: true }
    const { engine, authority, subject } = await makeEngine('seam-revoke-launch', { engine: { launcher: seam.launcher } })
    try {
      const turnPromise = engine.submitTurn({ text: 'revoked while launching' })
      const spawned = await until(() => seam.supervised.length === 1 ? seam.supervised[0].supervisor : null)
      assert.ok(spawned, 'the launch began and is gated at the spawned handshake')
      authority.revoke(subject)
      const turn = await turnPromise
      assert.equal(turn.ok, false)
      assert.equal(turn.stopReason, 'grant-revoked')
      assert.equal(turn.outcome, 'not-run', 'the prompt was never written to any stdin')
      assert.equal(turn.dispatched, false)
      assert.equal(turn.usage, null)
      assert.equal(turn.costUsd, null)
      assert.equal(engine.snapshot().turnsDispatched, 0)
      assert.equal(spawned.marks.endCalls, 1, 'stop() ended the launching supervisor exactly once')
      assert.equal(spawned.marks.killCalls, 0, 'the seam helper accounting exited cleanly; no forced kill was needed')
      assert.equal(spawned.marks.sent.length, 0, 'no prompt ever reached a stdin')
      const evidence = await engine.stop()
      assert.equal(evidence.reason, 'grant-revoked')
      assert.equal(evidence.status, 'no-process', 'nothing was proven spawned: honest status, not confirmed')
      assert.equal(evidence.treeStopped, false)
      assert.equal(evidence.interruptedLaunches, 1, 'the interrupted launch is accounted')
      assert.equal(engine.closed, true)
    } finally { await engine.stop() }
  }, { timeout: 60_000 })

  test('a throwing supervise() settles not-run and releases the bridge lease', async () => {
    const base = createAuthority()
    const counts = { issue: 0, release: 0 }
    // The authority object is frozen, so a Proxy may not substitute wrapped
    // functions (returning a different value for a non-configurable read-only
    // property throws). Delegate through a plain object instead.
    const counting = Object.fromEntries(Object.keys(base).map(key => [key, (...args) => {
      if (key === 'issue') counts.issue++
      if (key === 'release') counts.release++
      return base[key](...args)
    }]))
    const helper = { platform: 'linux', executable: process.execPath, prefix: ['-e', RELAY_SCRIPT] }
    const launcher = {
      probe: async () => ({ available: true, helper, supervisor: 'seam-supervisor' }),
      protect: async () => {},
      supervise: () => { throw new Error('SEAM_SUPERVISE_EXPLODED') },
    }
    const { engine } = await makeEngine('seam-supervise-throw', { authority: counting, engine: { launcher } })
    try {
      const turn = await engine.submitTurn({ text: 'supervise exploded' })
      assert.equal(turn.ok, false)
      assert.equal(turn.stopReason, 'launch-failed')
      assert.equal(turn.outcome, 'not-run', 'the supervisor never came up: provably nothing ran')
      assert.match(turn.errorText, /SEAM_SUPERVISE_EXPLODED/)
      assert.equal(turn.usage, null)
      assert.equal(turn.costUsd, null)
      assert.ok(counts.issue >= 1, 'a bridge lease was taken')
      assert.equal(counts.release, counts.issue, 'the failed launch released every lease it took')
      const snap = engine.snapshot()
      assert.equal(snap.turnsDispatched, 0)
      assert.equal(snap.process, null)
      assert.equal(snap.closed, false, 'a launch failure does not silently kill the engine')
      const evidence = await engine.stop()
      assert.equal(evidence.status, 'no-process')
      assert.equal(evidence.treeStopped, false)
    } finally { await engine.stop() }
  }, { timeout: 60_000 })

  test('a tampered entry script is refused before dispatch and settles not-run', async () => {
    const seam = seamLauncher()
    const home = join(RUNS, 'seam-corrupt')
    await mkdir(home, { recursive: true })
    const scriptPath = join(home, 'mutable-cli.mjs')
    const cliSource = 'process.stdout.write(process.version + String.fromCharCode(10))\n'
    await writeFile(scriptPath, cliSource)
    const entry = { executable: process.execPath, sha256: await sha256(process.execPath), version: process.versions.node, script: scriptPath, scriptSha256: await sha256(scriptPath) }
    const { engine } = await makeEngine('seam-entry-corrupt', { engine: { launcher: seam.launcher, entry } })
    try {
      await writeFile(scriptPath, 'process.stdout.write("tampered")\n')
      const turn = await engine.submitTurn({ text: 'run with a tampered CLI' })
      assert.equal(turn.ok, false)
      assert.equal(turn.stopReason, 'launch-failed')
      assert.equal(turn.outcome, 'not-run')
      assert.match(turn.errorText, /ENGINE_ENTRY_CHANGED/)
      assert.equal(turn.usage, null)
      assert.equal(turn.usageStatus, 'unknown')
      assert.equal(turn.costUsd, null)
      assert.equal(turn.costStatus, 'unknown')
      assert.equal(turn.dispatched, false)
      assert.equal(engine.snapshot().turnsDispatched, 0)
      assert.equal(seam.supervised.length, 0, 'nothing was ever spawned through the changed bytes')
    } finally { await engine.stop() }
  }, { timeout: 60_000 })

  test('a stop during launch ends the fresh supervisor before dispatch: no orphaned tree, not-run turn', async () => {
    const seam = seamLauncher()
    seam.supervised.options = { gateSpawned: true }
    const { engine } = await makeEngine('seam-stop-launch', { engine: { launcher: seam.launcher } })
    try {
      const turnPromise = engine.submitTurn({ text: 'stopped while launching' })
      const supervisor = await until(() => seam.supervised.length === 1 ? seam.supervised[0].supervisor : null)
      assert.ok(supervisor, 'the fresh supervisor exists and is gated before the spawned handshake')
      const stopPromise = engine.stop('launch-stop')
      const turn = await turnPromise
      assert.equal(turn.ok, false)
      assert.equal(turn.stopReason, 'launch-stop')
      assert.equal(turn.outcome, 'not-run')
      assert.equal(turn.dispatched, false)
      assert.equal(turn.usage, null)
      assert.equal(engine.snapshot().turnsDispatched, 0)
      assert.equal(supervisor.marks.endCalls, 1, 'the launch supervisor was ended, not orphaned')
      assert.equal(supervisor.marks.killCalls, 0)
      assert.equal(supervisor.marks.sent.length, 0, 'the prompt was never dispatched')
      const evidence = await stopPromise
      assert.equal(evidence.status, 'no-process')
      assert.equal(evidence.treeStopped, false, 'no launcher accounting may confirm a stop that never proved a spawn')
      assert.equal(evidence.interruptedLaunches, 1)
      assert.equal(evidence.reason, 'launch-stop')
      assert.equal(engine.closed, true)
      await assert.rejects(() => engine.submitTurn({ text: 'once more' }), /ENGINE_STOPPED/)
    } finally { await engine.stop() }
  }, { timeout: 60_000 })

  test('a retained process death settles the later dispatched turn rather than orphaning it', async () => {
    const seam = seamLauncher(), settled = []
    const { engine } = await makeEngine('seam-retained-death', { engine: { launcher: seam.launcher, hooks: { onSettle: value => { settled.push(value) } } } })
    try {
      const first = engine.submitTurn({ text: 'first retained turn' })
      const supervisor = await until(() => seam.supervised[0]?.supervisor ?? null)
      supervisor.onSend = () => { playSeamTurn(supervisor) }
      assert.equal((await first).outcome, 'succeeded')
      supervisor.onSend = () => {}
      const second = engine.submitTurn({ text: 'later turn before process death' })
      assert.ok(await until(() => engine.snapshot().turnsDispatched === 2))
      supervisor.end()
      assert.ok(await until(() => settled.length === 2), 'native process death must settle its current turn without a turn timer or bridge watchdog')
      const result = await second
      assert.equal(result.ok, false)
      assert.equal(result.outcome, 'unknown')
      assert.equal(result.dispatched, true)
      assert.equal(result.usage, null)
      assert.equal(seam.supervised.length, 1)
    } finally { await engine.stop() }
  }, { timeout: 60_000 })

  test('late frames from a dead process generation can never settle the new turn', async () => {
    const seam = seamLauncher()
    seam.supervised.options = {}
    const { engine } = await makeEngine('seam-dead-generation', { engine: { launcher: seam.launcher } })
    try {
      // Turn 1 plays out on generation 1, whose process then exits on its own.
      const first = engine.submitTurn({ text: 'generation one' })
      const gen1 = await until(() => seam.supervised.length === 1 ? seam.supervised[0].supervisor : null)
      gen1.onSend = () => { playSeamTurn(gen1); queueMicrotask(() => gen1.end()) }
      const t1 = await first
      assert.equal(t1.ok, true)
      assert.ok(await until(() => engine.snapshot().process === null ? true : null), 'generation 1 is dead and cleared')

      // Turn 2 launches generation 2 and holds its result back.
      let gen2 = null
      const second = engine.submitTurn({ text: 'generation two' })
      gen2 = await until(() => seam.supervised.length === 2 ? seam.supervised[1].supervisor : null)
      gen2.onSend = () => {}
      await until(() => gen2.marks.sent.length === 1 ? gen2.marks.sent[0] : null)

      // The DEAD generation now delivers a late result and a stale stop control.
      gen1.emit('message', { type: 'result', subtype: 'success', is_error: false, duration_ms: 1, num_turns: 1, result: 'ghost of turn one', session_id: 'ghost', model: MODEL, usage: { input_tokens: 999, output_tokens: 999 }, total_cost_usd: 99 })
      gen1.emit('control', { control: 'stopped', pid: 4711, exitCode: 0, reason: 'late-accounting', containment: 'seam-job-object', treeStopped: true })
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(engine.snapshot().turnsDispatched, 2, 'turn 2 dispatched on the live generation')
      assert.equal(engine.snapshot().frames.results, 1, 'the dead generation\'s result was not even counted')

      // Only generation 2's own result may settle turn 2.
      playSeamTurn(gen2)
      const t2 = await second
      assert.equal(t2.ok, true)
      assert.equal(t2.usage.input, 10, 'turn 2 keeps its own usage, not the ghost\'s 999')
      closeTo(t2.costUsd, 0.01, 1e-9)
      assert.equal(engine.snapshot().frames.results, 2)
      assert.equal(engine.snapshot().strayResults, 0, 'dead-generation frames are dropped at the state gate, before stray accounting')
    } finally { await engine.stop() }
  }, { timeout: 60_000 })
})
