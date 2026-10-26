// Real ConPTY regression, isolated so native PTY threads cannot hold the test
// runner open. No vendor CLI, credentials, network or model request is used.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createTerminalManager, terminalEnvironment, loadPtyModule } from '../.dsh-plugin/shared/cli-terminal.mjs'

if (process.platform !== 'win32') {
  console.log('SKIP: Windows ConPTY UTF-8 regression')
} else if (!process.argv.includes('--worker')) {
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--worker'], { stdio: 'inherit', timeout: 30000 })
} else {
  const base = resolve(tmpdir())
  const directory = await mkdtemp(join(base, 'router-utf8-'))
  const entry = join(directory, "中文 & %PATH% O'Brien.mjs")
  const argument = "中文 & %PATH% O'Brien"
  const expected = '╔═中文框线═╗'
  await writeFile(entry, `import {writeSync} from 'node:fs';
import assert from 'node:assert/strict';
assert.equal(process.argv[2], ${JSON.stringify(argument)});
process.stdin.setRawMode(true);
writeSync(1, Buffer.from('\\x1b[38;2;134;213;251m${expected}\\x1b[0m\\r\\n'));
let input=''; process.stdin.on('data',chunk=>{input+=chunk.toString('utf8');if(input.includes('\\r')) {
writeSync(1,Buffer.from('echo:'+input.trim()+'\\r\\n')); setTimeout(()=>process.exit(7),200);
}});`)
  const loaded = loadPtyModule()
  assert.equal(loaded.ok, true, 'native PTY must load')
  let native
  const manager = createTerminalManager({
    loadPty: () => ({ ...loaded, pty: { spawn(...args) { native = loaded.pty.spawn(...args); return native } } }),
    resolveLaunch: async () => ({ file: process.execPath, args: [entry, argument], utf8Console: true, display: 'UTF-8 regression fixture' }),
    environment: () => terminalEnvironment(),
  })
  let observer
  let failure
  try {
    assert.equal(manager.info().backend, 'pty', 'native PTY must load')
    const session = await manager.start({ target: 'zcode', mode: 'interactive', cwd: directory, cols: 100, rows: 30, confirmed: true })
    let cursor = 0, output = '', ended = false
    const deadline = Date.now() + 15000
    while (!output.includes(expected)) {
      assert.ok(Date.now() < deadline, `UTF-8 startup timed out: ${JSON.stringify(output)}`)
      const read = await manager.read({ sessionId: session.sessionId, cursor, waitMs: 100 })
      output += read.data; cursor = read.cursor
      assert.equal(read.exited, false, 'fixture must remain interactive')
    }
    // ConPTY's real PID is available only after its asynchronous pipe startup.
    const pid = native.pid
    assert.ok(Number.isInteger(pid) && pid > 0)
    // Keep a process handle before exit: this node-pty build can omit exitCode.
    observer = spawn(join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', `$p=[Diagnostics.Process]::GetProcessById(${pid}); $null=$p.Handle; [Console]::WriteLine('ready'); if (-not $p.WaitForExit(15000)) { throw 'Process exit timed out' }; [Console]::WriteLine('exit:'+$p.ExitCode)`],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let observed = ''
    observer.stdout.on('data', data => { observed += data })
    const observedExit = new Promise((done, reject) => { observer.on('close', done); observer.on('error', reject) })
    while (!observed.includes('ready')) {
      assert.ok(Date.now() < deadline, 'process observer startup timed out')
      await delay(10)
    }
    assert.ok(output.includes('\x1b[38;2;134;213;251m'), 'truecolor VT reaches the renderer intact')
    assert.equal(manager.resize({ sessionId: session.sessionId, cols: 72, rows: 22 }).resized, true)
    manager.write({ sessionId: session.sessionId, data: '中文输入\r' })
    while (!ended) {
      assert.ok(Date.now() < deadline, 'input/exit timed out')
      const read = await manager.read({ sessionId: session.sessionId, cursor, waitMs: 100 })
      output += read.data; cursor = read.cursor; ended = read.exited
    }
    assert.ok(output.includes('echo:中文输入'), 'Unicode input round-trips through ConPTY')
    await Promise.race([observedExit, delay(3000).then(() => { throw Error('exit observer timed out') })])
    assert.match(observed, /exit:7\b/, 'PowerShell forwards the native exit status')
    assert.throws(() => process.kill(pid, 0), /ESRCH/, 'PTY process has exited')
    console.log('PASS: native UTF-8 box/CJK output, truecolor VT, literal special paths/argv, Unicode input, resize, exit 7 and process cleanup')
  } catch (error) { failure = error }
  finally {
    manager.disposeAll()
    if (observer && observer.exitCode === null) observer.kill()
    const part = relative(base, directory)
    assert.ok(part && !part.startsWith('..') && !resolve(directory).startsWith('\\\\'))
    await rm(directory, { recursive: true, force: true })
  }
  if (failure) { console.error(failure); process.exit(1) }
  process.exit(0)
}
