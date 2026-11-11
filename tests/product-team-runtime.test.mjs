import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { attachActualAgentLoop } from './helpers/actual-agent-loop.mjs'

const args = { targets: ['b'], message: 'Return the bounded offline team result.', thread: 'standing', reply: 'resume', consult: false, rework: false, requestKey: 'production-team-one' }
const input = runtime => ({ callerBotId: 'a', conversationId: runtime.contextOf('a').contextId, turnId: 'host-team-turn', callId: 'host-team-call', args })

test('production independent team target and original sender resume use their own model/funding receipts exactly once', async () => {
  await withProductIndependent(async ({ ctx, runtime, bind, readRows }) => {
    await bind('a', 'alpha', 'one'); await bind('b', 'beta', 'vendor/two')
    await runtime.move('a', 'independent'); await runtime.move('b', 'independent')
    const service = ctx.get('botTeamCoordination'), request = input(runtime)
    const receipt = service.coordinateBots(request)
    await service.drain()
    const row = service.store.get(receipt.assignments[0].assignmentId)
    assert.equal(row.state, 'settled'); assert.equal(row.resumeState, 'delivered'); assert.equal(row.outcome, 'succeeded')
    assert.deepEqual(readRows('router_model_calls').map(row => [row.botId, row.provider, row.model, row.state, row.outcome]), [['b', 'beta', 'vendor/two', 'settled', 'succeeded'], ['a', 'alpha', 'one', 'settled', 'succeeded']])
    assert.equal(readRows('router_runs').length, 2)
    assert.equal(runtime.history('b').length, 0, 'target default conversation is untouched')
    assert.equal(runtime.workThreadRead('b', row.workThreadKey, row.targetRequestId).answer, 'model answer')
    assert.match(runtime.readMessage('a', 1).content, /Team result from b/)
    assert.equal(runtime.readMessage('a', 1).contextId, request.conversationId)
    assert.equal(service.coordinateBots(request).assignments[0].assignmentId, row.assignmentId)
    await service.drain()
    assert.equal(readRows('router_model_calls').length, 2)
    assert.equal(ctx.upstream.length, 2)
  })
})

test('a production sender context retired before release never receives the old result in its new conversation', async () => {
  await withProductIndependent(async ({ ctx, runtime, bind, readRows }) => {
    await bind('a', 'alpha', 'one'); await bind('b', 'beta', 'vendor/two')
    await runtime.move('a', 'independent'); await runtime.move('b', 'independent')
    const service = ctx.get('botTeamCoordination'), request = input(runtime)
    const receipt = service.coordinateBots(request)
    service.tick(); await service.whenIdle()
    assert.equal(service.store.get(receipt.assignments[0].assignmentId).state, 'waiting')
    await runtime.newConversation('a', { requestKey: 'retire-before-team-return', expectedContextId: request.conversationId })
    await service.drain(2)
    assert.notEqual(runtime.contextOf('a').contextId, request.conversationId)
    assert.equal(runtime.history('a').length, 0)
    assert.equal(readRows('router_model_calls').length, 1)
    assert.notEqual(service.store.get(receipt.assignments[0].assignmentId).resumeState, 'delivered')
  })
})

test('actual installed AgentLoop target correlates its real session events and funds the independent sender resume', async () => {
  let actual
  await withProductIndependent(async ({ ctx, product, runtime, bind, readRows, home }) => {
    await bind('a', 'alpha', 'one'); await bind('b', 'beta', 'vendor/two')
    await runtime.move('a', 'independent')
    const service = ctx.get('botTeamCoordination'), handles = []
    const eventLogs = new Map(), eventDir = join(home, 'actual-team-events')
    await mkdir(eventDir)
    const offEvent = actual.context.on('session/event', (session, event) => { const events = eventLogs.get(session.id) ?? []; events.push(structuredClone(event)); eventLogs.set(session.id, events) })
    const offFlush = actual.context.on('session/flush', async session => { await writeFile(join(eventDir, `${session.id}.json`), JSON.stringify(eventLogs.get(session.id) ?? [])) })
    // Public controller adapter for isolated real SDK sessions. Only the provider
    // is offline. Product resolve/selection/policy/funding and SDK event envelopes
    // remain the installed implementations.
    let nextId = 0
    ctx.sessionController.create = async () => {
      const sessionId = `real-team-${++nextId}`
      const handle = await actual.context.agents.create({ sessionId, agentOptions: { provider: 'alpha', model: 'one' }, setup: ctx => { ctx.tools.restrict({ deny: ctx.tools.schemas().map(tool => tool.name) }) } })
      handles.push(handle)
      return { sessionId }
    }
    ctx.sessionController.page = async ({ address, throughSeq, beforeSeq }) => {
      const sessionId = address.sessionId
      const handle = handles.find(handle => handle.agent.session.id === sessionId)
      if (!handle) return { records: [], hasMore: false }
      let events
      try { events = JSON.parse(await readFile(join(eventDir, `${sessionId}.json`), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error; events = [] }
      return { records: events.filter(event => event.seq <= throughSeq && (beforeSeq === undefined || event.seq < beforeSeq)).map(event => ({ event })), hasMore: false }
    }
    try {
      const receipt = service.coordinateBots(input(runtime))
      await service.drain()
      const row = service.store.get(receipt.assignments[0].assignmentId)
      assert.equal(row.outcome, 'succeeded', JSON.stringify(row))
      assert.equal(row.resumeState, 'delivered')
      assert.equal(row.targetRef.mode, 'integration')
      assert.equal(product.lifecycle.committedBot('b').sessionId, 'b')
      assert.ok(product.lifecycle.committedBot('b').threads.some(thread => thread.sessionId === row.targetRef.sessionId))
      assert.deepEqual(readRows('router_model_calls').map(row => [row.botId, row.provider, row.model, row.state]), [['b', 'beta', 'vendor/two', 'settled'], ['a', 'alpha', 'one', 'settled']])
    } finally { for (const handle of handles) await handle.dispose(); offEvent(); offFlush() }
  }, { beforeProduct: async ({ ctx }) => { actual = await attachActualAgentLoop(ctx); return () => actual.close() } })
})

test('actual installed AgentLoop resumes the original integrated thread without writing its default chat', async () => {
  let actual
  await withProductIndependent(async ({ ctx, product, runtime, bind, readRows, home }) => {
    await bind('a', 'alpha', 'one'); await bind('b', 'beta', 'vendor/two')
    await runtime.move('b', 'independent')
    const eventDir = join(home, 'sender-sdk-events'), logs = new Map(), handles = []
    await mkdir(eventDir)
    const offEvent = actual.context.on('session/event', (session, event) => { const events = logs.get(session.id) ?? []; events.push(structuredClone(event)); logs.set(session.id, events) })
    const offFlush = actual.context.on('session/flush', async session => { await writeFile(join(eventDir, `${session.id}.json`), JSON.stringify(logs.get(session.id) ?? [])) })
    ctx.sessionController.create = async () => {
      const sessionId = `sender-team-${handles.length + 1}`
      const handle = await actual.context.agents.create({ sessionId, agentOptions: { provider: 'alpha', model: 'one' }, setup: ctx => { ctx.tools.restrict({ deny: ctx.tools.schemas().map(tool => tool.name) }) } })
      handles.push(handle); return { sessionId }
    }
    ctx.sessionController.page = async ({ address, throughSeq, beforeSeq }) => {
      let events
      try { events = JSON.parse(await readFile(join(eventDir, `${address.sessionId}.json`), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error; events = [] }
      return { records: events.filter(event => event.seq <= throughSeq && (beforeSeq === undefined || event.seq < beforeSeq)).map(event => ({ event })), hasMore: false }
    }
    try {
      const host = ctx.get('botThreads'), service = ctx.get('botTeamCoordination')
      const { thread } = host.service.create({ botId: 'a', name: 'Original caller thread', requestKey: 'original-caller' })
      await host.service.ensureSession({ botId: 'a', threadId: thread.threadId })
      const origin = host.service.resolve({ botId: 'a', threadId: thread.threadId })
      let releaseResume, enteredResume
      const gate = new Promise(resolve => { releaseResume = resolve }), entered = new Promise(resolve => { enteredResume = resolve })
      ctx.state.beforeRequest = async options => { if (options.provider === 'alpha') { enteredResume(); await gate } }
      const receipt = service.coordinateBots({ callerBotId: 'a', sessionId: origin.sessionId, turnId: 'original-sdk-caller-turn', callId: 'one', args })
      const draining = service.drain()
      await entered
      try {
        const during = service.store.get(receipt.assignments[0].assignmentId)
        assert.equal(during.resumeState, 'sending')
        assert.equal(during.resumeActive, true)
        assert.equal(service.store.activeFor('a', { sessionId: origin.sessionId }).resumeAssignmentId, during.assignmentId)
      } finally { releaseResume() }
      await draining
      const agent = handles.find(handle => handle.agent.session.id === origin.sessionId).agent
      await agent.whenIdle(); await actual.context.sessions.flush(agent.session)
      const row = service.store.get(receipt.assignments[0].assignmentId)
      assert.equal(row.resumeState, 'delivered')
      assert.equal(row.resumeActive, false)
      assert.equal(row.origin.sessionId, origin.sessionId)
      assert.equal(product.lifecycle.committedBot('a').sessionId, 'a')
      assert.equal(actual.context.agents.get('a'), undefined)
      const messages = agent.session.deriveMessages()
      assert.ok(messages.some(message => message.role === 'user' && message.source?.exchangeId === `team-result-${row.assignmentId}`))
      assert.ok(messages.some(message => message.role === 'assistant'))
      assert.deepEqual(readRows('router_model_calls').map(row => [row.botId, row.provider, row.model, row.state]), [['b', 'beta', 'vendor/two', 'settled'], ['a', 'alpha', 'one', 'settled']])
    } finally { for (const handle of handles) await handle.dispose(); offEvent(); offFlush() }
  }, { beforeProduct: async ({ ctx }) => { actual = await attachActualAgentLoop(ctx); return () => actual.close() } })
})
