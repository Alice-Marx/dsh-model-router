import test from 'node:test'
import assert from 'node:assert/strict'
import { privateEnvironment } from '../packages/cli-runtime/src/native-process.mjs'
import { createCodexEvidence, usageBreakdown } from '../packages/cli-runtime/src/contracts.mjs'

const binding = { taskId: 'task-a', attemptId: 'attempt-1', machineId: 'machine-a', workspaceId: 'workspace-a', location: 'local' }
const evidence = () => createCodexEvidence({ binding, operationId: 'operation-1', botId: 'bot-a', requestedModel: 'gpt-test', entry: { path: '/fixed/codex', sha256: 'a'.repeat(64), version: '0.163.0' } })

test('CLI environment never inherits credentials, global homes, PATH shadows or Node injection', () => {
  const env = privateEnvironment('/isolated/home', { OPENAI_API_KEY: 'synthetic-secret', CODEX_API_KEY: 'synthetic-secret', CODEX_HOME: '/other-bot', NODE_OPTIONS: '--require evil', PYTHONPATH: '/evil', PATH: '/evil/bin', HTTP_PROXY: 'synthetic-secret', SystemRoot: 'C:\\Windows' })
  for (const name of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'NODE_OPTIONS', 'PYTHONPATH', 'HTTP_PROXY']) assert.equal(name in env, false)
  assert.equal(env.CODEX_HOME, '/isolated/home')
  assert.equal(env.PATH.includes('evil'), false)
  assert.equal(env.XDG_CACHE_HOME.includes('isolated'), true)
})

test('CLI evidence retains unknown usage and subscription has no fabricated USD value', () => {
  const value = evidence().snapshot()
  assert.equal(value.usage.inputTokens, null)
  assert.equal(value.usage.status, 'unknown')
  assert.equal(value.billing.amountUsd, null)
  assert.equal(value.billing.amountStatus, 'not-applicable')
  assert.equal(value.identity.actualResponseModelVerified, false)
  assert.equal(usageBreakdown({ inputTokens: -1, outputTokens: 0 }).inputTokens, null)
})

test('CLI rejects a different configured model/provider before dispatch', () => {
  assert.throws(() => evidence().bindThread({ thread: { id: 't' }, model: 'gpt-other', modelProvider: 'openai' }), /IDENTITY_MISMATCH/)
  assert.throws(() => evidence().bindThread({ thread: { id: 't' }, model: 'gpt-test', modelProvider: 'other' }), /IDENTITY_MISMATCH/)
})

test('CLI cumulative usage snapshots deduplicate; cross-thread and cross-turn events do not contaminate receipt', () => {
  const value = evidence()
  value.bindThread({ thread: { id: 't' }, model: 'gpt-test', modelProvider: 'openai' })
  const event = { method: 'thread/tokenUsage/updated', params: { threadId: 't', turnId: 'turn-1', tokenUsage: { total: { inputTokens: 20, outputTokens: 3, cachedInputTokens: 4, cacheWriteInputTokens: 0, reasoningOutputTokens: 1, totalTokens: 23 } } } }
  value.event(event); value.event(event)
  value.event({ ...event, params: { ...event.params, threadId: 'another' } })
  value.event({ ...event, params: { ...event.params, turnId: 'another' } })
  const result = value.snapshot()
  assert.equal(result.usage.totalTokens, 23)
  assert.equal(result.receiptId, 'codex:operation-1:t:turn-1')
  assert.equal(result.usage.status, 'complete')
  assert.equal(result.identity.verification, 'cli-configured-model')
})

test('CLI rerouting invalidates success without replacing the requested model', () => {
  const value = evidence()
  value.bindThread({ thread: { id: 't' }, model: 'gpt-test', modelProvider: 'openai' })
  assert.equal(value.event({ method: 'model/rerouted', params: { threadId: 't', turnId: 'turn-1', fromModel: 'gpt-test', toModel: 'gpt-other' } }).mismatch, true)
  value.event({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'turn-1', status: 'completed' } } })
  assert.equal(value.snapshot().terminal, 'identity-mismatch')
  assert.equal(value.snapshot().identity.requestedCliModel, 'gpt-test')
})
