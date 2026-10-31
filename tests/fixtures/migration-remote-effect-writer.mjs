import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import Database from 'better-sqlite3'
import { createAuthority } from '../../packages/capability-broker/src/authority.mjs'
import { createPrincipalDirectory } from '../../packages/orchestration/src/principals.mjs'
import { openRemoteMachines } from '../../packages/orchestration/src/remote-machines.mjs'
import { openTaskJournal } from '../../packages/orchestration/src/task-journal.mjs'
import { createTaskService } from '../../packages/orchestration/src/task-service.mjs'
import { createRemoteWriteBackend } from '../../packages/orchestration/src/remote-execution.mjs'
const { Agent, serve, TOOL_NAMES } = await import('../../remote-computer-agent/dist/index.mjs')

const [dir, readyFile] = process.argv.slice(2)
const owner = { kind: 'owner' }
const all = ['task/submit', 'task/execute', 'task/read', 'task/cancel', 'task/retry', 'task/reconcile', ...TOOL_NAMES.map(tool => `remote/${tool}`)]
async function wait(check) {
  const end = Date.now() + 15000
  while (Date.now() < end) {
    const value = await check()
    if (value) return value
    await sleep(5)
  }
  throw new Error('REMOTE_EFFECT_FIXTURE_TIMEOUT')
}
async function main() {
  const project = join(dir, 'project')
  await mkdir(project, { recursive: true })
  const agent = new Agent({ dataDir: join(dir, 'agent'), roots: { 'project.v1': project } }, Database)
  const pair = agent.store.pair('host', { botIds: ['bot-a'], roots: ['project.v1'], tools: TOOL_NAMES })
  const server = await serve(agent, { port: 0 })
  const authority = createAuthority()
  const directory = createPrincipalDirectory(authority)
  directory.register('bot-a', { tools: all, modelRoutes: [] })
  let tick = 0
  const fetchImpl = async (url, options) => {
    const request = JSON.parse(options.body)
    const response = await fetch(url, options)
    if (request.params?.name === 'fs_write' && tick === 4) {
      await writeFile(join(dir, 'reply-held.json'), JSON.stringify({ tick, phase: 'real-effect-complete-host-reply-held' }))
      while (!existsSync(join(dir, 'release-reply'))) await sleep(10)
    }
    return response
  }
  const machines = openRemoteMachines({ Database, file: join(dir, 'machines.sqlite'), resolveSecret: async () => pair.token, botExists: id => id === 'bot-a', authority, fetchImpl })
  await machines.pair({ machineId: pair.machineId, name: 'Synthetic migration effect fixture', endpoint: `http://127.0.0.1:${server.address.port}`, secretRef: 'ds-secret/FIXTURE_AGENT', roots: ['project.v1'], tools: ['machine_ping', 'fs_read', 'fs_write', 'operation_status', 'operation_cancel'], probeBotId: 'bot-a', expectedRevision: 0 }, owner)
  await machines.bind({ machineId: pair.machineId, botId: 'bot-a', expectedRevision: 0, roots: ['project.v1'], tools: ['fs_write', 'fs_read', 'operation_status', 'operation_cancel'], mode: 'workspace-write' }, owner)
  const remote = createRemoteWriteBackend({ machines: () => machines, directory, pollMs: 5 })
  const journal = openTaskJournal(Database, join(dir, 'tasks.sqlite'))
  const service = createTaskService({ journal, authority, directory, backends: [remote], concurrencyFor: () => 1, planTargetsFor: () => ['bot-a'] })
  service.start()
  const subject = directory.forBot('bot-a')
  for (tick = 1; tick <= 64; tick++) {
    const content = `remote effect ${tick}\n`
    const task = service.submit(subject, { requestKey: `remote-effect-${tick}`, backend: 'remote-write', input: { machineId: pair.machineId, rootId: 'project.v1', relativePath: `effect-${tick}.txt`, content, expectedHash: null } })
    await writeFile(join(dir, 'active.json'), JSON.stringify({ pid: process.pid, tick, taskId: task.taskId, attemptId: task.attemptId, operationId: task.operationId, phase: 'submitted' }))
    await wait(() => journal.get('bot-a', task.taskId).state === 'running')
    await writeFile(join(dir, 'active.json'), JSON.stringify({ pid: process.pid, tick, taskId: task.taskId, attemptId: task.attemptId, operationId: task.operationId, phase: 'running' }))
    const done = await wait(() => {
      const row = journal.get('bot-a', task.taskId)
      return ['succeeded', 'failed', 'cancelled', 'needs-reconciliation', 'blocked'].includes(row.state) && row
    })
    if (done.state !== 'succeeded') throw new Error(`REMOTE_EFFECT_NOT_SUCCEEDED:${done.state}`)
    const written = await readFile(join(project, `effect-${tick}.txt`), 'utf8')
    if (written !== content) throw new Error('REMOTE_EFFECT_CONTENT_MISMATCH')
    await writeFile(join(dir, 'heartbeat.json'), JSON.stringify({ pid: process.pid, tick, taskId: task.taskId, operationId: task.operationId }))
    if (tick === 1) await writeFile(readyFile, JSON.stringify({ pid: process.pid, machineId: pair.machineId, taskId: task.taskId, operationId: task.operationId, tick }))
    await sleep(20)
  }
}
main().catch(async error => {
  await writeFile(join(dir, 'writer-error.json'), String(error?.stack ?? error))
  process.exitCode = 1
})
