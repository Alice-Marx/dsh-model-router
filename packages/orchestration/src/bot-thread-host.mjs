import { createBotThreads } from './bot-threads.mjs'

// The seam between the thread catalog and the real Host. Everything the catalog
// needs to know about authority is asked here, of services the product already
// owns: the frozen runtime's thread records, the lifecycle's committed Bots, the
// principal directory and the capability authority. Nothing is reimplemented,
// and nothing the Host does not confirm is treated as confirmed.
//
// The adapter also reports which Host hooks exist. A Host that has not applied
// the thread records (an older overlay, or a build without them) says so here,
// so the composition can surface `blocked` with the missing hook instead of a
// surface that looks wired and is not.

/**
 * @param {{
 *   rt: object,                 // the product runtime (createBotProduct().rt)
 *   lifecycle: object,          // attachDsLifecycle()
 *   authority: object,          // capability-broker authority
 *   directory: object,          // principal directory (principals.mjs)
 *   file: string,               // where the catalog lives, beside the Host's own state
 *   runtimeMode?: (botId: string) => string | null,
 *   now?: () => number,
 * }} options
 */
export function createBotThreadHost({ rt, lifecycle, authority, directory, file, runtimeMode = null, now = Date.now } = {}) {
  if (!rt || typeof rt !== 'object') throw new TypeError('BOT_THREAD_HOST_RUNTIME_REQUIRED')
  if (!lifecycle || typeof lifecycle !== 'object') throw new TypeError('BOT_THREAD_HOST_LIFECYCLE_REQUIRED')
  if (!authority || typeof authority !== 'object') throw new TypeError('BOT_THREAD_HOST_AUTHORITY_REQUIRED')
  if (!directory || typeof directory !== 'object') throw new TypeError('BOT_THREAD_HOST_DIRECTORY_REQUIRED')
  if (typeof file !== 'string' || file === '') throw new TypeError('BOT_THREAD_HOST_FILE_REQUIRED')

  // Which trusted hooks this Host actually has. `ready` is the honest gate for
  // offering a send at all: without the runtime record and the ownership
  // lookup, a thread Session could be made but never authorized.
  const hooks = Object.freeze({
    createSession: typeof rt.createSession === 'function',
    addThreadSession: typeof rt.addThreadSession === 'function',
    setThreadArchived: typeof rt.setThreadArchived === 'function',
    renameThread: typeof rt.renameThread === 'function',
    threadOf: typeof rt.threadOf === 'function',
    threadsOf: typeof rt.threadsOf === 'function',
    committedBot: typeof lifecycle.committedBot === 'function',
    lifecycleStatus: typeof lifecycle.status === 'function',
    forSession: typeof directory.forSession === 'function',
    forBot: typeof directory.forBot === 'function',
    describe: typeof authority.describe === 'function',
    assertTool: typeof authority.assertTool === 'function',
  })
  const ready = hooks.createSession && hooks.addThreadSession && hooks.committedBot && hooks.forSession && hooks.describe

  const committedBot = botId => (hooks.committedBot ? lifecycle.committedBot(botId) ?? null : null)
  const lifecycleStatus = () => (hooks.lifecycleStatus ? lifecycle.status() ?? null : null)

  // The Host's own record of a Bot's threads: identity and archive, read back
  // from committed state. This is what a restart settles an interrupted create
  // against, so it is read from the lifecycle, never from this process.
  const committedThreads = botId => {
    const bot = committedBot(botId)
    if (!Array.isArray(bot?.threads)) return []
    return bot.threads
      .filter(thread => thread && typeof thread.threadId === 'string' && typeof thread.sessionId === 'string')
      .map(thread => ({ threadId: thread.threadId, sessionId: thread.sessionId, archivedAt: thread.archivedAt ?? null }))
  }

  // The principal directory is the Host's persistent confirmation of who a
  // Session belongs to. It is asked before any policy runs, every time.
  const ownsSession = (botId, sessionId) => {
    if (!hooks.forSession || !hooks.describe) return false
    try { return authority.describe(directory.forSession(sessionId)).botId === botId } catch { return false }
  }

  // A suspended or disabled Bot has an empty committed grant. The authority
  // says so through the one assertion a send always needs; a doubt is reported
  // as unanswerable rather than assumed.
  const botAuthorized = botId => {
    if (!hooks.forBot || !hooks.assertTool) return null
    try {
      const subject = directory.forBot(botId)
      authority.assertTool(subject, 'model/infer')
      return true
    } catch (error) {
      return error?.code === 'TOOL_DENIED' || error?.code === 'SUBJECT_REVOKED' ? false : null
    }
  }

  // Makes a thread's Session through the same factory every own chat uses, and
  // records it in the Bot's committed state in one save — the write that makes
  // the lifecycle compile the Session into this Bot's ownership. A refusal the
  // Host names before any Session exists is reported as such, so the catalog
  // does not keep a create intent for an operation that never started.
  const createSession = async ({ botId, threadId, title, dir }) => {
    if (!hooks.createSession) {
      throw Object.assign(new Error('宿主运行时未提供会话工厂。'), { code: 'SESSION_FACTORY_REQUIRED', outcome: 'refused' })
    }
    const readOnly = typeof rt.readOnly === 'function' ? rt.readOnly() : undefined
    if (readOnly !== undefined) throw Object.assign(new Error(readOnly), { code: 'PRODUCT_READ_ONLY', outcome: 'refused' })
    const sessionId = await rt.createSession(title, { dir })
    if (!hooks.addThreadSession) {
      throw Object.assign(new Error('宿主运行时未提供线程会话记录（rt.addThreadSession）。'), { code: 'SESSION_HOST_HOOK_MISSING', outcome: 'refused' })
    }
    await rt.addThreadSession(botId, threadId, sessionId, { name: title })
    return sessionId
  }

  // Archive is the Host's fact: dropping a thread's authority happens in the
  // committed state, and only then in the catalog.
  const setThreadArchived = async ({ botId, threadId, archivedAt }) => {
    if (!hooks.setThreadArchived) return null
    return rt.setThreadArchived(botId, threadId, archivedAt)
  }

  // A thread's title is the Host's too: the rename lands in the committed state
  // and answers with the record it wrote, which the catalog checks before it
  // believes the rename happened.
  const renameThread = async ({ botId, threadId, name }) => {
    if (!hooks.renameThread) return null
    return rt.renameThread(botId, threadId, name)
  }

  const service = createBotThreads({
    file,
    committedBot,
    lifecycleStatus,
    botAuthorized,
    ownsSession,
    committedThreads,
    createSession,
    setThreadArchived,
    renameThread,
    // No public Host session-inspect exists yet: reconcile then reports every
    // unowned Session as 'unbound' rather than 'missing'.
    inspectSession: null,
    runtimeMode: typeof runtimeMode === 'function' ? runtimeMode : null,
    now,
  })

  // The owner-console handlers. Each takes the RPC payload as a closed field
  // set (the catalog refuses anything else) and returns JSON-safe state; the
  // composition wraps every one of them in ownerOnly.
  const actions = Object.freeze({
    'threads.readModel': payload => service.readModel(payload ?? {}),
    'threads.list': payload => service.list(payload?.botId),
    'threads.create': payload => service.create(payload ?? {}),
    'threads.rename': payload => service.rename(payload ?? {}),
    'threads.switch': payload => service.switchThread(payload ?? {}),
    'threads.open': payload => service.openThread(payload ?? {}),
    'threads.archive': payload => service.archive(payload ?? {}),
    'threads.unarchive': payload => service.unarchive(payload ?? {}),
    'threads.ensure': payload => service.ensureSession(payload ?? {}),
    'threads.recover': payload => service.recover(payload ?? {}),
    'threads.reconcile': () => service.reconcile(),
  })

  /**
   * The gate a real send runs under, before any model or tool call. It answers
   * with the Session the turn must use, or refuses with the reason.
   *
   * `create` defaults to false: dispatching a model request is not a request to
   * make a Session. A caller that means "write in this thread" says so, and
   * only a thread that has never had a Session — no id, no durable create
   * intent, no outcome the Host failed to confirm — is given one, exactly once,
   * through the same single-flight ensure every other path uses. Every other
   * refusal is handed back untouched: an unknown, unbound, revoked, archived,
   * foreign or moved-away thread is never quietly given a fresh identity.
   */
  const sendGate = async ({ botId, threadId, create = false } = {}) => {
    const gate = service.probeSendable({ botId, threadId })
    if (gate.ok) return gate
    if (create !== true) return gate
    // The one path that may make a Session: never created, and never attempted.
    if (gate.code !== 'SESSION_MISSING' || gate.sessionState !== 'none') return gate
    await service.ensureSession({ botId, threadId })
    return service.probeSendable({ botId, threadId })
  }

  return Object.freeze({
    service,
    actions,
    hooks,
    ready,
    sendGate,
    ownsSession,
    committedThreads,
    botAuthorized,
    close: () => service.close(),
  })
}
