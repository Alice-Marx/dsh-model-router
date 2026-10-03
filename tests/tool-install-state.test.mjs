import test from 'node:test'
import assert from 'node:assert/strict'
import { toolInstallAction } from '../.dsh-plugin/client/tool-install-state.mjs'

const tool = { manager: 'npm' }

test('same version remains installable when the official executable is not ready', () => {
  const action = toolInstallAction({ tool, probe: { installed: true, version: '2.1.1' }, latestVersion: '2.1.1',
    readiness: { ready: false, reason: 'wrong distribution' }, probeStatus: 'ready' })
  assert.deepEqual(action, { label: '修复官方执行入口', disabled: false })
})

test('latest verified version is not reinstalled; older versions update to the latest', () => {
  assert.deepEqual(toolInstallAction({ tool, probe: { installed: true, version: '2.1.1' }, latestVersion: '2.1.1',
    readiness: { ready: true }, probeStatus: 'ready' }),
  { label: '已是最新版本', disabled: true })
  assert.deepEqual(toolInstallAction({ tool, probe: { installed: true, version: '2.0.2' }, latestVersion: '2.1.1',
    readiness: { ready: true }, probeStatus: 'ready' }),
  { label: '更新到最新版 2.1.1', disabled: false })
})

test('a newer-than-latest install is not downgraded; unknown latest still offers @latest', () => {
  assert.deepEqual(toolInstallAction({ tool, probe: { installed: true, version: '2.2.0' }, latestVersion: '2.1.1',
    readiness: { ready: true }, probeStatus: 'ready' }),
  { label: '已高于最新正式版', disabled: true })
  assert.deepEqual(toolInstallAction({ tool, probe: { installed: true, version: '2.1.1' }, latestVersion: null,
    readiness: { ready: true }, probeStatus: 'ready' }),
  { label: '安装最新版', disabled: false })
  assert.deepEqual(toolInstallAction({ tool, probe: { installed: false }, probeStatus: 'ready' }),
  { label: '一键安装最新版', disabled: false })
  assert.deepEqual(toolInstallAction({ tool: { manager: 'signed-windows-installer' }, probe: { installed: true, version: '3.14.4' },
    latestVersion: '3.14.4', readiness: { ready: false }, probeStatus: 'ready' }),
  { label: '已是最新版本', disabled: true })
  assert.deepEqual(toolInstallAction({ tool: { manager: 'npm', headlessAdapter: true }, probe: { installed: true, version: '0.62.0' },
    latestVersion: '0.62.0', readiness: { ready: false }, probeStatus: 'ready' }),
  { label: '已是最新版本', disabled: true }, 'Gemini has no signed runner to repair')
})
