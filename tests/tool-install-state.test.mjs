import test from 'node:test'
import assert from 'node:assert/strict'
import { toolInstallAction } from '../.dsh-plugin/client/tool-install-state.mjs'

const tool = { version: '2.1.1', manager: 'npm' }

test('same version remains installable when the official executable is not ready', () => {
  const action = toolInstallAction({ tool, probe: { installed: true, version: '2.1.1' },
    readiness: { ready: false, reason: 'wrong distribution' }, probeStatus: 'ready' })
  assert.deepEqual(action, { label: '修复官方执行入口', disabled: false })
})

test('verified current version is not reinstalled, older versions can be updated', () => {
  assert.deepEqual(toolInstallAction({ tool, probe: { installed: true, version: '2.1.1' },
    readiness: { ready: true }, probeStatus: 'ready' }),
  { label: '已是目标版本', disabled: true })
  assert.deepEqual(toolInstallAction({ tool, probe: { installed: true, version: '2.0.2' },
    readiness: { ready: false }, probeStatus: 'ready' }),
  { label: '更新到目标版本', disabled: false })
})

test('unknown or newer version is not silently downgraded', () => {
  for (const version of ['2.2.0', 'unknown']) {
    assert.deepEqual(toolInstallAction({ tool, probe: { installed: true, version },
      readiness: { ready: false }, probeStatus: 'ready' }),
    { label: '请人工核对版本', disabled: true })
  }
})
