import { createHash } from 'node:crypto'
import { readFile, realpath, stat, mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import { capabilityProbe, nativeProcess, privateEnvironment, protectProfile } from './native-process.mjs'
import { createCliBootstrap } from '../../capability-broker/src/cli-bootstrap.mjs'
import { createCodexEvidence } from './contracts.mjs'
import { providerSettings, assertEffectiveProfile } from './profile-policy.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const validText = value => typeof value === 'string' && value.trim() && !value.includes('\0') && Buffer.byteLength(value) <= 64_000

/** Caller supplies an installation-attested absolute native entry and immutable expected digest. */
export async function pinCodexExecutable({ executable, sha256, version }, home) {
  if (!isAbsolute(executable) || !/^[a-f0-9]{64}$/.test(sha256) || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) throw new TypeError('PINNED_NATIVE_ENTRY_REQUIRED')
  const path = await realpath(executable)
  if (!(await stat(path)).isFile() || process.platform === 'win32' && !path.toLowerCase().endsWith('.exe')) throw new Error('NATIVE_ENTRY_REQUIRED')
  if (digest(await readFile(path)) !== sha256) throw new Error('CLI_ENTRY_CHANGED')
  const reported = await new Promise((resolve, reject) => {
    const child = spawn(path, ['--version'], { cwd: home, env: privateEnvironment(home), windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', error = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('CLI_VERSION_TIMEOUT')) }, 10_000)
    child.stdout.on('data', chunk => { output += chunk.toString('utf8'); if (output.length > 1024) child.kill() })
    child.stderr.on('data', chunk => { error = (error + chunk.toString('utf8')).slice(-1024) })
    child.once('error', reject)
    child.once('close', code => { clearTimeout(timer); if (code === 0) resolve(output.trim()); else reject(new Error(`CLI_VERSION_FAILED: ${error.slice(0, 128)}`)) })
  })
  if (reported !== `codex-cli ${version}`) throw new Error('CLI_VERSION_MISMATCH')
  return Object.freeze({ path, sha256, version })
}

/** Internal session mechanics. Public local and Agent wrappers own their disjoint binding guards. */
export async function createCodexSessionCore({ authority, subject, binding, operationId, tools = [], handlers = [],
  runtimeRoot, workspace, entry: suppliedEntry, requestedModel, catalogProvider = 'openai', catalogModel = requestedModel,
  deadlineMs = 60_000, provisionCredentials, billing = 'subscription', python, onUsage, onBeforeRequest, onProgress, signal,
  providerConfig = {}, roleInstructions }) {
  if (!id(operationId) || !isAbsolute(runtimeRoot) || !isAbsolute(workspace) || !/^gpt-[A-Za-z0-9_.-]{1,100}$/.test(requestedModel)) throw new TypeError('INVALID_CLI_TASK')
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1000 || deadlineMs > 7_200_000) throw new TypeError('INVALID_CLI_DEADLINE')
  authority.assertModel(subject, catalogProvider, catalogModel)
  const { botId, revision } = authority.describe(subject)
  signal?.throwIfAborted()
  const settings = providerSettings(providerConfig)
  if (roleInstructions !== undefined && !validText(roleInstructions)) throw new TypeError('INVALID_CLI_ROLE')
  const cwd = await realpath(workspace)
  if (!(await stat(cwd)).isDirectory()) throw new Error('INVALID_WORKSPACE')
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 })
  const root = await realpath(runtimeRoot)
  const home = join(root, `h-${operationId}`)
  await mkdir(home, { mode: 0o700 })
  for (const folder of ['tmp', 'cache', 'config', 'data', 'appdata', 'local', 'b']) await mkdir(join(home, folder), { mode: 0o700 })
  const probe = await capabilityProbe({ home, python })
  if (!probe.available) throw new Error(`NATIVE_PEER_UNAVAILABLE: ${probe.reason}`)
  await protectProfile(probe.helper, home)
  const entry = await pinCodexExecutable(suppliedEntry, home)
  const bridge = await createCliBootstrap({ authority, subject, binding, tools, handlers, home: join(home, 'b'), ttlMs: deadlineMs, helper: probe.helper })
  // Codex filters inherited MCP environment variables. Preserve the Host-owned
  // compiler root explicitly while keeping the CLI's private HOME and TEMP.
  const compilerRoot = privateEnvironment(home).DSH_NATIVE_COMPILER_ROOT
  const config = [
    `model = ${JSON.stringify(requestedModel)}`, 'model_provider = "openai"', 'approval_policy = "never"', 'sandbox_mode = "read-only"',
    'web_search = "disabled"', 'cli_auth_credentials_store = "file"', 'suppress_unstable_features_warning = true',
    'model_reasoning_effort = "low"',
    ...settings.lines,
    '[features]', 'shell_tool = false', 'multi_agent = false', 'memories = false',
    '[analytics]', 'enabled = false', '[mcp_servers.dsh_task]', `command = ${JSON.stringify(bridge.command)}`,
    `args = ${JSON.stringify(bridge.args)}`, `cwd = ${JSON.stringify(join(home, 'b'))}`, 'enabled = true', 'required = true',
    `enabled_tools = ${JSON.stringify(tools)}`, 'env_vars = []', 'startup_timeout_sec = 20',
    '[mcp_servers.dsh_task.env]', `HOME = ${JSON.stringify(home)}`, `USERPROFILE = ${JSON.stringify(home)}`,
    `TEMP = ${JSON.stringify(join(home, 'tmp'))}`, `TMP = ${JSON.stringify(join(home, 'tmp'))}`,
    ...(compilerRoot ? [`DSH_NATIVE_COMPILER_ROOT = ${JSON.stringify(compilerRoot)}`] : []),
  ].join('\n') + '\n'
  await writeFile(join(home, 'config.toml'), config, { flag: 'wx', mode: 0o600 })
  if (provisionCredentials) await provisionCredentials(home)
  if (digest(await readFile(join(home, 'config.toml'))) !== digest(Buffer.from(config))) { await bridge.close(); throw new Error('CLI_PROFILE_CHANGED_DURING_PROVISIONING') }
  if (digest(await readFile(entry.path)) !== entry.sha256) { await bridge.close(); throw new Error('CLI_ENTRY_CHANGED') }
  const evidence = createCodexEvidence({ binding, operationId, botId, requestedModel, catalogProvider, catalogModel, entry, billing })
  const env = privateEnvironment(home)
  const supervisor = nativeProcess(probe.helper, 'supervise', { executable: entry.path, args: ['app-server', '--listen', 'stdio://'], cwd, ttlMs: deadlineMs }, { home, env })
  const pending = new Map(), notifications = new Set()
  let sequence = 0, closed = false, rootProcess, stopEvidence = null, threadId = null, requestCount = 0, stopPromise, activeTurn = false, fatal = null, profileEvidence
  let usageWrites = Promise.resolve()
  const failPending = error => { for (const value of pending.values()) value.reject(error); pending.clear() }
  const rpc = (method, params, timeoutMs = 30_000) => new Promise((resolve, reject) => {
    if (closed || fatal) { reject(fatal ?? new Error('CLI_CLOSED')); return }
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CLI_RPC_TIMEOUT:${method}`)) }, Math.min(timeoutMs, deadlineMs))
    const settle = fn => value => { clearTimeout(timer); fn(value) }
    pending.set(id, { resolve: settle(resolve), reject: settle(reject) })
    void supervisor.send({ id, method, params }).catch(error => { const value = pending.get(id); pending.delete(id); value?.reject(error) })
  })
  const stop = () => {
    if (stopPromise) return stopPromise
    closed = true; failPending(new Error('CLI_STOPPING'))
    clearInterval(grantGuard); signal?.removeEventListener('abort', onAbort)
    stopPromise = (async () => {
      await bridge.close()
      // A completed turn can be immediately followed by the CLI's natural
      // exit. Do not replace that native exit code with our cancellation code.
      // Never grant this grace to an active, revoked, failed-protocol or aborted
      // session, and do not treat elapsed grace as proof that anything stopped.
      if (!fatal && !signal?.aborted && ['completed', 'failed'].includes(evidence.snapshot().terminal) && !stopEvidence?.treeStopped) {
        await new Promise(resolve => {
          const finish = () => { clearTimeout(grace); signal?.removeEventListener('abort', finish); resolve() }
          const grace = setTimeout(finish, 1000)
          supervisor.exit.then(finish); signal?.addEventListener('abort', finish, { once: true })
          if (signal?.aborted) finish()
        })
      }
      supervisor.end()
      const result = await Promise.race([supervisor.exit, new Promise(resolve => { const t = setTimeout(() => resolve(null), 8000); t.unref() })])
      if (!result) {
        if (process.platform === 'linux' && rootProcess) { try { process.kill(-rootProcess.pid, 'SIGKILL') } catch {} }
        supervisor.child.kill()
        await supervisor.exit
      }
      if (!stopEvidence?.treeStopped) stopEvidence = { ...stopEvidence, treeStopped: false, status: 'unconfirmed', forcedSupervisorStop: !result }
      return stopEvidence
    })()
    return stopPromise
  }
  supervisor.events.on('control', value => {
    if (value.control === 'spawned') rootProcess = value
    if (value.control === 'stopped') stopEvidence = value
  })
  supervisor.events.on('message', message => {
    if (message.id !== undefined && !message.method) {
      const value = pending.get(message.id); pending.delete(message.id)
      if (message.error) value?.reject(Object.assign(new Error(`CLI_RPC_REFUSED:${message.error.message}`), { code: message.error.code }))
      else value?.resolve(message.result)
      return
    }
    if (message.id !== undefined) {
      void supervisor.send({ id: message.id, error: { code: -32601, message: 'Host callback is not authorized' } }).catch(() => {})
      return
    }
    const update = evidence.event(message)
    if (onProgress && typeof message.method === 'string') onProgress({ method: message.method, errorCode: typeof message.params?.error?.codexErrorInfo === 'string' ? message.params.error.codexErrorInfo : null })
    if (update.usageChanged && onUsage) {
      const snapshot = evidence.snapshot()
      usageWrites = usageWrites.then(() => onUsage(snapshot))
      void usageWrites.catch(error => { fatal = error; void stop() })
    }
    if (update.mismatch) { fatal = new Error('CLI_MODEL_IDENTITY_MISMATCH'); void stop() }
    for (const listener of notifications) listener(message, update)
  })
  supervisor.events.on('failure', error => { fatal = error; failPending(error); void stop() })
  supervisor.events.once('closed', () => { closed = true; failPending(new Error('CLI_EXITED')); void bridge.close() })
  const onAbort = () => { fatal = new Error('CLI_CANCELLED'); void stop() }
  signal?.addEventListener('abort', onAbort, { once: true })
  const grantGuard = setInterval(() => {
    try { if (bridge.closed) throw new Error('CLI_BRIDGE_CLOSED'); if (authority.describe(subject).revision !== revision) throw new Error('CLI_GRANT_CHANGED'); authority.assertModel(subject, catalogProvider, catalogModel) }
    catch { fatal = new Error('CLI_GRANT_REVOKED'); void stop() }
  }, 100); grantGuard.unref()
  if (signal?.aborted) onAbort()
  const timer = setTimeout(() => { fatal = new Error('CLI_DEADLINE'); void stop() }, deadlineMs); timer.unref()
  try {
    const spawned = await supervisor.waitControl('spawned')
    await bridge.bind(spawned)
    await rpc('initialize', { clientInfo: { name: 'dsh_task_executor', title: 'DSH Task Executor', version: '0.0.0' }, capabilities: { experimentalApi: true } })
    await supervisor.send({ method: 'initialized', params: {} })
    profileEvidence = assertEffectiveProfile(await rpc('config/read', { cwd, includeLayers: false }), { requestedModel, bridge, home: join(home, 'b'), tools, settings })
    const result = await rpc('thread/start', { model: requestedModel, modelProvider: 'openai', allowProviderModelFallback: false, cwd, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true,
      ...(roleInstructions ? { developerInstructions: roleInstructions } : {}) })
    evidence.bindThread(result); threadId = result.thread.id
  } catch (error) { clearTimeout(timer); await stop(); error.bridgeEvidence = bridge.evidence; error.nativeError = supervisor.stderr.slice(-1024); throw error }
  return Object.freeze({
    home, entry, binding: Object.freeze({ ...binding }), operationId,
    async listModels() { return rpc('model/list', { includeHidden: false, limit: 100 }) },
    async listCapabilities() { return rpc('mcpServerStatus/list', { threadId, serverName: 'dsh_task', detail: 'toolsAndAuthOnly', limit: 100 }) },
    async callCapability(name, args = {}) {
      if (!tools.includes(name)) throw new Error('TOOL_DENIED')
      return rpc('mcpServer/tool/call', { threadId, server: 'dsh_task', tool: name, arguments: args })
    },
    async run(prompt) {
      if (!validText(prompt) || activeTurn || requestCount) throw new Error('INVALID_OR_REPEATED_CLI_TURN')
      authority.assertModel(subject, catalogProvider, catalogModel)
      authority.describe(subject)
      if (onBeforeRequest) await onBeforeRequest({ botId, ...binding, operationId, source: 'cli', toolId: 'codex', requestedModel, entry })
      if (closed || fatal) throw fatal ?? new Error('CLI_CLOSED')
      if (authority.describe(subject).revision !== revision) throw new Error('CLI_GRANT_CHANGED')
      authority.assertModel(subject, catalogProvider, catalogModel)
      activeTurn = true; requestCount++
      try {
        const completion = new Promise((resolve, reject) => {
          const listener = (_message, update) => { if (update.completed) { notifications.delete(listener); resolve(evidence.snapshot()) } }
          notifications.add(listener)
          supervisor.exit.then(() => { notifications.delete(listener); reject(fatal ?? new Error('CLI_EXITED_DURING_TURN')) })
        })
        completion.catch(() => {})
        await rpc('turn/start', { threadId, input: [{ type: 'text', text: prompt, text_elements: [] }], model: requestedModel })
        const result = await completion
        await usageWrites
        if (fatal) throw fatal
        return { ...result, status: result.terminal === 'completed' ? 'succeeded' : 'failed' }
      } finally { activeTurn = false }
    },
    async cancel() { clearTimeout(timer); return stop() },
    async close() { clearTimeout(timer); return stop() },
    snapshot() { return { ...evidence.snapshot(), cliTurnRequestsDispatched: requestCount,
      actualProviderRequestCount: requestCount ? null : 0, actualProviderRequestCountStatus: requestCount ? 'not-reported-by-cli' : 'no-turn-dispatched',
      process: rootProcess, stopEvidence, bridge: bridge.evidence, profile: profileEvidence,
      enforcement: 'application-scope-with-cli-read-only', capabilityProbe: { peer: probe.peer, supervisor: probe.supervisor, limitations: probe.limitations } } },
    get closed() { return closed },
  })
}
