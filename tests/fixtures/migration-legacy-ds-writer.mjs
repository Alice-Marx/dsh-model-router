import fs, { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { syncBuiltinESMExports } from 'node:module'

const [home, ready] = process.argv.slice(2)
const originalWrite = fs.writeFileSync
fs.writeFileSync = (path, ...args) => {
  if (path === join(home, 'state.lock')) throw Object.assign(new Error('synthetic lock write denial'), { code: 'EACCES' })
  return originalWrite(path, ...args)
}
syncBuiltinESMExports()
const { install } = await import('../../modules/bot-runtime/vendor/ds-bot/src/host/store.js')
const statePath = join(home, 'state.json')
const warnings = []
const disposers = []
const ctx = { effect(execute) { disposers.push(execute()) } }
const rt = { ctx, home, statePath, warn: (...args) => warnings.push(args.join(' ')) }
install(rt)
await rt.load()
await rt.save({ required: true })
writeFileSync(ready, JSON.stringify({ pid: process.pid, revision: rt.state.revision, warnings }))
let writing = false
const timer = setInterval(async () => {
  if (writing) return
  writing = true
  try {
    rt.state.prefs.syntheticTick = (rt.state.prefs.syntheticTick ?? 0) + 1
    await rt.save({ required: true })
  } finally { writing = false }
}, 100)
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  clearInterval(timer)
  await Promise.all(disposers.splice(0).map(dispose => dispose()))
  process.exit(0)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
