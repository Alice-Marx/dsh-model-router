import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadProfileDirectory } from '@deepseek-ai/dsh-app-boot'

const [dir, ready, installAnchor] = process.argv.slice(2)
const manifestPath = join(dir, 'package.json')
const retired = '@deepseek-ai/dsh-experimental-schedule-bundle'
let tick = 0
function load() {
  writeFileSync(manifestPath, JSON.stringify({ private: true, syntheticTick: tick, dsh: { profile: { bundles: [retired] } } }, null, 2) + '\n')
  return loadProfileDirectory('dsh', dir, installAnchor, { userLayer: false })
}
const first = load()
tick++
writeFileSync(ready, JSON.stringify({ pid: process.pid, syntheticTick: tick, layers: first.layers.length }))
const timer = setInterval(() => {
  load()
  tick++
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
