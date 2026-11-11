import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { NativeCliOutput } from '../packages/cli-runtime/src/native-cli-output.mjs'

const echo = content => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-a', content }] } })
test('native CLI image echoes survive split JSON lines and retain only bounded hash receipts', () => {
  const bytes = randomBytes(600000), data = bytes.toString('base64')
  const reader = new NativeCliOutput()
  const frame = echo([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }])
  frame.tool_use_result = { content: [{ type: 'image', mimeType: 'image/png', data }] }
  const wire = JSON.stringify(frame) + '\n'
  const frames = []
  for (let repeat = 0; repeat < 12; repeat++) for (let at = 0; at < wire.length; at += 4096) frames.push(...reader.push(wire.slice(at, at + 4096)))
  assert.equal(frames.length, 12)
  const image = frames[0].message.content[0].content[0]
  assert.equal(image.bytes, bytes.length)
  assert.equal(image.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.ok(!JSON.stringify(frames).includes(data))
  assert.deepEqual(reader.push('{"type":"result"}\n'), [{ type: 'result' }])
})
test('large text, oversized image, malformed base64 and unfinished raw frames stay bounded', () => {
  for (const frame of [ { type: 'assistant', text: 'x'.repeat(270000) }, echo('x'.repeat(270000)),
    echo([{ type: 'image', mimeType: 'image/png', data: 'not-base64' }]),
    echo([{ type: 'image', mimeType: 'image/png', data: Buffer.alloc(6 * 1024 * 1024 + 1).toString('base64') }]) ]) {
    assert.throws(() => new NativeCliOutput().push(JSON.stringify(frame) + '\n'), /CLI_FRAME_LIMIT/)
  }
  assert.throws(() => new NativeCliOutput().push(' '.repeat(18 * 1024 * 1024 + 1)), /CLI_FRAME_LIMIT/)
})
test('native CLI ordinary output retains the cumulative session limit', () => {
  const reader = new NativeCliOutput(), wire = JSON.stringify({ type: 'assistant', text: 'x'.repeat(200000) }) + '\n'
  assert.throws(() => { for (let i = 0; i < 50; i++) reader.push(wire) }, /CLI_FRAME_LIMIT/)
})
