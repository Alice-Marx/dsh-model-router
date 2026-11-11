// Claude Code conversation-session engine adapter.
//
// Ported and re-grounded from OpenMausBot server/drivers/claude.ts at pin
// 1bc4749aa8307d7d6998bf86de4ef6478460dd93 (Apache-2.0); see licenses/NOTICE.md.
// Upstream behavior kept: stream-json both ways, one retained CLI process per session,
// each turn settled by the CLI's own `result` frame, `init` confirming session id /
// model / permission mode, permission asks over a local ask/answer broker with fail-closed
// semantics, total_cost_usd treated as a running total, --resume on relaunch, and an error
// result before init on a resumed process meaning the session was refused.
//
// Target seams used (all read-only, same repository):
//   - nativeProcess(helper,'supervise',…) private launcher with Windows job-object tree-stop evidence
//   - privateEnvironment isolated home; protectProfile ACL
//   - createCliBootstrap committed-grant MCP tool bridge
//   - createAuthority grant revision/model assertions (guard interval, like codex-session-core)
//
// Policy: every dependency is trusted Host state. Caller-submitted JSON may only carry a
// message text (submitTurn) or a permission decision (respondToRequest). Authority,
// environment, executable paths, arguments and auto-approval can never arrive through
// those payloads. Usage/cost figures that the CLI does not report stay null; money flows
// only to the unique Host hooks (onSettle/onClose) — this adapter keeps no second ledger.
//
// Turn lifecycle fence (this port's hardening beyond upstream):
//   - submitTurn reserves the single turn slot synchronously, before its first await:
//     a same-tick second submit is refused busy with zero admissions and zero launches.
//     The slot is held across admission, launch, dispatch, result and Host settlement;
//     only a completed settlement (or an admission refusal, which proves nothing was
//     dispatched) frees it for the next turn.
//   - The public turn promise and the `turn` event complete only after the unique Host
//     settlement callback (onSettle) ran. A settlement failure rejects with the native
//     evidence attached, funding stays unknown, and the engine stops: no next turn, no
//     fresh process pretending success, never a replay.
//   - Post-admission failures settle exactly once. Failures provably before the prompt
//     was written to the CLI's stdin settle `not-run`; a failed stdin write is `unknown`
//     (may-dispatch). Every receipt binds its turnId and operationId; no second ledger.
//   - stop() ends the native tree first, independent of any Host hook; real tree-stop
//     evidence comes only from the supervisor's accounting. stop() completes only after
//     settlement ran — `tree-stopped` carries the supervisor evidence before that wait —
//     and a pending settlement stays observable in snapshot().
//   - hooks.onObserve is an observation hook, not the ledger: its failures are counted
//     and emitted (`observe-failed`), never silently swallowed, and are never themselves
//     a turn or financial outcome.

import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { capabilityProbe, nativeProcess, privateEnvironment, protectProfile } from '../../cli-runtime/src/native-process.mjs'
import { createCliBootstrap } from '../../capability-broker/src/cli-bootstrap.mjs'
import {
  brokerAnswer, classifyClaudeFrame, claudeResultError, claudeUserMessage,
  sumNativeTurnResults, turnCostFromRunningTotal, validTurnText,
} from './claude-protocol.mjs'
import { brokerPipeCandidates, createPermissionBroker } from './claude-permission-broker.mjs'

const PROXY_PATH = fileURLToPath(new URL('./claude-permission-proxy.mjs', import.meta.url))
const digest = value => createHash('sha256').update(value).digest('hex')
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const DEFAULT_LAUNCHER = Object.freeze({ probe: capabilityProbe, protect: protectProfile, supervise: nativeProcess })

/** Defense in depth; --tools '' is the closed built-in tool set, including future tools. */
export const DISALLOWED_NATIVE_TOOLS = Object.freeze(['Bash', 'PowerShell', 'Read', 'Glob', 'Grep', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'BashOutput', 'KillShell', 'KillBash', 'NotebookEdit', 'Task', 'Agent', 'Skill'])
export const ENGINE_PERMISSION_MODES = Object.freeze(['default', 'acceptEdits', 'auto'])

/**
 * Caller supplies an installation-attested absolute native entry and immutable digest.
 * `script` (optional, also absolute and digest-pinned) covers interpreter-plus-script
 * installs — e.g. a node-based CLI pinned as `node … cli.js` — mirroring upstream's
 * configured executable. Both halves are Host state: a turn payload can never name them.
 */
export async function pinClaudeEntry({ executable, sha256, version, script, scriptSha256 }, home) {
  if (!isAbsolute(executable ?? '') || !/^[a-f0-9]{64}$/.test(sha256 ?? '') || typeof version !== 'string' || !/^[0-9][A-Za-z0-9.+_-]{0,31}$/.test(version)) throw new TypeError('PINNED_ENGINE_ENTRY_REQUIRED')
  if (script !== undefined && (!isAbsolute(script) || !/^[a-f0-9]{64}$/.test(scriptSha256 ?? ''))) throw new TypeError('PINNED_ENGINE_SCRIPT_REQUIRED')
  const path = await realpath(executable)
  if (!(await stat(path)).isFile() || (process.platform === 'win32' && !path.toLowerCase().endsWith('.exe'))) throw new Error('ENGINE_ENTRY_REQUIRED')
  if (digest(await readFile(path)) !== sha256) throw new Error('ENGINE_ENTRY_CHANGED')
  let scriptPath = null
  if (script !== undefined) {
    scriptPath = await realpath(script)
    if (!(await stat(scriptPath)).isFile() || digest(await readFile(scriptPath)) !== scriptSha256) throw new Error('ENGINE_ENTRY_SCRIPT_CHANGED')
  }
  const reported = await new Promise((resolve, reject) => {
    const child = spawn(path, scriptPath ? [scriptPath, '--version'] : ['--version'], { cwd: home, env: privateEnvironment(home), windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', error = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('ENGINE_VERSION_TIMEOUT')) }, 15_000)
    child.stdout.on('data', chunk => { output += chunk.toString('utf8'); if (output.length > 1024) child.kill() })
    child.stderr.on('data', chunk => { error = (error + chunk.toString('utf8')).slice(-1024) })
    child.once('error', rejectError => { clearTimeout(timer); reject(rejectError) })
    child.once('close', code => { clearTimeout(timer); if (code === 0) resolve(output.trim()); else reject(new Error(`ENGINE_VERSION_FAILED: ${error.slice(0, 128)}`)) })
  })
  if (!reported.includes(version)) throw new Error(`ENGINE_VERSION_MISMATCH: expected ${version} in ${JSON.stringify(reported.slice(0, 80))}`)
  return Object.freeze({ path, sha256, version, versionOutput: reported, script: scriptPath, scriptSha256: script !== undefined ? scriptSha256 : null })
}

/**
 * @param {object} options — every value is trusted Host state.
 * @param {object} options.authority capability-broker authority (subject grants)
 * @param {object} options.subject registered authority subject
 * @param {object} options.binding { taskId, attemptId, machineId, workspaceId, location }
 * @param {string} options.operationId unique operation identity
 * @param {{executable:string, sha256:string, version:string, script?:string, scriptSha256?:string}} options.entry pinned native entry (script: optional digest-pinned interpreter script, e.g. a node CLI's cli.js)
 * @param {string} options.runtimeRoot isolated absolute runtime root
 * @param {string} options.workspace absolute conversation workspace
 * @param {{catalogProvider?:string, catalogModel:string}} options.model requested model identity
 * @param {string} [options.permissionMode='default'] Host-chosen Claude permission mode (bypassPermissions is refused: this port never auto-approves)
 * @param {string} [options.billing='subscription'] billing evidence label
 * @param {string[]} [options.tools] committed-grant tool names bridged over MCP
 * @param {Array<{definition:{name}, parse:Function, execute:Function}>} [options.handlers] bridge handlers for `tools`
 * @param {number} [options.deadlineMs=120000] bounded lifetime for the whole session
 * @param {AbortSignal} [options.signal] host cancellation
 * @param {{onBeforeRequest?:Function, onObserve?:Function, onSettle?:Function, onClose?:Function}} [options.hooks] the only funding/ledger recipients
 * @param {Function} [options.onPermissionRequest] host permission callback (ask) => {behavior, message?}; absent means every forwarded ask is denied
 * @param {Function} [options.provisionCredentials] (home) => Promise writing credentials into the isolated home
 * @param {{probe?:Function, protect?:Function, supervise?:Function}} [options.launcher] process-launcher seam (tests may substitute)
 */
export async function createClaudeEngine(options) {
  const {
    authority, subject, binding, operationId,
    entry, runtimeRoot, workspace,
    model = {}, permissionMode = 'default', billing = 'subscription',
    tools = [], handlers = [], systemPrompt = null,
    deadlineMs = 120_000, signal,
    hooks = {}, onPermissionRequest,
    provisionCredentials = null,
    launcher = DEFAULT_LAUNCHER, python,
  } = options ?? {}
  if (!authority || typeof authority.describe !== 'function' || typeof authority.assertModel !== 'function') throw new TypeError('ENGINE_AUTHORITY_REQUIRED')
  if (!subject || typeof subject !== 'object') throw new TypeError('ENGINE_SUBJECT_REQUIRED')
  if (!identifier(operationId)) throw new TypeError('INVALID_ENGINE_OPERATION')
  if (!isAbsolute(runtimeRoot ?? '') || !isAbsolute(workspace ?? '')) throw new TypeError('INVALID_ENGINE_PATHS')
  const catalogProvider = model.catalogProvider ?? 'anthropic'
  const catalogModel = model.catalogModel
  if (typeof catalogProvider !== 'string' || !catalogProvider || typeof catalogModel !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(catalogModel)) throw new TypeError('INVALID_ENGINE_MODEL')
  if (!ENGINE_PERMISSION_MODES.includes(permissionMode)) throw new TypeError(`ENGINE_PERMISSION_MODE_REFUSED: ${JSON.stringify(permissionMode)} (this port never auto-approves; bypassPermissions is not available)`)
  if (!['subscription', 'api', 'unknown'].includes(billing)) throw new TypeError('INVALID_ENGINE_BILLING')
  if (systemPrompt !== null && (typeof systemPrompt !== 'string' || !systemPrompt.trim() || systemPrompt.includes('\0') || Buffer.byteLength(systemPrompt) > 32_000)) throw new TypeError('INVALID_ENGINE_SYSTEM_PROMPT')
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1000 || deadlineMs > 7_200_000) throw new TypeError('INVALID_ENGINE_DEADLINE')
  for (const key of ['onBeforeRequest', 'onObserve', 'onSettle', 'onClose']) if (hooks[key] !== undefined && typeof hooks[key] !== 'function') throw new TypeError(`ENGINE_HOOK_${key.toUpperCase()}_REQUIRED_FUNCTION`)
  if (onPermissionRequest !== undefined && typeof onPermissionRequest !== 'function') throw new TypeError('ENGINE_PERMISSION_CALLBACK_REQUIRED_FUNCTION')
  if (provisionCredentials !== null && typeof provisionCredentials !== 'function') throw new TypeError('ENGINE_CREDENTIAL_PROVIDER_REQUIRED_FUNCTION')
  if (!Array.isArray(tools) || tools.some(name => typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) || new Set(tools).size !== tools.length) throw new TypeError('INVALID_ENGINE_TOOLS')
  if (!Array.isArray(handlers) || handlers.some(handler => !handler?.definition?.name || typeof handler.parse !== 'function' || typeof handler.execute !== 'function')) throw new TypeError('INVALID_ENGINE_HANDLERS')
  if (new Set(handlers.map(handler => handler.definition.name)).size !== handlers.length || tools.some(name => !handlers.some(handler => handler.definition.name === name))) throw new TypeError('UNKNOWN_ENGINE_BRIDGE_HANDLER')

  authority.assertModel(subject, catalogProvider, catalogModel)
  const { botId, revision } = authority.describe(subject)
  signal?.throwIfAborted()

  const cwd = await realpath(workspace)
  if (!(await stat(cwd)).isDirectory()) throw new Error('INVALID_WORKSPACE')
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 })
  const root = await realpath(runtimeRoot)
  const home = join(root, `e-${operationId}`)
  await mkdir(home, { mode: 0o700 })
  for (const folder of ['tmp', 'cache', 'config', 'data', 'appdata', 'local', 'b']) await mkdir(join(home, folder), { recursive: true, mode: 0o700 })
  const probe = await launcher.probe({ home, python })
  if (!probe?.available) throw new Error(`NATIVE_PEER_UNAVAILABLE: ${probe?.reason ?? 'unknown'}`)
  await launcher.protect(probe.helper, home)
  const pinned = await pinClaudeEntry(entry, home)
  // Host-confirmed persona uses the CLI's own system slot. Keep its contents
  // in the protected private home rather than process arguments or turn text.
  const systemPromptFile = systemPrompt === null ? null : join(home, 'system-prompt.txt')
  if (systemPromptFile) await writeFile(systemPromptFile, systemPrompt, { mode: 0o600, flag: 'wx' })
  const grantedTools = new Set(tools)
  const deadlineEnd = Date.now() + deadlineMs

  const events = new EventEmitter()
  const stats = { asks: 0, forwarded: 0, autoDeniedUnsupported: 0, duplicateDenied: 0, timeoutDenied: 0, hostDenied: 0, hostAllowed: 0, hostAnswered: 0 }
  const frames = { init: 0, assistant: 0, results: 0, ignored: 0 }
  let currentProcess = null, currentTurn = null, pendingLaunch = null, stopPromise = null, stopped = false, fatalError = null
  let turnsDispatched = 0, launches = 0, resumeRefused = false, strayResults = 0, observeHookFailures = 0
  let confirmedSessionId = null, initModel = null, identityMismatch = false, stopRequestedAt = null
  let settleChain = Promise.resolve()
  let guardTimer = null, deadlineTimer = null
  let lastActivity = null
  // Display observations have their own channel. They can never dispatch tools
  // or alter the unique Host settlement, even when a display sink fails.
  const activity = (identity, kind, facts = {}) => {
    if (!identity) return
    try { events.emit('activity', Object.freeze({ kind, ...identity, ...facts })) }
    catch {
      observeHookFailures++
      try { events.emit('observe-failed', { kind: 'activity', error: 'NATIVE_ACTIVITY_OBSERVER_FAILED' }) } catch {}
    }
  }

  const fatal = (error, reason) => {
    if (stopped) return
    fatalError = error
    void stop(reason ?? 'engine-fatal')
  }

  // ---- permission broker --------------------------------------------------
  const denyUnsupported = (ask, note) => {
    stats.autoDeniedUnsupported++
    events.emit('permission-resolved', { ask, behavior: 'deny', source: 'engine', reason: note })
    return note
  }
  const broker = await createPermissionBroker({
    pipeCandidates: brokerPipeCandidates(home),
    isActive: () => !stopped && currentTurn !== null && !currentTurn.settled,
    onAsk: ask => {
      stats.asks++
      events.emit('permission-ask', { ask })
      if (ask.kind === 'question') {
        if (!onPermissionRequest) { stats.hostDenied++; return }
        stats.forwarded++
        void Promise.resolve(onPermissionRequest(ask)).then(decision => {
          if (!decision || typeof decision.behavior !== 'string') throw new TypeError('INVALID_PERMISSION_DECISION')
          if (decision.behavior === 'answer') { if (typeof decision.message !== 'string') throw new TypeError('ANSWER_MESSAGE_REQUIRED') }
          else if (decision.behavior !== 'deny') throw new TypeError('INVALID_PERMISSION_BEHAVIOR')
          if (!broker.answer(ask.id, decision.behavior, decision.message)) stats.hostDenied++
        }).catch(() => {
          stats.hostDenied++
          broker.answer(ask.id, 'deny', 'Host permission callback failed.')
        })
        return
      }
      // Permission asks: only committed-grant bridge tools can ever be allowed.
      const bridged = /^mcp__dsh_task__([A-Za-z0-9_-]{1,64})$/.exec(ask.tool)
      if (!bridged || !grantedTools.has(bridged[1])) {
        // Answer directly on the wire: the broker only knows pending ids it created.
        broker.answer(ask.id, 'deny', `Host: tool ${ask.tool} is not in this engine's committed grants.`)
        denyUnsupported(ask, 'unsupported-tool')
        return
      }
      if (!onPermissionRequest) { stats.hostDenied++; broker.answer(ask.id, 'deny', 'Host: no permission callback is configured.'); return }
      stats.forwarded++
      void Promise.resolve(onPermissionRequest(ask)).then(decision => {
        if (!decision || typeof decision.behavior !== 'string') throw new TypeError('INVALID_PERMISSION_DECISION')
        if (decision.behavior !== 'allow' && decision.behavior !== 'deny') throw new TypeError('INVALID_PERMISSION_BEHAVIOR')
        if (broker.answer(ask.id, decision.behavior, typeof decision.message === 'string' ? decision.message : undefined)) {
          if (decision.behavior === 'allow') stats.hostAllowed++; else stats.hostDenied++
        } else stats.hostDenied++
      }).catch(() => {
        stats.hostDenied++
        broker.answer(ask.id, 'deny', 'Host permission callback failed.')
      })
    },
    onResolve: resolved => {
      if (resolved.source === 'timeout') stats.timeoutDenied++
      events.emit('permission-resolved', { ask: resolved, behavior: resolved.behavior, source: resolved.source })
    },
  })

  // ---- turn settlement ----------------------------------------------------
  // Settles THE GIVEN TURN (never "whatever is current"): a late callback from an
  // older generation cannot settle a newer turn. The turn slot stays reserved until
  // the Host settlement callback completed; the public promise and the `turn` event
  // fire only afterwards. A settlement failure rejects with the native evidence
  // attached and stops the engine — it is never returned as success and never
  // swallowed. Exactly one settlement runs per admitted turn.
  const settleTurn = (turn, native, hostCause) => {
    if (!turn || turn.settled) return false
    turn.settled = true
    turn.toolController.abort(new Error('ENGINE_TURN_ENDED'))
    turn.phase = 'settling'
    clearTimeout(turn.timer)
    const turnProcess = turn.process
    let ok = native.ok
    let stopReason = native.stopReason
    let outcome
    let costUsd = null
    if (hostCause) {
      ok = false
      stopReason = hostCause.stopReason
      outcome = hostCause.outcome
    } else {
      costUsd = turnCostFromRunningTotal(native.cost ?? null, turnProcess?.costTotal ?? null)
      if (typeof native.cost === 'number' && turnProcess) turnProcess.costTotal = native.cost
      outcome = ok ? (confirmedSessionId ? 'succeeded' : 'unknown') : 'failed'
    }
    const turnResult = {
      schemaVersion: 1, turnId: turn.turnId, operationId, driver: 'claude', ok, outcome, stopReason,
      sessionId: confirmedSessionId, usage: native.usage ?? null,
      usageStatus: native.usage && native.usage.input !== null && native.usage.output !== null ? 'reported' : 'unknown',
      costUsd, costStatus: costUsd === null ? 'unknown' : 'cli-reported-running-total-delta',
      billing, turnsDispatched,
      dispatched: turn.dispatched === true,
      errorText: native.isError && native.errors?.length ? claudeResultError(native) : hostCause?.errorText ?? null,
      stopRequestedAt: stopRequestedAt !== null ? stopRequestedAt : null,
    }
    turn.result = turnResult
    const releaseSlot = () => { if (currentTurn === turn) currentTurn = null }
    settleChain = settleChain.then(async () => {
      try {
        await hooks.onSettle?.(turnResult)
      } catch (error) {
        // The ledger settlement failed. This turn is NOT successful and the failure
        // is not swallowed: the rejection carries the native evidence, funding
        // stays unknown (the CLI really may have run), and the engine stops so no
        // next turn or fresh process can pretend success. Nothing is replayed.
        fatalError = error instanceof Error ? error : new Error(String(error))
        releaseSlot()
        const settleError = new Error(`ENGINE_SETTLE_HOOK_FAILED: ${fatalError.message}`)
        settleError.turnResult = turnResult
        settleError.fundingStatus = 'unknown'
        events.emit('turn-settle-failed', { turnResult, error: fatalError })
        activity(turn.activity, 'turn-close', { outcome: 'unknown' })
        turn.reject(settleError)
        void stop('settle-hook-failed')
        return
      }
      releaseSlot()
      turn.phase = 'settled'
      activity(turn.activity, 'turn-close', { outcome: turnResult.outcome === 'not-run' ? 'refused' : turnResult.outcome })
      events.emit('turn', turnResult)
      turn.resolve(turnResult)
    })
    return true
  }

  const assertDispatchAuthorization = () => {
    signal?.throwIfAborted()
    authority.assertModel(subject, catalogProvider, catalogModel)
    if (authority.describe(subject).revision !== revision) throw new Error('ENGINE_GRANT_CHANGED')
    if (broker.closed) throw new Error('ENGINE_BROKER_CLOSED')
  }

  // ---- process launch -----------------------------------------------------
  const writeMcpConfig = async bridge => {
    const mcpServers = {
      dsh: { type: 'stdio', command: process.execPath, args: [PROXY_PATH, broker.pipePath], env: {} },
    }
    if (tools.length) {
      // MCP clients inherit only a small default environment. Carry this
      // Host-owned compiler root explicitly so nested native pipe helpers use
      // the same short storage; the CLI profile and TEMP stay conversation-owned.
      const compilerRoot = privateEnvironment(home).DSH_NATIVE_COMPILER_ROOT
      mcpServers.dsh_task = { type: 'stdio', command: bridge.command, args: bridge.args,
        env: { HOME: home, USERPROFILE: home, TEMP: join(home, 'tmp'), TMP: join(home, 'tmp'),
          ...(compilerRoot ? { DSH_NATIVE_COMPILER_ROOT: compilerRoot } : {}) } }
    }
    const path = join(home, `mcp-${++launches}.json`)
    await writeFile(path, `${JSON.stringify({ mcpServers })}\n`, { mode: 0o600 })
    return path
  }

  const launch = async ({ resume = false, turn = null } = {}) => {
    const remaining = deadlineEnd - Date.now()
    if (remaining <= 1000) throw new Error('ENGINE_DEADLINE')
    const launchId = launches + 1
    const contextFor = ({ op, id }) => {
      const turn = currentTurn
      if (!turn || !turn.admitted || turn.settled || (op === 'call' && !['dispatching', 'running'].includes(turn.phase))) {
        throw new Error('ENGINE_TOOL_TURN_REQUIRED')
      }
      return { turnId: turn.turnId, callId: `${operationId}-${launchId}-${id}`, signal: turn.toolController.signal }
    }
    const bridge = await createCliBootstrap({ authority, subject, binding, tools, handlers, contextFor, home: join(home, 'b'), ttlMs: Math.min(remaining, deadlineMs), helper: probe.helper })
    const mcpConfigPath = await writeMcpConfig(bridge)
    const allowedTools = ['mcp__dsh', ...tools.map(name => `mcp__dsh_task__${name}`)]
    const args = [
      '-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--permission-mode', permissionMode,
      // allowedTools is an auto-approval list, not a tool availability whitelist.
      // Empty arguments must survive the native supervisor's Windows quoting.
      '--tools', '', '--setting-sources', '',
      '--settings', JSON.stringify({ disableAllHooks: true }), '--disable-slash-commands',
      '--strict-mcp-config', '--mcp-config', mcpConfigPath,
      '--permission-prompt-tool', 'mcp__dsh__approve',
      '--disallowedTools', DISALLOWED_NATIVE_TOOLS.join(','),
      '--allowedTools', allowedTools.join(','),
      '--model', catalogModel,
      ...(systemPromptFile ? ['--append-system-prompt-file', systemPromptFile] : []),
      ...(resume && confirmedSessionId ? ['--resume', confirmedSessionId] : []),
    ]
    if (digest(await readFile(pinned.path)) !== pinned.sha256 || (pinned.script && digest(await readFile(pinned.script)) !== pinned.scriptSha256)) { await bridge.close(); throw new Error('ENGINE_ENTRY_CHANGED') }
    const env = privateEnvironment(home)
    env.CLAUDE_CONFIG_DIR = join(home, '.claude')
    // The broker locator is engine-constructed Host state, never caller input. The real
    // CLI ignores it; the fixture reads it so it can play the permission-proxy's role.
    env.DSH_CLAUDE_BROKER_PIPE = broker.pipePath
    if (provisionCredentials) await provisionCredentials(home)
    let supervisor
    try {
      supervisor = launcher.supervise(probe.helper, 'supervise', { executable: pinned.path, args: pinned.script ? [pinned.script, ...args] : args, cwd, ttlMs: remaining }, { home, env })
    } catch (error) {
      // The supervisor never came up: release the lease so nothing outlives the launch.
      await bridge.close().catch(() => {})
      throw error
    }
    const state = { supervisor, bridge, resume, turn, sawInit: false, dead: false, rootProcess: null, stopEvidence: null, costTotal: null, exitInfo: null,
      activityGeneration: `native-${randomBytes(16).toString('hex')}` }
    // Registered before the first await after spawning: a stop during launch ends THIS
    // supervisor instead of orphaning a freshly spawned process tree.
    pendingLaunch = state
    const onControl = value => {
      if (value.control === 'spawned') state.rootProcess = value
      if (value.control === 'stopped') { state.stopEvidence = value; markDead(value) }
    }
    const markDead = stoppedControl => {
      if (state.dead) return
      state.dead = true
      state.exitInfo = stoppedControl ? { exitCode: stoppedControl.exitCode, reason: stoppedControl.reason } : null
      supervisor.events.off('control', onControl)
      supervisor.events.off('message', onMessage)
      const wasCurrent = currentProcess === state
      if (wasCurrent) currentProcess = null
      if (pendingLaunch === state) pendingLaunch = null
      void bridge.close().catch(() => {})
      // Without stop evidence the helper's state is unknown: never leave a live tree.
      if (!stoppedControl) supervisor.end()
      // Which turn may this death settle: the turn currently in flight on this
      // process (a retained process dying mid-turn — possibly a later generation
      // than the one that launched it), else this state's launching turn if it
      // never settled (a death during launch). A former process can never settle
      // a newer generation, and a settled turn is never re-settled.
      let bound = null
      if (wasCurrent && currentTurn && !currentTurn.settled) bound = currentTurn
      else if (state.turn && !state.turn.settled) bound = state.turn
      if (stopped || !bound) return
      if (bound.process !== state) {
        // The process died before this turn's prompt was written to its stdin:
        // provably nothing was dispatched, so this is not-run — and no usage or
        // cost figures are invented for a dispatch that never happened.
        settleTurn(bound, { ok: false, stopReason: 'spawn-failed', cost: null }, { stopReason: 'spawn-failed', outcome: 'not-run' })
        return
      }
      if (state.resume && !state.sawInit) {
        // The resumed conversation no longer exists upstream: fail the continuation
        // without ever replaying an earlier task into a fresh session.
        resumeRefused = true
        settleTurn(bound, { ok: false, stopReason: 'resume-refused', cost: null }, { stopReason: 'resume-refused', outcome: 'unknown' })
        void stop('resume-refused')
      } else {
        settleTurn(bound, { ok: false, stopReason: 'exit-before-result', cost: null }, { stopReason: 'exit-before-result', outcome: 'unknown' })
      }
    }
    const onMessage = frame => {
      if (state.dead || stopped) return
      let classified
      try { classified = classifyClaudeFrame(frame) } catch { frames.ignored++; return }
      switch (classified.type) {
        case 'init': {
          frames.init++
          state.sawInit = true
          initModel = classified.model
          if (classified.sessionId) confirmedSessionId = classified.sessionId
          if (classified.model !== null && classified.model !== catalogModel) {
            identityMismatch = true
            events.emit('session', { sessionId: confirmedSessionId, requestedModel: catalogModel, reportedModel: classified.model, verification: 'mismatch' })
            if (state.turn && !state.turn.settled) settleTurn(state.turn, { ok: false, stopReason: 'model-identity-mismatch', cost: null }, { stopReason: 'model-identity-mismatch', outcome: 'failed' })
            fatalError = new Error('ENGINE_MODEL_IDENTITY_MISMATCH')
            void stop('model-identity-mismatch')
            return
          }
          events.emit('session', { sessionId: confirmedSessionId, requestedModel: catalogModel, reportedModel: classified.model, permissionMode: classified.permissionMode, resumed: resume, verification: classified.model === catalogModel ? 'init-confirmed' : 'unreported' })
          settleChain = settleChain.then(async () => { await hooks.onObserve?.({ kind: 'session-confirmed', sessionId: confirmedSessionId, model: classified.model, resumed: resume }) }).catch(error => {
            // onObserve is an observation hook, not the ledger: money flows only
            // through onSettle/onClose. Its failure is recorded and observable,
            // never silently swallowed, and never a turn or financial outcome.
            observeHookFailures++
            events.emit('observe-failed', { kind: 'session-confirmed', error: String(error?.message ?? error) })
          })
          return
        }
        case 'assistant-delta':
          events.emit('delta', { streamKind: 'assistant_text', delta: classified.delta })
          return
        case 'reasoning-delta':
          events.emit('delta', { streamKind: 'reasoning_text', delta: classified.delta })
          return
        case 'assistant': {
          frames.assistant++
          if (classified.text) events.emit('assistant', { text: classified.text })
          for (const use of classified.toolUses ?? []) {
            const tool = { phase: 'started', id: use.id, name: use.name }
            const observation = Object.freeze({ ...tool })
            events.emit('tool', tool)
            if (state === currentProcess && currentTurn?.process === state && !currentTurn.settled && ['dispatching', 'running'].includes(currentTurn.phase)) {
              activity(currentTurn.activity, 'tool', { tool: observation })
            }
          }
          return
        }
        case 'tool-result':
          for (const result of classified.results) {
            const tool = { phase: 'completed', id: result.toolUseId, ok: result.ok }
            const observation = Object.freeze({ ...tool })
            events.emit('tool', tool)
            if (state === currentProcess && currentTurn?.process === state && !currentTurn.settled && ['dispatching', 'running'].includes(currentTurn.phase)) {
              activity(currentTurn.activity, 'tool', { tool: observation })
            }
          }
          return
        case 'result': {
          frames.results++
          if (classified.isError && state.resume && !state.sawInit) {
            resumeRefused = true
            if (state.turn && !state.turn.settled) settleTurn(state.turn, { ok: false, stopReason: 'resume-refused', cost: null, isError: true, errors: classified.errors }, { stopReason: 'resume-refused', outcome: 'unknown' })
            void stop('resume-refused')
            return
          }
          // A result only settles the turn currently in flight ON THIS process; a
          // late frame from a settled turn (or a dead former process) is a stray.
          if (state !== currentProcess || !currentTurn || currentTurn.settled) { strayResults++; return }
          settleTurn(currentTurn, sumNativeTurnResults(currentTurn.deferred ?? null, { ...classified.native, isError: classified.isError, errors: classified.errors }))
          return
        }
        default:
          frames.ignored++
      }
    }
    supervisor.events.on('control', onControl)
    supervisor.events.on('message', onMessage)
    supervisor.events.once('failure', error => { state.dead || fatal(error, 'native-failure'); markDead(null) })
    supervisor.events.once('closed', () => markDead(null))
    try {
      const spawned = await supervisor.waitControl('spawned')
      state.rootProcess = spawned
      await bridge.bind({ pid: spawned.pid, start: spawned.start })
    } catch (error) {
      if (pendingLaunch === state) pendingLaunch = null
      markDead(null)
      throw error
    }
    if (pendingLaunch === state) pendingLaunch = null
    if (stopped) {
      // The engine was stopped while this launch resolved; the stop already settled
      // the turn. Tear the just-started tree down instead of dispatching into it.
      markDead(null)
      throw new Error(fatalError ? `ENGINE_STOPPED: ${fatalError.message}` : 'ENGINE_STOPPED')
    }
    currentProcess = state
    return state
  }

  // ---- stop ---------------------------------------------------------------
  // The native tree stops FIRST and independently of every Host hook: a slow or
  // stuck settlement may delay public promises, never the tree stop. Real tree-stop
  // evidence comes only from the supervisor's own accounting. Public wait contract:
  // stop() completes only after the settlement chain (and then onClose) ran; a
  // trusted hook that never returns leaves stop() pending — observable through
  // snapshot() — but the tree above is already stopped.
  const stop = (reason = 'host-stop') => {
    if (stopPromise) return stopPromise
    stopRequestedAt = Date.now()
    stopped = true
    if (guardTimer) clearInterval(guardTimer)
    if (deadlineTimer) clearTimeout(deadlineTimer)
    const activeTurn = currentTurn
    const stoppedActivity = activeTurn?.activity ?? lastActivity
    if (activeTurn && !activeTurn.settled) {
      settleTurn(activeTurn, { ok: false, stopReason: reason, cost: null }, {
        stopReason: reason,
        outcome: signal?.aborted || reason === 'interrupt' ? 'cancelled' : activeTurn.dispatched ? 'unknown' : 'not-run',
      })
    }
    stopPromise = (async () => {
      const primary = currentProcess
      const targets = []
      if (primary) targets.push(primary)
      // A launch still in flight owns a live supervisor that stop must end, or the
      // freshly spawned tree would outlive the engine.
      if (pendingLaunch && pendingLaunch !== primary) targets.push(pendingLaunch)
      const interruptedLaunches = targets.length - (primary ? 1 : 0)
      currentProcess = null
      pendingLaunch = null
      let forcedKill = false
      for (const target of targets) {
        if (target.dead) continue
        target.supervisor.end()
        const exited = await Promise.race([target.supervisor.exit.then(() => true), new Promise(resolve => { const timer = setTimeout(() => resolve(false), 8000); timer.unref() })])
        if (!exited) {
          forcedKill = true
          target.supervisor.child.kill()
          await target.supervisor.exit
        }
      }
      const native = primary?.stopEvidence ?? null
      broker.close()
      for (const target of targets) await target.bridge.close().catch(() => {})
      const stopEvidence = {
        stopRequestedAt, stoppedAt: Date.now(), reason,
        pid: primary?.rootProcess?.pid ?? native?.pid ?? null,
        exitCode: native?.exitCode ?? primary?.exitInfo?.exitCode ?? null,
        nativeStopReason: native?.reason ?? primary?.exitInfo?.reason ?? (primary ? 'no-stopped-control' : 'no-process'),
        containment: native?.containment ?? probe.supervisor ?? null,
        // Only the launcher's own accounting (Windows job object) confirms a tree stop.
        treeStopped: native?.treeStopped === true,
        status: native?.treeStopped === true ? 'confirmed' : primary ? 'unconfirmed' : 'no-process',
        interruptedLaunches,
        forcedKill,
        stopRequestedIsNotConfirmation: true,
      }
      // Supervisor-owned tree-stop evidence is observable before the Host
      // settlement wait below, so a slow settlement can never masquerade as
      // "not stopped yet".
      events.emit('tree-stopped', stopEvidence)
      if (stopEvidence.treeStopped) activity(stoppedActivity, 'stop-confirmed')
      await settleChain
      await hooks.onClose?.(stopEvidence)
      return stopEvidence
    })()
    return stopPromise
  }

  // ---- guards -------------------------------------------------------------
  guardTimer = setInterval(() => {
    try {
      if (broker.closed) throw new Error('ENGINE_BROKER_CLOSED')
      if (currentProcess?.bridge.closed) throw new Error('ENGINE_BRIDGE_CLOSED')
      authority.assertModel(subject, catalogProvider, catalogModel)
      if (authority.describe(subject).revision !== revision) throw new Error('ENGINE_GRANT_CHANGED')
    } catch (error) {
      if (currentTurn && !currentTurn.settled) settleTurn(currentTurn, { ok: false, stopReason: 'grant-revoked', cost: null }, { stopReason: 'grant-revoked', outcome: currentTurn.dispatched ? 'unknown' : 'not-run' })
      fatal(error instanceof Error ? error : new Error(String(error)), 'grant-revoked')
    }
  }, 100)
  guardTimer.unref()
  deadlineTimer = setTimeout(() => { fatal(new Error('ENGINE_DEADLINE'), 'deadline') }, deadlineMs)
  deadlineTimer.unref()
  const onAbort = () => { fatal(new Error('ENGINE_CANCELLED'), 'cancelled') }
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) onAbort()

  // ---- public surface ------------------------------------------------------
  /** Submit one conversation turn. The payload may carry `text` and nothing else.
   * The turn slot is reserved synchronously before the first await, so a second
   * same-tick submit is refused busy with zero admissions and zero launches. The
   * returned promise completes only after the Host settlement callback ran. */
  const submitTurn = async input => {
    if (stopped) throw new Error(fatalError ? `ENGINE_STOPPED: ${fatalError.message}` : 'ENGINE_STOPPED')
    if (currentTurn) throw new Error('ENGINE_TURN_IN_PROGRESS')
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'text')) throw new TypeError('INVALID_TURN_INPUT: only { text } is accepted')
    const text = input.text
    if (!validTurnText(text)) throw new TypeError('INVALID_TURN_TEXT: 1..64000 bytes, no NUL, not blank')
    const turnId = `t-${randomBytes(8).toString('hex')}`
    let resolveTurn, rejectTurn
    const promise = new Promise((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject })
    promise.catch(() => {}) // rejections carry the turn evidence; they are never unhandled
    const turn = { turnId, phase: 'admitting', settled: false, admitted: false, dispatched: false, deferred: null, process: null, resolve: resolveTurn, reject: rejectTurn, timer: null, result: null,
      toolController: new AbortController() }
    // The turn deadline covers admission, launch, dispatch and the CLI's result.
    const timer = setTimeout(() => {
      settleTurn(turn, { ok: false, stopReason: 'turn-timeout', cost: null }, { stopReason: 'turn-timeout', outcome: turn.dispatched ? 'unknown' : 'not-run' })
      fatal(new Error('ENGINE_TURN_TIMEOUT'), 'turn-timeout')
    }, Math.max(1000, deadlineEnd - Date.now()))
    timer.unref()
    turn.timer = timer
    // THE FENCE: the slot is taken before any await. It is freed only by a completed
    // Host settlement (or an admission refusal, which proves nothing was dispatched).
    currentTurn = turn
    try {
      // Host admission first: a refusal here proves nothing was dispatched.
      await hooks.onBeforeRequest?.({ turnId, botId, ...binding, operationId, source: 'engine', driver: 'claude', requestedModel: catalogModel, entry: { path: pinned.path, sha256: pinned.sha256, version: pinned.version } })
    } catch (error) {
      if (currentTurn === turn) currentTurn = null
      clearTimeout(turn.timer)
      throw error
    }
    turn.admitted = true
    turn.phase = 'authorized'
    // From here on the admission exists: every terminal path settles it exactly once
    // with real dispatch evidence. `not-run` means provably nothing was written to
    // the CLI's stdin; a failed stdin write stays `unknown` (may-dispatch).
    const failTurn = (stopReason, outcome, errorText) =>
      settleTurn(turn, { ok: false, stopReason, cost: null }, { stopReason, outcome, ...(errorText !== undefined ? { errorText } : {}) })
    if (stopped) {
      // A stop while admission was pending has already settled this turn.
      if (!turn.settled) failTurn('engine-stopped', 'not-run', fatalError ? String(fatalError.message) : undefined)
      return promise
    }
    try {
      assertDispatchAuthorization()
    } catch (error) {
      failTurn(signal?.aborted ? 'cancelled' : 'grant-revoked', signal?.aborted ? 'cancelled' : 'not-run', String(error.message))
      return promise
    }
    let state = currentProcess
    if (!state || state.dead) {
      try {
        state = await launch({ resume: confirmedSessionId !== null, turn })
      } catch (error) {
        // markDead settles spawn/process failures; this backstop covers a supervisor
        // that threw before any state existed. Both are single-settle guarded.
        if (!turn.settled) failTurn('launch-failed', 'not-run', String(error.message))
        return promise
      }
      // The init frame may already have failed the model identity check and stopped
      // the engine while the launch was resolving; a stop during launch has already
      // settled this turn with its own cause. Never dispatch into a dead engine.
      if (stopped) {
        if (!turn.settled) failTurn('engine-stopped', turn.dispatched ? 'unknown' : 'not-run', fatalError ? String(fatalError.message) : undefined)
        return promise
      }
    }
    // A grant revoked between admission and dispatch must not send the prompt.
    try {
      assertDispatchAuthorization()
    } catch (error) {
      failTurn(signal?.aborted ? 'cancelled' : 'grant-revoked', signal?.aborted ? 'cancelled' : 'not-run', String(error.message))
      return promise
    }
    turn.process = state
    turn.phase = 'dispatching'
    turn.activity = Object.freeze({ turnId: turn.turnId, processGeneration: state.activityGeneration })
    lastActivity = turn.activity
    activity(turn.activity, 'turn-open')
    try {
      await state.supervisor.send(claudeUserMessage(text))
    } catch (error) {
      // The write failed mid-flight: the message may or may not have reached the CLI.
      failTurn('stdin-write-failed', 'unknown', String(error.message))
      return promise
    }
    turnsDispatched++
    turn.dispatched = true
    turn.phase = 'running'
    return promise
  }

  /** Host-side answer to a broker ask. Permission asks take allow/deny; questions take answer+message. */
  const respondToRequest = (requestId, decision) => {
    if (!identifier(requestId)) throw new TypeError('INVALID_REQUEST_ID')
    if (!decision || typeof decision !== 'object' || Object.keys(decision).some(key => !['behavior', 'message'].includes(key))) throw new TypeError('INVALID_PERMISSION_DECISION_INPUT')
    if (!['allow', 'deny', 'answer'].includes(decision.behavior)) throw new TypeError('INVALID_PERMISSION_BEHAVIOR')
    if (decision.behavior === 'answer' && typeof decision.message !== 'string') throw new TypeError('ANSWER_MESSAGE_REQUIRED')
    const answered = broker.answer(requestId, decision.behavior, decision.message)
    if (answered) {
      if (decision.behavior === 'allow') stats.hostAllowed++
      else if (decision.behavior === 'deny') stats.hostDenied++
      else stats.hostAnswered++
    }
    return answered
  }

  const snapshot = () => Object.freeze({
    schemaVersion: 1, driver: 'claude', botId, ...binding, operationId,
    entry: { path: pinned.path, sha256: pinned.sha256, version: pinned.version, script: pinned.script, scriptSha256: pinned.scriptSha256 },
    identity: {
      catalogProvider, catalogModel, requestedModel: catalogModel,
      reportedInitModel: initModel, verification: identityMismatch ? 'mismatch' : initModel ? 'init-confirmed' : 'unreported',
      mismatch: identityMismatch,
    },
    sessionId: confirmedSessionId,
    sessionConfirmedByHandshake: confirmedSessionId !== null,
    turnsDispatched, launches, resumeRefused, strayResults,
    // Observable turn fence state: which turn holds the slot, how far it got, and
    // whether its Host settlement callback is still pending.
    turn: currentTurn ? { turnId: currentTurn.turnId, phase: currentTurn.phase, admitted: currentTurn.admitted, dispatched: currentTurn.dispatched, settled: currentTurn.settled } : null,
    settlementPending: currentTurn?.settled === true,
    observeHookFailures,
    frames: { ...frames },
    permissions: { ...stats, brokerClosed: broker.closed, pending: broker.pendingCount },
    billing: { kind: billing, amountUsd: null, amountStatus: 'unknown', note: 'cost flows only to Host onSettle from CLI-reported running-total deltas; nothing is fabricated here' },
    process: currentProcess ? { pid: currentProcess.rootProcess?.pid ?? null, resumed: currentProcess.resume, sawInit: currentProcess.sawInit } : null,
    stopRequestedAt, stopEvidence: stopPromise ? null : undefined,
    fatalError: fatalError ? String(fatalError.message) : null,
    closed: stopped,
    limitations: [
      'init reports the CLI-configured model; the protocol does not prove the response backend model',
      'after a relaunch, the first cost delta is measured from a null baseline (the CLI restores a running total from an earlier state, not always the latest one seen)',
      'steering and queued-turn continuation merging are not ported yet: one submitted message equals one settled turn',
    ],
  })

  return Object.freeze({
    driver: 'claude',
    get sessionId() { return confirmedSessionId },
    get closed() { return stopped },
    events,
    submitTurn,
    respondToRequest,
    stop,
    close: stop,
    snapshot,
  })
}
