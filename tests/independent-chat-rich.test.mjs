import test from 'node:test'
import assert from 'node:assert/strict'
import { copyRichText, independentToolRelations, INDEPENDENT_MARKDOWN_LABELS, richToolArguments } from '../apps/integration-client/independent-chat-rich.mjs'

test('tool results match their actual nearest recorded call, including reused ids and incomplete pages', () => {
  const messages = [
    { messageId: 'before-page', role: 'tool', toolCallId: 'outside', content: 'unmatched' },
    { messageId: 'assistant-1', role: 'assistant', toolCalls: [{ id: 'reuse', name: 'read', args: { path: 'first' } }, { id: 'pending', name: 'wait', args: {} }] },
    { messageId: 'result-1', role: 'tool', toolCallId: 'reuse', content: 'first actual result' },
    { messageId: 'assistant-2', role: 'assistant', toolCalls: [{ id: 'reuse', name: 'read', args: { path: 'second' } }] },
    { messageId: 'result-2', role: 'tool', toolCallId: 'reuse', content: 'second actual result', isError: true },
  ]
  const relations = independentToolRelations(messages)
  assert.deepEqual(relations.get('assistant-1')[0].results.map(row => row.messageId), ['result-1'])
  assert.deepEqual(relations.get('assistant-1')[1].results, [])
  assert.deepEqual(relations.get('assistant-2')[0].results.map(row => row.messageId), ['result-2'])
  assert.equal(relations.has('before-page'), false)
  assert.equal(messages[1].toolCalls[0].results, undefined, 'the transcript is not mutated')
})

test('copy writes the exact source and reports success only after the real writer confirms it', async () => {
  const source = '# Header\r\n\n```js\n  const literal = "<b>raw</b>";\n```\n', writes = []
  assert.equal(await copyRichText(source, async text => { writes.push(text); return true }), true)
  assert.deepEqual(writes, [source])
  assert.equal(await copyRichText(source, async () => false), false)
  assert.equal(await copyRichText(source, async () => { throw new Error('clipboard denied') }), false)
  assert.equal(await copyRichText(source, async () => undefined), false)
})

test('tool arguments remain inert source text and labels stay reference-stable', () => {
  assert.equal(richToolArguments({ args: { command: '<script>alert(1)</script>', path: 'C:/secret' } }), '{\n  "command": "<script>alert(1)</script>",\n  "path": "C:/secret"\n}')
  assert.equal(richToolArguments({ arguments: '{"raw":"do not reparse"}' }), '{"raw":"do not reparse"}')
  assert.equal(richToolArguments({}), '未记录参数')
  assert.equal(Object.isFrozen(INDEPENDENT_MARKDOWN_LABELS), true)
  assert.equal(Object.isFrozen(INDEPENDENT_MARKDOWN_LABELS.code), true)
})
