import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { OFFICIAL_TOOLS_REMOTE_DESCRIPTORS, OFFICIAL_TOOLS_REMOTE_NAMESPACE } from '../.dsh-plugin/shared/official-tools-remote.mjs'
import { installSummary, OfficialToolsRemoteService } from '../.dsh-plugin/official-tools-remote-service.mjs'
import { installPreferences, setInstallPreferences } from '../.dsh-plugin/shared/official-tools-runtime.mjs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const manifest = JSON.parse(read('package.json'))

test('install settings return current saved commands synchronously without tool inspection', () => {
  const original = installPreferences()
  try {
    const receiver = { list() { throw new Error('full inspection must not run') } }
    setInstallPreferences({ ...original, installDir: 'D:/AI/tools', methods: { codex: 'npm' } })
    const initial = OfficialToolsRemoteService.prototype.installSettings.call(receiver)
    assert.equal(initial.then, undefined, 'settings summary is independent of asynchronous probes')
    assert.equal(initial.install.tools.find(tool => tool.id === 'codex').savedMethodId, 'npm')
    setInstallPreferences({ ...original, installDir: 'D:/AI/tools', methods: { codex: 'pnpm' } })
    const updated = OfficialToolsRemoteService.prototype.installSettings.call(receiver)
    const codex = updated.install.tools.find(tool => tool.id === 'codex')
    assert.equal(codex.savedMethodId, 'pnpm')
    assert.equal(codex.methodId, 'pnpm')
    assert.match(codex.command, /^pnpm /)
    assert.equal(codex.installDir, 'D:/AI/tools')
    assert.equal(updated.hostVersion, manifest.version)
  } finally { setInstallPreferences(original) }
})

test('install summary uses the host platform and reports the configured update destination', () => {
  const preferences = { installDir: 'D:/AI/tools', registry: 'https://registry.npmjs.org/',
    methods: {}, scriptUrls: {}, allowScriptInstall: true }
  const windows = installSummary(preferences, { platform: 'win32', home: 'C:/Users/tester' })
  const step = windows.tools.find(tool => tool.id === 'stepcode')
  assert.match(step.methods.find(method => method.id === 'script-bash').blocked, /仅支持/)
  assert.equal(step.methods.find(method => method.id === 'script-powershell').blocked, null)
  assert.equal(step.methodId, 'script-powershell')
  assert.equal(step.installDir, 'D:/AI/tools/stepcode')
  assert.equal(step.updateInstallDir, step.installDir)
  assert.equal(step.updateCommand, step.command)
  const zcode = windows.tools.find(tool => tool.id === 'zcode')
  assert.match(zcode.command, /签名安装器/)
  assert.equal(zcode.installError, undefined, 'desktop download remains available without a shell method')
  assert.match(zcode.notices[0], /单独配置 ZCode/)
  assert.match(zcode.notices[1], /独立于统一 npm/)
  const linux = installSummary(preferences, { platform: 'linux', home: '/home/tester' })
  const unixStep = linux.tools.find(tool => tool.id === 'stepcode')
  assert.equal(unixStep.methods.find(method => method.id === 'script-bash').blocked, null)
  assert.match(unixStep.methods.find(method => method.id === 'script-powershell').blocked, /仅支持/)
  const disabled = installSummary({ ...preferences, allowScriptInstall: false }, { platform: 'win32' })
  assert.match(disabled.tools.find(tool => tool.id === 'stepcode').methods
    .find(method => method.id === 'script-powershell').blocked, /已在插件设置中关闭/)
  const disabledStep = disabled.tools.find(tool => tool.id === 'stepcode')
  assert.match(disabledStep.installError, /已在插件设置中关闭/)
  assert.equal(disabledStep.methodId, 'script-powershell')
  assert.match(disabledStep.uninstallCommand, /D:\/AI\/tools/)
  assert.equal(disabledStep.uninstallError, undefined, 'disabling remote scripts still permits local removal')
})

test('invalid Host install settings reject previews and actions before any CLI is touched', async () => {
  const receiver = {
    services: { installSettingsError: () => 'invalid install directory' },
    installSettings: OfficialToolsRemoteService.prototype.installSettings,
  }
  assert.throws(() => receiver.installSettings(), /invalid install directory/)
  for (const method of ['installTool', 'repairTool', 'uninstallTool']) {
    const result = await OfficialToolsRemoteService.prototype[method].call(receiver, { tool: 'codex', method: 'npm' })
    assert.equal(result.ok, false)
    assert.match(result.error, /invalid install directory/)
  }
})

test('router upgrade retains its package identity and contains no GAL payload', () => {
  assert.equal(manifest.name, '@ljwei-stak/dsh-model-router')
  assert.equal(manifest.version, '0.24.0')
  assert.ok(manifest.files.every(file => !/gal-story|gal-module|GAL_|ECHO_CITY|aipicture|gal-.*preview/.test(file)))
  const client = read('.dsh-plugin/client/official-harness.jsx')
  assert.match(client, /export const ROUTER_NAMESPACE = 'model-router-galgame'/)
  assert.doesNotMatch(client, /GalModulePage|GAL_PANEL|cancelGalReply|galReply/)
  const bundle = read('.dsh-plugin/client.js')
  assert.ok(Buffer.byteLength(bundle) < 1_000_000, 'router must not embed GAL art')
  assert.doesNotMatch(bundle, /data:image\/(?:png|webp)|echo-chronicle|model-router:gal-story:v1/)
})

test('0.13.0 package rename: the loader imports the new name, the profile entry id stays for existing settings', async () => {
  const patch = read('cordis.patch.yml')
  assert.match(patch, /^\s+- id: model-router-galgame$/m, 'entry id kept so saved settings and panel state still apply')
  assert.match(patch, new RegExp(`^\\s+name: '${manifest.name.replace('/', '\\/')}'$`, 'm'), 'inserted row must import this package')
  assert.doesNotMatch(patch, /name: '@ljwei-stak\/model-router-galgame'/)
  const client = read('.dsh-plugin/client/official-harness.jsx')
  assert.match(client, new RegExp(`export const ROUTER_PACKAGE = '${manifest.name}'`))
  assert.match(client, /export const ROUTER_PANEL = 'model-router-galgame'/)
  const { OFFICIAL_TOOLS_REMOTE_PACKAGE } = await import('../.dsh-plugin/shared/official-tools-remote.mjs')
  const { ROUTER_PACKAGE_NAME } = await import('../.dsh-plugin/shared/npm-update.mjs')
  assert.equal(OFFICIAL_TOOLS_REMOTE_PACKAGE, manifest.name)
  assert.equal(ROUTER_PACKAGE_NAME, manifest.name, 'update checks query the renamed package')
  const host = await import('../.dsh-plugin/index.mjs')
  assert.equal(host.name, 'model-router-galgame')
})

test('router remote retains installer methods and owns no GAL endpoints', () => {
  assert.equal(OFFICIAL_TOOLS_REMOTE_NAMESPACE, 'modelRouterOfficialTools')
  assert.deepEqual(OFFICIAL_TOOLS_REMOTE_DESCRIPTORS.map(item => item.method), [
    'list', 'installSettings', 'installTool', 'uninstallTool', 'repairTool', 'cancel', 'status',
    'health', 'completeOnboarding', 'ledger', 'rateResult', 'rerunStep', 'boundaries', 'previewRun', 'startRun', 'runStatus', 'cancelRun',
    'terminalInfo', 'terminalStart', 'terminalRead', 'terminalWrite', 'terminalResize', 'terminalStop',
  ])
  for (const method of ['installTool', 'uninstallTool', 'repairTool']) {
    assert.equal(typeof OfficialToolsRemoteService.prototype[method], 'function', method)
    // All three take one strict request object, never a bare id: a bare id could
    // not carry a method, and a free-form object could carry a command.
    const descriptor = OFFICIAL_TOOLS_REMOTE_DESCRIPTORS.find(item => item.method === method)
    assert.equal(descriptor.parameters.length, 1, method)
    assert.equal(descriptor.parameters[0].name, 'request', method)
    const parse = descriptor.parameters[0].codec.create().parse
    assert.deepEqual(parse({ tool: 'opencode', method: 'npm' }), { tool: 'opencode', method: 'npm' }, method)
    assert.deepEqual(parse({ tool: 'opencode' }), { tool: 'opencode' }, `${method} without a method`)
    assert.throws(() => parse({ tool: 'nope' }), /official tool/, method)
    assert.throws(() => parse({ tool: 'opencode', method: 'apt-get' }), /does not offer/, method)
    assert.throws(() => parse({ tool: 'opencode', args: ['-g', 'x'] }), TypeError, method)
  }
  for (const method of ['terminalInfo', 'terminalStart', 'terminalRead', 'terminalWrite', 'terminalResize', 'terminalStop']) {
    assert.equal(typeof OfficialToolsRemoteService.prototype[method], 'function', method)
  }
  assert.equal(OfficialToolsRemoteService.prototype.galReply, undefined)
  assert.equal(OfficialToolsRemoteService.prototype.cancelGalReply, undefined)
})
