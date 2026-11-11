#!/usr/bin/env node
// Offline fixture host for the Claude retained-session LLM bridge tests.
//
// What is real here and what is not:
//   - REAL: the installed Cordis + the installed `@deepseek-ai/dsh-llm` `LlmRuntime`
//     (registerAdapter / prepareCall / stream / the `llm/stream` waterfall), the real
//     `createClaudeEngine` from packages/bot-engines, the real capability-broker
//     authority, and — in the native spec — the real PowerShell native-peer
//     supervisor driving a real Node child process (tests/fixtures/bot-engine-claude-fixture.mjs).
//   - OFFLINE: the model transport. The "provider" is a retained local CLI session
//     driven by that fixture child; no network, no credentials, no claude CLI.
//
// The trusted Host surface the bridge requires is assembled here exactly as a Host
// composition would: a committed authority subject, a committed model route, a
// digest-pinned entry, isolated absolute directories, and an `identityFor` resolver
// that reads Host state. Nothing in that surface is derived from a model request.

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'

import { createAuthority } from '../../packages/capability-broker/src/authority.mjs'

const ISOLATED = fileURLToPath(new URL('../../tmp/integration/bot-engine-llm/', import.meta.url))

export const FIXTURE_CLI = fileURLToPath(new URL('./bot-engine-claude-fixture.mjs', import.meta.url))

/** Real Cordis + real installed LlmRuntime. The bridge is registered by the caller. */
export async function attachLlmRuntime() {
  const root = new Context()
  let service = null, scope = null
  const fork = await root.plugin(ctx => { scope = ctx; service = new LlmRuntime(ctx) })
  return { service, scope, dispose: () => fork.dispose() }
}

/**
 * The trusted Host state one bridge test runs against.
 *
 * @param {object} options
 * @param {string} [options.provider] the one route id this bridge serves
 * @param {string} [options.model] the one exact committed model id
 * @param {string} [options.funding] 'subscription' (the only open kind) or anything else to prove the refusal
 * @param {Function} [options.fundingFor] trusted committed-funding read
 * @param {Function} [options.identityFor] trusted identity resolver (default: the local committed subject)
 * @param {Function} [options.engineFactory] test seam; the default is the real createClaudeEngine
 * @param {object} [options.launcher] process-launcher seam (tests may substitute)
 * @param {object} [options.route] extra createClaudeEngine route fields (tools, handlers, permissionMode…)
 * @param {string[]} [options.tools] committed grant tool names for the subject
 */
export async function createBridgeHost(options = {}) {
  const provider = options.provider ?? 'claude-session'
  const model = options.model ?? 'fixture-model-a'
  await mkdir(ISOLATED, { recursive: true })
  const root = await mkdtemp(join(ISOLATED, 'host-'))
  await mkdir(join(root, 'ws'), { recursive: true })
  const workspace = await realpath(join(root, 'ws'))
  const runtimeRoot = join(root, 'runtime')
  const home = join(root, 'home')
  await mkdir(home, { recursive: true })

  const authority = createAuthority()
  const subject = {}
  authority.register(subject, { botId: options.botId ?? 'bot-a', tools: options.tools ?? ['read_notes'], modelRoutes: [{ provider, model }] })
  const entry = {
    executable: process.execPath,
    sha256: createHash('sha256').update(await readFile(process.execPath)).digest('hex'),
    version: process.versions.node,
    script: FIXTURE_CLI,
    scriptSha256: createHash('sha256').update(await readFile(FIXTURE_CLI)).digest('hex'),
  }

  const defaultIdentity = {
    subject,
    botId: options.botId ?? 'bot-a',
    authority,
    binding: { taskId: 'task-a', attemptId: 'att-a', machineId: 'mach-local', workspaceId: 'wsid-a', location: 'local' },
    persona: options.persona ?? null,
  }
  const holder = { identity: defaultIdentity }
  const host = {
    provider, model, root, workspace, runtimeRoot, home, entry, authority, subject,
    identity: defaultIdentity,
    identityFor: () => holder.identity,
    setIdentity: next => { holder.identity = next },
    fundingFor: options.fundingFor ?? null,
    engineFactory: options.engineFactory ?? null,
    launcher: options.launcher ?? null,
    route: options.route ?? {},
    funding: options.funding ?? 'subscription',
  }
  return host
}

/** Bridge constructor options assembled from trusted Host state only. */
export function bridgeOptions(host, overrides = {}) {
  const options = {
    provider: host.provider,
    model: host.model,
    funding: host.funding,
    entry: host.entry,
    runtimeRoot: host.runtimeRoot,
    workspace: host.workspace,
    identityFor: host.identityFor,
    ...(host.fundingFor ? { fundingFor: host.fundingFor } : {}),
    ...(host.engineFactory ? { engineFactory: host.engineFactory } : {}),
    ...(host.launcher ? { launcher: host.launcher } : {}),
    ...host.route,
    ...overrides,
  }
  return options
}

/** One plain text user message in the SDK request vocabulary. */
export const userMessage = (text, id = null) => (id === null
  ? { role: 'user', content: [{ type: 'text', text }] }
  : { id, role: 'user', content: [{ type: 'text', text }] })

/** One assistant message carrying this route's own provenance, as the loop echoes a reply. */
export const ownAssistant = (text, id, provider, model) => ({
  id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider, model },
})

/** A leading system message carrying the Host-confirmed persona, as the loop builds one. */
export const systemMessage = (text, id = `system-${createHash('sha256').update(text).digest('hex')}`) => ({
  id, role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text }],
})

/**
 * The parent's own money authority around one bridge turn: a real SQLite router state,
 * the real `createModelAccounting`, and the real prepared dispatch the product uses.
 * Only the funding policy is a fixture — every admission, receipt and reservation is the
 * product's code, so the bridge cannot issue a second receipt without this seeing it.
 *
 * @param {Function} run `({call, receipts, runs}) => Promise<void>`
 */
export async function withClaudeAccounting(run, { funding = { funding: 'subscription' } } = {}) {
  const { createRequire } = await import('node:module')
  const Database = createRequire(import.meta.url)('better-sqlite3')
  const { openSqliteRouterState } = await import('../../packages/orchestration/src/sqlite-router-state.mjs')
  const { createModelAccounting } = await import('../../packages/orchestration/src/model-accounting.mjs')
  const { createRouterState } = await import('../../.dsh-plugin/shared/router-state.mjs')
  const home = await mkdtemp(join(ISOLATED, 'money-'))
  const legacyFile = join(home, 'legacy.json')
  const legacy = createRouterState({ file: legacyFile, lockStaleMs: 1 })
  const NOW = 1_700_000_000_000
  await legacy.appendRun({ id: 'seed', createdAt: NOW, finishedAt: NOW, kind: 'assign', status: 'completed', packages: [], reviews: [] })
  const storageFile = join(home, 'orchestration.sqlite')
  const store = await openSqliteRouterState({ Database, file: storageFile, legacyFile, now: () => NOW })
  const authority = createAuthority()
  const subject = {}
  authority.register(subject, { botId: 'bot-money', tools: ['model/infer'], modelRoutes: [{ provider: 'claude-session', model: 'fixture-model-a' }] })
  const accounting = createModelAccounting({
    store, authority,
    pricingFor: async () => ({ funding: funding.funding, route: { provider: 'claude-session', model: 'fixture-model-a' } }),
    machineId: 'machine-1', workspaceId: 'ws-1', now: () => NOW, limits: { dailyLimitUsd: 0, monthlyLimitUsd: 0 }, maxActive: 4,
  })
  const identity = Object.freeze({ subject, botId: 'bot-money', source: 'bot' })
  const db = new Database(storageFile, { readonly: true })
  const harness = {
    store, authority, subject, accounting, identity,
    call: async request => {
      const seen = []
      for await (const chunk of accounting.stream(request, () => harness.llm.stream(request), identity)) seen.push(chunk)
      return seen
    },
    receipts: async () => (await store.modelCalls({ after: 0, limit: 100 })).items,
    runs: () => db.prepare('SELECT payload FROM router_runs ORDER BY rowid').all().map(row => JSON.parse(row.payload)).filter(run => run.id !== 'seed'),
    dispose: async () => { db.close(); await accounting.close(); store.close() },
  }
  try { return await run(harness) } finally { await harness.dispose() }
}
