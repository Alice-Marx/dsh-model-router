import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createMuseEngine } from '../packages/bot-engines/src/muse-engine.mjs'
import { createFixtureNativeLauncher, nativeRpcFixtureEntry } from './helpers/native-rpc-fixture-launcher.mjs'

test('Muse uses its MSP command identity for two real retained native turns and keeps reported usage', async () => {
  const root = resolve('tmp/integration/muse-chat'); await mkdir(root, { recursive: true }); const home = await mkdtemp(join(root, 'case-')), workspace = join(home, 'work'); await mkdir(workspace)
  let launches = 0
  const engine = await createMuseEngine({ authority: { describe: () => ({ botId: 'bot', revision: 1 }), assertModel() {} }, subject: {}, binding: { taskId: 'task', attemptId: 'attempt', machineId: 'machine', workspaceId: 'workspace', location: 'local' },
    operationId: 'muse-fixture', entry: await nativeRpcFixtureEntry(resolve('tests/fixtures/muse-chat-fixture.mjs')), runtimeRoot: home, workspace,
    model: { catalogProvider: 'muse', catalogModel: 'muse-fixture' }, launcher: createFixtureNativeLauncher({ onLaunch() { launches++ } }), deadlineMs: 15000 })
  try {
    const first = await engine.submitTurn({ text: 'first' }), second = await engine.submitTurn({ text: 'second' })
    assert.equal(first.ok, true); assert.equal(second.ok, true)
    assert.equal(first.text, 'muse-1: first'); assert.equal(second.text, 'muse-2: second'); assert.equal(first.sessionId, second.sessionId); assert.equal(launches, 1)
    assert.deepEqual(first.usage, { input: 12, output: 3, cachedInput: 0 }); assert.equal(first.costUsd, null)
  } finally { await engine.stop() }
})
