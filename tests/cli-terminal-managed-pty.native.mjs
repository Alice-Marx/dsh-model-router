import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createWindowsManagedTerminal } from '../packages/cli-runtime/src/native-terminal.mjs'
import { privateEnvironment } from '../packages/cli-runtime/src/native-process.mjs'

const scope = await realpath(resolve('tmp/integration/codex-takeover-k26'))
const fixture = resolve('tests/fixtures/cli-terminal-managed-tree.mjs')

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

async function waitFor(check, message) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await delay(25)
  }
  assert.fail(message)
}

async function ownedParent(t) {
  const owned = await mkdtemp(join(scope, 'k32-core-a-'))
  const sentinel = join(owned, 'caller-owned.txt')
  await writeFile(sentinel, 'preserve caller directory')
  t.after(async () => {
    const target = await realpath(owned)
    const under = relative(scope, target)
    if (!under || under === '..' || under.startsWith('..\\') || under.startsWith('../') || isAbsolute(under)) throw new Error('cleanup escaped task scope')
    await rm(target, { recursive: true, force: true })
  })
  return { owned, sentinel }
}

function options(owned, mode, args = [], cwd = owned) {
  return {
    launch: { file: process.execPath, args: [fixture, mode, ...args] },
    cwd, cols: 91, rows: 27, env: { ...privateEnvironment(owned), DSH_FIXTURE_VALUE: 'dummy 中文 " \\ ;$', DSH_K32_DUMMY: 'k32-only' },
    ttlMs: 20_000, privateOutput: owned,
  }
}

function observe(proc) {
  const events = { data: [], exit: [], tree: [], output: [], lost: [] }
  proc.onData(value => events.data.push(value))
  proc.onExit(value => events.exit.push(value))
  proc.onTreeClosed(value => events.tree.push(value))
  proc.onOutputClosed(value => events.output.push(value))
  proc.onControlLost(value => events.lost.push(value))
  return events
}

async function stopForCleanup(proc) {
  if (!proc) return
  if (!proc.treeClosed) await proc.kill().catch(() => {})
  await proc.closed
}

function assertClosed(proc, events, closed) {
  assert.equal(proc.controlLost, false, JSON.stringify(events.lost))
  assert.equal(proc.treeClosed, true)
  assert.equal(proc.outputClosed, true)
  assert.equal(events.exit.length, 1)
  assert.equal(events.tree.length, 1)
  assert.deepEqual(events.tree[0], { proof: 'windows-job-active-process-zero', activeProcesses: 0 })
  assert.equal(events.output.length, 1)
  assert.equal(events.lost.length, 0)
  assert.equal(closed.runtimeCleaned, true)
  assert.equal(closed.outputTruncated, false)
  assert.equal(closed.bytesDropped, 0)
  assert.equal(events.output[0].outputTruncated, false)
}

async function assertParentPreserved(owned, sentinel) {
  assert.equal((await stat(owned)).isDirectory(), true)
  assert.equal(await readFile(sentinel, 'utf8'), 'preserve caller directory')
}

function plainOutput(value) {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r\n/g, '\n')
}

test('core A hold: suspended marker, explicit resume, typed Job stop and exactly-once close events', { timeout: 60_000 }, async t => {
  const { owned, sentinel } = await ownedParent(t)
  const marker = join(owned, 'resumed.json')
  let proc
  try {
    proc = await createWindowsManagedTerminal(options(owned, 'hold', [marker]))
    const events = observe(proc)
    assert.equal(await exists(marker), false)
    await delay(150)
    assert.equal(await exists(marker), false)
    await proc.resume()
    await waitFor(() => exists(marker), 'resumed marker was not created')
    const resumed = JSON.parse(await readFile(marker, 'utf8'))
    assert.equal(resumed.resumed, true)
    assert.equal(resumed.pid, proc.pid)
    assert.equal(await proc.kill(), true)
    const closed = await proc.closed
    assertClosed(proc, events, closed)
    assert.equal(closed.code, 0)
    assert.equal(closed.signal, null)
    await assertParentPreserved(owned, sentinel)
  } finally { await stopForCleanup(proc) }
})

test('core A report: TTY streams, literal launch fields, natural zero and complete stdout', { timeout: 60_000 }, async t => {
  const { owned, sentinel } = await ownedParent(t)
  const cwd = join(owned, "cwd 空格 ' [k32]")
  await mkdir(cwd)
  const args = ['plain', 'space value', '"double"', "single'quote", 'semi;&|$<>', '中文', 'trailing\\']
  let proc
  let output = ''
  try {
    proc = await createWindowsManagedTerminal(options(owned, 'report', args, cwd))
    const events = observe(proc)
    proc.onData(value => { output += value })
    await proc.resume()
    const closed = await proc.closed
    assertClosed(proc, events, closed)
    assert.equal(events.exit[0].exitCode, 0)
    assert.equal(events.exit[0].signal, null)
    assert.ok(output.length > 0, 'stdout must arrive without user input')
    const text = plainOutput(output)
    const report = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1).replace(/\n/g, ''))
    assert.deepEqual(report.args, args)
    assert.equal(report.cwd, cwd)
    assert.equal(report.stdinTTY, true)
    assert.equal(report.stdoutTTY, true)
    assert.equal(report.stderrTTY, true)
    assert.equal(report.fixtureValue, 'dummy 中文 " \\ ;$')
    assert.ok(report.envNames.includes('DSH_K32_DUMMY'))
    await assertParentPreserved(owned, sentinel)
  } finally { await stopForCleanup(proc) }
})

test('core A input: UTF-8 and ANSI writes, child-confirmed resize, exit 7 and drained output', { timeout: 60_000 }, async t => {
  const { owned } = await ownedParent(t)
  let proc
  let output = ''
  try {
    proc = await createWindowsManagedTerminal(options(owned, 'input'))
    const events = observe(proc)
    proc.onData(value => { output += value })
    await proc.resume()
    await waitFor(() => output.includes('\x1b[31m') && plainOutput(output).includes('READY 中文RED') && plainOutput(output).includes('"size":[91,27]'), 'initial input fixture output missing')
    assert.equal(proc.write('中文-input\r\n'), true)
    await waitFor(() => output.includes(JSON.stringify({ input: '中文-input\r\n' })), 'fixture did not receive the exact Unicode CRLF line')
    assert.equal(proc.write('中文 \x1b[32mGREEN\x1b[0m\r\n'), true)
    await waitFor(() => output.includes(JSON.stringify({ input: '中文 GREEN\r\n' })), 'fixture did not receive the terminal-interpreted ANSI CRLF line')
    assert.equal(await proc.resize(117, 43), true)
    await delay(250)
    const resizeReportsBeforeQuery = output.split('"size":[117,43]').length - 1
    assert.equal(proc.write('size?\r\n'), true)
    await waitFor(() => plainOutput(output).includes('"size":[117,43]'), 'child did not confirm resized dimensions')
      .catch(error => {
        t.diagnostic(`child resize reports before size? query: ${resizeReportsBeforeQuery}`)
        t.diagnostic(`input output after failed size? query: ${JSON.stringify(output)}`)
        throw error
      })
    t.diagnostic(`child resize reports before size? query: ${resizeReportsBeforeQuery}`)
    assert.equal(proc.write('exit7\r\n'), true)
    const closed = await proc.closed
    assertClosed(proc, events, closed)
    assert.equal(events.exit[0].exitCode, 7)
    assert.equal(closed.code, 0)
    assert.equal(closed.signal, null)
  } finally { await stopForCleanup(proc) }
})

test('core A abort: running hold is stopped by controlled Job close, not helper loss', { timeout: 60_000 }, async t => {
  const { owned, sentinel } = await ownedParent(t)
  const marker = join(owned, 'abort-resumed.json')
  const controller = new AbortController()
  let proc
  try {
    proc = await createWindowsManagedTerminal({ ...options(owned, 'hold', [marker]), signal: controller.signal })
    const events = observe(proc)
    await proc.resume()
    await waitFor(() => exists(marker), 'hold did not start before abort')
    controller.abort()
    const closed = await proc.closed
    assertClosed(proc, events, closed)
    assert.equal(closed.code, 0)
    assert.equal(closed.signal, null)
    await assertParentPreserved(owned, sentinel)
  } finally { await stopForCleanup(proc) }
})
