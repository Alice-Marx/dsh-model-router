import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { inspectAntigravityEntry, isAntigravityInitializeResult, provisionAntigravityRuntime, probeAntigravityVersion, verifyAntigravityEntry } from '../packages/bot-engines/src/antigravity-runtime.mjs'
import { pinAcpEntry } from '../packages/bot-acp/src/native-launch.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const initialized = { protocolVersion: 1, agentInfo: { name: 'antigravity-acp', version: 'agy_acp_server_1.5.0' }, authMethods: [{ id: 'oauth-personal' }] }
async function fixture() {
  const base = resolve('tmp/integration/antigravity-runtime'); await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, 'pair-')), home = join(root, 'home'); await mkdir(home)
  const executable = join(root, 'agy_acp_server.exe'), harness = join(root, 'localharness_external.exe')
  await writeFile(executable, 'fixture ACP server'); await writeFile(harness, 'fixture local harness')
  return { root, home, entry: { executable, harness, sha256: hash('fixture ACP server'), harnessSha256: hash('fixture local harness'), version: '1.5.0' } }
}

test('Antigravity runtime pins both files and refuses script wrappers or changed harness bytes', async () => {
  const { entry } = await fixture()
  assert.equal((await verifyAntigravityEntry(entry)).harness, entry.harness)
  await assert.rejects(verifyAntigravityEntry({ ...entry, script: '/wrapper.js' }), { code: 'ANTIGRAVITY_ENTRY_INVALID' })
  await writeFile(entry.harness, 'changed local harness')
  await assert.rejects(verifyAntigravityEntry(entry), { code: 'ANTIGRAVITY_ENTRY_CHANGED' })
})

test('Antigravity profile uses the selected private OAuth account and fixed harness without ambient API credentials', async () => {
  const { entry, home } = await fixture()
  await assert.rejects(provisionAntigravityRuntime(home, { entry }), { code: 'ANTIGRAVITY_ACCOUNT_REQUIRED' })
  const tokenPath = join(home, '.gemini/antigravity-acp/acp_token.json')
  await writeFile(tokenPath, JSON.stringify({ token: 'offline-fixture-account' }))
  const result = await provisionAntigravityRuntime(home, { entry, model: 'gemini-fixture' })
  assert.equal(result.env.GEMINI_HOME, join(home, '.gemini'))
  assert.equal(result.env.ANTIGRAVITY_HARNESS_PATH, entry.harness)
  assert.equal(result.env.AGY_ACP_DEFAULT_MODEL, 'gemini-fixture')
  assert.equal(result.env.GEMINI_API_KEY, undefined); assert.equal(result.env.GOOGLE_API_KEY, undefined)
  assert.deepEqual(JSON.parse(await readFile(join(home, '.gemini/antigravity-acp/settings.json'), 'utf8')), { auth: { type: 'oauth-personal' } })
  assert.equal(JSON.parse(await readFile(tokenPath, 'utf8')).token, 'offline-fixture-account')
})

test('Antigravity version proof sends initialize only and waits for confirmed native stop', async () => {
  const { entry, home } = await fixture(), frames = [], launches = []
  const launcher = {
    async probe() { return { available: true, helper: {} } }, async protect() {},
    supervise(_helper, mode, spec, launch) {
      assert.equal(mode, 'supervise'); launches.push({ spec, launch })
      const events = new EventEmitter()
      return { events, waitControl: async name => name === 'spawned' ? { control: 'spawned' } : { control: 'stopped', treeStopped: true },
        async send(frame) { frames.push(frame); queueMicrotask(() => events.emit('message', { jsonrpc: '2.0', id: frame.id, result: initialized })) },
        end() { events.emit('control', { control: 'stopped', treeStopped: true }) } }
    },
  }
  assert.equal(await probeAntigravityVersion(entry, home, { launcher }), 'antigravity-acp 1.5.0')
  assert.deepEqual(frames.map(frame => frame.method), ['initialize'])
  assert.equal(launches[0].launch.env.ANTIGRAVITY_HARNESS_PATH, entry.harness)
  assert.equal(launches[0].launch.env.GEMINI_API_KEY, undefined)
  const pinned = await pinAcpEntry(entry, home, { versionProbe: (selected, directory) => probeAntigravityVersion(selected, directory, { launcher }) })
  assert.equal(pinned.version, '1.5.0'); assert.equal(pinned.path, entry.executable)
  await assert.rejects(pinAcpEntry(entry, home, { versionProbe: '--shell-command' }), /ACP_VERSION_PROBE_INVALID/)
})

test('Antigravity initialize version and OAuth identity must match exactly; relative entries fail before launching', async () => {
  assert.equal(isAntigravityInitializeResult(initialized, '1.5.0'), true)
  assert.equal(isAntigravityInitializeResult(initialized, '1.4.3'), false)
  assert.equal(isAntigravityInitializeResult({ ...initialized, authMethods: [{ id: 'gemini-api-key' }] }, '1.5.0'), false)
  await assert.rejects(inspectAntigravityEntry({ executable: 'agy.exe', harness: 'harness.exe', version: '1.5.0' }, { root: resolve('tmp/integration') }), { code: 'ANTIGRAVITY_ENTRY_INVALID' })
})
