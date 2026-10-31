import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile, copyFile, chmod, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuthority, PolicyError } from '../packages/capability-broker/src/authority.mjs'
import { createCodexSession } from '../packages/cli-runtime/src/codex-runtime.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const flags = process.argv.slice(2)
const flag = name => { const index = flags.indexOf(name); return index >= 0 ? flags[index + 1] : null }
const real = flags.includes('--real-gpt')
const modelsOnly = flags.includes('--models-only')
const executable = flag('--entry')
if (!executable) throw new Error('Usage: --entry <installation-verified-native-codex> [--real-gpt --credential-file <opaque-private-reference> --model <available-gpt-model>]')
const parent = join(ROOT, 'tmp/integration/cli-runtime')
await mkdir(parent, { recursive: true })
const root = await mkdtemp(join(parent, 'p-'))
const workspace = join(root, 'w'); await mkdir(workspace)
const sha256 = createHash('sha256').update(await readFile(executable)).digest('hex')
const authority = createAuthority()
const actor = {}
const model = flag('--model') ?? 'gpt-5.4-mini'
const binding = { taskId: 'cli-probe', attemptId: 'attempt-1', machineId: 'local-probe', workspaceId: 'probe-workspace', location: 'local' }
authority.register(actor, { botId: 'probe-bot', tools: ['task_ping'], modelRoutes: [{ provider: 'openai', model }] })
let calls = 0, provisionedHome
const progress = []
const empty = value => { if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length) throw new PolicyError('INVALID_ARGUMENTS'); return {} }
let session
try {
session = await createCodexSession({ authority, subject: actor, binding, operationId: 'probe-1',
  runtimeRoot: root, workspace, requestedModel: model, entry: { executable: resolve(executable), sha256, version: flag('--version') ?? '0.163.0' },
  deadlineMs: real ? 120_000 : 60_000,
  onProgress: value => { progress.push(value); if (progress.length > 512) progress.shift() },
  provisionCredentials: real || modelsOnly ? async home => {
    const source = flag('--credential-file'); if (!source) throw new Error('PRIVATE_CREDENTIAL_REFERENCE_REQUIRED')
    await copyFile(source, join(home, 'auth.json')); await chmod(join(home, 'auth.json'), 0o600); provisionedHome = home
  } : undefined,
  tools: ['task_ping'], handlers: [{ definition: { name: 'task_ping', description: 'Return a task-local offline marker', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    parse: empty, execute: (_args, { binding }) => { calls++; return { marker: 'task-owned', taskId: binding.taskId, attemptId: binding.attemptId } } }] })
  const inventory = await session.listCapabilities()
  await writeFile(join(root, 'inventory.json'), JSON.stringify({ inventory, snapshot: session.snapshot() }, null, 2) + '\n')
  assert.equal(inventory.data.length, 1)
  assert.equal(inventory.data[0].name, 'dsh_task')
  assert.deepEqual(Object.keys(inventory.data[0].tools).sort(), ['task_ping'])
  const ping = await session.callCapability('task_ping')
  assert.notEqual(ping.isError, true)
  assert.equal(calls, 1)
  await assert.rejects(session.callCapability('other_bot_secret'), /TOOL_DENIED/)
  const spoof = await session.callCapability('task_ping', { botId: 'other-bot' })
  assert.equal(spoof.isError, true)
  assert.equal(calls, 1)
  let modelResult = null
  if (modelsOnly || real) {
    const catalog = await session.listModels()
    const models = catalog.data.map(value => ({ id: value.id, model: value.model, displayName: value.displayName, isDefault: value.isDefault }))
    await writeFile(join(root, 'models.json'), JSON.stringify({ models }, null, 2) + '\n')
    if (modelsOnly) process.stdout.write(JSON.stringify({ kind: 'real-codex-model-catalog', cliTurnRequestsDispatched: 0, actualProviderRequestCount: 0, models }, null, 2) + '\n')
    if (real) assert.equal(models.some(value => value.model === model || value.id === model), true, 'Requested GPT model must exist in the actual CLI catalog')
  }
  if (real) {
    modelResult = await session.run('Reply with exactly OK. Do not use any tools.')
    assert.equal(modelResult.status, 'succeeded')
    assert.match(modelResult.identity.reportedCliModel, /^gpt-/)
    assert.equal(modelResult.identity.reportedCliModel, model)
    assert.equal(modelResult.usage.reported, true)
    assert.equal(modelResult.finalText.trim(), 'OK')
  }
  authority.revoke(actor)
  try { const revoked = await session.callCapability('task_ping'); assert.equal(revoked.isError, true) }
  catch (error) { assert.match(error.message, /CLI_(STOPPING|CLOSED|GRANT_REVOKED|EXITED)/) }
  assert.equal(calls, 1)
  const stopped = await session.close()
  assert.equal(stopped.treeStopped, true)
  const snapshot = session.snapshot()
  const result = { status: 'passed', kind: real ? 'real-gpt-cli' : 'real-codex-non-inference', cliTurnRequestsDispatched: snapshot.cliTurnRequestsDispatched,
    actualProviderRequestCount: snapshot.actualProviderRequestCount, actualProviderRequestCountStatus: snapshot.actualProviderRequestCountStatus,
    modelIdentity: snapshot.identity, usage: snapshot.usage, entry: { sha256, version: snapshot.entry.version, filename: basename(executable) },
    nativePeer: snapshot.bridge.peer, scopedTools: ['task_ping'], spoofedArgumentsRejected: true, revokedCallRejected: true,
    bearerInArgvOrEnv: false, stopEvidence: stopped, receiptId: snapshot.receiptId,
    limitations: [...snapshot.limitations, ...snapshot.capabilityProbe.limitations] }
  await writeFile(join(root, 'summary.json'), JSON.stringify(result, null, 2) + '\n')
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
} catch (error) {
  await session?.close()
  const snapshot = session?.snapshot()
  const failure = { status: 'failed', kind: real ? 'real-gpt-cli' : 'real-codex-non-inference', error: error.message,
    cliTurnRequestsDispatched: snapshot?.cliTurnRequestsDispatched ?? 0, actualProviderRequestCount: snapshot?.actualProviderRequestCount ?? null,
    modelIdentity: snapshot?.identity ?? null, usage: snapshot?.usage ?? null, failure: snapshot?.failure ?? null,
    stopEvidence: snapshot?.stopEvidence ?? null, nativePeer: snapshot?.bridge?.peer ?? error.bridgeEvidence?.peer ?? null, progress }
  await writeFile(join(root, 'summary.json'), JSON.stringify(failure, null, 2) + '\n')
  process.stdout.write(JSON.stringify(failure, null, 2) + '\n'); process.exitCode = 1
} finally {
  await session?.close(); authority.dispose()
  if (provisionedHome) await rm(join(provisionedHome, 'auth.json'), { force: true })
}
