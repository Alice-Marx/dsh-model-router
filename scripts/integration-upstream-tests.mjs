import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { killProcessTree } from '../.dsh-plugin/shared/task-executors.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const execute = promisify(execFile)

/** Only public package.json resolution is used; installed SDK files are never edited. */
export async function resolverAnchor(hostRoot) {
  const requireHost = createRequire(join(hostRoot, 'package.json'))
  const entry = await realpath(requireHost.resolve('@deepseek-ai/dsh/package.json'))
  const queue = [entry]
  const packages = new Map()
  for (let index = 0; index < queue.length; index++) {
    const file = queue[index]
    const manifest = JSON.parse(await readFile(file, 'utf8'))
    const previous = packages.get(manifest.name)
    if (previous) {
      if (previous.version !== manifest.version) throw new Error(`Mixed SDK package versions: ${manifest.name}`)
      continue
    }
    packages.set(manifest.name, { version: manifest.version, directory: dirname(file) })
    const from = createRequire(file)
    for (const name of Object.keys(manifest.dependencies ?? {}).filter(name => name.startsWith('@deepseek-ai/'))) {
      queue.push(await realpath(from.resolve(`${name}/package.json`)))
    }
  }
  if (packages.get('@deepseek-ai/dsh').version !== '0.2.1-rc.3') throw new Error('Expected fixed rc.3 host')
  const parent = join(ROOT, 'tmp/integration/resolver-anchors')
  await mkdir(parent, { recursive: true })
  const anchor = await mkdtemp(join(parent, 'rc3-'))
  await mkdir(join(anchor, 'node_modules/@deepseek-ai'), { recursive: true })
  await writeFile(join(anchor, 'package.json'), '{"name":"integration-test-anchor","private":true,"type":"module"}\n')
  for (const [name, record] of packages) {
    await symlink(record.directory, join(anchor, 'node_modules', name), process.platform === 'win32' ? 'junction' : 'dir')
  }
  const jsdom = dirname(await realpath(requireHost.resolve('jsdom/package.json')))
  await symlink(jsdom, join(anchor, 'node_modules/jsdom'), process.platform === 'win32' ? 'junction' : 'dir')
  return { anchor, sdkPackages: packages.size }
}

async function main(args) {
  if (args.length !== 4 || args[0] !== '--ds-root' || args[2] !== '--host-root') throw new Error('Usage: node scripts/integration-upstream-tests.mjs --ds-root <frozen-checkout> --host-root <installed-fixture>')
  const dsRoot = resolve(args[1])
  const hostRoot = resolve(args[3])
  const baseline = JSON.parse(await readFile(join(ROOT, 'docs/integration/baseline.json'), 'utf8'))
  const revision = (await execute('git', ['-C', dsRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true })).stdout.trim()
  if (revision !== baseline.repositories.DS.commit) throw new Error('Upstream checkout differs from the frozen DS baseline')
  const { anchor, sdkPackages } = await resolverAnchor(hostRoot)
  const env = { DSH_HARNESS: anchor, DSH_HOME: join(anchor, 'isolated-home') }
  for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'windir', 'ComSpec', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR', 'LANG']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  const result = await new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ['--import', './test/harness-resolve.mjs', '--test', '--test-timeout=120000', '--test-reporter=spec', 'test/*.test.js'], {
      cwd: join(dsRoot, 'ds-bot'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const chunks = []
    let bytes = 0
    let stopped = false
    const stop = () => { if (!stopped) { stopped = true; killProcessTree(child) } }
    const timer = setTimeout(stop, 180_000)
    const append = chunk => {
      bytes += chunk.length
      if (bytes <= 16 * 1024 * 1024) chunks.push(chunk)
      else stop()
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('close', code => { clearTimeout(timer); resolveRun({ code: stopped ? -1 : code, output: Buffer.concat(chunks).toString('utf8') }) })
  })
  const raw = join(ROOT, 'tmp/integration/m0/ds-rc3-reproducible-tests.log')
  await mkdir(dirname(raw), { recursive: true })
  await writeFile(raw, result.output)
  const counts = {}
  for (const key of ['tests', 'pass', 'fail', 'skipped']) counts[key] = Number([...result.output.matchAll(new RegExp(`\\b${key} (\\d+)\\b`, 'g'))].at(-1)?.[1] ?? -1)
  const summary = { status: result.code === 0 && counts.fail === 0 ? 'passed' : 'failed', ...counts,
    frozenCommit: revision, sdkVersion: '0.2.1-rc.3', sdkPackages,
    rawLogSha256: createHash('sha256').update(result.output).digest('hex'),
    limitations: ['Upstream unit/UI component tests, not a running integrated application', 'No actual model calls or remote machines', 'No frozen source or installed SDK files patched'] }
  await writeFile(join(ROOT, 'tmp/integration/m0/ds-rc3-reproducible-summary.json'), JSON.stringify(summary, null, 2)+'\n')
  process.stdout.write(JSON.stringify(summary, null, 2)+'\n')
  if (summary.status !== 'passed') process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
}
