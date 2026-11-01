import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { nativeProcess, resolveNativeHelper } from '../packages/cli-runtime/src/native-process.mjs'
import { CONTROL_SOURCE } from './fixtures/windows-process-job-control.mjs'
import { cliNativePeerBarrierSource } from './fixtures/cli-native-peer-barrier.mjs'

const hostedSkip = process.env.GITHUB_ACTIONS === 'true' && process.env.DSH_NATIVE_PEER_CI !== '1'
const enabled = process.platform === 'win32' && !hostedSkip
const real = (name, fn) => test(name, { skip: enabled ? false : process.platform !== 'win32' ? 'requires win32' : 'temporarily skipped in CI; run locally for real native-peer acceptance', timeout: 180_000 }, fn)
const worker = resolve('tests/fixtures/windows-process-job-worker.mjs')
const parentProgram = resolve('tests/fixtures/cli-native-peer-parent.mjs')
let build

async function compiled() {
  if (build) return build
  const root = resolve('tmp/integration/cli-native-peer-job-checks')
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'build-'))
  const base = await resolveNativeHelper({ home: dir })
  const source = await readFile(resolve('packages/cli-runtime/src/native-peer.ps1'), 'utf8')
  const helper = async (name, text) => {
    const script = join(dir, name)
    await writeFile(script, text)
    return Object.freeze({ ...base, prefix: base.prefix.map(value => value.endsWith('native-peer.ps1') ? script : value) })
  }
  const barrier = await helper('native-peer-barrier.ps1', cliNativePeerBarrierSource(source))
  const legacy = await helper('native-peer-legacy.ps1', cliNativePeerBarrierSource(source, { legacy: true }))
  const compiler = join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  const controlSource = join(dir, 'control.cs'), control = join(dir, 'control.exe')
  await writeFile(controlSource, CONTROL_SOURCE)
  execFileSync(compiler, ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu', '/out:' + control, '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Web.Extensions.dll', controlSource], { windowsHide: true })
  build = { root, production: base, barrier, legacy, control }
  return build
}

async function wait(fn, ms = 60_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await sleep(25)
  }
  throw new Error('CLI native-peer fixture did not reach the expected state')
}
const json = path => readFile(path, 'utf8').then(JSON.parse).catch(() => null)
const within = (promise, ms = 60_000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CLI native-peer fixture close timeout')), ms)
  promise.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
})
function message(proc, predicate = () => true, ms = 60_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { clean(); reject(new Error(`CLI_MESSAGE_TIMEOUT: ${proc.stderr}`)) }, ms)
    const clean = () => { clearTimeout(timer); proc.events.off('message', receive); proc.events.off('failure', failed); proc.events.off('closed', closed) }
    const receive = value => { if (predicate(value)) { clean(); resolve(value) } }
    const failed = error => { clean(); reject(error) }
    const closed = () => { clean(); reject(new Error(`CLI_MESSAGE_CLOSED: ${proc.stderr}`)) }
    proc.events.on('message', receive); proc.events.once('failure', failed); proc.events.once('closed', closed)
  })
}

async function fixture(t) {
  const b = await compiled(), dir = await mkdtemp(join(b.root, 'case-')), home = join(dir, 'home')
  await mkdir(join(home, 'tmp'), { recursive: true })
  const owned = new Map(), running = []
  const inspect = pid => JSON.parse(execFileSync(b.control, ['query', String(pid)], { encoding: 'utf8', windowsHide: true }))
  const remember = (pid, expected) => {
    const value = inspect(pid)
    assert.equal(value.alive, true)
    if (expected) assert.equal(value.creation, expected)
    owned.set(pid, value.creation)
    return value
  }
  const kill = pid => {
    const expected = owned.get(pid)
    if (!expected) return
    const value = inspect(pid)
    if (value.alive) {
      assert.equal(value.creation, expected, 'an owned PID was reused')
      execFileSync(b.control, ['kill', String(pid), expected], { windowsHide: true })
    }
  }
  function launch(helper, spec) {
    const proc = nativeProcess(helper, 'supervise', spec, { home })
    const record = { proc, exited: new Promise(resolve => proc.child.once('exit', (code, signal) => resolve({ code, signal }))) }
    running.push(record)
    return record
  }
  function launchParent(request) {
    const requestFile = join(dir, 'request.json')
    return writeFile(requestFile, JSON.stringify(request)).then(() => {
      const child = spawn(process.execPath, [parentProgram, dir, requestFile], { cwd: dir, windowsHide: true, stdio: 'ignore' })
      const record = { child, closed: new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })) }) }
      record.closed.catch(() => {})
      running.push(record)
      return record
    })
  }
  const request = (mode = 'report', args = [], patch = {}) => ({ executable: process.execPath, args: [worker, mode, ...args], cwd: dir, ttlMs: 60_000, ...patch })
  t.after(async () => {
    for (const record of running) {
      const child = record.child ?? record.proc.child
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    for (const [pid] of owned) kill(pid)
    await Promise.all(running.map(record => within(record.closed ?? record.proc.exit).catch(() => null)))
  })
  return { ...b, dir, home, inspect, remember, kill, launch, launchParent, request }
}

real('CLI native-peer: exact Unicode argv, framed output and nonzero child exit survive native creation', async t => {
  const f = await fixture(t)
  const args = ['a b', '中文路径/文件', 'say "hi"', 'C:\\dir\\', 'line1\nline2', '', '\\', '\\\\', 'tab\there']
  const report = f.launch(f.production, f.request('report', args)), stopped = report.proc.waitControl('stopped', 45_000)
  assert.deepEqual((await message(report.proc)).args, args)
  const reportStop = await stopped
  assert.equal(reportStop.reason, 'exited'); assert.equal(reportStop.exitCode, 0); assert.equal(reportStop.treeStopped, true)
  await within(report.proc.exit)
  const exit = f.launch(f.production, f.request('exit7')), exitStopped = exit.proc.waitControl('stopped', 45_000)
  assert.equal((await exitStopped).exitCode, 7)
  await within(exit.proc.exit)
})

real('CLI native-peer: normal direct-child exit kills its descendant and preserves stopped evidence', async t => {
  const f = await fixture(t), ready = join(f.dir, 'ready.json'), marker = join(f.dir, 'late')
  const r = f.launch(f.production, f.request('exit-with-child', [ready, marker])), stopped = r.proc.waitControl('stopped', 45_000)
  const info = await wait(() => json(ready)); if (f.inspect(info.descendantPid).alive) f.remember(info.descendantPid)
  assert.equal((await stopped).treeStopped, true)
  await within(r.proc.exit)
  await wait(() => !f.inspect(info.descendantPid).alive)
  await sleep(1000); assert.equal(await readFile(marker, 'utf8').catch(() => null), null)
})

real('CLI native-peer: EOF cancellation retains native stop evidence', async t => {
  const f = await fixture(t), r = f.launch(f.production, f.request('hold'))
  await r.proc.waitControl('spawned', 45_000)
  const stopped = r.proc.waitControl('stopped', 45_000); r.proc.end()
  const value = await stopped
  assert.equal(value.reason, 'cancelled'); assert.equal(value.treeStopped, true); assert.equal(value.exitCode, 137)
  await within(r.proc.exit)
})

real('CLI native-peer: a child that stops reading stdin cannot wedge the deadline or the stop evidence', async t => {
  const f = await fixture(t), r = f.launch(f.production, f.request('hold', [], { ttlMs: 45_000 }))
  await r.proc.waitControl('spawned', 45_000)
  const stopped = r.proc.waitControl('stopped', 45_000)
  // The hold worker never reads stdin: the relay queue and the child pipe both
  // fill far beyond capacity, which used to block the supervisor forever.
  const big = 'x'.repeat(60_000)
  for (let n = 0; n < 160; n++) r.proc.child.stdin.write(big + '\n')
  const value = await stopped
  assert.equal(value.reason, 'input-stalled'); assert.equal(value.treeStopped, true); assert.equal(value.exitCode, 137)
  await within(r.proc.exit)
})

real('CLI native-peer: relay writes racing a fast child exit keep the graceful stopped frame', async t => {
  const f = await fixture(t), r = f.launch(f.production, f.request('exit7')), stopped = r.proc.waitControl('stopped', 45_000)
  await r.proc.waitControl('spawned', 45_000)
  r.proc.child.stdin.write('line\n'.repeat(64))
  const value = await stopped
  assert.equal(value.reason, 'exited'); assert.equal(value.exitCode, 7); assert.equal(value.treeStopped, true)
  await within(r.proc.exit)
})

real('CLI native-peer: unavailable executable fails closed and production ignores barrier fields', async t => {
  const f = await fixture(t)
  const missing = f.launch(f.production, f.request('report', [], { executable: join(f.dir, 'missing.exe') }))
  assert.equal((await within(missing.proc.exit)).code, 2)
  assert.match(missing.proc.stderr, /SPAWN_FAILED_/)
  const r = f.launch(f.production, f.request('report', [], { barrier: { stage: 'preCreate', dir: f.dir } }))
  await message(r.proc); await within(r.proc.exit)
  assert.equal(await json(join(f.dir, 'gate-preCreate.json')), null)
})

real('CLI native-peer: deterministic legacy create-before-assign death leaves a suspended child, then exact-identity cleanup reclaims it', async t => {
  const f = await fixture(t), r = f.launch(f.legacy, f.request('hold', [], { barrier: { stage: 'created', dir: f.dir } }))
  const gatePath = join(f.dir, 'gate-created.json')
  const gate = await wait(() => json(gatePath)).catch(async error => {
    // If the gate never parses, reclaim the suspended child by exact identity
    // recovered from the raw file instead of leaking it.
    const raw = await readFile(gatePath, 'utf8').catch(() => null)
    const pid = Number(/"childPid":(\d+)/.exec(raw ?? '')?.[1]), start = /"childStartFileTime":"(\d+)"/.exec(raw ?? '')?.[1]
    if (Number.isSafeInteger(pid) && pid > 0 && start) { f.remember(pid, start); f.kill(pid) }
    throw new Error(`${error.message}: ${r.proc.stderr}`)
  })
  assert.equal(gate.inJob, false); f.remember(gate.childPid, gate.childStartFileTime)
  r.proc.child.kill('SIGKILL'); await within(r.exited)
  assert.equal(f.inspect(gate.childPid).alive, true)
  f.kill(gate.childPid); await within(r.proc.exit)
  assert.equal(f.inspect(gate.childPid).alive, false)
})

for (const stage of ['preCreate', 'created', 'resumed']) real(`CLI native-peer: helper death at ${stage} cannot leave the atomically admitted tree alive`, async t => {
  const f = await fixture(t), ready = join(f.dir, 'ready.json'), marker = join(f.dir, 'late')
  const r = f.launch(f.barrier, f.request(stage === 'resumed' ? 'tree' : 'hold', stage === 'resumed' ? [ready, marker] : [], { barrier: { stage, dir: f.dir } }))
  const gate = await wait(() => json(join(f.dir, `gate-${stage}.json`)))
  if (stage === 'preCreate') {
    // No child exists yet; dying here must not create one afterwards either.
    assert.equal(gate.childPid, 0)
    r.proc.child.kill('SIGKILL'); await within(r.proc.exit)
    await sleep(500); assert.equal(await json(join(f.dir, 'gate-created.json')), null)
    return
  }
  assert.equal(gate.inJob, true); f.remember(gate.childPid, gate.childStartFileTime)
  let info
  if (stage === 'resumed') { info = await wait(() => json(ready)); f.remember(info.descendantPid) }
  r.proc.child.kill('SIGKILL'); await within(r.proc.exit)
  await wait(() => !f.inspect(gate.childPid).alive)
  if (info) await wait(() => !f.inspect(info.descendantPid).alive)
  await sleep(1000); assert.equal(await readFile(marker, 'utf8').catch(() => null), null)
})

for (const stage of ['preCreate', 'created', 'resumed']) real(`CLI native-peer: actual creator death at ${stage} ends its helper and original process tree`, async t => {
  const f = await fixture(t), ready = join(f.dir, 'ready.json'), marker = join(f.dir, 'late')
  const parent = await f.launchParent({ helper: f.barrier, home: f.home, spec: f.request(stage === 'resumed' ? 'tree' : 'hold', stage === 'resumed' ? [ready, marker] : [], { barrier: { stage, dir: f.dir } }) })
  const gate = await wait(() => json(join(f.dir, `gate-${stage}.json`)))
  f.remember(gate.wrapperPid, gate.wrapperStartFileTime)
  if (gate.childPid) { assert.equal(gate.inJob, true); f.remember(gate.childPid, gate.childStartFileTime) }
  let info
  if (stage === 'resumed') { info = await wait(() => json(ready)); f.remember(info.descendantPid) }
  parent.child.kill('SIGKILL'); await within(parent.closed)
  await wait(() => !f.inspect(gate.wrapperPid).alive)
  if (gate.childPid) await wait(() => !f.inspect(gate.childPid).alive)
  if (info) await wait(() => !f.inspect(info.descendantPid).alive)
  await sleep(1000); assert.equal(await readFile(marker, 'utf8').catch(() => null), null)
})
