import test from 'node:test'
import assert from 'node:assert/strict'
import { buildToolRunRecord } from '../.dsh-plugin/shared/run-ledger.mjs'

test('single-tool ledger preserves prepared failure diagnostics, exit codes and known charges', () => {
  const result = { status: 'failed', error: 'vendor rejected request', diagnostic: 'bounded scrubbed diagnostic',
    exitCode: 9, reportedCostUsd: 0.03, usage: { inputTokens: 123, outputTokens: 456 } }
  const record = buildToolRunRecord({ id: 'single-failure', createdAt: 1, task: 'fixture', toolId: 'codex',
    result, billingFor: () => 'api' })
  const stored = record.packages[0]
  assert.equal(stored.status, 'failed')
  assert.equal(stored.diagnostic, result.diagnostic)
  assert.equal(stored.exitCode, 9)
  assert.equal(stored.costUsd, 0.03)
  assert.deepEqual(stored.usage, result.usage)
})

test('single-tool ledger bounds diagnostics and omits them for successful results', () => {
  const make = result => buildToolRunRecord({ id: 'bounded', createdAt: 1, task: 'fixture', toolId: 'codex', result }).packages[0]
  assert.equal(make({ status: 'failed', diagnostic: 'x'.repeat(3_000), exitCode: null }).diagnostic.length, 2_000)
  const succeeded = make({ status: 'succeeded', finalText: 'done', diagnostic: 'stale error', exitCode: 0 })
  assert.equal(succeeded.diagnostic, undefined)
  assert.equal(succeeded.exitCode, 0)
})
