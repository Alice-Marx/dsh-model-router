import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createPrincipalDirectory } from '../packages/orchestration/src/principals.mjs'
import { openNativeRemoteActions, NATIVE_REMOTE_TOOLS } from '../packages/orchestration/src/native-remote-actions.mjs'

const turn = (callId, turnId = 'turn-a') => ({ turnId, callId, signal: new AbortController().signal })
const lost = () => { throw Object.assign(new Error('reply lost after dispatch'), { code: 'MACHINE_CONNECTION_FAILED' }) }

// Real authority and SQLite, scripted remote replies with the actual Agent record shape. These
// tests exercise recovery invariants; actual MCP/Noise/Chromium/DesktopTools acceptance is separate.
function boot(t) {
  const authority = createAuthority(), directory = createPrincipalDirectory(authority)
  const tools = [...new Set([...NATIVE_REMOTE_TOOLS.map(entry => entry.machineTool), 'artifact_read', 'artifact_stat'])]
  directory.register('a', { tools: tools.map(tool => `remote/${tool}`), modelRoutes: [] })
  const calls = [], records = new Map(), hooks = new Map()
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex')
  const machines = {
    scopes: () => [{ machineId: 'machine-a', roots: ['project'], mode: 'workspace-write', tools }],
    async call(_subject, input) {
      calls.push(input)
      if (hooks.has(input.tool)) return hooks.get(input.tool)(input)
      if (input.tool === 'operation_status') return records.get(input.operationId)
      if (input.tool === 'operation_cancel') return { cancelRequested: true, stopConfirmed: true, operation: records.get(input.operationId) }
      if (input.tool === 'browser_snapshot') return { browserSessionId: input.args.browserSessionId, snapshotId: 'snap-1', nodes: [], text: 'ready' }
      const result = input.tool === 'browser_open' ? { browserSessionId: 'browser-a' }
        : input.tool === 'desktop_screenshot' ? { screenshotId: 'shot-a', artifactId: 'artifact-a', mediaType: 'image/png', size: png.length, sha256: createHash('sha256').update(png).digest('hex') }
        : { completed: true }
      const record = { schemaVersion: 1, machineId: input.machineId, operationId: input.operationId, tool: input.tool, status: 'succeeded', result }
      records.set(input.operationId, record)
      return record
    },
    async download(_subject, input) { return { artifactId: input.artifactId, mediaType: 'image/png', size: png.length,
      sha256: createHash('sha256').update(png).digest('hex'), content: png.toString('base64') } },
  }
  const actions = openNativeRemoteActions({ Database, file: ':memory:', authority, directory, machines })
  t.after(() => actions.close())
  return { view: actions.forConversation('a', 'conversation-a'), hooks, calls, records, machines, png, directory }
}

test('a revoked browser-open or screenshot grant refuses before its first dispatch', async t => {
  const { view, directory, calls } = boot(t)
  directory.replaceGrant('a', { tools: [], modelRoutes: [] })
  await assert.rejects(view.call('bot_browser_open', { url: 'https://example.test' }, turn('open')), { code: 'TOOL_DENIED' })
  await assert.rejects(view.call('bot_desktop_screenshot', {}, turn('capture')), { code: 'TOOL_DENIED' })
  assert.equal(calls.length, 0)
})

test('native recovery tools are mounted before the conversation has its first operation', t => {
  const { view } = boot(t)
  assert.ok(view.schemas().some(entry => entry.name === 'bot_remote_operation_status'))
  assert.ok(view.schemas().some(entry => entry.name === 'bot_remote_operation_cancel'))
})

test('a lost read-only browser snapshot does not create an unqueryable mutation fence', async t => {
  const { view, hooks, calls } = boot(t)
  await view.call('bot_browser_open', { url: 'https://example.test' }, turn('open'))
  hooks.set('browser_snapshot', lost)
  const snapshot = await view.call('bot_browser_snapshot', { browserSessionId: 'browser-a' }, turn('snapshot'))
  assert.equal(snapshot.operationId, null)
  const closed = await view.call('bot_browser_close', { browserSessionId: 'browser-a' }, turn('close'))
  assert.equal(closed.status, 'succeeded')
  assert.equal(calls.filter(call => call.tool === 'browser_close').length, 1)
})

test('missing, future or mismatched mutation receipts keep the original operation unknown', async t => {
  for (const malformed of ['missing', 'future', 'other-operation']) {
    const { view, hooks } = boot(t)
    hooks.set('browser_open', input => malformed === 'missing' ? { browserSessionId: 'browser-a' }
      : { schemaVersion: 1, machineId: input.machineId, operationId: malformed === 'other-operation' ? 'foreign' : input.operationId,
        tool: input.tool, status: malformed === 'future' ? 'future-status' : 'succeeded', result: { browserSessionId: 'browser-a' } })
    const opened = await view.call('bot_browser_open', { url: 'https://example.test' }, turn('open'))
    assert.equal(opened.status, 'unknown', malformed)
    await assert.rejects(view.call('bot_browser_open', { url: 'https://example.test' }, turn('again')), { code: 'NATIVE_REMOTE_OPERATION_PENDING' })
  }
})

test('a status reply for another operation cannot clear the original fence', async t => {
  const { view, machines, hooks, records } = boot(t)
  const dispatch = machines.call.bind(machines)
  machines.call = async (subject, input) => { const result = await dispatch(subject, input); if (input.tool === 'browser_open') lost(); return result }
  const opened = await view.call('bot_browser_open', { url: 'https://example.test' }, turn('open'))
  hooks.set('operation_status', () => ({ ...records.get(opened.operationId), operationId: 'foreign-operation' }))
  const status = await view.call('bot_remote_operation_status', { operationId: opened.operationId }, turn('inspect'))
  assert.equal(status.status, 'unknown')
  await assert.rejects(view.call('bot_browser_open', { url: 'https://example.test' }, turn('again')), { code: 'NATIVE_REMOTE_OPERATION_PENDING' })
})

for (const tool of ['browser_open', 'desktop_screenshot']) test(`reconciling an unknown ${tool} restores its own issued reference`, async t => {
  const { view, machines, calls, png } = boot(t)
  const dispatch = machines.call.bind(machines)
  machines.call = async (subject, input) => { const result = await dispatch(subject, input); if (input.tool === tool) lost(); return result }
  const original = await view.call(`bot_${tool}`, tool === 'browser_open' ? { url: 'https://example.test' } : {}, turn('start'))
  assert.equal(original.status, 'unknown')
  const recovered = await view.call('bot_remote_operation_status', { operationId: original.operationId }, turn('inspect'))
  assert.equal(recovered.status, 'succeeded')
  if (tool === 'browser_open') {
    const snapshot = await view.call('bot_browser_snapshot', { browserSessionId: 'browser-a' }, turn('snapshot'))
    assert.equal(snapshot.status, 'succeeded')
  } else {
    assert.equal(recovered.image.data, png.toString('base64'))
    const click = await view.call('bot_desktop_click', { screenshotId: 'shot-a', x: 2, y: 3 }, turn('click'))
    assert.equal(click.status, 'succeeded')
  }
  assert.equal(calls.filter(call => call.tool === tool).length, 1, 'recovery never repeats the original effect')
  const repeated = await view.call('bot_remote_operation_status', { operationId: original.operationId }, turn('inspect-again'))
  assert.equal(repeated.status, 'succeeded', 'registering the already restored reference is idempotent')
})

test('a reconciled unknown browser close retires the original browser reference', async t => {
  const { view, machines } = boot(t)
  await view.call('bot_browser_open', { url: 'https://example.test' }, turn('open'))
  const dispatch = machines.call.bind(machines)
  machines.call = async (subject, input) => { const result = await dispatch(subject, input); if (input.tool === 'browser_close') lost(); return result }
  const close = await view.call('bot_browser_close', { browserSessionId: 'browser-a' }, turn('close'))
  assert.equal(close.status, 'unknown')
  const status = await view.call('bot_remote_operation_status', { operationId: close.operationId }, turn('inspect'))
  assert.equal(status.status, 'succeeded')
  await assert.rejects(view.call('bot_browser_snapshot', { browserSessionId: 'browser-a' }, turn('snapshot')), { code: 'NATIVE_REMOTE_BROWSER_SESSION_UNKNOWN' })
})
