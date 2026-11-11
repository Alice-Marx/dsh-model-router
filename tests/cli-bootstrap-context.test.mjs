import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createCliBootstrap } from '../packages/capability-broker/src/cli-bootstrap.mjs'

// These cases stop at construction, so no OS peer is started: `helper` is only
// read by bind(), which spawns the native relay. The list/call gates, the Host
// turn context and the request-id replay guard all sit behind that relay
// message, so they need the native suite; the required causal cases are listed
// in the report for this change instead of being faked here.

const helper = { executable: 'node', prefix: [], platform: process.platform }
const binding = Object.freeze({ taskId: 'task-1', attemptId: 'attempt-1', machineId: 'machine-1', workspaceId: 'workspace-1', location: 'local' })
const definition = name => Object.freeze({ name, description: `tool ${name}`, inputSchema: { type: 'object' } })
const handler = (name, capability, execute = () => `ran ${name}`) => Object.freeze({
  definition: definition(name), parse: value => value, execute, ...(capability === undefined ? {} : { capability }),
})

/**
 * Build a bridge over the real in-memory authority and record every lease the
 * Host was asked to issue, so the capability mapping is observed on the object
 * that actually enforces it rather than on a stand-in. A construction refusal
 * is returned as `error` instead of failing the caller, so the same helper
 * covers both outcomes.
 */
async function bootstrap(t, { tools, handlers, grants = tools, contextFor = null }) {
  const home = await mkdtemp(join(tmpdir(), 'cli-bootstrap-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const authority = createAuthority()
  const subject = {}
  authority.register(subject, { botId: 'bot-1', tools: grants })
  const issued = []
  const tokens = []
  const host = { ...authority, issue: (who, spec) => { const lease = authority.issue(who, spec); issued.push(spec); tokens.push(lease.token); return lease } }
  let bridge = null
  try {
    bridge = await createCliBootstrap({ authority: host, subject, binding, tools, handlers, home, ttlMs: 30_000, helper, contextFor })
    t.after(() => bridge.close())
  } catch (error) { return { authority, home, issued, error } }
  return { authority, home, bridge, issued, token: () => tokens[0] }
}

test('cli bootstrap: the lease carries the deduplicated capability names, not the wire names', async t => {
  const { authority, issued, token } = await bootstrap(t, {
    tools: ['wire.one', 'wire.two', 'wire.three'],
    handlers: [handler('wire.one', 'cap.one'), handler('wire.two', 'cap.two'), handler('wire.three', 'cap.one')],
    grants: ['cap.one', 'cap.two'],
  })
  assert.deepEqual(issued[0].tools, ['cap.one', 'cap.two'])
  assert.deepEqual(authority.list(token(), binding), ['cap.one', 'cap.two'])
  // The wire name is not an authority name, and the capability is: only the
  // capability can open the lease that this bridge issued.
  await assert.rejects(authority.run(token(), binding, 'wire.one', () => 'ran'), /TOOL_DENIED/)
  assert.equal(await authority.run(token(), binding, 'cap.one', () => 'ran'), 'ran')
})

test('cli bootstrap: a handler without a capability keeps its definition name as the authority name', async t => {
  const { authority, issued, token } = await bootstrap(t, {
    tools: ['alpha', 'beta'], handlers: [handler('alpha'), handler('beta')],
  })
  assert.deepEqual(issued[0].tools, ['alpha', 'beta'])
  assert.deepEqual(authority.list(token(), binding), ['alpha', 'beta'])
  assert.equal(await authority.run(token(), binding, 'beta', () => 'ran'), 'ran')
})

test('cli bootstrap: a capability outside the committed grant refuses the lease', async t => {
  const { error, issued } = await bootstrap(t, {
    tools: ['wire.one', 'wire.two'], handlers: [handler('wire.one', 'cap.one'), handler('wire.two', 'cap.two')],
    grants: ['cap.one'],
  })
  assert.equal(error?.code, 'TOOL_DENIED')
  assert.equal(issued.length, 0, 'no lease is issued for a capability the Host never granted')
})

test('cli bootstrap: an unusable capability is refused before a lease or a descriptor exists', async t => {
  for (const capability of ['', 'x'.repeat(257), 7, {}]) {
    const { error, home, issued, bridge } = await bootstrap(t, { tools: ['wire.one'], handlers: [handler('wire.one', capability)], grants: ['wire.one'] })
    assert.equal(error?.message, 'INVALID_HANDLER_CAPABILITY', `capability ${JSON.stringify(capability)} must be refused at the handler`)
    assert.equal(issued.length, 0, `capability ${JSON.stringify(capability)} must not reach the authority`)
    assert.deepEqual(await readdir(home), [], 'no descriptor or socket directory is created for an unusable capability')
    assert.ok(!bridge, 'no bridge exists for an unusable capability')
  }
})

test('cli bootstrap: unknown and duplicate handlers are still refused', async t => {
  const ghost = await bootstrap(t, { tools: ['ghost'], handlers: [handler('alpha')] })
  assert.equal(ghost.error?.message, 'Unknown or duplicate bridge handler')
  assert.equal(ghost.issued.length, 0)
  const duplicate = await bootstrap(t, { tools: ['alpha'], handlers: [handler('alpha'), handler('alpha')] })
  assert.equal(duplicate.error?.message, 'Unknown or duplicate bridge handler')
  assert.equal(duplicate.issued.length, 0)
})

test('cli bootstrap: a Host context callback must be a function or absent', async t => {
  for (const contextFor of ['turn', {}, 7]) {
    const { error, issued } = await bootstrap(t, { tools: ['alpha'], handlers: [handler('alpha')], contextFor })
    assert.equal(error?.message, 'INVALID_HOST_CONTEXT_CALLBACK', `contextFor ${JSON.stringify(contextFor)} must be refused`)
    assert.equal(issued.length, 0)
  }
  const absent = await bootstrap(t, { tools: ['alpha'], handlers: [handler('alpha')], contextFor: null })
  assert.equal(absent.error, undefined)
  assert.deepEqual(absent.issued[0].tools, ['alpha'])
})

test('cli bootstrap: the public surface hands the native client no authority and no token', async t => {
  const { bridge, token } = await bootstrap(t, { tools: ['wire.one'], handlers: [handler('wire.one', 'cap.one')], grants: ['cap.one'] })
  assert.deepEqual(Object.keys(bridge).sort(), ['args', 'bind', 'close', 'closed', 'command', 'connected', 'descriptorPath', 'evidence'])
  assert.ok(Object.isFrozen(bridge))
  assert.equal(bridge.args.length, 3)
  assert.ok(bridge.args[0].endsWith('cli-stdio-bridge.mjs'))
  assert.ok(!bridge.args.some(arg => typeof arg === 'string' && arg.includes(token())))
  assert.equal(bridge.evidence.bearerInArgvOrEnv, false)
  assert.deepEqual(bridge.evidence.binding, binding)
  assert.equal(bridge.connected, false)
})

test('cli bootstrap: closing releases the lease the capability mapping issued', async t => {
  const { authority, bridge, token } = await bootstrap(t, { tools: ['alpha'], handlers: [handler('alpha')] })
  await bridge.close()
  assert.equal(bridge.closed, true)
  await assert.rejects(authority.run(token(), binding, 'alpha', () => 'ran'), /UNKNOWN_LEASE/)
})
