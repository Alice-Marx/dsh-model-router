/**
 * The Host's own tool service for one independent Bot.
 *
 * The independent loop has a transcript and a cancel signal; it has no machine, no task journal and
 * no authority. This module is the seam the Host composes once and publishes, and it is the only
 * way an independent turn reaches the outside world:
 *
 * ```
 * ctx.provide('botIndependentToolHost', createIndependentToolHost({
 *   directory, machines: () => machines, taskService: () => taskService,
 *   backends: () => taskBackends ? taskBackends.catalog().map(entry => entry.id) : [], now,
 * }))
 * ```
 *
 * `forBot(botId)` answers with a live view of that Bot: `schemas()` is re-decided from committed
 * grants on every call, `isReadonly()` says whether a call may run beside another, and `call()`
 * re-decides everything again before a single byte leaves the process.
 *
 * Four rules are load-bearing:
 *
 * 1. **Identity is Host-owned.** The machine, the root, the task id, the attempt id, the operation
 *    id and the request key are derived from the Bot's committed binding and the turn identity the
 *    loop hands over. A reply may name one of its own bound machines or roots, and may reference an
 *    operation or task the Host already issued; it can never mint one.
 * 2. **A write is a durable Task or it does not happen.** `bot_fs_write` and `bot_command` go
 *    through the existing task service — submit, attempt, operation, journal — with a request key
 *    derived from the turn and the call, so a repeated call re-reads the same task instead of
 *    dispatching a second one.
 * 3. **An unknown outcome is reconciled, never replayed.** When the backend cannot prove what
 *    happened the call throws with the task identity attached; nothing here submits a replacement.
 * 4. **The cancel signal reaches the machine and the task wait.** A cancel that arrives before
 *    dispatch produces zero machine calls; one that arrives during leaves the remote operation its
 *    own identity and its own stop evidence.
 *
 * Disposal is part of the contract: `close()` aborts this service's own waits and drops its
 * registries, and refuses further calls. It never claims a remote operation stopped — the durable
 * task keeps its identity and the Host reconciles it. A Host that published this service should call
 * `close()` from its own dispose effect, beside closing the task service and the machine directory.
 */

import { createHash, randomUUID } from 'node:crypto'
import { catalogFor, independentToolEntry } from './independent-tool-catalog.mjs'

const fail = (code, message, extra) => { throw Object.assign(new Error(message ?? code), { code, ...(extra ?? {}) }) }
const ref = value => typeof value === 'string' && /^[-A-Za-z0-9_.]{1,128}$/.test(value)
const key = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const cancelled = () => Object.assign(new Error('这一轮已被取消。'), { code: 'BOT_LOOP_CANCELLED' })
const closedError = taskId => Object.assign(new Error('宿主工具服务已关闭，本次等待结束；远端任务保持自己的身份，由宿主对账。'), { code: 'TOOL_HOST_CLOSED', taskId })

/** Task states that will not change without a Host decision. */
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'blocked', 'skipped', 'needs-reconciliation', 'waiting-approval'])
/** Task states the loop may keep waiting on. */
const PENDING = new Set(['ready', 'admitting', 'running', 'cancelling', 'waiting-budget'])

/** How many issued operation/task ids one Bot may reference. Older ones simply stop being citable. */
const ISSUED_LIMIT = 512
/**
 * A stable, Host-owned reference from a turn identity and one call id. Both come from the loop, not
 * from the model, and neither is ever echoed back into the request as authority.
 */
const reference = (turnId, callId) => createHash('sha256').update(`${String(turnId ?? '')}/${String(callId ?? '')}`).digest('hex').slice(0, 32)

/**
 * @param {{
 *   directory: { forBot: (botId: string) => unknown },
 *   authority?: { assertTool: (subject: unknown, name: string) => void } | null,
 *   machines: object | (() => object | null),
 *   taskService?: object | (() => object | null) | null,
 *   backends?: string[] | (() => string[]),
 *   supportsToolsFor?: (botId: string) => boolean,
 *   now?: () => number,
 *   pollMs?: number,
 *   waitMs?: number,
 *   issuedLimit?: number,
 * }} options
 */
export function createIndependentToolHost({ directory, authority = null, machines, taskService = null, backends = [], supportsToolsFor = () => true, now = Date.now, pollMs = 50, waitMs = 120_000, issuedLimit = ISSUED_LIMIT } = {}) {
  if (!directory || typeof directory.forBot !== 'function') throw new TypeError('INDEPENDENT_TOOL_HOST_REQUIRES_DIRECTORY')
  if (machines === undefined || machines === null) throw new TypeError('INDEPENDENT_TOOL_HOST_REQUIRES_MACHINES')
  if (typeof supportsToolsFor !== 'function') throw new TypeError('INDEPENDENT_TOOL_HOST_REQUIRES_MODEL_CAPABILITIES')
  if (!Number.isSafeInteger(pollMs) || pollMs < 5 || pollMs > 1000) throw new TypeError('INVALID_TOOL_HOST_POLL')
  if (!Number.isSafeInteger(waitMs) || waitMs < 1000 || waitMs > 3_600_000) throw new TypeError('INVALID_TOOL_HOST_WAIT')
  if (!Number.isSafeInteger(issuedLimit) || issuedLimit < 1 || issuedLimit > 100_000) throw new TypeError('INVALID_TOOL_HOST_ISSUED_LIMIT')
  const machineStore = () => {
    const value = typeof machines === 'function' ? machines() : machines
    if (!value || typeof value.call !== 'function') fail('MACHINE_DIRECTORY_UNAVAILABLE')
    return value
  }
  const tasks = () => {
    const value = typeof taskService === 'function' ? taskService() : taskService
    return value && typeof value.submit === 'function' ? value : null
  }
  const backendIds = () => {
    const value = typeof backends === 'function' ? backends() : backends
    const ids = Array.isArray(value) ? value.filter(id => typeof id === 'string') : []
    return tasks() ? [...ids, 'task-service'] : ids
  }
  // Operations and tasks this Host issued, per Bot. A reply may only reference one of these; it
  // cannot ask about an operation it never received. The registry is bounded, and it is the only
  // state this service keeps.
  const issued = new Map()
  const waits = new Set()
  let closed = false
  const remember = (botId, id) => {
    const set = issued.get(botId) ?? new Set()
    set.add(id)
    while (set.size > issuedLimit) set.delete(set.values().next().value)
    issued.set(botId, set)
  }
  const known = (botId, id) => Boolean(issued.get(botId)?.has(id))
  const alive = () => { if (closed) fail('TOOL_HOST_CLOSED', '宿主工具服务已关闭，本次调用被拒绝。') }
  /** Every wait this service is sitting in, so a close can end them without a stop claim. */
  const track = waiter => { waits.add(waiter); return () => waits.delete(waiter) }

  /** Live committed bindings for one Bot, straight from the machine directory. */
  const scopesFor = botId => {
    const store = machineStore()
    const rows = typeof store.scopes === 'function' ? store.scopes(botId) : []
    return rows.filter(scope => scope && ref(scope.machineId) && Array.isArray(scope.tools) && Array.isArray(scope.roots))
  }

  /**
   * Whether this Bot's authority still holds a capability.
   *
   * The catalog is not allowed to offer a tool the authority would refuse, so a grant that was
   * withdrawn takes the tool out of the request instead of leaving the model to discover the refusal
   * one call at a time. A Host that publishes no authority keeps the machine binding as its only
   * gate, and the call itself is still re-checked there.
   */
  const grantedFor = botId => capability => {
    if (!authority || typeof authority.assertTool !== 'function') return true
    try { authority.assertTool(directory.forBot(botId), capability); return true } catch { return false }
  }

  /**
   * The machine and root this call runs on, re-decided now.
   *
   * A reply may name one of its own live bindings and one of that binding's roots; anything else is
   * refused before the machine directory is touched.
   */
  const targetFor = (botId, entry, args) => {
    const scopes = scopesFor(botId)
    const wanted = args.machineId
    if (wanted !== undefined && (typeof wanted !== 'string' || !scopes.some(scope => scope.machineId === wanted))) fail('MACHINE_NOT_BOUND')
    const scope = wanted ? scopes.find(item => item.machineId === wanted) : scopes[0]
    if (!scope) fail('MACHINE_NOT_BOUND')
    if (!scope.tools.includes(entry.machineTool)) fail('MACHINE_BOT_DENIED', `该 Bot 未获授 ${entry.machineTool}。`)
    if (entry.effect === 'workspace-write' && scope.mode !== 'workspace-write') fail('MACHINE_BOT_DENIED', '该授权是只读的。')
    const rootWanted = args.rootId
    if (rootWanted !== undefined && (typeof rootWanted !== 'string' || !scope.roots.includes(rootWanted))) fail('MACHINE_ROOT_NOT_BOUND')
    const rootId = rootWanted ?? scope.roots[0]
    if (typeof rootId !== 'string' || !rootId) fail('MACHINE_ROOT_NOT_BOUND')
    return { machineId: scope.machineId, rootId }
  }

  /** The business arguments: identity keys are stripped before they can reach the machine. */
  const businessOf = args => {
    const calls = { ...args }
    for (const name of ['machineId', 'rootId', 'botId', 'taskId', 'attemptId', 'operationId', 'endpoint', 'secretRef', 'grantToken', 'executable', 'env']) delete calls[name]
    return calls
  }

  const waitForTask = async (botId, taskId, signal) => {
    const service = tasks()
    const deadline = now() + waitMs
    for (;;) {
      alive()
      signal?.throwIfAborted()
      const task = service.get(directory.forBot(botId), { taskId })
      if (!task) fail('TASK_NOT_FOUND', '任务记录不存在。', { taskId })
      if (TERMINAL.has(task.state)) return task
      if (!PENDING.has(task.state)) fail('TASK_STATE_UNREADABLE', `任务状态无法读取：${task.state}`, { taskId, state: task.state })
      if (now() >= deadline) fail('TASK_WAIT_TIMEOUT', '等待任务结束时超时。', { taskId, state: task.state })
      await new Promise((resolve, reject) => {
        let untrack = () => {}
        const stop = why => { untrack(); clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(why) }
        const onAbort = () => stop(cancelled())
        // A close ends this wait locally; it says nothing about whether the remote task stopped.
        untrack = track(() => stop(closedError(taskId)))
        const timer = setTimeout(() => { untrack(); resolve() }, pollMs)
        if (signal?.aborted) return stop(cancelled())
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    }
  }
  const runMachineTool = (botId, entry, args, context) => {
    const subject = directory.forBot(botId)
    const target = targetFor(botId, entry, args)
    const taskId = `bot-${reference(context.turnId, botId)}`
    const attemptId = `attempt-${reference(context.callId, entry.name)}`
    const calls = businessOf(args)
    // The machine layer addresses its own workspace by root, and it requires the two spellings to
    // agree; the root is the one the Host just chose, never one the reply named.
    calls.rootId = target.rootId
    // An observation carries its own operation id as Host metadata, and the machine layer requires
    // the two spellings to agree.
    const observation = entry.machineTool === 'operation_status' || entry.machineTool === 'operation_cancel'
    if (observation) calls.operationId = args.operationId
    return machineStore().call(subject, {
      machineId: target.machineId, rootId: target.rootId, taskId, attemptId, tool: entry.machineTool, args: calls,
      ...(observation ? { operationId: args.operationId } : {}),
    }, { ...(context.signal ? { signal: context.signal } : {}) })
  }

  const runTaskTool = async (botId, entry, args, context) => {
    const service = tasks()
    const subject = directory.forBot(botId)
    const target = targetFor(botId, entry, args)
    // The request key is the Host's own correlation of this turn and this call: a repeated call
    // reads the same task instead of dispatching a second one.
    const requestKey = `${botId}-${reference(context.turnId, context.callId)}`
    const input = { machineId: target.machineId, rootId: target.rootId, ...businessOf(args) }
    let submitted
    try {
      submitted = service.submit(subject, { requestKey, backend: entry.backend, input })
    } catch (error) {
      if (error?.code === 'TASK_BACKEND_UNAVAILABLE') fail('TASK_BACKEND_UNAVAILABLE', '宿主未注册该持久任务后端。', { capability: entry.name })
      throw error
    }
    const taskId = submitted?.taskId
    if (!key(taskId)) fail('TASK_SUBMIT_UNREADABLE', '任务提交没有返回可读身份。')
    remember(botId, taskId)
    const cancel = () => { try { service.cancel(subject, { taskId }) } catch { /* the journal retains its current outcome */ } }
    context.signal?.addEventListener('abort', cancel, { once: true })
    let task
    try {
      if (context.signal?.aborted) cancel()
      task = await waitForTask(botId, taskId, context.signal)
    } finally { context.signal?.removeEventListener('abort', cancel) }
    if (task.state !== 'succeeded') {
      // Unknown stays unknown: the task keeps its identity and its evidence, and the caller is told
      // which task to reconcile. Nothing here submits a replacement.
      const code = task.state === 'needs-reconciliation' ? 'TASK_OUTCOME_UNKNOWN' : `TASK_${String(task.state).toUpperCase()}`
      fail(code, `持久任务未成功完成：${task.state}`, { taskId, attemptId: task.attemptId, operationId: task.operationId, state: task.state })
    }
    return { taskId, attemptId: task.attemptId, operationId: task.operationId, result: task.result ?? null }
  }

  const observeTool = (botId, entry, args, context) => {
    if (entry.machineTool === 'operation_status' || entry.machineTool === 'operation_cancel') {
      const operationId = args.operationId
      if (!ref(operationId)) fail('INVALID_TOOL_ARGS', 'operationId 缺失或格式不正确。')
      // Only an operation this Host issued for this Bot may be observed or stopped.
      if (!known(botId, operationId)) fail('OPERATION_NOT_ISSUED', '该 operationId 不是宿主发给本 Bot 的。')
    }
    if (entry.machineTool === 'artifact_stat' || entry.machineTool === 'artifact_read') {
      if (!/^[a-f0-9]{64}$/.test(String(args.artifactId ?? ''))) fail('INVALID_TOOL_ARGS', 'artifactId 缺失或格式不正确。')
    }
    const result = runMachineTool(botId, entry, args, context)
    if (typeof result?.operationId === 'string') remember(botId, result.operationId)
    return result
  }

  const readTask = async (botId, args, context) => {
    const service = tasks()
    const taskId = args.taskId
    if (!key(taskId)) fail('INVALID_TOOL_ARGS', 'taskId 缺失或格式不正确。')
    if (!known(botId, taskId)) fail('TASK_NOT_ISSUED', '该 taskId 不是宿主发给本 Bot 的。')
    context.signal?.throwIfAborted()
    return service.get(directory.forBot(botId), { taskId })
  }

  const cancelTask = async (botId, args, context) => {
    const service = tasks()
    const taskId = args.taskId
    if (!key(taskId)) fail('INVALID_TOOL_ARGS', 'taskId 缺失或格式不正确。')
    if (!known(botId, taskId)) fail('TASK_NOT_ISSUED', '该 taskId 不是宿主发给本 Bot 的。')
    const outcome = service.cancel(directory.forBot(botId), { taskId })
    // A cancel is a request, not a confirmation: the attempt keeps its own identity and the Host
    // reconciles it. The loop reports the request, never a stop proof it does not have.
    return { taskId, cancelRequested: true, state: outcome?.state ?? null }
  }

  return Object.freeze({
    /**
     * One Bot's live tool surface.
     *
     * The returned object is cheap and stateless: every method re-reads committed grants, so a
     * cached loop can never freeze an older grant into a turn.
     */
    forBot(botId, { nativeRoute = null } = {}) {
      if (typeof botId !== 'string' || !botId) throw new TypeError('INDEPENDENT_TOOL_HOST_REQUIRES_BOT')
      const supported = () => supportsToolsFor(botId, nativeRoute) === true
      const view = Object.freeze({
        botId,
        /** The schemas this Bot may see right now. */
        schemas() {
          if(!supported())return []
          return catalogFor({ scopes: scopesFor(botId), backends: backendIds(), granted: grantedFor(botId) }).tools
        },
        /** What this Host cannot run for this Bot, and why. */
        unavailable() {
          const catalog=catalogFor({ scopes: scopesFor(botId), backends: backendIds(), granted: grantedFor(botId) })
          return supported()?catalog.unavailable:[...catalog.unavailable,...catalog.tools.map(tool=>({name:tool.name,code:'MODEL_TOOLS_UNSUPPORTED'}))]
        },
        /** Which machines this Bot's own live bindings cover. */
        machines() {
          return catalogFor({ scopes: scopesFor(botId), backends: backendIds(), granted: grantedFor(botId) }).machines
        },
        isReadonly(name) {
          const entry = independentToolEntry(name)
          return Boolean(entry) && entry.effect === 'read'
        },
        async call(name, args = {}, context = {}) {
          alive()
          if(!supported())fail('MODEL_TOOLS_UNSUPPORTED','当前对话引擎不支持工具调用；Bot 的工具权限仍保留。')
          const entry = independentToolEntry(name)
          // Offered-or-refused is decided here, not at schema time: a grant that changed between
          // the request and the call stops the call.
          if (!entry) fail('TOOL_NOT_GRANTED', `未获授的工具：${String(name)}`)
          if (!plain(args)) fail('INVALID_TOOL_ARGS', '工具参数必须是一个普通对象。')
          const granted = view.schemas().some(tool => tool.name === name)
          if (!granted) fail('TOOL_NOT_GRANTED', `该 Bot 当前未获授 ${name}。`)
          const turnId = context.turnId ?? randomUUID()
          const callId = context.callId ?? randomUUID()
          const scoped = { ...context, turnId, callId }
          // Reading or stopping one of this Bot's own tasks is not a machine effect at all.
          if (entry.backend === 'task-service') return entry.taskAction === 'cancel' ? cancelTask(botId, args, scoped) : readTask(botId, args, scoped)
          if (entry.backend) return runTaskTool(botId, entry, args, scoped)
          if (entry.machineTool === 'operation_status' || entry.machineTool === 'operation_cancel'
            || entry.machineTool === 'artifact_stat' || entry.machineTool === 'artifact_read') return observeTool(botId, entry, args, scoped)
          return runMachineTool(botId, entry, args, scoped)
        },
      })
      return view
    },

    /**
     * Dispose this service: end its own waits, drop its registries and refuse further calls.
     *
     * This is not a stop of anything remote. A task still in flight keeps its identity and its
     * evidence in the journal, and the Host reconciles it; nothing here claims it stopped, and
     * nothing here submits a replacement.
     */
    close() {
      if (closed) return
      closed = true
      for (const stop of [...waits]) stop()
      waits.clear()
      issued.clear()
    },
  })
}
