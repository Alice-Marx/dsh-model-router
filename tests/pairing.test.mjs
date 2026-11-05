import test from 'node:test'
import assert from 'node:assert/strict'
import { needsTunnel, normalizeEndpoint, parsePairingPaste, secretNameFor } from '../apps/integration-client/pairing.mjs'

const token = 'hHsbTRU61DNY-28rZlwOM8NVJZfiR9vefyFauuROPYs'
const machineId = 'machine-91bda725-81ce-437e-b335-486456d4d617'

test('pairing: the JSON blob yields token, machineId and a secret name', () => {
  const value = parsePairingPaste(JSON.stringify({ clientId: 'host-10-0-0-2', token, machineId, secretRef: 'remote-agent/x/host-10-0-0-2' }))
  assert.equal(value.problems.length, 0)
  assert.equal(value.token, token)
  assert.equal(value.machineId, machineId)
  assert.equal(value.secretRef, 'remote-agent/x/host-10-0-0-2')
})

test('pairing: key/value lines work in any order, and a bare token is accepted', () => {
  const lines = parsePairingPaste(`machineId: ${machineId}\ntoken: ${token}`)
  assert.deepEqual(lines.problems, [])
  assert.equal(lines.secretRef, `ds-secret/${secretNameFor({ machineId })}`)
  const bare = parsePairingPaste(token)
  assert.equal(bare.token, token)
  assert.deepEqual(bare.problems, ['没有读到 machineId。'])
})

test('pairing: a short token or a missing machineId is named, not guessed', () => {
  assert.match(parsePairingPaste('{"token":"abc","machineId":"m1"}').problems.join(' '), /43 位/)
  assert.equal(parsePairingPaste('').problems.length, 1)
  assert.match(parsePairingPaste('{"token"').problems.join(' '), /JSON/)
})

test('pairing: the secret name is bounded and Host-shaped', () => {
  assert.equal(secretNameFor({ clientId: 'host-10-0-0-2' }), 'REMOTE_AGENT_HOST_10_0_0_2')
  assert.match(secretNameFor({}), /^REMOTE_AGENT_[A-Z0-9_]{1,50}$/u)
})

test('pairing: the endpoint accepts a host, host:port or URL, and rejects paths', () => {
  assert.equal(normalizeEndpoint('10.0.0.2').endpoint, 'http://10.0.0.2:9701')
  assert.equal(normalizeEndpoint('10.0.0.2:9800').endpoint, 'http://10.0.0.2:9800')
  assert.equal(normalizeEndpoint('https://pc.internal').endpoint, 'https://pc.internal:9701')
  assert.match(normalizeEndpoint('10.0.0.2/mcp').problem, /不要带路径/)
  assert.equal(needsTunnel('http://10.0.0.2:9701'), true)
  assert.equal(needsTunnel('http://127.0.0.1:9701'), false)
})

test('pairing: the setup file imports the actual endpoint, roots and ceiling without enabling absent command tools', () => {
  const value = parsePairingPaste(JSON.stringify({ token, machineId, endpoint: 'http://10.0.0.2:19701', rootIds: ['project'],
    tools: ['machine_ping', 'fs_read', 'desktop_screenshot'], protectedTunnel: true, hostManagedBots: true }))
  assert.deepEqual(value.problems, [])
  assert.equal(value.endpoint, 'http://10.0.0.2:19701')
  assert.deepEqual(value.rootIds, ['project'])
  assert.equal(value.hostManagedBots, true)
  assert.equal(value.protectedTunnel, true)
  assert.equal(value.tools.includes('shell_exec'), false)
})

test('pairing: malformed setup authority and credential-bearing endpoints refuse import', () => {
  for (const fields of [{ endpoint: 'http://user:password@10.0.0.2' }, { rootIds: ['../other'] }, { tools: 'fs_read' }, { protectedTunnel: 'true' }]) {
    assert.ok(parsePairingPaste(JSON.stringify({ token, machineId, ...fields })).problems.length > 0)
  }
})
