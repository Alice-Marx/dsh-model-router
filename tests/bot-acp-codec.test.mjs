// Fast, offline tests for the bot-acp JSON-RPC codec and bounded transport.
//
// No native supervisor, no agent CLI, no network: pure functions plus one real
// Node child process that writes raw bytes, so framing is proven against actual
// chunk boundaries rather than a mock. The native session suite
// (tests/bot-acp-session.native.mjs) covers the process side.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'

import {
  DEFAULT_MAX_FRAME_BYTES, RPC_INTERNAL_ERROR, clientCapabilities, classifyMessage, createFrameDecoder,
  errorFromWire, isClientFileMethod, isTerminalMethod, isValidMessageId, parseFrame, previewMessage,
  readAgentCapabilities,
} from '../packages/bot-acp/src/rpc-codec.mjs'
import { createChildPipe, createStdioRpc } from '../packages/bot-acp/src/stdio-rpc.mjs'

const collect = (options = {}) => {
  const frames = []
  const errors = []
  const decoder = createFrameDecoder({ ...options, onFrame: line => frames.push(line), onError: error => errors.push(error) })
  return { decoder, frames, errors }
}

describe('frame decoder', () => {
  test('splits several frames from one chunk and skips blank lines', () => {
    const { decoder, frames } = collect()
    decoder.write('{"a":1}\n\n{"b":2}\r\n{"c":3}\n')
    assert.deepEqual(frames.map(line => JSON.parse(line).a ?? JSON.parse(line).b ?? JSON.parse(line).c), [1, 2, 3])
    assert.equal(decoder.stats.blank, 1)
    assert.equal(decoder.stats.frames, 3)
  })

  test('decodes a multi-byte character split across two chunks', () => {
    const { decoder, frames } = collect()
    const line = `${JSON.stringify({ text: '你好，世界 🌍' })}\n`
    const bytes = Buffer.from(line, 'utf8')
    const cut = bytes.indexOf(Buffer.from('世', 'utf8')) + 1
    decoder.write(bytes.subarray(0, cut))
    decoder.write(bytes.subarray(cut))
    assert.equal(frames.length, 1)
    assert.equal(JSON.parse(frames[0]).text, '你好，世界 🌍')
  })

  test('drops an oversized frame as a whole and reports it once', () => {
    const { decoder, frames, errors } = collect({ maxFrameBytes: 1024 })
    const big = `${JSON.stringify({ text: 'x'.repeat(4096) })}\n`
    decoder.write(big)
    decoder.write('{"ok":true}\n')
    assert.equal(frames.length, 1)
    assert.equal(JSON.parse(frames[0]).ok, true)
    assert.equal(errors.length, 1)
    assert.match(errors[0].message, /ACP_FRAME_LIMIT/)
    assert.equal(decoder.stats.oversize, 1)
  })

  test('ignores a trailing unterminated frame', () => {
    const { decoder, frames } = collect()
    decoder.write('{"a":1}\n{"partial":')
    assert.equal(frames.length, 1)
    decoder.end()
    assert.equal(frames.length, 1)
    assert.equal(decoder.stats.pendingBytes, 0)
  })

  test('refuses an invalid frame bound at construction', () => {
    assert.throws(() => createFrameDecoder({ maxFrameBytes: 10, onFrame: () => {} }), /ACP_FRAME_LIMIT_INVALID/)
    assert.throws(() => createFrameDecoder({}), /ACP_FRAME_SINK_REQUIRED/)
  })
})

describe('message classification', () => {
  test('recognizes requests, responses and notifications', () => {
    assert.equal(classifyMessage({ jsonrpc: '2.0', id: 1, method: 'session/prompt', params: {} }).kind, 'request')
    assert.equal(classifyMessage({ jsonrpc: '2.0', method: 'session/update', params: {} }).kind, 'notification')
    assert.equal(classifyMessage({ jsonrpc: '2.0', id: 'abc', result: {} }).kind, 'response')
    assert.equal(classifyMessage({ jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'no' } }).kind, 'response')
  })

  test('rejects non-conforming messages instead of guessing', () => {
    assert.equal(classifyMessage([{ jsonrpc: '2.0' }]).kind, 'invalid')
    assert.equal(classifyMessage({ jsonrpc: '1.0', id: 1, method: 'x' }).kind, 'invalid')
    assert.equal(classifyMessage({ jsonrpc: '2.0', id: 1.5, method: 'x' }).kind, 'invalid')
    assert.equal(classifyMessage({ jsonrpc: '2.0', id: 1 }).kind, 'invalid')
    assert.equal(classifyMessage({ jsonrpc: '2.0', id: 1, method: 'x', params: {} }).kind, 'request')
    assert.equal(classifyMessage(null).kind, 'invalid')
  })

  test('parses frames and rejects batches, scalars and broken JSON', () => {
    assert.equal(parseFrame('{"a":1}').a, 1)
    assert.equal(parseFrame('[{"a":1}]'), null)
    assert.equal(parseFrame('42'), null)
    assert.equal(parseFrame('{oops'), null)
    assert.equal(parseFrame(''), null)
  })

  test('validates ids as strings or integers only', () => {
    assert.equal(isValidMessageId('req-1'), true)
    assert.equal(isValidMessageId(7), true)
    assert.equal(isValidMessageId(7.5), false)
    assert.equal(isValidMessageId(true), false)
    assert.equal(isValidMessageId(null), false)
    assert.equal(isValidMessageId(''), false)
    assert.equal(isValidMessageId('x'.repeat(200)), false)
  })
})

describe('wire errors', () => {
  test('surfaces the vendor cause from data and marks internal errors', () => {
    const error = errorFromWire({ code: -32000, message: 'failed', data: { details: 'quota spent', service: 'grok' } }, 'session/prompt')
    assert.match(error.message, /failed: quota spent \(session\/prompt, service: grok\)/)
    assert.equal(error.rpcCode, -32000)
    assert.equal(error.acpSessionFailure, false)
  })

  test('marks -32603 as a session failure and bounds the text', () => {
    const error = errorFromWire({ code: RPC_INTERNAL_ERROR, message: 'x'.repeat(4000) }, 'session/prompt')
    assert.equal(error.acpSessionFailure, true)
    assert.ok(error.message.length <= 1500)
  })

  test('keeps a plain message when there is no data', () => {
    assert.equal(errorFromWire({ code: -32601, message: 'method not found' }, 'x').message, 'method not found (x)')
    assert.equal(errorFromWire(undefined, 'x').message, 'ACP request failed (x)')
  })
})

describe('capabilities', () => {
  test('advertises file and terminal access only when the Host asks', () => {
    assert.deepEqual(clientCapabilities(), { fs: { readTextFile: false, writeTextFile: false }, terminal: false })
    assert.deepEqual(clientCapabilities({ fileSystem: true }), { fs: { readTextFile: true, writeTextFile: true }, terminal: false })
    assert.equal(clientCapabilities({ meta: { vendor: 1 } })._meta.vendor, 1)
  })

  test('reads the initialize result against the fixed schema', () => {
    const read = readAgentCapabilities({
      protocolVersion: 1,
      agentInfo: { name: 'agent', version: '2.0' },
      authMethods: [{ id: 'token' }],
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {}, close: {} }, promptCapabilities: { image: true } },
    })
    assert.equal(read.loadSession, true)
    assert.equal(read.sessionClose, true)
    assert.equal(read.promptImage, true)
    assert.equal(read.agentName, 'agent')
    assert.deepEqual(read.authMethods, [{ id: 'token' }])
  })

  test('treats a missing or malformed initialize result as nothing advertised', () => {
    const read = readAgentCapabilities(null)
    assert.equal(read.loadSession, false)
    assert.equal(read.protocolVersion, null)
  })

  test('names the client methods this client refuses', () => {
    assert.equal(isClientFileMethod('fs/read_text_file'), true)
    assert.equal(isClientFileMethod('fs/write_text_file'), true)
    assert.equal(isClientFileMethod('session/prompt'), false)
    assert.equal(isTerminalMethod('terminal/create'), true)
    assert.equal(isTerminalMethod('fs/read_text_file'), false)
  })

  test('bounds a diagnostic preview', () => {
    assert.equal(previewMessage({ a: 'x'.repeat(5000) }).length, 512)
    assert.equal(previewMessage({ a: 1 }), '{"a":1}')
  })
})

// ---- transport ---------------------------------------------------------------

const fakePipe = () => {
  const events = new EventEmitter()
  const written = []
  return {
    events,
    written,
    write: async value => { written.push(value) },
    send: value => { written.push(value) },
    end: () => {},
    get closed() { return false },
    message: obj => events.emit('message', classifyMessage(obj)),
    malformed: detail => events.emit('malformed', detail),
    failure: error => events.emit('failure', error),
    closed: detail => events.emit('closed', detail),
  }
}

describe('bounded transport', () => {
  test('maps request ids to promises and answers server requests', async () => {
    const pipe = fakePipe()
    const rpc = createStdioRpc({ pipe })
    const inbound = []
    rpc.events?.on?.('rpc-request', () => {})
    pipe.events.on('rpc-request', msg => inbound.push(msg))
    const pending = rpc.request('session/new', { cwd: 'x' })
    assert.equal(pipe.written.length, 1)
    assert.equal(pipe.written[0].method, 'session/new')
    assert.equal(typeof pipe.written[0].id, 'number')
    pipe.message({ jsonrpc: '2.0', id: pipe.written[0].id, result: { sessionId: 's1' } })
    assert.deepEqual(await pending, { sessionId: 's1' })
    assert.equal(rpc.pendingCount, 0)
    assert.equal(rpc.stats.responses, 1)
    rpc.notify('session/cancel', { sessionId: 's1' })
    assert.equal(pipe.written[1].method, 'session/cancel')
    assert.equal('id' in pipe.written[1], false)
    assert.equal(rpc.respond(99, { outcome: 'cancelled' }), true)
    assert.equal(pipe.written[2].result.outcome, 'cancelled')
    rpc.close()
  })

  test('counts duplicate, unknown and late responses without settling twice', async () => {
    const pipe = fakePipe()
    const rpc = createStdioRpc({ pipe })
    const pending = rpc.request('session/prompt', {})
    const id = pipe.written[0].id
    pipe.message({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } })
    assert.deepEqual(await pending, { stopReason: 'end_turn' })
    pipe.message({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } })
    pipe.message({ jsonrpc: '2.0', id: 987654, result: {} })
    assert.equal(rpc.stats.duplicateResponses, 1)
    assert.equal(rpc.stats.lateResponses, 1)
    assert.equal(rpc.stats.unknownResponses, 1)
    rpc.close()
  })

  test('counts malformed frames and keeps the connection usable', async () => {
    const pipe = fakePipe()
    const rpc = createStdioRpc({ pipe })
    pipe.malformed({ reason: 'unparseable' })
    const pending = rpc.request('initialize', {})
    pipe.message({ jsonrpc: '2.0', id: pipe.written[0].id, result: { protocolVersion: 1 } })
    assert.deepEqual(await pending, { protocolVersion: 1 })
    assert.equal(rpc.stats.malformed, 1)
    rpc.close()
  })

  test('rejects every pending request when the peer process exits', async () => {
    const pipe = fakePipe()
    const rpc = createStdioRpc({ pipe })
    const first = rpc.request('session/prompt', {})
    const second = rpc.request('session/prompt', {})
    pipe.closed({ code: 3, signal: null })
    await assert.rejects(first, error => error.acpPeerExit === true && error.exitCode === 3)
    await assert.rejects(second, /exited/)
    assert.equal(rpc.stats.peerExits, 1)
    assert.equal(rpc.closed, true)
  })

  test('enforces the per-request deadline', async () => {
    const pipe = fakePipe()
    const rpc = createStdioRpc({ pipe, requestTimeoutMs: 20 })
    await assert.rejects(rpc.request('session/prompt', {}), error => error.acpRequestTimeout === true)
    assert.equal(rpc.stats.timeouts, 1)
    rpc.close()
  })

  test('restarts the idle deadline on inbound traffic and trips on silence', async () => {
    const pipe = fakePipe()
    const rpc = createStdioRpc({ pipe, idleTimeoutMs: 60 })
    const pending = rpc.request('session/prompt', {})
    await new Promise(resolve => setTimeout(resolve, 30))
    pipe.message({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's' } })
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(rpc.stats.idleTimeouts, 0)
    await assert.rejects(pending, error => error.acpIdleTimeout === true)
    assert.equal(rpc.stats.idleTimeouts, 1)
    rpc.close()
  })

  test('refuses new requests at the pending limit', async () => {
    const pipe = fakePipe()
    const rpc = createStdioRpc({ pipe, maxPending: 2 })
    const held = [rpc.request('a', {}), rpc.request('b', {})]
    await assert.rejects(rpc.request('c', {}), error => error.acpPendingLimit === true)
    assert.equal(rpc.stats.pendingLimitRefusals, 1)
    pipe.closed({ code: 0, signal: null })
    await Promise.allSettled(held)
  })

  test('aborts a single request without touching the others', async () => {
    const pipe = fakePipe()
    const rpc = createStdioRpc({ pipe })
    const controller = new AbortController()
    const first = rpc.request('session/prompt', {}, { signal: controller.signal })
    const second = rpc.request('session/prompt', {})
    controller.abort()
    await assert.rejects(first, error => error.acpAborted === true)
    pipe.message({ jsonrpc: '2.0', id: pipe.written[1].id, result: { stopReason: 'end_turn' } })
    assert.deepEqual(await second, { stopReason: 'end_turn' })
    rpc.close()
  })

  test('rejects requests on a closed connection', async () => {
    const pipe = fakePipe()
    const rpc = createStdioRpc({ pipe })
    rpc.close('done')
    assert.equal(rpc.closed, true)
    await assert.rejects(rpc.request('session/prompt', {}), error => error.acpClosed === true)
  })

  test('fails every pending request when the pipe fails', async () => {
    const pipe = fakePipe()
    const rpc = createStdioRpc({ pipe })
    const pending = rpc.request('session/prompt', {})
    pipe.failure(new Error('ACP_BACKLOG_LIMIT'))
    await assert.rejects(pending, /ACP_BACKLOG_LIMIT/)
    rpc.close()
  })
})

describe('child pipe framing on a real process', () => {
  test('reads frames written in split chunks and rejects oversized writes', async () => {
    // A real child writes two JSON-RPC notifications, splitting a multi-byte
    // character across writes, then exits.
    const child = spawn(process.execPath, ['-e', `
      const line = JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { text: '你好 🌍' } }) + '\\n';
      const bytes = Buffer.from(line + line, 'utf8');
      process.stdout.write(bytes.subarray(0, 9));
      setTimeout(() => process.stdout.write(bytes.subarray(9, 20)), 5);
      setTimeout(() => { process.stdout.write(bytes.subarray(20)); process.exit(0) }, 10);
    `], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const messages = []
    const malformed = []
    const pipe = createChildPipe({ stdin: child.stdin, stdout: child.stdout, exit: new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal }))) })
    pipe.events.on('message', msg => messages.push(msg))
    pipe.events.on('malformed', detail => malformed.push(detail))
    const closed = new Promise(resolve => pipe.events.on('closed', resolve))
    await closed
    assert.equal(messages.length, 2)
    assert.equal(messages[0].kind, 'notification')
    assert.equal(messages[0].raw.params.text, '你好 🌍')
    assert.equal(malformed.length, 0)
    assert.ok(pipe.stats.frames >= 2)
    // An oversized write is refused locally, never written to the pipe.
    await assert.rejects(pipe.write({ blob: 'x'.repeat(DEFAULT_MAX_FRAME_BYTES) }), error => error.acpFrameLimit === true)
    pipe.end()
  }, 20_000)
})
