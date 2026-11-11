/**
 * Run the serving-fence specs, serially.
 *
 * The fence specs boot the pinned vendor runtime through esbuild and drive the real `llm/stream`
 * handler, so they are heavier than a unit spec and must not run beside each other: the commit
 * budget on a small Windows machine is what decides the concurrency here, not a preference.
 *
 *   node scripts/verify-bot-serving.mjs
 */

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const specs = ['tests/bot-serving-host.spec.mjs', 'tests/bot-serving-switch.spec.mjs']

let failed = 0
for (const spec of specs) {
  process.stdout.write(`[verify-bot-serving] ${spec}\n`)
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', spec], { cwd: root, stdio: 'inherit', windowsHide: true })
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', code => done(code ?? 1)) })
  if (code !== 0) failed += 1
}
if (failed) {
  process.stderr.write(`[verify-bot-serving] ${failed} spec(s) failed\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`[verify-bot-serving] ${specs.length} spec(s) passed\n`)
}
