import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { createRouterState } from '../../.dsh-plugin/shared/router-state.mjs'
import { openSqliteRouterState } from '../../packages/orchestration/src/sqlite-router-state.mjs'

const [dir, ready] = process.argv.slice(2)
const file = join(dir, 'orchestration.sqlite'), legacyFile = join(dir, 'state.json')
await createRouterState({ file: legacyFile }).saveHealth(null)
const store = await openSqliteRouterState({ Database, file, legacyFile })
let tick = 0, writing = false
await store.saveHealth({ tools: [], syntheticTick: ++tick })
writeFileSync(ready, JSON.stringify({ pid: process.pid, syntheticTick: tick }))
const timer = setInterval(async () => {
  if (writing) return
  writing = true
  try { await store.saveHealth({ tools: [], syntheticTick: ++tick }) }
  finally { writing = false }
}, 100)
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  clearInterval(timer)
  await store.close()
  process.exit(0)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
