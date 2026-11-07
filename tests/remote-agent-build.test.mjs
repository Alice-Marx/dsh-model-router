import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'agent-build-'))
  const agent = join(root, 'agent'), output = join(agent, 'dist'), workers = []
  const release = join(root, 'release')
  t.after(async () => {
    await writeFile(release, '')
    await Promise.allSettled(workers)
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    await rm(root, { recursive: true, force: true })
  })
  await mkdir(output, { recursive: true })
  await mkdir(join(root, 'node_modules/esbuild'), { recursive: true })
  await mkdir(join(root, 'packages/cli-runtime/src'), { recursive: true })
  await copyFile(new URL('../remote-computer-agent/build.mjs', import.meta.url), join(agent, 'build.mjs'))
  await writeFile(join(root, 'node_modules/esbuild/package.json'), JSON.stringify({ name: 'esbuild', type: 'module', exports: './index.mjs' }))
  // Hold compilation at an observable boundary; the assertions exercise the build's filesystem
  // contract without depending on compiler speed or changing the repository's shared dist.
  await writeFile(join(root, 'node_modules/esbuild/index.mjs'), `
    import { access, writeFile } from 'node:fs/promises'
    import { join } from 'node:path'
    import { setTimeout as sleep } from 'node:timers/promises'
    export async function build(options) {
      if (process.env.DSH_AGENT_BUILD_TEST_FAIL) throw new Error('synthetic compiler failure')
      await writeFile(process.env.DSH_AGENT_BUILD_TEST_READY, '')
      for (;;) { try { await access(process.env.DSH_AGENT_BUILD_TEST_RELEASE); break } catch { await sleep(10) } }
      const files = options.outfile ? ['cli-stdio-bridge.mjs', 'cli-stdio-bridge.mjs.map'] : ['index.mjs', 'index.mjs.map', 'cli.mjs', 'cli.mjs.map']
      return { outputFiles: files.map(name => ({ path: join(options.absWorkingDir, 'dist', name), contents: Buffer.from((name === 'cli.mjs' ? '#!/usr/bin/env node\\n' : '') + 'built:' + name) })) }
    }
  `)
  for (const name of ['index.mjs', 'cli.mjs', 'obsolete.mjs']) await writeFile(join(output, name), `old:${name}`)
  for (const name of ['native-peer.ps1', 'native-peer.py']) await writeFile(join(root, 'packages/cli-runtime/src', name), `helper:${name}`)
  const start = (id, fail = false) => {
    const ready = join(root, `ready-${id}`)
    const child = spawn(process.execPath, [join(agent, 'build.mjs')], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, DSH_AGENT_BUILD_TEST_READY: ready, DSH_AGENT_BUILD_TEST_RELEASE: release, DSH_AGENT_BUILD_TEST_FAIL: fail ? '1' : '' } })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk })
    const timer = setTimeout(() => child.kill(), 10000)
    const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => { clearTimeout(timer); resolve({ code, stderr }) }) })
    workers.push(done)
    return { ready, done }
  }
  return { root, agent, output, start, release: () => writeFile(release, '') }
}

async function ready(worker) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await readFile(worker.ready).then(() => true, () => false)) return
    await sleep(10)
  }
  assert.fail('compiler fixture did not start')
}

test('Agent build: concurrent compilation preserves published entry points until complete files are ready', async t => {
  const f = await fixture(t)
  const workers = [f.start('a'), f.start('b'), f.start('c')]
  await Promise.all(workers.map(ready))
  for (const name of ['index.mjs', 'cli.mjs']) assert.equal(await readFile(join(f.output, name), 'utf8'), `old:${name}`)
  await f.release()
  for (const worker of workers) { const result = await worker.done; assert.equal(result.code, 0, result.stderr) }
  const expected = ['index.mjs', 'index.mjs.map', 'cli.mjs', 'cli.mjs.map', 'cli-stdio-bridge.mjs', 'cli-stdio-bridge.mjs.map', 'native-peer.ps1', 'native-peer.py']
  assert.deepEqual((await readdir(f.output)).sort(), expected.sort())
  for (const name of expected) {
    const prefix = name === 'cli.mjs' ? '#!/usr/bin/env node\n' : ''
    assert.equal(await readFile(join(f.output, name), 'utf8'), `${prefix}${name.startsWith('native-peer.') ? 'helper' : 'built'}:${name}`)
  }
  if (process.platform !== 'win32') assert.ok((await stat(join(f.output, 'cli.mjs'))).mode & 0o100, 'the CLI retains owner execute permission')
  assert.deepEqual((await readdir(f.agent)).sort(), ['build.mjs', 'dist'], 'temporary publications are cleaned up')
})

test('Agent build: a compiler failure leaves the previous build intact', async t => {
  const f = await fixture(t)
  const result = await f.start('failure', true).done
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /synthetic compiler failure/)
  for (const name of ['index.mjs', 'cli.mjs', 'obsolete.mjs']) assert.equal(await readFile(join(f.output, name), 'utf8'), `old:${name}`)
})

test('Agent build: a linked output cannot overwrite a directory outside the Agent', async t => {
  const f = await fixture(t), outside = join(f.root, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'keep.txt'), 'retained')
  assert.equal(f.output, join(f.root, 'agent/dist'))
  await rm(f.output, { recursive: true, force: true })
  try { await symlink(outside, f.output, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('symlink permission unavailable'); throw error }
  const result = await f.start('linked', true).done
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /linked build output/)
  assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'retained')
})
