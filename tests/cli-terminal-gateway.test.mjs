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

function fakePty() {
  const spawned = []
  return {
    spawned,
    module: {
      spawn(file, args, options) {
        const proc = { file, args, options, written: [], sizes: [], dataListeners: [], exitListeners: [] }
        proc.emit = data => proc.dataListeners.forEach(listener => listener(data))
        proc.exit = (exitCode = 0) => proc.exitListeners.forEach(listener => listener({ exitCode, signal: 0 }))
        spawned.push(proc)
        return {
          pid: 4242,
          onData: listener => { proc.dataListeners.push(listener); return { dispose() {} } },
          onExit: listener => { proc.exitListeners.push(listener); return { dispose() {} } },
          write: data => proc.written.push(data),
          resize: (cols, rows) => proc.sizes.push([cols, rows]),
          kill: () => proc.exit(null),
        }
      },
    },
  }
}

/** Real Host services + real remote service envelope + gateway boundary. */
function harness({ resolveLaunch } = {}) {
  const pty = fakePty()
  const terminals = host.createRouterTerminals({
    loadPty: () => ({ ok: true, pty: pty.module, package: '@lydell/node-pty' }),
    resolveLaunch: resolveLaunch ?? (async (target, mode) => ({ file: 'kimi', args: mode === 'login' ? ['login'] : [], verbatim: false, display: mode === 'login' ? 'kimi login' : 'kimi' })),
    statPath: async () => ({ isDirectory: () => true }),
    prepare: async () => {},
    environment: () => ({ PATH: '/bin' }),
    setRepeating: () => ({ unref() {} }),
    clearRepeating: () => {},
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
  assert.deepEqual(exit, { endReason: 'exit', exitCode: 0 })

  // Stop is a plain {sessionId} payload; info lists no live sessions afterwards.
  const second = await startTerminal(api, { target: 'shell', mode: 'interactive', cwd: CWD, cols: 100, rows: 30 })
  const stopped = unwrapTerminal(await api.terminalStop({ sessionId: second.sessionId }), 'stop')
  assert.equal(stopped.stopped, true)
  assert.equal((await loadTerminalInfo(api)).sessions.filter(item => !item.exited).length, 0)
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
