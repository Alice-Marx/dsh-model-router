import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import Database from 'better-sqlite3'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createPrincipalDirectory } from '../packages/orchestration/src/principals.mjs'
import { openRemoteMachines } from '../packages/orchestration/src/remote-machines.mjs'
import { openTaskJournal } from '../packages/orchestration/src/task-journal.mjs'
import { createTaskService } from '../packages/orchestration/src/task-service.mjs'
import { createRemoteWriteBackend } from '../packages/orchestration/src/remote-execution.mjs'
import { createRemoteCommandBackend } from '../packages/orchestration/src/remote-command-execution.mjs'
import { parseRemoteTaskCommand, parseTaskPlan, taskHash } from '../packages/orchestration/src/task-contract.mjs'
await import('../remote-computer-agent/build.mjs')
const { Agent, serve, TOOL_NAMES, CONTAINER_IMAGE } = await import('../remote-computer-agent/dist/index.mjs')

const owner = { kind: 'owner' }
const root = resolve('tmp/integration/remote-command-tasks'); await mkdir(root, { recursive: true })
const docker = process.platform === 'linux' && process.env.DSH_TEST_DOCKER === '1'
const real = (name, fn) => test(name, { skip: !docker, timeout: 90_000 }, fn)
const all = ['task/submit','task/execute','task/read','task/cancel','task/retry','task/reconcile',...TOOL_NAMES.map(t=>'remote/'+t)]
const machineTools = ['machine_ping','fs_read','fs_write','operation_status','operation_cancel','container_command_v1']

async function wait(check){const end=Date.now()+20000;while(Date.now()<end){const value=await check();if(value)return value;await sleep(10)}throw Error('Remote command fixture did not settle')}

/**
 * Real Agent over loopback HTTP with the real machine directory, journal and
 * service. `container:false` builds a plain application Agent (refusal
 * coverage everywhere); `container:true` builds the fixed-image container
 * Agent for real dispatch coverage on a Docker Linux host.
 */
async function fixture(t, { container = false } = {}) {
  const dir = await mkdtemp(join(root, 'case-')), project = join(dir, 'project'); await mkdir(project)
  // Operator grant for the container worker (E71 contract): the fixture owns
  // this tree and prepares its own permissions; user projects are never touched.
  if (container) await chmod(project, 0o777)
  const config = { dataDir: join(dir, 'agent'), roots: { 'project.v1': project } }
  if (container) { config.isolation = 'container'; config.container = { dockerExecutable: '/usr/bin/docker', image: CONTAINER_IMAGE, executables: { node: '/usr/local/bin/node' } } }
  const agent = new Agent(config, Database), pair = agent.store.pair('host', { botIds: ['bot-a', 'bot-b'], roots: ['project.v1'], tools: TOOL_NAMES }), server = await serve(agent, { port: 0 })
  const f = { dir, project, agent, pair, server, secret: pair.token, dropNext: false, calls: [] }
  const fetchImpl = async (url, options) => {
    const request = JSON.parse(options.body), tool = request.params?.name; if (tool) f.calls.push(tool)
    const response = await fetch(url, options)
    if (tool === 'container_command_v1' && f.dropNext) { f.dropNext = false; await response.arrayBuffer(); throw Error('FIXTURE_LOST_RESPONSE') }
    return response
  }
  function open() {
    f.authority = createAuthority(); f.directory = createPrincipalDirectory(f.authority); for (const id of ['bot-a', 'bot-b']) f.directory.register(id, { tools: all, modelRoutes: [] })
    f.machines = openRemoteMachines({ Database, file: join(dir, 'machines.sqlite'), resolveSecret: async () => f.secret, botExists: id => ['bot-a', 'bot-b'].includes(id), authority: f.authority, fetchImpl })
    const command = createRemoteCommandBackend({ machines: () => f.machines, directory: f.directory, pollMs: 5 })
    const write = createRemoteWriteBackend({ machines: () => f.machines, directory: f.directory, pollMs: 5 })
    f.journal = openTaskJournal(Database, join(dir, 'tasks.sqlite')); f.service = createTaskService({ journal: f.journal, authority: f.authority, directory: f.directory, backends: [command, write], concurrencyFor: () => 2, planTargetsFor: () => ['bot-a', 'bot-b'] }); f.service.start(); f.subject = f.directory.forBot('bot-a'); f.b = f.directory.forBot('bot-b')
  }
  open()
  await f.machines.pair({ machineId: pair.machineId, name: 'Command fixture', endpoint: `http://127.0.0.1:${server.address.port}`, secretRef: 'ds-secret/FIXTURE_AGENT', roots: ['project.v1'], tools: machineTools, probeBotId: 'bot-a', expectedRevision: 0 }, owner)
  for (const botId of ['bot-a', 'bot-b']) await f.machines.bind({ machineId: pair.machineId, botId, expectedRevision: 0, roots: ['project.v1'], tools: container ? ['container_command_v1', 'operation_status', 'operation_cancel'] : machineTools, mode: 'workspace-write' }, owner)
  f.input = (extra = {}) => ({ machineId: pair.machineId, rootId: 'project.v1', workspaceRelativePath: '', argv: ['node', '-e', 'process.stdout.write("command-ok")'], timeoutMs: 20000, ...extra })
  f.submit = (key = 'command', extra = {}, subject = f.subject) => f.service.submit(subject, { requestKey: key, backend: 'remote-command', input: f.input(extra) })
  f.get = task => f.journal.get(task.ownerBotId, task.taskId)
  f.settled = task => wait(() => { const row = f.get(task); return ['succeeded','failed','cancelled','needs-reconciliation','blocked'].includes(row.state) && row })
  f.restart = async () => { await f.service.close(); f.machines.close(); f.authority.dispose(); open() }
  t.after(async () => { await f.service.close(); f.machines.close(); f.authority.dispose(); await server.close(); await agent.close() })
  return f
}

test('remote command contract: closed shape, argv bounds, deadline and secret refusal', async () => {
  assert.deepEqual(parseRemoteTaskCommand({ machineId: 'm-1', rootId: 'project.v1', workspaceRelativePath: 'sub', argv: ['node', 'x.js'], timeoutMs: 15000 }), { machineId: 'm-1', rootId: 'project.v1', workspaceRelativePath: 'sub', argv: ['node', 'x.js'], timeoutMs: 15000 })
  const base = { machineId: 'm-1', rootId: 'r', workspaceRelativePath: '', argv: ['node'], timeoutMs: 15000 }
  for (const patch of [
    { script: 'x' }, { env: { A: '1' } }, { endpoint: 'https://x' }, { cwd: '/etc' },
    { argv: [] }, { argv: ['node', 'a\nb'] }, { argv: ['node', 'a\0b'] }, { argv: Array.from({ length: 65 }, () => 'x') },
    { argv: ['node', 'ghp_' + 'a'.repeat(30)] },
    { timeoutMs: 999 }, { timeoutMs: 600001 }, { timeoutMs: 1000.5 },
    { workspaceRelativePath: '/abs' }, { workspaceRelativePath: '../escape' }, { workspaceRelativePath: 'a\\b' },
  ]) assert.throws(() => parseRemoteTaskCommand({ ...base, ...patch }), /INVALID_REMOTE_TASK_|INVALID_TASK_REQUEST|POLICY/, JSON.stringify(patch))
})

test('remote command: a non-container Agent settles the versioned tool as never-started, with no native fallback', async t => {
  const f = await fixture(t)
  const task = f.submit(), done = await f.settled(task)
  assert.equal(done.state, 'failed')
  assert.equal(done.result.summary.code, 'CONTAINER_COMMAND_UNAVAILABLE')
  assert.equal(done.result.summary.notStarted, true)
  assert.equal(done.result.summary.possiblyApplied, false)
  assert.equal(done.result.summary.stopConfirmed, true)
  assert.equal(f.agent.workspaces.list().length, 0, 'a refused command never holds a workspace admission')
  const settled = JSON.parse(f.agent.store.db.prepare("SELECT result FROM operations WHERE tool='container_command_v1'").get().result)
  assert.equal(settled.notStarted, true); assert.equal(settled.possiblyApplied, false)
  assert.equal(f.calls.filter(name => name === 'container_command_v1').length, 1)
})

real('remote command: a real container command is journaled before dispatch and returns bounded artifacts', async t => {
  const f = await fixture(t, { container: true })
  const task = f.submit(), done = await f.settled(task)
  assert.equal(done.state, 'succeeded')
  assert.equal(done.result.summary.exitCode, 0)
  assert.equal(done.result.summary.stopConfirmed, true)
  assert.equal(done.result.summary.possiblyApplied, true, 'a succeeded command applied its effects; false would claim no effects')
  assert.equal(done.executionRef.kind, 'remote-operation')
  assert.equal(done.input.target.machineId, f.pair.machineId)
  assert.equal(done.input.target.workspaceId, 'remote_' + taskHash({ rootId: 'project.v1' }))
  assert.equal(f.agent.store.db.prepare('SELECT count(*) n FROM operations').get().n, 1, 'the original operation is the only dispatch')
  assert.ok(done.result.summary.stdoutArtifactId, 'framed stdout artifact is part of the receipt')
})

real('remote command: duplicate submission replays the original Task and altered argv conflicts', async t => {
  const f = await fixture(t, { container: true })
  const a = f.submit(), done = await f.settled(a)
  assert.equal(done.state, 'succeeded')
  const b = f.submit()
  assert.equal(b.taskId, a.taskId); assert.equal(b.operationId, a.operationId)
  assert.throws(() => f.submit('command', { argv: ['node', '-e', 'different'] }), /TASK_REQUEST_CONFLICT/)
  assert.equal(f.calls.filter(name => name === 'container_command_v1').length, 1)
})

real('remote command: a dropped success reply stays unknown and cold observation reconciles without re-execution', async t => {
  const f = await fixture(t, { container: true })
  f.dropNext = true
  const a = f.submit(), unknown = await f.settled(a)
  assert.equal(unknown.state, 'needs-reconciliation')
  // The unknown Task keeps its journal hold until observation; a fast command
  // may already be terminal on the Agent (its terminal receipt releases the
  // workspace admission by design), so the lock is asserted only while the
  // original operation is still unsettled below.
  // The container keeps running after the dropped reply; wait for the agent's
  // original operation to settle before the cold Host observes it.
  await wait(() => { const row = f.agent.store.db.prepare("SELECT status FROM operations WHERE tool='container_command_v1'").get(); return ['succeeded','failed','cancelled'].includes(row?.status) })
  await f.restart()
  const done = await f.service.reconcile(f.subject, { taskId: a.taskId, requestKey: 'observe' })
  assert.equal(done.state, 'succeeded')
  assert.equal(f.calls.filter(name => name === 'container_command_v1').length, 1, 'reconciliation observes, it never re-executes')
  await wait(() => f.agent.workspaces.list().length === 0)
})

real('remote command: cancellation keeps applied effects and settles through the original receipt', async t => {
  const f = await fixture(t, { container: true })
  await writeFile(join(f.project, 'marker-origin.txt'), 'kept')
  const task = f.submit('cancel', { argv: ['node', '-e', 'require("node:fs").writeFileSync("marker.txt","written"); setInterval(()=>{},1000)'], timeoutMs: 30000 })
  await wait(() => readFile(join(f.project, 'marker.txt'), 'utf8').then(() => true, () => false))
  await f.service.cancel(f.subject, { taskId: task.taskId })
  const done = await f.settled(task)
  assert.equal(done.state, 'cancelled')
  assert.equal(done.result.summary.stopConfirmed, true)
  assert.equal(done.result.summary.possiblyApplied, true, 'cancellation is not rollback')
  assert.equal(await readFile(join(f.project, 'marker.txt'), 'utf8'), 'written', 'the applied effect is preserved and reported')
  assert.equal(await readFile(join(f.project, 'marker-origin.txt'), 'utf8'), 'kept')
  await wait(() => f.agent.workspaces.list().length === 0)
})

real('remote command: an unapproved executable alias is refused without starting a container', async t => {
  const f = await fixture(t, { container: true })
  const task = f.submit('alias', { argv: ['curl', 'http://127.0.0.1/'] }), done = await f.settled(task)
  assert.equal(done.state, 'failed')
  assert.equal(done.result.summary.code, 'EXECUTABLE_NOT_ALLOWED')
  assert.equal(f.agent.store.db.prepare('SELECT count(*) n FROM container_workers').get().n, 0)
})

test('remote command plan: workspace-write plans accept the command execution and other shapes refuse it', async () => {
  const base = { schemaVersion: 1, taskId: 'plan-cmd', origin: { kind: 'private', botId: 'bot-a', sessionId: null }, planRevision: 1, packages: [{ id: 'p1', targetBotId: 'bot-a', objective: 'run the pinned node helper inside the container', dependsOn: [], acceptance: ['exit code observed'], effectClass: 'workspace-write', execution: { backend: 'remote-command', input: { machineId: 'm-1', rootId: 'project.v1', workspaceRelativePath: '', argv: ['node', '-e', 'process.stdout.write("x")'], timeoutMs: 15000 } } }] }
  const plan = parseTaskPlan(structuredClone(base))
  assert.equal(plan.packages[0].execution.backend, 'remote-command')
  const clone = patch => structuredClone({ ...base, packages: [{ ...base.packages[0], ...patch }] })
  for (const bad of [
    clone({ effectClass: 'read' }),
    clone({ execution: { backend: 'remote-write', input: base.packages[0].execution.input } }),
    clone({ execution: { backend: 'remote-command', input: { ...base.packages[0].execution.input, argv: [] } } }),
    clone({ execution: { backend: 'remote-command', input: { ...base.packages[0].execution.input, timeoutMs: 10 } } }),
    clone({ execution: { backend: 'native-shell', input: base.packages[0].execution.input } }),
  ]) assert.throws(() => parseTaskPlan(bad), /TASK_PLAN_|INVALID_REMOTE_TASK_|INVALID_TASK_REQUEST|POLICY/, bad.packages[0].execution.backend)
})
