import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createPiEngine } from '../packages/bot-engines/src/pi-engine.mjs'
import { nativeRpcFixtureEntry } from './helpers/native-rpc-fixture-launcher.mjs'

test('native RPC chat runs two turns under the real supervisor and reports actual tree-stop evidence', { timeout: 120_000 }, async () => {
  const root = resolve('tmp/integration/native-chat-supervisor'); await mkdir(root, { recursive: true })
  const home = await mkdtemp(join(root, 'case-')), workspace = join(home, 'workspace'); await mkdir(workspace)
  const runtimeRoot = process.platform === 'win32' ? join(home, 'deep-' + 'x'.repeat(Math.max(1, 270 - home.length - 6))) : home
  await mkdir(runtimeRoot, { recursive: true })
  if (process.platform === 'win32') assert.ok(runtimeRoot.length >= 270, 'exercise a real native session beyond MAX_PATH')
  let privateHome
  const authority = { describe: () => ({ botId: 'native-fixture', revision: 1 }), assertModel(_subject, provider, model) { assert.equal(provider, 'pi'); assert.equal(model, 'fixture/model') } }
  const engine = await createPiEngine({ authority, subject: {}, binding: { taskId: 'task', attemptId: 'attempt', machineId: 'machine', workspaceId: 'workspace', location: 'local' },
    operationId: 'native-supervisor', entry: await nativeRpcFixtureEntry(resolve('tests/fixtures/native-chat-protocol-fixture.mjs')),
    runtimeRoot, workspace, model: { catalogProvider: 'pi', catalogModel: 'fixture/model' }, deadlineMs: 100_000,
    provisionCredentials: async home => { privateHome = home } })
  try {
    const first = await engine.submitTurn({ text: 'first' }), pid = engine.snapshot().process?.pid
    assert.ok(Number.isInteger(pid) && pid > 0); assert.equal(first.text, 'turn-1: first'); assert.equal(first.ok, true)
    if (process.platform === 'win32') assert.ok(privateHome.length <= 210, 'the actual protected profile uses a short private directory')
    assert.equal((await engine.submitTurn({ text: 'second' })).text, 'turn-2: second')
    assert.equal(engine.snapshot().process.pid, pid)
    const proof = await engine.stop()
    assert.equal(proof.status, 'confirmed'); assert.equal(proof.treeStopped, true)
    assert.equal(engine.snapshot().process, null)
  } finally { await engine.stop() }
})
