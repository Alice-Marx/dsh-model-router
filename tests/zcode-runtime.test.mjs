import test from 'node:test'
import assert from 'node:assert/strict'
import { getOfficialTool } from '../.dsh-plugin/shared/official-tool-registry.mjs'
import { finishVerifiedInstall, probeToolWith, resolvePackageJobPlan, runZCodeInstallJob, setInstallPreferences, resetForTests } from '../.dsh-plugin/shared/official-tools-runtime.mjs'
import { resolveInstallPlan, resolveUninstallPlan } from '../.dsh-plugin/shared/tool-install-preferences.mjs'

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

test('a selected npm probe inspects its package instead of the archive or a command shim', async () => {
  const tool = getOfficialTool('zcode')
  const preferences = { installDir: 'D:/Apps/tools', methods: { zcode: 'npm' } }
  const plan = resolveInstallPlan(tool, 'npm', preferences, { platform: 'win32' })
  const inspect = async (_tool, selection) => {
    assert.equal(selection.plan.kind, 'package-manager'); assert.equal(selection.plan.installDir, 'D:/Apps/tools')
    return [{ version: '3.17.0', entry: 'D:/Apps/tools/node_modules/@ljwei-stak/zcode-cli/bin/zcode.mjs', packageRoot: 'D:/Apps/tools/node_modules/@ljwei-stak/zcode-cli', source: 'verified-npm-package' }]
  }
  const probe = await probeToolWith(tool, () => assert.fail('version detection must not run a shim'), { preferences, plan, packageEntries: inspect, cache: new Map() })
  assert.equal(probe.installed, true); assert.equal(probe.version, '3.17.0'); assert.equal(probe.manager, 'npm'); assert.equal(probe.methodId, 'npm')
  assert.equal(probe.source, 'verified-npm-package')
  const missing = await probeToolWith(tool, null, { preferences, plan, packageEntries: async () => [], cache: new Map() })
  assert.equal(missing.installed, false); assert.match(missing.detail, /npm 安装的 @ljwei-stak\/zcode-cli/)
  const archivePlan = resolveInstallPlan(tool, 'github-release', preferences, { platform: 'win32' })
  const archive = await probeToolWith(tool, null, { preferences, plan: archivePlan, packageEntries: () => assert.fail('archive probe must not inspect npm'), cache: new Map() })
  assert.equal(archive.methodId, 'github-release'); assert.equal(archive.manager, 'github-release')
})

test('npm ZCode install, repair and removal bind the npm prefix rather than its archive subdirectory', async () => {
  const tool = getOfficialTool('zcode'), preferences = { methods: { zcode: 'npm' } }
  const options = { platform: 'win32', home: 'C:/Users/test' }
  for (const operation of ['install', 'repair', 'uninstall']) {
    const original = operation === 'uninstall' ? resolveUninstallPlan(tool, 'npm', preferences, options) : resolveInstallPlan(tool, 'npm', preferences, options)
    const plan = await resolvePackageJobPlan(tool, original, preferences, { operation, options,
      runner: async (manager, args) => { assert.equal(manager, 'npm'); assert.deepEqual(args, ['config', 'get', 'prefix']); return { ok: true, stdout: 'D:/npm-prefix' } },
    })
    assert.equal(plan.kind, 'package-manager'); assert.equal(plan.installDir, 'D:/npm-prefix')
    assert.deepEqual(plan.args.slice(-2), ['--prefix', 'D:/npm-prefix'])
    assert.ok(plan.args.includes(operation === 'uninstall' ? '@ljwei-stak/zcode-cli' : '@ljwei-stak/zcode-cli@latest'))
    assert.ok(plan.args.includes(operation === 'uninstall' ? 'uninstall' : 'install'))
    assert.equal(plan.args.some(arg => /github\.com|zcode-cli$/.test(arg) && arg !== '@ljwei-stak/zcode-cli'), false)
  }
})

test('installation completion forwards the concrete npm channel for latest-version verification', async () => {
  const request = job()
  request.plan = resolveInstallPlan(request.tool, 'npm', request.preferences, { platform: 'win32' })
  await finishVerifiedInstall(request, { installed: true, version: '3.17.0' }, {
    lookupLatest: async (tool, selection) => {
      assert.equal(tool.id, 'zcode'); assert.equal(selection.plan.methodId, 'npm'); assert.equal(selection.preferences, request.preferences)
      return { version: '3.17.0', source: 'npm' }
    }, readinessFor: async () => ({ supported: true, ready: true }),
  })
  assert.equal(request.status, 'succeeded')
})
