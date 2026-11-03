import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createRouterState,
  initialRouterState,
  inspectRouterState,
  terminalSessionRecord,
} from '../.dsh-plugin/shared/router-state.mjs'

const metadata = (extra = {}) => ({
  id: 'term-managed-1', target: 'shell', label: '系统终端', mode: 'interactive', cwd: 'D:/isolated/work',
  backend: 'managed', startedAt: 100, finishedAt: 160, durationMs: 60, exited: true, exitCode: 0, endReason: 'exit',
  stopRequested: false, stopConfirmed: false, treeTracking: true, containment: 'windows-job', treeClosed: false,
  outputClosed: false, outputTruncated: false, bytesDropped: 0, controlLost: false, controlError: null,
  ...extra,
})

test('terminal metadata whitelist preserves managed proof without input, output, environment or control secrets', () => {
  const entry = terminalSessionRecord(metadata({
    input: 'typed-password', output: 'secret-screen', env: { TOKEN: 'secret-env' }, control: 'secret-pipe', extra: 'discard',
  }))
  assert.equal(entry.backend, 'managed')
  assert.equal(entry.containment, 'windows-job')
  const serialized = JSON.stringify(entry)
  for (const secret of ['typed-password', 'secret-screen', 'secret-env', 'secret-pipe', 'discard']) assert.equal(serialized.includes(secret), false)
  for (const field of ['input', 'output', 'env', 'control', 'extra']) assert.equal(Object.hasOwn(entry, field), false)
})

test('terminal history read normalization keeps legacy tree/output proof unknown', () => {
  const legacy = initialRouterState()
  legacy.terminalSessions = [{
    id: 'term-legacy', target: 'shell', startedAt: 100, finishedAt: 120, endReason: 'stopped', output: 'must-not-survive',
  }]
  const state = inspectRouterState(legacy)
  assert.equal(state.terminalSessions.length, 1)
  assert.deepEqual({
    stopRequested: state.terminalSessions[0].stopRequested,
    stopConfirmed: state.terminalSessions[0].stopConfirmed,
    treeTracking: state.terminalSessions[0].treeTracking,
    treeClosed: state.terminalSessions[0].treeClosed,
    outputClosed: state.terminalSessions[0].outputClosed,
  }, { stopRequested: false, stopConfirmed: false, treeTracking: false, treeClosed: false, outputClosed: false })
  assert.equal(JSON.stringify(state).includes('must-not-survive'), false)
})

test('terminal history upsert is same-id, monotonic and stable under stale or adjacent callbacks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'router-terminal-state-'))
  try {
    const store = createRouterState({ file: join(directory, 'state.json') })
    await store.upsertTerminalSession(metadata())
    await Promise.all([
      store.upsertTerminalSession(metadata({ stopRequested: true, endReason: 'stopped' })),
      store.upsertTerminalSession(metadata({ treeClosed: true, stopConfirmed: true })),
      store.upsertTerminalSession(metadata({ outputClosed: true, outputTruncated: true, bytesDropped: 17 })),
    ])
    await store.upsertTerminalSession(metadata(), { stale: true })
    const state = await store.read()
    assert.equal(state.terminalSessions.length, 1)
    assert.deepEqual({
      stopRequested: state.terminalSessions[0].stopRequested,
      treeClosed: state.terminalSessions[0].treeClosed,
      stopConfirmed: state.terminalSessions[0].stopConfirmed,
      outputClosed: state.terminalSessions[0].outputClosed,
      outputTruncated: state.terminalSessions[0].outputTruncated,
      bytesDropped: state.terminalSessions[0].bytesDropped,
    }, { stopRequested: true, treeClosed: true, stopConfirmed: true, outputClosed: true, outputTruncated: true, bytesDropped: 17 })
    const raw = await readFile(store.file, 'utf8')
    assert.equal((raw.match(/term-managed-1/g) ?? []).length, 1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
