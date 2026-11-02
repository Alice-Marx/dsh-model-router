// Controlled F40 (cli-runtime new component) regression. It imports the materialized candidate
// product module from --candidate-root and executes its behavior; a dirty governance root cannot
// contaminate the result because the imported bytes come only from the verified candidate tree.
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

function value(name) {
  const index = process.argv.indexOf(`--${name}`)
  assert.ok(index > 0 && process.argv[index + 1] !== undefined, `missing --${name}`)
  return process.argv[index + 1]
}

const source = value('source').toUpperCase()
const baseline = value('baseline')
const candidate = value('candidate')
const incrementId = value('increment-id')
const candidateRoot = value('candidate-root')

assert.match(baseline, /^[0-9a-f]{40}$/, 'baseline must be a complete SHA')
assert.match(candidate, /^[0-9a-f]{40}$/, 'candidate must be a complete SHA')
assert.equal(incrementId, `${source}:${candidate}`, 'increment-id must be exactly SOURCE:candidate')

const componentRoot = join(candidateRoot, 'packages/cli-runtime/src')
await assert.doesNotReject(stat(componentRoot), 'candidate F40 component directory must exist')
const contractPath = join(componentRoot, 'contracts.mjs')
await assert.doesNotReject(stat(contractPath), 'candidate F40 contract module must exist')
await readFile(contractPath) // read the exact candidate bytes before executing them

const { createCodexEvidence, usageBreakdown } = await import(pathToFileURL(contractPath).href)
assert.equal(usageBreakdown({ inputTokens: -1, outputTokens: 0 }).inputTokens, null)
const evidence = createCodexEvidence({ binding: { taskId: 'task-offline', attemptId: 'attempt-offline', location: 'local' },
  operationId: 'operation-offline', botId: 'bot-offline', requestedModel: 'gpt-offline',
  entry: { path: '/offline/not-executed', sha256: 'a'.repeat(64), version: '0.163.0' } })
assert.equal(evidence.snapshot().usage.status, 'unknown')
assert.equal(evidence.snapshot().billing.amountUsd, null)
assert.equal(evidence.snapshot().identity.actualResponseModelVerified, false)
assert.throws(() => evidence.bindThread({ thread: { id: 't' }, model: 'other', modelProvider: 'openai' }), /IDENTITY_MISMATCH/)
evidence.bindThread({ thread: { id: 't' }, model: 'gpt-offline', modelProvider: 'openai' })
const event = { method: 'thread/tokenUsage/updated', params: { threadId: 't', turnId: 'turn-1',
  tokenUsage: { total: { inputTokens: 20, outputTokens: 3, cachedInputTokens: 4, cacheWriteInputTokens: 0, reasoningOutputTokens: 1, totalTokens: 23 } } } }
evidence.event(event); evidence.event(event)
evidence.event({ ...event, params: { ...event.params, threadId: 'another' } })
assert.equal(evidence.snapshot().usage.totalTokens, 23)
assert.equal(evidence.snapshot().receiptId, 'codex:operation-offline:t:turn-1')
assert.equal(evidence.snapshot().usage.status, 'complete')

process.stdout.write(`${JSON.stringify({
  regression: 'F40-cli-runtime-contract',
  candidateRoot,
  candidate,
  checks: ['unknown-usage', 'subscription-not-usd', 'exact-model', 'cumulative-dedup', 'cross-thread-isolation'],
})}\n`)
