import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { openTaskJournal } from '../../packages/orchestration/src/task-journal.mjs'
import { taskHash } from '../../packages/orchestration/src/task-contract.mjs'

const [dir, ready] = process.argv.slice(2)
const journal = openTaskJournal(Database, join(dir, 'journal.sqlite'))
const identity = journal.claimRunner('runner-a', 60000, Date.now())
let tick = 0
function submit() {
  tick++
  const id = `plan-${tick}`, target = { effect: 'read', machineId: 'machine-a', workspaceId: 'workspace-a' }
  const plan = { schemaVersion: 1, taskId: id, origin: { kind: 'private', botId: 'bot-a', sessionId: null }, planRevision: 1,
    packages: [{ id: 'a', targetBotId: 'bot-a', objective: 'a', dependsOn: [], acceptance: ['verified'], effectClass: 'read' }] }
  journal.submitPlan(identity, 'bot-a', `key-${tick}`, plan, 1, { payloads: [{ id: 'a', payload: { backend: 'fixture', input: { task: 'a' }, target, targetHash: taskHash(target) } }], deadline: 60000 })
  return tick
}
await submit()
writeFileSync(ready, JSON.stringify({ pid: process.pid, syntheticTick: tick }))
const timer = setInterval(submit, 100)
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  clearInterval(timer)
  await journal.close()
  process.exit(0)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
