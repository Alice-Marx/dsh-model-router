import test from 'node:test'
import assert from 'node:assert/strict'
import { getOfficialTool } from '../.dsh-plugin/shared/official-tool-registry.mjs'
import { finishVerifiedInstall, runZCodeInstallJob, setInstallPreferences, resetForTests } from '../.dsh-plugin/shared/official-tools-runtime.mjs'

function job(operation = 'install') {
  return { tool: getOfficialTool('zcode'), status: 'running', operation,
    preferences: { installDir: 'D:/Apps/reviewed' }, outputTail: [],
    controller: new AbortController(), cancelRequested: false }
}
const finish = async (request, probe) => { request.postInstallProbe = probe; request.status = probe.installed ? 'succeeded' : 'failed' }

test('a current CLI check succeeds without downloading; equal-version repair installs and verifies the result', async () => {
  let installed = 0, probes = 0
  const deps = { probe: async () => { probes++; return { installed: true, version: '3.16.2' } },
    lookup: async () => ({ version: '3.16.2' }), install: async () => { installed++ }, finish }
  const check = job()
  await runZCodeInstallJob(check, deps)
  assert.equal(check.status, 'succeeded'); assert.equal(installed, 0); assert.equal(probes, 1)
  const repair = job('repair')
  await runZCodeInstallJob(repair, deps)
  assert.equal(installed, 1); assert.equal(repair.status, 'succeeded'); assert.equal(probes, 3)
  assert.equal(repair.postInstallProbe.version, '3.16.2')
})

test('ZCode check and repair refuse downgrade and preserve current installation when latest is unavailable or stale', async () => {
  for (const operation of ['install', 'repair']) {
    for (const latest of [{ version: '3.16.1' }, null, { version: '3.16.2', stale: true }]) {
      const request = job(operation)
      let touched = false
      await runZCodeInstallJob(request, { probe: async () => ({ installed: true, version: '3.16.2' }),
        lookup: async () => latest, install: async () => { touched = true }, finish })
      assert.equal(touched, false)
      const downgraded = latest?.version === '3.16.1'
      assert.equal(request.status, downgraded ? 'succeeded' : 'failed')
      assert.match(downgraded ? request.outputTail.join('\n') : request.error, downgraded ? /不会.*降级/ : /保留当前安装/)
    }
  }
})

test('a queued CLI job retains its reviewed shared directory after settings change', async () => {
  resetForTests()
  const request = job('repair')
  setInstallPreferences({ installDir: 'D:/Apps/changed' })
  const seen = []
  await runZCodeInstallJob(request, { probe: async (_tool, _runner, options) => {
    seen.push(options.plan.installDir); return { installed: true, version: '3.16.1' }
  }, lookup: async () => ({ version: '3.16.2' }), install: async options => { seen.push(options.installDir) }, finish })
  assert.deepEqual(seen, ['D:/Apps/reviewed/zcode-cli', 'D:/Apps/reviewed/zcode-cli', 'D:/Apps/reviewed/zcode-cli'])
  assert.match(request.outputTail.join('\n'), /reviewed/)
  assert.doesNotMatch(request.outputTail.join('\n'), /changed/)
  resetForTests()
})

test('a current or newer CLI still requires a ready Node 24 execution entry', async () => {
  for (const installedVersion of ['3.16.2', '3.16.3']) {
    const request = job()
    await runZCodeInstallJob(request, {
      probe: async () => ({ installed: true, version: installedVersion }),
      lookup: async () => ({ version: '3.16.2' }),
      install: async () => assert.fail('current/newer runtime must not download'),
      finish: (target, probe, options) => finishVerifiedInstall(target, probe, {
        ...options, readinessFor: async () => ({ supported: true, ready: false, reason: '需要 Node 24.14.0 或更新的 Node 24。' }),
      }),
    })
    assert.equal(request.status, 'failed')
    assert.match(request.error, /需要 Node 24/)
  }
})
