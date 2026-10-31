// Owned fixture: a real Task journal writer whose attempts are executing, not queued.
// Every row below comes from openTaskJournal() commits; nothing is hand-written into the database.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { openTaskJournal } from '../../packages/orchestration/src/task-journal.mjs'
import { taskHash } from '../../packages/orchestration/src/task-contract.mjs'

const [dir, ready] = process.argv.slice(2)
const journal = openTaskJournal(Database, join(dir, 'journal.sqlite'))
const heartbeat = join(dir, 'heartbeat.json')
// The journal only compares integers, so this fixture owns a synthetic clock and keeps
// renewing its own runner lease with it.
let clock = 1000
const next = () => (clock += 100)
const identity = journal.claimRunner('inflight-runner', 60000, next())
let tick = 0
// A tick is one attempt that entered dispatch with an unconfirmed effect: claim() moves the
// task, attempt and operation to running and delivers the outbox row, beginDispatch() enters
// the dispatch fence and linkExecution() records the remote operation reference. No terminal
// row is ever written for these attempts, so a stopped runner leaves them mid-flight.
function dispatch() {
  tick++
  const at = next()
  journal.renew(identity, 60000, at)
  const target = { effect: 'workspace-write', location: 'remote', machineId: 'machine-a', workspaceId: `workspace-${tick}` }
  const payload = { backend: 'remote-write', input: { rootId: 'root' }, target, targetHash: taskHash(target) }
  const task = journal.submit(identity, 'bot-a', `inflight-${tick}`, `hash-${tick}`, payload, at + 60000, at)
  journal.claim(identity, 'bot-a', task.taskId, at)
  journal.beginDispatch(identity, 'bot-a', task.taskId, task.attemptId, at)
  journal.linkExecution(identity, 'bot-a', task.taskId, task.attemptId, {
    kind: 'remote-operation', machineId: target.machineId, rootId: 'root', tool: 'fs_write', operationId: task.operationId,
    marker: { schemaVersion: 1, taskId: task.taskId, attemptId: task.attemptId, operationId: task.operationId, targetHash: payload.targetHash },
  }, at)
  writeFileSync(heartbeat, JSON.stringify({ tick, taskId: task.taskId, operationId: task.operationId }))
  return task
}
const subject = dispatch()
writeFileSync(ready, JSON.stringify({ pid: process.pid, taskId: subject.taskId, attemptId: subject.attemptId, operationId: subject.operationId, tick }))
// 64 in-flight tasks stay far below the journal queue limit of 128.
const timer = setInterval(() => {
  try { if (tick < 64) dispatch() } catch (error) { writeFileSync(join(dir, 'writer-error.json'), String(error?.code ?? error)) }
}, 100)
