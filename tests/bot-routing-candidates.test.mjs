import test from 'node:test'
import assert from 'node:assert/strict'
import { botRoutingCandidates, candidateMachineGrant, withMachineFact } from '../packages/orchestration/src/bot-routing-candidates.mjs'
import { routeBot } from '../packages/orchestration/src/bot-routing.mjs'

const bots = [{ id: 'main', name: 'Chief', main: true }, { id: 'writer', name: 'Writer' }, { id: 'off' }]
const settings = {
  main: { enabled: true, model: { provider: 'deepseek', model: 'v4' }, grant: { tools: ['remote_computer_read'] }, machineGrants: [{ machineId: 'm1', capabilities: ['machine_ping', 'fs_read'] }] },
  writer: { enabled: true, model: { provider: 'step', model: 'step-3' }, grant: { tools: [] }, machineGrants: [] },
  off: { enabled: false, model: { provider: 'x', model: 'y' } },
}

test('candidates: a disabled Bot never becomes a candidate', () => {
  const rows = botRoutingCandidates({ bots, settingsFor: id => settings[id] ?? null })
  assert.deepEqual(rows.map(row => row.botId).sort(), ['main', 'writer'])
})

test('candidates: unknown price and quality stay null instead of becoming zero', () => {
  const rows = botRoutingCandidates({ bots, settingsFor: id => settings[id] ?? null })
  assert.equal(rows.find(row => row.botId === 'writer').pricePerMTokUsd, null)
  assert.equal(rows.find(row => row.botId === 'writer').quality, null)
  const priced = botRoutingCandidates({ bots, settingsFor: id => settings[id] ?? null, priceFor: () => 0.5, qualityFor: () => 0.7 })
  assert.ok(['main', 'writer'].includes(routeBot({ candidates: priced, preset: 'economy', task: {} }).chosen.botId))
})

test('candidates: machine reachability comes from health, not from the grant', () => {
  const offline = botRoutingCandidates({ bots, settingsFor: id => settings[id] ?? null, machineHealth: () => ({ online: false }) })
  assert.equal(offline.find(row => row.botId === 'main').machineOnline, false)
  const online = botRoutingCandidates({ bots, settingsFor: id => settings[id] ?? null, machineHealth: () => ({ online: true }) })
  assert.equal(online.find(row => row.botId === 'main').machineOnline, true)
  assert.equal(botRoutingCandidates({ bots, settingsFor: id => settings[id] ?? null }).find(row => row.botId === 'writer').machineOnline, false)
})

test('candidates: tools come from the committed grant and routing filters on them', () => {
  const rows = botRoutingCandidates({ bots, settingsFor: id => settings[id] ?? null })
  assert.deepEqual(rows.find(row => row.botId === 'main').tools, ['remote_computer_read'])
  const routed = routeBot({ candidates: rows, task: { requiredTools: ['remote_computer_read'] }, preset: 'balanced' })
  assert.equal(routed.chosen.botId, 'main')
  assert.equal(routed.rejected.some(row => row.reason === 'BOT_MISSING_TOOL:remote_computer_read'), true)
})

test('candidates: a machine task only matches a Bot whose machine is online', () => {
  const online = botRoutingCandidates({ bots, settingsFor: id => settings[id] ?? null, machineHealth: () => ({ online: true }) })
  assert.equal(routeBot({ candidates: online, task: { requiresMachine: true }, preset: 'balanced' }).chosen.botId, 'main')
  const offline = botRoutingCandidates({ bots, settingsFor: id => settings[id] ?? null })
  const refused = routeBot({ candidates: offline, task: { requiresMachine: true }, preset: 'balanced' })
  assert.equal(refused.chosen, null)
  assert.equal(refused.reason, 'NO_BOT_ELIGIBLE')
})

test('candidates: every committed machine grant is carried, with its own ceiling', () => {
  const rows = botRoutingCandidates({ bots: [{ id: 'main' }], settingsFor: () => ({ enabled: true, model: { provider: 'p', model: 'm' }, machineGrants: [
    { machineId: 'm2', capabilities: ['machine_ping', 'fs_read', 'fs_write'] },
    { machineId: 'm1', capabilities: ['machine_ping', 'fs_read'] },
  ] }), machineHealth: () => ({ online: true }) })
  assert.deepEqual(rows[0].machineGrants.map(grant => grant.machineId), ['m1', 'm2'])
  assert.deepEqual(candidateMachineGrant(rows[0], 'm2').ceiling, ['machine_ping', 'fs_read', 'fs_write'])
  assert.equal(candidateMachineGrant(rows[0], 'm9'), null)
  assert.equal(candidateMachineGrant(rows[0]).machineId, 'm1')
  // The legacy single-grant shape still resolves, so no caller has to know which the Host used.
  assert.equal(candidateMachineGrant({ machine: { machineId: 'solo', ceiling: ['fs_read'] } }, 'solo').machineId, 'solo')
})

test('candidates: the reachable fact is per machine, not per Bot', () => {
  const rows = botRoutingCandidates({ bots: [{ id: 'main' }], settingsFor: () => ({ enabled: true, model: { provider: 'p', model: 'm' }, machineGrants: [
    { machineId: 'm1', capabilities: ['machine_ping', 'fs_read'] },
    { machineId: 'm2', capabilities: ['machine_ping', 'fs_read'] },
  ] }), machineHealth: id => ({ online: id === 'm2' }) })
  assert.equal(rows[0].machineOnlineFor('m2'), true)
  assert.equal(rows[0].machineOnlineFor('m1'), false)
  // A machine the Bot holds no grant for is never reachable, whatever health says.
  assert.equal(rows[0].machineOnlineFor('m9'), false)
  const scored = withMachineFact(rows, { machineId: 'm2' })
  assert.equal(routeBot({ candidates: scored, task: { requiresMachine: true, machineId: 'm2' }, preset: 'balanced' }).chosen.botId, 'main')
  const refused = withMachineFact(rows, { machineId: 'm1' })
  assert.equal(routeBot({ candidates: refused, task: { requiresMachine: true, machineId: 'm1' }, preset: 'balanced' }).chosen, null)
  // Without a named machine nothing is rewritten.
  assert.deepEqual(withMachineFact(rows, {}), rows)
})
