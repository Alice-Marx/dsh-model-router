import test from 'node:test'
import assert from 'node:assert/strict'
import { createNativeTerminalProtocol } from '../packages/cli-runtime/src/native-terminal.mjs'

const identity = { pid: 4242, start: '133700000000000000' }
const frames = {
  listening: { control: 'listening' },
  dataConnected: { control: 'dataConnected' },
  launcherCreated: { control: 'launcherCreated', ...identity, containment: 'windows-job', conpty: true },
  started: { control: 'started', ...identity },
  hostExit: { control: 'hostExit', ...identity, exitCode: 0 },
  treeClosed: { control: 'treeClosed', ...identity, proof: 'windows-job-active-process-zero', activeProcesses: 0 },
}

function protocolAt(stage = 'new') {
  const protocol = createNativeTerminalProtocol()
  const order = ['listening', 'dataConnected', 'launcherCreated', 'started', 'hostExit', 'treeClosed']
  const count = { new: 0, listening: 1, data: 2, created: 3, started: 4, hostExited: 5, treeClosed: 6 }[stage]
  assert.notEqual(count, undefined)
  for (const name of order.slice(0, count)) protocol.accept({ ...frames[name] })
  return protocol
}

function rejected(stage, frame, code) {
  const protocol = protocolAt(stage)
  const before = protocol.stage
  assert.throws(() => protocol.accept(frame), error => {
    assert.equal(error.code, code)
    return true
  })
  assert.equal(protocol.stage, before)
}

test('native terminal protocol accepts the complete normal sequence and post-tree drop accounting', () => {
  const protocol = protocolAt('started')
  assert.deepEqual(protocol.identity, identity)
  assert.equal(protocol.accept({ control: 'resized', cols: 120, rows: 40, requestId: 1 }).control, 'resized')
  assert.equal(protocol.accept({ control: 'operationFailed', operation: 'resize', code: 'CONPTY_RESIZE_FAILED', requestId: 2 }).control, 'operationFailed')
  protocol.accept({ control: 'stopRequested', reason: 'abort' })
  protocol.accept({ control: 'outputDropped', bytesDropped: 10 })
  protocol.accept({ ...frames.hostExit, exitCode: 137 })
  protocol.accept(frames.treeClosed)
  protocol.accept({ control: 'outputDropped', bytesDropped: 20 })
  assert.equal(protocol.stage, 'treeClosed')
})

test('native terminal protocol rejects unknown control names, including prototype properties', async t => {
  for (const control of ['unknown', '__proto__', 'constructor', 'toString']) {
    await t.test(control, () => rejected('new', JSON.parse(JSON.stringify({ control })), 'NATIVE_TERMINAL_PROTOCOL_INVALID'))
  }
})

test('native terminal protocol rejects out-of-order and duplicate frames', async t => {
  const cases = [
    ['data before listening', 'new', frames.dataConnected, 'NATIVE_TERMINAL_PROTOCOL_SEQUENCE'],
    ['create before data', 'listening', frames.launcherCreated, 'NATIVE_TERMINAL_PROTOCOL_CREATE'],
    ['duplicate listening', 'listening', frames.listening, 'NATIVE_TERMINAL_PROTOCOL_SEQUENCE'],
    ['duplicate data', 'created', frames.dataConnected, 'NATIVE_TERMINAL_PROTOCOL_SEQUENCE'],
    ['duplicate start', 'started', frames.started, 'NATIVE_TERMINAL_PROTOCOL_START'],
    ['duplicate host exit', 'hostExited', frames.hostExit, 'NATIVE_TERMINAL_PROTOCOL_EXIT'],
    ['tree before host exit', 'started', frames.treeClosed, 'NATIVE_TERMINAL_PROTOCOL_TREE'],
    ['duplicate tree', 'treeClosed', frames.treeClosed, 'NATIVE_TERMINAL_PROTOCOL_TREE'],
    ['start after host exit', 'hostExited', frames.started, 'NATIVE_TERMINAL_PROTOCOL_START'],
  ]
  for (const [name, stage, frame, code] of cases) {
    await t.test(name, () => rejected(stage, frame, code))
  }
})

test('native terminal protocol rejects extra fields on every event family', async t => {
  const cases = [
    ['listening', 'listening', { ...frames.listening, extra: true }],
    ['launcherCreated', 'created', { ...frames.launcherCreated, extra: true }],
    ['started', 'started', { ...frames.started, extra: true }],
    ['hostExit', 'hostExited', { ...frames.hostExit, extra: true }],
    ['treeClosed', 'treeClosed', { ...frames.treeClosed, extra: true }],
    ['resized', 'started', { control: 'resized', cols: 80, rows: 24, requestId: 1, extra: true }],
    ['outputDropped', 'started', { control: 'outputDropped', bytesDropped: 1, extra: true }],
    ['fault', 'started', { control: 'fault', stage: 'native', code: 'X', extra: true }],
  ]
  for (const [name, stage, frame] of cases) {
    await t.test(name, () => rejected(stage, frame, 'NATIVE_TERMINAL_PROTOCOL_FIELDS'))
  }
})

test('native terminal protocol rejects invalid launcher identity and containment', async t => {
  const cases = [
    ['zero pid', { ...frames.launcherCreated, pid: 0 }],
    ['fractional pid', { ...frames.launcherCreated, pid: 1.5 }],
    ['zero start', { ...frames.launcherCreated, start: '0' }],
    ['non-digit start', { ...frames.launcherCreated, start: '12x' }],
    ['overlong start', { ...frames.launcherCreated, start: '1'.repeat(21) }],
    ['wrong containment', { ...frames.launcherCreated, containment: 'none' }],
    ['no conpty', { ...frames.launcherCreated, conpty: false }],
  ]
  for (const [name, frame] of cases) {
    await t.test(name, () => rejected('data', frame, 'NATIVE_TERMINAL_PROTOCOL_CREATE'))
  }
})

test('native terminal protocol rejects mismatched PID or start identity', async t => {
  const cases = [
    ['started pid', 'created', { ...frames.started, pid: identity.pid + 1 }, 'NATIVE_TERMINAL_PROTOCOL_START'],
    ['started start', 'created', { ...frames.started, start: '133700000000000001' }, 'NATIVE_TERMINAL_PROTOCOL_START'],
    ['host pid', 'started', { ...frames.hostExit, pid: identity.pid + 1 }, 'NATIVE_TERMINAL_PROTOCOL_EXIT'],
    ['host start', 'started', { ...frames.hostExit, start: '133700000000000001' }, 'NATIVE_TERMINAL_PROTOCOL_EXIT'],
    ['tree pid', 'hostExited', { ...frames.treeClosed, pid: identity.pid + 1 }, 'NATIVE_TERMINAL_PROTOCOL_TREE'],
    ['tree start', 'hostExited', { ...frames.treeClosed, start: '133700000000000001' }, 'NATIVE_TERMINAL_PROTOCOL_TREE'],
  ]
  for (const [name, stage, frame, code] of cases) {
    await t.test(name, () => rejected(stage, frame, code))
  }
})

test('native terminal protocol requires the real tree proof and zero active processes', async t => {
  const cases = [
    ['forged proof', { ...frames.treeClosed, proof: 'forged' }],
    ['missing proof', { ...identity, control: 'treeClosed', activeProcesses: 0 }],
    ['active one', { ...frames.treeClosed, activeProcesses: 1 }],
    ['active negative', { ...frames.treeClosed, activeProcesses: -1 }],
    ['active string', { ...frames.treeClosed, activeProcesses: '0' }],
  ]
  for (const [name, frame] of cases) {
    await t.test(name, () => rejected('hostExited', frame, 'NATIVE_TERMINAL_PROTOCOL_TREE'))
  }
})

test('native terminal protocol rejects invalid host exit codes', async t => {
  for (const exitCode of [-1, 1.5, 0x1_0000_0000, '0']) {
    await t.test(String(exitCode), () => rejected('started', { ...frames.hostExit, exitCode }, 'NATIVE_TERMINAL_PROTOCOL_EXIT'))
  }
})

test('native terminal protocol rejects invalid resize sizes and request IDs', async t => {
  const cases = [
    ['zero cols', { control: 'resized', cols: 0, rows: 24, requestId: 1 }],
    ['zero rows', { control: 'resized', cols: 80, rows: 0, requestId: 1 }],
    ['fractional cols', { control: 'resized', cols: 80.5, rows: 24, requestId: 1 }],
    ['oversize rows', { control: 'resized', cols: 80, rows: 32768, requestId: 1 }],
    ['zero request', { control: 'resized', cols: 80, rows: 24, requestId: 0 }],
    ['negative request', { control: 'resized', cols: 80, rows: 24, requestId: -1 }],
    ['fractional request', { control: 'resized', cols: 80, rows: 24, requestId: 1.5 }],
    ['overflow request', { control: 'resized', cols: 80, rows: 24, requestId: 0x80000000 }],
  ]
  for (const [name, frame] of cases) {
    await t.test(name, () => rejected('started', frame, 'NATIVE_TERMINAL_PROTOCOL_RESIZE'))
  }
})

test('native terminal protocol validates operation failure IDs and stop ordering', async t => {
  const cases = [
    ['resize missing request', 'started', { control: 'operationFailed', operation: 'resize', code: 'X' }],
    ['resize zero request', 'started', { control: 'operationFailed', operation: 'resize', code: 'X', requestId: 0 }],
    ['query with request', 'started', { control: 'operationFailed', operation: 'query', code: 'JOB_QUERY_FAILED', requestId: 1 }],
    ['bad query code', 'started', { control: 'operationFailed', operation: 'query', code: 'lowercase' }],
    ['stop after tree', 'treeClosed', { control: 'stopRequested', reason: 'stop' }],
  ]
  for (const [name, stage, frame] of cases) {
    const code = name === 'stop after tree' ? 'NATIVE_TERMINAL_PROTOCOL_STOP' : 'NATIVE_TERMINAL_PROTOCOL_OPERATION'
    await t.test(name, () => rejected(stage, frame, code))
  }
  const protocol = protocolAt('started')
  protocol.accept({ control: 'stopRequested', reason: 'stop' })
  assert.throws(() => protocol.accept({ control: 'stopRequested', reason: 'stop' }), { code: 'NATIVE_TERMINAL_PROTOCOL_STOP' })
})

test('native terminal protocol requires strictly increasing positive drop totals, including after tree closure', () => {
  const protocol = protocolAt('started')
  for (const bytesDropped of [0, -1, 1.5, '1']) {
    assert.throws(() => protocol.accept({ control: 'outputDropped', bytesDropped }), { code: 'NATIVE_TERMINAL_PROTOCOL_OUTPUT' })
  }
  protocol.accept({ control: 'outputDropped', bytesDropped: 10 })
  for (const bytesDropped of [10, 9]) {
    assert.throws(() => protocol.accept({ control: 'outputDropped', bytesDropped }), { code: 'NATIVE_TERMINAL_PROTOCOL_OUTPUT' })
  }
  protocol.accept(frames.hostExit)
  protocol.accept(frames.treeClosed)
  for (const bytesDropped of [10, 9]) {
    assert.throws(() => protocol.accept({ control: 'outputDropped', bytesDropped }), { code: 'NATIVE_TERMINAL_PROTOCOL_OUTPUT' })
  }
  assert.equal(protocol.accept({ control: 'outputDropped', bytesDropped: 11 }).bytesDropped, 11)
})

test('native terminal protocol rejects malformed helper faults and faults after tree closure', async t => {
  const cases = [
    ['wrong stage', 'started', { control: 'fault', stage: 'other', code: 'X' }],
    ['bad code', 'started', { control: 'fault', stage: 'native', code: 'bad-code' }],
    ['after tree', 'treeClosed', { control: 'fault', stage: 'native', code: 'JOB_QUERY_FAILED' }],
  ]
  for (const [name, stage, frame] of cases) {
    await t.test(name, () => rejected(stage, frame, 'NATIVE_TERMINAL_PROTOCOL_FAULT'))
  }
})
