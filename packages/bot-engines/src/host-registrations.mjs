import { isAbsolute, join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { createClaudeLlmAdapter } from './claude-llm-adapter.mjs'
import { createClaudeEngine } from './claude-engine.mjs'
import { createAcpChatEngine } from './acp-chat-engine.mjs'
import { createCodexEngine } from './codex-engine.mjs'
import { createPiEngine } from './pi-engine.mjs'
import { createStepEngine } from './step-engine.mjs'
import { createMuseEngine } from './muse-engine.mjs'
import { cliDriver } from './cli-driver-specs.mjs'
import { normalizeCliCredential, provisionCliCredential } from './cli-credentials.mjs'
import { deepseekWireModel } from './deepseek-runtime.mjs'

const fail = code => { throw Object.assign(new Error(code), { code }) }
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const keys = (value, names) => { if (!plain(value) || Object.keys(value).some(key => !names.includes(key))) fail('CONVERSATION_ENGINE_CONFIG_INVALID') }
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

/** Host configuration, never a Bot binding or model/request payload. */
export function normalizeConversationEngines(value = []) {
  if (!Array.isArray(value) || value.length > 64) fail('CONVERSATION_ENGINE_CONFIG_INVALID')
  const profiles = value.map(item => {
    keys(item, ['id', 'revision', 'driver', 'provider', 'model', 'name', 'entry', 'credentialRef', 'deadlineMs', 'hostTools'])
    const driver = cliDriver(item.driver)
    if (!id(item.id) || !driver?.implemented || driver.available === false || !id(item.provider)
      || typeof item.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,239}$/.test(item.model)
      || item.revision !== undefined && (!Number.isSafeInteger(item.revision) || item.revision < 1)) fail('CONVERSATION_ENGINE_CONFIG_INVALID')
    keys(item.entry, ['executable', 'sha256', 'version', 'script', 'scriptSha256', 'harness', 'harnessSha256'])
    const entry = item.entry
    if (!isAbsolute(entry.executable ?? '') || !hash(entry.sha256) || typeof entry.version !== 'string'
      || !/^[0-9][A-Za-z0-9.+_-]{0,31}$/.test(entry.version)) fail('CONVERSATION_ENGINE_ENTRY_INVALID')
    if (entry.script !== undefined && (!isAbsolute(entry.script) || !hash(entry.scriptSha256))
      || entry.script === undefined && entry.scriptSha256 !== undefined) fail('CONVERSATION_ENGINE_ENTRY_INVALID')
    if (item.driver === 'antigravityAgent' ? (!isAbsolute(entry.harness ?? '') || !hash(entry.harnessSha256) || Boolean(entry.script))
      : entry.harness !== undefined || entry.harnessSha256 !== undefined) fail('CONVERSATION_ENGINE_ENTRY_INVALID')
    if (item.driver === 'deepseekAgent') { deepseekWireModel(item.model); if (!entry.script || entry.version !== '0.2.2-rc.2') fail('DEEPSEEK_NODE_ENTRY_REQUIRED') }
    if (typeof item.credentialRef !== 'string' || !/^(?:ds-secret|cli-secret)\/[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(item.credentialRef)) fail('CONVERSATION_ENGINE_CREDENTIAL_REF_INVALID')
    const deadlineMs = item.deadlineMs ?? 1_800_000
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1000 || deadlineMs > 7_200_000) fail('CONVERSATION_ENGINE_DEADLINE_INVALID')
    if (item.name !== undefined && (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 128)) fail('CONVERSATION_ENGINE_CONFIG_INVALID')
    if (item.hostTools !== undefined && typeof item.hostTools !== 'boolean') fail('CONVERSATION_ENGINE_CONFIG_INVALID')
    if (item.hostTools && item.driver !== 'claude') fail('CONVERSATION_ENGINE_TOOL_DRIVER_UNSUPPORTED')
    return Object.freeze({ id: item.id, driver: item.driver, provider: item.provider, model: item.model,
      ...(item.revision ? { revision: item.revision } : {}), name: item.name ?? `${driver.name}（订阅会话）`, entry: Object.freeze({ ...entry }), credentialRef: item.credentialRef, deadlineMs,
      hostTools: item.hostTools === true })
  })
  for (const field of ['id', 'provider']) if (new Set(profiles.map(profile => profile[field])).size !== profiles.length) fail('CONVERSATION_ENGINE_DUPLICATE')
  return Object.freeze(profiles)
}

/** Copy an explicitly selected Host-only opaque CLI credential into a private home.
 * No ambient account discovery, model arguments or credentials enter argv/catalogs.
 */
export function validateClaudeProfileCredential(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 128_000) fail('CONVERSATION_ENGINE_CREDENTIAL_INVALID')
  let parsed
  try { parsed = JSON.parse(value) } catch { fail('CONVERSATION_ENGINE_CREDENTIAL_INVALID') }
  if (!plain(parsed) || !Object.keys(parsed).length) fail('CONVERSATION_ENGINE_CREDENTIAL_INVALID')
  return value
}

export const validateConversationCredential = (profile, value) => profile.driver === 'claude' && profile.credentialRef.startsWith('ds-secret/')
  ? validateClaudeProfileCredential(value) : normalizeCliCredential(profile.driver, value)

export async function provisionClaudeProfile(home, profile, resolveSecret) {
  if (!isAbsolute(home ?? '') || typeof resolveSecret !== 'function') fail('CONVERSATION_ENGINE_CREDENTIAL_UNAVAILABLE')
  const value = validateClaudeProfileCredential(await resolveSecret(profile.credentialRef, profile))
  const dir = join(home, '.claude')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await writeFile(join(dir, '.credentials.json'), value, { mode: 0o600 })
}

/** Mount explicitly configured text-only routes into the Host's public model catalog.
 * Registration starts no native process; the existing model waterfall owns all money.
 */
export async function mountConversationEngines({ llm, profiles = [], runtimeRoot, identityFor, fundingFor, resolveSecret, requestFor, toolsFor, onActivity, onResult } = {}) {
  const registrations = []
  let closed = false, pending = Promise.resolve()
  if (profiles.length && (typeof llm?.registerAdapter !== 'function' || !isAbsolute(runtimeRoot ?? '')
    || typeof identityFor !== 'function' || typeof fundingFor !== 'function' || typeof resolveSecret !== 'function')) fail('CONVERSATION_ENGINE_HOST_REQUIRED')
  const close = async () => {
    closed = true
    await pending.catch(() => {})
    const failures = []
    for (const item of registrations.splice(0).reverse()) {
      try { await item.adapter.close() } catch (error) { failures.push(error) }
      try { item.release() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'CONVERSATION_ENGINE_CLOSE_FAILED')
  }
  const add = async profile => {
      if (profile.hostTools && typeof toolsFor !== 'function') fail('CONVERSATION_ENGINE_TOOL_HOST_REQUIRED')
      const createEngine = profile.driver === 'claude' ? createClaudeEngine : profile.driver === 'codex' ? createCodexEngine : profile.driver === 'pi' ? createPiEngine
        : profile.driver === 'stepAgent' ? createStepEngine
        : profile.driver === 'museCode' ? createMuseEngine : options => createAcpChatEngine(profile, options)
      const engineFactory = async options => {
        const engine = await createEngine(options)
        return Object.freeze({ ...engine, get closed() { return engine.closed }, get busy() { return engine.busy },
          async submitTurn(input) {
            try { const result = await engine.submitTurn(input); onResult?.(profile, { kind: result.ok && result.outcome === 'succeeded' ? 'verified' : 'error' }); return result }
            catch (error) { onResult?.(profile, { kind: 'error' }); throw error }
          } })
      }
      const adapter = createClaudeLlmAdapter({ provider: profile.provider, model: profile.model, name: profile.name,
        nativeSession: profile.driver !== 'claude',
        funding: profile.driver === 'deepseekAgent' ? 'api' : 'subscription', fundingFor: route => fundingFor(profile, route),
        ...(profile.driver === 'deepseekAgent' ? { metered: { contextWindow: 1_048_576, maxOutputTokens: 4096 } } : {}),
        entry: profile.entry, runtimeRoot: join(runtimeRoot, profile.id), deadlineMs: profile.deadlineMs,
        workspaceFor: async () => join(runtimeRoot, profile.id, 'workspace'),
        identityFor: route => identityFor(profile, route),
        ...(requestFor ? { requestFor: (request, identity) => requestFor(profile, request, identity) } : {}),
        ...(profile.hostTools ? { toolsFor: identity => toolsFor(profile, identity) } : {}),
        ...(onActivity ? { onActivity: event => onActivity(profile, event) } : {}),
        provisionCredentials: (home, identity) => (profile.driver === 'claude' && profile.credentialRef.startsWith('ds-secret/') ? provisionClaudeProfile : provisionCliCredential)(home, profile, (ref, current) => resolveSecret(ref, current, identity)),
        engineFactory,
        tools: [], handlers: [], permissionMode: 'default' })
      await mkdir(join(runtimeRoot, profile.id, 'workspace'), { recursive: true, mode: 0o700 })
      try {
        const release = llm.registerAdapter([profile.provider], adapter)
        registrations.push({ profileId: profile.id, profile, adapter, release })
      } catch (error) { await adapter.close(); throw error }
  }
  try { for (const profile of profiles) await add(profile) } catch (error) { await close(); throw error }
  const reconcile = next => {
    const run = pending.then(async () => {
      if (closed) fail('CONVERSATION_ENGINE_CLOSED')
      const normalized = normalizeConversationEngines(next)
      for (const item of [...registrations]) {
        const replacement = normalized.find(profile => profile.id === item.profileId)
        if (replacement && JSON.stringify(replacement) === JSON.stringify(item.profile)) continue
        item.release(); registrations.splice(registrations.indexOf(item), 1); await item.adapter.close()
      }
      for (const profile of normalized) if (!registrations.some(item => item.profileId === profile.id)) await add(profile)
      profiles = normalized
    })
    pending = run.catch(() => {}); return run
  }
  return Object.freeze({ close, reconcile,
    activityHealth: () => ({ failures: registrations.reduce((total, item) => total + (item.adapter.snapshot().activityObserverFailures ?? 0), 0) }),
    invalidateBot: (profileId, botId, reason) => registrations.find(item => item.profileId === profileId)?.adapter.invalidateBot(botId, reason),
    async retireBot(botId, reason = 'new-conversation') {
      const retired = await Promise.all(registrations.map(item => item.adapter.invalidateBot(botId, reason)))
      const count = retired.reduce((total, item) => total + item.retired, 0), evidence = retired.flatMap(item => item.evidence)
      if (count === 0) return { notStarted: true, possiblyApplied: false }
      if (evidence.length !== count || evidence.some(item => !item || item.possiblyApplied === true || item.status === 'unknown'
        || !(item.treeStopped === true || item.notStarted === true && item.possiblyApplied === false))) return { status: 'unknown', treeStopped: false }
      return evidence.every(item => item.notStarted === true) ? { notStarted: true, possiblyApplied: false } : { treeStopped: true }
    },
    catalog: () => profiles.map(profile => ({ id: profile.id, driver: profile.driver, provider: profile.provider,
      model: profile.model, name: profile.name, funding: profile.driver === 'deepseekAgent' ? 'api' : 'subscription', input: 'text', hostTools: profile.hostTools, status: 'configured' })) })
}

