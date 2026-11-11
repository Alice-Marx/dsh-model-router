import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

// Pass argv directly to Node: npm's Windows command shell cannot carry the full test plan.
const plan = JSON.parse(await readFile(new URL('./test-plan.json', import.meta.url), 'utf8'))
// Browser bundles and native-worker specs each start child processes. Node's
// CPU-count default can exhaust Windows commit memory during parallel work.
// Keep the suite bounded; a small machine can select 1 without changing tests.
const concurrency = process.env.DSH_TEST_CONCURRENCY ?? '2'
if (!/^[1-8]$/.test(concurrency)) throw new Error('DSH_TEST_CONCURRENCY must be an integer from 1 to 8')
if (plan.schemaVersion !== 1 || !Array.isArray(plan.stages) || plan.stages.some(args => !Array.isArray(args) || !args.length || args.some(arg => typeof arg !== 'string'))) {
  throw new Error('Invalid committed test plan')
}
for (const [index, args] of plan.stages.entries()) {
  process.stdout.write(`[tests] ${index + 1}/${plan.stages.length}: ${args.includes('--test') ? 'Node test suite' : args[0]}\n`)
  const argv = args.includes('--test') && !args.some(arg => arg === '--test-concurrency' || arg.startsWith('--test-concurrency='))
    ? [`--test-concurrency=${concurrency}`, ...args] : args
  const child = spawn(process.execPath, argv, { stdio: 'inherit', windowsHide: true })
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve(code ?? (signal ? 1 : 0))) })
  if (code !== 0) { process.exitCode = code; break }
}
