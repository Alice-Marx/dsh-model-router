import test from 'node:test'
import assert from 'node:assert/strict'
import { bridgeResponseFrames, BridgeResponseReader, normalizeBridgeMcpResult } from '../packages/capability-broker/src/cli-bridge-response.mjs'

test('large MCP pictures survive interleaved bounded frames without text conversion', () => {
  const image = { type: 'image', mimeType: 'image/png', data: Buffer.alloc(700000, 47).toString('base64') }
  const value = { ok: true, mcpResult: normalizeBridgeMcpResult({ content: [{ type: 'text', text: '截图 🚀' }, image] }) }
  const first = [...bridgeResponseFrames(1, value)], second = [...bridgeResponseFrames(2, value)]
  assert.ok(first.length > 2)
  assert.ok(first.every(frame => Buffer.byteLength(JSON.stringify(frame)) < 262144))
  const reader = new BridgeResponseReader(), answers = []
  for (let index = 0; index < first.length; index++) for (const frames of [first, second]) {
    const response = reader.accept(frames[index])
    if (response) answers.push(response)
  }
  assert.deepEqual(answers.map(answer => answer.id), [1, 2])
  assert.deepEqual(answers[0].mcpResult.content, value.mcpResult.content)
})

test('chunk corruption, missing frames and cancellation do not yield a partial result', () => {
  const frames = [...bridgeResponseFrames(1, { ok: true, value: 'x'.repeat(500000) })]
  const reader = new BridgeResponseReader()
  reader.accept(frames[0])
  assert.throws(() => reader.accept({ ...frames[1], index: 7 }), /INVALID_BRIDGE_RESPONSE/)
  reader.drop(1)
  assert.throws(() => reader.accept(frames[1]), /INVALID_BRIDGE_RESPONSE/)
  reader.accept(frames[0]); reader.accept(frames[1])
  assert.throws(() => reader.accept(frames.at(-1)), /INVALID_BRIDGE_RESPONSE/)
  reader.clear()
  for (const frame of frames.slice(0, -1)) reader.accept(frame)
  assert.throws(() => reader.accept({ ...frames.at(-1), sha256: 'changed' }), /INVALID_BRIDGE_RESPONSE/)
  assert.throws(() => reader.accept({ type: 'response-start', id: 2, bytes: 100000000 }), /INVALID_BRIDGE_RESPONSE/)
})

test('small replies remain compatible and oversized replies fail with a bounded response', () => {
  assert.deepEqual([...bridgeResponseFrames(3, { ok: true, value: { ready: true } })], [{ type: 'response', id: 3, ok: true, value: { ready: true } }])
  assert.deepEqual([...bridgeResponseFrames(4, { ok: true, value: 'x'.repeat(10 * 1024 * 1024) })], [{ type: 'response', id: 4, ok: false, code: 'OUTPUT_LIMIT' }])
  assert.throws(() => normalizeBridgeMcpResult({ content: [{ type: 'resource', uri: 'file://untrusted' }] }), /INVALID_BRIDGE_RESPONSE/)
  assert.throws(() => normalizeBridgeMcpResult({ content: [{ type: 'image', mimeType: 'image/png', data: 'malformed!' }] }), /INVALID_BRIDGE_RESPONSE/)
})
