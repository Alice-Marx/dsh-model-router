import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
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

test('service: preview and dispatch use each Bot price for a shared model route', async () => {
  const submitted = []
  const service = createBotRoutingService({
    bots: () => [{ id: 'a-expensive' }, { id: 'z-cheap' }],
    settingsFor: () => ({ enabled: true, model: { provider: 'fixture', model: 'shared' } }),
    priceFor: (model, botId) => botId === 'z-cheap' ? 0.5 : 5,
    routing: { enabled: true, preset: 'economy' }, mainBotIds: ['a-expensive'],
    subjectFor: id => ({ id }),
    submitPlan: (subject, request) => {
      submitted.push(request)
      return { planId: request.plan.taskId, state: 'ready', packages: [{ id: 'p1', targetBotId: request.plan.packages[0].targetBotId,
        taskId: 'child', attemptId: 'attempt', operationId: 'operation', state: 'ready' }] }
    },
  })
  assert.deepEqual(service.inspect().candidates.map(row => row.pricePerMTokUsd), [5, 0.5])
  const preview = service.decide({ text: 'use the cheaper configured Bot' })
  assert.equal(preview.chosen.botId, 'z-cheap')
  const report = await service.dispatch({ text: 'use the cheaper configured Bot' }, { kind: 'owner' })
  assert.equal(report.botId, preview.chosen.botId)
  assert.equal(submitted[0].plan.packages[0].targetBotId, 'z-cheap')
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

test('service: auto-grant off still names the binding, and says it was not applied', () => {
  // The toggle decides whether the Host is asked to commit a binding. It must never decide what the
  // decision reports, or a preview and a dispatch would describe two different jobs.
  const decision = make({ enabled: true, preset: 'balanced', autoGrant: { machineTools: false } }).decide({ text: 'read remote log', requiresMachine: true, machineId: 'm1' })
  assert.equal(decision.binding.machineId, 'm1')
  assert.equal(decision.binding.mode, 'read-only')
  assert.deepEqual(decision.grant, { required: true, applied: false, autoGrant: false, reason: 'BOT_ROUTING_AUTO_GRANT_OFF' })
  const applied = make().decide({ text: 'read remote log', requiresMachine: true, machineId: 'm1' })
  assert.equal(applied.grant.applied, false, 'a preview has not applied the proposed grant')
  assert.equal(applied.grant.reason, null)
})

test('service: a pinned Bot is honoured, and an unknown or ineligible pin says which', () => {
  const service = make()
  const pinned = service.decide({ text: 'x', pinnedBotId: 'worker' })
  assert.equal(pinned.chosen.botId, 'worker')
  assert.equal(pinned.pinned, true)
  assert.throws(() => service.decide({ text: 'x', pinnedBotId: 'ghost' }), /BOT_ROUTING_PINNED_INELIGIBLE:ghost:BOT_ROUTING_PINNED_UNKNOWN/)
  assert.throws(() => make().decide({ text: 'x', requiredTools: ['shell_exec'], pinnedBotId: 'worker' }), /BOT_ROUTING_PINNED_INELIGIBLE:worker:BOT_MISSING_TOOL/)
  // A Bot that exists but is off is named as off, not as a Bot nobody has heard of.
  const off = createBotRoutingService({
    bots: () => [{ id: 'main', main: true }, { id: 'worker' }, { id: 'idle' }],
    settingsFor: id => (id === 'idle' ? { ...settings.worker, enabled: false } : settings[id] ?? null),
    machineHealth: () => ({ online: true }), priceFor: () => 1, qualityFor: () => 0.5, routing: { enabled: true },
  })
  assert.throws(() => off.decide({ text: 'x', pinnedBotId: 'idle' }), /BOT_ROUTING_PINNED_INELIGIBLE:idle:BOT_DISABLED/)
  assert.throws(() => off.decide({ text: 'x', pinnedBotId: 'ghost' }), /BOT_ROUTING_PINNED_UNKNOWN/)
})

test('service: inspect lists the candidates the switch would score', () => {
  const view = make().inspect()
  assert.deepEqual(view.candidates.map(row => row.botId).sort(), ['main', 'worker'])
  assert.equal(view.candidates.find(row => row.botId === 'worker').machineId, 'm1')
})

test('service: a Bot carries its own routing preset for the work it hands out', () => {
  const withPolicy = createBotRoutingService({
    bots, machineHealth: () => ({ online: true }),
    settingsFor: id => ({ ...settings[id], routing: id === 'main' ? { preset: 'quality' } : null }),
    priceFor: model => (model.model === 'v4' ? 0.3 : 1.2), qualityFor: id => (id === 'main' ? 0.8 : 0.6),
    routing: { enabled: true, preset: 'economy' },
  })
  assert.equal(withPolicy.decide({ text: 'x' }).preset, 'economy')
  assert.equal(withPolicy.decide({ text: 'x', requesterBotId: 'main' }).preset, 'quality')
  assert.equal(withPolicy.decide({ text: 'x', requesterBotId: 'worker' }).preset, 'economy')
})

test('service: the real DS Bot object roster remains routable and blocked bindings are excluded', () => {
  const service = createBotRoutingService({ bots: () => ({ main: { id: 'main' }, worker: { id: 'worker' } }), mainBotIds: ['main'],
    settingsFor: id => ({ ...settings[id], status: id === 'main' ? 'blocked' : 'available' }), routing: { enabled: true } })
  assert.equal(service.decide({ text: 'read' }).chosen.botId, 'worker')
  assert.deepEqual(service.inspect().candidates.map(row => row.botId), ['worker'])
})

test('service: naming a remote write tool implies machine work and its write permissions before auto-grant', () => {
  const service = createBotRoutingService({ bots, settingsFor: id => ({ ...settings[id], grant: { tools: [] } }), machineHealth: () => ({ online: true }), routing: { enabled: true } })
  const result = service.decide({ text: 'write remote result', requiredTools: ['remote_computer_write'] })
  assert.equal(result.chosen.botId, 'worker')
  assert.equal(result.binding.mode, 'workspace-write')
  assert.equal(result.binding.tools.includes('fs_write'), true)
  assert.equal(result.grant.applied, false)
})

test('service: dispatch uses the same requester preset as preview and payload owner/origin claims cannot grant access', async () => {
  const service = createBotRoutingService({ bots, settingsFor: id => ({ ...settings[id], routing: { preset: 'quality' } }), routing: { enabled: true, preset: 'economy' }, mainBotIds: ['main'],
    priceFor: route => route.provider === 'step' ? 10 : 1, qualityFor: id => id === 'worker' ? 1 : 0, subjectFor: id => ({ id }),
    submitPlan: (subject, request, caller) => {
      assert.equal(subject.id, 'main'); assert.deepEqual(caller, { sessionId: 'live-main' })
      assert.equal(request.plan.origin.botId, 'main'); assert.equal(request.plan.origin.sessionId, 'live-main')
      return { planId: request.plan.taskId, state: 'ready', packages: [{ id: 'p1', targetBotId: request.plan.packages[0].targetBotId, taskId: 'child', attemptId: 'attempt', operationId: 'operation', state: 'ready' }] }
    } })
  const preview = service.decide({ text: 'quality matters', requesterBotId: 'main' })
  const report = await service.dispatch({ text: 'quality matters', requesterBotId: 'forged', originBotId: 'forged', caller: { owner: true }, sessionId: 'forged' }, { kind: 'bot', botId: 'main', sessionId: 'live-main' })
  assert.equal(report.botId, preview.chosen.botId); assert.equal(report.preset, 'quality')
  await assert.rejects(service.dispatch({ text: 'steal', caller: { owner: true } }, { kind: 'bot', botId: 'worker', sessionId: 'live-worker' }), /BOT_ROUTING_DISPATCH_DENIED:worker/u)
})

test('service: an owner checks a durable submission without routing, binding or resubmitting', async () => {
  let reads = 0, writes = 0
  const planId = `route_${createHash('sha256').update('main:original-key').digest('hex').slice(0, 48)}`
  const plan = { planId, ownerBotId: 'main', state: 'succeeded', plan: { secretTask: 'PRIVATE INPUT' },
    packages: [{ id: 'p1', targetBotId: 'worker', taskId: 'child', attemptId: 'attempt', operationId: 'operation', state: 'succeeded', result: { text: 'PRIVATE OUTPUT' } }] }
  const service = createBotRoutingService({ bots: () => { throw new Error('status must not read candidates') }, settingsFor: () => { throw new Error('status must not read bindings') },
    routing: { enabled: false }, mainBotIds: ['main'], submitPlan: () => { writes++ }, bindWorker: () => { writes++ },
    readSubmittedPlan: (origin, id) => { reads++; assert.equal(origin, 'main'); assert.equal(id, planId); return plan } })
  const result = await service.submissionStatus({ requestKey: 'original-key', requesterBotId: 'main' }, { kind: 'owner' })
  assert.equal(result.found, true); assert.equal(result.accepted, true)
  assert.equal(result.planId, planId); assert.equal(result.planState, 'succeeded')
  assert.equal(result.packages[0].operationId, 'operation')
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|secretTask|result/)
  assert.equal(reads, 1); assert.equal(writes, 0)
})

test('service: submission lookup distinguishes not-yet-found from storage failure and verifies identity', async () => {
  const create = readSubmittedPlan => createBotRoutingService({ bots, settingsFor: () => null, mainBotIds: ['main'], readSubmittedPlan })
  const missing = await create(() => { throw Object.assign(new Error('absent'), { code: 'TASK_PLAN_NOT_FOUND' }) })
    .submissionStatus({ requestKey: 'key', requesterBotId: 'main' }, { kind: 'owner' })
  assert.equal(missing.found, false); assert.equal(missing.accepted, undefined)
  await assert.rejects(create(() => { throw Object.assign(new Error('database offline'), { code: 'SQLITE_BUSY' }) })
    .submissionStatus({ requestKey: 'key', requesterBotId: 'main' }, { kind: 'owner' }), { code: 'SQLITE_BUSY' })
  await assert.rejects(create(() => ({ planId: 'other', ownerBotId: 'main', packages: [] }))
    .submissionStatus({ requestKey: 'key', requesterBotId: 'main' }, { kind: 'owner' }), { code: 'BOT_ROUTING_SUBMISSION_IDENTITY_MISMATCH' })
})

test('service: lookup authenticates before any read and accepts only the original submission reference', async () => {
  let reads = 0
  const service = createBotRoutingService({ bots, settingsFor: () => null, mainBotIds: ['main'], readSubmittedPlan: () => { reads++; throw new Error('must not read') } })
  for (const context of [{}, { kind: 'bot', botId: 'main' }]) {
    await assert.rejects(service.submissionStatus({ requestKey: 'key', requesterBotId: 'main', owner: true }, context), { code: 'REMOTE_OWNER_REQUIRED' })
  }
  for (const request of [{ requestKey: 'bad/key', requesterBotId: 'main' }, { requestKey: 'key', requesterBotId: '' },
    { requestKey: 'key', requesterBotId: 'main', planId: 'forged' }, { requestKey: 'key', requesterBotId: 'main', text: 'another task' }]) {
    await assert.rejects(service.submissionStatus(request, { kind: 'owner' }))
  }
  assert.equal(reads, 0)
})

test('service: an invalid request key is rejected before deciding, changing grants or submitting', async () => {
  let candidates = 0, writes = 0
  const service = createBotRoutingService({ bots: () => { candidates++; return bots() }, settingsFor: id => settings[id], mainBotIds: ['main'], routing: { enabled: true },
    subjectFor: id => ({ id }), bindWorker: () => { writes++ }, submitPlan: () => { writes++ } })
  await assert.rejects(service.dispatch({ text: 'invalid reference', requestKey: 'unsafe/key' }, { kind: 'owner' }), { code: 'INVALID_TASK_REFERENCE' })
  assert.equal(candidates, 0); assert.equal(writes, 0)
})
