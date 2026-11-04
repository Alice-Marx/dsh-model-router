import test from 'node:test'
import assert from 'node:assert/strict'
import { MACHINE_DESKTOP_TOOLS, mainBotKeepsFullAccess, normalizeBotRouting, workerBinding } from '../packages/orchestration/src/bot-routing-mode.mjs'

test('bot routing mode: off by default, and a typo is refused instead of guessed', () => {
  const off = normalizeBotRouting(undefined)
  assert.equal(off.enabled, false)
  assert.equal(off.preset, 'balanced')
  assert.equal(off.autoGrant.machineTools, true)
  assert.throws(() => normalizeBotRouting({ enabled: 'yes' }), /INVALID_BOT_ROUTING:enabled/)
  assert.throws(() => normalizeBotRouting({ preste: 'economy' }), /INVALID_BOT_ROUTING:preste/)
  assert.throws(() => normalizeBotRouting({ preset: 'fastest' }), /INVALID_BOT_ROUTING:preset/)
})

test('bot routing mode: enabling keeps the two auto-grant switches explicit', () => {
  const on = normalizeBotRouting({ enabled: true, preset: 'quality', autoGrant: { cliTools: true } })
  assert.equal(on.enabled, true)
  assert.equal(on.preset, 'quality')
  assert.equal(on.autoGrant.cliTools, true)
  assert.equal(on.autoGrant.machineTools, true)
})

test('worker binding: the grant follows what the task touches, not what the machine offers', () => {
  const ceiling = ['machine_ping', 'fs_list', 'fs_read', 'fs_write', 'shell_exec', 'operation_status', 'operation_cancel', 'artifact_stat', 'artifact_read', ...MACHINE_DESKTOP_TOOLS]
  const readOnly = workerBinding({ botId: 'worker', machineId: 'm1', ceiling })
  assert.equal(readOnly.mode, 'read-only')
  assert.deepEqual(readOnly.tools, ['machine_ping', 'fs_list', 'fs_read', 'operation_status', 'operation_cancel', 'artifact_stat', 'artifact_read'])

  const writing = workerBinding({ botId: 'worker', machineId: 'm1', ceiling, needs: { write: true } })
  assert.equal(writing.mode, 'workspace-write')
  assert.equal(writing.tools.includes('fs_write'), true)
  assert.equal(writing.tools.includes('shell_exec'), false, 'a write task does not gain a shell')

  const desktop = workerBinding({ botId: 'worker', machineId: 'm1', ceiling, needs: { desktop: true } })
  assert.equal(desktop.mode, 'workspace-write', 'desktop tools only exist in a writable binding')
  for (const tool of MACHINE_DESKTOP_TOOLS) assert.equal(desktop.tools.includes(tool), true)
})

test('worker binding: a machine that offers no read tool yields no binding', () => {
  assert.equal(workerBinding({ botId: 'w', machineId: 'm', ceiling: ['desktop_screenshot'] }), null)
  assert.equal(workerBinding({ botId: 'w', machineId: 'm', ceiling: [] }), null)
})

test('worker binding: missing identity is refused before anything is granted', () => {
  assert.throws(() => workerBinding({ machineId: 'm', ceiling: ['fs_read'] }), /INVALID_WORKER_BOT/)
  assert.throws(() => workerBinding({ botId: 'b', ceiling: ['fs_read'] }), /INVALID_WORKER_MACHINE/)
})

test('main bot keeps its own access; routing never narrows it', () => {
  assert.equal(mainBotKeepsFullAccess('session-main', ['session-main']), true)
  assert.equal(mainBotKeepsFullAccess('session-worker', ['session-main']), false)
})
