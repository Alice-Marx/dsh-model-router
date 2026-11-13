import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createAcpChatEngine } from '../packages/bot-engines/src/acp-chat-engine.mjs'
import { acpChatArgs, CLI_CHAT_DRIVERS } from '../packages/bot-engines/src/cli-driver-specs.mjs'
import { createFixtureNativeLauncher, nativeRpcFixtureEntry } from './helpers/native-rpc-fixture-launcher.mjs'

const script = resolve('tests/fixtures/bot-acp-agent-fixture.mjs')
for (const driver of CLI_CHAT_DRIVERS.filter(driver => driver.transport === 'acp' && driver.available && driver.implemented && !['antigravityAgent', 'deepseekAgent'].includes(driver.id))) test(`${driver.name}: real ACP process retains two turns with fixed argv and exact model selection`, async () => {
  const root = resolve('tmp/integration/acp-chat-drivers'); await mkdir(root, { recursive: true }); const home = await mkdtemp(join(root, driver.id + '-')), workspace = join(home, 'work'); await mkdir(workspace)
  let launches = 0
  const authority = { describe: () => ({ botId: 'bot', revision: 1 }), assertModel(_subject, provider, model) { assert.equal(provider, 'fixture'); assert.equal(model, 'fixture-model-a') } }
  const engine = await createAcpChatEngine({ driver: driver.id, model: 'fixture-model-a' }, { authority, subject: {}, binding: { taskId: 'task', attemptId: 'attempt', machineId: 'machine', workspaceId: 'workspace', location: 'local' },
    operationId: 'fixture-op', entry: await nativeRpcFixtureEntry(script, process.versions.node), runtimeRoot: home, workspace,
    model: { catalogProvider: 'fixture', catalogModel: 'fixture-model-a' }, launcher: createFixtureNativeLauncher({ onLaunch() { launches++ } }), deadlineMs: 15_000,
    provisionCredentials: async () => ({ env: {} }) })
  try {
    const first = await engine.submitTurn({ text: 'first' }), second = await engine.submitTurn({ text: 'second' })
    assert.equal(first.ok, true); assert.equal(second.ok, true); assert.equal(first.sessionId, second.sessionId); assert.equal(launches, 1)
    const evidence = JSON.parse(await readFile(join(workspace, 'fixture-evidence.json'), 'utf8'))
    assert.deepEqual(evidence.argv, acpChatArgs(driver.id, 'fixture-model-a')); assert.equal(evidence.turns.length, 2)
    assert.equal(engine.snapshot().model.reportedModel, 'fixture-model-a')
  } finally { await engine.stop() }
})
