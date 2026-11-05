import test from 'node:test'
import assert from 'node:assert/strict'
import { pairMainMachine } from '../packages/orchestration/src/pair-main-machine.mjs'

function fixture({ probeBotId = 'main', previousRevision, unconfirmed = false, denied = false } = {}) {
  const calls = [], context = { kind: 'owner' }, input = { machineId: 'machine', probeBotId }
  const record = { id: 'machine', revision: 9, roots: ['project'], tools: ['machine_ping', 'desktop_screenshot'],
    bindings: previousRevision === undefined ? [] : [{ botId: 'main', revision: previousRevision, revoked: true }] }
  const machines = {
    pair: async (value, ctx) => { assert.equal(value, input); assert.equal(ctx, context); calls.push('pair'); return record },
    readModel: () => ({ items: [record] }),
    bind: async (value, ctx) => { assert.equal(ctx, context); calls.push(value); return { remoteRevoked: !unconfirmed } },
    probe: async value => { calls.push(value); if (denied) throw Object.assign(new Error('SCOPE_DENIED'), { code: 'SCOPE_DENIED' }) },
  }
  return { input, context, calls, machines }
}

test('pairing Main itself still commits its first binding with revision zero', async () => {
  const f = fixture()
  const result = await pairMainMachine({ machines: f.machines, mainBotId: () => 'main' }, f.input, f.context)
  assert.equal(result.mainBinding.status, 'available')
  assert.deepEqual(f.calls[1], { machineId: 'machine', botId: 'main', roots: ['project'], tools: ['machine_ping', 'desktop_screenshot'], mode: 'workspace-write', expectedRevision: 0 })
})

test('pairing with another probe Bot uses Main binding revision rather than machine revision', async () => {
  const f = fixture({ probeBotId: 'worker', previousRevision: 4 })
  await pairMainMachine({ machines: f.machines, mainBotId: () => 'main' }, f.input, f.context)
  assert.equal(f.calls[1].expectedRevision, 4)
})

test('pairing success remains explicit when remote stop or Main fixed-ID scope cannot be confirmed', async () => {
  for (const options of [{ unconfirmed: true }, { denied: true }]) {
    const f = fixture(options)
    const result = await pairMainMachine({ machines: f.machines, mainBotId: () => 'main' }, f.input, f.context)
    assert.equal(result.id, 'machine'); assert.equal(result.mainBinding.status, 'blocked')
    assert.equal(result.mainBinding.code, options.unconfirmed ? 'REMOTE_REVOCATION_UNCONFIRMED' : 'SCOPE_DENIED')
  }
})
