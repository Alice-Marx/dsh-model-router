import test from 'node:test'
import assert from 'node:assert/strict'
import { createBotRoutingService } from '../packages/orchestration/src/bot-routing-service.mjs'

const bots = () => [{ id: 'main', name: 'Chief', main: true }, { id: 'worker', name: 'Worker' }]
const settings = {
  main: { enabled: true, model: { provider: 'deepseek', model: 'v4' }, grant: { tools: [] }, machineGrants: [] },
  worker: { enabled: true, model: { provider: 'step', model: 'step-3' }, grant: { tools: ['remote_computer_read'] }, machineGrants: [{ machineId: 'm1', capabilities: ['machine_ping', 'fs_read', 'fs_write', 'operation_status', 'operation_cancel', 'artifact_stat', 'artifact_read'] }] },
}
const make = (routing = { enabled: true, preset: 'balanced' }) => createBotRoutingService({
  bots, settingsFor: id => settings[id] ?? null, machineHealth: () => ({ online: true }),
  priceFor: model => (model.model === 'v4' ? 0.3 : 1.2), qualityFor: id => (id === 'main' ? 0.8 : 0.6), routing,
})

test('service: a preview names the winner', () => {
  assert.equal(make().decide({ text: 'write a weekly report' }).chosen.botId, 'main')
})

test('service: routing off refuses instead of guessing', () => {
  const service = make({ enabled: false })
  assert.throws(() => service.decide({ text: 'x' }), /BOT_ROUTING_DISABLED/)
  assert.throws(() => service.decide({ text: '  ' }), /BOT_ROUTING_REQUIRES_TASK/)
})

test('service: a machine task picks the Bot that can reach it and returns its binding', () => {
  const decision = make().decide({ text: 'read remote log', requiresMachine: true, machineId: 'm1' })
  assert.equal(decision.chosen.botId, 'worker')
  assert.equal(decision.binding.machineId, 'm1')
  assert.equal(decision.binding.mode, 'read-only')
})

test('service: auto-grant off means the preview shows no binding to apply', () => {
  assert.equal(make({ enabled: true, preset: 'balanced', autoGrant: { machineTools: false } }).decide({ text: 'read remote log', requiresMachine: true, machineId: 'm1' }).binding, null)
})

test('service: a pinned Bot is honoured, and an unknown or ineligible pin says which', () => {
  const service = make()
  const pinned = service.decide({ text: 'x', pinnedBotId: 'worker' })
  assert.equal(pinned.chosen.botId, 'worker')
  assert.equal(pinned.pinned, true)
  assert.throws(() => service.decide({ text: 'x', pinnedBotId: 'ghost' }), /BOT_ROUTING_PINNED_UNKNOWN:ghost/)
  assert.throws(() => make().decide({ text: 'x', requiredTools: ['shell_exec'], pinnedBotId: 'worker' }), /BOT_ROUTING_PINNED_INELIGIBLE:worker:BOT_MISSING_TOOL/)
})

test('service: inspect lists the candidates the switch would score', () => {
  const view = make().inspect()
  assert.deepEqual(view.candidates.map(row => row.botId).sort(), ['main', 'worker'])
  assert.equal(view.candidates.find(row => row.botId === 'worker').machineId, 'm1')
})
