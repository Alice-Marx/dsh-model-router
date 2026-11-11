import assert from 'node:assert/strict'
import { test } from 'node:test'
import { markAgentLoopRequest, isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, canonicalHeader } from '@deepseek-ai/dsh-session'
import { withModelLoopFrame, GENERATIONS, LOOP_FRAME_VERDICT } from './helpers/model-loop-frame.mjs'

// The integrated AgentLoop's same-generation frame, against the real accounting over a
// real SQLite router state, the real principal authority and the installed
// Cordis/LlmRuntime with the installed dsh-session Session. Only the provider transport
// is offline, and the loop step is the installed AgentLoop's public seam replayed
// (prepareCall -> session request/header + request/context -> frozen marked request ->
// prepared.stream), not a full AgentLoop turn.
//
// The generation discriminators are the two registrations: A = {4096, 64} is the larger
// one, B = {2000, 16} the smaller. A loop step prepared under A and dispatched after the
// route was swapped to B must be priced on A — and a bound that A exceeds must refuse the
// step before any provider call, receipt or reservation exists.

const reject = (code, run) => assert.rejects(run, error => error.code === code)
const loopEnvelope = (session, overrides = {}) => markAgentLoopRequest(Object.freeze({
  provider: 'alpha', model: 'one', maxTokens: GENERATIONS.A.defaultMaxTokens,
  messages: Object.freeze([{ role: 'user', content: [{ type: 'text', text: 'loop step' }] }]),
  sessionId: session.id, signal: new AbortController().signal, ...overrides,
}))

test('the logged fold is the one the installed session’s own canonicalHeader produces', async () => {
  // Fidelity of the replay: the fold the loop reads is built by the installed
  // dsh-session's canonicalHeader — the very function dsh-agent-loop
  // lib/index.js:1217-1221 calls before it appends `request/header`.
  await withModelLoopFrame(async h => {
    const { request } = await h.loop()
    assert.deepEqual(h.session.requestHeader(), canonicalHeader({
      config: { provider: 'alpha', model: 'one', maxTokens: GENERATIONS.A.defaultMaxTokens },
      adapterDefaults: { maxTokens: true },
    }))
    assert.deepEqual(h.session.requestContext(), { provider: 'alpha', model: 'one', contextWindow: GENERATIONS.A.contextWindow })
    // The request envelope is the logged config plus the loop's own fields, frozen.
    assert.deepEqual(Object.keys(request).sort(), ['maxTokens', 'messages', 'model', 'provider', 'sessionId', 'signal', 'toolHistory'])
    assert.ok(Object.isFrozen(request.messages) && Object.isFrozen(request.messages[0]))
  })
})

test('a loop step is admitted on the window its session log bound, not the replaced registration', async () => {
  await withModelLoopFrame(async h => {
    const { request, chunks } = await h.loop({}, { gate: () => h.useSwap() })
    assert.ok(chunks.some(chunk => chunk.type === 'finish'))
    // The one-shot stream dispatched A — the generation it was prepared with — while the
    // registration the accounting would have read was already B.
    assert.equal(h.upstream.length, 1)
    assert.equal(h.upstream[0].adapter, 'A')
    assert.equal(h.upstream[0].maxTokens, GENERATIONS.A.defaultMaxTokens)
    // Admission used the frame, so it never read the current registration at all.
    assert.deepEqual(h.reads, [])
    assert.equal(h.verdicts.length, 1)
    const verdict = h.verdicts[0]
    assert.equal(verdict.kind, LOOP_FRAME_VERDICT.FRAME)
    assert.equal(verdict.frame.provider, 'alpha')
    assert.equal(verdict.frame.model, 'one')
    assert.equal(verdict.frame.bounds.contextWindow, GENERATIONS.A.contextWindow)
    assert.equal(verdict.frame.bounds.defaultMaxTokens, GENERATIONS.A.defaultMaxTokens)
    assert.equal(verdict.frame.request, request)
    assert.ok(Object.isFrozen(verdict.frame) && Object.isFrozen(verdict.frame.bounds))
    const receipts = await h.receipts()
    assert.equal(receipts.length, 1)
    assert.equal(receipts[0].outcome, 'succeeded')
    assert.equal(h.runs().length, 1)
    assert.equal(h.runs()[0].status, 'completed')
    assert.deepEqual(await h.holds(), [])
    // The read the frame replaced would have named B, so the miscount window is real.
    const current = await h.llm.resolveModelInfo('alpha', 'one')
    assert.equal(current.context?.contextWindow, GENERATIONS.B.contextWindow)
    assert.equal(current.defaultMaxTokens, GENERATIONS.B.defaultMaxTokens)
  })
})

test('a loop step whose captured window exceeds the trusted bound is refused before any provider call, receipt or reservation', async () => {
  // The trusted bound sits between B's window and A's: only a read that names B admits
  // this step, and only a frame that names A refuses it.
  await withModelLoopFrame(async h => {
    await reject('MODEL_INPUT_BOUNDARY_REQUIRED', h.loop({}, { gate: () => h.useSwap() }))
    assert.equal(h.upstream.length, 0)
    assert.equal((await h.receipts()).length, 0)
    assert.equal(h.runs().length, 0)
    assert.deepEqual(await h.holds(), [])
    // The frame was found, so no registration read stood in for it either.
    assert.deepEqual(h.reads, [])
    assert.equal(h.verdicts.length, 1)
    assert.equal(h.verdicts[0].kind, LOOP_FRAME_VERDICT.FRAME)
  }, { maxInputTokens: 3000 })
})

test('the registration read the frame replaces would have admitted the very same step', async () => {
  // The control: with the frame unwired, the same prepared-and-swapped step is admitted
  // on B's smaller window and dispatches A's generation. That is the miscount the frame
  // closes, proven through the real accounting and the real SQLite ledger.
  await withModelLoopFrame(async h => {
    const { chunks } = await h.loop({}, { gate: () => h.useSwap() })
    assert.ok(chunks.some(chunk => chunk.type === 'finish'))
    assert.equal(h.upstream.length, 1)
    assert.equal(h.upstream[0].adapter, 'A')
    assert.equal(h.upstream[0].maxTokens, GENERATIONS.A.defaultMaxTokens)
    assert.equal(h.reads.length, 1)
    assert.equal(h.reads[0].inputBound, GENERATIONS.B.contextWindow)
    assert.equal(h.reads[0].outputDefault, GENERATIONS.B.defaultMaxTokens)
    assert.deepEqual(h.verdicts, [])
    assert.equal((await h.receipts()).length, 1)
    assert.equal((await h.receipts())[0].outcome, 'succeeded')
  }, { maxInputTokens: 3000, frameSource: 'read' })
})

test('a second step after the swap is priced on the generation that dispatches it', async () => {
  await withModelLoopFrame(async h => {
    // Step one runs under A; step two is prepared and dispatched under B. Each is priced
    // on its own logged generation, and neither reads the other's registration.
    await h.loop()
    assert.equal(h.upstream[0].adapter, 'A')
    h.useSwap()
    const second = await h.loop()
    assert.equal(h.upstream.length, 2)
    assert.equal(h.upstream[1].adapter, 'B')
    assert.equal(h.upstream[1].maxTokens, GENERATIONS.B.defaultMaxTokens)
    assert.deepEqual(h.reads, [])
    assert.equal(h.verdicts.length, 2)
    assert.deepEqual(h.verdicts.map(verdict => verdict.frame.bounds.contextWindow),
      [GENERATIONS.A.contextWindow, GENERATIONS.B.contextWindow])
    assert.equal((await h.receipts()).length, 2)
    assert.equal(second.request.maxTokens, GENERATIONS.B.defaultMaxTokens)
  })
})

test('the admission leaves the frozen loop request exactly as the loop built it', async () => {
  await withModelLoopFrame(async h => {
    const { request } = await h.loop({}, { gate: () => h.useSwap() })
    const fields = Object.getOwnPropertyNames(request).sort()
    const values = Object.fromEntries(fields.map(name => [name, request[name]]))
    assert.ok(Object.isFrozen(request))
    assert.ok(isAgentLoopRequest(request))
    assert.equal(h.upstream.length, 1)
    // Nothing was written onto the envelope: same fields, same values, still frozen.
    assert.deepEqual(Object.getOwnPropertyNames(request).sort(), fields)
    assert.deepEqual(Object.fromEntries(fields.map(name => [name, request[name]])), values)
    assert.ok(Object.isFrozen(request))
    assert.equal(request.maxTokens, GENERATIONS.A.defaultMaxTokens)
    assert.equal((await h.receipts()).length, 1)
  })
})

test('an aux call carrying the conversation session is never priced on the conversation', async () => {
  await withModelLoopFrame(async h => {
    // An aux call with the conversation's own sessionId and an aux purpose: the frame
    // must not apply, and today's registration read prices it instead.
    const seen = await h.raw(h.request({ purpose: 'compaction' }))
    assert.ok(seen.some(chunk => chunk.type === 'finish'))
    assert.equal(h.upstream.length, 1)
    assert.equal(h.reads.length, 1)
    assert.equal(h.reads[0].inputBound, GENERATIONS.A.contextWindow)
    assert.equal(h.verdicts.length, 1)
    assert.equal(h.verdicts[0].kind, LOOP_FRAME_VERDICT.AUX)
    assert.equal((await h.receipts()).length, 1)
  })
})

test('a marked request that names an aux purpose is not the conversation step', async () => {
  await withModelLoopFrame(async h => {
    const { request } = await h.loop()
    assert.equal(h.resolver(markAgentLoopRequest(Object.freeze({ ...request, purpose: 'compaction' }))).kind, LOOP_FRAME_VERDICT.AUX)
    assert.equal(h.resolver(h.request({ purpose: 'session-title' })).kind, LOOP_FRAME_VERDICT.AUX)
  })
})

test('a copy of the marked request is not the marked request', async () => {
  await withModelLoopFrame(async h => {
    const { request } = await h.loop()
    const copy = { ...request }
    assert.equal(isAgentLoopRequest(copy), false)
    assert.equal(h.resolver(copy).kind, LOOP_FRAME_VERDICT.AUX)
    // A re-marked copy is still not the loop's frozen envelope.
    const remarked = h.resolver(markAgentLoopRequest(copy))
    assert.equal(remarked.kind, LOOP_FRAME_VERDICT.INVALID)
    assert.equal(remarked.reason, 'loop-request-not-canonical')
  })
})

test('a fold about another route is invalid, and the funded call is refused', async () => {
  await withModelLoopFrame(async h => {
    // The logged header and context name a model this request does not: the fold is
    // another route's, and pricing it against this endpoint is the mixing to prevent.
    const drift = () => {
      h.session.append('request/header', { header: { config: { provider: 'alpha', model: 'two', maxTokens: GENERATIONS.B.defaultMaxTokens } }, reason: 'change' })
      h.session.append('request/context', { provider: 'alpha', model: 'two', contextWindow: GENERATIONS.B.contextWindow })
    }
    await reject('MODEL_LOOP_FRAME_INVALID', h.loop({}, { gate: drift }))
    assert.equal(h.upstream.length, 0)
    assert.equal((await h.receipts()).length, 0)
    assert.equal(h.runs().length, 0)
    assert.deepEqual(await h.holds(), [])
    assert.equal(h.verdicts.at(-1).kind, LOOP_FRAME_VERDICT.INVALID)
    assert.equal(h.verdicts.at(-1).reason, 'loop-route-drift')
  })
})

test('a fold from another step of the conversation is invalid, not a frame', async () => {
  await withModelLoopFrame(async h => {
    // The header is overwritten with another step's output bound before this dispatch,
    // so the fold in hand is not the one this request runs on.
    await reject('MODEL_LOOP_FRAME_INVALID', h.loop({}, { gate: () => h.session.append('request/header', {
      header: { config: { provider: 'alpha', model: 'one', maxTokens: GENERATIONS.B.defaultMaxTokens } }, reason: 'change' }) }))
    assert.equal(h.upstream.length, 0)
    assert.equal((await h.receipts()).length, 0)
    assert.equal(h.verdicts.at(-1).kind, LOOP_FRAME_VERDICT.INVALID)
    assert.equal(h.verdicts.at(-1).reason, 'loop-control-drift')
  })
})

// A live session with the same identity but no request events at all: the seam the loop
// writes before dispatch is absent.
const emptyTwin = () => Session.create(SessionId('loop-frame-session'))
// A live session about a different conversation, whose fold names another route.
const otherRoute = () => {
  const other = Session.create(SessionId('another-session'))
  other.append('request/header', { header: { config: { provider: 'alpha', model: 'one', maxTokens: GENERATIONS.A.defaultMaxTokens } }, reason: 'initial' })
  other.append('request/context', { provider: 'alpha', model: 'one', contextWindow: GENERATIONS.A.contextWindow })
  return other
}

test('a loop step with no logged generation has no frame, and the funded call is refused', async () => {
  await withModelLoopFrame(async h => {
    await reject('MODEL_LOOP_FRAME_MISSING', h.raw(loopEnvelope(h.session)))
    assert.equal(h.upstream.length, 0)
    assert.equal((await h.receipts()).length, 0)
    assert.equal(h.runs().length, 0)
    assert.deepEqual(await h.holds(), [])
    assert.deepEqual(h.reads, [])
    assert.equal(h.verdicts.at(-1).kind, LOOP_FRAME_VERDICT.MISSING)
    assert.equal(h.verdicts.at(-1).reason, 'loop-context-fold-absent')
  }, { sessionFor: () => emptyTwin() })
})

test('a loop step whose adapter declares no output cap has no same-generation frame', async () => {
  // The shape the NO_ADAPTER fallback leaves: the request carries no materialized bound,
  // so there is no dispatched output to admit. It is refused, never priced on a read.
  await withModelLoopFrame(async h => {
    await reject('MODEL_LOOP_FRAME_MISSING', h.loop({}, { route: { provider: 'alpha', model: 'nodefault' } }))
    assert.equal(h.upstream.length, 0)
    assert.equal((await h.receipts()).length, 0)
    assert.deepEqual(h.reads, [])
    assert.equal(h.verdicts.at(-1).kind, LOOP_FRAME_VERDICT.MISSING)
    assert.equal(h.verdicts.at(-1).reason, 'loop-output-bound-unmaterialized')
  })
})

test('a fold whose window is not a safe integer has no frame', async () => {
  await withModelLoopFrame(async h => {
    await reject('MODEL_LOOP_FRAME_MISSING', h.loop({}, { gate: () => h.session.append('request/context', { provider: 'alpha', model: 'one', contextWindow: 'wide' }) }))
    assert.equal(h.upstream.length, 0)
    assert.equal((await h.receipts()).length, 0)
    assert.equal(h.verdicts.at(-1).kind, LOOP_FRAME_VERDICT.MISSING)
    assert.equal(h.verdicts.at(-1).reason, 'loop-context-window-unbound')
  })
})

test('a marked request without a session id is invalid', async () => {
  await withModelLoopFrame(async h => {
    const verdict = h.resolver(markAgentLoopRequest(Object.freeze({
      provider: 'alpha', model: 'one', maxTokens: GENERATIONS.A.defaultMaxTokens,
      messages: Object.freeze([{ role: 'user', content: [{ type: 'text', text: 'loop step' }] }]),
      signal: new AbortController().signal,
    })))
    assert.equal(verdict.kind, LOOP_FRAME_VERDICT.INVALID)
    assert.equal(verdict.reason, 'loop-session-id-missing')
  })
})

test('a loop step whose session is not live is a missing record, and the funded call is refused', async () => {
  await withModelLoopFrame(async h => {
    await reject('MODEL_LOOP_FRAME_MISSING', h.raw(loopEnvelope(h.session)))
    assert.equal(h.upstream.length, 0)
    assert.equal((await h.receipts()).length, 0)
    assert.deepEqual(h.reads, [])
    assert.equal(h.verdicts.at(-1).kind, LOOP_FRAME_VERDICT.MISSING)
    assert.equal(h.verdicts.at(-1).reason, 'host-session-not-live')
  }, { sessionFor: () => null })
})

test('a throwing session lookup is unsupported, and today’s read stands', async () => {
  await withModelLoopFrame(async h => {
    const seen = await h.raw(loopEnvelope(h.session))
    assert.ok(seen.some(chunk => chunk.type === 'finish'))
    assert.equal(h.upstream.length, 1)
    assert.equal(h.verdicts.length, 1)
    assert.equal(h.verdicts[0].kind, LOOP_FRAME_VERDICT.UNSUPPORTED_HOST)
    assert.equal(h.verdicts[0].reason, 'host-lookup-failed')
    // The Host could not answer, so the step keeps today's registration read: the
    // same-generation gap is still open for it, and that is what gets reported.
    assert.equal(h.reads.length, 1)
    assert.equal(h.reads[0].inputBound, GENERATIONS.A.contextWindow)
    assert.equal((await h.receipts()).length, 1)
  }, { sessionFor: () => { throw new Error('host unavailable') } })
})

test('a sessions service that is not a SessionStore is unsupported, not a frame', async () => {
  await withModelLoopFrame(async h => {
    const verdict = h.resolver(loopEnvelope(h.session))
    assert.equal(verdict.kind, LOOP_FRAME_VERDICT.UNSUPPORTED_HOST)
    assert.equal(verdict.reason, 'host-session-service-unusable')
  }, { sessionFor: () => ({}) })
})

test('a Host that never wired the session seam reports the gap instead of closing it', async () => {
  await withModelLoopFrame(async h => {
    const { request } = await h.loop()
    const verdict = h.resolver(request)
    assert.equal(verdict.kind, LOOP_FRAME_VERDICT.UNSUPPORTED_HOST)
    assert.equal(verdict.reason, 'host-lookup-unwired')
    // Without the seam the loop step falls back to today's registration read, which is
    // exactly the gap that stays open: nothing here may be reported as closed.
    assert.equal(h.reads.length, 1)
    assert.equal((await h.receipts()).length, 1)
  }, { wireLookup: false })
})

test('a lookup that answers about another session is invalid', async () => {
  await withModelLoopFrame(async h => {
    const verdict = h.resolver(loopEnvelope(h.session))
    assert.equal(verdict.kind, LOOP_FRAME_VERDICT.INVALID)
    assert.equal(verdict.reason, 'host-session-identity-mismatch')
  }, { sessionFor: () => otherRoute() })
})

test('a secret rewrite that rebuilds the request loses the loop marker, and that is reported', async () => {
  // The frozen ds-bot listener rebuilds the request and re-enters `llm.stream` when it
  // finds a secret (vendor ds-bot src/host/secrets.js). The rebuilt envelope is neither
  // marked nor frozen, so the frame does not apply and the call is re-dispatched by the
  // vendor's own unprepared path. This is a real boundary of the seam, proven rather than
  // hidden: the same-generation frame covers the request the loop itself dispatched.
  await withModelLoopFrame(async h => {
    const { chunks } = await h.loop()
    assert.ok(chunks.some(chunk => chunk.type === 'finish'))
    assert.equal(h.upstream.length, 1)
    assert.equal(h.upstream[0].adapter, 'A')
    assert.equal(h.verdicts.length, 1)
    assert.equal(h.verdicts[0].kind, LOOP_FRAME_VERDICT.AUX)
    assert.equal(h.reads.length, 1)
    assert.equal(h.reads[0].inputBound, GENERATIONS.A.contextWindow)
    assert.equal((await h.receipts()).length, 1)
  }, {
    rewrite: ({ ctx, llm }) => ctx.on('llm/stream', (options, next) => {
      if (!isAgentLoopRequest(options)) return next()
      return llm.stream({ ...options, messages: [...options.messages] })
    }),
  })
})
