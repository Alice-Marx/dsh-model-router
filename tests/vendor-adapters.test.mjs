import test from 'node:test'
import assert from 'node:assert/strict'
import { createMiniMaxStreamParser, buildMiniMaxInvocation } from '../.dsh-plugin/shared/vendor-minimax-adapter.mjs'
import { createMiMoGrokParser } from '../.dsh-plugin/shared/vendor-mimo-grok-adapter.mjs'
import { resolve } from 'node:path'

const identity = { runId: 'run-1', sessionId: 'session-1', turnId: 'turn-1' }
const event = (type, sequence, extra = {}) => ({ schemaVersion: 1, type, sequence,
  timestampMs: sequence, ...identity, ...extra })

test('MiniMax accepts a complete matching terminal result and reports its actual model', () => {
  const parser = createMiniMaxStreamParser()
  const rows = [
    event('exec.started', 1), event('session.started', 2), event('turn.started', 3),
    event('item.completed', 4, { item: { id: 'reply', type: 'agent_message', content: '完成' } }),
    event('turn.completed', 5, { durationMs: 4 }),
    event('exec.completed', 6, { result: { schemaVersion: 1, type: 'exec.result',
      ...identity, status: 'succeeded', durationMs: 5, output: '完成',
      model: { providerId: 'minimax', modelId: 'configured-model' } } }),
  ]
  parser.push(rows.map(row => JSON.stringify(row)).join('\n') + '\n')
  const result = parser.finish(0)
  assert.equal(result.status, 'succeeded')
  assert.equal(result.finalText, '完成')
  assert.deepEqual(result.reportedModel, { providerId: 'minimax', modelId: 'configured-model' })
})

test('MiniMax rejects incomplete and cross-session outputs', () => {
  const incomplete = createMiniMaxStreamParser()
  incomplete.push([event('exec.started', 1), event('session.started', 2),
    event('turn.started', 3), event('turn.completed', 4, { durationMs: 3 })]
    .map(row => JSON.stringify(row)).join('\n') + '\n')
  assert.equal(incomplete.finish(0).status, 'failed')
  const mixed = createMiniMaxStreamParser()
  mixed.push(JSON.stringify(event('exec.started', 1)) + '\n')
  mixed.push(JSON.stringify(event('session.started', 2, { sessionId: 'other' })) + '\n')
  assert.match(mixed.finish(0).error, /身份/)
})

test('MiniMax refuses full permissions outside an isolated editable run', () => {
  const base = { nodeExecutable: resolve(process.platform === 'win32' ? 'node.exe' : 'node'), cliEntry: resolve('cli.js'),
    workspace: resolve('workspace'), modelReference: 'minimax/configured-model' }
  assert.throws(() => buildMiniMaxInvocation({ ...base, mode: 'read-only', permission: 'full' }), /isolated workspace-write/)
  const ready = buildMiniMaxInvocation({ ...base, mode: 'workspace-write', permission: 'full' })
  assert.ok(ready.args.includes('minimax/configured-model'))
})

test('MiMo and Grok require a successful terminal event and visible answer', () => {
  const mimo = createMiMoGrokParser('mimo-code')
  mimo.push(JSON.stringify({ type: 'text', sessionID: 'session-1',
    part: { type: 'text', text: '完成', time: { end: 1 } } }))
  mimo.push(JSON.stringify({ type: 'step_finish', sessionID: 'session-1',
    part: { type: 'step-finish', reason: 'stop' } }))
  assert.equal(mimo.finish(0).status, 'succeeded')

  const grok = createMiMoGrokParser('grok-build')
  grok.push(JSON.stringify({ type: 'text', data: '完成' }))
  grok.push(JSON.stringify({ type: 'end', stopReason: 'EndTurn', sessionId: 'session-1' }))
  assert.equal(grok.finish(0).status, 'succeeded')

  const incomplete = createMiMoGrokParser('grok-build')
  incomplete.push(JSON.stringify({ type: 'text', data: '文本不能证明任务完成' }))
  assert.equal(incomplete.finish(0).status, 'failed')
})
