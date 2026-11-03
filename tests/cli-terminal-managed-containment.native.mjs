import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { createWindowsManagedTerminal } from '../packages/cli-runtime/src/native-terminal.mjs'
import { CONTROL_SOURCE } from './fixtures/windows-process-job-control.mjs'
import { BREAKAWAY_SOURCE, cliNativeTerminalAdapterSource, cliNativeTerminalControlEndAdapterSource, cliNativeTerminalDataFaultHelperSource, cliNativeTerminalDeathHelperSource, cliNativeTerminalFrameAdapterSource, cliNativeTerminalQueryFaultHelperSource, cliNativeTerminalStopTimeoutHelperSource } from './fixtures/cli-native-terminal-containment.mjs'

const enabled = process.platform === 'win32'
const real = (name, fn) => test(name, { skip: enabled ? false : 'requires win32', timeout: 120_000, concurrency: 1 }, fn)
const treeFixture = resolve('tests/fixtures/cli-terminal-managed-containment-tree.mjs')
let build

async function compiled() {
  if (build) return build
  const root = resolve('tmp/integration/codex-takeover-k31/runtime')
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'build-'))
  const nativeProcessUrl = pathToFileURL(resolve('packages/cli-runtime/src/native-process.mjs')).href
  const adapter = join(dir, 'native-terminal.mjs')
  await writeFile(adapter, cliNativeTerminalAdapterSource(await readFile(resolve('packages/cli-runtime/src/native-terminal.mjs'), 'utf8'), nativeProcessUrl))
  await writeFile(join(dir, 'native-terminal-peer.ps1'), await readFile(resolve('packages/cli-runtime/src/native-terminal-peer.ps1'), 'utf8'))
  const controlSource = join(dir, 'control.cs'), control = join(dir, 'control.exe')
  const breakawaySource = join(dir, 'breakaway.cs'), breakaway = join(dir, 'breakaway.exe')
  await writeFile(controlSource, CONTROL_SOURCE)
  await writeFile(breakawaySource, BREAKAWAY_SOURCE)
  const compiler = join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  const compile = (output, source) => execFileSync(compiler, ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu', '/out:' + output, '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Web.Extensions.dll', source], { windowsHide: true })
  compile(control, controlSource)
  compile(breakaway, breakawaySource)
  build = { root, dir, adapter, control, breakaway }
  return build
}

async function wait(fn, ms = 30_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await sleep(25)
  }
  throw new Error('K31_WAIT_TIMEOUT')
}
const json = path => readFile(path, 'utf8').then(JSON.parse).catch(() => null)
const within = (promise, ms = 30_000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('K31_PROMISE_TIMEOUT')), ms)
  promise.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
})

async function fixture(t, mode, args = [], patch = {}) {
  const { k31Helper, k31Adapter, env: extraEnv, ...options } = patch
  const b = await compiled(), dir = await mkdtemp(join(b.root, 'case-'))
  const outputParent = join(dir, 'output-parent'), tmp = join(dir, 'tmp')
  await mkdir(outputParent); await mkdir(tmp)
  const sentinel = join(outputParent, 'caller-sentinel')
  await writeFile(sentinel, 'preserve')
  const owned = new Map(), cleanups = []
  const inspect = pid => JSON.parse(execFileSync(b.control, ['query', String(pid)], { encoding: 'utf8', windowsHide: true }))
  const remember = (pid, expected) => {
    const value = inspect(pid)
    assert.equal(value.alive, true)
    if (expected) assert.equal(value.creation, expected)
    owned.set(pid, value.creation)
    return value
  }
  const dead = async (pid, expected) => {
    await wait(() => {
      const value = inspect(pid)
      return !value.alive || value.creation !== expected
    })
    const value = inspect(pid)
    assert.ok(!value.alive || value.creation !== expected)
  }
  const launch = mode === 'breakaway' ? {
    file: b.breakaway,
    args: [process.execPath, treeFixture, join(dir, 'breakaway-marker'), join(dir, 'breakaway-result.json')],
    utf8Console: false,
  } : {
    file: process.execPath,
    args: [treeFixture, mode, ...args],
    utf8Console: false,
  }
  let create = createWindowsManagedTerminal
  if (k31Helper || k31Adapter) {
    let adapterSource = cliNativeTerminalAdapterSource(await readFile(resolve('packages/cli-runtime/src/native-terminal.mjs'), 'utf8'), pathToFileURL(resolve('packages/cli-runtime/src/native-process.mjs')).href)
    if (k31Adapter) adapterSource = k31Adapter(adapterSource)
    await writeFile(join(dir, 'native-terminal.mjs'), adapterSource)
    const helperSource = await readFile(resolve('packages/cli-runtime/src/native-terminal-peer.ps1'), 'utf8')
    await writeFile(join(dir, 'native-terminal-peer.ps1'), k31Helper ? k31Helper(helperSource) : helperSource)
    create = (await import(pathToFileURL(join(dir, 'native-terminal.mjs')).href)).createWindowsManagedTerminal
  }
  const proc = await create({ launch, cwd: dir, cols: 80, rows: 30,
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.Path ?? '', TEMP: tmp, TMP: tmp, ...extraEnv },
    ttlMs: 60_000, privateOutput: outputParent, ...options })
  const events = { host: [], tree: [], output: [], lost: [] }
  proc.onExit(value => events.host.push(value))
  proc.onTreeClosed(value => events.tree.push(value))
  proc.onOutputClosed(value => events.output.push(value))
  proc.onControlLost(value => events.lost.push(value))
  remember(proc.pid, proc.startIdentity)
  t.after(async () => {
    if (!proc.treeClosed && !proc.controlLost) {
      cleanups.push('backend-stop')
      await proc.kill().catch(() => false)
    }
    await within(proc.closed, 10_000).catch(() => null)
    for (const [pid, identity] of owned) {
      const value = inspect(pid)
      if (value.alive && value.creation === identity) {
        cleanups.push(`exact-kill:${pid}`)
        execFileSync(b.control, ['kill', String(pid), identity], { windowsHide: true })
      }
    }
    assert.equal(await readFile(sentinel, 'utf8'), 'preserve')
    if (cleanups.length) console.log('K31_CLEANUP', JSON.stringify(cleanups))
  })
  return { ...b, dir, outputParent, proc, events, inspect, remember, dead }
}

async function resume(f) {
  const started = await f.proc.resume()
  assert.equal(started.pid, f.proc.pid)
  assert.equal(started.startIdentity, f.proc.startIdentity)
}

async function expectStoppedTree(f, ready) {
  await resume(f)
  const info = await wait(() => json(ready))
  info.childIdentity = f.remember(info.childPid).creation
  info.grandchildIdentity = f.remember(info.grandchildPid).creation
  assert.equal(f.proc.treeClosed, false)
  assert.equal(await f.proc.kill(), true)
  await wait(() => f.events.tree.length === 1)
  await within(f.proc.closed)
  assert.equal(f.events.tree[0].proof, 'windows-job-active-process-zero')
  assert.equal(f.events.tree[0].activeProcesses, 0)
  assert.equal(f.events.host.length, 1)
  assert.equal(f.events.output.length, 1)
  await f.dead(f.proc.pid, f.proc.startIdentity)
  return info
}

async function expectUnknownTreeCleanup(f, info, code, nativeCode) {
  await wait(() => f.events.lost.length === 1)
  assert.equal(f.events.lost[0].code, code)
  if (nativeCode) assert.equal(f.events.lost[0].nativeCode, nativeCode)
  const closed = await within(f.proc.closed)
  assert.equal(closed.runtimeCleaned, true)
  assert.equal(f.proc.controlLost, true)
  assert.equal(f.proc.treeClosed, false)
  assert.equal(f.events.tree.length, 0)
  await f.dead(f.proc.pid, f.proc.startIdentity)
  await f.dead(info.childPid, info.childIdentity)
  await f.dead(info.grandchildPid, info.grandchildIdentity)
  const marker = join(f.dir, 'late-marker')
  const before = await readFile(marker, 'utf8').catch(() => null)
  await sleep(4300)
  const after = await readFile(marker, 'utf8').catch(() => null)
  assert.equal(after, before)
  if (code !== 'NATIVE_TERMINAL_STOP_TIMEOUT') assert.equal(after, null)
  return closed
}

async function queryFaultCase(t, mode) {
  const f = await fixture(t, 'tree', ['ready.json', 'late-marker'], { k31Helper: cliNativeTerminalQueryFaultHelperSource, env: { K31_QUERY: mode } })
  await resume(f)
  const info = await wait(() => json(join(f.dir, 'ready.json')))
  info.childIdentity = f.remember(info.childPid).creation
  info.grandchildIdentity = f.remember(info.grandchildPid).creation
  await writeFile(join(f.dir, 'ready.json.armed'), 'armed')
  await expectUnknownTreeCleanup(f, info, 'NATIVE_TERMINAL_OPERATION_FAILED', 'JOB_QUERY_FAILED')
  console.log('K31_FAULT', JSON.stringify({ fault: `query-${mode}`, hostPid: f.proc.pid, childPid: info.childPid, grandchildPid: info.grandchildPid, productProof: 'unknown' }))
}

async function deathCase(t, barrier, victim) {
  const b = await compiled(), dir = await mkdtemp(join(b.root, 'death-'))
  const outputParent = join(dir, 'output-parent'), tmp = join(dir, 'tmp')
  await mkdir(outputParent); await mkdir(tmp)
  const sentinel = join(outputParent, 'caller-sentinel')
  await writeFile(sentinel, 'preserve')
  const adapter = join(dir, 'native-terminal.mjs')
  const nativeProcessUrl = pathToFileURL(resolve('packages/cli-runtime/src/native-process.mjs')).href
  await writeFile(adapter, cliNativeTerminalAdapterSource(await readFile(resolve('packages/cli-runtime/src/native-terminal.mjs'), 'utf8'), nativeProcessUrl))
  await writeFile(join(dir, 'native-terminal-peer.ps1'), cliNativeTerminalDeathHelperSource(await readFile(resolve('packages/cli-runtime/src/native-terminal-peer.ps1'), 'utf8')))
  const owned = new Map(), cleanups = []
  const inspect = pid => JSON.parse(execFileSync(b.control, ['query', String(pid)], { encoding: 'utf8', windowsHide: true }))
  const remember = (pid, expected) => {
    const value = inspect(pid)
    assert.equal(value.alive, true)
    if (expected) assert.equal(value.creation, expected)
    owned.set(pid, value.creation)
    return value
  }
  const dead = async (pid, expected) => {
    await wait(() => {
      const value = inspect(pid)
      return !value.alive || value.creation !== expected
    })
    const value = inspect(pid)
    assert.ok(!value.alive || value.creation !== expected)
  }
  const hostMode = barrier === 'hostExited' ? 'host-exit' : 'tree'
  const launcher = spawn(process.execPath, [treeFixture, 'launcher', adapter, dir, hostMode, barrier, barrier === 'created' ? 'hold' : 'resume'], { stdio: 'ignore', windowsHide: true })
  remember(launcher.pid)
  t.after(async () => {
    for (const [pid, identity] of owned) {
      const value = inspect(pid)
      if (value.alive && value.creation === identity) {
        cleanups.push(`exact-kill:${pid}`)
        execFileSync(b.control, ['kill', String(pid), identity], { windowsHide: true })
      }
    }
    assert.equal(await readFile(sentinel, 'utf8'), 'preserve')
    if (cleanups.length) console.log('K31_CLEANUP', JSON.stringify(cleanups))
  })
  const helper = await wait(() => json(join(outputParent, 'helper-pid.json')))
  remember(helper.pid)
  await wait(() => json(join(outputParent, `helper-barrier-${barrier}.json`)))
  let host = null, descendants = null
  if (barrier !== 'preCreate') {
    host = await wait(() => json(join(dir, 'launcher-ready.json')))
    assert.equal(host.launcherPid, launcher.pid)
    if (barrier === 'hostExited') {
      const value = inspect(host.hostPid)
      assert.equal(value.alive, false)
      assert.equal(value.creation, host.hostIdentity)
      owned.set(host.hostPid, value.creation)
    } else remember(host.hostPid, host.hostIdentity)
  }
  if (barrier === 'resumed' || barrier === 'hostExited') {
    descendants = await wait(() => json(join(dir, 'ready.json')))
    remember(descendants.childPid)
    remember(descendants.grandchildPid)
  }
  if (barrier === 'hostExited') assert.equal((await wait(() => json(join(dir, 'host-event.json')))).exitCode, 0)
  const victimPid = victim === 'creator' ? launcher.pid : helper.pid
  const victimIdentity = owned.get(victimPid)
  execFileSync(b.control, ['kill', String(victimPid), victimIdentity], { windowsHide: true })
  await dead(victimPid, victimIdentity)
  if (victim === 'creator') {
    await dead(helper.pid, owned.get(helper.pid))
  } else if (barrier === 'preCreate') {
    const failure = await wait(() => json(join(dir, 'factory-error.json')))
    assert.equal(failure.code, 'NATIVE_TERMINAL_CONTROL_LOST')
  } else {
    const lost = await wait(() => json(join(dir, 'lost-event.json')))
    const closed = await wait(() => json(join(dir, 'closed-event.json')))
    assert.equal(lost.code, 'NATIVE_TERMINAL_CONTROL_LOST')
    assert.equal(lost.treeClosed, false)
    assert.equal(closed.runtimeCleaned, true)
  }
  assert.equal(await json(join(dir, 'tree-event.json')), null)
  for (const [pid, identity] of owned) await dead(pid, identity)
  if (descendants) {
    await sleep(4300)
    assert.equal(await readFile(join(dir, 'late-marker'), 'utf8').catch(() => null), null)
  }
  assert.equal(await readFile(sentinel, 'utf8'), 'preserve')
  console.log('K31_DEATH', JSON.stringify({ barrier, victim, launcherPid: launcher.pid, helperPid: helper.pid, hostPid: host?.hostPid ?? null, childPid: descendants?.childPid ?? null, grandchildPid: descendants?.grandchildPid ?? null, productProof: 'unknown', actualCleanup: 'all-registered-pid-identity-exited' }))
}

real('C matrix: preCreate creator death cleans owned resources with product proof unknown', async t => {
  await deathCase(t, 'preCreate', 'creator')
})

real('C matrix: preCreate helper death reports control loss with product proof unknown', async t => {
  await deathCase(t, 'preCreate', 'helper')
})

real('C matrix: created-suspended creator death cleans the host with product proof unknown', async t => {
  await deathCase(t, 'created', 'creator')
})

real('C matrix: created-suspended helper death reports control loss with product proof unknown', async t => {
  await deathCase(t, 'created', 'helper')
})

real('C matrix: resumed creator death cleans the live tree with product proof unknown', async t => {
  await deathCase(t, 'resumed', 'creator')
})

real('C matrix: resumed helper death reports control loss with product proof unknown', async t => {
  await deathCase(t, 'resumed', 'helper')
})

real('C matrix: hostExited creator death cleans live descendants with product proof unknown', async t => {
  await deathCase(t, 'hostExited', 'creator')
})

real('C matrix: hostExited helper death reports control loss with product proof unknown', async t => {
  await deathCase(t, 'hostExited', 'helper')
})

real('C matrix: QueryJob failure keeps proof unknown and reclaims the live tree', async t => {
  await queryFaultCase(t, 'fail')
})

real('C matrix: QueryJob invalid return length keeps proof unknown and reclaims the live tree', async t => {
  await queryFaultCase(t, 'bad-length')
})

real('C matrix: stop timeout keeps proof unknown and reclaims the live tree', async t => {
  const f = await fixture(t, 'tree', ['ready.json', 'late-marker'], { k31Helper: cliNativeTerminalStopTimeoutHelperSource, env: { K31_STOP_TIMEOUT: '1' } })
  await resume(f)
  const info = await wait(() => json(join(f.dir, 'ready.json')))
  info.childIdentity = f.remember(info.childPid).creation
  info.grandchildIdentity = f.remember(info.grandchildPid).creation
  await assert.rejects(f.proc.kill(), error => error.code === 'NATIVE_TERMINAL_STOP_TIMEOUT')
  await expectUnknownTreeCleanup(f, info, 'NATIVE_TERMINAL_STOP_TIMEOUT')
  console.log('K31_FAULT', JSON.stringify({ fault: 'stop-timeout', hostPid: f.proc.pid, childPid: info.childPid, grandchildPid: info.grandchildPid, productProof: 'unknown' }))
})

real('C matrix: data channel fault keeps proof unknown and reclaims the live tree', async t => {
  const f = await fixture(t, 'tree', ['ready.json', 'late-marker'], { k31Helper: cliNativeTerminalDataFaultHelperSource, env: { K31_DATA_FAULT: '1' } })
  await resume(f)
  const info = await wait(() => json(join(f.dir, 'ready.json')))
  info.childIdentity = f.remember(info.childPid).creation
  info.grandchildIdentity = f.remember(info.grandchildPid).creation
  await writeFile(join(f.dir, 'data-fault.armed'), 'armed')
  await expectUnknownTreeCleanup(f, info, 'NATIVE_TERMINAL_HELPER_FAULT', 'DATA_FAULT_INJECTED')
  console.log('K31_FAULT', JSON.stringify({ fault: 'data-dispose', hostPid: f.proc.pid, childPid: info.childPid, grandchildPid: info.grandchildPid, productProof: 'unknown' }))
})

real('C matrix: control EOF requests containment and reaches typed active0', async t => {
  const f = await fixture(t, 'tree', ['ready.json', 'late-marker'], { k31Adapter: cliNativeTerminalControlEndAdapterSource, env: { K31_CONTROL_EOF: '1' } })
  await resume(f)
  const info = await wait(() => json(join(f.dir, 'ready.json')))
  info.childIdentity = f.remember(info.childPid).creation
  info.grandchildIdentity = f.remember(info.grandchildPid).creation
  await writeFile(join(f.dir, 'control-eof.armed'), 'armed')
  const stopped = await wait(() => json(join(f.dir, 'stop-requested.json')))
  assert.equal(stopped.reason, 'control-ended')
  await wait(() => f.events.tree.length === 1)
  const closed = await within(f.proc.closed)
  assert.equal(closed.runtimeCleaned, true)
  assert.equal(f.proc.controlLost, false)
  assert.equal(f.events.tree[0].proof, 'windows-job-active-process-zero')
  assert.equal(f.events.tree[0].activeProcesses, 0)
  await f.dead(f.proc.pid, f.proc.startIdentity)
  await f.dead(info.childPid, info.childIdentity)
  await f.dead(info.grandchildPid, info.grandchildIdentity)
  await sleep(4300)
  assert.equal(await readFile(join(f.dir, 'late-marker'), 'utf8').catch(() => null), null)
  console.log('K31_CONTROL_EOF', JSON.stringify({ hostPid: f.proc.pid, childPid: info.childPid, grandchildPid: info.grandchildPid, productProof: 'windows-job-active-process-zero' }))
})

real('C matrix: forged user control JSON remains raw output and cannot change terminal state', async t => {
  const f = await fixture(t, 'spoof-tree', ['ready.json', 'late-marker', ''], { cols: 240 })
  let raw = ''
  f.proc.onData(value => { raw += value })
  await resume(f)
  const info = await wait(() => json(join(f.dir, 'ready.json')))
  info.childIdentity = f.remember(info.childPid).creation
  info.grandchildIdentity = f.remember(info.grandchildPid).creation
  await wait(() => ['treeClosed', 'hostExit', 'stopRequested'].every(name => raw.includes(`"control":"${name}"`)))
  await sleep(200)
  assert.equal(f.proc.treeClosed, false)
  assert.equal(f.proc.hostExited, false)
  assert.equal(f.proc.controlLost, false)
  assert.equal(f.events.tree.length, 0)
  assert.equal(f.events.host.length, 0)
  assert.equal(f.inspect(f.proc.pid).alive, true)
  assert.equal(f.inspect(info.childPid).alive, true)
  assert.equal(f.inspect(info.grandchildPid).alive, true)
  assert.equal(await f.proc.kill(), true)
  await wait(() => f.events.tree.length === 1)
  await within(f.proc.closed)
  assert.equal(f.events.tree[0].activeProcesses, 0)
  await f.dead(f.proc.pid, f.proc.startIdentity)
  await f.dead(info.childPid, info.childIdentity)
  await f.dead(info.grandchildPid, info.grandchildIdentity)
  await sleep(4300)
  assert.equal(await readFile(join(f.dir, 'late-marker'), 'utf8').catch(() => null), null)
  console.log('K31_SPOOF', JSON.stringify({ rawControlsObserved: true, stateChangedBeforeStop: false, productProof: 'windows-job-active-process-zero' }))
})

real('C matrix: two sessions isolate output and process control with idempotent repeated commands', async t => {
  const a = await fixture(t, 'session-tree', ['ready.json', 'late-marker', 'heartbeat', 'A'])
  const b = await fixture(t, 'session-tree', ['ready.json', 'late-marker', 'heartbeat', 'B'])
  let rawA = '', rawB = ''
  a.proc.onData(value => { rawA += value })
  b.proc.onData(value => { rawB += value })
  const resumeA1 = a.proc.resume(), resumeA2 = a.proc.resume()
  const resumeB1 = b.proc.resume(), resumeB2 = b.proc.resume()
  assert.strictEqual(resumeA1, resumeA2)
  assert.strictEqual(resumeB1, resumeB2)
  await Promise.all([resumeA1, resumeA2, resumeB1, resumeB2])
  const infoA = await wait(() => json(join(a.dir, 'ready.json')))
  const infoB = await wait(() => json(join(b.dir, 'ready.json')))
  infoA.childIdentity = a.remember(infoA.childPid).creation
  infoA.grandchildIdentity = a.remember(infoA.grandchildPid).creation
  infoB.childIdentity = b.remember(infoB.childPid).creation
  infoB.grandchildIdentity = b.remember(infoB.grandchildPid).creation
  assert.notEqual(a.proc.pid, b.proc.pid)
  assert.notEqual(infoA.childPid, infoB.childPid)
  await wait(() => rawA.includes('SESSION_A') && rawB.includes('SESSION_B'))
  assert.equal(rawA.includes('SESSION_B'), false)
  assert.equal(rawB.includes('SESSION_A'), false)
  const stopA1 = a.proc.kill(), stopA2 = a.proc.kill()
  assert.strictEqual(stopA1, stopA2)
  assert.equal(await stopA1, true)
  assert.equal(await stopA2, true)
  await wait(() => a.events.tree.length === 1)
  await within(a.proc.closed)
  assert.equal(a.events.tree[0].activeProcesses, 0)
  assert.equal(b.proc.treeClosed, false)
  assert.equal(b.proc.hostExited, false)
  assert.equal(b.proc.controlLost, false)
  const heartbeatBefore = await readFile(join(b.dir, 'heartbeat'), 'utf8')
  await sleep(300)
  assert.ok((await readFile(join(b.dir, 'heartbeat'), 'utf8')).length > heartbeatBefore.length)
  assert.equal(b.inspect(b.proc.pid).alive, true)
  assert.equal(b.inspect(infoB.childPid).alive, true)
  assert.equal(b.inspect(infoB.grandchildPid).alive, true)
  assert.equal(await a.proc.kill(), false)
  const lateResume = await a.proc.resume()
  assert.equal(lateResume.pid, a.proc.pid)
  assert.equal(lateResume.startIdentity, a.proc.startIdentity)
  assert.equal(await b.proc.kill(), true)
  await wait(() => b.events.tree.length === 1)
  await within(b.proc.closed)
  assert.equal(b.events.tree[0].activeProcesses, 0)
  for (const [f, info] of [[a, infoA], [b, infoB]]) {
    await f.dead(f.proc.pid, f.proc.startIdentity)
    await f.dead(info.childPid, info.childIdentity)
    await f.dead(info.grandchildPid, info.grandchildIdentity)
  }
  await sleep(4300)
  assert.equal(await readFile(join(a.dir, 'late-marker'), 'utf8').catch(() => null), null)
  assert.equal(await readFile(join(b.dir, 'late-marker'), 'utf8').catch(() => null), null)
  console.log('K31_SESSIONS', JSON.stringify({ aHostPid: a.proc.pid, bHostPid: b.proc.pid, outputIsolated: true, bSurvivedAStop: true, repeatedResume: 'same-promise', repeatedStop: 'same-promise', productProof: 'typed-active0-each' }))
})

real('C matrix: duplicate started frame is rejected without a fake tree closure', async t => {
  const f = await fixture(t, 'tree', ['ready.json', 'late-marker'], { k31Adapter: cliNativeTerminalFrameAdapterSource, env: { K31_DUPLICATE_STARTED: '1' } })
  await resume(f)
  const info = await wait(() => json(join(f.dir, 'ready.json')))
  info.childIdentity = f.remember(info.childPid).creation
  info.grandchildIdentity = f.remember(info.grandchildPid).creation
  await writeFile(join(f.dir, 'duplicate-started.armed'), 'armed')
  await expectUnknownTreeCleanup(f, info, 'NATIVE_TERMINAL_PROTOCOL_START')
  console.log('K31_FRAME', JSON.stringify({ frame: 'duplicate-started', verdict: 'rejected', productProof: 'unknown' }))
})

real('C matrix: late hostExit frame after real typed active0 is ignored', async t => {
  const f = await fixture(t, 'tree', ['ready.json', 'late-marker'], { k31Adapter: cliNativeTerminalFrameAdapterSource, env: { K31_LATE_FRAME: '1' } })
  await resume(f)
  const info = await wait(() => json(join(f.dir, 'ready.json')))
  info.childIdentity = f.remember(info.childPid).creation
  info.grandchildIdentity = f.remember(info.grandchildPid).creation
  assert.equal(await f.proc.kill(), true)
  await wait(() => f.events.tree.length === 1)
  await within(f.proc.closed)
  const late = await wait(() => json(join(f.dir, 'late-frame-attempt.json')))
  assert.equal(late.control, 'hostExit')
  assert.equal(late.pid, f.proc.pid)
  await sleep(200)
  assert.equal(f.events.host.length, 1)
  assert.equal(f.events.tree.length, 1)
  assert.equal(f.events.lost.length, 0)
  assert.equal(f.proc.controlLost, false)
  assert.equal(f.proc.treeClosed, true)
  assert.equal(f.events.tree[0].activeProcesses, 0)
  await f.dead(f.proc.pid, f.proc.startIdentity)
  await f.dead(info.childPid, info.childIdentity)
  await f.dead(info.grandchildPid, info.grandchildIdentity)
  await sleep(4300)
  assert.equal(await readFile(join(f.dir, 'late-marker'), 'utf8').catch(() => null), null)
  console.log('K31_FRAME', JSON.stringify({ frame: 'late-hostExit', verdict: 'ignored-after-real-typed0', productProof: 'windows-job-active-process-zero' }))
})

real('C matrix: uncooperative parent child and grandchild share the Job and cannot write after typed active0', async t => {
  const ready = 'ready.json', marker = 'late-marker'
  const f = await fixture(t, 'tree', [ready, marker])
  const info = await expectStoppedTree(f, join(f.dir, ready))
  await f.dead(info.childPid, info.childIdentity)
  await f.dead(info.grandchildPid, info.grandchildIdentity)
  await sleep(4300)
  assert.equal(await readFile(join(f.dir, marker), 'utf8').catch(() => null), null)
})

real('C matrix: host exit leaves live descendants until backend stop obtains typed active0', async t => {
  const ready = 'ready.json', marker = 'late-marker', heartbeat = 'heartbeat'
  const f = await fixture(t, 'host-exit', [ready, marker, heartbeat])
  await resume(f)
  const info = await wait(() => json(join(f.dir, ready)))
  info.childIdentity = f.remember(info.childPid).creation
  info.grandchildIdentity = f.remember(info.grandchildPid).creation
  await wait(() => f.events.host.length === 1)
  assert.equal(f.events.host[0].exitCode, 0)
  assert.equal(f.proc.hostExited, true)
  assert.equal(f.proc.treeClosed, false)
  assert.equal(f.events.tree.length, 0)
  const before = await readFile(join(f.dir, heartbeat), 'utf8')
  await sleep(300)
  const after = await readFile(join(f.dir, heartbeat), 'utf8')
  assert.ok(after.length > before.length)
  assert.equal(await f.proc.kill(), true)
  await wait(() => f.events.tree.length === 1)
  await within(f.proc.closed)
  assert.equal(f.events.tree[0].activeProcesses, 0)
  assert.equal(f.events.host.length, 1)
  await f.dead(f.proc.pid, f.proc.startIdentity)
  await f.dead(info.childPid, info.childIdentity)
  await f.dead(info.grandchildPid, info.grandchildIdentity)
  await sleep(4300)
  assert.equal(await readFile(join(f.dir, marker), 'utf8').catch(() => null), null)
})

real('C matrix: natural host and descendants close only after the final normal exit', async t => {
  const ready = 'natural-ready.json', heartbeat = 'natural-heartbeat'
  const grandchildExit = 'natural-grandchild-exit', childExit = 'natural-child-exit'
  const f = await fixture(t, 'natural-host', [ready, heartbeat, grandchildExit, childExit])
  await resume(f)
  const info = await wait(() => json(join(f.dir, ready)))
  info.childIdentity = f.remember(info.childPid).creation
  info.grandchildIdentity = f.remember(info.grandchildPid).creation
  await wait(() => f.events.host.length === 1)
  assert.equal(f.events.host[0].exitCode, 0)
  assert.equal(f.proc.hostExited, true)
  assert.equal(f.proc.treeClosed, false)
  const before = await readFile(join(f.dir, heartbeat), 'utf8')
  await sleep(300)
  assert.ok((await readFile(join(f.dir, heartbeat), 'utf8')).length > before.length)
  await f.dead(info.grandchildPid, info.grandchildIdentity)
  assert.equal(await readFile(join(f.dir, grandchildExit), 'utf8'), 'grandchild\n')
  assert.equal(f.inspect(info.childPid).alive, true)
  assert.equal(f.proc.treeClosed, false)
  assert.equal(f.events.tree.length, 0)
  await f.dead(info.childPid, info.childIdentity)
  await wait(() => f.events.tree.length === 1)
  await within(f.proc.closed)
  assert.equal(f.events.tree[0].proof, 'windows-job-active-process-zero')
  assert.equal(f.events.tree[0].activeProcesses, 0)
  assert.equal(await readFile(join(f.dir, childExit), 'utf8'), 'child\n')
  assert.equal(f.events.host.length, 1)
  assert.equal(f.events.output.length, 1)
  assert.equal(f.proc.outputTruncated, false)
})

real('C matrix: native CREATE_BREAKAWAY_FROM_JOB is refused without an escaped descendant', async t => {
  const f = await fixture(t, 'breakaway')
  await resume(f)
  const result = await wait(() => json(join(f.dir, 'breakaway-result.json')))
  assert.equal(result.attempted, true)
  assert.equal(result.flags, 0x01000000 | 0x00000004 | 0x00000400)
  assert.equal(result.created, false)
  assert.equal(result.win32, 5)
  assert.equal(result.pid, 0)
  await wait(() => f.events.host.length === 1)
  assert.equal(f.events.host[0].exitCode, 0)
  await wait(() => f.events.tree.length === 1)
  await within(f.proc.closed)
  assert.equal(f.events.tree[0].proof, 'windows-job-active-process-zero')
  assert.equal(f.events.tree[0].activeProcesses, 0)
  await f.dead(f.proc.pid, f.proc.startIdentity)
  await sleep(1500)
  assert.equal(await readFile(join(f.dir, 'breakaway-marker'), 'utf8').catch(() => null), null)
})
