import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { independentMessageWire } from '../packages/orchestration/src/independent-message-wire.mjs'
import { openBotSessionStore } from '../packages/orchestration/src/bot-session-store.mjs'

const modelSource = { kind: 'model', provider: 'alpha', model: 'vendor/one' }
const reply = { role: 'assistant', content: 'I will read it', modelSource, toolCalls: [{ id: 'call-1', name: 'read', args: { path: 'one.txt' } }] }
const result = { role: 'tool', content: 'saved contents', name: 'read', toolCallId: 'call-1' }

test('canonical history retains provider, content blocks and exact tool result correlation', () => {
  const messages = independentMessageWire([{ role: 'user', content: 'read' }, reply, result])
  assert.deepEqual(messages[0], { role: 'user', content: [{ type: 'text', text: 'read' }] })
  assert.deepEqual(messages[1].source, modelSource)
  assert.deepEqual(messages[1].content[1], { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{"path":"one.txt"}' })
  assert.equal(messages[2].toolCallId, 'call-1')
  assert.deepEqual(messages[2].source, { kind: 'tool', callId: 'call-1' })
})

test('unknown historical model provenance remains recall instead of a newly selected model', () => {
  const messages = independentMessageWire([{ role: 'assistant', content: 'old answer', at: 1 }])
  assert.equal(messages[0].role, 'user')
  assert.equal(messages[0].source.kind, 'independent-history')
  assert.match(messages[0].content[0].text, /provenance unrecorded/)
  assert.equal(JSON.stringify(messages).includes('provider'), false)
})

test('an interrupted tool batch is recall and never becomes a fresh executable tool call', () => {
  const [message] = independentMessageWire([reply])
  assert.equal(message.role, 'user')
  assert.match(message.content[0].text, /outcome not fully confirmed/)
  assert.equal(message.content.some(part => part.type === 'tool-call'), false)
})

test('message identity, model source and call/result ids survive a store reopen', () => {
  const root = resolve('tmp/integration/independent-message-wire')
  mkdirSync(root, { recursive: true })
  const dir = mkdtempSync(join(root, 'case-'))
  const store = openBotSessionStore({ dir })
  store.append('a', [reply, result])
  const first = independentMessageWire(store.get('a').messages)
  const second = independentMessageWire(openBotSessionStore({ dir }).get('a').messages)
  assert.deepEqual(second, first)
  assert.ok(first[0].id)
  assert.equal(first[1].toolCallId, 'call-1')
  assert.equal(first[0].source.model, 'vendor/one')
})

test('duplicate tool result identity is refused rather than silently joined', () => {
  assert.throws(() => independentMessageWire([reply, result, { ...result }]), { code: 'INDEPENDENT_TOOL_HISTORY_DUPLICATE' })
})

test('the same provider call id can be reused by a later completed response batch', () => {
  const secondReply = structuredClone(reply), secondResult = { ...result, content: 'second result' }
  const wire = independentMessageWire([reply, result, { role: 'user', content: 'do it again' }, secondReply, secondResult])
  assert.deepEqual(wire.map(row => row.role), ['assistant', 'tool', 'user', 'assistant', 'tool'])
  assert.equal(wire[1].content[0].text, 'saved contents')
  assert.equal(wire[4].content[0].text, 'second result')
})

test('a duplicate call id inside one batch is rejected before it can be persisted', () => {
  const root = resolve('tmp/integration/independent-message-wire')
  mkdirSync(root, { recursive: true })
  const store = openBotSessionStore({ dir: mkdtempSync(join(root, 'duplicate-')) })
  assert.throws(() => store.append('a', [{ ...reply, toolCalls: [reply.toolCalls[0], reply.toolCalls[0]] }]), { code: 'INVALID_BOT_TOOL_CALLS' })
  assert.deepEqual(store.get('a').messages, [])
})
