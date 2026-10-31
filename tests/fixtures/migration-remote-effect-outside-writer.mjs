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
const { TOOL_NAMES } = await import('../../remote-computer-agent/dist/index.mjs')

const [dir, agentReadyFile, receiptFile, relativePath, content] = process.argv.slice(2)
const owner = { kind: 'owner' }
const all = ['task/submit', 'task/execute', 'task/read', 'task/cancel', 'task/retry', 'task/reconcile', ...TOOL_NAMES.map(tool => `remote/${tool}`)]
async function wait(check) {
  const end = Date.now() + 15000
  while (Date.now() < end) {
    const value = await check()
    if (value) return value
    await sleep(5)
  }
  throw new Error('OUTSIDE_EFFECT_FIXTURE_TIMEOUT')
}
async function main() {
  await mkdir(dir, { recursive: true })
  const agent = JSON.parse(await readFile(agentReadyFile, 'utf8'))
  const authority = createAuthority()
  const directory = createPrincipalDirectory(authority)
  directory.register('bot-a', { tools: all, modelRoutes: [] })
  const machines = openRemoteMachines({ Database, file: join(dir, 'machines.sqlite'), resolveSecret: async () => agent.token, botExists: id => id === 'bot-a', authority })
  await machines.pair({ machineId: agent.machineId, name: 'Synthetic migration effect fixture', endpoint: `http://127.0.0.1:${agent.port}`, secretRef: 'ds-secret/FIXTURE_AGENT', roots: ['project.v1'], tools: ['machine_ping', 'fs_read', 'fs_write', 'operation_status', 'operation_cancel'], probeBotId: 'bot-a', expectedRevision: 0 }, owner)
  await machines.bind({ machineId: agent.machineId, botId: 'bot-a', expectedRevision: 0, roots: ['project.v1'], tools: ['fs_write', 'fs_read', 'operation_status', 'operation_cancel'], mode: 'workspace-write' }, owner)
  const remote = createRemoteWriteBackend({ machines: () => machines, directory, pollMs: 5 })
  const journal = openTaskJournal(Database, join(dir, 'tasks.sqlite'))
  const service = createTaskService({ journal, authority, directory, backends: [remote], concurrencyFor: () => 1, planTargetsFor: () => ['bot-a'] })
  service.start()
  const subject = directory.forBot('bot-a')
  const task = service.submit(subject, { requestKey: 'outside-job-effect', backend: 'remote-write', input: { machineId: agent.machineId, rootId: 'project.v1', relativePath, content, expectedHash: null } })
  const done = await wait(() => {
    const row = journal.get('bot-a', task.taskId)
    return ['succeeded', 'failed', 'cancelled', 'needs-reconciliation', 'blocked'].includes(row.state) && row
  })
  await writeFile(receiptFile, JSON.stringify({ state: done.state, taskId: task.taskId, operationId: task.operationId, result: done.result ?? null, hostPid: process.pid, agentPid: agent.pid }))
  if (done.state !== 'succeeded') throw new Error(`OUTSIDE_EFFECT_NOT_SUCCEEDED:${done.state}`)
}
main().catch(async error => {
  await writeFile(join(dir, 'outside-writer-error.json'), String(error?.stack ?? error))
  process.exitCode = 1
})
