import test from 'node:test'
import assert from 'node:assert/strict'
import { createMachineHeartbeat } from '../packages/orchestration/src/machine-heartbeat.mjs'

test('heartbeat uses a committed live binding and prefers Main without adding permissions', async () => {
  const calls = []
  const heartbeat = createMachineHeartbeat({ preferredBotIds: () => ['main'], machines: () => ({
    readModel: () => ({ items: [
      { id: 'pc', bindings: [{ botId: 'worker', roots: ['worker-root'], tools: ['machine_ping'] }, { botId: 'main', roots: ['main-root'], tools: ['machine_ping'] }] },
      { id: 'revoked', status: 'revoked', bindings: [{ botId: 'main', roots: ['x'], tools: ['machine_ping'] }] },
      { id: 'unbound', bindings: [] }, { id: 'no-ping', bindings: [{ botId: 'main', roots: ['x'], tools: ['fs_read'] }] },
    ] }),
    probe: async (request, context) => { assert.equal(context.kind, 'owner'); calls.push(request) },
  }) })
  await heartbeat.refresh(); await heartbeat.close()
  assert.deepEqual(calls, [{ machineId: 'pc', botId: 'main', rootId: 'main-root' }])
})

test('heartbeat bounds concurrency and aborts pending probes on shutdown', async () => {
  let active = 0, peak = 0, aborted = 0
  const heartbeat = createMachineHeartbeat({ machines: () => ({
    readModel: () => ({ items: Array.from({ length: 10 }, (_, i) => ({ id: `pc${i}`, bindings: [{ botId: 'main', roots: ['project'], tools: ['machine_ping'] }] })) }),
    probe: async (_, { signal }) => new Promise((resolve, reject) => {
      active++; peak = Math.max(peak, active)
      signal.addEventListener('abort', () => { active--; aborted++; reject(signal.reason) }, { once: true })
    }),
  }) })
  const first = heartbeat.refresh()
  assert.equal(heartbeat.refresh(), first)
  await heartbeat.close(); await first
  assert.equal(peak, 2); assert.equal(active, 0); assert.equal(aborted, 2)
})
