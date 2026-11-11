import { isAbsolute, join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { createClaudeLlmAdapter } from './claude-llm-adapter.mjs'

const fail = code => { throw Object.assign(new Error(code), { code }) }
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const keys = (value, names) => { if (!plain(value) || Object.keys(value).some(key => !names.includes(key))) fail('CONVERSATION_ENGINE_CONFIG_INVALID') }
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

/** Host configuration, never a Bot binding or model/request payload. */
export function normalizeConversationEngines(value = []) {
  if (!Array.isArray(value) || value.length > 32) fail('CONVERSATION_ENGINE_CONFIG_INVALID')
  const profiles = value.map(item => {
    keys(item, ['id', 'driver', 'provider', 'model', 'name', 'entry', 'credentialRef', 'deadlineMs', 'hostTools'])
    if (!id(item.id) || item.driver !== 'claude' || !id(item.provider)
      || typeof item.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(item.model)) fail('CONVERSATION_ENGINE_CONFIG_INVALID')
    keys(item.entry, ['executable', 'sha256', 'version', 'script', 'scriptSha256'])
    const entry = item.entry
    if (!isAbsolute(entry.executable ?? '') || !hash(entry.sha256) || typeof entry.version !== 'string'
      || !/^[0-9][A-Za-z0-9.+_-]{0,31}$/.test(entry.version)) fail('CONVERSATION_ENGINE_ENTRY_INVALID')
    if (entry.script !== undefined && (!isAbsolute(entry.script) || !hash(entry.scriptSha256))
      || entry.script === undefined && entry.scriptSha256 !== undefined) fail('CONVERSATION_ENGINE_ENTRY_INVALID')
    if (typeof item.credentialRef !== 'string' || !/^ds-secret\/[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(item.credentialRef)) fail('CONVERSATION_ENGINE_CREDENTIAL_REF_INVALID')
    const deadlineMs = item.deadlineMs ?? 1_800_000
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1000 || deadlineMs > 7_200_000) fail('CONVERSATION_ENGINE_DEADLINE_INVALID')
    if (item.name !== undefined && (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 128)) fail('CONVERSATION_ENGINE_CONFIG_INVALID')
    if (item.hostTools !== undefined && typeof item.hostTools !== 'boolean') fail('CONVERSATION_ENGINE_CONFIG_INVALID')
    return Object.freeze({ id: item.id, driver: item.driver, provider: item.provider, model: item.model,
      name: item.name ?? 'Claude（订阅会话）', entry: Object.freeze({ ...entry }), credentialRef: item.credentialRef, deadlineMs,
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
export async function mountConversationEngines({ llm, profiles = [], runtimeRoot, identityFor, fundingFor, resolveSecret, requestFor, toolsFor, onActivity } = {}) {
  const registrations = []
  if (profiles.length && (typeof llm?.registerAdapter !== 'function' || !isAbsolute(runtimeRoot ?? '')
    || typeof identityFor !== 'function' || typeof fundingFor !== 'function' || typeof resolveSecret !== 'function')) fail('CONVERSATION_ENGINE_HOST_REQUIRED')
  const close = async () => {
    const failures = []
    for (const item of registrations.splice(0).reverse()) {
      try { await item.adapter.close() } catch (error) { failures.push(error) }
      try { item.release() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'CONVERSATION_ENGINE_CLOSE_FAILED')
  }
  try {
    for (const profile of profiles) {
      if (profile.hostTools && typeof toolsFor !== 'function') fail('CONVERSATION_ENGINE_TOOL_HOST_REQUIRED')
      const adapter = createClaudeLlmAdapter({ provider: profile.provider, model: profile.model, name: profile.name,
        funding: 'subscription', fundingFor: route => fundingFor(profile, route),
        entry: profile.entry, runtimeRoot: join(runtimeRoot, profile.id), deadlineMs: profile.deadlineMs,
        workspaceFor: async () => join(runtimeRoot, profile.id, 'workspace'),
        identityFor: route => identityFor(profile, route),
        ...(requestFor ? { requestFor: (request, identity) => requestFor(profile, request, identity) } : {}),
        ...(profile.hostTools ? { toolsFor: identity => toolsFor(profile, identity) } : {}),
        ...(onActivity ? { onActivity: event => onActivity(profile, event) } : {}),
        provisionCredentials: (home, identity) => provisionClaudeProfile(home, profile, (ref, current) => resolveSecret(ref, current, identity)),
        tools: [], handlers: [], permissionMode: 'default' })
      await mkdir(join(runtimeRoot, profile.id, 'workspace'), { recursive: true, mode: 0o700 })
      try {
        const release = llm.registerAdapter([profile.provider], adapter)
        registrations.push({ profileId: profile.id, adapter, release })
      } catch (error) { await adapter.close(); throw error }
    }
  } catch (error) { await close(); throw error }
  return Object.freeze({ close,
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
      model: profile.model, name: profile.name, funding: 'subscription', input: 'text', hostTools: profile.hostTools, status: 'configured' })) })
}

