import test from 'node:test'
import assert from 'node:assert/strict'
import { createRemoteTools, REMOTE_TOOL_NAMES } from '../modules/independent-runtime/remote-tools.mjs'

test('remote tools: only granted names are offered, and the rest never reach the Host', async () => {
  const seen = []
  const tools = createRemoteTools({ invoke: async (name, args) => { seen.push([name, args]); return { ok: true } }, names: ['fs_read', 'machine_ping'] })
  assert.deepEqual(tools.names, ['fs_read', 'machine_ping'])
  await tools.call('fs_read', { path: 'a.txt' })
  assert.deepEqual(seen, [['fs_read', { path: 'a.txt' }]])
  await assert.rejects(tools.call('shell_exec', { argv: ['whoami'] }), /TOOL_NOT_GRANTED/)
  assert.equal(seen.length, 1)
})

test('remote tools: identity never travels in the arguments', async () => {
  const tools = createRemoteTools({ invoke: async () => ({ ok: true }), names: ['fs_read'] })
  for (const key of ['machineId', 'rootId', 'botId', 'taskId', 'attemptId', 'operationId', 'endpoint', 'secretRef']) {
    await assert.rejects(tools.call('fs_read', { path: 'a', [key]: 'x' }), /TOOL_ARG_FORBIDDEN/)
  }
})

test('remote tools: an unknown or empty grant is refused at construction', () => {
  assert.throws(() => createRemoteTools({ invoke: async () => null, names: ['not_a_tool'] }), /REMOTE_TOOLS_EMPTY_GRANT/)
  assert.throws(() => createRemoteTools({ invoke: async () => null, names: [] }), /REQUIRE_NAMES/)
  assert.throws(() => createRemoteTools({}), /REQUIRE_INVOKE/)
  assert.equal(REMOTE_TOOL_NAMES.includes('shell_exec'), true)
})

test('remote tools: the Host error surfaces unchanged', async () => {
  const tools = createRemoteTools({
    invoke: async () => { throw Object.assign(new Error('MACHINE_BOT_DENIED'), { code: 'MACHINE_BOT_DENIED' }) },
    names: ['fs_read'],
  })
  await assert.rejects(tools.call('fs_read', { path: 'a' }), /MACHINE_BOT_DENIED/)
})
