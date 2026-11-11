import test from 'node:test'
import assert from 'node:assert/strict'
import {
  activityIdentity, activityCallKey, hostConversationId, toolEventProjection,
  activityRecordFromEvent, applyToolEvent, closeTurnRecord, requestCancelRecord,
  confirmStopRecord, projectActivityRecord, assertDisplayOnly, summarizeActivity,
} from '../packages/orchestration/src/native-activity-contract.mjs'

const identity = patch => activityIdentity({ botId: 'a', mode: 'independent', conversationId: 'context-a', contextId: 'context-a', processGeneration: 'native-random-instance', turnId: 'turn-1', ...patch })
const start = patch => toolEventProjection({ phase: 'started', id: 'call-1', name: 'mcp__dsh_task__read_notes', ...patch })
const end = ok => toolEventProjection({ phase: 'completed', id: 'call-1', ok })

test('the same CLI id remains isolated by every trusted identity component', () => {
  const base = identity()
  const cases = [base, identity({ botId: 'b' }), identity({ conversationId: 'context-b', contextId: 'context-b' }), identity({ turnId: 'turn-2' }), identity({ processGeneration: 'native-next-random-instance' }), identity({ mode: 'integration', conversationId: hostConversationId('session-a'), contextId: null })]
  assert.equal(new Set(cases.map(row => activityCallKey(row, 'same-cli-id'))).size, cases.length)
  assert.throws(() => activityIdentity({ ...base, subject: {} }), { code: 'ACTIVITY_IDENTITY_UNKNOWN_FIELD' })
  assert.throws(() => identity({ processGeneration: 1 }), { code: 'ACTIVITY_PROCESS_GENERATION_INVALID' })
  assert.throws(() => identity({ contextId: 'another-context' }), { code: 'ACTIVITY_INDEPENDENT_CONTEXT_INVALID' })
  assert.throws(() => activityCallKey(base, 'bad id'), { code: 'ACTIVITY_CALL_ID_INVALID' })
})

test('raw parameters and results never enter a projected record, and names pass Host redaction', () => {
  const projected = toolEventProjection({ phase: 'started', id: 'call-1', name: 'secret_tool', input: { value: 'private' }, result: 'private', pixels: 'private' }, { redactToolName: name => name.replace('secret', 'redacted') })
  const record = activityRecordFromEvent(identity(), projected, 100)
  assert.equal(record.toolName, 'redacted_tool')
  assert.equal(JSON.stringify(projectActivityRecord(record)).includes('private'), false)
  assert.deepEqual([...projected.unprojected].sort(), ['input', 'pixels', 'result'])
  assert.equal(start({ name: 'C:\\private\\secrets.txt' }).toolNameRecorded, false)
  assert.equal(start({ name: 'A\u0000B\u001fC\u007fD' }).toolName, 'ABCD')
  assert.equal(start({ name: 'x'.repeat(500) }).toolName.length, 128)
  assert.throws(() => toolEventProjection({ phase: 'completed', id: 'call-1', ok: 'yes' }), { code: 'ACTIVITY_EVENT_OK_REQUIRED' })
})

test('the first CLI return is reported, duplicates do not create another outcome', () => {
  const original = activityRecordFromEvent(identity(), start(), 100)
  const completed = applyToolEvent(original, end(false), { turnOpen: true, at: 101 }).record
  assert.equal(completed.state, 'cli-error')
  const duplicate = applyToolEvent(completed, end(true), { turnOpen: true, at: 102 }).record
  assert.equal(duplicate.state, 'cli-error')
  assert.equal(duplicate.cliOk, false)
  assert.equal(duplicate.duplicateCompletions, 1)
  assert.equal(original.state, 'running')
})

test('cancel, confirmed process stop and an unknown turn remain separate facts', () => {
  const original = activityRecordFromEvent(identity(), start(), 100)
  const requested = requestCancelRecord(original, 101).record
  assert.equal(requested.cancelRequested, true)
  assert.equal(requested.stopConfirmed, false)
  const stopped = confirmStopRecord(requested, 102).record
  assert.equal(stopped.state, 'running')
  const closed = closeTurnRecord(stopped, { outcome: 'unknown', at: 103 })
  assert.equal(closed.state, 'turn-unconfirmed')
  assert.equal(closed.cliOk, null)
  const late = applyToolEvent(closed, end(true), { turnOpen: false, at: 104 }).record
  assert.equal(late.state, 'turn-unconfirmed')
  assert.equal(late.lateCliReturn, true)
  assert.equal(late.lateCliOk, true)
  assert.equal(late.turnOutcome, 'unknown')
})

test('closed display projection rejects injected fields and inconsistent state', () => {
  const record = projectActivityRecord(activityRecordFromEvent(identity(), start(), 100))
  assert.equal(assertDisplayOnly(record), true)
  assert.throws(() => assertDisplayOnly({ ...record, args: {} }), { code: 'ACTIVITY_DISPLAY_FIELD_REFUSED' })
  assert.throws(() => assertDisplayOnly({ ...record, state: 'cli-ok' }), { code: 'ACTIVITY_DISPLAY_RECORD_INVALID' })
  assert.throws(() => assertDisplayOnly({ ...record, turnOutcome: 'succeeded' }), { code: 'ACTIVITY_DISPLAY_RECORD_INVALID' })
  const summary = summarizeActivity(Array.from({ length: 8 }, (_, index) => activityRecordFromEvent(identity(), start({ id: `call-${index}` }), index)))
  assert.equal(summary.calls, 8)
  assert.equal(summary.recent.length, 4)
  assert.equal(summary.recentTruncated, true)
})
