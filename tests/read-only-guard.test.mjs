import test from 'node:test'
import assert from 'node:assert/strict'
import { READ_ONLY_WRITE_CODE, normalizeFingerprint, readOnlyViolation, workspaceChanged } from '../.dsh-plugin/shared/read-only-guard.mjs'

test('read-only guard: identical listings, in any order, are the same workspace', () => {
  const before = ' M a.js\r\n?? b/c.txt\r\n'
  const after = '?? b/c.txt\n M a.js\n'
  assert.equal(workspaceChanged(before, after), false)
  assert.equal(normalizeFingerprint(before), normalizeFingerprint(after))
})

test('read-only guard: a new, changed or deleted file is a change', () => {
  assert.equal(workspaceChanged('', '?? new.txt\n'), true)
  assert.equal(workspaceChanged(' M a.js\n', ' M a.js\n M b.js\n'), true)
  assert.equal(workspaceChanged(' M a.js\n', ''), true)
})

test('read-only guard: a missing fingerprint proves nothing and is not called a change', () => {
  assert.equal(workspaceChanged(null, ' M a.js\n'), false)
  assert.equal(workspaceChanged(' M a.js\n', null), false)
})

test('read-only guard: a violated run becomes a failure with a stable code', () => {
  const result = readOnlyViolation({ status: 'succeeded', finalText: 'done', exitCode: 0, usage: { inputTokens: 3 } })
  assert.equal(result.status, 'failed')
  assert.equal(result.error, READ_ONLY_WRITE_CODE)
  assert.equal(result.reason, READ_ONLY_WRITE_CODE)
  assert.equal(result.finalText, 'done', 'the model output is kept for the receipt')
  assert.deepEqual(result.usage, { inputTokens: 3 })
  assert.match(result.modelNotice, /只读任务改动了工作区/)
})
