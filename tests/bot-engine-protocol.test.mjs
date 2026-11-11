// Pure protocol-helper tests for the Claude conversation engine.
// No child processes: everything here exercises the side-effect-free helpers.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  brokerAnswer, classifyClaudeFrame, claudeCostSnapshot, claudeResultError, claudeUserMessage,
  nativeTurnResult, parseBrokerAsk, resultUsage, sumNativeTurnResults, turnCostFromRunningTotal,
  validTurnText,
} from '../packages/bot-engines/src/claude-protocol.mjs'

describe('validTurnText', () => {
  test('accepts plain, multibyte and boundary-sized text', () => {
    assert.equal(validTurnText('hello'), true)
    assert.equal(validTurnText('  padded  '), true)
    assert.equal(validTurnText('日本語 🚀 with unicode'), true)
    assert.equal(validTurnText('a'.repeat(64_000)), true)
    assert.equal(validTurnText('é'.repeat(32_000)), true, '32000 two-byte chars = 64000 bytes')
  })
  test('refuses blank, NUL-bearing, oversized and non-string input', () => {
    assert.equal(validTurnText(''), false)
    assert.equal(validTurnText('   \n\t  '), false)
    assert.equal(validTurnText('a\0b'), false)
    assert.equal(validTurnText('a'.repeat(64_001)), false)
    assert.equal(validTurnText('é'.repeat(32_001)), false)
    assert.equal(validTurnText(null), false)
    assert.equal(validTurnText(42), false)
    assert.equal(validTurnText(['x']), false)
  })
})

describe('claudeUserMessage', () => {
  test('carries the prompt in the message body, never argv', () => {
    assert.deepEqual(claudeUserMessage('do the thing'), { type: 'user', message: { role: 'user', content: 'do the thing' } })
  })
})

describe('claudeResultError', () => {
  test('prefers the explicit errors list', () => {
    assert.equal(claudeResultError({ errors: ['boom', ''], result: 'ignored' }), 'boom')
  })
  test('falls back to result text, then a subtype description', () => {
    assert.equal(claudeResultError({ result: 'quota exceeded' }), 'quota exceeded')
    assert.equal(claudeResultError({ subtype: 'error_during_execution' }),
      'Claude ended the turn with an error (error_during_execution).')
    assert.equal(claudeResultError({ terminal_reason: 'refused' }), 'Claude ended the turn with an error (refused).')
  })
})

describe('turnCostFromRunningTotal', () => {
  test('a missing or non-numeric total stays null — cost is never invented', () => {
    assert.equal(turnCostFromRunningTotal(null, 0.5), null)
    assert.equal(turnCostFromRunningTotal(undefined, 0.5), null)
    assert.equal(turnCostFromRunningTotal('0.1', null), null)
    assert.equal(turnCostFromRunningTotal(Number.NaN, null), null)
  })
  test('a first reading is the whole figure; later turns are the growth', () => {
    assert.equal(turnCostFromRunningTotal(0.01, null), 0.01)
    assert.equal(turnCostFromRunningTotal(0.025, 0.01), 0.015)
  })
  test('a shrinking total (resume restored an older baseline) is taken whole', () => {
    assert.equal(turnCostFromRunningTotal(0.02, 0.05), 0.02)
  })
})

describe('claudeCostSnapshot', () => {
  test('rejects non-finite totals', () => {
    assert.equal(claudeCostSnapshot('0.1', {}), null)
    assert.equal(claudeCostSnapshot(Number.NaN, {}), null)
  })
  test('normalizes per-model usage into [input, cacheRead, cacheWrite, output]', () => {
    const snapshot = claudeCostSnapshot(1.25, { 'claude-x': { inputTokens: 10, cacheReadInputTokens: 20, cacheCreationInputTokens: 30, outputTokens: 40 } })
    assert.deepEqual(snapshot, { total: 1.25, models: { 'claude-x': [10, 20, 30, 40] } })
  })
  test('tolerates partial model rows', () => {
    const snapshot = claudeCostSnapshot(0.5, { a: { outputTokens: 1 }, notAnObject: null })
    assert.deepEqual(snapshot.models, { a: [0, 0, 0, 1] })
  })
})

describe('nativeTurnResult', () => {
  test('maps a successful result', () => {
    const native = nativeTurnResult({ is_error: false, stop_reason: 'end_turn', total_cost_usd: 0.02, usage: { input_tokens: 5, output_tokens: 6 } })
    assert.equal(native.ok, true)
    assert.equal(native.stopReason, 'end_turn')
    assert.equal(native.cost, 0.02)
    assert.deepEqual(native.usage, { input: 5, output: 6 })
  })
  test('an error result derives stopReason from terminal_reason/subtype and ignores bogus cost', () => {
    const native = nativeTurnResult({ is_error: true, terminal_reason: 'refused', subtype: 'error_during_execution', total_cost_usd: 'n/a' })
    assert.equal(native.ok, false)
    assert.equal(native.stopReason, 'refused')
    assert.equal(native.cost, null)
    assert.equal(native.usage, undefined)
  })
  test('missing usage simply has no usage', () => {
    assert.equal(nativeTurnResult({}).usage, undefined)
  })
})

describe('resultUsage', () => {
  test('sums fresh + cache-read + cache-write inputs and reports cachedInput separately', () => {
    assert.deepEqual(resultUsage({ input_tokens: 100, cache_read_input_tokens: 30, cache_creation_input_tokens: 20, output_tokens: 9 }), { input: 150, output: 9, cachedInput: 30 })
  })
  test('partial data stays honest: missing components are not zero', () => {
    assert.deepEqual(resultUsage({ output_tokens: 4 }), { input: null, output: 4 })
  })
  test('no usable numbers at all is null, not an empty object', () => {
    assert.equal(resultUsage({ input_tokens: -5, output_tokens: 'x' }), null)
  })
})

describe('sumNativeTurnResults', () => {
  test('a single native result passes through', () => {
    const native = { ok: true, stopReason: 'end_turn', cost: 0.01, usage: { input: 10, output: 2 } }
    assert.deepEqual(sumNativeTurnResults(null, native), native)
  })
  test('merged turns sum usage, keep the latest cumulative cost and worst ok', () => {
    const merged = sumNativeTurnResults(
      { ok: true, stopReason: null, cost: 0.01, usage: { input: 10, output: 2, cachedInput: 3 } },
      { ok: true, stopReason: 'end_turn', cost: 0.03, usage: { input: 15, output: 4 } })
    assert.equal(merged.ok, true)
    assert.equal(merged.stopReason, 'end_turn')
    assert.equal(merged.cost, 0.03)
    assert.deepEqual(merged.usage, { input: 25, output: 6, cachedInput: 3 })
  })
  test('one failed native turn fails the logical turn', () => {
    const merged = sumNativeTurnResults({ ok: false, stopReason: 'refused', cost: null }, { ok: true, stopReason: 'end_turn', cost: 0.02 })
    assert.equal(merged.ok, false)
  })
})

describe('classifyClaudeFrame', () => {
  test('init frame yields session/model/permission identity', () => {
    const frame = classifyClaudeFrame({ type: 'system', subtype: 'init', session_id: 's1', model: 'm1', permissionMode: 'acceptEdits', tools: ['Bash', 7] })
    assert.deepEqual(frame, { type: 'init', sessionId: 's1', model: 'm1', permissionMode: 'acceptEdits', tools: ['Bash'] })
  })
  test('init with a missing model reports null rather than guessing', () => {
    assert.equal(classifyClaudeFrame({ type: 'system', subtype: 'init', session_id: 's1' }).model, null)
  })
  test('compact_boundary is surfaced, other system frames ignored', () => {
    assert.equal(classifyClaudeFrame({ type: 'system', subtype: 'compact_boundary' }).type, 'compacted')
    assert.equal(classifyClaudeFrame({ type: 'system', subtype: 'status' }).type, 'ignored')
  })
  test('text and thinking deltas classify; subagent narration does not', () => {
    assert.deepEqual(classifyClaudeFrame({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } } }), { type: 'assistant-delta', delta: 'hi' })
    assert.deepEqual(classifyClaudeFrame({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } } }), { type: 'reasoning-delta', delta: 'hmm' })
    assert.equal(classifyClaudeFrame({ type: 'stream_event', parent_tool_use_id: 'sub1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'inner' } } }).type, 'ignored')
    assert.equal(classifyClaudeFrame({ type: 'stream_event', event: { type: 'message_start' } }).type, 'ignored')
  })
  test('assistant frames expose text, tool uses and message usage', () => {
    const frame = classifyClaudeFrame({ type: 'assistant', message: { role: 'assistant', content: [
      { type: 'text', text: 'working' },
      { type: 'tool_use', id: 'tu1', name: 'mcp__dsh_task__read_notes', input: { op: 'list' } },
      { type: 'text', text: ' more' },
    ], usage: { input_tokens: 3 } } })
    assert.equal(frame.type, 'assistant')
    assert.equal(frame.text, 'working more')
    assert.deepEqual(frame.toolUses, [{ id: 'tu1', name: 'mcp__dsh_task__read_notes', input: { op: 'list' } }])
    assert.deepEqual(frame.usage, { input_tokens: 3 })
  })
  test('string content is accepted for assistant frames', () => {
    assert.equal(classifyClaudeFrame({ type: 'assistant', message: { role: 'assistant', content: 'plain' } }).text, 'plain')
  })
  test('user frames classify tool_results and replay markers', () => {
    const frame = classifyClaudeFrame({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', is_error: false }, { type: 'tool_result', tool_use_id: 'tu2', is_error: true }] } })
    assert.deepEqual(frame, { type: 'tool-result', results: [{ toolUseId: 'tu1', ok: true }, { toolUseId: 'tu2', ok: false }] })
    assert.equal(classifyClaudeFrame({ type: 'user', isReplay: true, message: { content: [] } }).type, 'replay')
    assert.equal(classifyClaudeFrame({ type: 'user', message: { content: 'a plain string' } }).type, 'ignored')
  })
  test('result frames separate errors, usage and native totals; task notifications are not turn results', () => {
    const frame = classifyClaudeFrame({ type: 'result', is_error: false, stop_reason: 'end_turn', total_cost_usd: 0.02, usage: { input_tokens: 1, output_tokens: 2 }, errors: [] })
    assert.equal(frame.type, 'result')
    assert.equal(frame.isError, false)
    assert.deepEqual(frame.native, { ok: true, stopReason: 'end_turn', cost: 0.02, usage: { input: 1, output: 2 } })
    assert.equal(classifyClaudeFrame({ type: 'result', origin: { kind: 'task-notification' } }).type, 'ignored')
  })
  test('garbage frames are ignored, never thrown', () => {
    assert.equal(classifyClaudeFrame(null).type, 'ignored')
    assert.equal(classifyClaudeFrame('x').type, 'ignored')
    assert.equal(classifyClaudeFrame({ type: 'mystery' }).type, 'ignored')
  })
})

describe('broker wire helpers', () => {
  test('parseBrokerAsk accepts only well-formed asks', () => {
    assert.deepEqual(parseBrokerAsk({ t: 'ask', id: 'a1', kind: 'permission', tool: 'Bash', input: { command: 'x' } }),
      { id: 'a1', kind: 'permission', tool: 'Bash', input: { command: 'x' } })
    assert.deepEqual(parseBrokerAsk({ t: 'ask', id: 'a2', tool: 'q' }), { id: 'a2', kind: 'permission', tool: 'q', input: {} })
    assert.deepEqual(parseBrokerAsk({ t: 'ask', id: 'a3', kind: 'question', input: [] }), { id: 'a3', kind: 'question', tool: 'tool', input: {} })
    assert.equal(parseBrokerAsk({ t: 'answer', id: 'a1' }), null)
    assert.equal(parseBrokerAsk({ t: 'ask' }), null, 'id is mandatory')
    assert.equal(parseBrokerAsk({ t: 'ask', id: '' }), null)
    assert.equal(parseBrokerAsk('junk'), null)
  })
  test('brokerAnswer serializes with optional always', () => {
    assert.deepEqual(brokerAnswer('a1', 'allow', undefined, 'user', true), { t: 'answer', id: 'a1', behavior: 'allow', message: undefined, source: 'user', always: true })
    assert.deepEqual(brokerAnswer('a2', 'deny', 'no', 'engine'), { t: 'answer', id: 'a2', behavior: 'deny', message: 'no', source: 'engine' })
  })
})
