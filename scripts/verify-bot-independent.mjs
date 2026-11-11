/**
 * Run the independent-runtime specs, serially.
 *
 * These specs boot the pinned vendor runtime through esbuild, drive the real `llm/stream` handler
 * and open a real SQLite router state, so they are heavier than a unit spec and must not run beside
 * each other: the commit budget on a small Windows machine decides the concurrency here, not a
 * preference. Every case is offline — no model, desktop, profile or credential is touched.
 *
 *   node scripts/verify-bot-independent.mjs
 */

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const specs = [
  'tests/bot-independent-host.spec.mjs',
  'tests/bot-independent-tools.spec.mjs',
  'tests/bot-independent-composition.spec.mjs',
  'tests/product-independent-admission.test.mjs',
  'tests/product-independent-funding.test.mjs',
  'tests/product-independent-message-wire.test.mjs',
  'tests/product-independent-native-llm.test.mjs',
  'tests/independent-tool-host.native.mjs',
  'tests/product-independent-tools.test.mjs',
  'tests/product-independent-chat.test.mjs',
  'tests/product-independent-chat-page.test.mjs',
  'tests/independent-chat-controller.test.mjs',
  'tests/independent-chat-service.test.mjs',
  'tests/independent-chat-native.test.mjs',
  'tests/product-channel-dispatch.test.mjs',
  'tests/grant-refresh-queue.test.mjs',
  'tests/independent-chat-rich.test.mjs',
  'tests/product-model-bounds.test.mjs',
  'tests/product-model-generation.test.mjs',
  'tests/product-model-null-bound.test.mjs',
  'tests/product-independent-generation.test.mjs',
  'tests/product-independent-effort.test.mjs',
  'tests/product-independent-streaming.test.mjs',
  'tests/independent-context.test.mjs',
  'tests/product-independent-context.test.mjs',
  'tests/product-conversation-engine.test.mjs',
  'tests/product-model-loop-frame.test.mjs',
  'tests/product-loop-composition.test.mjs',
  'tests/product-actual-agent-loop.test.mjs',
  'tests/product-main-authority.test.mjs',
  'tests/product-main-machines.test.mjs',
  'tests/product-native-agent-loop.test.mjs',
  'tests/product-auxiliary-generation.test.mjs',
  'tests/product-auxiliary-composition.test.mjs',
  'tests/product-auxiliary-prepared.test.mjs',
  'tests/product-auxiliary-prepared-host.test.mjs',
]

let failed = 0
for (const spec of specs) {
  process.stdout.write(`[verify-bot-independent] ${spec}\n`)
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', spec], { cwd: root, stdio: 'inherit', windowsHide: true })
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', code => done(code ?? 1)) })
  if (code !== 0) failed += 1
}
if (failed) {
  process.stderr.write(`[verify-bot-independent] ${failed} spec(s) failed\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`[verify-bot-independent] ${specs.length} spec(s) passed\n`)
}
