import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * These assertions guard the parts of "CLI 子任务化" that already exist, so a later refactor
 * cannot quietly drop them: an official CLI run must be a task backend, and its receipt must
 * keep the requested model and the model the CLI actually reported apart.
 */

const read = path => readFile(path, 'utf8')

test('cli as a task: the composition registers a CLI backend next to the model backend', async () => {
  const source = await read('packages/orchestration/src/product-composition.mjs')
  assert.match(source, /CLI_BACKEND/, 'CLI backend constant must stay registered')
  assert.match(source, /backends\.push\(backend\(CLI_BACKEND/, 'the CLI backend must join the task service backends')
  assert.match(source, /createCliReadBackend\(/, 'the local CLI backend factory must stay wired')
  assert.match(source, /createRemoteCliTaskBackend\(/, 'the remote CLI backend factory must stay wired')
})

test('cli as a task: the backend declares a capability the authority can grant', async () => {
  const source = await read('packages/orchestration/src/cli-execution.mjs')
  assert.match(source, /id:\s*'codex-read'/)
  assert.match(source, /capability:\s*'cli\/codex'/)
  assert.match(source, /retryCapability:\s*'cli\/retry'/)
  assert.match(source, /reconcileCapability:\s*'cli\/read'/)
  // A backend that cannot be parsed or reconciled would let an unknown run be replayed.
  assert.match(source, /parse/)
  assert.match(source, /async run\(context\)/)
  assert.match(source, /reconcile:/)
})

test('cli as a task: the receipt keeps requested and actual model apart', async () => {
  const source = await read('packages/orchestration/src/cli-execution.mjs')
  // The receipt starts with an explicit null: an unknown actual model is never the requested one.
  assert.match(source, /actualModel:null/)
  assert.match(source, /receipt\.actualModel=reportedModel/)
  // A reroute reported by the CLI invalidates the run instead of being accepted silently.
  assert.match(source, /reportedCliModel===requestedModel/)
  assert.match(source, /verification!=='mismatch'/)
  assert.match(source, /reroutes\?\?\[\]\).some\(row=>row\.toModel!==requestedModel\)/)
})

test('cli as a task: the receipt schema allows an unknown actual model but not an invented one', async () => {
  const source = await read('packages/orchestration/src/model-receipt.mjs')
  assert.match(source, /'actualModel'/)
  assert.match(source, /r\.actualModel!==null&&\(typeof r\.actualModel!=='string'/)
})
