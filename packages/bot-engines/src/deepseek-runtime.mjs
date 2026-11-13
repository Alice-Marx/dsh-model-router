/** Host-owned, metered DeepSeek ACP profile. It uses dsh's public native adapter,
 * one model request per outer turn, and the provider's actual usage counters. */
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, unlink, rmdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEEPSEEK_ACP_CONTEXT_WINDOW = 1_048_576
export const DEEPSEEK_ACP_MAX_OUTPUT = 4096
export const DEEPSEEK_ACP_MODELS = Object.freeze(['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro'])
const fail = code => { throw Object.assign(new Error(code), { code }) }
const file = (home, name) => join(home, '.dsh', name)
const count = value => Number.isSafeInteger(value) && value >= 0
function nativeModel(profile) {
  const model = profile?.model?.replace(/^deepseek-official\//, '')
  if (profile?.driver !== 'deepseekAgent' || profile.model !== `deepseek-official/${model}` || !DEEPSEEK_ACP_MODELS.includes(model)) fail('DEEPSEEK_MODEL_INVALID')
  return model
}
export const deepseekWireModel = model => {
  const native = nativeModel({ driver: 'deepseekAgent', model })
  return JSON.stringify(['deepseek-official', native])
}

// These are the exact shipped rc.2 row ids. The stream guard also refuses any
// tool schema and auxiliary purpose, so a newly introduced tool fails closed.
const disabled = ['tool-plugin-manager', 'plugin-manager', 'hmr', 'session-log-deepseek', 'session-title-llm',
  'plugin-package-inventory-deepseek', 'llm-retry', 'config-editor', 'settings', 'deepseek-account', 'llm-pi-ai',
  'session-telemetry-otel', 'tool-working-directory', 'tool-bash', 'tool-pwsh', 'tool-jobs', 'tool-fs', 'tool-fs-search',
  'agent-instructions', 'skill-filesystem', 'tool-skill', 'goal-round-driver', 'plan-mode', 'compaction-basic',
  'command-compact', 'subagent', 'agent-team', 'tool-agent-team', 'subagent-spawn-in-process', 'subagent-fork-in-process',
  'tool-subagent-control', 'tool-subagent', 'tool-subagent-fork', 'workflow-ptc', 'tool-workflow', 'tool-result-pruner',
  'image-offload', 'tool-todo', 'tool-goal', 'repeat-tool-reminder', 'web-search-deepseek', 'web-deepseek-api',
  'web-fetch-http', 'tool-web', 'mcp-resources', 'tool-executor-ptc', 'llm-deepseek-account', 'deepseek-llm-api-extensions']

/** The generated module imports only the pinned dsh installation's public SDK.
 * It does not rewrite frozen AgentLoop requests. Its native adapter metadata
 * resolves the current Host lease's output cap before dsh logs/prepares a call. */
function pluginSource(config, sdkUrl) {
  return `import { readFileSync, writeFileSync, renameSync } from 'node:fs'
const cfg = ${JSON.stringify(config)}
const sdk = await import(${JSON.stringify(sdkUrl)})
export const name = 'dsh-model-router-deepseek-meter'
export const inject = ['llm']
const failure = code => { throw Object.assign(new Error(code), { code }) }
const count = n => Number.isSafeInteger(n) && n >= 0
const read = path => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null } }
const permit = () => read(cfg.live) ?? read(cfg.spent)
const cap = () => { const p = permit(); return Number.isSafeInteger(p?.maxTokens) && p.maxTokens > 0 && p.maxTokens <= cfg.maxOutputTokens ? p.maxTokens : cfg.maxOutputTokens }
function save(value) { writeFileSync(cfg.audit + '.tmp', JSON.stringify(value), { mode: 0o600 }); renameSync(cfg.audit + '.tmp', cfg.audit) }
function usageOf(value) {
  if (!value || !count(value.inputTokens) || !count(value.outputTokens)) return null
  const result = { inputTokens: value.inputTokens, outputTokens: value.outputTokens }
  for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens']) if (count(value[key])) result[key] = value[key]
  return result
}
export function apply(ctx) {
  sdk.registerDeepSeekProvider(ctx, 'deepseek-official', {
    providerName: 'DeepSeek',
    options: () => sdk.resolveAdapterOptions({ baseURL: 'https://api.deepseek.com/anthropic', thinking: 'disabled', reasoningEffort: 'off',
      maxTokens: cap(), defaultContextWindow: ${DEEPSEEK_ACP_CONTEXT_WINDOW},
      models: [{ id: cfg.model, contextWindow: ${DEEPSEEK_ACP_CONTEXT_WINDOW}, inputModalities: ['text'] }],
      retryPolicy: { mode: 'normal', maxRetries: 0 }, streamIdleTimeoutMs: 30000 }),
    discoverModels: async () => [{ provider: 'deepseek-official', id: cfg.model, name: cfg.model, inputModalities: ['text'] }],
    resolveAuth: async () => {
      const key = await sdk.resolveDeepSeekApiKey(ctx, 'DEEPSEEK_API_KEY')
      if (typeof key !== 'string' || !key) failure('DEEPSEEK_CREDENTIAL_REQUIRED')
      return { headers: { 'x-api-key': key } }
    },
  })
  ctx.on('llm/stream', (options, next) => (async function* () {
    const lease = read(cfg.live)
    if (!lease || typeof lease.id !== 'string' || lease.expiresAt < Date.now()) failure('DEEPSEEK_TURN_LEASE_REQUIRED')
    if (options.provider !== 'deepseek-official' || options.model !== cfg.model || options.maxTokens !== lease.maxTokens
      || !Number.isSafeInteger(options.maxTokens) || options.maxTokens < 1 || options.maxTokens > cfg.maxOutputTokens
      || options.tools?.length || options.toolHistory && (options.toolHistory.tools?.length || options.toolHistory.updates?.length) || options.purpose !== undefined
      || options.reasoningEffort !== undefined && options.reasoningEffort !== 'off') failure('DEEPSEEK_TURN_BOUNDS_REFUSED')
    // Claim before the provider receives any request. No inner retry, extra
    // model step, title or compaction can consume a second call with this lease.
    renameSync(cfg.live, cfg.spent)
    const audit = { schemaVersion: 1, turnId: lease.id, provider: options.provider, model: options.model,
      maxTokens: options.maxTokens, dispatched: true, settled: false, usage: null, finish: null }
    save(audit)
    try {
      for await (const chunk of next()) {
        if (chunk.type === 'usage') { audit.usage = usageOf(chunk.usage); save(audit) }
        if (chunk.type === 'finish') { audit.finish = typeof chunk.reason === 'string' ? chunk.reason : chunk.reason?.kind ?? null; audit.settled = true; save(audit) }
        yield chunk
      }
    } finally { audit.settled = true; save(audit) }
  })())
}
`
}

/** Run once while provisioning a newly ACL-protected private native home.
 * A Node+script entry is required so imports resolve from the verified dsh
 * installation, never the user workspace's dependency tree. */
export async function provisionDeepSeekRuntime(home, profile) {
  if (!isAbsolute(home ?? '') || !isAbsolute(profile?.entry?.script ?? '')) fail('DEEPSEEK_NODE_ENTRY_REQUIRED')
  const model = nativeModel(profile)
  const maxOutputTokens = profile.maxOutputTokens ?? DEEPSEEK_ACP_MAX_OUTPUT
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > DEEPSEEK_ACP_MAX_OUTPUT) fail('DEEPSEEK_OUTPUT_BOUND_INVALID')
  const require = createRequire(profile.entry.script)
  let sdkUrl
  try {
    const manifest = JSON.parse(await readFile(require.resolve('@deepseek-ai/dsh-llm-deepseek/package.json'), 'utf8'))
    if (manifest.version !== '0.2.2-rc.2') fail('DEEPSEEK_SDK_VERSION_UNSUPPORTED')
    sdkUrl = pathToFileURL(require.resolve('@deepseek-ai/dsh-llm-deepseek')).href
  } catch (error) {
    if (error.code === 'DEEPSEEK_SDK_VERSION_UNSUPPORTED') throw error
    fail('DEEPSEEK_NATIVE_SDK_REQUIRED')
  }
  const root = file(home, ''), permit = file(home, 'turn-permit')
  await mkdir(root, { recursive: true, mode: 0o700 })
  const config = { schemaVersion: 1, model, maxOutputTokens, live: join(permit, 'live.json'), spent: join(permit, 'spent.json'), audit: file(home, 'turn-audit.json') }
  const modulePath = file(home, 'deepseek-meter.mjs')
  await writeFile(modulePath, pluginSource(config, sdkUrl), { flag: 'wx', mode: 0o600 })
  const patch = [...disabled.map(id => ({ id, disabled: true })),
    { id: 'llm-deepseek', disabled: true },
    { insert: [{ id: 'dsh-model-router-deepseek-meter', name: pathToFileURL(modulePath).href }] },
    { id: 'acp', config: { provider: 'deepseek-official', model } },
    { id: 'agent-default-model', config: { provider: 'deepseek-official', model } }]
  // JSON is a YAML subset, and carries no evaluable text from user/model input.
  await writeFile(file(home, 'cordis.patch.yml'), JSON.stringify(patch, null, 2), { flag: 'wx', mode: 0o600 })
  await writeFile(file(home, 'meter-config.json'), JSON.stringify(config), { flag: 'wx', mode: 0o600 })
  return { env: { DSH_HOME: root, DSH_TELEMETRY_DISABLED: '1' }, args: ['--profile', 'acp'], wireModel: deepseekWireModel(profile.model) }
}

/** Called only after the outer engine has reserved its turn slot. */
export async function prepareDeepSeekTurn(home, { maxTokens } = {}) {
  const config = JSON.parse(await readFile(file(home, 'meter-config.json'), 'utf8'))
  maxTokens ??= config.maxOutputTokens
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > config.maxOutputTokens) fail('DEEPSEEK_OUTPUT_BOUND_INVALID')
  const root = file(home, 'turn-permit')
  try { await mkdir(root, { mode: 0o700 }) } catch (error) { if (error.code === 'EEXIST') fail('DEEPSEEK_TURN_BUSY'); throw error }
  await unlink(file(home, 'turn-audit.json')).catch(error => { if (error.code !== 'ENOENT') throw error })
  const id = randomUUID()
  await writeFile(join(root, 'live.json'), JSON.stringify({ id, maxTokens, expiresAt: Date.now() + 7_200_000 }), { flag: 'wx', mode: 0o600 })
  return { id, maxTokens }
}

/** Read after ACP prompt/stop settlement. Unknown usage stays null. Finishes
 * the one-shot lease even if admission failed before a model was dispatched. */
export async function readDeepSeekUsage(home) {
  const root = file(home, 'turn-permit')
  const read = async path => { try { const raw = await readFile(path, 'utf8'); if (raw.length > 8192) return null; return JSON.parse(raw) } catch { return null } }
  const lease = await read(join(root, 'spent.json')) ?? await read(join(root, 'live.json'))
  const audit = await read(file(home, 'turn-audit.json'))
  // Flat, known-file cleanup only. Never recurse through a CLI-writable home.
  for (const name of ['live.json', 'spent.json']) await unlink(join(root, name)).catch(error => { if (error.code !== 'ENOENT') throw error })
  await rmdir(root).catch(error => { if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error })
  if (!lease || !audit || audit.turnId !== lease.id || !audit.dispatched || !audit.usage
    || !count(audit.usage.inputTokens) || !count(audit.usage.outputTokens)) return null
  // dsh TokenUsage inputTokens is UNCACHED input; keep the counts disjoint.
  return { input: audit.usage.inputTokens, output: audit.usage.outputTokens,
    ...(count(audit.usage.cacheReadTokens) ? { cachedInput: audit.usage.cacheReadTokens } : {}),
    ...(count(audit.usage.cacheWriteTokens) ? { cacheWrite: audit.usage.cacheWriteTokens } : {}) }
}
