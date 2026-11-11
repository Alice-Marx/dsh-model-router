/**
 * Run the independent-runtime tool specs, serially.
 *
 * These specs open a real remote computer (the real agent over a real transport on loopback), a real
 * machine directory, a real SQLite task journal and the real installed SDK with only its provider
 * transport offline. They are heavy and they share one machine's commit budget, so they run one at
 * a time and to the end: nothing here is left running in the background. Every case is offline — no
 * model, desktop, profile or credential of a user is touched.
 *
 *   node scripts/verify-independent-tools.mjs
 */

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const specs = [
  // The Host tool service itself: live catalog, durable Task journal, cancel, unknown outcomes.
  'tests/independent-tool-host.native.mjs',
  // The same chain through the installed SDK and the real composition.
  'tests/product-independent-tools.test.mjs',
  // The rest of the independent runtime, so a change to the loop is not a silent regression.
  'tests/bot-independent-host.spec.mjs',
  'tests/bot-independent-tools.spec.mjs',
  'tests/bot-independent-composition.spec.mjs',
  'tests/product-independent-admission.test.mjs',
  'tests/product-independent-funding.test.mjs',
  'tests/product-independent-message-wire.test.mjs',
  'tests/product-independent-native-llm.test.mjs',
]

let failed = 0
for (const spec of specs) {
  process.stdout.write(`[verify-independent-tools] ${spec}\n`)
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', spec], { cwd: root, stdio: 'inherit', windowsHide: true })
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', code => done(code ?? 1)) })
  if (code !== 0) failed += 1
}
if (failed) {
  process.stderr.write(`[verify-independent-tools] ${failed} spec(s) failed\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`[verify-independent-tools] ${specs.length} spec(s) passed\n`)
}
