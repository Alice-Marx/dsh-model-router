/**
 * Did this exact send reach the Host? The only honest answers are the ones the
 * session contract already publishes.
 *
 * The contract (verified against the installed SDK, not guessed):
 *   - `ISession.beginSubmission()` registers one local echo in
 *     `snapshot.pendingSubmissions` synchronously, before the prompt is
 *     serialized, and mints the `requestId` the prompt must carry.
 *     `@deepseek-ai/dsh-api-session-controller/lib/types/client/contract/session.d.ts:63-84`
 *   - `ISession.prompt(content, mode, signal, requestId)` answers
 *     `{accepted:true}` or the business error, and mirrors a failure into
 *     `snapshot.promptError` with `op:'send'`.  (same file, 74-84)
 *   - A pending echo retires with `reason:'observed'` once its durable
 *     `user/message` event or its host queue occurrence arrived, and with
 *     `reason:'failed'` when the prompt was rejected, threw, or was aborted
 *     before acceptance.  (same file, 18-28)
 *   - `PendingSubmission.requestId` is "the prompt RPC identity; the durable
 *     `user/message` source echoes it as `rpcId`".
 *     `.../client/contract/snapshot.d.ts:38-49`
 *
 * So the identity of one send is the requestId, and acceptance is that requestId
 * showing up as a durable user message. Nothing else counts: a composer phase,
 * an empty input, an elapsed timeout, a historical message with the same text, or
 * a Bot reply. This module only reads those published fields.
 *
 * Everything here is pure and offline; the React side passes the snapshots in.
 */

/** How long after the composer emptied an echo may still be matched to it. */
export const SUBMISSION_MATCH_WINDOW_MS = 5000

const textOf = value => (typeof value === 'string' ? value : '')

/**
 * The echo this send produced, if one is there. The text and the moment only
 * *find* the echo; the identity that comes back is the requestId, which is what
 * later evidence has to match. A historical message with the same text is not an
 * echo: it is not in `pendingSubmissions` at all.
 *
 * @param {readonly {requestId?: unknown, text?: unknown, time?: unknown}[]} submissions
 * @param {{ text: string, at: number, windowMs?: number }} send
 */
export function matchSubmission(submissions, { text, at, windowMs = SUBMISSION_MATCH_WINDOW_MS, before = [] }) {
  const wanted = textOf(text)
  const moment = Number(at)
  if (!wanted || !Number.isFinite(moment) || !Array.isArray(submissions)) return null
  const known = new Set(before)
  const matches = new Map()
  for (const echo of submissions) {
    if (typeof echo?.requestId !== 'string' || !echo.requestId || known.has(echo.requestId)) continue
    if (textOf(echo?.text) !== wanted) continue
    const started = Number(echo?.time ?? 0)
    if (!Number.isFinite(started)) continue
    // The echo belongs to this send when it began with it, not minutes later.
    if (started < moment - windowMs || started > moment + windowMs) continue
    matches.set(echo.requestId, { time: started, requestId: echo.requestId })
  }
  if (matches.size !== 1) return null
  const found = [...matches.values()][0]
  return { requestId: found.requestId, text: wanted, time: found.time }
}

/**
 * The requestIds the durable conversation already carries. A user message node
 * echoes its prompt identity as `source.rpcId`; a Bot's own reply carries none,
 * so a reply can never be mistaken for this send.
 */
export function observedRequestIds(events) {
  const seen = new Set()
  if (!Array.isArray(events)) return seen
  for (const event of events) {
    if (event?.type !== 'user/message' || event?.data?.source?.kind !== 'user') continue
    const rpcId = event.data.source.rpcId
    if (typeof rpcId === 'string' && rpcId) seen.add(rpcId)
  }
  return seen
}

/** A send failure the session published: `promptError.op === 'send'`. */
export const sendFailed = promptError => promptError?.op === 'send'

/**
 * The outcome of one identified send, or `undefined` when the Host has not said.
 * `undefined` is the common case and it means "keep the draft": an outcome that
 * was never observed is not a success.
 *
 * @param {object} state
 * @param {{requestId:string}} state.pending the identity captured when the send began
 * @param {readonly object[]} [state.events] durable conversation events
 * @param {readonly string[]} [state.acceptedRequestIds] exact durable admissions
 * @param {readonly string[]} [state.failedRequestIds] identified failure receipts
 */
export function readSendOutcome({ pending, events, acceptedRequestIds = [], failedRequestIds = [] } = {}) {
  if (!pending || typeof pending.requestId !== 'string' || !pending.requestId) return undefined
  if (observedRequestIds(events).has(pending.requestId) || acceptedRequestIds.includes(pending.requestId)) return 'accepted'
  // promptError has no request id. A stale send error cannot settle this send.
  if (failedRequestIds.includes(pending.requestId)) return 'failed'
  return undefined
}

/** User-sourced rows the input face reports as queued right now. */
export function queuedUserRows(queue) {
  if (!Array.isArray(queue)) return []
  return queue.filter(row => row?.source?.kind === 'user')
}

/**
 * The queue rows this read has that the previous one did not. Used only to decide
 * "a send is in flight, so do not clear yet" — it never clears anything on its
 * own, and a queue row is never read as acceptance of a specific send.
 */
export function newQueueRows(current, before) {
  const known = new Set((Array.isArray(before) ? before : []).filter(id => typeof id === 'string'))
  return (Array.isArray(current) ? current : []).filter(id => typeof id === 'string' && !known.has(id))
}
