// The same-generation seam for the Bot's auxiliary model calls.
//
// DS Bot makes three model requests that are not a conversation step: the handoff note
// (`writeNote`), the in-place checkpoint (`writeCheckpoint`) and the context steward's
// decision (`askSteward`). All three are bare `ctx.llm.stream({purpose:'compaction'})`
// calls, so the SDK resolves the route's current registration at dispatch — the same
// mispricing window `model-prepared-generation.mjs` closes for the independent path and
// `model-loop-frame.mjs` reads around for the integrated conversation. An auxiliary call
// cannot borrow either: the session log's `request/header` fold is the conversation's own
// metadata (experiment E3 in
// tmp/integration/integrated-generation-study-1/experiment.mjs: an aux call read
// generation A and dispatched generation B), and an aux request carries no loop marker.
//
// This module puts the auxiliary calls on the one public seam that binds metadata to its
// own dispatch: `LlmRuntime.prepareCall(config, signal, configure)` (dsh-llm
// lib/index.js:2220-2261). It composes the product's own prepared dispatcher, so the
// auxiliary request is prepared once, its exact capacities are recorded in the Host-owned
// frame store the accounting already reads, and its one-shot stream dispatches that same
// capture through the ordinary `llm/stream` waterfall exactly once — no listener
// re-prepares, no second waterfall, no second receipt.
//
// Three rules hold the trust boundary:
//
//   1. Identity is Host state, resolved before anything is prepared. `identityFor` is the
//      parent's own `policy.modelIdentity`, which reads the principal directory for the
//      request's Session. A request that names a Bot, a subject, a grant or a funding
//      allowance of its own is refused: those are never caller inputs.
//   2. The Host's own redactor runs before preparation. The frozen ds-bot secret listener
//      (vendor src/host/secrets.js:505-514) rebuilds a request and re-enters
//      `ctx.llm.stream` when it still finds a value; a prepared generation cannot survive
//      that rebuild, and the product listener refuses it
//      (`MODEL_PREPARED_REQUEST_REWRITTEN`) rather than price one generation and stream
//      another. Redacting first is what makes the rewrite unnecessary, exactly as the
//      independent path does.
//   3. Nothing here holds money. The allowance read through `fundingFor` is only a capacity
//      to clamp the dispatched output bound against, before the SDK freezes the config; the
//      one accounting remains the sole authority over reservations, receipts and cost, and
//      a missing or throwing read is treated as unpriced so it refuses in its own coded way.
//
// The steward's `reasoningEffort:'off'` is decided from the generation being prepared. The
// prepared handle deliberately does not expose the model's reasoning metadata (dsh-llm
// lib/index.js:2241-2248), and `resolveModelInfo` reads the current registration — another
// generation — so the only public place that knows is the `configure` callback the SDK
// itself calls with the captured `modelInfo`. `createPreparedModelDispatch` owns that
// callback and does not expose it, so this module supplies the runtime it prepares through:
// a Host-owned service whose `prepareCall` wraps the real one and adds the caller's control
// selection to the SDK's own callback. No SDK file, vendor file or global is touched, the
// wrapper is built per call (no shared state, no concurrency hazard), and an effort the
// prepared generation does not support is never sent.

import { createPreparedModelDispatch, redactPreparedModelRequest } from './model-prepared-generation.mjs'

const fail = (code, detail) => { throw Object.assign(new Error(code), { code, ...detail }) }

/**
 * Request keys an auxiliary caller may never supply.
 *
 * Identity, authority and money are committed Host state. A request that carries any of
 * them is refused rather than silently ignored: a caller that believes it named the Bot
 * must not go on believing the call ran for that Bot.
 */
const UNTRUSTED_KEYS = Object.freeze([
  'botId', 'subject', 'principal', 'grant', 'authority', 'identity', 'token', 'lease', 'binding',
  'funding', 'allowance', 'maxOutputTokens', 'maxInputTokens', 'pricing', 'scopeId', 'projectId',
])

/**
 * The steward's control selection: `reasoningEffort:'off'` when — and only when — the
 * generation being prepared declares that effort.
 *
 * @param info - the prepared generation's normalized model info, exactly as the SDK passes
 *   it to `configure` (dsh-llm lib/index.js:2228).
 * @returns `{reasoningEffort:'off'}`, or `undefined` when the generation supports no `off`
 *   effort or declares no reasoning at all, in which case the adapter's own default stands
 *   — the behaviour the bare stream had.
 */
export function auxiliaryReasoningOff(info) {
  const efforts = info?.reasoning?.efforts
  if (!Array.isArray(efforts)) return undefined
  return efforts.some(effort => effort && effort.id === 'off') ? { reasoningEffort: 'off' } : undefined
}

/**
 * Wrap one runtime so its `prepareCall` adds the caller's control selection to the SDK's
 * own `configure` callback.
 *
 * The wrapper is a Host-owned object whose prototype is the live service, so every other
 * member of `LlmRuntime` is the real one and the real service stays `this` inside
 * `prepareCall`. The decorated object is built per call and never escapes this module.
 */
function withConfiguredControls(runtime, controlsFor) {
  if (typeof controlsFor !== 'function') return runtime
  const decorated = Object.create(runtime)
  Object.defineProperty(decorated, 'prepareCall', {
    value: (config, signal, configure) => runtime.prepareCall(config, signal, (controls, info) => {
      let selected
      try { selected = controlsFor(info) } catch (error) {
        fail('MODEL_AUXILIARY_CONTROLS_REJECTED', { reason: String(error?.code ?? error?.message ?? error) })
      }
      // Only the call-config fields matter to the SDK; anything else a control selection
      // returns is dropped rather than forwarded into the dispatched request.
      let next = controls
      if (selected && typeof selected === 'object') {
        next = { ...controls }
        for (const [key, value] of Object.entries(selected)) if (value !== undefined) next[key] = value
      }
      // The dispatcher's own configure still decides the output bound and records the
      // capacities the accounting admits on; this wrapper only adds the caller's selection.
      return configure(next, info)
    }),
    writable: true, configurable: true, enumerable: false,
  })
  return decorated
}

/**
 * The prepared auxiliary stream for the Bot's note, checkpoint and steward calls.
 *
 * @param llm - the live `llm` service, or a function returning it. A Host whose runtime
 *   exposes no `prepareCall` is refused per call (`MODEL_PREPARED_UNAVAILABLE`), never
 *   downgraded to the unprepared stream that re-resolves the model at dispatch.
 * @param frames - the shared {@link createModelFrameStore} the one accounting reads. The
 *   same store the independent path and the composition use, so an auxiliary frame is
 *   admitted by the same authority and for exactly as long as its one dispatch.
 * @param fundingFor - `({botId, provider, model}) => funding | null`, the Host's committed
 *   funding read. Only its priced output allowance is used, and only as a capacity to clamp
 *   against; a throw or a null is unpriced, and the accounting still refuses in its own way.
 * @param identityFor - `(request) => {botId, subject, ...} | null`, the parent's trusted
 *   Host identity read (`policy.modelIdentity`). It is the only source of the Bot and the
 *   subject; a request that names its own is refused.
 * @param redact - the Host's public string redactor, applied to `messages` and `system`
 *   before preparation so the frozen secret listener has nothing to rebuild.
 * @param carryUsageTag - optional `(from, to) => void`, the runtime's own usage-tag carry,
 *   so a redaction rebuild keeps the DS Bot usage provenance the tag records.
 * @returns a callable `stream(request, {controls})` — also reachable as `.stream` — that is
 *   an async iterable of chunks, plus `reasoningOff` for the steward's decision.
 */
export function createAuxiliaryModelStream({
  llm = null, frames = null, fundingFor = null, identityFor = null, redact = null, carryUsageTag = null,
} = {}) {
  if (!frames || typeof frames.set !== 'function' || typeof frames.read !== 'function') fail('MODEL_FRAME_STORE_REQUIRED')
  if (typeof identityFor !== 'function') fail('MODEL_AUXILIARY_IDENTITY_REQUIRED')
  if (typeof redact !== 'function') fail('MODEL_AUXILIARY_REDACTION_REQUIRED')
  const service = () => (typeof llm === 'function' ? llm() : llm)

  async function* stream(request, context = {}) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) fail('MODEL_AUXILIARY_REQUEST_REQUIRED')
    for (const key of UNTRUSTED_KEYS) if (request[key] !== undefined) {
      fail('MODEL_AUXILIARY_IDENTITY_UNTRUSTED', { reason: key })
    }
    if (typeof request.provider !== 'string' || request.provider === '' || typeof request.model !== 'string' || request.model === '') {
      fail('MODEL_AUXILIARY_ROUTE_REQUIRED')
    }
    if (!Array.isArray(request.messages)) fail('MODEL_AUXILIARY_MESSAGES_REQUIRED')

    // 1. Trusted identity, before anything is prepared: whose call this is, decided by the
    //    Host's own directory for this request's Session — never by the request.
    let identity = null
    try { identity = await identityFor(request) } catch (error) {
      fail('MODEL_AUXILIARY_IDENTITY_REQUIRED', { reason: String(error?.code ?? error?.message ?? error) })
    }
    const botId = identity?.botId
    if (typeof botId !== 'string' || botId === '') fail('MODEL_AUXILIARY_IDENTITY_REQUIRED')

    // 2. Host redaction, before the generation is bound. The redactor is the Host's own; a
    //    value it finds is replaced here, so the frozen secret listener passes this request
    //    straight through instead of rebuilding it and losing the prepared generation.
    const redacted = redactPreparedModelRequest(request, redact)
    if (typeof carryUsageTag === 'function') carryUsageTag(request.messages, redacted.messages)

    // 3. One preparation, one dispatch, one frame. The dispatcher is built per call so the
    //    control selection above belongs to this request alone, and the shared frame store
    //    is what the accounting reads.
    const runtime = service()
    if (!runtime || typeof runtime.prepareCall !== 'function') fail('MODEL_PREPARED_UNAVAILABLE')
    const dispatch = createPreparedModelDispatch({
      llm: () => withConfiguredControls(runtime, typeof context.controls === 'function' ? context.controls : null),
      frames,
      ...(typeof fundingFor === 'function' ? { fundingFor } : {}),
    })
    yield* dispatch.dispatch(redacted, { botId })
  }

  stream.stream = stream
  stream.reasoningOff = auxiliaryReasoningOff
  return Object.freeze(stream)
}
