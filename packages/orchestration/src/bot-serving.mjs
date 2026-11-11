/**
 * The one Host-side admission a Bot turn runs under.
 *
 * A Bot is served by exactly one runtime, and a Bot that is answering is not a Bot that may be
 * moved. Both paths therefore share this module: the integrated Harness stream and the
 * independent loop take a lease from here, and a move is only committed while this module says
 * the Bot is idle.
 *
 * This is an admission, not a second authority. It grants no model, no tool and no money: the
 * committed Bot policy still decides what a call may do, and the one accounting stream still
 * records what it cost. What it does own is the single-writer question — "is this Bot already
 * being served, and by which runtime" — and it answers it from committed state, never from
 * anything a request carries.
 *
 * Two rules are load-bearing:
 *
 * 1. The committed mode is read back through a trusted reader. A switch that cannot be read, or
 *    that answers with something that is not a mode, is never treated as `integration`: an
 *    unreadable decision refuses the call instead of assuming the default path.
 * 2. `assertIdle` is synchronous and is called immediately before the switch writes. The check
 *    before it may await; nothing between the last check and the commit may, or a turn that
 *    started in the meantime would be served by two runtimes.
 */

const RUNTIME_MODES = Object.freeze(['integration', 'independent'])
const idOk = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value)
const fail = (code, message) => { const error = new Error(message ?? code); error.code = code; throw error }

/**
 * @param {{
 *   modeOf?: ((botId: string) => string | null) | null,
 *   rt?: object | null,
 *   now?: () => number,
 * }} options
 */
export function createBotServing({ modeOf = null, rt = null, now = Date.now } = {}) {
  if (modeOf !== null && typeof modeOf !== 'function') throw new TypeError('BOT_SERVING_MODE_READER_INVALID')
  // One lease per Bot, counted so a nested call inside a live turn cannot deadlock on itself.
  const leases = new Map()
  // The admission is published before the Bot runtime exists — the product publishes it, then
  // composes the runtime — so the runtime is bound to it afterwards. Generation ownership means a
  // stale release (a disposed runtime) can never clear a newer binding, and a newer binding can
  // never leave the old one's probe running.
  let runtime = rt ?? null
  let generation = 0

  /**
   * The committed mode, or null when it cannot be established. `null` is a refusal, never a
   * default: a Host that installed no switch serves every Bot on the integration path, and that
   * is the only case where this answers without asking.
   */
  const readMode = botId => {
    if (typeof modeOf !== 'function') return 'integration'
    let value
    try { value = modeOf(botId) } catch { return null }
    return RUNTIME_MODES.includes(value) ? value : null
  }

  /** Serve on `expected`, or refuse: another runtime owns this Bot, or nobody can say. */
  const assertMode = (botId, expected) => {
    if (!idOk(botId)) fail('INVALID_BOT_ID')
    const committed = readMode(botId)
    if (committed === null) {
      fail('SERVING_MODE_UNKNOWN', `无法确认 ${botId} 的已提交运行时，本次请求被拒绝。`)
    }
    if (committed !== expected) {
      fail('RUNTIME_MODE_MISMATCH', `运行时已切换：${botId} 当前由 ${committed} 提供服务，本次 ${expected} 请求被拒绝。`)
    }
    return committed
  }

  /**
   * Bots the frozen runtime is working on right now, before any model chunk: a turn that has
   * started, and one whose next step is queued. Counting only the stream would leave the whole
   * front of a turn — the prompt, the tools, the queue — invisible to a move.
   */
  const nativeBusyBots = () => {
    const busy = new Set()
    const live = runtime?.live
    if (!live || typeof live.entries !== 'function') return busy
    for (const [sessionId, entry] of live.entries()) {
      if (entry?.turn === undefined && entry?.pending === undefined) continue
      const botId = runtime.selfOf?.(sessionId) ?? runtime.groupOwners?.get?.(sessionId)?.botId ?? null
      if (typeof botId === 'string') busy.add(botId)
    }
    return busy
  }

  /**
   * Take the serving lease for one whole turn or stream. The returned handle releases exactly
   * once, so a completed, cancelled, failed or bypassed turn leaves nothing behind and a Bot can
   * never be stuck permanently busy.
   */
  const enter = botId => {
    if (!idOk(botId)) fail('INVALID_BOT_ID')
    const lease = leases.get(botId) ?? { count: 0, since: now() }
    lease.count += 1
    leases.set(botId, lease)
    let released = false
    return Object.freeze({
      botId,
      release() {
        if (released) return
        released = true
        const current = leases.get(botId)
        if (!current) return
        current.count -= 1
        if (current.count <= 0) leases.delete(botId)
      },
    })
  }

  /**
   * Take the only lease for one whole turn: a Bot that is already being served is refused. This
   * is the admission the independent path uses, because two of its turns would write two
   * transcripts over one Bot.
   */
  const acquire = botId => {
    if (!idOk(botId)) fail('INVALID_BOT_ID')
    if (busy(botId)) fail('BOT_BUSY', '这个 Bot 正在一轮对话中，等它空闲后再切换运行时。')
    return enter(botId)
  }

  const busy = botId => (leases.get(botId)?.count ?? 0) > 0 || nativeBusyBots().has(botId)

  /** Every Bot being served right now, by either path. */
  const busyBots = () => [...new Set([...leases.keys(), ...nativeBusyBots()])].sort()

  /**
   * The move-time admission: true when the Bot is idle, a refusal when it is not. Synchronous by
   * contract, because it stands directly in front of the switch's write.
   */
  const assertIdle = botId => {
    if (!idOk(botId)) fail('INVALID_BOT_ID')
    if (busy(botId)) fail('BOT_BUSY', '这个 Bot 正在一轮对话中，等它空闲后再切换运行时。')
    return true
  }

  /**
   * Bind the runtime whose live turn record this admission reads. The returned release clears the
   * binding only while it is still the current one, so disposing a runtime cannot blind a newer
   * one — and a runtime that is never disposed keeps its probe until it is replaced.
   */
  const bindRuntime = next => {
    if (!next || typeof next !== 'object') throw new TypeError('BOT_SERVING_RUNTIME_REQUIRED')
    generation += 1
    const mine = generation
    runtime = next
    return () => { if (mine === generation) { generation += 1; runtime = null } }
  }

  return Object.freeze({
    readMode,
    assertMode,
    enter,
    acquire,
    busy,
    busyBots,
    assertIdle,
    bindRuntime,
    /** Held leases, for a bounded diagnostic: ids and counts, never content. */
    leases: () => [...leases.entries()].map(([botId, lease]) => ({ botId, count: lease.count, since: lease.since })).sort((left, right) => left.botId.localeCompare(right.botId)),
  })
}
