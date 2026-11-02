import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createTerminalManager } from '../.dsh-plugin/shared/cli-terminal.mjs'
import { createRouterState } from '../.dsh-plugin/shared/router-state.mjs'
import { TerminalConnection } from '../.dsh-plugin/client/cli-terminal-state.mjs'
import { createWindowsManagedTerminal } from '../packages/cli-runtime/src/native-terminal.mjs'

const fixture = fileURLToPath(new URL('./fixtures/cli-terminal-managed-tree.mjs', import.meta.url))
const scope = resolve('tmp/integration/codex-takeover-k33')

async function waitFor(predicate, description, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `${description} timed out`)
    await delay(25)
  }
}

async function readUntil(manager, state, predicate, description) {
  const deadline = Date.now() + 15_000
  while (!predicate(state)) {
    assert.ok(Date.now() < deadline, `${description} timed out: ${state.text}`)
    const output = await manager.read({ sessionId: state.session.sessionId, cursor: state.cursor, waitMs: 100 })
    state.text += output.data
    state.cursor = output.cursor
    state.output = output
  }
  return state.output
}

function connectionFor(manager, session) {
  const api = {
    terminalRead: async request => ({ ok: true, value: await manager.read(request) }),
    terminalWrite: async request => ({ ok: true, value: manager.write(request) }),
    terminalResize: async request => ({ ok: true, value: await manager.resize(request) }),
    terminalStop: async request => ({ ok: true, value: manager.stop(request) }),
  }
  const state = { screen: '', statuses: [], exits: [], errors: [] }
  state.connection = new TerminalConnection({
    api, sessionId: session.sessionId, waitMs: 50, resizeDelayMs: 1,
    onData: data => { state.screen += data },
    onStatus: status => state.statuses.push(status),
    onExit: event => state.exits.push(event),
    onError: error => state.errors.push(error),
  })
  state.loop = state.connection.start()
  return state
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error }
}

test('managed product wiring preserves real PTY, descendant and persistent metadata lifecycles', {
  skip: process.platform !== 'win32', timeout: 120_000,
}, async t => {
  const root = await mkdtemp(join(await realpath(scope), 'product-'))
  const store = createRouterState({ file: join(root, 'state.json') })
  const launches = new Map()
  const owned = new Map()
  const connections = []
  const ended = []
  const updates = []
  const persistenceErrors = []
  const clock = { now: Date.now() }
  let manager
  const persist = target => record => {
    target.push(record)
    void store.upsertTerminalSession(record).catch(error => persistenceErrors.push(error))
  }
  try {
    manager = createTerminalManager({
      createManaged: async options => {
        const proc = await createWindowsManagedTerminal(options)
        owned.set(options.cwd, { proc, privateOutput: options.privateOutput, pid: proc.pid, startIdentity: proc.startIdentity })
        return proc
      },
      resolveLaunch: async (_target, _mode, options) => {
        const plan = launches.get(options.cwd)
        assert.ok(plan, 'fixture resolver only launches a registered isolated cwd')
        return { file: process.execPath, args: [fixture, ...plan], display: 'isolated managed product fixture' }
      },
      environment: () => ({
        SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH || '',
        TERM: 'xterm-256color', COLORTERM: 'truecolor', DSH_FIXTURE_VALUE: 'fixture-only',
      }),
      onSessionEnd: persist(ended), onSessionUpdate: persist(updates), now: () => clock.now,
    })
    assert.equal(manager.info().backend, 'managed')
    assert.equal(manager.info().containment, 'windows-job')
    const directory = async name => {
      const path = join(root, name)
      await mkdir(path)
      return path
    }
    const start = async (name, args) => {
      const cwd = await directory(name)
      launches.set(cwd, args)
      const session = await manager.start({ target: 'shell', mode: 'interactive', cwd, cols: 96, rows: 28, confirmed: true })
      assert.equal(session.backend, 'managed')
      return { session, cwd }
    }

    const first = await start('input-zero', ['input'])
    const second = await start('input-seven', ['input'])
    const firstUi = connectionFor(manager, first.session)
    const secondUi = connectionFor(manager, second.session)
    connections.push(firstUi, secondUi)
    await waitFor(() => firstUi.screen.includes('READY 中文') && secondUi.screen.includes('READY 中文'), 'two PTY fixtures ready')
    assert.ok(firstUi.screen.includes('\x1b[31m') && secondUi.screen.includes('\x1b[31m'))
    assert.ok(firstUi.screen.includes('[96,28]'))
    assert.equal(secondUi.screen.includes(first.session.sessionId), false)
    assert.deepEqual(await manager.resize({ sessionId: first.session.sessionId, cols: 117, rows: 37 }), { resized: true })
    await delay(250)
    const resizeReportsBeforeQuery = firstUi.screen.split('"size":[117,37]').length - 1
    firstUi.connection.send('size?\r\n')
    await waitFor(() => firstUi.screen.includes('"size":[117,37]'), 'product child did not confirm resized dimensions')
    t.diagnostic(`product child resize reports before size? query: ${resizeReportsBeforeQuery}`)
    firstUi.connection.send('中文-input\r\n')
    await waitFor(() => firstUi.screen.includes(JSON.stringify({ input: '中文-input\r\n' })), 'product fixture did not receive the exact Unicode CRLF line')
    firstUi.connection.send('中文 \x1b[32mGREEN\x1b[0m\r\n')
    await waitFor(() => firstUi.screen.includes(JSON.stringify({ input: '中文 GREEN\r\n' })), 'product fixture did not receive the terminal-interpreted ANSI CRLF line')
    firstUi.connection.send('exit0\r\n')
    secondUi.connection.send('exit7\r\n')
    await Promise.all([firstUi.loop, secondUi.loop])
    assert.equal(firstUi.exits.length, 1)
    assert.equal(secondUi.exits.length, 1)
    assert.equal(firstUi.exits[0].exitCode, 0)
    assert.equal(secondUi.exits[0].exitCode, 7)
    assert.equal(secondUi.screen.includes('中文-input'), false, 'sessions never share input or output')
    assert.equal(secondUi.screen.includes('中文 GREEN'), false, 'ANSI input stays in its owning session')
    assert.ok(firstUi.statuses.some(status => status.treeClosed && status.outputClosed))
    assert.deepEqual(firstUi.errors, [])
    assert.deepEqual(secondUi.errors, [])

    const tree = await start('host-tree', ['tree', join(root, 'tree-ready.json'), join(root, 'tree-marker'), '0'])
    const treeUi = connectionFor(manager, tree.session)
    connections.push(treeUi)
    let identity
    await waitFor(() => {
      if (!existsSync(join(root, 'tree-ready.json'))) return false
      identity = JSON.parse(readFileSync(join(root, 'tree-ready.json'), 'utf8'))
      return Number.isInteger(identity.childPid) && Number.isInteger(identity.grandchildPid)
    }, 'child and grandchild identity')
    await waitFor(() => treeUi.statuses.some(status => status.exited), 'host exit status')
    assert.equal(treeUi.exits.length, 0, 'host exit cannot finish managed UI polling')
    assert.equal(pidAlive(identity.childPid), true)
    assert.equal(pidAlive(identity.grandchildPid), true)
    const active = manager.info().sessions.find(item => item.sessionId === tree.session.sessionId)
    assert.deepEqual({ exited: active.exited, treeClosed: active.treeClosed, stopConfirmed: active.stopConfirmed },
      { exited: true, treeClosed: false, stopConfirmed: false })
    const accepted = manager.stop({ sessionId: tree.session.sessionId })
    assert.equal(accepted.stopRequested, true)
    assert.equal(accepted.stopConfirmed, false)
    await treeUi.loop
    assert.equal(treeUi.exits.length, 1)
    assert.deepEqual({ treeClosed: treeUi.exits[0].treeClosed, outputClosed: treeUi.exits[0].outputClosed,
      stopRequested: treeUi.exits[0].stopRequested, stopConfirmed: treeUi.exits[0].stopConfirmed },
      { treeClosed: true, outputClosed: true, stopRequested: true, stopConfirmed: true })
    await waitFor(() => !pidAlive(identity.childPid) && !pidAlive(identity.grandchildPid), 'owned descendant cleanup')
    await waitFor(() => updates.some(record => record.id === tree.session.sessionId && record.treeClosed && record.outputClosed), 'late metadata update')
    const saved = await store.read()
    const records = saved.terminalSessions.filter(record => record.id === tree.session.sessionId)
    assert.equal(records.length, 1)
    assert.equal(records[0].stopConfirmed, true)
    assert.equal(records[0].treeClosed, true)
    assert.equal(ended.filter(record => record.id === tree.session.sessionId).length, 1)

    const natural = await start('natural-tree', ['natural'])
    const naturalState = { session: natural.session, cursor: 0, text: '', output: null }
    await readUntil(manager, naturalState, state => state.output?.closed, 'natural descendant tree closure')
    assert.equal(naturalState.output.stopRequested, false)
    assert.equal(naturalState.output.stopConfirmed, true)

    const orphan = await start('orphan', ['hold'])
    const orphanState = { session: orphan.session, cursor: 0, text: '', output: null }
    clock.now += manager.info().limits.orphanTimeoutMs + 1
    manager.sweep()
    await readUntil(manager, orphanState, state => state.output?.closed, 'orphan managed stop')
    assert.equal(orphanState.output.endReason, 'orphan')
    assert.equal(orphanState.output.stopConfirmed, true)

    const disposed = await start('dispose', ['hold'])
    const disposedState = { session: disposed.session, cursor: 0, text: '', output: null }
    manager.disposeAll('dispose')
    await readUntil(manager, disposedState, state => state.output?.closed, 'dispose managed stop')
    assert.equal(disposedState.output.endReason, 'dispose')
    assert.equal(disposedState.output.stopConfirmed, true)
    assert.deepEqual(persistenceErrors, [])
  } finally {
    for (const ui of connections) await ui.connection.stop()
    manager?.disposeAll('cleanup')
    const procs = [...owned.values()]
    await Promise.all(procs.map(({ proc }) => Promise.race([proc.closed.catch(() => {}), delay(20_000)])))
    for (const { privateOutput } of procs) {
      await waitFor(() => !existsSync(privateOutput), 'manager private output parent cleanup', 5_000)
    }
    const base = await realpath(scope)
    const part = relative(base, root)
    assert.ok(part && !part.startsWith('..') && !isAbsolute(part), 'test cleanup stays inside its own K33 temporary child')
    await rm(root, { recursive: true, force: true })
  }
})
