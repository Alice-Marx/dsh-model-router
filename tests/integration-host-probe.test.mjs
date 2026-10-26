import test from 'node:test'
import assert from 'node:assert/strict'
import { probeLlmAdmission, probeToolBoundaries } from '../scripts/integration-host-probe.mjs'

test('integration: actual DSH SDK scope and guard block direct and nested calls', async () => {
  const result = await probeToolBoundaries()
  assert.equal(result.status, 'passed')
  assert.equal(result.checks.length, 7)
  assert.ok(result.limitations.includes('No product Bot policy installed'))
})

test('integration: actual LLM middleware rejects before mock adapter and observes usage', async () => {
  const result = await probeLlmAdmission()
  assert.equal(result.status, 'passed')
  assert.equal(result.actualModelCalls, 0)
  assert.equal(result.mockAdapterDispatches, 1)
})
