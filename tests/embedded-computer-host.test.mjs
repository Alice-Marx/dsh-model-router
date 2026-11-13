import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import net from 'node:net'
import { openEmbeddedComputerHost } from '../packages/orchestration/src/embedded-computer-host.mjs'
import { connectSecureTransport } from '../modules/openmaus-protocol/transport.mjs'
import { Store } from '../remote-computer-agent/dist/index.mjs'

const owner = { kind: 'owner' }
async function fixture(t, extra = {}) {
  const base = resolve('tmp/integration/embedded-computer'); await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, 'case-')), dataRoot = join(root, 'host'), sharedDirectory = join(root, 'shared')
  await mkdir(sharedDirectory)
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  const options = { Database, dataRoot, protectedRoot: dataRoot, protect: async () => {}, ...extra }
  const host = await openEmbeddedComputerHost(options); t.after(() => host.close())
  const input = { expectedRevision: 0, name: 'Embedded target', listenAddress: '127.0.0.1', port, sharedDirectory, allowWrite: false, allowDesktop: false, enabled: true }
  return { root, dataRoot, sharedDirectory, port, host, input, options }
}
async function pair(host, revision) {
  const invitation = await host.invite({ expectedRevision: revision }, owner), { invite, code } = invitation
  assert.equal(Object.hasOwn(invite, 'code'), false)
  const channel = await connectSecureTransport({ endpoint: invite.endpoint, transport: invite.transport, token: invite.token })
  try {
    const response = await channel.fetch('/pair/v2/redeem', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'pair-embedded-once', code }) })
    assert.equal(response.status, 200)
    return { ...await response.json(), invite, invitation }
  } finally { channel.close() }
}
const request = async (channel, path, token, body) => {
  const response = await channel.fetch(path, { headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' }, body: JSON.stringify(body) })
  return { response, value: await response.json() }
}

test('embedded Agent remains off by default and every configuration/secret surface requires an owner', async t => {
  let starts = 0
  const { host, input, dataRoot } = await fixture(t, { runtimeFactory: async () => { starts++; throw Error('not expected') } })
  const initial = await host.status({}, owner); assert.equal(initial.state, 'disabled'); assert.equal(initial.revision, 0); assert.equal(starts, 0)
  for (const name of ['status', 'configure', 'start', 'stop', 'invite', 'devices', 'revoke']) await assert.rejects(host[name](name === 'configure' ? input : {}, { kind: 'bot' }), { code: 'REMOTE_OWNER_REQUIRED' })
  await assert.rejects(host.configure({ ...input, endpoint: 'http://user:secret@example.com' }, owner), { code: 'LOCAL_COMPUTER_ENDPOINT_INVALID' })
  await assert.rejects(host.configure({ ...input, sharedDirectory: dataRoot }, owner), { code: 'LOCAL_COMPUTER_PRIVATE_DIRECTORY' })
  await assert.rejects(openEmbeddedComputerHost({ Database, dataRoot, protect: async () => {} }), { code: 'LOCAL_COMPUTER_LOCKED' })
  assert.equal(starts, 0)
})

test('two plugin endpoints pair over actual Noise and serve only the approved shared files', { timeout: 30000 }, async t => {
  const { host, input, sharedDirectory, dataRoot } = await fixture(t)
  await writeFile(join(sharedDirectory, 'hello.txt'), 'EMBEDDED-PLUGIN-OK')
  const running = await host.configure(input, owner); assert.equal(running.state, 'running'); assert.equal(running.listening, true)
  assert.equal((await fetch(running.config.endpoint + '/control/v1/grants', { method: 'POST', body: '{}' })).status, 426, 'plaintext requests cannot bypass Noise')
  const paired = await pair(host, running.revision)
  assert.match(paired.invitation.qrDataUrl, /^data:image\/png;base64,/)
  assert.ok(!JSON.stringify(await host.status({}, owner)).includes(paired.token)); assert.ok(!JSON.stringify(await host.devices({}, owner)).includes(paired.token))
  const channel = await connectSecureTransport({ endpoint: input.endpoint || `http://127.0.0.1:${input.port}`, transport: paired.transport, token: paired.token }); t.after(() => channel.close())
  const grant = { botId: 'remote-main', taskId: 'read-task', attemptId: 'first', roots: ['shared'], tools: ['fs_list', 'fs_read'], ttlMs: 10000 }
  const granted = await request(channel, '/control/v1/grants', paired.token, grant); assert.equal(granted.response.status, 200)
  const result = await request(channel, '/mcp', granted.value.grantToken, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fs_read', arguments: { rootId: 'shared', relativePath: 'hello.txt' } } })
  const read = result.value.result.structuredContent ?? JSON.parse(result.value.result.content[0].text)
  assert.equal(Buffer.from(read.content, 'base64').toString(), 'EMBEDDED-PLUGIN-OK')
  const denied = await request(channel, '/control/v1/grants', paired.token, { ...grant, tools: ['fs_write'] }); assert.equal(denied.response.status, 403)
  const list = await host.devices({}, owner); assert.equal(list.items.filter(x => !x.revoked).length, 1)
  await host.revoke({ id: paired.clientId, revision: list.items[0].revision }, owner)
  await channel.closed
  await assert.rejects(connectSecureTransport({ endpoint: running.config.endpoint, transport: paired.transport, token: paired.token, timeoutMs: 500 }))
  const bytes = await readFile(join(dataRoot, 'agent/agent.sqlite')); assert.equal(bytes.includes(Buffer.from(paired.token)), false); assert.equal(bytes.includes(Buffer.from(paired.invite.token)), false)
  await host.stop({ expectedRevision: running.revision }, owner); assert.equal((await host.status({}, owner)).listening, false)
})

test('restart retains device identity; saving another scope revokes old peers instead of retargeting them', { timeout: 30000 }, async t => {
  const { host, input, options } = await fixture(t)
  const initial = await host.configure(input, owner), paired = await pair(host, initial.revision)
  await assert.rejects(host.configure(input, owner), { code: 'LOCAL_COMPUTER_CONFLICT' })
  await host.close()
  const reopened = await openEmbeddedComputerHost(options); t.after(() => reopened.close())
  let value
  for (let i = 0; i < 100; i++) { value = await reopened.status({}, owner); if (value.state === 'running' || value.state === 'failed') break; await new Promise(resolve => setTimeout(resolve, 20)) }
  assert.equal(value.state, 'running'); assert.equal(value.machineId, initial.machineId)
  const channel = await connectSecureTransport({ endpoint: value.config.endpoint, transport: paired.transport, token: paired.token }); t.after(() => channel.close())
  const changed = await reopened.configure({ ...input, expectedRevision: value.revision, allowWrite: true }, owner)
  assert.equal(changed.state, 'running'); assert.equal((await reopened.devices({}, owner)).items.every(x => x.revoked), true)
  await channel.closed
  const invitation = await reopened.invite({ expectedRevision: changed.revision }, owner)
  assert.ok(invitation.invite.ceiling.tools.includes('fs_write'))
})

test('a stopped listener invalidates pending invitations', async t => {
  const { host, input, dataRoot } = await fixture(t)
  const running = await host.configure(input, owner), invitation = await host.invite({ expectedRevision: running.revision }, owner)
  await host.stop({ expectedRevision: running.revision }, owner)
  const store = new Store(join(dataRoot, 'agent'), Database, { admin: true })
  try { assert.equal(store.db.prepare('SELECT attempts_left FROM pairing_invites WHERE id=?').get(invitation.invite.inviteId).attempts_left, 0) } finally { store.close() }
  await assert.rejects(host.invite({ expectedRevision: 2 }, owner), { code: 'LOCAL_COMPUTER_NOT_RUNNING' })
})

test('unknown stop evidence stays visible and refuses a settings change', async t => {
  let stops = 0
  const { host, input } = await fixture(t, { runtimeFactory: async () => ({ machineId: 'synthetic-only', health: () => ({ listening: true, desktopReady: false }),
    stop: async () => { if (++stops <= 2) throw Object.assign(new Error('LOCAL_COMPUTER_STOP_UNCONFIRMED'), { code: 'LOCAL_COMPUTER_STOP_UNCONFIRMED' }); return { treeStopped: true } } }) })
  const running = await host.configure(input, owner)
  await assert.rejects(host.stop({ expectedRevision: running.revision }, owner), { code: 'LOCAL_COMPUTER_STOP_UNCONFIRMED' })
  const status = await host.status({}, owner); assert.equal(status.state, 'needs-attention'); assert.equal(status.listening, true)
  await assert.rejects(host.configure({ ...input, expectedRevision: status.revision, allowWrite: true }, owner), { code: 'LOCAL_COMPUTER_STOP_UNCONFIRMED' })
  assert.equal((await host.status({}, owner)).config.allowWrite, false)
})
