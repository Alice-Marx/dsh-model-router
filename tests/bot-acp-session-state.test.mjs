// Fast, in-process tests for the ACP session state machine.
//
// No child process here: a fake link speaks the same wire shape, so the
// session rules — serial turns, resume gating, stop reasons, model/mode
// advertisement, permission routing — are proven without a supervisor. The
// native suite (tests/bot-acp-session.native.mjs) runs the same rules against
// a real offline agent child.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { createAcpSession, mergeSessionUpdate, usageEvidence } from '../packages/bot-acp/src/session-core.mjs'

/** A fake agent link: records what the session sent and answers like an agent. */
const createFakeLink = (agent, overrides = {}) => {
  const link = {
    threadId: 'thread-1',
    sessionId: null,
    closed: false,
    inbound: null,
    request: (method, params, options) => agent.request(method, params, link, options),
    notify: (method, params) => agent.notify(method, params),
    respond: (id, result) => agent.respond(id, result),
    respondError: (id, code, message) => agent.respondError(id, code, message),
    close: () => { link.closed = true },
    ...overrides,
  }
  return link
}

const fakeAgent = ({ loadSession = true, loadRefused = false, configOptions = null, models = null, modes = null, protocolVersion = 1, authMethods = [{ id: 'token' }], quiet = false } = {}) => {
  const state = { requests: [], notifications: [], responses: [], errors: [], sessions: [], promptTurns: 0, nextId: 1 }
  const sessionNewResult = () => ({
    sessionId: `sess-${++state.sessions.length}`,
    ...(configOptions ? { configOptions } : {}),
    ...(models ? { models } : {}),
    ...(modes ? { modes } : {}),
  })
  const agent = {
    state,
    sessionNewResult,
    /** Deliver one session/update notification to the session under test. */
    update: (session, value) => sessionLinks.get(session)?.inbound?.notification({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: session.sessionId, update: value } }),
    /** Deliver one server request (permission, fs, terminal) to the session. */
    serverRequest: (session, method, params) => sessionLinks.get(session)?.inbound?.request({ jsonrpc: '2.0', id: 500 + ++state.nextId, method, params }),
    request: async (method, params, link, options) => {
      state.requests.push({ method, params })
      switch (method) {
        case 'initialize':
          return {
            protocolVersion,
            authMethods,
            agentInfo: { name: 'fake-agent', version: '9.9' },
            ...(loadSession || configOptions || models || modes ? { agentCapabilities: { loadSession, sessionCapabilities: { close: {} } } } : {}),
          }
        case 'authenticate':
          return {}
        case 'session/new':
          return sessionNewResult()
        case 'session/load':
          if (loadRefused) {
            const error = new Error('session not found')
            error.code = -32602
            error.rpcData = { sessionId: params.sessionId }
            throw error
          }
          return { sessionId: params.sessionId, ...(models ? { models } : {}) }
        case 'session/set_model':
          return { models: { availableModels: models?.availableModels ?? [], currentModelId: params.modelId } }
        case 'session/set_config_option':
          return { configOptions: [{ id: params.configId, type: 'select', currentValue: params.value }] }
        case 'session/set_mode':
          return {}
        case 'session/prompt':
          // Stream one text chunk, then settle the turn as the agent would.
          if (!quiet && typeof link?.inbound?.notification === 'function') {            link.inbound.notification({
              jsonrpc: '2.0',
              method: 'session/update',
              params: { sessionId: params?.sessionId ?? null, update: { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'fixture reply. ' } } },
            })
          }
          return { stopReason: 'end_turn' }
        default:
          throw Object.assign(new Error(`fake agent cannot ${method}`), { code: -32601 })
      }
    },
    notify: (method, params) => state.notifications.push({ method, params }),
    respond: (id, result) => state.responses.push({ id, result }),
    respondError: (id, code, message) => state.errors.push({ id, code, message }),
  }
  return agent
}

/** Sessions under test, keyed to the fake link their agent talks through. */
const sessionLinks = new WeakMap()

const makeSession = (agent, overrides = {}) => {
  const link = createFakeLink(agent)
  const session = createAcpSession({
    host: { once: (name, start) => start() },
    link,
    cwd: 'C:\\workspace',
    clientInfo: { name: 'test-client', version: '1.0.0' },
    ...overrides,
  })
  sessionLinks.set(session, link)
  return session
}
const turnState = () => ({ text: '', producedItem: false, repliedText: false, runningTools: new Set(), usagePeak: null, usageLast: null, usageCompacted: false, textMessageId: null, updates: [] })

describe('session update merging', () => {
  test('appends text, tracks tools and reads usage', () => {
    const state = turnState()
    mergeSessionUpdate(state, { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'hello ' } }, 's1')
    mergeSessionUpdate(state, { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'world' } }, 's1')
    mergeSessionUpdate(state, { sessionUpdate: 'tool_call', toolCallId: 't1', status: 'pending' }, 's1')
    assert.equal(state.text, 'hello world')
    assert.equal(state.textMessageId, 'm1')
    assert.deepEqual([...state.runningTools], ['t1'])
    mergeSessionUpdate(state, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' }, 's1')
    assert.equal(state.runningTools.size, 0)
    mergeSessionUpdate(state, { sessionUpdate: 'usage_update', used: 1000, size: 100000 }, 's1')
    mergeSessionUpdate(state, { sessionUpdate: 'usage_update', used: 2000, size: 100000 }, 's1')
    mergeSessionUpdate(state, { sessionUpdate: 'usage_update', used: 500, size: 100000 }, 's1')
    assert.equal(state.usagePeak, 2000)
    assert.equal(state.usageLast, 500)
    assert.equal(state.usageCompacted, true)
  })

  test('never invents text from an unknown update', () => {
    const state = turnState()
    const entry = mergeSessionUpdate(state, { sessionUpdate: 'something_new' }, 's1')
    assert.equal(entry.ignored, true)
    assert.equal(state.text, '')
    assert.equal(usageEvidence(state).reported, false)
    assert.equal(usageEvidence(state).status, 'unknown')
  })
})

describe('session lifecycle', () => {
  test('opens a session and runs two turns on the same sessionId', async () => {
    const agent = fakeAgent()
    const session = makeSession(agent)
    const opened = await session.openSession()
    assert.equal(opened.ok, true)
    assert.equal(opened.sessionId, 'sess-1')
    assert.equal(session.sessionId, 'sess-1')

    const promptRequest = session.prompt({ text: 'first turn' })
    // The agent streams before it answers.
    await Promise.resolve()
    const first = await promptRequest
    assert.equal(first.ok, true)
    assert.equal(first.outcome, 'succeeded')
    assert.equal(first.sessionId, 'sess-1')
    assert.equal(session.turns, 1)

    const second = await session.prompt({ text: 'second turn' })
    assert.equal(second.ok, true)
    assert.equal(session.turns, 2)
    // Only one session/new was ever sent.
    assert.equal(agent.state.requests.filter(entry => entry.method === 'session/new').length, 1)
    assert.equal(agent.state.requests.filter(entry => entry.method === 'session/prompt').length, 2)
    assert.equal(second.costUsd, null)
    assert.equal(second.costStatus, 'unknown')
  })

  test('resumes only when the agent advertises loadSession', async () => {
    const agent = fakeAgent({ loadSession: true })
    const session = makeSession(agent)
    const resumed = await session.openSession({ resumeSessionId: 'old-session' })
    assert.equal(resumed.ok, true)
    assert.equal(resumed.sessionId, 'old-session')
    assert.equal(resumed.resumed, true)

    const silent = fakeAgent({ loadSession: false, models: null, configOptions: null })
    const gated = makeSession(silent)
    const refused = await gated.openSession({ resumeSessionId: 'old-session' })
    assert.equal(refused.ok, false)
    assert.equal(refused.stopReason, 'resume-unsupported')
    assert.equal(silent.state.requests.some(entry => entry.method === 'session/new'), false)
  })

  test('a refused resume never opens a new session or replays the turn', async () => {
    const agent = fakeAgent({ loadSession: true, loadRefused: true })
    const session = makeSession(agent)
    const refused = await session.openSession({ resumeSessionId: 'gone' })
    assert.equal(refused.ok, false)
    assert.equal(refused.stopReason, 'resume-refused')
    assert.equal(session.sessionId, null)
    assert.equal(agent.state.requests.some(entry => entry.method === 'session/new'), false)
    await assert.rejects(session.prompt({ text: 'do it again' }), /ACP_NO_SESSION/)
  })

  test('refuses a session/new without a sessionId', async () => {
    const agent = fakeAgent({ loadSession: true })
    agent.request = async (method) => {
      if (method === 'session/new') return {}
      return fakeAgent().request(method, {}, null, {})
    }
    const session = makeSession(agent)
    await assert.rejects(session.openSession(), /no sessionId/)
  })

  test('rejects a protocol version it does not speak', async () => {
    const agent = fakeAgent({ protocolVersion: 999 })
    const session = makeSession(agent)
    await assert.rejects(session.openSession(), /protocol version mismatch/)
  })
})

describe('turn rules', () => {
  test('accepts text only and refuses anything else', async () => {
    const agent = fakeAgent()
    const session = makeSession(agent)
    await session.openSession()
    await assert.rejects(session.prompt({ text: 'hi', executable: 'cmd.exe' }), /only \{ text \}/)
    await assert.rejects(session.prompt({ text: '   ' }), /ACP_TURN_TEXT_INVALID/)
    await assert.rejects(session.prompt({ text: 'a\u0000b' }), /ACP_TURN_TEXT_INVALID/)
    await assert.rejects(session.prompt({ text: 'x'.repeat(65_000) }), /ACP_TURN_TEXT_INVALID/)
    await assert.rejects(session.prompt('not an object'), /only \{ text \}/)
  })

  test('refuses a second turn while one is running', async () => {
    const agent = fakeAgent()
    const session = makeSession(agent)
    await session.openSession()
    let release
    agent.request = async (method, params, link) => {
      if (method === 'session/prompt') {
        return new Promise(resolve => {
          release = () => {
            link.inbound?.notification({
              jsonrpc: '2.0',
              method: 'session/update',
              params: { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'done. ' } } },
            })
            resolve({ stopReason: 'end_turn' })
          }
        })
      }
      return fakeAgent().request(method, params, link, {})
    }
    const first = session.prompt({ text: 'long turn' })
    await assert.rejects(session.prompt({ text: 'too soon' }), /ACP_SESSION_BUSY/)
    assert.equal(session.busy, true)
    release()
    assert.equal((await first).ok, true)
    assert.equal(session.busy, false)
  })

  test('reports an unknown stop reason instead of calling it success', async () => {
    const agent = fakeAgent()
    const session = makeSession(agent)
    await session.openSession()
    agent.request = async (method, params, link) => (method === 'session/prompt' ? { stopReason: 'max_turn_requests' } : fakeAgent().request(method, params, link, {}))
    const outcome = await session.prompt({ text: 'run' })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.outcome, 'failed')
    assert.equal(outcome.stopReason, 'max_turn_requests')
    assert.match(outcome.errorText, /max_turn_requests/)
  })

  test('treats end_turn with no output as a lost turn', async () => {
    const agent = fakeAgent({ quiet: true })
    const session = makeSession(agent)
    await session.openSession()
    const outcome = await session.prompt({ text: 'run' })
    assert.equal(outcome.ok, false)
    assert.equal(outcome.stopReason, 'empty_turn')
  })

  test('reports a cancel the agent confirms, and keeps the request apart', async () => {
    const agent = fakeAgent()
    const session = makeSession(agent)
    await session.openSession()
    let release
    agent.request = async (method, params, link) => (method === 'session/prompt' ? new Promise(resolve => { release = () => resolve({ stopReason: 'cancelled' }) }) : fakeAgent().request(method, params, link, {}))
    const pending = session.prompt({ text: 'slow' })
    assert.equal(session.cancel(), true)
    assert.equal(session.stats.cancelRequestedAt !== null, true)
    assert.equal(agent.state.notifications.length, 1)
    assert.equal(agent.state.notifications[0].method, 'session/cancel')
    release()
    const outcome = await pending
    assert.equal(outcome.ok, true)
    assert.equal(outcome.outcome, 'cancelled')
    assert.equal(outcome.stopReason, 'cancelled')
    assert.equal(outcome.cancelRequestedAt !== null, true)
  })

  test('reports an aborted turn as cancelled with the abort evidence', async () => {
    const controller = new AbortController()
    const agent = fakeAgent()
    const session = makeSession(agent, { signal: controller.signal })
    await session.openSession()
    agent.request = async (method, params, link) => (method === 'session/prompt' ? new Promise(() => {}) : fakeAgent().request(method, params, link, {}))
    const pending = session.prompt({ text: 'slow' })
    controller.abort()
    const outcome = await pending
    assert.equal(outcome.outcome, 'cancelled')
    assert.equal(outcome.stopReason, 'cancelled')
  })

  test('keeps usage null when the agent reports none', async () => {
    const agent = fakeAgent()
    const session = makeSession(agent)
    await session.openSession()
    agent.request = async (method, params, link) => (method === 'session/prompt' ? { stopReason: 'end_turn' } : fakeAgent().request(method, params, link, {}))
    const outcome = await session.prompt({ text: 'hello' })
    assert.equal(outcome.usage.reported, false)
    assert.equal(outcome.usage.status, 'unknown')
    assert.equal(outcome.usage.inputTokens, null)
    assert.equal(outcome.costUsd, null)
  })
})

describe('model and mode control', () => {
  test('switches only to an advertised model and requires Host authorization', async () => {
    const agent = fakeAgent({ configOptions: [{ id: 'model', type: 'select', currentValue: 'a', options: [{ value: 'a' }, { value: 'b' }] }] })
    const session = makeSession(agent, {
      assertModelAuthorized: modelId => { if (!['b', 'c'].includes(modelId)) throw new Error('MODEL_DENIED') },
    })
    await session.openSession()
    const selected = await session.selectModel('b')
    assert.equal(selected.modelId, 'b')
    assert.equal(agent.state.requests.at(-1).method, 'session/set_config_option')
    await assert.rejects(session.selectModel('c'), /ACP_MODEL_NOT_ADVERTISED/)
    await assert.rejects(session.selectModel('a'), /MODEL_DENIED/)
  })

  test('refuses a model switch the agent does not advertise at all', async () => {
    const agent = fakeAgent({ loadSession: true, models: null, configOptions: null })
    const session = makeSession(agent, { assertModelAuthorized: () => {} })
    await session.openSession()
    await assert.rejects(session.selectModel('b'), /ACP_MODEL_SELECTION_UNAVAILABLE/)
  })

  test('refuses a mode the agent does not advertise', async () => {
    const agent = fakeAgent({ modes: [{ id: 'default' }, { id: 'auto-edit' }] })
    const session = makeSession(agent)
    await session.openSession()
    assert.deepEqual(await session.setMode('auto-edit'), { modeId: 'auto-edit' })
    await assert.rejects(session.setMode('yolo'), /ACP_MODE_NOT_ADVERTISED/)
  })
})

describe('permission routing during a turn', () => {
  const permissionParams = {
    sessionId: 'sess-1',
    toolCall: { toolCallId: 'tool-1', title: 'run', kind: 'execute', rawInput: { command: 'echo hi' } },
    options: [
      { optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' },
      { optionId: 'reject-once', kind: 'reject_once', name: 'Reject once' },
    ],
  }

  /** Start a turn the agent holds open, so asks arrive while it runs. */
  const openTurn = async (agent, session) => {
    let release
    agent.request = async (method, params, link) => {
      if (method === 'session/prompt') {
        return new Promise(resolve => {
          release = () => {
            link.inbound?.notification({
              jsonrpc: '2.0',
              method: 'session/update',
              params: { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'working. ' } } },
            })
            resolve({ stopReason: 'end_turn' })
          }
        })
      }
      return fakeAgent().request(method, params, link, {})
    }
    const pending = session.prompt({ text: 'do the thing' })
    await new Promise(resolve => setImmediate(resolve))
    return { pending, release: () => release() }
  }

  test('answers with the Host-selected option', async () => {
    const agent = fakeAgent()
    const updates = []
    const session = makeSession(agent, {
      onPermissionRequest: async () => ({ behavior: 'allow' }),
      onUpdate: entry => updates.push(entry),
    })
    await session.openSession()
    const turn = await openTurn(agent, session)
    agent.serverRequest(session, 'session/request_permission', permissionParams)
    await new Promise(resolve => setImmediate(resolve))
    const answer = agent.state.responses.at(-1)
    assert.deepEqual(answer.result, { outcome: { outcome: 'selected', optionId: 'allow-once' } })
    assert.equal(updates.some(entry => entry.kind === 'permission-resolved' && entry.behavior === 'allow'), true)
    turn.release()
    assert.equal((await turn.pending).ok, true)
    session.close()
  })

  test('cancels the ask when the Host denies', async () => {
    const agent = fakeAgent()
    const session = makeSession(agent, { onPermissionRequest: async () => ({ behavior: 'deny' }) })
    await session.openSession()
    const turn = await openTurn(agent, session)
    agent.serverRequest(session, 'session/request_permission', permissionParams)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(agent.state.responses.at(-1).result, { outcome: { outcome: 'cancelled' } })
    turn.release()
    await turn.pending
    session.close()
  })

  test('cancels an ask with no Host handler at all', async () => {
    const agent = fakeAgent()
    const session = makeSession(agent)
    await session.openSession()
    const turn = await openTurn(agent, session)
    agent.serverRequest(session, 'session/request_permission', permissionParams)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(agent.state.responses.at(-1).result, { outcome: { outcome: 'cancelled' } })
    assert.equal(session.permissions.stats.noHandler, 1)
    turn.release()
    await turn.pending
    session.close()
  })

  test('refuses fs and terminal requests the client never advertised', async () => {
    const agent = fakeAgent()
    const session = makeSession(agent)
    await session.openSession()
    const turn = await openTurn(agent, session)
    agent.serverRequest(session, 'fs/read_text_file', { path: 'C:\workspace\secret.txt' })
    agent.serverRequest(session, 'terminal/create', { command: 'cmd.exe' })
    await new Promise(resolve => setImmediate(resolve))
    const errors = agent.state.errors
    assert.equal(errors.length, 2)
    for (const error of errors) {
      assert.equal(error.code, -32601)
      assert.match(error.message, /not found/)
    }
    turn.release()
    await turn.pending
    session.close()
  })

  test('answers a permission ask that arrives between turns as cancelled', async () => {
    const agent = fakeAgent()
    const session = makeSession(agent, { onPermissionRequest: async () => ({ behavior: 'allow' }) })
    await session.openSession()
    agent.serverRequest(session, 'session/request_permission', permissionParams)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(agent.state.responses.at(-1).result, { outcome: { outcome: 'cancelled' } })
    assert.equal(session.permissions.stats.asks, 0)
    session.close()
  })
})
