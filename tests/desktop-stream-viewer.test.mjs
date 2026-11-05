import test from 'node:test'
import assert from 'node:assert/strict'
import { connectDesktopStream } from '../apps/integration-client/desktop-stream.mjs'
import { installDesktopBridge } from '../apps/integration-client/desktop-bridge.mjs'

test('viewer authenticates the socket before input and waits for the remote control acknowledgement', () => {
  let socket
  class Socket {
    readyState = 1; sent = []
    constructor(url) { this.url = url; socket = this }
    send(value) { this.sent.push(JSON.parse(value)) }
    close() { this.readyState = 3 }
  }
  const frames = [], states = []
  const client = connectDesktopStream({ ticket: { websocketUrl: 'ws://127.0.0.1/desktop/v1/socket', sessionId: 'session-a', token: 'ticket-only' }, WebSocketImpl: Socket, onFrame: value => frames.push(value), onState: value => states.push(value) })
  socket.onopen()
  assert.deepEqual(socket.sent, [{ type: 'auth', sessionId: 'session-a', token: 'ticket-only' }])
  socket.onmessage({ data: JSON.stringify({ type: 'ready', mode: 'watch' }) })
  assert.equal(client.input({ type: 'key', action: 'down', code: 'KeyA' }), false)
  client.setMode('control')
  assert.equal(client.input({ type: 'key', action: 'down', code: 'KeyA' }), false)
  socket.onmessage({ data: JSON.stringify({ type: 'control', mode: 'control' }) })
  assert.equal(client.input({ type: 'key', action: 'down', code: 'KeyA' }), true)
  const jpeg = new Uint8Array([255, 216, 255, 217]).buffer
  socket.onmessage({ data: jpeg }); assert.equal(frames[0], jpeg)
  client.setMode('watch')
  assert.equal(client.input({ type: 'key', action: 'down', code: 'KeyB' }), false, 'release fences local input before the acknowledgement arrives')
  socket.onmessage({ data: JSON.stringify({ type: 'control', mode: 'control' }) })
  assert.equal(client.input({ type: 'key', action: 'down', code: 'KeyB' }), false, 'a late acquire acknowledgement cannot override a later release')
  socket.onmessage({ data: JSON.stringify({ type: 'control', mode: 'watch' }) })
  client.close(); assert.equal(client.input({ type: 'key', action: 'up', code: 'KeyA' }), false)
  assert.equal(states.at(-1).mode, 'watch')
})

test('desktop bridge exists independently of the computers page and resolves string root IDs from fresh Host state', async () => {
  const calls = [], state = { machines: { items: [{ id: 'machine-a', name: 'Computer', roots: ['project'], status: 'online', bindings: [{ botId: 'bot-a', revoked: false }] }] } }
  const dispose = installDesktopBridge({ snapshot: async () => state, dispatch: async (action, payload) => { calls.push({ action, payload }); return { accepted: true } } }, () => null)
  try {
    assert.equal((await globalThis.__dshDesktop.machines('bot-a'))[0].rootId, 'project')
    await globalThis.__dshDesktop.open('bot-a', 'machine-a', { mode: 'watch', fps: 15 })
    assert.deepEqual(calls[0], { action: 'machine.desktop.open', payload: { botId: 'bot-a', machineId: 'machine-a', rootId: 'project', mode: 'watch', fps: 15 } })
    state.machines.items[0].status = 'revoked'
    await assert.rejects(globalThis.__dshDesktop.open('bot-a', 'machine-a', {}), /授权已撤销/)
    assert.equal(calls.length, 1)
  } finally { dispose() }
})

test('viewer retains the failure when a transport error is followed by an empty close event', () => {
  let socket
  class Socket {
    readyState = 1
    constructor() { socket = this }
    send() {}
    close() { this.readyState = 3 }
  }
  const states = []
  connectDesktopStream({ ticket: { websocketUrl: 'ws://127.0.0.1/desktop/v1/socket' }, WebSocketImpl: Socket, onState: value => states.push(value) })
  socket.onerror()
  socket.onclose({ code: 1006, reason: '' })
  assert.equal(states.at(-1).status, 'error')
  assert.match(states.at(-1).error, /桌面传输连接失败/u)
  assert.equal(states.at(-1).mode, 'watch')
})

test('viewer retains the remote refusal instead of replacing it with a later generic socket error', () => {
  let socket
  class Socket {
    readyState = 1
    constructor() { socket = this }
    send() {}
    close() { this.readyState = 3 }
  }
  const states = []
  connectDesktopStream({ ticket: { websocketUrl: 'ws://127.0.0.1/desktop/v1/socket' }, WebSocketImpl: Socket, onState: value => states.push(value) })
  socket.onmessage({ data: JSON.stringify({ type: 'error', code: 'GRANT_REVOKED' }) })
  socket.onerror()
  socket.onclose({ code: 1008, reason: '' })
  assert.equal(states.at(-1).status, 'error')
  assert.equal(states.at(-1).error, 'GRANT_REVOKED')
})
