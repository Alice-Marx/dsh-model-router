import test from 'node:test'
import assert from 'node:assert/strict'
import { getOfficialTool } from '../.dsh-plugin/shared/official-tool-registry.mjs'
import { runZCodeInstallJob, setInstallPreferences, resetForTests } from '../.dsh-plugin/shared/official-tools-runtime.mjs'

function job(operation = 'install') {
  return { tool: getOfficialTool('zcode'), status: 'running', operation,
    preferences: { zcodeInstallDir: 'D:/Apps/ZCode-reviewed' }, outputTail: [],
    controller: new AbortController(), cancelRequested: false }
}
test('a current desktop check succeeds without opening an installer; equal-version repair can reopen it', async () => {
  const before = { installed: true, version: '3.15.1' }
  let opened = 0
  const deps = { probe: async () => before, lookup: async () => ({ version: '3.15.1' }),
    capture: async () => ({ ok: true, stdout: 'D:/npm' }),
    openInstaller: async () => { opened++; return { status: 'installer-opened', version: '3.15.1', installerPath: 'fixture.exe' } } }
  const check = job()
  await runZCodeInstallJob(check, deps)
  assert.equal(check.status, 'succeeded')
  assert.equal(opened, 0)
  const repair = job('repair')
  await runZCodeInstallJob(repair, deps)
  assert.equal(opened, 1)
  assert.equal(repair.status, 'installer-opened', 'opening an installer does not claim installation completed')
  assert.equal(repair.postInstallProbe, undefined)
})
test('ZCode check and repair never open an older desktop installer or one with unverified latest version', async () => {
  for (const operation of ['install', 'repair']) {
    for (const latest of [{ version: '3.14.4' }, null]) {
      const request = job(operation)
      let touched = false
      await runZCodeInstallJob(request, { probe: async () => ({ installed: true, version: '3.15.1' }),
        lookup: async () => latest, capture: async () => { touched = true; throw new Error('must not query manager') },
        openInstaller: async () => { touched = true; throw new Error('must not open') } })
      assert.equal(touched, false)
      assert.equal(request.status, latest ? 'succeeded' : 'failed')
      assert.match(latest ? request.outputTail.join('\n') : request.error, latest ? /不会.*降级/ : /保留当前安装/)
    }
  }
})
test('a queued ZCode job probes and describes its reviewed desktop directory even after config changes', async () => {
  resetForTests()
  const request = job('repair')
  setInstallPreferences({ zcodeInstallDir: 'D:/Apps/ZCode-new' })
  let selected
  await runZCodeInstallJob(request, { probe: async (_tool, _runner, options) => {
    selected = options.preferences.zcodeInstallDir
    return { installed: true, version: '3.14.4' }
  }, lookup: async () => ({ version: '3.15.1' }), capture: async () => ({ ok: true, stdout: 'D:/npm' }),
  openInstaller: async () => ({ status: 'installer-opened', version: '3.15.1', installerPath: 'fixture.exe' }) })
  assert.equal(selected, 'D:/Apps/ZCode-reviewed')
  assert.match(request.outputTail.join('\n'), /ZCode-reviewed/)
  assert.doesNotMatch(request.outputTail.join('\n'), /ZCode-new/)
  resetForTests()
})
