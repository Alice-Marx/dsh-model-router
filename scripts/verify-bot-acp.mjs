#!/usr/bin/env node
// Offline verification for the bot-acp ACP session core.
//
// Runs the five bot-acp suites in an isolated tmp/integration/bot-acp directory
// and writes report.json. Everything here is offline: the native suite speaks the
// ACP wire to a real Node child process through the trusted native supervisor,
// but no agent CLI, network, user profile, credential or desktop is touched.
//
// The native suite runs serially (--test-concurrency=1): each supervisor spawn
// costs real machine memory, and parallel runs starve the rest of the box. The
// turn-fence seam suite is fast and deterministic, so it runs first and its
// failure stops the run before any process is spawned.

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
const RUNS = join(REPO, 'tmp', 'integration', 'bot-acp', `verify-${Date.now().toString(36)}-${process.pid}`)

const SUITES = Object.freeze([
  { name: 'codec', args: ['--test', 'tests/bot-acp-codec.test.mjs'] },
  { name: 'permissions', args: ['--test', 'tests/bot-acp-permissions.test.mjs'] },
  { name: 'session-state', args: ['--test', 'tests/bot-acp-session-state.test.mjs'] },
  { name: 'turn-fence', args: ['--test', '--test-concurrency=1', 'tests/bot-acp-turn-fence.test.mjs'] },
  { name: 'session-native', args: ['--test', '--test-concurrency=1', 'tests/bot-acp-session.native.mjs'] },
])

const runSuite = async (suite, logPath) => {
  const child = spawn(process.execPath, suite.args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk.toString('utf8') })
  child.stderr.on('data', chunk => { output += chunk.toString('utf8') })
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (value, signal) => resolve(value ?? (signal ? 1 : 0)))
  })
  await writeFile(logPath, output, 'utf8')
  const count = pattern => {
    const match = new RegExp(`^ℹ ${pattern} (\\d+)$`, 'm').exec(output)
    return match ? Number(match[1]) : null
  }
  const failures = []
  for (const line of output.split('\n')) {
    const match = /^✖ (.+)$/.exec(line.trim())
    if (match && !line.includes('failing tests')) failures.push(match[1].trim())
  }
  return {
    suite: suite.name,
    command: `node ${suite.args.join(' ')}`,
    serial: suite.args.includes('--test-concurrency=1'),
    exitCode: code,
    passed: count('pass'),
    failed: count('fail'),
    skipped: count('skipped') ?? 0,
    failures,
    log: logPath,
  }
}

const main = async () => {
  await mkdir(RUNS, { recursive: true })
  const results = []
  for (const suite of SUITES) {
    process.stdout.write(`[verify-bot-acp] ${suite.name}: node ${suite.args.join(' ')}\n`)
    const result = await runSuite(suite, join(RUNS, `${suite.name}.log`))
    results.push(result)
    process.stdout.write(`[verify-bot-acp] ${suite.name}: exit ${result.exitCode}, pass ${result.passed}, fail ${result.failed}\n`)
    if (result.exitCode !== 0) break
  }
  const report = {
    schemaVersion: 1,
    generatedBy: 'scripts/verify-bot-acp.mjs',
    runs: RUNS,
    concurrency: 'native suite serial (--test-concurrency=1)',
    offline: true,
    touched: ['tmp/integration/bot-acp (this run)', 'tests/fixtures/bot-acp-agent-fixture.mjs (read-only child)'],
    suites: results,
    summary: {
      exitCode: results.every(result => result.exitCode === 0) && results.length === SUITES.length ? 0 : 1,
      passed: results.reduce((total, result) => total + (result.passed ?? 0), 0),
      failed: results.reduce((total, result) => total + (result.failed ?? 0), 0),
      completed: results.length === SUITES.length,
    },
    limitations: [
      'No real ACP CLI is installed or contacted: the agent side is an offline Node fixture',
      'Product composition wiring is not part of this run',
      'The turn-fence seam suite drives a controlled launcher seam: it proves timing, not real-machine process behaviour',
    ],
  }
  await writeFile(join(RUNS, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`[verify-bot-acp] summary: pass ${report.summary.passed}, fail ${report.summary.failed}, report ${join(RUNS, 'report.json')}\n`)
  process.exitCode = report.summary.exitCode
}

main().catch(error => {
  process.stderr.write(`[verify-bot-acp] failed: ${error?.stack ?? String(error)}\n`)
  process.exitCode = 1
})
