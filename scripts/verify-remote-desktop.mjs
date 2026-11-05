import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { WebSocket } from 'ws'
import { RemoteAgentClient } from '../remote-computer-agent/dist/index.mjs'

// Explicitly prepared synthetic fixture only. Never point this at an ordinary user session.
const args = process.argv.slice(2)
const option = name => args[args.indexOf(name) + 1]
assert.ok(args.includes('--pairing') && args.includes('--synthetic-fixture'), 'Usage: --pairing <private file> --synthetic-fixture [--out <directory>]')
const pair = JSON.parse(await readFile(resolve(option('--pairing')), 'utf8'))
const dir = resolve(args.includes('--out') ? option('--out') : 'tmp/integration/remote-desktop-live')
await mkdir(dir, { recursive: true })
const client = new RemoteAgentClient(pair.endpoint, pair.machineId, async () => pair.token, pair.protectedTunnel === true)
const request = { botId: 'validation-bot', taskId: 'desktop-live-validation', attemptId: 'desktop-live-attempt', roots: ['project'],
  tools: ['machine_ping', 'fs_read', 'desktop_screenshot', 'desktop_click', 'desktop_type', 'desktop_key', 'desktop_scroll'], ttlMs: 120000 }
let grant = (await client.grant(request)).grantToken, socket, ticket, nextId = 0
const messages = [], arrivals = [], hashes = new Set(), acks = [], checks = []
const frameRows = []
let currentFrame
const pending = new Map()
const trace = []
let firstJpeg, firstFrameWrite
function jpegSize(bytes) {
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset++] !== 255) continue
    const marker = bytes[offset++]; if (marker === 255) { offset--; continue }
    if (marker === 217 || marker === 218) break
    const length = bytes.readUInt16BE(offset)
    if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) }
    assert.ok(length >= 2); offset += length
  }
  throw new Error('JPEG_DIMENSIONS_MISSING')
}
const read = async name => {
  // The independent synthetic GUI writes its telemetry periodically. Retrying an incomplete
  // read is observational only; desktop inputs and their unknown outcomes are never replayed.
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await client.call(grant, 'fs_read', { rootId: 'project', relativePath: name, length: 65536 })
    const value = response.result ?? response
    try { return JSON.parse(Buffer.from(value.content, 'base64').toString('utf8')) }
    catch (error) { if (!(error instanceof SyntaxError) || attempt === 3) throw error; await sleep(30) }
  }
}
const until = async predicate => {
  const end = Date.now() + 15000
  while (Date.now() < end) { const result = await predicate(); if (result) return result; await sleep(80) }
  throw new Error('REMOTE_DESKTOP_VALIDATION_TIMEOUT')
}
const send = async (value, type = value.type) => {
  const id = ++nextId, start = performance.now()
  const key = `${type}/${id}`
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`REMOTE_ACK_TIMEOUT:${type}`)) }, 15000)
    pending.set(key, result => { clearTimeout(timer); resolve(result) })
  })
  socket.send(JSON.stringify({ ...value, id }))
  const result = await response
  acks.push(performance.now() - start)
  trace.push({ type, id, eventType: value.event?.type, action: value.event?.action ?? value.action, ok: result.ok, mode: result.mode, code: result.code, rttMs: Number((performance.now() - start).toFixed(2)) })
  return result
}
const input = async event => { const result = await send({ type: 'input', event }); assert.equal(result.ok, true, JSON.stringify(result)) }
const click = async (x, y) => {
  await input({ type: 'pointer', action: 'move', x, y })
  await input({ type: 'pointer', action: 'down', x, y, button: 'left' })
  await input({ type: 'pointer', action: 'up', x, y, button: 'left' })
}
const summary = { status: 'failed', actualModelCalls: 0, checks, limitations: ['Windows 10 interactive desktop and one selected display only', 'GDI/JPEG transport; not the RustDesk protocol or a hardware video codec', 'UAC, locked desktop, audio and multi-monitor switching are separate acceptance cases'] }
try {
  const window = await read('window.json')
  let state
  ticket = await client.desktopSession(grant, { mode: 'watch', fps: 15, displayId: window.displayId })
  assert.match(ticket.token, /^[A-Za-z0-9_-]{43}$/)
  const wsUrl = new URL(ticket.path, pair.endpoint); wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  socket = new WebSocket(wsUrl)
  socket.on('message', (data, binary) => {
    if (!binary) { const value = JSON.parse(data.toString()); messages.push(value); if(value.type==='frame')currentFrame=value; const key = `${value.type}/${value.id}`, done = pending.get(key); if (done) { pending.delete(key); done(value) }; return }
    assert.equal(data.readUInt16BE(0), 0xffd8); assert.equal(data.readUInt16BE(data.length - 2), 0xffd9)
    arrivals.push(performance.now()); hashes.add(createHash('sha256').update(data).digest('hex'))
    frameRows.push({...currentFrame,bytes:data.length,arrivalMs:Math.round(performance.now())})
    if (arrivals.length === 1) { firstJpeg = jpegSize(data); firstFrameWrite = writeFile(join(dir, 'first-frame.jpg'), data) }
  })
  await new Promise((yes, no) => { socket.once('open', yes); socket.once('error', no) })
  socket.send(JSON.stringify({ type: 'auth', sessionId: ticket.sessionId, token: ticket.token }))
  const ready = await until(() => messages.find(row => row.type === 'ready'))
  assert.equal(ready.mode, 'watch'); assert.ok(ready.width > 0 && ready.height > 0)
  await until(() => arrivals.length >= 2)
  assert.deepEqual(firstJpeg, { width: ready.width, height: ready.height })
  checks.push('Authenticated continuous full-monitor JPEG frames on the actual interactive desktop')
  state = await read('state.json')
  assert.equal(state.visible, true, 'The isolated test window must be visible before clicking its verified button')
  const denied = await send({ type: 'input', event: { type: 'key', action: 'down', code: 'KeyA', key: 'a' } })
  assert.equal(denied.ok, false); checks.push('Watch mode rejects input on the Agent')
  const acquired = await send({ type: 'control', action: 'acquire' })
  assert.equal(acquired.ok, true, JSON.stringify(acquired)); assert.equal(acquired.mode, 'control')
  const display = ready.displays.find(row => row.id === ready.displayId), x = display.x ?? 0, y = display.y ?? 0
  await click(window.buttonScreenX - x, window.buttonScreenY - y)
  await until(async () => (await read('state.json')).clicks === state.clicks + 1)
  checks.push('Mouse movement/down/up reaches the isolated WinForms button')
  await click(window.inputScreenX - x, window.inputScreenY - y)
  await input({ type: 'text', text: 'DSH stream verified 中文✓' })
  await until(async () => (await read('state.json')).text === 'DSH stream verified 中文✓')
  await input({ type: 'key', action: 'down', code: 'Backspace', key: 'Backspace' })
  await input({ type: 'key', action: 'up', code: 'Backspace', key: 'Backspace' })
  await until(async () => (await read('state.json')).text === 'DSH stream verified 中文')
  checks.push('Unicode text and real key down/up effects confirmed in the application')
  await input({ type: 'key', action: 'down', code: 'ShiftLeft', key: 'Shift' })
  await until(async () => (await read('state.json')).shiftDown === true)
  const released = await send({ type: 'release-input' }); assert.equal(released.ok, true)
  await until(async () => (await read('state.json')).shiftDown === false)
  checks.push('Held Shift is released after the acknowledged release-input command')
  // Shorten one acknowledged live grant only after the application effects are
  // verified, then renew it again and cross that old expiry on the same socket.
  grant = (await client.grant({ ...request, ttlMs: 6000 })).grantToken
  const short = await client.renewDesktopSession(grant, { sessionId: ticket.sessionId })
  assert.equal(short.sessionId, ticket.sessionId); assert.equal(short.token, ticket.token)
  const before = short.expiresAt
  grant = (await client.grant({ ...request, ttlMs: 180000 })).grantToken
  const renewed = await client.renewDesktopSession(grant, { sessionId: ticket.sessionId })
  assert.equal(renewed.sessionId, ticket.sessionId); assert.equal(renewed.token, ticket.token); assert.ok(renewed.expiresAt > before)
  checks.push('Fresh Host grant renews the original session and live socket')
  const sampleStart = performance.now(), frameStart = arrivals.length
  await sleep(8000)
  const elapsed = performance.now() - sampleStart, frames = arrivals.length - frameStart
  assert.ok(frames >= 20, 'Video must remain live throughout the measurement and grant renewal')
  assert.ok(Date.now() > before, 'Renewal must preserve the live session beyond the old grant expiry')
  await input({ type: 'key', action: 'down', code: 'End', key: 'End' })
  await input({ type: 'key', action: 'up', code: 'End', key: 'End' })
  checks.push('Video and acknowledged control persist beyond the original grant expiry without reconnecting')
  const releasedControl = await send({ type: 'control', action: 'release' }); assert.equal(releasedControl.mode, 'watch')
  const stop = await client.closeDesktopSession(grant, { sessionId: ticket.sessionId }); assert.equal(stop.stopConfirmed, true)
  checks.push('Control release keeps viewing available; closing confirms native session teardown')
  summary.status = 'passed'
  summary.video = { width: ready.width, height: ready.height, dpi: ready.dpi, displayId: ready.displayId, backend: ready.captureBackend,
    jpegDimensions: firstJpeg, requestedFps: 15, frames, sampleStartFrame: frameStart, sampleEndFrame: arrivals.length, observedFps: Number((frames / (elapsed / 1000)).toFixed(2)), sampleMs: Math.round(elapsed), totalFrames: arrivals.length, distinctFrameHashes: hashes.size }
  acks.sort((a, b) => a - b)
  summary.inputAckMs = { p50: Math.round(acks[Math.floor(acks.length * 0.5)]), p95: Math.round(acks[Math.min(acks.length - 1, Math.floor(acks.length * 0.95))]) }
} catch (error) { summary.error = error.stack; process.exitCode = 1 }
finally { try { if (ticket) await client.closeDesktopSession(grant, { sessionId: ticket.sessionId }) } catch {}; socket?.terminate(); await firstFrameWrite }
acks.sort((a,b)=>a-b)
summary.trace=trace; summary.inputAckMs={count:acks.length,p50:Math.round(acks[Math.floor(acks.length*.5)]??0),p95:Math.round(acks[Math.min(acks.length-1,Math.floor(acks.length*.95))]??0),rawMs:acks.map(value=>Number(value.toFixed(2)))}
summary.rawFrames={total:arrivals.length,distinctFrameHashes:hashes.size,arrivalMs:arrivals.map(value=>Number((value-arrivals[0]).toFixed(2))),frames:frameRows}
try{summary.fixture=await read('state.json')}catch{}
await writeFile(join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
process.stdout.write(JSON.stringify({ ...summary, outputDirectory: dir }, null, 2) + '\n')
