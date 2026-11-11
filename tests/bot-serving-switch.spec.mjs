import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createBotServing } from '../packages/orchestration/src/bot-serving.mjs'
import { createBotThreadAdmission } from '../packages/orchestration/src/bot-thread-admission.mjs'
import { openRuntimeSwitch } from '../packages/orchestration/src/bot-runtime-switch.mjs'
import { createIndependentRuntime } from '../packages/orchestration/src/bot-runtime-assembly.mjs'

// The move race, at the seam that decides it: one shared admission, one switch, and the
// synchronous re-check that stands directly in front of the write.

const root = resolve(import.meta.dirname, '..')
const scratch = resolve(root, 'tmp/integration/bot-serving')
await mkdir(scratch, { recursive: true })
const home = await mkdtemp(join(scratch, 'switch-'))

const withRuntime = async (options = {}) => {
  const dir = await mkdtemp(join(home, 'runtime-'))
  const switchFile = join(dir, 'runtime-switch.json')
  const switchApi = openRuntimeSwitch({ file: switchFile, now: () => 1 })
  const serving = createBotServing({ modeOf: botId => switchApi.modeOf(botId) })
  const runtime = createIndependentRuntime({
    dir,
    integration: async () => ({ answer: 'from-the-harness' }),
    providerFor: () => options.provider ?? (async () => ({ text: 'from-the-loop' })),
    serving,
    now: () => 1,
    ...(options.isBusy ? { isBusy: options.isBusy } : {}),
  })
  return { dir, switchFile, switchApi, serving, runtime }
}

test('the lease counts a whole turn, and a move is refused while it runs', async () => {
  let release
  const gate = new Promise(done => { release = done })
  const { runtime, serving } = await withRuntime({ provider: async () => { await gate; return { text: 'late' } } })
  await runtime.move('b', 'independent')
  const turn = runtime.turn({ botId: 'b', input: 'hello' })
  // The whole turn, tools included, is one lease.
  assert.deepEqual(serving.busyBots(), ['b'])
  await assert.rejects(() => runtime.move('b', 'integration'), error => error.code === 'BOT_BUSY')
  assert.equal(runtime.describe('b').runtime, 'independent', 'the refused move left the switch alone')
  // A second turn on the same Bot is refused too: one writer.
  await assert.rejects(() => runtime.turn({ botId: 'b', input: 'again' }), error => error.code === 'BOT_BUSY')
  release()
  assert.equal((await turn).answer, 'late')
  assert.deepEqual(serving.busyBots(), [], 'the lease is released when the turn answers')
  assert.deepEqual(await runtime.move('b', 'integration'), { botId: 'b', mode: 'integration', previous: 'independent', changed: true })
})

test('a failed or cancelled turn releases its lease, so the Bot can be moved afterwards', async () => {
  const failing = await withRuntime({ provider: async () => { throw Object.assign(new Error('provider exploded'), { code: 'PROVIDER_FAILED' }) } })
  await failing.runtime.move('b', 'independent')
  await assert.rejects(() => failing.runtime.turn({ botId: 'b', input: 'boom' }), error => error.code === 'PROVIDER_FAILED')
  assert.deepEqual(failing.serving.busyBots(), [], 'a failed turn leaves nothing behind')
  assert.deepEqual(await failing.runtime.move('b', 'integration'), { botId: 'b', mode: 'integration', previous: 'independent', changed: true })

  const cancelled = await withRuntime({ provider: async ({ }, ) => { const error = new Error('cancelled'); error.code = 'BOT_LOOP_CANCELLED'; throw error } })
  await cancelled.runtime.move('b', 'independent')
  await assert.rejects(() => cancelled.runtime.turn({ botId: 'b', input: 'stop', signal: AbortSignal.abort() }), error => error.code === 'BOT_LOOP_CANCELLED')
  assert.deepEqual(cancelled.serving.busyBots(), [], 'a cancelled turn leaves nothing behind')
  assert.equal((await cancelled.runtime.move('b', 'integration')).changed, true)
})

test('the final synchronous check blocks a move that the asynchronous one let through', async () => {
  // The classic race: the busy probe awaits, and a turn is admitted while it is in flight. The
  // check before the write is synchronous, so the commit is still refused.
  let admitted = false
  const { runtime, serving, switchApi } = await withRuntime({
    isBusy: async () => { await Promise.resolve(); await Promise.resolve(); admitted = true; return false },
  })
  assert.equal(switchApi.modeOf('b'), 'integration')
  // The probe will say "idle" — it is a stale reader — while the lease says otherwise.
  const lease = serving.enter('b')
  assert.equal(admitted, false, 'the probe has not run yet')
  await assert.rejects(() => runtime.move('b', 'independent'), error => error.code === 'BOT_BUSY')
  assert.equal(switchApi.modeOf('b'), 'integration', 'nothing was written')
  lease.release()
  assert.equal((await runtime.move('b', 'independent')).changed, true)
})

test('a Bot the frozen runtime is mid-turn on is busy before any model chunk', async () => {
  const dir = await mkdtemp(join(home, 'native-'))
  const switchApi = openRuntimeSwitch({ file: join(dir, 'runtime-switch.json'), now: () => 1 })
  // The runtime's own record: one Session has started a turn, another only has a queued step.
  const rt = {
    live: new Map([['b', { turn: 3 }], ['queued', { pending: { id: 'x' } }], ['idle', {}]]),
    selfOf: sessionId => (sessionId === 'queued' ? 'c' : sessionId === 'b' ? 'b' : 'nobody'),
  }
  const serving = createBotServing({ modeOf: botId => switchApi.modeOf(botId), rt })
  assert.deepEqual(serving.busyBots(), ['b', 'c'])
  assert.equal(serving.busy('b'), true)
  assert.equal(serving.busy('nobody'), false)
  assert.throws(() => serving.assertIdle('b'), error => error.code === 'BOT_BUSY')
  assert.equal(serving.assertIdle('other'), true)
})

test('a mode that cannot be read refuses on both paths instead of defaulting to integration', async t => {
  const { serving } = await withRuntime({})
  const broken = createBotServing({ modeOf: () => { throw Object.assign(new Error('RUNTIME_SWITCH_SCHEMA'), { code: 'RUNTIME_SWITCH_SCHEMA' }) } })
  assert.throws(() => broken.assertMode('b', 'integration'), error => error.code === 'SERVING_MODE_UNKNOWN')
  assert.throws(() => broken.assertMode('b', 'independent'), error => error.code === 'SERVING_MODE_UNKNOWN')
  assert.equal(serving.assertMode('b', 'integration'), 'integration')
  assert.throws(() => serving.assertMode('b', 'independent'), error => error.code === 'RUNTIME_MODE_MISMATCH')
  // A switch that answers with something that is not a mode is the same doubt.
  const nonsense = createBotServing({ modeOf: () => 'sideways' })
  assert.throws(() => nonsense.assertMode('b', 'integration'), error => error.code === 'SERVING_MODE_UNKNOWN')
  // No switch installed at all: every Bot is on the integration path, and that is stated, not assumed.
  const none = createBotServing({})
  assert.equal(none.assertMode('anything', 'integration'), 'integration')
})

test('a Bot moved by another writer stops the independent turn at its next step', async () => {
  const dir = await mkdtemp(join(home, 'steps-'))
  const switchFile = join(dir, 'runtime-switch.json')
  const switchApi = openRuntimeSwitch({ file: switchFile, now: () => 1 })
  const other = openRuntimeSwitch({ file: switchFile, now: () => 1 })
  const serving = createBotServing({ modeOf: botId => switchApi.modeOf(botId) })
  let steps = 0
  const runtime = createIndependentRuntime({
    dir,
    integration: async () => ({ answer: 'from-the-harness' }),
    providerFor: () => async () => {
      steps += 1
      // Step one asks for a tool, which keeps the turn open; the move happens in between.
      return steps === 1 ? { text: 'working', toolCalls: [{ id: 'c1', name: 'noop', args: {} }] } : { text: 'done' }
    },
    serving,
    now: () => 1,
  })
  const tools = { call: async () => { await other.move('b', 'integration'); return { ok: true } } }
  // The loop's tools come from the factory, so the move is injected through it.
  const moved = createIndependentRuntime({
    dir,
    integration: async () => ({ answer: 'from-the-harness' }),
    providerFor: () => async () => (steps += 1) === 1 ? { text: 'working', toolCalls: [{ id: 'c1', name: 'noop', args: {} }] } : { text: 'done' },
    toolsFor: () => tools,
    serving,
    now: () => 1,
  })
  await runtime.move('b', 'independent')
  await assert.rejects(() => moved.turn({ botId: 'b', input: 'go' }), error => error.code === 'RUNTIME_MODE_MISMATCH')
  assert.equal(switchApi.modeOf('b'), 'integration', 'the other writer committed the move')
  assert.deepEqual(serving.busyBots(), [], 'the refused turn released its lease')
  // And the turn that is still asked for on the integration path is served there.
  assert.equal((await moved.turn({ botId: 'b', input: 'go' })).runtime, 'integration')
})

test('a request that pins the other runtime is refused, and the switch file is the only witness', async () => {
  const { runtime, switchApi } = await withRuntime({})
  await assert.rejects(() => runtime.turn({ botId: 'b', input: 'x', runtime: 'independent' }), error => error.code === 'RUNTIME_MODE_MISMATCH')
  assert.equal(switchApi.modeOf('b'), 'integration')
  await runtime.move('b', 'independent')
  await assert.rejects(() => runtime.turn({ botId: 'b', input: 'x', runtime: 'integration' }), error => error.code === 'RUNTIME_MODE_MISMATCH')
})

test('the thread admission answers three questions and invents no identity', async () => {
  const catalog = {
    threadBySession: sessionId => (sessionId === 't1' ? { botId: 'b', threadId: 'th1' } : null),
    assertSendable: ({ botId, threadId }) => {
      if (botId === 'gone') throw Object.assign(new Error('BOT_NOT_COMMITTED'), { code: 'BOT_NOT_COMMITTED' })
      return { ok: true, botId, threadId, sessionId: 't1' }
    },
  }
  const admission = createBotThreadAdmission({ threads: catalog, nativeThreadOf: id => (id === 'orphan' ? { botId: 'b', threadId: 'th2' } : null) })
  assert.deepEqual(admission.admit(undefined), { kind: 'absent' })
  assert.deepEqual(admission.admit('plain'), { kind: 'unbound' }, 'an unclaimed Session is an ordinary Harness session')
  assert.deepEqual(admission.admit('t1'), { kind: 'thread', botId: 'b', threadId: 'th1', sessionId: 't1', grantVerified: false })
  // A live thread the catalog cannot confirm is refused, never handed to the bypass.
  assert.throws(() => admission.admit('orphan'), error => error.code === 'BOT_THREAD_UNVERIFIED')
  // A refusal from the gate itself propagates with its own code.
  const refusing = createBotThreadAdmission({ threads: { ...catalog, threadBySession: () => ({ botId: 'gone', threadId: 'th9' }) }, nativeThreadOf: () => null })
  assert.throws(() => refusing.admit('t1'), error => error.code === 'BOT_NOT_COMMITTED')
  // No catalog at all, and no live thread: still an ordinary session, not a Bot one.
  const bare = createBotThreadAdmission({ threads: null, nativeThreadOf: () => null })
  assert.deepEqual(bare.admit('plain'), { kind: 'unbound' })
  const unready = createBotThreadAdmission({ threads: () => null, nativeThreadOf: id => (id === 't1' ? { botId: 'b', threadId: 'th1' } : null) })
  assert.throws(() => unready.admit('t1'), error => error.code === 'BOT_THREAD_ADMISSION_UNAVAILABLE')
})

test('a lease is released exactly once, and a Host never stays busy forever', async () => {
  const serving = createBotServing({ now: () => 1 })
  const first = serving.enter('b')
  const second = serving.enter('b')
  assert.deepEqual(serving.leases(), [{ botId: 'b', count: 2, since: 1 }])
  first.release()
  first.release()
  assert.deepEqual(serving.leases(), [{ botId: 'b', count: 1, since: 1 }], 'a second release is a no-op')
  second.release()
  assert.deepEqual(serving.leases(), [])
  assert.deepEqual(serving.busyBots(), [])
  assert.throws(() => serving.enter('not a bot id'), error => error.code === 'INVALID_BOT_ID')
})
