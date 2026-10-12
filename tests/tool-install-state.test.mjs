import test from 'node:test'
import assert from 'node:assert/strict'
import {
  acceptedInstallJob, installClickRefusal, retainToolInstallDrafts, shouldApplyInstallStatus, toolInstallAction,
  toolMaintenanceActions, validateToolInstallSetting,
} from '../.dsh-plugin/client/tool-install-state.mjs'
import { versionStillOlder } from '../.dsh-plugin/shared/version-order.mjs'

const tool = { manager: 'npm' }

test('a current install stays current when the hosted entry is missing; an unknown latest can still repair', () => {
  assert.deepEqual(toolInstallAction({ tool, probe: { installed: true, version: '2.1.1' }, latestVersion: '2.1.1',
    readiness: { ready: false, reason: '未找到 dist/main.mjs' }, probeStatus: 'ready' }),
  { label: '已是最新版本', disabled: true })
  assert.deepEqual(toolInstallAction({ tool, probe: { installed: true, version: '2.1.1' }, latestVersion: null,
    readiness: { ready: false, reason: 'wrong distribution' }, probeStatus: 'ready' }),
  { label: '修复官方执行入口', disabled: false })
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
  { label: '检查并更新桌面版', disabled: false })
  assert.deepEqual(toolInstallAction({ tool: { manager: 'npm', headlessAdapter: true }, probe: { installed: true, version: '0.62.0' },
    latestVersion: '0.62.0', readiness: { ready: false }, probeStatus: 'ready' }),
  { label: '已是最新版本', disabled: true }, 'Gemini has no signed runner to repair')
})

test('Claude Code and Codex update buttons stay enabled for the reported version gaps', () => {
  assert.deepEqual(toolInstallAction({ tool, probe: { installed: true, version: '2.1.282' }, latestVersion: '2.1.295',
    readiness: { ready: true }, probeStatus: 'ready' }),
  { label: '更新到最新版 2.1.295', disabled: false })
  assert.deepEqual(toolInstallAction({ tool, probe: { installed: true, version: '0.157.1' }, latestVersion: '0.162.0',
    readiness: { ready: true }, probeStatus: 'ready' }),
  { label: '更新到最新版 0.162.0', disabled: false })
})

test('a prerelease install offers an update, and a refresh that still has a probe keeps the button enabled', () => {
  assert.deepEqual(toolInstallAction({ tool, probe: { installed: true, version: '2.1.294-beta.1' }, latestVersion: '2.1.295',
    readiness: { ready: true }, probeStatus: 'ready' }),
  { label: '更新到最新版 2.1.295', disabled: false })
  assert.deepEqual(toolInstallAction({ tool, probe: { installed: true, version: '2.1.282' }, latestVersion: '2.1.295',
    readiness: { ready: true }, probeStatus: 'refreshing' }),
  { label: '更新到最新版 2.1.295', disabled: false })
  assert.equal(toolInstallAction({ tool, probe: { installed: false }, probeStatus: 'loading' }).disabled, true)
  assert.equal(toolInstallAction({ tool, probe: { installed: true, version: '2.1.282' }, latestVersion: '2.1.295',
    readiness: { ready: true }, probeStatus: 'loading' }).disabled, true)
})

test('an update click explains a refusal instead of returning silently', () => {
  assert.equal(installClickRefusal({ tool, submitting: false, running: false }), '')
  assert.match(installClickRefusal({ tool, submitting: true, running: false }), /正在安装/)
  assert.match(installClickRefusal({ tool, submitting: false, running: true }), /正在安装/)
  assert.match(installClickRefusal({ tool: null }), /未知官方工具/)
  assert.match(installClickRefusal({ tool: { unsupported: true, unsupportedReason: '暂不支持' } }), /暂不支持/)
  assert.match(installClickRefusal({ tool, pendingSettings: true }), /保存或放弃/)
  assert.equal(installClickRefusal({ tool, installError: '当前方式仅支持 Linux' }), '当前方式仅支持 Linux')
})

test('installation drafts validate absolute directories and complete credential-free https sources', () => {
  assert.equal(validateToolInstallSetting('toolInstallDir', 'D:/AI tools'), '')
  assert.match(validateToolInstallSetting('toolInstallDir', 'tools'), /绝对路径/)
  assert.match(validateToolInstallSetting('toolInstallDir', 'D:/'), /根目录/)
  assert.equal(validateToolInstallSetting('toolNpmRegistry', ''), '')
  assert.equal(validateToolInstallSetting('toolNpmRegistry', 'https://registry.npmmirror.com/'), '')
  assert.match(validateToolInstallSetting('toolNpmRegistry', 'https://'), /有效网址/)
  assert.match(validateToolInstallSetting('toolNpmRegistry', 'https://user:password@example.com'), /账号密码/)
  assert.match(validateToolInstallSetting('toolScriptUrlsJson', '{ "unknown-tool": "https://example.com/install" }'), /官方工具 ID/)
  assert.match(validateToolInstallSetting('toolScriptUrlsJson', '{ "stepcode": "http://example.com/install" }'), /https/)
})

test('a settings notification keeps unrelated drafts and clears only values that were saved', () => {
  const drafts = { toolInstallDir: 'D:/AI tools', toolNpmRegistry: 'https://registry.npmmirror.com/', toolAllowScriptInstall: false }
  assert.deepEqual(retainToolInstallDrafts(drafts, { toolInstallMethodsJson: '{"codex":"pnpm"}' }), drafts,
    'changing another tool method must not discard typed installation settings')
  assert.deepEqual(retainToolInstallDrafts(drafts, { toolInstallDir: 'D:/AI tools', toolAllowScriptInstall: false }),
    { toolNpmRegistry: 'https://registry.npmmirror.com/' })
  assert.deepEqual(retainToolInstallDrafts({ toolInstallDir: '', toolAllowScriptInstall: true }, {}), {},
    'typing back the current defaults restores usable install controls')
})

test('turning off new script installations still allows removing an installed program', () => {
  const actions = toolMaintenanceActions({ tool, probe: { installed: true }, probeStatus: 'ready',
    summary: { installable: false, removable: true } })
  assert.equal(actions.repair.disabled, true)
  assert.equal(actions.uninstall.disabled, false)
})

test('ZCode desktop update and reinstall are independent of its TUI configuration', () => {
  const desktop = { id: 'zcode', label: 'ZCode', manager: 'signed-windows-installer' }
  const actions = toolMaintenanceActions({ tool: desktop, probe: { installed: true }, probeStatus: 'ready', summary: { installable: true } })
  assert.equal(actions.repair.label, '重新安装桌面版')
  assert.equal(actions.repair.disabled, false)
  assert.equal(actions.uninstall.disabled, true)
  assert.equal(installClickRefusal({ tool: desktop, operation: 'repair' }), '')
  assert.match(installClickRefusal({ tool: desktop, operation: 'uninstall' }), /系统/)
  assert.equal(validateToolInstallSetting('zcodeInstallDir', 'D:/Program Files/ZCode'), '')
  assert.ok(validateToolInstallSetting('zcodeInstallDir', 'zcode'))
})

test('install responses unwrap one or two envelopes, and a stale status job is ignored', () => {
  const job = { tool: 'claude-code', status: 'running', startedAt: '2026-10-09T00:00:02.000Z' }
  assert.deepEqual(acceptedInstallJob({ ok: true, value: { accepted: true, job } }), { job, error: '' })
  assert.deepEqual(acceptedInstallJob({ ok: true, value: { ok: true, value: { accepted: true, job } } }), { job, error: '' })
  assert.equal(acceptedInstallJob({ ok: true, value: { accepted: false, error: '安装被拒绝' } }).error, '安装被拒绝')
  assert.equal(acceptedInstallJob({ ok: false, error: { message: '桥未加载' } }).job, null)
  const local = { status: 'running', startedAt: '2026-10-09T00:00:02.000Z' }
  assert.equal(shouldApplyInstallStatus(local, { startedAt: '2026-10-09T00:00:01.000Z', status: 'succeeded' }), false)
  assert.equal(shouldApplyInstallStatus(local, { startedAt: '2026-10-09T00:00:02.000Z', status: 'running' }), true)
  assert.equal(shouldApplyInstallStatus(local, { status: 'running' }), true)
  assert.equal(shouldApplyInstallStatus(local, null), false)
  assert.equal(versionStillOlder('2.1.282', '2.1.295'), true)
  assert.equal(versionStillOlder('0.157.1', '0.162.0'), true)
  assert.equal(versionStillOlder('2.1.295', '2.1.295'), false)
  assert.equal(versionStillOlder('2.1.296', '2.1.295'), false)
  assert.equal(versionStillOlder('not-a-version', '2.1.295'), false)
})
