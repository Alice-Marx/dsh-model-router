// Real ConPTY multisession regression. Only isolated Node fixtures and their
// own exit-code observers are started; no vendor CLI, account or network is used.
// With utf8Console:true the native PTY PID is only the PowerShell launcher, so
// each fixture also records its real Node PID in fixture.pid (exclusive create,
// before any BOOT output) inside its isolated cwd. Independent ESRCH checks on
// those captured PIDs are observations only, not a general descendant-tree proof.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createTerminalManager, terminalEnvironment, loadPtyModule } from '../.dsh-plugin/shared/cli-terminal.mjs'

if (process.platform !== 'win32') {
  console.log('SKIP: Windows native ConPTY multisession regression')
} else if (!process.argv.includes('--worker')) {
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--worker'], { stdio: 'inherit', timeout: 120000 })
} else {
  const base = resolve(tmpdir())
  const directory = await mkdtemp(join(base, 'router-multisession-'))
  const natives = new Map()
  const observers = new Set()
  const pids = new Map()
  const fixturePids = new Map()
  const directories = new Map()
  const cleanup = {}
  const assertions = {}
  const ended = []
  const clock = { now: Date.now() }
  let manager
  let failure
  let result

  const bounded = async (promise, timeoutMs, description) => {
    let timer
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${description} timed out`)), timeoutMs) }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  const waitPidGone = async (label, pid) => {
    const deadline = Date.now() + 10000
    while (true) {
      try {
        process.kill(pid, 0)
      } catch (error) {
        assert.equal(error.code, 'ESRCH', `${label}: expected the captured real PID to be gone`)
        cleanup[label] = { pid, esrch: true }
        return
      }
      assert.ok(Date.now() < deadline, `${label}: PID ${pid} survived cleanup`)
      await delay(50)
    }
  }

  const assertProcessAlive = (label, pid) => {
    let alive = true
    try { process.kill(pid, 0) } catch { alive = false }
    assert.ok(alive, `${label}: PID ${pid} must still be alive before the action`)
  }

  const parseFixturePid = (text, label) => {
    const trimmed = String(text).trim()
    assert.match(trimmed, /^\d+$/, `${label}: fixture.pid must contain only the fixture PID digits`)
    const pid = Number(trimmed)
    assert.ok(Number.isInteger(pid) && pid > 0, `${label}: fixture PID must be a positive integer`)
    return pid
  }

  const observeExit = (label, pid) => {
    const powershell = join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
    const command = `$p=[Diagnostics.Process]::GetProcessById(${pid}); $null=$p.Handle; [Console]::WriteLine('ready'); if (-not $p.WaitForExit(15000)) { throw 'Process exit timed out' }; [Console]::WriteLine('exit:'+$p.ExitCode)`
    const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    })
    const observer = { label, child, stdout: '', stderr: '', closeCode: null, error: null, closed: null }
    child.stdout.on('data', data => { observer.stdout += data })
    child.stderr.on('data', data => { observer.stderr += data })
    observer.closed = new Promise(done => {
      child.once('error', error => { observer.error = error; done() })
      child.once('close', code => { observer.closeCode = code; done() })
    })
    observers.add(observer)
    return observer
  }

  const waitObserverReady = async observer => {
    const deadline = Date.now() + 10000
    while (!observer.stdout.includes('ready')) {
      assert.equal(observer.error, null, `${observer.label}: observer failed: ${observer.error}`)
      assert.ok(Date.now() < deadline, `${observer.label}: observer startup timed out: ${observer.stderr}`)
      await delay(25)
    }
  }

  const waitObservedExit = async (observer, expected) => {
    await bounded(observer.closed, 20000, `${observer.label} exit observer`)
    assert.equal(observer.error, null, `${observer.label}: observer error: ${observer.error}`)
    assert.equal(observer.closeCode, 0, `${observer.label}: observer failed: ${observer.stderr}`)
    assert.match(observer.stdout, new RegExp(`exit:${expected}\\b`), `${observer.label}: OS exit code must be ${expected}`)
  }

  try {
    const loaded = loadPtyModule()
    assert.equal(loaded.ok, true, `native PTY must load: ${loaded.error ?? ''}`)
    const require = createRequire(import.meta.url)
    const ptyPackage = JSON.parse(await readFile(join(dirname(require.resolve('@lydell/node-pty')), 'package.json'), 'utf8'))
    const labels = ['A', 'B', 'C', 'D']
    const markers = { A: '甲岫中文', B: '乙杉中文', C: '丙岚中文', D: '岑中文', E: '戊岳中文' }
    const colors = { A: '134;213;251', B: '190;242;100', C: '255;173;214', D: '255;196;110', E: '195;160;255' }
    for (const label of [...labels, 'E']) {
      const cwd = join(directory, `session-${label}-中文`)
      await mkdir(cwd)
      directories.set(label, cwd)
    }
    const entry = join(directory, "中文 & %PATH% O'Brien.mjs")
    await writeFile(entry, `import { writeSync, writeFileSync } from 'node:fs';
writeFileSync('fixture.pid', String(process.pid), { flag: 'wx' });
const [label, marker, color] = process.argv.slice(2);
const emit = text => writeSync(1, Buffer.from(text));
const size = () => process.stdout.columns + 'x' + process.stdout.rows;
emit('\\x1b[38;2;' + color + 'mBOOT:' + label + ':' + marker + ':isTTY=' + process.stdout.isTTY + ':' + size() + '\\x1b[0m\\r\\n');
process.stdin.setRawMode(true);
process.stdin.resume();
let input = '';
process.stdin.on('data', chunk => {
  input += chunk.toString('utf8');
  let index;
  while ((index = input.search(/[\\r\\n]/)) >= 0) {
    const line = input.slice(0, index);
    input = input.slice(index + 1);
    if (line.startsWith('ECHO ')) emit('ECHO:' + label + ':' + line.slice(5) + '\\r\\n');
    else if (line === 'SIZE') emit('SIZE:' + label + ':' + size() + ':isTTY=' + process.stdout.isTTY + '\\r\\n');
    else if (/^EXIT [07]$/.test(line)) {
      const code = Number(line.slice(5));
      emit('BYE:' + label + ':' + code + '\\r\\n');
      setTimeout(() => process.exit(code), 50);
    }
  }
});
`)

    const readFixturePid = async label => parseFixturePid(
      await readFile(join(directories.get(label), 'fixture.pid'), 'utf8'), label)

    manager = createTerminalManager({
      loadPty: () => ({ ...loaded, pty: { spawn(...args) {
        const native = loaded.pty.spawn(...args)
        const label = [...directories].find(([, cwd]) => cwd === args[2].cwd)?.[0]
        assert.ok(label, 'native PTY must belong to an isolated session directory')
        natives.set(label, native)
        return native
      } } }),
      resolveLaunch: async (_target, _mode, options) => {
        const label = [...directories].find(([, cwd]) => cwd === options.cwd)?.[0]
        assert.ok(label, 'fixture launch must belong to an isolated session directory')
        return { file: process.execPath, args: [entry, label, markers[label], colors[label]], utf8Console: true, display: `multisession fixture ${label}` }
      },
      environment: () => terminalEnvironment(),
      onSessionEnd: record => ended.push(record),
      now: () => clock.now,
    })
    assert.equal(manager.info().backend, 'pty', 'pipe fallback is forbidden in this regression')
    assertions.nativeConPTY = { backend: 'pty', ptyVersion: ptyPackage.version }

    const request = label => ({ target: 'shell', mode: 'interactive', cwd: directories.get(label), cols: 96, rows: 28, confirmed: true })
    const started = await Promise.all(labels.map(label => manager.start(request(label))))
    assert.equal(started.every(session => session.backend === 'pty'), true)
    assert.equal(manager.info().sessions.filter(session => !session.exited).length, 4)
    assertions.concurrentFour = { live: 4 }
    await assert.rejects(manager.start(request('E')), /最多同时运行 4 个/)
    assert.equal(natives.has('E'), false, 'the fifth request must not spawn while four are live')
    assertions.fifthRejected = { maxSessions: 4, spawned: false }

    const states = new Map(labels.map((label, index) => [label, { label, session: started[index], cursor: 0, text: '', lastRead: null }]))
    const readUntil = async (state, predicate, description) => {
      const deadline = Date.now() + 12000
      while (!predicate(state)) {
        assert.ok(Date.now() < deadline, `${description} timed out: ${JSON.stringify(state.text)}`)
        const output = await manager.read({ sessionId: state.session.sessionId, cursor: state.cursor, waitMs: 100 })
        state.text += output.data
        state.cursor = output.cursor
        state.lastRead = output
      }
      return state.lastRead
    }
    for (const label of labels) {
      const state = states.get(label)
      await readUntil(state, current => current.text.includes(`${markers[label]}:isTTY=true:96x28`), `fixture ${label} startup`)
      const native = natives.get(label)
      const pid = native?.pid
      assert.ok(Number.isInteger(pid) && pid > 0, `${label}: real native PID must be available`)
      pids.set(label, pid)
      const fixturePid = await readFixturePid(label)
      fixturePids.set(label, fixturePid)
      assert.notEqual(fixturePid, pid, `${label}: fixture PID must be recorded separately from the PowerShell launcher PID`)
      assertProcessAlive(`${label}:fixture`, fixturePid)
      assert.ok(state.text.includes(`\x1b[38;2;${colors[label]}m`), `${label}: distinct ANSI color must survive`)
      assert.ok(state.text.includes(`${markers[label]}:isTTY=true:96x28`), `${label}: CJK marker, TTY and initial size`)
      for (const other of labels.filter(item => item !== label)) assert.equal(state.text.includes(markers[other]), false, `${label} must not contain ${other} output`)
    }
    assert.equal(new Set(pids.values()).size, 4, 'all four real PTY PIDs must be distinct')
    assert.equal(new Set(fixturePids.values()).size, 4, 'all four fixture PIDs must be distinct')
    assertions.independentOutput = { cjk: true, ansi: true, isTTY: true, distinctPids: true, crossSessionOutput: false }
    assertions.fixtureIdentity = { perSessionPidFile: true, distinctFromLauncherPids: true, distinctFixturePids: true }

    const a = states.get('A')
    const beforeA = a.cursor
    const emptyA = await manager.read({ sessionId: a.session.sessionId, cursor: a.cursor, waitMs: 0 })
    assert.equal(emptyA.data, '')
    assert.equal(emptyA.cursor, beforeA)
    manager.write({ sessionId: a.session.sessionId, data: 'ECHO 仅甲输入中文\r' })
    await readUntil(a, state => state.text.includes('ECHO:A:仅甲输入中文'), 'session A input echo')
    for (const label of ['B', 'C', 'D']) {
      const state = states.get(label)
      const output = await manager.read({ sessionId: state.session.sessionId, cursor: state.cursor, waitMs: 0 })
      state.text += output.data
      state.cursor = output.cursor
      assert.equal(state.text.includes('仅甲输入中文'), false, `session A input must not reach ${label}`)
    }
    assertions.cursorAndInputIsolation = { independentCursors: true, crossSessionInput: false }

    assert.deepEqual(manager.resize({ sessionId: a.session.sessionId, cols: 117, rows: 37 }), { resized: true })
    manager.write({ sessionId: a.session.sessionId, data: 'SIZE\r' })
    await readUntil(a, state => state.text.includes('SIZE:A:117x37:isTTY=true'), 'session A resize')
    assertions.realResize = { cols: 117, rows: 37, childConfirmed: true }

    const exitObservers = {
      A: observeExit('A', pids.get('A')),
      B: observeExit('B', pids.get('B')),
    }
    await Promise.all(Object.values(exitObservers).map(waitObserverReady))
    assertProcessAlive('A:fixture', fixturePids.get('A'))
    assertProcessAlive('B:fixture', fixturePids.get('B'))
    manager.write({ sessionId: a.session.sessionId, data: 'EXIT 0\r' })
    const b = states.get('B')
    manager.write({ sessionId: b.session.sessionId, data: 'EXIT 7\r' })
    await Promise.all([waitObservedExit(exitObservers.A, 0), waitObservedExit(exitObservers.B, 7)])
    await readUntil(a, state => state.lastRead?.exited === true, 'session A manager exit')
    await readUntil(b, state => state.lastRead?.exited === true, 'session B manager exit')
    const exitCode = {
      A: { managerExitCode: a.lastRead.exitCode, osExitCode: 0 },
      B: { managerExitCode: b.lastRead.exitCode, osExitCode: 7 },
    }
    for (const [label, expected] of [['A', 0], ['B', 7]]) {
      const actual = exitCode[label].managerExitCode
      assert.ok(actual === null || actual === expected, `${label}: manager must not misreport the OS exit code`)
      exitCode[label].managerPropagation = actual === null ? 'unsupported-null' : 'supported'
    }
    assertions.normalExitCodes = { osObserved: [0, 7], managerNullObserved: Object.values(exitCode).some(item => item.managerExitCode === null) }
    await Promise.all([
      waitPidGone('A:launcher', pids.get('A')),
      waitPidGone('A:fixture', fixturePids.get('A')),
      waitPidGone('B:launcher', pids.get('B')),
      waitPidGone('B:fixture', fixturePids.get('B')),
    ])
    assertions.normalExitCodes.launcherPidGone = true
    assertions.normalExitCodes.fixturePidGone = true

    const c = states.get('C')
    assertProcessAlive('C:fixture', fixturePids.get('C'))
    const stopAccepted = manager.stop({ sessionId: c.session.sessionId })
    assert.equal(stopAccepted.stopped, false)
    assert.equal(stopAccepted.stopRequested, true)
    assert.equal(stopAccepted.stopConfirmed, false)
    const stopDeadline = Date.now() + 10000
    while (!manager.info().sessions.find(session => session.sessionId === c.session.sessionId)?.exited) {
      assert.ok(Date.now() < stopDeadline, 'stop manager exit timed out')
      await delay(25)
    }
    const stoppedSummary = manager.info().sessions.find(session => session.sessionId === c.session.sessionId)
    assert.equal(stoppedSummary.endReason, 'stopped')
    assert.equal(stoppedSummary.stopRequested, true)
    assert.equal(stoppedSummary.stopConfirmed, false)
    await waitPidGone('C:launcher', pids.get('C'))
    await waitPidGone('C:fixture', fixturePids.get('C'))
    assertions.stop = { stopped: false, endReason: 'stopped', hostExited: true, stopRequested: true, stopConfirmed: false, launcherPidGone: true, fixturePidGone: true }

    const d = states.get('D')
    clock.now += manager.info().limits.orphanTimeoutMs + 1
    assertProcessAlive('D:fixture', fixturePids.get('D'))
    manager.sweep()
    const orphanDeadline = Date.now() + 10000
    while (!manager.info().sessions.find(session => session.sessionId === d.session.sessionId)?.exited) {
      assert.ok(Date.now() < orphanDeadline, 'orphan sweep manager exit timed out')
      await delay(25)
    }
    const orphanSummary = manager.info().sessions.find(session => session.sessionId === d.session.sessionId)
    assert.equal(orphanSummary.endReason, 'orphan')
    assert.equal(orphanSummary.stopRequested, true)
    assert.equal(orphanSummary.stopConfirmed, false)
    await waitPidGone('D:launcher', pids.get('D'))
    await waitPidGone('D:fixture', fixturePids.get('D'))
    assertions.orphanSweep = { injectedClock: true, endReason: 'orphan', hostExited: true, stopRequested: true, stopConfirmed: false, launcherPidGone: true, fixturePidGone: true }

    const e = await manager.start(request('E'))
    assert.equal(e.backend, 'pty')
    const eState = { label: 'E', session: e, cursor: 0, text: '', lastRead: null }
    await readUntil(eState, state => state.text.includes('BOOT:E:'), 'fixture E startup')
    const ePid = natives.get('E')?.pid
    assert.ok(Number.isInteger(ePid) && ePid > 0)
    pids.set('E', ePid)
    const eFixturePid = await readFixturePid('E')
    fixturePids.set('E', eFixturePid)
    assert.notEqual(eFixturePid, ePid, 'E: fixture PID must differ from launcher PID')
    assertProcessAlive('E:fixture', eFixturePid)
    manager.disposeAll('dispose')
    assert.equal(manager.info().sessions.find(session => session.sessionId === e.sessionId)?.endReason, 'dispose')
    const disposeDeadline = Date.now() + 10000
    while (!manager.info().sessions.find(session => session.sessionId === e.sessionId)?.exited) {
      assert.ok(Date.now() < disposeDeadline, 'dispose manager exit timed out')
      await delay(25)
    }
    const disposeSummary = manager.info().sessions.find(session => session.sessionId === e.sessionId)
    assert.equal(disposeSummary.stopRequested, true)
    assert.equal(disposeSummary.stopConfirmed, false)
    await waitPidGone('E:launcher', ePid)
    await waitPidGone('E:fixture', eFixturePid)
    assertions.disposeAll = { endReason: 'dispose', hostExited: true, stopRequested: true, stopConfirmed: false, launcherPidGone: true, fixturePidGone: true }

    for (const [label, reason, requested] of [['A', 'exit', false], ['B', 'exit', false], ['C', 'stopped', true], ['D', 'orphan', true], ['E', 'dispose', true]]) {
      const sessionId = label === 'E' ? e.sessionId : states.get(label).session.sessionId
      const records = ended.filter(record => record.id === sessionId)
      assert.equal(records.length, 1, `${label}: exactly one real host-exit callback`)
      assert.equal(records[0].endReason, reason)
      assert.equal(records[0].stopRequested, requested)
      assert.equal(records[0].stopConfirmed, false)
    }
    assert.equal(ended.length, 5)
    assertions.sessionEndCallbacks = { exactlyOnce: true, total: 5, stopConfirmed: false }
    result = {
      status: 'PASS',
      platform: `${process.platform}-${process.arch}`,
      backend: 'native ConPTY',
      ptyVersion: ptyPackage.version,
      stopProof: { hostExitObserved: true, capturedPidObservationsOnly: true, descendantTreeConfirmed: false, testCleanupIsNotProductProof: true },
      assertions,
      exitCode,
      cleanup,
    }
  } catch (error) {
    failure = error
  } finally {
    const cleanupErrors = []
    try { manager?.disposeAll('cleanup') } catch (error) { cleanupErrors.push(error) }
    for (const native of natives.values()) {
      try { native.kill() } catch { /* already exited */ }
    }
    for (const observer of observers) {
      if (observer.closeCode === null && observer.error === null) {
        try { observer.child.kill() } catch { /* already exited */ }
      }
    }
    try {
      await bounded(Promise.all([...observers].map(observer => observer.closed)), 5000, 'observer cleanup')
    } catch (error) { cleanupErrors.push(error) }
    for (const [label, native] of natives) {
      const pid = pids.get(label) ?? native?.pid
      if (!Number.isInteger(pid) || pid <= 0 || cleanup[`${label}:launcher`]?.esrch) continue
      try { await waitPidGone(`${label}:launcher`, pid) } catch (error) { cleanupErrors.push(error) }
    }
    for (const [label, fixtureDirectory] of directories) {
      try {
        const pid = parseFixturePid(await readFile(join(fixtureDirectory, 'fixture.pid'), 'utf8'), label)
        if (fixturePids.has(label)) assert.equal(pid, fixturePids.get(label), `${label}: fixture PID record changed`)
        fixturePids.set(label, pid)
        if (!cleanup[`${label}:fixture`]?.esrch) await waitPidGone(`${label}:fixture`, pid)
      } catch (error) {
        if (error.code !== 'ENOENT' || fixturePids.has(label)) cleanupErrors.push(error)
      }
    }
    try {
      const part = relative(base, directory)
      assert.ok(part && !part.startsWith('..') && !isAbsolute(part) && !resolve(directory).startsWith('\\\\'), 'temporary directory must remain inside the OS tmpdir')
      await rm(directory, { recursive: true, force: true })
    } catch (error) { cleanupErrors.push(error) }
    if (cleanupErrors.length > 0) failure = new AggregateError([failure, ...cleanupErrors].filter(Boolean), 'multisession regression or cleanup failed')
  }

  if (failure) {
    console.error(failure)
    process.exit(1)
  }
  console.log(JSON.stringify(result))
  process.exit(0)
}
