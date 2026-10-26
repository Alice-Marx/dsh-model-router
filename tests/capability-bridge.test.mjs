import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { createAuthority, PolicyError } from '../packages/capability-broker/src/authority.mjs'
import { openManagedBridge } from '../packages/capability-broker/src/managed-bridge.mjs'

const binding = { taskId: 'task-a', attemptId: 'attempt-1', machineId: 'machine-a', workspaceId: 'workspace-a', location: 'remote' }
const empty = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) throw new PolicyError('INVALID_ARGUMENTS')
  return {}
}
const definition = name => ({ name, description: 'Offline bridge fixture', inputSchema: { type: 'object', properties: {}, additionalProperties: false } })
async function connect(t, { actor, authority, toolNames, handlers, era = 'legacy' }) {
  const parent = resolve('tmp/integration/bridge-tests')
  await mkdir(parent, { recursive: true })
  const home = await mkdtemp(join(parent, 'home-'))
  const bridge = openManagedBridge({ authority, subject: actor, binding, tools: toolNames, handlers, home })
  const client = new Client({ name: 'integration-fixture', version: '0.0.0' }, { versionNegotiation: { mode: era === 'legacy' ? 'legacy' : { pin: '2026-07-28' } } })
  t.after(async () => { await client.close(); await bridge.close() })
  await client.connect(bridge.transport)
  return { client, bridge }
}

for (const era of ['legacy', 'modern']) test(`bridge: ${era} MCP client lists only its grant and cannot impersonate another Bot`, async t => {
  const authority = createAuthority()
  t.after(() => authority.dispose())
  const a = {}, b = {}
  authority.register(a, { botId: 'bot-a', tools: ['ping_a'] })
  authority.register(b, { botId: 'bot-b', tools: ['ping_b'] })
  let calls = 0
  const handlers = ['ping_a','ping_b'].map(name => ({ definition: definition(name), parse: empty, execute: (_args, { binding }) => { calls++; return { name, machine: binding.machineId } } }))
  const left = await connect(t, { actor: a, authority, toolNames: ['ping_a'], handlers, era })
  const right = await connect(t, { actor: b, authority, toolNames: ['ping_b'], handlers, era })
  assert.equal(left.client.getProtocolEra(), era)
  assert.deepEqual((await left.client.listTools()).tools.map(tool => tool.name), ['ping_a'])
  assert.deepEqual((await right.client.listTools()).tools.map(tool => tool.name), ['ping_b'])
  const denied = await left.client.callTool({ name: 'ping_b', arguments: {} })
  assert.equal(denied.isError, true)
  const spoofed = await left.client.callTool({ name: 'ping_a', arguments: { botId: 'bot-b', machineId: 'machine-b' } })
  assert.equal(spoofed.isError, true)
  assert.equal(calls, 0)
  const accepted = await left.client.callTool({ name: 'ping_a', arguments: {} })
  assert.equal(accepted.isError, undefined)
  assert.equal(calls, 1)
  authority.revoke(a)
  const afterRevoke = await left.client.callTool({ name: 'ping_a', arguments: {} })
  assert.equal(afterRevoke.isError, true)
  assert.equal(calls, 1)
  await assert.rejects(left.client.listTools())
  assert.deepEqual((await right.client.listTools()).tools.map(tool => tool.name), ['ping_b'])
})

test('bridge: MCP cancellation reaches the owned backend; closing ends the child', async t => {
  const authority = createAuthority()
  t.after(() => authority.dispose())
  const actor = {}
  authority.register(actor, { botId: 'bot-wait', tools: ['wait'] })
  let started
  const opened = new Promise(resolve => { started = resolve })
  let cancelled
  const aborted = new Promise(resolve => { cancelled = resolve })
  const { client, bridge } = await connect(t, { actor, authority, toolNames: ['wait'], handlers: [{ definition: definition('wait'), parse: empty,
    execute: (_args, { signal }) => new Promise((_, reject) => { started(); signal.addEventListener('abort', () => { cancelled(); reject(signal.reason) }, { once: true }) }) }] })
  const controller = new AbortController()
  const pending = client.callTool({ name: 'wait', arguments: {} }, { signal: controller.signal })
  await opened
  controller.abort()
  await assert.rejects(pending)
  await aborted
  await client.close()
  await bridge.close()
  assert.equal(bridge.closed, true)
  assert.equal(bridge.forcedTermination, false)
})
