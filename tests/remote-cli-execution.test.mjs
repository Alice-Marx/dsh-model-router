import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import Database from 'better-sqlite3'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createPrincipalDirectory } from '../packages/orchestration/src/principals.mjs'
import { openSqliteRouterState } from '../packages/orchestration/src/sqlite-router-state.mjs'
import { createTaskService } from '../packages/orchestration/src/task-service.mjs'
import { createRemoteCliReadBackend } from '../packages/orchestration/src/remote-cli-execution.mjs'
import { parseRemoteTaskCli, taskHash } from '../packages/orchestration/src/task-contract.mjs'
import { createRouterState } from '../.dsh-plugin/shared/router-state.mjs'
import { normalizeTaskCli } from '../packages/orchestration/src/product-composition.mjs'
import { createCodexSession } from '../packages/cli-runtime/src/codex-runtime.mjs'
import { Config } from '../.dsh-plugin/index.mjs'

const model = { provider: 'fixture', model: 'gpt-exact' }
const profile = { machineId: 'machine-a', rootId: 'project', profileId: 'codex-profile', profileRevision: 3, entry: { sha256: 'a'.repeat(64), version: '1.2.3' } }
const input = { machineId: 'machine-a', rootId: 'project', workspaceRelativePath: 'work', task: 'offline remote task' }
const tools = ['task/submit','task/execute','task/read','task/cancel','task/retry','task/reconcile','cli/codex','cli/read','cli/cancel','cli/retry','remote/cli_probe_v1','remote/cli_task_v1','remote/operation_status','remote/operation_cancel']
const workspaceId = 'remote_' + taskHash({ rootId: 'project', workspaceRelativePath: 'work', profileId: profile.profileId, profileRevision: 3, entrySha256: profile.entry.sha256, entryVersion: profile.entry.version })

test('real SDK plugin schema accepts remote-only CLI configuration without Zod APIs', () => {
  assert.equal(Config({}).taskCli, undefined)
  const config = Config({ taskCli: { remote: [profile], models: [{ ...model, cliModel: 'gpt-exact' }] } })
  assert.equal(config.taskCli.entry, undefined)
  assert.equal(normalizeTaskCli(config.taskCli).remote[0].profileRevision, 3)
  for (const profileRevision of [0, -1, 1.5]) {
    assert.throws(() => Config({ taskCli: { remote: [{ ...profile, profileRevision }] } }))
  }
  const extra = Config({ taskCli: { remote: [{ ...profile, executable: 'untrusted' }] } })
  assert.throws(() => normalizeTaskCli(extra.taskCli), /TASK_CLI_REMOTE_PROFILE_INVALID/)
  const extraEntry = Config({ taskCli: { remote: [{ ...profile, entry: { ...profile.entry, executable: 'untrusted' } }] } })
  assert.throws(() => normalizeTaskCli(extraEntry.taskCli), /TASK_CLI_REMOTE_PROFILE_INVALID/)
})

function receipt(context, patch = {}) {
  const stopEvidence = { control: 'stopped', pid: 41, exitCode: 0, treeStopped: true, containment: 'fixture-native-tree', ...patch.stopEvidence }
  return { schemaVersion: 1, source: 'cli', toolId: 'codex', botId: 'bot-a', taskId: context.taskId, attemptId: context.attemptId,
    machineId: 'machine-a', workspaceId, location: 'remote', operationId: context.operationId, receiptId: `codex:${context.operationId}:thread:turn`,
    entry: { path: 'F:\\agent\\remote-codex-launcher.exe', ...profile.entry },
    remote: { rootId: 'project', workspaceRelativePath: 'work', profileId: profile.profileId, profileRevision: 3,
      workspaceIdentity: { key: 'b'.repeat(64), path: 'F:\\agent-root\\work', platform: 'win32' } },
    identity: { catalogProvider: model.provider, catalogModel: model.model, requestedCliModel: 'gpt-exact', reportedCliModel: 'gpt-exact', reportedProvider: 'openai', actualResponseModel: null, verification: 'cli-configured-model', actualResponseModelVerified: false, reroutes: [] },
    usage: { inputTokens: 20, outputTokens: 5, cachedInputTokens: 4, cacheWriteInputTokens: 0, reasoningOutputTokens: 1, totalTokens: 25, reported: true, status: 'complete' },
    billing: { kind: 'subscription', amountUsd: null, amountStatus: 'not-applicable' }, terminal: 'completed', finalText: 'remote fixture output',
    cliTurnRequestsDispatched: 1, actualProviderRequestCount: null, stopEvidence, ...patch }
}

async function fixture(t, options = {}) {
  const parent = resolve('tmp/integration/remote-cli-unit'); await mkdir(parent, { recursive: true })
  const dir = await mkdtemp(join(parent, 'case-')), file = join(dir, 'host.sqlite'), legacyFile = join(dir, 'legacy.json')
  await createRouterState({ file: legacyFile }).saveHealth(null)
  const store = await openSqliteRouterState({ Database, file, legacyFile })
  const authority = createAuthority(), directory = createPrincipalDirectory(authority)
  directory.register('bot-a', { tools, modelRoutes: [model] })
  const subject = directory.forBot('bot-a'), calls = []
  const machines = {
    taskTarget(_subject, value) {
      assert.equal(value.machineId, profile.machineId); assert.equal(value.rootId, profile.rootId); assert.equal(value.profileRevision, 3)
      return { machineId: value.machineId, rootId: value.rootId, remoteMachineRevision: 2, remoteBindingRevision: 5 }
    },
    async call(_subject, value) {
      calls.push(value)
      if (value.tool === 'cli_probe_v1') return { schemaVersion: 1, kind: 'remote-cli-probe', status: 'available', location: 'remote', machineId: 'machine-a', rootId: 'project', workspaceId,
        workspaceRelativePath: 'work', workspaceIdentity: { key: 'b'.repeat(64), path: 'F:\\agent-root\\work', platform: 'win32' }, profileId: profile.profileId, profileRevision: 3,
        entry: profile.entry, requestedModel: 'gpt-exact', loginStatus: 'unknown', versionStatus: 'available', dependencyStatus: 'available', nativeStatus: 'available', profileStatus: 'available', readinessStatus: 'available' }
      const context = { taskId: value.taskId, attemptId: value.attemptId, operationId: value.operationId }
      if (value.tool === 'operation_status' && options.rateLimits > 0) {
        options.rateLimits--
        throw Object.assign(new Error('AUTH_RATE_LIMIT'), { code: 'AUTH_RATE_LIMIT', retryAfterMs: options.retryAfterMs ?? 1 })
      }
      if (value.tool === 'cli_task_v1' && options.drop) { options.drop = false; throw Object.assign(new Error('lost fixture response'), { code: 'MACHINE_CONNECTION_FAILED', remoteDispatchNotSent: false }) }
      if (value.tool === 'cli_task_v1' && options.poll) return { schemaVersion: 1, machineId: 'machine-a', operationId: value.operationId, tool: 'cli_task_v1', status: 'running', result: null, error: null }
      const resultReceipt = receipt(context, options.tamper?.(context) ?? {})
      const result = { kind: 'remote-cli', schemaVersion: 1, receipt: resultReceipt, stopConfirmed: resultReceipt.stopEvidence.treeStopped, stopEvidence: resultReceipt.stopEvidence, exitCode: resultReceipt.stopEvidence.exitCode }
      return { schemaVersion: 1, machineId: 'machine-a', operationId: value.operationId, tool: 'cli_task_v1', status: 'succeeded', result, error: null }
    },
  }
  const backend = createRemoteCliReadBackend({ machines: () => machines, directory, store, authority, profiles: [profile], model, requestedModel: 'gpt-exact', billing: options.billing ?? 'subscription',
    pricing: options.billing === 'api' ? { input: 1, output: 2 } : null, estimatedCostUsd: options.billing === 'api' ? 0.1 : null,
    dailyLimitUsd: options.dailyLimitUsd ?? 10, subscriptionMaxCalls: options.billing === 'api' ? null : 20, pollMs: 5 })
  const journal = store.openTaskJournal(), service = createTaskService({ journal, authority, directory, backends: [backend], runnerTtlMs: 1000, taskTtlMs: 5000 })
  service.start(); t.after(async () => { await service.close(); await backend.close(); await store.close(); authority.dispose() })
  const settled = async (task, state) => { for (let n = 0; n < 300; n++) { const row = service.get(subject, { taskId: task.taskId }); if (row.state === state) return row; await sleep(10) } assert.fail(`Task did not reach ${state}`) }
  return { store, authority, directory, subject, calls, backend, journal, service, settled, options }
}

test('remote CLI input and Host profile configuration are closed and remote-only', async () => {
  assert.deepEqual(parseRemoteTaskCli(input), input)
  for (const patch of [{ argv: ['node'] }, { entry: {} }, { profileId: 'other' }, { endpoint: 'http://127.0.0.1' }, { env: {} }, { model: 'gpt-other' }, { task: '' }, { task: 'x\0' }, { workspaceRelativePath: '../escape' }, { workspaceRelativePath: 'C:\\work' }]) {
    assert.throws(() => parseRemoteTaskCli({ ...input, ...patch }), /INVALID_/, JSON.stringify(patch))
  }
  const normalized = normalizeTaskCli({ remote: [profile], models: [{ provider: 'fixture', model: 'gpt-exact', cliModel: 'gpt-exact' }] })
  assert.equal(normalized.entry, null); assert.deepEqual(normalized.remote, [profile])
  assert.throws(() => normalizeTaskCli({ remote: [profile, { ...profile, profileId: 'another' }] }), /DUPLICATE/)
  assert.throws(() => normalizeTaskCli({ remote: [{ ...profile, credentialRef: 'secret' }] }), /REMOTE_PROFILE_INVALID/)
  await assert.rejects(createCodexSession({ binding: { location: 'remote' } }), /REMOTE_CLI_REQUIRES_REMOTE_AGENT/)
})

test('remote CLI unit: fixed target, probe identity, one Task/Agent operation and one subscription receipt', async t => {
  const f = await fixture(t), request = { requestKey: 'one', backend: 'remote-codex-read', input }
  const submitted = f.service.submit(f.subject, request), replay = f.service.submit(f.subject, request)
  assert.equal(replay.taskId, submitted.taskId); assert.equal(replay.operationId, submitted.operationId)
  const done = await f.settled(submitted, 'succeeded')
  assert.equal(done.result.summary.finalText, 'remote fixture output'); assert.equal(done.result.summary.stopEvidence, 'remote-native-tree')
  assert.equal(done.input.target.workspaceId, workspaceId); assert.equal(done.input.target.remoteBindingRevision, 5)
  assert.equal(f.calls.filter(call => call.tool === 'cli_task_v1').length, 1)
  const receipts = (await f.store.modelCalls()).items
  assert.equal(receipts.length, 1); assert.equal(receipts[0].id, `receipt-${submitted.operationId}`); assert.equal(receipts[0].usage.inputTokens, 16); assert.equal(receipts[0].usage.outputTokens, 5)
  const probed = await f.backend.probe(f.subject, input)
  assert.equal(probed.location, 'remote'); assert.equal(probed.loginStatus, 'unknown'); assert.equal(probed.workspaceId, workspaceId)
  assert.equal(f.calls.at(-1).args.executable, undefined); assert.equal(f.calls.at(-1).args.credentialRef, undefined)
})

test('remote CLI unit: dropped dispatch response reconciles the original receipt without a second operation', async t => {
  const f = await fixture(t, { drop: true }), task = f.service.submit(f.subject, { requestKey: 'drop', backend: 'remote-codex-read', input })
  await f.settled(task, 'needs-reconciliation')
  const done = await f.service.reconcile(f.subject, { taskId: task.taskId, requestKey: 'observe' })
  assert.equal(done.state, 'succeeded'); assert.equal(done.operationId, task.operationId)
  assert.equal(f.calls.filter(call => call.tool === 'cli_task_v1').length, 1)
  assert.equal((await f.store.modelCalls()).items.length, 1); assert.deepEqual((await f.store.read()).budgetReservations, {})
})

test('remote CLI unit: admitted asynchronous operation is polled and settled without another dispatch', async t => {
  const f = await fixture(t, { poll: true }), task = f.service.submit(f.subject, { requestKey: 'poll', backend: 'remote-codex-read', input })
  const done = await f.settled(task, 'succeeded')
  assert.equal(done.result.summary.stopConfirmed, true)
  assert.equal(f.calls.filter(call => call.tool === 'cli_task_v1').length, 1)
  assert.ok(f.calls.some(call => call.tool === 'operation_status'))
  assert.equal((await f.store.modelCalls()).items.length, 1)
})

test('remote CLI unit: bounded rate-limit observation retries preserve one dispatch and receipt', async t => {
  const f = await fixture(t, { poll: true, rateLimits: 2 }), task = f.service.submit(f.subject, { requestKey: 'rate-limit', backend: 'remote-codex-read', input })
  const done = await f.settled(task, 'succeeded')
  assert.equal(done.result.summary.stopConfirmed, true)
  assert.equal(f.calls.filter(call => call.tool === 'cli_task_v1').length, 1)
  assert.equal(f.calls.filter(call => call.tool === 'operation_status').length, 3)
  assert.equal((await f.store.modelCalls()).items.length, 1)
})

test('remote CLI unit: exhausted or malformed observation backoff remains unknown without redispatch', async t => {
  for (const retryAfterMs of [1, 0, -1, 60001, '1']) {
    const f = await fixture(t, { poll: true, rateLimits: 10, retryAfterMs }), task = f.service.submit(f.subject, { requestKey: 'rate-limit-invalid', backend: 'remote-codex-read', input })
    const done = await f.settled(task, 'needs-reconciliation')
    assert.equal(done.result.summary.failureCode, 'AUTH_RATE_LIMIT')
    assert.equal(f.calls.filter(call => call.tool === 'cli_task_v1').length, 1)
    assert.equal(f.calls.filter(call => call.tool === 'operation_status').length, retryAfterMs === 1 ? 3 : 1)
    const receipt = (await f.store.modelCalls()).items[0]
    assert.equal(receipt.state, 'running'); assert.equal(receipt.outcome, null)
    assert.ok((await f.store.read()).budgetReservations[receipt.runId])
  }
})

test('remote CLI unit: tampered machine, usage and stop evidence fail closed', async t => {
  for (const tamper of [() => ({ machineId: 'machine-b' }), () => ({ usage: { inputTokens: -1, outputTokens: 5, cachedInputTokens: null, cacheWriteInputTokens: null, reported: true, status: 'complete' } }), () => ({ stopEvidence: { treeStopped: false } })]) {
    const f = await fixture(t, { tamper }), task = f.service.submit(f.subject, { requestKey: 'tamper', backend: 'remote-codex-read', input })
    const done = await f.settled(task, 'needs-reconciliation')
    assert.equal(done.result.summary.stopConfirmed, false)
    const receipt = (await f.store.modelCalls()).items[0]
    assert.equal(receipt.state, 'running'); assert.equal(receipt.outcome, null); assert.ok((await f.store.read()).budgetReservations[receipt.runId])
  }
})

test('remote CLI unit: budget refusal happens before any Agent operation', async t => {
  const f = await fixture(t, { billing: 'api', dailyLimitUsd: 0.000001 }), task = f.service.submit(f.subject, { requestKey: 'budget', backend: 'remote-codex-read', input })
  await f.settled(task, 'waiting-budget'); assert.equal(f.calls.length, 0); assert.equal((await f.store.modelCalls()).items.length, 0)
})

test('remote CLI unit: API price unreported remains unknown rather than a settled zero or estimated charge', async t => {
  const f = await fixture(t, { billing: 'api', dailyLimitUsd: 10 }), task = f.service.submit(f.subject, { requestKey: 'api-unknown', backend: 'remote-codex-read', input })
  await f.settled(task, 'needs-reconciliation')
  const [receipt] = (await f.store.modelCalls()).items, [run] = (await f.store.read()).runs
  assert.equal(receipt.state, 'running'); assert.equal(receipt.outcome, null); assert.equal(receipt.reportedCostUsd, null)
  assert.equal(run.packages[0].costUsd, null); assert.equal(run.packages[0].costSource, 'cli-actual-price-unreported')
})
