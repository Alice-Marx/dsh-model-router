import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { resolverAnchor } from './integration-upstream-tests.mjs'
import { isolatedHostEnvironment } from './integration-combined-host.mjs'
import { verifyProductSource } from './integration-product-source.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const source = await verifyProductSource()
const { anchor } = await resolverAnchor(join(ROOT, 'tests/fixtures/integration-host'))
const dir = join(ROOT, 'tmp/integration/product-upstream-tests'); await mkdir(dir, { recursive: true })
await mkdir(join(anchor, 'test-home'), { recursive: true })
const child = spawn(process.execPath, ['--import', './test/harness-resolve.mjs', '--test', '--test-timeout=120000', '--test-reporter=spec', 'test/*.test.js'],
  { cwd: join(ROOT, 'modules/bot-runtime/vendor/ds-bot'), env: isolatedHostEnvironment(join(anchor, 'test-home'), anchor), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
const chunks = []; child.stdout.on('data', chunk => chunks.push(chunk)); child.stderr.on('data', chunk => chunks.push(chunk))
const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done) })
const output = Buffer.concat(chunks).toString('utf8'); await writeFile(join(dir, 'tests.log'), output)
const counts = Object.fromEntries(['tests', 'pass', 'fail', 'skipped'].map(key => [key, Number([...output.matchAll(new RegExp(`\\b${key} (\\d+)\\b`, 'g'))].at(-1)?.[1] ?? -1)]))
const result = { status: code === 0 && counts.fail === 0 ? 'passed' : 'failed', ...counts, source, actualModelCalls: 0, level: 'migrated-upstream-unit-and-component-tests' }
await writeFile(join(dir, 'summary.json'), JSON.stringify(result, null, 2) + '\n'); process.stdout.write(JSON.stringify(result, null, 2) + '\n')
if (result.status !== 'passed') { console.error(output); process.exitCode = 1 }
