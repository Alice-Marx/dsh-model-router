import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkerBindingCommitter } from '../packages/orchestration/src/bot-routing-dispatch.mjs'
import { workerBinding } from '../packages/orchestration/src/bot-routing-mode.mjs'

const tools = ['machine_ping', 'fs_list', 'fs_read', 'fs_write', 'operation_status', 'operation_cancel', 'artifact_stat', 'artifact_read']
function fixture({ bindings = [], grants = null, confirmed = true } = {}) {
  const calls = []
  const machine = { id: 'm1', status: 'online', revision: 3, bindings: structuredClone(bindings) }
  const store = { readModel: () => ({ items: [machine] }), bind: async (input, context) => {
    calls.push({ input, context })
    const previous = machine.bindings.find(row => row.botId === input.botId)
    assert.equal(input.expectedRevision, previous?.revision ?? 0)
    assert.equal(context.kind, 'owner')
    machine.bindings = machine.bindings.filter(row => row.botId !== input.botId)
    machine.bindings.push({ ...input, revision: input.expectedRevision + 1, revoked: !confirmed })
    return { revision: input.expectedRevision + 1, remoteRevoked: confirmed }
  } }
  const commit = createWorkerBindingCommitter({ machines: store, settingsFor: () => ({ enabled: true, status: 'available', workspaceRef: { machineId: 'm1', rootId: 'project' },
    machineGrants: grants ?? [{ machineId: 'm1', rootId: 'project', capabilities: tools, mode: 'workspace-write' }] }), mainBotIds: ['main'] })
  return { commit, calls, machine }
}
const binding = over => ({ botId: 'worker', machineId: 'm1', rootId: 'project', mode: 'read-only', tools: ['machine_ping', 'fs_read'], ...over })

test('worker binding commit: an existing wider grant is verified without narrowing or mutation while auto-grant is off', async () => {
  const previous = { botId: 'worker', roots: ['project'], tools, mode: 'workspace-write', revision: 7, revoked: false }
  const f = fixture({ bindings: [previous] })
  const report = await f.commit(binding(), { grantAllowed: false, requesterBotId: 'worker' })
  assert.equal(report.confirmed, true); assert.equal(report.applied, false)
  assert.equal(f.calls.length, 0); assert.deepEqual(f.machine.bindings[0], previous)
})

test('worker binding commit: only owner or a committed Main may expand, under the exact saved root ceiling', async () => {
  const f = fixture({ bindings: [{ botId: 'worker', roots: ['project'], tools: ['machine_ping'], mode: 'read-only', revision: 7, revoked: false }] })
  await assert.rejects(f.commit(binding(), { grantAllowed: true, requesterBotId: 'other' }), /BOT_ROUTING_GRANT_DENIED/u)
  await assert.rejects(f.commit(binding(), { grantAllowed: false, requesterBotId: 'main' }), /BOT_ROUTING_WORKER_GRANT_REQUIRED/u)
  assert.equal(f.calls.length, 0)
  const report = await f.commit(binding(), { grantAllowed: true, requesterBotId: 'main' })
  assert.equal(report.confirmed, true); assert.equal(report.applied, true); assert.equal(report.revision, 8)
  assert.deepEqual(f.calls[0].input, { machineId: 'm1', botId: 'worker', roots: ['project'], tools: ['machine_ping', 'fs_read'], mode: 'read-only', expectedRevision: 7 })
})

test('worker binding commit: a per-root Cartesian widening is refused before the machine is touched', async () => {
  const f = fixture({ bindings: [{ botId: 'worker', roots: ['restricted'], tools: ['machine_ping'], mode: 'read-only', revision: 1, revoked: false }], grants: [
    { machineId: 'm1', rootId: 'restricted', capabilities: ['machine_ping'], mode: 'read-only' },
    { machineId: 'm1', rootId: 'project', capabilities: tools, mode: 'workspace-write' },
  ] })
  await assert.rejects(f.commit(binding(), { owner: true, grantAllowed: true }), /BOT_ROUTING_BINDING_ROOT_CEILING/u)
  assert.equal(f.calls.length, 0)
})

test('worker binding commit: revoked rows keep their real revision and unconfirmed remote revocation cannot count as applied', async () => {
  const f = fixture({ confirmed: false, bindings: [{ botId: 'worker', roots: ['project'], tools, mode: 'workspace-write', revision: 4, revoked: true }] })
  await assert.rejects(f.commit(binding(), { owner: true, grantAllowed: true }), /BOT_ROUTING_WORKER_GRANT_UNCONFIRMED/u)
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].input.expectedRevision, 4)
})

test('worker binding commit: the Main Bot is not rebound and a task needing missing write tools is ineligible', async () => {
  const f = fixture()
  await assert.rejects(f.commit(binding({ botId: 'main' }), { owner: true, grantAllowed: true }), /BOT_ROUTING_MAIN_REGRANT_DENIED/u)
  assert.equal(f.calls.length, 0)
  assert.equal(workerBinding({ botId: 'worker', machineId: 'm1', ceiling: ['machine_ping', 'fs_read'], needs: { write: true } }), null)
  assert.equal(workerBinding({ botId: 'worker', machineId: 'm1', ceiling: tools, mode: 'read-only', needs: { write: true } }), null)
})
