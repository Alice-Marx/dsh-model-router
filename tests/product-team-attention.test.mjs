import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { attachActualAgentLoop } from './helpers/actual-agent-loop.mjs'

async function withIntegratedSender(run) {
  let actual
  await withProductIndependent(async ({ ctx, product, runtime, bind, home, readRows }) => {
    await bind('a', 'alpha', 'one'); await bind('b', 'beta', 'vendor/two'); await runtime.move('b', 'independent')
    const directory = join(home, 'team-attention-sdk-events'); await mkdir(directory)
    const logs = new Map(), handles = []
    const offEvent = actual.context.on('session/event', (session, event) => {
      const events = logs.get(session.id) ?? []; events.push(structuredClone(event)); logs.set(session.id, events)
      // Forward the actual SDK event bus into the isolated product Host facade.
      for (const listener of ctx.listeners.get('session/event') ?? []) if (listener.length >= 2) listener(session, event)
    })
    const offFlush = actual.context.on('session/flush', async session => { await writeFile(join(directory, session.id + '.json'), JSON.stringify(logs.get(session.id) ?? [])) })
    ctx.sessionController.create = async () => {
      const sessionId = 'team-attention-sender-' + (handles.length + 1)
      const handle = await actual.context.agents.create({ sessionId, agentOptions: { provider: 'alpha', model: 'one' }, setup: context => { context.tools.restrict({ deny: context.tools.schemas().map(tool => tool.name) }) } })
      handles.push(handle); return { sessionId }
    }
    ctx.sessionController.page = async ({ address, throughSeq, beforeSeq }) => {
      let events
      try { events = JSON.parse(await readFile(join(directory, address.sessionId + '.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error; events = [] }
      return { records: events.filter(event => event.seq <= throughSeq && (beforeSeq === undefined || event.seq < beforeSeq)).map(event => ({ event })), hasMore: false }
    }
    try {
      const host = ctx.get('botThreads'), service = ctx.get('botTeamCoordination')
      const { thread } = host.service.create({ botId: 'a', name: 'Collaboration', requestKey: 'attention-original-thread' })
      await host.service.ensureSession({ botId: 'a', threadId: thread.threadId })
      const origin = host.service.resolve({ botId: 'a', threadId: thread.threadId })
      const agent = handles.find(handle => handle.agent.session.id === origin.sessionId).agent
      const sendUser = async text => { agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user', form: 'compose' } })); await agent.whenIdle(); await actual.context.sessions.flush(agent.session) }
      const input = { callerBotId: 'a', sessionId: origin.sessionId, turnId: 'trusted-original-sdk-turn', callId: 'delegate', args: { targets: ['b'], message: 'Verify the result in your own work thread.', requestKey: 'sdk-attention-task' } }
      await sendUser('Delegate the verification and return one checked result here.')
      await run({ ctx, product, service, input, sendUser, agent, logs, readRows, origin })
    } finally { for (const handle of handles) await handle.dispose(); offEvent(); offFlush() }
  }, { beforeProduct: async ({ ctx }) => { actual = await attachActualAgentLoop(ctx); return () => actual.close() } })
}

test('actual SDK sender records its original input version, receives metadata only, and retains a scoped inbox result', async () => {
  await withIntegratedSender(async ({ service, input, agent, readRows }) => {
    const receipt = service.coordinateBots(input); await service.drain()
    const row = service.store.get(receipt.assignments[0].assignmentId)
    assert.match(row.originSnapshot, /^sdk:[1-9]\d*$/)
    assert.equal(row.resumeState, 'delivered')
    const notes = agent.session.deriveMessages().filter(message => message.role === 'user' && message.source?.role === 'assign-result')
    assert.equal(notes.length, 1)
    assert.match(JSON.stringify(notes[0]), /team_inbox/)
    assert.doesNotMatch(JSON.stringify(notes[0]), /model answer/)
    const items = service.teamInbox({ ...input, args: {} }).items
    assert.equal(items.length, 1); assert.equal(items[0].inboxState, 'unread')
    const result = service.teamInbox({ ...input, args: { action: 'read', ids: [row.assignmentId] } })
    assert.equal(result.items[0].result, 'model answer')
    assert.equal(readRows('router_model_calls').length, 3)
  })
})

test('actual SDK input arriving after the scheduler freshness check holds the draft before followup commits it', async () => {
  await withIntegratedSender(async ({ ctx, service, input, sendUser, agent, readRows, origin }) => {
    const receipt = service.coordinateBots(input)
    service.tick(); await service.whenIdle()
    const resolveAgent = ctx.sessionController.resolveAgent
    let inject = true
    ctx.sessionController.resolveAgent = async sessionId => {
      if (sessionId === origin.sessionId && inject) { inject = false; await sendUser('New instruction: keep that result for later, do not continue now.') }
      return resolveAgent(sessionId)
    }
    await service.drain()
    const row = service.store.get(receipt.assignments[0].assignmentId)
    assert.equal(inject, false)
    assert.equal(row.resumeState, 'held'); assert.equal(row.resumeCode, 'TEAM_CONTEXT_CHANGED')
    assert.equal(agent.session.deriveMessages().some(message => message.source?.role === 'assign-result'), false)
    assert.equal(service.teamInbox({ ...input, args: {} }).items[0].delivery, 'held')
    assert.equal(readRows('router_model_calls').length, 3, 'only two human turns and one target turn were funded')
  })
})
