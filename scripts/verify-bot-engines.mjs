#!/usr/bin/env node
// Verification entrypoint for packages/bot-engines.
//
// Runs static invariants plus the full offline test suite (serially; the machine has
// memory limits) and records the combined log under tmp/integration/bot-engines/.
// No claude CLI, no network, no npm installs. Exit code is non-zero on any failure.

import { spawn } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const LOGDIR = join(REPO, 'tmp', 'integration', 'bot-engines')
const STAMP = `${new Date().toISOString().replace(/[:.]/g, '-')}`
const LOG = join(LOGDIR, `verify-${STAMP}.log`)

const required = [
  'packages/bot-engines/README.md',
  'packages/bot-engines/licenses/NOTICE.md',
  'packages/bot-engines/licenses/LICENSE-OpenMausBot',
  'packages/bot-engines/src/driver-catalog.mjs',
  'packages/bot-engines/src/claude-engine.mjs',
  'packages/bot-engines/src/claude-protocol.mjs',
  'packages/bot-engines/src/claude-permission-broker.mjs',
  'packages/bot-engines/src/claude-permission-proxy.mjs',
  'packages/bot-engines/src/claude-llm-adapter.mjs',
  'packages/bot-engines/src/claude-llm-turn.mjs',
  'packages/bot-engines/src/host-registrations.mjs',
  'tests/bot-engine-catalog.test.mjs',
  'tests/bot-engine-protocol.test.mjs',
  'tests/bot-engine-claude-session.native.mjs',
  'tests/fixtures/bot-engine-claude-fixture.mjs',
  'tests/bot-engine-llm-adapter.test.mjs',
  'tests/bot-engine-llm-adapter.native.mjs',
  'tests/fixtures/bot-engine-llm-host.mjs',
]

const lines = []
const log = line => { lines.push(line); process.stdout.write(`${line}\n`) }
let failures = 0
const check = (ok, label) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) failures++
}

log(`# bot-engines verification ${STAMP}`)
log(`# repo: ${REPO}`)

for (const file of required) {
  let present = false
  try { await access(join(REPO, file)); present = true } catch { present = false }
  check(present, `file present: ${file}`)
}

// Static catalog/engine invariants (import-time, no child processes).
try {
  const catalog = await import('../packages/bot-engines/src/driver-catalog.mjs')
  check(catalog.BOT_ENGINE_DRIVER_IDS.length === 26, 'catalog holds exactly the 26 upstream driver ids')
  check(new Set(catalog.BOT_ENGINE_DRIVER_IDS).size === 26, 'driver ids are unique')
  const implemented = catalog.BOT_ENGINE_DRIVERS.filter(driver => driver.availability === 'implemented').map(driver => driver.id)
  check(JSON.stringify(implemented) === JSON.stringify(['claude']), 'only claude is implemented')
  check(catalog.UPSTREAM_SOURCE.pin === '1bc4749aa8307d7d6998bf86de4ef6478460dd93', 'upstream pin recorded')
  check(catalog.getBotEngineDriver('customAcp').targetCapability === 'pending-acp-core', 'customAcp awaits trusted registration and ACP core')
  let refused = false
  try { catalog.assertNoAdHocDriverInput({ driver: 'claude', executable: 'x.exe' }) } catch { refused = true }
  check(refused, 'ad-hoc executable input is rejected')

  const engine = await import('../packages/bot-engines/src/claude-engine.mjs')
  check(typeof engine.createClaudeEngine === 'function', 'createClaudeEngine exported')
  check(typeof engine.pinClaudeEntry === 'function', 'pinClaudeEntry exported')
  check(engine.ENGINE_PERMISSION_MODES.includes('bypassPermissions') === false, 'bypassPermissions is never an engine mode')
  check(engine.DISALLOWED_NATIVE_TOOLS.includes('Bash'), 'native Bash tool is disallowed')
} catch (error) {
  check(false, `static import failed: ${error.message}`)
}

// Full offline suite, serially, through the real launcher.
await mkdir(LOGDIR, { recursive: true })
log('# running: catalog/protocol + Claude session/LLM bridge, serial offline native verification')
const testRun = await new Promise(resolve => {
  const child = spawn(process.execPath, [
    '--test', '--test-concurrency=1',
    'tests/bot-engine-catalog.test.mjs',
    'tests/bot-engine-protocol.test.mjs',
    'tests/bot-engine-claude-session.native.mjs',
    'tests/bot-engine-llm-adapter.test.mjs',
    'tests/bot-engine-llm-adapter.native.mjs',
  ], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk) })
  child.stderr.on('data', chunk => { output += chunk; process.stdout.write(chunk) })
  child.on('error', error => resolve({ code: 1, output: `${output}\nSPAWN_ERROR ${error.message}\n` }))
  child.on('close', code => resolve({ code: code ?? 1, output }))
})
lines.push(...testRun.output.split(/\r?\n/))
check(testRun.code === 0, `test suite exit code 0 (got ${testRun.code})`)

const passed = (/^ℹ pass (\d+)$/m.exec(testRun.output) ?? [])[1] ?? '?'
const failed = (/^ℹ fail (\d+)$/m.exec(testRun.output) ?? [])[1] ?? '?'
log(`# suite totals: pass=${passed} fail=${failed}`)

await writeFile(LOG, `${lines.join('\n')}\n`, 'utf8')
log(`# log written: ${LOG}`)
log(failures === 0 ? '# VERIFY OK' : `# VERIFY FAILED (${failures} check failures)`)
process.exit(failures === 0 ? 0 : 1)
