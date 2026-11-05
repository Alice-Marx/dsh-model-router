import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { WebSocketServer } from 'ws'
import { createBotRoutineStore } from '../packages/orchestration/src/bot-routine-store.mjs'
import { createRoutineDesktopSession } from '../packages/orchestration/src/routine-session.mjs'
import { createRoutineExecutionService } from '../packages/orchestration/src/routine-execution.mjs'
import { createAcknowledgedRoutineRecorder } from '../apps/integration-client/routine-recorder.mjs'

const base = fileURLToPath(new URL('../tmp/integration/', import.meta.url))
const display = { displayId: 'monitor-primary', width: 800, height: 600, dpi: 96, coordinateSpace: 'display-physical-pixels' }
const bot = { botId: 'bot-a' }
const text = value => ({ type: 'text', text: value })
const input = event => ({ action: 'input', event, delayMs: 0 })
const code = expected => failure => failure.code === expected

async function fixture(t, options = {}) {
  mkdirSync(base, { recursive: true })
  const store = createBotRoutineStore({ dir: mkdtempSync(join(base, 'routine-workflow-')) })
  const sessions = new Map(), effects = [], wire = [], identities = [], held = new Set(), closes = []
  let sessionNumber = 0, inputNumber = 0, renewing = 0
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(resolve => server.once('listening', resolve))
  const url = `ws://127.0.0.1:${server.address().port}/desktop/v1/socket`
  server.on('connection', socket => {
    let row
    const send = value => { if (socket.readyState === 1) socket.send(JSON.stringify(value)) }
    socket.on('message', bytes => {
      const packet = JSON.parse(bytes.toString()); wire.push(packet)
      if (packet.type === 'auth') {
        row = sessions.get(packet.sessionId)
        if (!row || packet.token !== row.token) { socket.close(); return }
        row.socket = socket; row.mode = 'watch'
        send({ type: 'ready', mode: 'watch', ...display, ...(options.display ?? {}), displays: [{ id: display.displayId, width: display.width, height: display.height }] })
      } else if (packet.type === 'control') {
        row.mode = packet.action === 'acquire' ? 'control' : 'watch'; if (row.mode === 'watch') held.clear()
        send({ type: 'control', mode: row.mode })
      } else if (packet.type === 'input') {
        assert.equal(row.mode, 'control'); inputNumber++
        if (options.failAt === inputNumber) { send({ type: 'input', id: packet.id, ok: false, code: 'NATIVE_REJECTED', possiblyApplied: false }); return }
        const event = packet.event; effects.push({ sessionId: row.sessionId, event })
        if (event.type === 'key' || event.type === 'pointer') {
          const key = event.type === 'key' ? event.code : event.button
          if (event.action === 'down') held.add(key); else if (event.action === 'up') held.delete(key)
        }
        if (options.disconnectAt === inputNumber) { socket.close(); return }
        if (options.loseAt === inputNumber) return
        const ack = () => send({ type: 'input', id: packet.id, ok: true })
        if (options.ackDelay) setTimeout(ack, options.ackDelay); else ack()
      } else if (packet.type === 'release-input') { held.clear(); send({ type: 'release-input', id: packet.id, ok: true }) }
      else if (packet.type === 'close') { held.clear(); socket.close() }
    })
  })
  t.after(async () => { for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)) })
  const machines = {
    async desktopSession(subject, request, context) {
      assert.equal(subject.botId, 'bot-a'); assert.equal(request.mode, 'watch'); assert.ok((options.machines ?? ['machine-a']).includes(request.machineId)); assert.equal(request.rootId, 'project')
      const row = { sessionId: `desktop-${++sessionNumber}`, token: 'short-lived-ticket', expiresAt: Date.now() + 60_000, websocketUrl: url, canControl: true }
      sessions.set(row.sessionId, row); identities.push(context); return row
    },
    async renewDesktopSession(_subject, { sessionId }) {
      renewing++; if (options.failRenewal) throw new Error('GRANT_REVOKED')
      return { ...sessions.get(sessionId), socket: undefined, expiresAt: Date.now() + 60_000 }
    },
    async closeDesktopSession(_subject, { sessionId }) {
      await options.beforeClose?.(sessionId)
      held.clear(); sessions.get(sessionId)?.socket?.close(); closes.push(sessionId)
      return { stopConfirmed: options.stopConfirmed !== false }
    },
  }
  const service = () => createRoutineExecutionService({ machines, store, botIdForSubject: subject => subject.botId, ackTimeoutMs: 80, ...options.service })
  const run = (runner, routineId, extra = {}) => runner.run({ subject: bot, botId: bot.botId, routineId, machineId: 'machine-a', rootId: 'project', context: { kind: 'owner' }, ...extra })
  return { store, machines, service, run, effects, wire, held, identities, sessions, closes, get renewing() { return renewing } }
}

test('real WebSocket: demonstrate acknowledged desktop input, save privately, replay actual effects with audit identity', async t => {
  const f = await fixture(t), recorder = createAcknowledgedRoutineRecorder()
  const ticket = await f.machines.desktopSession(bot, { machineId: 'machine-a', rootId: 'project', mode: 'watch' }, { kind: 'owner' })
  const session = createRoutineDesktopSession({ ticket, ackTimeoutMs: 500,
    closeTicket: sessionId => f.machines.closeDesktopSession(bot, { sessionId }),
    onBeforeInput: (event, meta) => recorder.inputSent(event, meta),
    onAcknowledgedInput: (event, meta) => recorder.inputAcknowledged(event, meta),
    onInputFailure: (event, meta) => recorder.inputFailed(event, meta),
  })
  const metadata = await session.ready; await session.acquire()
  recorder.start({ sessionId: ticket.sessionId, mode: session.mode, metadata })
  const events = [{ type: 'pointer', action: 'down', x: 35, y: 20, button: 'left' },
    { type: 'pointer', action: 'up', x: 40, y: 25, button: 'left' }, text('日报 2026-11-05'),
    { type: 'key', action: 'down', code: 'Enter', key: 'Enter' }, { type: 'key', action: 'up', code: 'Enter', key: 'Enter' }]
  for (const event of events) await session.input(event)
  const released = await session.releaseInput(); recorder.released({ sessionId: ticket.sessionId, ok: released.ok })
  const saved = f.store.save('bot-a', recorder.finish({ name: '日报演示' }))
  await session.close()
  assert.equal(saved.recording.acknowledgedInputs, events.length); assert.equal(f.store.list('bot-b').length, 0)
  assert.deepEqual(f.store.get('bot-a', saved.id).recording.display, display)
  const runner = f.service(), report = await f.run(runner, saved.id)
  assert.equal(report.status, 'succeeded'); assert.equal(report.stoppedAt, null); assert.equal(report.cleanup.stopConfirmed, true)
  assert.deepEqual(f.effects.filter(row => row.sessionId === report.sessionId).map(row => row.event), events)
  assert.deepEqual(report.steps, [0, 1, 2, 3, 4]); assert.equal(report.evidence.length, events.length)
  assert.ok(report.evidence.every(item => item.status === 'acknowledged' && item.operationId && item.acknowledgedAt >= item.sentAt))
  assert.equal(f.identities[1].taskId, report.taskId); assert.equal(f.identities[1].attemptId, report.attemptId)
  assert.equal(f.held.size, 0); assert.equal(runner.history('bot-a').length, 1)
  assert.ok(!JSON.stringify(report.evidence).includes('日报'))
})

test('real WebSocket: hundreds of mouse ACKs plus drag/click/text save below the limit and replay their sampled effects', async t => {
  const f = await fixture(t), recorder = createAcknowledgedRoutineRecorder(), sent = []
  const ticket = await f.machines.desktopSession(bot, { machineId: 'machine-a', rootId: 'project', mode: 'watch' }, { kind: 'owner' })
  const session = createRoutineDesktopSession({ ticket, ackTimeoutMs: 500,
    closeTicket: sessionId => f.machines.closeDesktopSession(bot, { sessionId }),
    onBeforeInput: (event, meta) => { sent.push({ event, at: meta.sentAt }); recorder.inputSent(event, meta) },
    onAcknowledgedInput: (event, meta) => recorder.inputAcknowledged(event, meta),
    onInputFailure: (event, meta) => recorder.inputFailed(event, meta),
  })
  const metadata = await session.ready; await session.acquire()
  recorder.start({ sessionId: ticket.sessionId, mode: session.mode, metadata })
  const move = x => ({ type: 'pointer', action: 'move', x, y: 100, button: 'left' })
  for (let index = 0; index < 225; index++) await session.input(move(index))
  await session.input({ type: 'pointer', action: 'down', x: 224, y: 100, button: 'left' })
  for (let index = 225; index < 450; index++) await session.input(move(index))
  await session.input({ type: 'pointer', action: 'up', x: 449, y: 100, button: 'left' })
  await session.input(text('after mouse'))
  await session.input({ type: 'key', action: 'down', code: 'Enter', key: 'Enter' }); await session.input({ type: 'key', action: 'up', code: 'Enter', key: 'Enter' })
  const released = await session.releaseInput(); recorder.released({ sessionId: ticket.sessionId, ok: released.ok })
  const saved = f.store.save('bot-a', recorder.finish({ name: 'mouse sampling' })); await session.close()
  assert.ok(saved.steps.length < 200); assert.equal(saved.recording.observedInputs, 455); assert.equal(saved.recording.pointerSampleMs, 200)
  assert.equal(saved.steps.reduce((sum, step) => sum + step.delayMs, 0), sent.at(-1).at - sent[0].at)
  const report = await f.run(f.service(), saved.id)
  assert.equal(report.status, 'succeeded'); assert.equal(report.evidence.length, saved.steps.length)
  assert.deepEqual(f.effects.filter(item => item.sessionId === report.sessionId).map(item => item.event), saved.steps.map(step => step.event))
  const nonMove = event => event.type !== 'pointer' || event.action !== 'move'
  assert.deepEqual(saved.steps.map(step => step.event).filter(nonMove), sent.map(item => item.event).filter(nonMove))
  assert.equal(f.held.size, 0)
})

test('real WebSocket: explicit native rejection stops the next step, releases held input, reports failed', async t => {
  const f = await fixture(t, { failAt: 2 }), runner = f.service()
  const saved = f.store.save('bot-a', { name: 'fail', steps: [input({ type: 'key', action: 'down', code: 'ShiftLeft', key: 'Shift' }), input(text('blocked')), input(text('never'))] })
  const result = await f.run(runner, saved.id)
  assert.equal(result.status, 'failed'); assert.equal(result.stoppedAt, 1); assert.deepEqual(result.steps, [0])
  assert.equal(result.code, 'NATIVE_REJECTED'); assert.deepEqual(f.effects.map(row => row.event.type), ['key'])
  assert.deepEqual(result.evidence.map(row => row.status), ['acknowledged', 'failed']); assert.equal(f.held.size, 0)
  assert.equal(result.cleanup.inputReleased, true); assert.equal(result.cleanup.stopConfirmed, true)
})

test('real WebSocket: a lost native ACK is unknown, applied once, persisted, and cannot be blindly replayed', async t => {
  const f = await fixture(t, { loseAt: 2 }), runner = f.service()
  const saved = f.store.save('bot-a', { name: 'unknown', steps: [input(text('first')), input(text('once')), input(text('never'))] })
  const result = await f.run(runner, saved.id)
  assert.equal(result.status, 'unknown'); assert.equal(result.stoppedAt, 1); assert.equal(result.code, 'ROUTINE_ACK_LOST')
  assert.deepEqual(f.effects.map(row => row.event.text), ['first', 'once']); assert.equal(result.evidence[1].status, 'unknown')
  await assert.rejects(f.run(runner, saved.id), code('ROUTINE_RECONCILIATION_REQUIRED'))
  const afterRestart = f.service(); await assert.rejects(f.run(afterRestart, saved.id), code('ROUTINE_RECONCILIATION_REQUIRED'))
  assert.throws(() => afterRestart.resolve('bot-a', result.runId, 'checked', { kind: 'bot' }), code('REMOTE_OWNER_REQUIRED'))
  afterRestart.resolve('bot-a', result.runId, '检查电脑：第二条已填写，已恢复起始界面。', { kind: 'owner' })
  assert.equal(afterRestart.get('bot-a', result.runId).status, 'unknown'); assert.ok(afterRestart.get('bot-a', result.runId).resolvedAt)
  assert.equal(f.effects.length, 2, 'inspection never causes an automatic replay')
})

test('real WebSocket: disconnect after applying an input remains unknown', async t => {
  const f = await fixture(t, { disconnectAt: 1 }), saved = f.store.save('bot-a', { name: 'disconnect', steps: [input(text('once')), input(text('never'))] })
  const result = await f.run(f.service(), saved.id)
  assert.equal(result.status, 'unknown'); assert.equal(result.stoppedAt, 0); assert.equal(f.effects.length, 1)
})

test('real WebSocket: cancellation between acknowledged steps stops cleanly and releases keys', async t => {
  const f = await fixture(t), controller = new AbortController(), runner = f.service()
  const saved = f.store.save('bot-a', { name: 'cancel', steps: [input({ type: 'key', action: 'down', code: 'ShiftLeft', key: 'Shift' }), input(text('never'))] })
  const result = await f.run(runner, saved.id, { signal: controller.signal, onStep: () => controller.abort() })
  assert.equal(result.status, 'cancelled'); assert.equal(result.stoppedAt, 1); assert.equal(f.effects.length, 1); assert.equal(f.held.size, 0)
})

test('real WebSocket: cancelling an input already sent is unknown and never retries it', async t => {
  const f = await fixture(t, { ackDelay: 40 }), controller = new AbortController()
  const saved = f.store.save('bot-a', { name: 'in-flight cancel', steps: [input(text('once')), input(text('never'))] })
  const pending = f.run(f.service(), saved.id, { signal: controller.signal })
  const deadline = Date.now() + 1_000
  while (!f.effects.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1))
  assert.equal(f.effects.length, 1); controller.abort()
  const result = await pending
  assert.equal(result.status, 'unknown'); assert.equal(result.stoppedAt, 0); assert.equal(result.evidence[0].status, 'unknown')
  assert.equal(f.effects.length, 1); assert.equal(result.cleanup.stopConfirmed, true)
})

test('real WebSocket: legacy click/type/key/scroll/wait routines use acknowledged full-desktop input', async t => {
  const f = await fixture(t)
  const saved = f.store.save('bot-a', { name: 'legacy', steps: [{ action: 'click', x: 10, y: 20 }, { action: 'type', text: 'legacy' },
    { action: 'key', key: 'Enter', modifiers: ['ctrl'] }, { action: 'scroll', delta: -120 }, { action: 'wait', ms: 1 }] })
  const result = await f.run(f.service(), saved.id)
  assert.equal(result.status, 'succeeded'); assert.equal(result.steps.length, 5)
  assert.deepEqual(f.effects.map(row => row.event.type), ['pointer', 'pointer', 'text', 'key', 'key', 'key', 'key', 'wheel'])
  assert.equal(result.evidence.length, 8); assert.equal(f.held.size, 0)
})

test('real WebSocket: changed recorded display geometry refuses all inputs', async t => {
  const f = await fixture(t, { display: { width: 1_024 } })
  const saved = f.store.save('bot-a', { name: 'geometry', steps: [input(text('never'))], recording: { source: 'desktop-session', display, recordedAt: 1, durationMs: 10, acknowledgedInputs: 1 } })
  const result = await f.run(f.service(), saved.id)
  assert.equal(result.status, 'failed'); assert.equal(result.code, 'ROUTINE_DISPLAY_CHANGED'); assert.equal(f.effects.length, 0)
})

test('real WebSocket: authorization is renewed during a routine without reconnecting the desktop', async t => {
  const f = await fixture(t, { service: { renewEveryMs: 15 } }), saved = f.store.save('bot-a', { name: 'renew', steps: [{ action: 'wait', ms: 55 }, input(text('after renewal'))] })
  const result = await f.run(f.service(), saved.id)
  assert.equal(result.status, 'succeeded'); assert.ok(f.renewing >= 2); assert.equal(f.wire.filter(row => row.type === 'auth').length, 1)
})

test('host interruption and corrupt execution journal cannot erase uncertain prior work', async t => {
  const f = await fixture(t), saved = f.store.save('bot-a', { name: 'crash', steps: [input(text('once'))] })
  const begun = f.store.beginRun('bot-a', { routineId: saved.id, machineId: 'machine-a', rootId: 'project' })
  f.store.inputSent('bot-a', begun.runId, { id: 1, stepIndex: 0, sessionId: 'session-old', sentAt: 1, eventType: 'text' })
  const restarted = f.service()
  assert.equal(restarted.get('bot-a', begun.runId).status, 'unknown'); assert.equal(restarted.get('bot-a', begun.runId).evidence[0].status, 'unknown')
  await assert.rejects(f.run(restarted, saved.id), code('ROUTINE_RECONCILIATION_REQUIRED'))
  writeFileSync(f.store.executionsFile, '{broken')
  assert.throws(() => f.service(), code('ROUTINE_RUN_STORE_CORRUPT'))
})

test('host rejects a caller attempting to run another Bot private routine', async t => {
  const f = await fixture(t), saved = f.store.save('bot-b', { name: 'private', steps: [input(text('never'))] })
  await assert.rejects(f.service().run({ subject: bot, botId: 'bot-b', routineId: saved.id, machineId: 'machine-a', rootId: 'project' }), code('ROUTINE_BOT_DENIED'))
  assert.equal(f.effects.length, 0)
})

test('Host close fences new runs, cancels all active machines, and awaits native release plus Host close confirmation', async t => {
  let confirmClose
  const closeGate = new Promise(resolve => { confirmClose = resolve })
  const f = await fixture(t, { machines: ['machine-a', 'machine-b'], beforeClose: () => closeGate }), runner = f.service()
  const saved = f.store.save('bot-a', { name: 'shutdown', steps: [input({ type: 'key', action: 'down', code: 'ShiftLeft', key: 'Shift' }),
    { action: 'wait', ms: 60_000 }, input(text('never'))] })
  const first = f.run(runner, saved.id), second = f.run(runner, saved.id, { machineId: 'machine-b' })
  const deadline = Date.now() + 1_000
  while (runner.history('bot-a').filter(row => row.steps.length === 1).length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1))
  assert.equal(runner.history('bot-a').filter(row => row.steps.length === 1).length, 2)
  let shutdownFinished = false
  const shutdown = runner.close(); shutdown.then(() => { shutdownFinished = true })
  assert.equal(runner.close(), shutdown, 'shutdown is idempotent and shares its completion promise')
  await assert.rejects(f.run(runner, saved.id), code('ROUTINE_EXECUTION_CLOSED'))
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(shutdownFinished, false); assert.equal(f.closes.length, 0, 'machine services must stay alive until the Host confirms both closes')
  assert.equal(f.held.size, 0, 'native input release happens before Host close completes')
  confirmClose()
  const result = await shutdown, reports = await Promise.all([first, second])
  assert.equal(result.stopConfirmed, true); assert.equal(result.results.length, 2); assert.equal(f.closes.length, 2)
  assert.ok(reports.every(row => row.status === 'cancelled' && row.cleanup.stopConfirmed === true))
  assert.equal(f.effects.length, 2); assert.ok(runner.history('bot-a').every(row => row.status === 'cancelled'))
})

test('Host close preserves an in-flight unknown input and an unconfirmed remote close', async t => {
  const f = await fixture(t, { loseAt: 1, stopConfirmed: false }), runner = f.service()
  const saved = f.store.save('bot-a', { name: 'uncertain shutdown', steps: [input(text('once')), input(text('never'))] })
  const execution = f.run(runner, saved.id), deadline = Date.now() + 1_000
  while (!f.effects.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1))
  assert.equal(f.effects.length, 1)
  const shutdown = await runner.close(), report = await execution
  assert.equal(shutdown.stopConfirmed, false); assert.equal(shutdown.results[0].status, 'unknown')
  assert.equal(report.status, 'unknown'); assert.equal(report.evidence[0].status, 'unknown'); assert.equal(report.cleanup.stopConfirmed, false)
  assert.equal(f.effects.length, 1)
  await assert.rejects(f.run(f.service(), saved.id), code('ROUTINE_RECONCILIATION_REQUIRED'))
})
