/**
 * Run the request-bounds specs, serially.
 *
 * The bounds spec opens a real SQLite router state per case, mounts the real
 * principal authority and drives the installed Cordis/LlmRuntime over the
 * offline transport, so it is heavier than a unit spec and must not run beside
 * itself: one case at a time keeps the ledger's own write chain unambiguous.
 * Every case is offline — no model, desktop, profile or credential is touched.
 *
 *   node scripts/verify-model-request-bounds.mjs
 *   node scripts/verify-model-request-bounds.mjs --adjacent
 *
 * `--adjacent` adds the suites whose offline provider metadata this change
 * attests. They are not owned here, so they stay opt-in.
 */

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const focused = ['tests/product-model-bounds.test.mjs']
const adjacent = [
  'tests/product-independent-funding.test.mjs',
  'tests/product-independent-native-llm.test.mjs',
  'tests/product-independent-tools.test.mjs',
  'tests/product-independent-chat.test.mjs',
]
const specs = process.argv.includes('--adjacent') ? [...focused, ...adjacent] : focused

let failed = 0
for (const spec of specs) {
  process.stdout.write(`[verify-model-request-bounds] ${spec}\n`)
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', spec], { cwd: root, stdio: 'inherit', windowsHide: true })
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', code => done(code ?? 1)) })
  if (code !== 0) failed += 1
}
if (failed) {
  process.stderr.write(`[verify-model-request-bounds] ${failed} spec(s) failed\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`[verify-model-request-bounds] ${specs.length} spec(s) passed\n`)
}
