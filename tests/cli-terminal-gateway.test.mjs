// Regression for 0.14.0-beta.2: every terminal call runs through a faithful
// copy of the Typert gateway boundary and the real OfficialToolsRemoteService
// envelope, exactly as the Desktop client sees them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strictCtx } from './helpers/strict-ctx.mjs'
import { gatewayClient } from './helpers/typert-gateway.mjs'
import { OfficialToolsRemoteService } from '../.dsh-plugin/official-tools-remote-service.mjs'
import { OFFICIAL_TOOLS_REMOTE_DESCRIPTORS, OFFICIAL_TOOLS_REMOTE_NAMESPACE } from '../.dsh-plugin/shared/official-tools-remote.mjs'
import { TERMINAL_LIMITS } from '../.dsh-plugin/shared/cli-terminal-protocol.mjs'
import { TerminalConnection, loadTerminalInfo, startTerminal, unwrapTerminal } from '../.dsh-plugin/client/cli-terminal-state.mjs'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'model-router-gateway-'))
const host = await import('../.dsh-plugin/index.mjs')

const CWD = process.platform === 'win32' ? 'F:\\everyAI\\testall' : '/work'
const TERMINAL_METHODS = ['terminalInfo', 'terminalStart', 'terminalRead', 'terminalWrite', 'terminalResize', 'terminalStop']

function fakePty({ exitOnKill = true } = {}) {
  const spawned = []
  return {
    spawned,
    module: {
      spawn(file, args, options) {
        const proc = { file, args, options, written: [], sizes: [], dataListeners: [], exitListeners: [], killCount: 0 }
        proc.emit = data => proc.dataListeners.forEach(listener => listener(data))
        proc.exit = (exitCode = 0) => proc.exitListeners.forEach(listener => listener({ exitCode, signal: 0 }))
        spawned.push(proc)
        return {
          pid: 4242,
          onData: listener => { proc.dataListeners.push(listener); return { dispose() {} } },
          onExit: listener => { proc.exitListeners.push(listener); return { dispose() {} } },
          write: data => proc.written.push(data),
          resize: (cols, rows) => proc.sizes.push([cols, rows]),
          kill: () => { proc.killCount += 1; if (exitOnKill) proc.exit(null) },
        }
      },
    },
  }
}

function fakeManaged() {
  const spawned = []
  const createManaged = async () => {
    const listeners = { data: [], exit: [], tree: [], output: [], dropped: [], lost: [] }
    let close
    const proc = {
      pid: 4242, startIdentity: '100', closed: new Promise(resolve => { close = resolve }), killCount: 0,
      onData: listener => listeners.data.push(listener), onExit: listener => listeners.exit.push(listener),
      onTreeClosed: listener => listeners.tree.push(listener), onOutputClosed: listener => listeners.output.push(listener),
      onOutputDropped: listener => listeners.dropped.push(listener), onControlLost: listener => listeners.lost.push(listener),
      resume: async () => ({}), kill: async () => { proc.killCount += 1 }, write: () => true, resize: async () => true,
      emit: data => listeners.data.forEach(listener => listener(data)),
      exit: code => listeners.exit.forEach(listener => listener({ exitCode: code, signal: null })),
      closeTree: () => listeners.tree.forEach(listener => listener({ activeProcesses: 0 })),
      closeOutput: () => listeners.output.forEach(listener => listener({ outputTruncated: false, bytesDropped: 0 })),
      resolveClosed: () => close({ outputTruncated: false, bytesDropped: 0 }),
    }
    spawned.push(proc)
    return proc
  }
  return { spawned, createManaged }
}

/** Real Host services + real remote service envelope + gateway boundary. */
function harness({ resolveLaunch, pty = fakePty(), managed = null, timers = [] } = {}) {
  const terminals = host.createRouterTerminals({
    loadPty: () => ({ ok: true, pty: pty.module, package: '@lydell/node-pty' }),
    resolveLaunch: resolveLaunch ?? (async (target, mode) => ({ file: 'kimi', args: mode === 'login' ? ['login'] : [], verbatim: false, display: mode === 'login' ? 'kimi login' : 'kimi' })),
    statPath: async () => ({ isDirectory: () => true }),
    prepare: async () => {},
    environment: () => ({ PATH: '/bin' }),
    setRepeating: () => ({ unref() {} }),
    clearRepeating: () => {},
    setTimer: (callback, ms) => { const timer = { callback, ms, unref() {} }; timers.push(timer); return timer },
    clearTimer: () => {},
    ...(managed ? { platform: 'win32', useManaged: true, createManaged: managed.createManaged,
      allocateOutputParent: async () => ({ path: 'D:/isolated/owned-parent' }), releaseOutputParent: async () => {} } : {}),
  })
  const ctx = strictCtx({ typert: {}, sandbox: {}, sandboxPolicy: {}, commands: {}, llm: {}, tools: {} })
  const service = Object.create(OfficialToolsRemoteService.prototype)
  service.services = host.routerRemoteServices(ctx, {}, { terminals })
  const api = gatewayClient(OFFICIAL_TOOLS_REMOTE_DESCRIPTORS, service, OFFICIAL_TOOLS_REMOTE_NAMESPACE)
  return { api, pty, terminals }
}

test('gateway: the client receives terminal results double-wrapped (gateway envelope around settled())', async () => {
  const { api, terminals } = harness()
  const raw = await api.terminalStart({ target: 'kimi-code', mode: 'login', cwd: CWD, cols: 100, rows: 30, confirmed: true })
  assert.equal(raw.ok, true)
  assert.equal(raw.value.ok, true, 'the Host service adds its own { ok, value } envelope')
  assert.equal(raw.value.sessionId, undefined, 'reading one level (beta.1/2) loses the session id')
  assert.match(raw.value.value.sessionId, /^term-/)
  // What beta.2 then sent: a read for an undefined session, rejected at the boundary.
  const broken = await api.terminalRead({ sessionId: raw.value.sessionId, cursor: 0, waitMs: 800 })
  assert.equal(broken.ok, false)
  assert.equal(broken.error.code, 'gateway/input-invalid')
  assert.match(broken.error.message, /modelRouterOfficialTools\/terminalRead: wire field "request" failed boundary validation/)
  terminals.disposeAll('test')
})

test('gateway: every client terminal payload passes boundary validation and unwraps to the Host result', async () => {
  const { api, pty, terminals } = harness()
  const info = await loadTerminalInfo(api)
  assert.equal(info.backend, 'pty')
  assert.equal(info.limits.maxCols, TERMINAL_LIMITS.maxCols)
  assert.ok(Array.isArray(info.history))

  // The exact start payload the card sends (cli-terminal.jsx).
  const session = await startTerminal(api, { target: 'kimi-code', mode: 'login', cwd: CWD, cols: 100, rows: 30 })
  assert.match(session.sessionId, /^term-[a-z0-9]{6,40}$/)
  assert.equal(session.display, 'kimi login')
  assert.equal(session.cwd, CWD)
  assert.equal(session.backend, 'pty')
  const proc = pty.spawned.at(-1)

  const errors = []
  let screen = ''
  let exit = null
  const connection = new TerminalConnection({
    api, sessionId: session.sessionId, waitMs: 800, resizeDelayMs: 1,
    onData: data => { screen += data }, onExit: event => { exit = event }, onError: error => errors.push(error.message),
  })
  const loop = connection.start()
  proc.emit('Please visit https://example.test/device and enter code ABCD-1234\r\n')
  await new Promise(resolve => setTimeout(resolve, 20))
  connection.send('y\r')
  connection.send('x'.repeat(70_000)) // chunked under the 65 536 write limit
  connection.resize(132, 43)
  connection.resize(2, 1) // a collapsed panel: clamped into the Host's bounds
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.deepEqual(proc.written.map(chunk => chunk.length), [2, 60_000, 10_000])
  assert.deepEqual(proc.sizes.at(-1), [TERMINAL_LIMITS.minCols, TERMINAL_LIMITS.minRows])
  proc.exit(0)
  await loop
  assert.deepEqual(errors, [], 'no call failed boundary validation')
  assert.match(screen, /ABCD-1234/)
  assert.deepEqual(exit, { backend: 'pty', treeTracking: false, containment: null, treeClosed: false, outputClosed: true,
    outputTruncated: false, bytesDropped: 0, controlLost: false, controlError: null,
    endReason: 'exit', exitCode: 0, stopRequested: false, stopConfirmed: false, exited: true })

  // Stop is a plain {sessionId} payload; info lists no live sessions afterwards.
  const second = await startTerminal(api, { target: 'shell', mode: 'interactive', cwd: CWD, cols: 100, rows: 30 })
  const stopped = unwrapTerminal(await api.terminalStop({ sessionId: second.sessionId }), 'stop')
  assert.equal(stopped.stopped, false)
  assert.equal(stopped.stopRequested, true)
  assert.equal(stopped.stopConfirmed, false)
  assert.equal((await loadTerminalInfo(api)).sessions.filter(item => !item.exited).length, 0)
  terminals.disposeAll('test')
})

test('gateway: stop acceptance and host exit never imply descendant-tree confirmation', async () => {
  const pty = fakePty({ exitOnKill: false })
  const timers = []
  const { api, terminals } = harness({ pty, timers })
  const session = await startTerminal(api, { target: 'shell', mode: 'interactive', cwd: CWD, cols: 100, rows: 30 })
  const stopped = unwrapTerminal(await api.terminalStop({ sessionId: session.sessionId }), 'stop')
  assert.deepEqual(stopped, { stopped: false, stopRequested: true, stopConfirmed: false, exited: false, endReason: 'stopped' })
  let info = await loadTerminalInfo(api)
  let current = info.sessions.find(item => item.sessionId === session.sessionId)
  assert.deepEqual({ exited: current.exited, stopRequested: current.stopRequested, stopConfirmed: current.stopConfirmed },
    { exited: false, stopRequested: true, stopConfirmed: false })
  assert.equal(info.history.some(item => item.id === session.sessionId), false)

  for (const timer of timers.filter(item => item.ms === 5_000)) timer.callback()
  const waiting = unwrapTerminal(await api.terminalRead({ sessionId: session.sessionId, cursor: 0, waitMs: 0 }), 'read')
  assert.deepEqual({ exited: waiting.exited, stopRequested: waiting.stopRequested, stopConfirmed: waiting.stopConfirmed },
    { exited: false, stopRequested: true, stopConfirmed: false })
  const repeated = unwrapTerminal(await api.terminalStop({ sessionId: session.sessionId }), 'stop')
  assert.deepEqual(repeated, { stopped: false, stopRequested: true, stopConfirmed: false, exited: false, endReason: 'stopped' })
  assert.equal(pty.spawned[0].killCount, 1)

  pty.spawned[0].exit(7)
  pty.spawned[0].exit(0)
  const exited = unwrapTerminal(await api.terminalRead({ sessionId: session.sessionId, cursor: 0, waitMs: 0 }), 'read')
  assert.deepEqual({ exited: exited.exited, exitCode: exited.exitCode, stopRequested: exited.stopRequested, stopConfirmed: exited.stopConfirmed },
    { exited: true, exitCode: 7, stopRequested: true, stopConfirmed: false })
  for (let attempt = 0; attempt < 50; attempt += 1) {
    info = await loadTerminalInfo(api)
    if (info.history.some(item => item.id === session.sessionId)) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const records = info.history.filter(item => item.id === session.sessionId)
  assert.equal(records.length, 1)
  assert.deepEqual({ exitCode: records[0].exitCode, stopRequested: records[0].stopRequested, stopConfirmed: records[0].stopConfirmed },
    { exitCode: 7, stopRequested: true, stopConfirmed: false })
  terminals.disposeAll('test')
})

test('gateway: managed host exit keeps client polling and late proof updates one history record', async () => {
  const managed = fakeManaged()
  const { api, terminals } = harness({ managed })
  const session = await startTerminal(api, { target: 'shell', mode: 'interactive', cwd: CWD, cols: 100, rows: 30 })
  const proc = managed.spawned[0]
  const exits = []
  const statuses = []
  const connection = new TerminalConnection({ api, sessionId: session.sessionId, waitMs: 50,
    onStatus: status => statuses.push(status), onExit: event => exits.push(event) })
  const loop = connection.start()
  proc.exit(0)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(exits.length, 0)
  assert.ok(statuses.some(status => status.exited && !status.treeClosed))
  const stopped = unwrapTerminal(await api.terminalStop({ sessionId: session.sessionId }), 'stop')
  assert.equal(stopped.stopRequested, true)
  assert.equal(stopped.stopConfirmed, false)
  proc.closeTree()
  proc.closeOutput()
  proc.resolveClosed()
  await loop
  assert.equal(exits.length, 1)
  assert.equal(exits[0].stopConfirmed, true)
  assert.equal(exits[0].outputClosed, true)
  let info
  for (let attempt = 0; attempt < 50; attempt += 1) {
    info = await loadTerminalInfo(api)
    const record = info.history.find(item => item.id === session.sessionId)
    if (record?.treeClosed && record?.outputClosed) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const records = info.history.filter(item => item.id === session.sessionId)
  assert.equal(records.length, 1)
  assert.deepEqual({ stopRequested: records[0].stopRequested, stopConfirmed: records[0].stopConfirmed,
    treeClosed: records[0].treeClosed, outputClosed: records[0].outputClosed },
    { stopRequested: true, stopConfirmed: true, treeClosed: true, outputClosed: true })
  terminals.disposeAll('test')
})

test('gateway: Host-side failures inside the settled envelope reach the user as errors', async () => {
  const { api, terminals } = harness({ resolveLaunch: async () => { throw new Error('未找到 kimi 命令') } })
  await assert.rejects(startTerminal(api, { target: 'kimi-code', mode: 'login', cwd: CWD, cols: 100, rows: 30 }), /未找到 kimi 命令/)
  await assert.rejects(startTerminal(api, { target: 'not-a-tool', mode: 'login', cwd: CWD, cols: 100, rows: 30 }), /boundary validation/)
  // A missing Host method (stale Host) still turns into restart advice.
  await assert.rejects(loadTerminalInfo({ terminalInfo: async () => ({ ok: false, error: { message: 'transport failure for modelRouterOfficialTools/terminalInfo: HTTP 404 Not Found' } }) }), /重启|restart/i)
  terminals.disposeAll('test')
})

test('client never sends a read for an invalid session id', async () => {
  const calls = []
  const errors = []
  let exit = null
  const connection = new TerminalConnection({ api: { terminalRead: async () => { calls.push('read') } }, sessionId: undefined, onError: error => errors.push(error.message), onExit: event => { exit = event } })
  await connection.start()
  assert.deepEqual(calls, [])
  assert.equal(errors.length, 1)
  assert.equal(exit.endReason, 'lost')
})

test('all six terminal descriptors are covered by the gateway regression', () => {
  const methods = OFFICIAL_TOOLS_REMOTE_DESCRIPTORS.map(descriptor => descriptor.method).filter(method => method.startsWith('terminal'))
  assert.deepEqual(methods.sort(), [...TERMINAL_METHODS].sort())
})
