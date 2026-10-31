import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRouterState } from '../../.dsh-plugin/shared/router-state.mjs'

const [home, ready] = process.argv.slice(2)
const file = join(home, 'model-router', 'state.json')
const store = createRouterState({ file })
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
function stop() {
  if (stopping) return
  stopping = true
  clearInterval(timer)
  process.exit(0)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
