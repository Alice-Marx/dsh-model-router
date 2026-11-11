/**
 * Which model calls belong to a Bot thread, decided before anything else runs.
 *
 * The runtime's live owner index is a fast answer that goes stale the moment a thread is
 * archived, a Bot is suspended or deleted, or a Bot is moved to the other runtime: an archived
 * thread's Session leaves `chatOwners`, so the ordinary Harness bypass would answer for it as if
 * it were the user's own chat — unguarded, unpoliced and unaccounted. The thread catalog is the
 * record that survives all of that, and its gate is the one the send path already uses.
 *
 * So this guard asks the catalog first, for the exact Bot/thread/session triple, and only then
 * the frozen runtime. Three outcomes, and only three:
 *
 * - `thread`: a committed Bot thread. The gate has just re-confirmed the Bot is committed and
 *   healthy, its grant still stands, the thread is open, and the Host still owns the Session.
 * - `unbound`: nothing claims this Session. An ordinary Harness session — the user's own chat,
 *   another plugin — stays exactly as unguarded as it was.
 * - a refusal: the Session is claimed but the claim does not stand. Nothing is replayed, and no
 *   identity is invented: a doubt about a thread never becomes Main, the owner, or a default
 *   Session.
 *
 * A Session the frozen runtime reports as a live thread while the catalog has no record for it
 * is a refusal too. The catalog is the record; the runtime's index is the hint.
 */

const fail = (code, message) => {
  const error = new Error(message ?? code)
  error.code = code
  error.outcome = 'refused'
  throw error
}

const safe = work => { try { return work() } catch { return null } }

/**
 * @param {{
 *   threads?: object | (() => object | null) | null,
 *   nativeThreadOf?: ((sessionId: string) => { botId: string, threadId: string } | null | undefined) | null,
 * }} options
 */
export function createBotThreadAdmission({ threads = null, nativeThreadOf = null } = {}) {
  // The thread host is built after the product runtime, so the resolver is allowed to be lazy:
  // the guard asks for it on every call rather than capturing a half-composed Host.
  const host = () => {
    const value = typeof threads === 'function' ? safe(() => threads()) : threads
    // Either the thread host itself or its catalog: both are the same committed record.
    const catalog = value?.service && typeof value.service === 'object' ? value.service : value
    return catalog && typeof catalog.threadBySession === 'function' && typeof catalog.assertSendable === 'function' ? catalog : null
  }
  const nativeThread = sessionId => (typeof nativeThreadOf === 'function' ? safe(() => nativeThreadOf(sessionId)) : null) ?? null

  /**
   * @param {string | undefined | null} sessionId
   * @returns {{ kind: 'absent' | 'unbound' } | { kind: 'thread', botId: string, threadId: string, sessionId: string }}
   */
  const admit = sessionId => {
    if (typeof sessionId !== 'string' || sessionId === '') return { kind: 'absent' }
    const service = host()
    const live = nativeThread(sessionId)
    if (!service) {
      // No catalog to ask. A Session the runtime still calls a live Bot thread is refused rather
      // than handed to the ordinary bypass, which would answer for a Bot with no Bot policy.
      if (live) fail('BOT_THREAD_ADMISSION_UNAVAILABLE', '线程会话服务未就绪，宿主无法确认该会话归属，本次请求被拒绝。')
      return { kind: 'unbound' }
    }
    // A catalog that cannot be read is a doubt, not an answer: it may hold the very tombstoned
    // identity this call belongs to, so the failure propagates instead of reading as "unbound".
    const found = service.threadBySession(sessionId) ?? null
    if (found && typeof found.botId === 'string' && typeof found.threadId === 'string') {
      // The exact triple, re-confirmed now: archive, revocation, a deleted Bot, a moved runtime
      // and a Session the Host no longer owns all refuse here.
      const gate = service.assertSendable({ botId: found.botId, threadId: found.threadId })
      // And the Session the gate answered for is the one that was asked about: a record that
      // resolved to some other Session is a refusal, never a silent substitution.
      if (gate?.sessionId !== sessionId) {
        fail('THREAD_SESSION_CONFLICT', '该线程会话与请求的会话不一致，本次请求被拒绝。')
      }
      return { kind: 'thread', botId: found.botId, threadId: found.threadId, sessionId, grantVerified: gate?.grantVerified === true }
    }
    if (live) fail('BOT_THREAD_UNVERIFIED', '该会话是一条 Bot 线程会话，但线程目录没有它的记录，本次请求被拒绝。')
    return { kind: 'unbound' }
  }

  return Object.freeze({ admit })
}
