// One prepared model generation, admitted and dispatched as the same generation.
//
// The installed SDK's `LlmRuntime.prepareCall(config, signal, configure)` is the only
// public seam that binds one adapter registration's metadata to its own dispatch: it
// captures the registration and the adapter's `prepareCall` result at prepare time, and
// its returned one-shot `stream(options)` dispatches against exactly that capture, failing
// `INVALID_PREPARED_CALL` on a second dispatch or a call-config change. A Host that reads
// `resolveModelInfo` at admission and then lets the waterfall's `next()` re-resolve the
// model at dispatch can price one generation and dispatch another when a registration is
// replaced in between — the race `model-request-bounds` documents and cannot close, because
// its admission wraps the waterfall `next()`, not a prepared call.
//
// This module moves the independent path's admission onto that fence. A prepared call is
// made once, its exact metadata and defaults are captured into a Host-owned frame keyed by
// the request's own signal, and the accounting admits against that frame instead of reading
// the current registration again. The clamp happens in `configure`, before the config is
// frozen, so the dispatched config, the receipt hash and the estimate all describe the one
// generation that actually streams. Nothing here holds money, issues a receipt, or bypasses
// the policy, the secret rewrite or the `llm/stream` waterfall: it only decides the bound
// and hands the product's own listener the same generation it admitted.
//
// Each dispatch derives its own signal, linked to cancellation but used only to find
// captured capacity, never as Bot authentication. The product bridge redacts through
// the Host before preparation and refuses a later request-object replacement: an
// ordinary llm.stream re-entry would lose the SDK's prepared dispatch. The immutable
// frame therefore includes both the exact route and its original request identity.

import { withRequestOutputDefault } from './model-request-bounds.mjs'

const fail = (code, detail) => { throw Object.assign(new Error(code), { code, ...detail }) }
const positive = value => Number.isSafeInteger(value) && value > 0 ? value : null

/** The call-config fields the SDK compares for a prepared dispatch (`callConfigEquals`). */
const CALL_CONFIG_FIELDS = Object.freeze(['maxTokens', 'reasoningEffort', 'temperature', 'stop'])

/** Only the call-config fields — never `signal`, `messages`, `tools` or `system`. */
function callConfigOf(options) {
  const config = { provider: options.provider, model: options.model }
  for (const field of CALL_CONFIG_FIELDS) if (options[field] !== undefined) config[field] = options[field]
  return config
}

/** The resolved call-config fields to restate onto the dispatched request. */
function resolvedFields(config) {
  const fields = {}
  for (const field of CALL_CONFIG_FIELDS) if (config[field] !== undefined) fields[field] = config[field]
  return fields
}

/**
 * The output bound one prepared call will dispatch with, decided before the config freezes.
 *
 * A configured allowance is a price, not a capacity; the pinned adapter's `defaultMaxTokens`
 * is the per-request cap the SDK materializes into a request that declares none. The bound
 * the provider sees is the smaller of what the request or the adapter declares and the
 * allowance. Because `configure` works on a detached clone and returns new controls, the
 * clamp always lands — a request frozen above the allowance is lowered to the allowance
 * here, which is the correct recovery (lower the dispatched `maxTokens`), not a refusal and
 * never a lowered allowance.
 *
 * @param requested - the request's own `maxTokens`; `null` when it declares none.
 * @param allowance - the priced output allowance; `null` when the funding is not priced
 *   per token (a subscription), in which case nothing is clamped and the adapter default
 *   stands.
 * @param adapterDefault - the pinned adapter's declared per-request cap; `null` when none.
 * @returns `{ok:true,maxTokens,clamp}`, or `{ok:false,code}` when the request's own bound is
 *   present but invalid.
 */
export function planConfiguredOutput({ requested = null, allowance = null, adapterDefault = null } = {}) {
  if (requested !== null && !(Number.isSafeInteger(requested) && requested >= 1)) return { ok: false, code: 'MODEL_OUTPUT_BOUNDARY_REQUIRED' }
  if (allowance === null) return { ok: true, maxTokens: requested ?? null, clamp: false }
  const known = requested ?? adapterDefault ?? null
  const maxTokens = known === null ? allowance : Math.min(known, allowance)
  return { ok: true, maxTokens, clamp: known === null || known > allowance }
}

/**
 * The Host-owned frame store. Keyed by the request signal so a rebuilt request (the secret
 * rewrite) keeps its frame, and unforgeable because a request cannot insert into a WeakMap
 * the Host owns. Nothing is cached across calls: the frame lives exactly as long as the one
 * dispatch that set it.
 */
export function createModelFrameStore() {
  const frames = new WeakMap()
  return Object.freeze({
    set: (signal, frame) => { if (signal) frames.set(signal, frame) },
    read: signal => (signal ? frames.get(signal) ?? null : null),
    delete: signal => { if (signal) frames.delete(signal) },
  })
}

/** Apply the Host's public string redactor before binding an adapter generation. */
export function redactPreparedModelRequest(options, redact) {
  if (typeof redact !== 'function') return options
  const walk = value => {
    if (typeof value === 'string') return redact(value)
    if (Array.isArray(value)) {
      const next = value.map(walk)
      return next.some((item, index) => item !== value[index]) ? next : value
    }
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
      const next = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]))
      return Object.keys(next).some(key => next[key] !== value[key]) ? next : value
    }
    return value
  }
  const messages = walk(options.messages), system = walk(options.system)
  return messages === options.messages && system === options.system ? options : { ...options, messages, ...(system === undefined ? {} : { system }) }
}

/**
 * The prepared-dispatch seam for the independent path.
 *
 * @param llm - the live `llm` service, or a function returning it.
 * @param frames - the shared {@link createModelFrameStore} the accounting reads.
 * @param fundingFor - `({botId, provider, model}) => funding | null`, the Host's committed
 *   funding read. Only its priced output allowance is used, and only as a capacity to clamp
 *   against — never as a token count or a cost. A throw or a null is treated as unpriced, so
 *   the accounting stays the single authority over money and refuses in its own coded way.
 * @returns `{dispatch}`, where `dispatch(options, {botId})` is an async iterable that prepares
 *   the call once, records the frame, and streams the captured generation.
 */
export function createPreparedModelDispatch({ llm = null, frames = null, fundingFor = null } = {}) {
  if (!frames || typeof frames.set !== 'function') fail('MODEL_FRAME_STORE_REQUIRED')
  const service = () => (typeof llm === 'function' ? llm() : llm)

  async function* dispatch(options, context = {}) {
    if (options.maxTokens !== undefined && positive(options.maxTokens) === null) fail('MODEL_OUTPUT_BOUNDARY_REQUIRED')
    const runtime = service()
    if (!runtime || typeof runtime.prepareCall !== 'function') fail('MODEL_PREPARED_UNAVAILABLE')
    const { botId } = context
    let funding = null
    if (botId && typeof fundingFor === 'function') {
      try { funding = await fundingFor({ botId, provider: options.provider, model: options.model }) } catch { funding = null }
    }
    const allowance = funding && funding.funding === 'api' ? positive(funding.maxOutputTokens) : null

    // `configure` is pure and synchronous: it decides the bound from the captured metadata
    // and the already-resolved allowance, and records the capacities the accounting admits on.
    let contextWindow = null, defaultMaxTokens = null
    const configure = (controls, info) => {
      contextWindow = positive(info.context?.contextWindow)
      defaultMaxTokens = positive(info.defaultMaxTokens)
      controls = withRequestOutputDefault(controls, { contextWindow, defaultMaxTokens })
      const plan = planConfiguredOutput({ requested: controls.maxTokens ?? null, allowance, adapterDefault: defaultMaxTokens })
      if (!plan.ok) fail(plan.code)
      // Keep valid adapter defaults or the materialized conservative request limit
      // for subscriptions; priced requests additionally obey their output allowance.
      if (allowance === null || !plan.clamp) return controls
      // Above the allowance, or nothing declared at all: lower the dispatched bound to the
      // allowance. This is the only safe dispatch, and it lands because `configure` returns
      // new controls on a detached clone regardless of how the caller froze its request.
      return { ...controls, maxTokens: plan.maxTokens }
    }

    const signal = options.signal ? AbortSignal.any([options.signal]) : new AbortController().signal
    const prepared = await runtime.prepareCall(callConfigOf(options), signal, configure)
    // Restate the resolved call-config so the dispatched request equals the prepared one:
    // `prepared.stream` refuses `INVALID_PREPARED_CALL` on any call-config mismatch.
    const dispatchOptions = { ...options, ...resolvedFields(prepared.config), signal }
    const frame = Object.freeze({ provider: options.provider, model: options.model, fundingRevision: funding?.fundingRevision ?? null,
      bounds: Object.freeze({ contextWindow, defaultMaxTokens }), request: dispatchOptions })
    frames.set(signal, frame)
    try {
      // A Host gate between binding the generation and dispatching it. The frame is already
      // recorded, so the accounting that runs inside the stream admits against this capture;
      // anything that swaps the current registration here cannot reach the one-shot stream,
      // which dispatches the generation it was prepared with. The gate may throw to refuse
      // before any dispatch, and it runs with no receipt, reservation or provider call yet.
      if (typeof context.beforeDispatch === 'function') await context.beforeDispatch({ prepared, frame, options: dispatchOptions })
      yield* prepared.stream(dispatchOptions)
    } finally {
      frames.delete(signal)
    }
  }

  return Object.freeze({ dispatch })
}
