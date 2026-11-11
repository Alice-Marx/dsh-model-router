// The same-generation frame for the integrated AgentLoop path, read from the session log.
//
// The installed SDK's `LlmRuntime.prepareCall` is the only public seam that binds one
// adapter registration's metadata to its own dispatch (dsh-llm lib/index.js 2220-2261:
// capture the registration at 2224, one-shot dispatch at 2249-2258). The integrated
// AgentLoop already uses it (dsh-agent-loop lib/index.js:1201) and, BEFORE dispatch,
// synchronously logs that exact generation into its Session: `request/header` with the
// resolved config plus the `adapterDefaults` flags (lib/index.js:1226-1240) and
// `request/context` with the context window (lib/index.js:1262-1271). The fold of those
// events (`Session.requestHeader()` / `Session.requestContext()`, dsh-session
// lib/index.js:1612/1627) therefore carries the generation the loop's frozen marked
// request will dispatch, even when the current registration was replaced after the
// loop's prepareCall — proven causally by experiment E1 in
// tmp/integration/integrated-generation-study-1/experiment.mjs (dispatch A, current
// registration read B, session-log fold A).
//
// The fold is the CONVERSATION's latest state, not a per-call receipt: it is not, by
// itself, proof that it describes this one call. This module therefore derives a frame
// only for a request that carries every public anchor the AgentLoop leaves on it, and
// answers with a verdict the caller must act on rather than a bare frame-or-null:
//
//   frame            the fold describes this exact request; price and admit on it.
//   aux              not a conversation step (no loop marker, or an aux purpose). The
//                    caller keeps its existing path — an ordinary request, or a
//                    caller-owned prepared call that carries its own frame.
//   unsupportedHost  the Host could not answer at all (no session lookup wired, a
//                    sessions service that is not a SessionStore, a throwing read).
//                    The product refuses API funding; subscription callers may retain
//                    their unpriced path. This verdict supplies no captured frame.
//   missing          a loop step whose record is absent or unusable (no fold, no live
//                    session, no materialized output bound). The caller refuses the
//                    funded call rather than price another generation.
//   invalid          a loop step whose record contradicts the request (route drift,
//                    control drift, session identity mismatch). The caller refuses.
//
// SDK-free by construction: the loop-marker predicate and the session lookup are
// injected, so orchestration keeps its no-direct-SDK-import shape and a request cannot
// reach a conversation frame it did not earn from the SDK's own marker.

const positive = value => Number.isSafeInteger(value) && value > 0 ? value : null
const isId = value => typeof value === 'string' && value.length > 0 && value.length <= 512

/** What one resolution found. See the module comment for what the caller owes each. */
export const LOOP_FRAME_VERDICT = Object.freeze({
  FRAME: 'frame', AUX: 'aux', UNSUPPORTED_HOST: 'unsupportedHost', MISSING: 'missing', INVALID: 'invalid',
})

/** The reason attached to a non-frame verdict; stable, loggable, never a message. */
export const LOOP_FRAME_REASON = Object.freeze({
  HOST_LOOKUP_UNWIRED: 'host-lookup-unwired',
  HOST_LOOKUP_FAILED: 'host-lookup-failed',
  HOST_SESSION_SERVICE_UNUSABLE: 'host-session-service-unusable',
  HOST_SESSION_NOT_LIVE: 'host-session-not-live',
  HOST_SESSION_IDENTITY_MISMATCH: 'host-session-identity-mismatch',
  HOST_FOLD_UNREADABLE: 'host-fold-unreadable',
  LOOP_SESSION_ID_MISSING: 'loop-session-id-missing',
  LOOP_REQUEST_NOT_CANONICAL: 'loop-request-not-canonical',
  LOOP_HEADER_FOLD_ABSENT: 'loop-header-fold-absent',
  LOOP_CONTEXT_FOLD_ABSENT: 'loop-context-fold-absent',
  LOOP_ROUTE_DRIFT: 'loop-route-drift',
  LOOP_CONTROL_DRIFT: 'loop-control-drift',
  LOOP_CONTEXT_WINDOW_UNBOUND: 'loop-context-window-unbound',
  LOOP_OUTPUT_BOUND_UNMATERIALIZED: 'loop-output-bound-unmaterialized',
})

const verdict = (kind, reason) => Object.freeze(reason === undefined ? { kind } : { kind, reason })

// The call-config fields the SDK compares for one call (`callConfigEquals`, dsh-llm
// lib/index.js:367-371). The loop request is spread from the logged header's config, so
// any disagreement means the fold in hand belongs to a different step of the
// conversation — a stale fold, not this dispatch.
const CONTROL_FIELDS = Object.freeze(['provider', 'model', 'reasoningEffort', 'temperature', 'maxTokens'])
const controlDrift = (config, request) => {
  for (const field of CONTROL_FIELDS) if (config[field] !== request[field]) return LOOP_FRAME_REASON.LOOP_CONTROL_DRIFT
  if (config.stop === undefined || request.stop === undefined) {
    if (config.stop !== request.stop) return LOOP_FRAME_REASON.LOOP_CONTROL_DRIFT
  } else if (config.stop.length !== request.stop.length || config.stop.some((item, index) => item !== request.stop[index])) {
    return LOOP_FRAME_REASON.LOOP_CONTROL_DRIFT
  }
  return null
}

/**
 * Derive a Host-owned same-generation frame for one integrated-loop request.
 *
 * @param sessionFor - `(sessionId) => session | null | undefined`; in the composed
 *   product this is `id => ctx.get('sessions')?.get?.(id)` — the Host SessionStore the
 *   AgentLoop itself appends through (dsh-session lib/index.js:1980). Absent, throwing
 *   or not a SessionStore is `unsupportedHost`, never an error and never a frame.
 * @param isLoopRequest - the SDK's `isAgentLoopRequest` (re-exported through
 *   modules/bot-runtime), so a hand-built request carrying a conversation's `sessionId`
 *   cannot reach that conversation's frame: the marker is a process-private WeakSet the
 *   SDK alone can add to (dsh-llm lib/index.js:377-388), and it does not survive a copy.
 * @returns `(request) => verdict`, where a `frame` verdict carries the frozen
 *   `{provider, model, bounds: {contextWindow, defaultMaxTokens}, request}` shape
 *   model-accounting.mjs:89-96 consumes.
 */
export function createSessionLoopFrameResolver({ sessionFor = null, isLoopRequest = null, allowUnbounded = null } = {}) {
  const lookup = typeof sessionFor === 'function' ? sessionFor : null
  const marked = typeof isLoopRequest === 'function' ? isLoopRequest : null
  const aux = () => verdict(LOOP_FRAME_VERDICT.AUX)
  const unsupported = reason => verdict(LOOP_FRAME_VERDICT.UNSUPPORTED_HOST, reason)

  // Without the SDK's marker predicate nothing can be told apart, so the resolver is
  // inert. A request shaped like a loop envelope is reported as unsupported — the gap
  // is open — while everything else keeps the path it already had. The shape is a
  // heuristic for reporting only; it grants nothing.
  const loopShaped = request => request && typeof request === 'object' && isId(request.sessionId)
    && request.purpose === undefined && Object.isFrozen(request)
    && Array.isArray(request.messages) && Object.isFrozen(request.messages)
  if (!marked) return request => (loopShaped(request) ? unsupported(LOOP_FRAME_REASON.HOST_LOOKUP_UNWIRED) : aux())
  // The Host did not wire the session seam at all. A loop step is reported as
  // unsupported — the gap is open — while an ordinary or aux request keeps its path.
  if (!lookup) return request => (request && typeof request === 'object' && marked(request) && request.purpose === undefined
    ? unsupported(LOOP_FRAME_REASON.HOST_LOOKUP_UNWIRED)
    : aux())

  return request => {
    if (!request || typeof request !== 'object' || !marked(request)) return aux()
    // A marked request that names an aux purpose is not a conversation step: the
    // conversation's frame must never price a compaction, a title or a note
    // (experiment E3), and a caller-owned prepared aux binds its own dispatch anyway.
    if (request.purpose !== undefined) return aux()
    if (!isId(request.sessionId)) return verdict(LOOP_FRAME_VERDICT.INVALID, LOOP_FRAME_REASON.LOOP_SESSION_ID_MISSING)
    // The loop freezes its request envelope and the messages it derived
    // (dsh-agent-loop lib/index.js:1274-1288). A request that is not that envelope is
    // not the one the fold was logged for, whatever it claims.
    if (!Object.isFrozen(request) || !Array.isArray(request.messages) || !Object.isFrozen(request.messages)) {
      return verdict(LOOP_FRAME_VERDICT.INVALID, LOOP_FRAME_REASON.LOOP_REQUEST_NOT_CANONICAL)
    }
    let session = null
    try { session = lookup(request.sessionId) } catch { return unsupported(LOOP_FRAME_REASON.HOST_LOOKUP_FAILED) }
    if (session === null || session === undefined) return verdict(LOOP_FRAME_VERDICT.MISSING, LOOP_FRAME_REASON.HOST_SESSION_NOT_LIVE)
    if (typeof session.requestContext !== 'function' || typeof session.requestHeader !== 'function') {
      return unsupported(LOOP_FRAME_REASON.HOST_SESSION_SERVICE_UNUSABLE)
    }
    // The lookup must answer about the session the request names, not some other one.
    if (session.id !== request.sessionId) return verdict(LOOP_FRAME_VERDICT.INVALID, LOOP_FRAME_REASON.HOST_SESSION_IDENTITY_MISMATCH)
    let context = null, header = null
    try { context = session.requestContext(); header = session.requestHeader() } catch { return unsupported(LOOP_FRAME_REASON.HOST_FOLD_UNREADABLE) }
    if (!context || typeof context !== 'object') return verdict(LOOP_FRAME_VERDICT.MISSING, LOOP_FRAME_REASON.LOOP_CONTEXT_FOLD_ABSENT)
    if (!header || typeof header !== 'object' || !header.config || typeof header.config !== 'object') {
      return verdict(LOOP_FRAME_VERDICT.MISSING, LOOP_FRAME_REASON.LOOP_HEADER_FOLD_ABSENT)
    }
    // The fold must describe this exact route on both surfaces. A conversation that
    // moved to another route between the loop's log and this read has no frame for it,
    // and pricing the old route's window against the new endpoint is the very mixing
    // this module exists to prevent.
    if (context.provider !== request.provider || context.model !== request.model
      || header.config.provider !== request.provider || header.config.model !== request.model) {
      return verdict(LOOP_FRAME_VERDICT.INVALID, LOOP_FRAME_REASON.LOOP_ROUTE_DRIFT)
    }
    const contextWindow = positive(context.contextWindow)
    if (controlDrift(header.config, request) !== null) return verdict(LOOP_FRAME_VERDICT.INVALID, LOOP_FRAME_REASON.LOOP_CONTROL_DRIFT)
    // Only an explicitly Host-classified subscription route may preserve unknown
    // capacities. It still carries the same canonical prepared route and controls;
    // accounting never receives fabricated capacity or an API estimate from it.
    const unbounded = typeof allowUnbounded === 'function' && allowUnbounded(request) === true
    if (contextWindow === null && !unbounded) return verdict(LOOP_FRAME_VERDICT.MISSING, LOOP_FRAME_REASON.LOOP_CONTEXT_WINDOW_UNBOUND)
    // The dispatched output bound is already materialized into the frozen request by
    // the SDK's own call-config resolution (dsh-llm lib/index.js:2183-2186), so the
    // generation that streams is the one admitted. A loop step that carries no
    // materialized bound (the NO_ADAPTER fallback at dsh-agent-loop lib/index.js:1084
    // dispatches a bare `llm.stream`) has no same-generation frame: the caller refuses
    // it instead of falling back to a read that can name the other generation.
    const dispatched = positive(request.maxTokens)
    if (dispatched === null && !unbounded) return verdict(LOOP_FRAME_VERDICT.MISSING, LOOP_FRAME_REASON.LOOP_OUTPUT_BOUND_UNMATERIALIZED)
    // `adapterDefaults.maxTokens === true` marks that the SDK materialized the adapter's
    // default into the logged config (dsh-llm lib/index.js:2236-2239); that value is the
    // output default this generation dispatches. A bound the caller declared needs no
    // default: the request already carries it.
    const defaultMaxTokens = header.adapterDefaults?.maxTokens === true ? dispatched : null
    const frame = Object.freeze({
      provider: request.provider, model: request.model,
      bounds: Object.freeze({ contextWindow, defaultMaxTokens }), request,
    })
    return Object.freeze({ kind: LOOP_FRAME_VERDICT.FRAME, frame })
  }
}
