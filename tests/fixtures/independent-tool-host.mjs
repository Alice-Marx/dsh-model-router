import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import Database from 'better-sqlite3'
import { createAuthority } from '../../packages/capability-broker/src/authority.mjs'
import { createPrincipalDirectory } from '../../packages/orchestration/src/principals.mjs'
import { openRemoteMachines } from '../../packages/orchestration/src/remote-machines.mjs'
import { openTaskJournal } from '../../packages/orchestration/src/task-journal.mjs'
import { createTaskService } from '../../packages/orchestration/src/task-service.mjs'
import { createRemoteWriteBackend } from '../../packages/orchestration/src/remote-execution.mjs'
import { createRemoteCommandBackend } from '../../packages/orchestration/src/remote-command-execution.mjs'
import { createIndependentToolHost } from '../../packages/orchestration/src/independent-tool-host.mjs'
import { createBotLoop } from '../../packages/orchestration/src/bot-loop.mjs'
import { openBotSessionStore } from '../../packages/orchestration/src/bot-session-store.mjs'
import { collectAnswer } from '../../packages/orchestration/src/bot-independent-stream.mjs'

const require_ = createRequire(import.meta.url)
const { Agent, serve } = await import('../../remote-computer-agent/dist/index.mjs')

// A real Host tool chain for one independent Bot, offline.
//
// Everything that owns authority here is the real thing: the real remote-computer-agent (its own
// SQLite operation journal, its own workspace admissions, its own fs_write chain) served over a real
// Noise/HTTP transport on loopback, the real machine directory, the real principal directory and
// capability authority, the real task journal over real SQLite, the real task service with the real
// remote-write and remote-command backends, and the real independent loop over a real session store.
// The only seam is the model itself: the provider below is fed the Host's own chunk vocabulary
// through the same `collectAnswer` reader the production path uses, so a tool call only ever runs
// because a real `tool-call-delta` chunk asked for it.

export const MACHINE_TOOLS = Object.freeze([
  'machine_ping', 'fs_list', 'fs_read', 'fs_write', 'container_command_v1',
  'operation_status', 'operation_cancel', 'artifact_stat', 'artifact_read',
])

export const GRANTS = Object.freeze([
  ...MACHINE_TOOLS.map(tool => `remote/${tool}`),
  'task/submit', 'task/execute', 'task/read', 'task/cancel',
])

export const ANSWER = Object.freeze([
  { type: 'text-delta', index: 0, text: 'done' },
  { type: 'finish', reason: { kind: 'stop' } },
])

export const askTool = (name, args, id = 'call-1', text = 'working') => Object.freeze([
  { type: 'text-delta', index: 0, text },
  { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: JSON.stringify(args) },
  { type: 'finish', reason: { kind: 'tool-calls' } },
])

const chunks = list => (async function* generate() { for (const chunk of list) yield chunk })()

/**
 * A real remote computer: the real agent, its own workspace root, its own durable operation journal,
 * served over a real Noise/HTTP transport on loopback. Offline, and no credentials of a user's.
 *
 * @param {import('node:test').TestContext} t
 * @param {{ tools?: string[], roots?: string[] }} options
 */
export async function startFixtureAgent(t, { tools = MACHINE_TOOLS, roots = ['project'], botIds = ['bot-a', 'bot-b'], agentConfig = {} } = {}) {
  const parent = resolve(import.meta.dirname, '../../tmp/integration/independent-tools')
  await mkdir(parent, { recursive: true })
  const dir = await mkdtemp(join(parent, 'agent-'))
  const workspace = join(dir, 'workspace')
  await mkdir(workspace, { recursive: true })
  for (const root of roots) await mkdir(join(workspace, root), { recursive: true })
  const agent = new Agent({ ...agentConfig, dataDir: join(dir, 'agent'), roots: Object.fromEntries(roots.map(root => [root, join(workspace, root)])) }, Database)
  const server = await serve(agent, { mode: 'e2e', port: 0 })
  const credential = agent.store.pair('host-a', { botIds, roots, tools: [...tools] })
  return {
    agent, server, workspace, dir, credential, roots: [...roots], tools: [...tools],
    machineId: agent.store.machineId,
    endpoint: `http://127.0.0.1:${server.address.port}`,
    /** What the remote agent actually did, from its own durable journal. */
    operations: () => agent.store.db.prepare('SELECT * FROM operations ORDER BY rowid').all(),
    audits: code => agent.store.db.prepare('SELECT * FROM audit WHERE code=? ORDER BY id').all(code),
    grants: () => agent.store.db.prepare('SELECT context FROM grants').all().map(row => JSON.parse(row.context)),
    /** The absolute path of one of the agent's roots, optionally with a relative path inside it. */
    rootOf: (...parts) => join(workspace, ...parts),
    /** Closing is the caller's job, so a caller can close in its own order. */
    close: async () => { await server.close(); await agent.browser.close(); await agent.desktop.close(); agent.store.close() },
  }
}

/**
 * @param {import('node:test').TestContext} t
 * @param {{ script?: Array<object[] | ((request: object, index: number) => object[] | Promise<object[]>)>,
 *   backends?: string[], grants?: string[], roots?: string[], writeMode?: 'read-only' | 'workspace-write' }} options
 */
export async function bootToolHost(t, { script = [], backends = ['remote-write', 'remote-command'], grants = GRANTS, roots = ['project'], writeMode = 'workspace-write', recordCalls = false, issuedLimit } = {}) {  const parent = resolve(import.meta.dirname, '../../tmp/integration/independent-tools')
  await mkdir(parent, { recursive: true })
  const dir = await mkdtemp(join(parent, 'case-'))

  // Everything opened is closed again, even when a case fails halfway: a Host left holding a lease,
  // a socket or a SQLite handle would outlive the test that opened it.
  const closers = []
  t.after(async () => {
    for (const close of closers.reverse()) { try { await close() } catch { /* already closed */ } }
  })

  // The real remote agent, with a real workspace root and a real durable operation journal.
  const fixture = await startFixtureAgent(t, { roots })
  closers.push(() => fixture.close())
  const { agent, credential, endpoint, workspace } = fixture
  const authority = createAuthority()
  const directory = createPrincipalDirectory(authority)
  directory.register('bot-a', { tools: grants, modelRoutes: [] })
  directory.register('bot-b', { tools: grants, modelRoutes: [] })
  const owner = { kind: 'owner', peer: { principal: { kind: 'owner' } }, clientOrigin: 'http://127.0.0.1' }
  const machines = openRemoteMachines({
    Database, file: join(dir, 'machines.sqlite'), authority,
    resolveSecret: async () => credential.token, botExists: id => id === 'bot-a' || id === 'bot-b',
    desktopProxy: null, desktopHttp: null, now: () => Date.now(),
  })
  closers.push(() => machines.close())
  await machines.pair({
    machineId: agent.store.machineId, clientId: 'host-a', name: 'Fixture computer', endpoint,
    transport: agent.store.pairing.identity(), secretRef: 'ds-secret/REMOTE_AGENT_FIXTURE',
    roots, tools: [...MACHINE_TOOLS], probeBotId: 'bot-a', expectedRevision: 0,
  }, owner)
  await machines.bind({
    machineId: agent.store.machineId, botId: 'bot-a', roots, tools: [...MACHINE_TOOLS], mode: writeMode, expectedRevision: 0,
  }, owner)

  // One durable Task authority over one SQLite journal, with the real remote backends.
  const journal = openTaskJournal(Database, join(dir, 'tasks.sqlite'))
  const taskService = createTaskService({
    journal, authority, directory,
    backends: [
      createRemoteWriteBackend({ machines: () => machines, directory }),
      createRemoteCommandBackend({ machines: () => machines, directory }),
    ],
    concurrencyFor: () => 1,
  })
  taskService.start()

  // The machine directory is frozen; a case that wants to see what crossed the boundary gets a
  // wrapper the host is handed instead.
  const machineCalls = []
  const machineService = recordCalls
    ? Object.freeze({ ...machines, call: (subject, input, options) => { machineCalls.push(input); return machines.call(subject, input, options) } })
    : machines
  const host = createIndependentToolHost({
    directory, authority, machines: () => machineService, taskService: () => taskService, backends, now: () => Date.now(),
    ...(issuedLimit === undefined ? {} : { issuedLimit }),
  })
  // The real loop, with the model as the only seam.
  const store = openBotSessionStore({ dir: join(dir, 'sessions'), now: () => Date.now() })
  const requests = []
  const steps = [...script]
  let stepIndex = 0
  const provider = async request => {
    requests.push(request)
    const at = stepIndex
    stepIndex += 1
    const next = steps.length ? steps.shift() : ANSWER
    const list = typeof next === 'function' ? await next(request, at) : next
    const reply = await collectAnswer(chunks(list))
    assert.equal(reply.failed, null, `the scripted stream must finish cleanly: ${reply.failed}`)
    return { ...reply, source: { kind: 'model', provider: 'alpha', model: 'one' } }
  }
  const hostTools = botId => ({
    schemas: () => host.forBot(botId).schemas(),
    isReadonly: name => host.forBot(botId).isReadonly(name),
    call: (name, args, context) => host.forBot(botId).call(name, args, context),
  })
  const loop = createBotLoop({ store, provider, tools: hostTools('bot-a'), newTurnId: () => 'turn-fixed' })
  const rows = table => agent.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({ ...row, result: row.result ? JSON.parse(row.result) : row.result }))
  const journalRows = table => journalReader().prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
  // The journal keeps its own handle; one read-only copy of the same file is how a test looks at
  // what the durable Task authority actually recorded.
  let reader = null
  const journalReader = () => (reader ??= new Database(join(dir, 'tasks.sqlite'), { readonly: true }))
  closers.push(() => taskService.close(), () => reader?.close())
  return {
    agent, machines, authority, directory, taskService, host, store, loop, provider, requests, journal,
    tools: botId => host.forBot(botId),
    /** What crossed the machine boundary, when a case asks for it. */
    machineCalls,
    /** Every ticket the remote agent issued, which is what "it was really reached" means. */
    grants: () => fixture.grants(),
    /** A loop over the same provider, with a tool surface a case can wrap. */
    makeLoop: (tools, next = provider) => createBotLoop({ store, provider: next, tools, newTurnId: () => 'turn-fixed' }),
    // What the remote agent actually did: its own durable operation rows.
    operations: () => rows('operations'),
    admissions: () => rows('workspace_admissions'),
    // What the durable Task journal recorded.
    tasks: () => journalRows('tasks'),
    attempts: () => journalRows('attempts'),
    operationRows: () => journalRows('operations'),
    events: () => journalRows('task_events'),
    workspace,
    /** The absolute path of one of the agent's roots, optionally with a relative path inside it. */
    rootOf: (...parts) => join(workspace, ...parts),
  }
}
