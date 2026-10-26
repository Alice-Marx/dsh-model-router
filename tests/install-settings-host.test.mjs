import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as host from '../.dsh-plugin/index.mjs'
import { OFFICIAL_TOOLS_REMOTE_NAMESPACE } from '../.dsh-plugin/shared/official-tools-remote.mjs'
import { installPreferences, installStatus, resetForTests, setInstallPreferences } from '../.dsh-plugin/shared/official-tools-runtime.mjs'

async function mountedRouter(t, initial = {}) {
  resetForTests()
  const root = new Context()
  const commands = new Map()
  const tools = new Map()
  const services = {
    commands: { register: command => commands.set(command.name, command) },
    tools: { register: tool => tools.set(tool.name, tool) },
    llm: {},
    typert: { register: () => () => {} },
    sandboxPolicy: {},
    sandbox: {},
  }
  for (const [name, service] of Object.entries(services)) root.provide(name, service)
  const loaderFiber = root.plugin(Loader)
  await loaderFiber
  let applyCount = 0
  root.loader.builtins.router = {
    Config: host.Config,
    inject: host.inject,
    apply(ctx, config) {
      applyCount += 1
      host.apply(ctx, config)
    },
  }
  await root.loader.create({ id: 'router', name: 'cordis:router', config: initial })
  await root.loader.await()
  const entry = root.loader.resolve('router')
  assert.equal(entry.fiber?.state, 2, 'real Loader activated the router plugin')
  const originalFiber = entry.fiber
  const remote = root.get(OFFICIAL_TOOLS_REMOTE_NAMESPACE)
  assert.ok(remote, 'the plugin registered its real remote service')
  t.after(async () => {
    for (const loaded of [...root.loader.entries()].reverse()) root.loader.remove(loaded.id)
    await loaderFiber.dispose()
    resetForTests()
  })
  return {
    root, entry, remote, commands, tools,
    async save(patch) {
      // This is the Entry path used by profile reconciliation after a settings write.
      await entry.update({ config: { ...entry.options.config, ...patch } })
      await root.loader.await()
      assert.equal(entry.fiber, originalFiber, 'volatile settings retain the same fiber')
      assert.equal(applyCount, 1, 'volatile settings do not call apply again')
    },
  }
}

test('real Loader saves npm, pnpm and automatic selection into runtime prefs without reloading', async t => {
  const { save, remote, entry } = await mountedRouter(t)
  for (const method of ['npm', 'pnpm', null]) {
    const methods = method ? { codex: method } : {}
    await save({ toolInstallMethodsJson: JSON.stringify(methods) })
    assert.equal(entry.fiber.config.toolInstallMethodsJson.get(), JSON.stringify(methods))
    assert.deepEqual(installPreferences().methods, methods, 'the installer reads the acknowledged choice')
    const summary = remote.installSettings().install
    const codex = summary.tools.find(tool => tool.id === 'codex')
    assert.equal(codex.savedMethodId, method)
    assert.equal(codex.methodId, method ?? 'npm')
    assert.match(codex.command, method === 'pnpm' ? /pnpm/ : /npm/)
  }
})

test('real Loader immediately applies directory, sources and script policy together', async t => {
  const { save, remote } = await mountedRouter(t)
  const stepMethod = process.platform === 'win32' ? 'script-powershell' : 'script-bash'
  const scriptUrl = `https://mirror.example.com/stepcode/install.${process.platform === 'win32' ? 'ps1' : 'sh'}`
  await save({
    toolInstallDir: 'D:/AI/tools',
    toolNpmRegistry: 'https://registry.npmmirror.com/',
    toolInstallMethodsJson: JSON.stringify({ stepcode: stepMethod }),
    toolScriptUrlsJson: JSON.stringify({ stepcode: scriptUrl }),
    toolAllowScriptInstall: false,
  })
  const summary = remote.installSettings().install
  assert.equal(summary.installDir, 'D:/AI/tools')
  assert.equal(summary.registry, 'https://registry.npmmirror.com/')
  assert.equal(summary.allowScriptInstall, false)
  assert.deepEqual(summary.scriptUrls, { stepcode: scriptUrl })
  assert.equal(summary.tools.find(tool => tool.id === 'stepcode').savedMethodId, stepMethod)
  assert.match(summary.tools.find(tool => tool.id === 'stepcode').error, /关闭/)
  const codex = summary.tools.find(tool => tool.id === 'codex')
  assert.match(codex.command, /registry\.npmmirror\.com/)
  assert.match(codex.command, /D:\/AI\/tools/)
})

test('a different Loader fiber cannot overwrite this plugin install preferences', async t => {
  const { root, save } = await mountedRouter(t, { toolInstallMethodsJson: '{"codex":"pnpm"}' })
  root.loader.builtins.other = {
    Config: host.Config,
    apply() {},
  }
  await root.loader.create({ id: 'other', name: 'cordis:other', config: {} })
  await root.loader.await()
  await root.loader.resolve('other').update({ config: { toolInstallMethodsJson: '{"codex":"npm"}' } })
  assert.deepEqual(installPreferences().methods, { codex: 'pnpm' })
  await save({ dailyBudgetUsd: 12 })
  assert.deepEqual(installPreferences().methods, { codex: 'pnpm' })
})

test('Host summaries preserve the saved home path separately from its resolved directory', async t => {
  const { save, remote } = await mountedRouter(t)
  await save({ toolInstallDir: '~/AI/tools' })
  const summary = remote.installSettings().install
  assert.equal(summary.requestedInstallDir, '~/AI/tools')
  assert.notEqual(summary.installDir, summary.requestedInstallDir)
  assert.match(summary.installDir.replaceAll('\\', '/'), /\/AI\/tools$/)
})

test('standalone ZCode follows live unified directory settings and exposes common maintenance commands', async t => {
  const { save, remote } = await mountedRouter(t, { toolInstallDir: 'D:/AI/tools' })
  const before = remote.installSettings().install.tools.find(tool => tool.id === 'zcode')
  assert.match(before.installDir.replaceAll('\\', '/'), /^D:\/AI\/tools\/zcode-cli(?:\/bin)?$/)
  assert.equal(before.methodId, 'github-release')
  assert.match(before.command, /Alice-Marx\/zcode-cli/)
  assert.ok(before.uninstallCommand)
  assert.equal(before.installError, undefined)
  await save({ toolInstallDir: 'D:/AI/updated-tools' })
  const summary = remote.installSettings().install
  const zcode = summary.tools.find(tool => tool.id === 'zcode')
  assert.equal(installPreferences().installDir, 'D:/AI/updated-tools')
  assert.match(zcode.installDir.replaceAll('\\', '/'), /^D:\/AI\/updated-tools\/zcode-cli(?:\/bin)?$/)
  assert.equal(zcode.updateInstallDir, zcode.installDir)
  assert.equal(zcode.updateCommand, zcode.command)
  assert.equal(zcode.uninstallError, undefined)
  await save({ toolInstallMethodsJson: '{"zcode":"npm"}', toolNpmRegistry: 'https://registry.npmmirror.com/' })
  const npm = remote.installSettings().install.tools.find(tool => tool.id === 'zcode')
  assert.equal(installPreferences().methods.zcode, 'npm')
  assert.equal(npm.methodId, 'npm')
  assert.equal(npm.installDir, process.platform === 'win32' ? 'D:/AI/updated-tools' : 'D:/AI/updated-tools/bin')
  assert.match(npm.command, /@ljwei-stak\/zcode-cli@latest/)
  assert.match(npm.command, /--registry=https:\/\/registry\.npmmirror\.com\//)
  assert.match(npm.uninstallCommand, /npm uninstall -g @ljwei-stak\/zcode-cli/)
  assert.equal(npm.uninstallError, undefined)
})

test('invalid live settings keep verified preferences and block all install command surfaces', async t => {
  const { save, remote, commands, tools } = await mountedRouter(t, {
    toolInstallMethodsJson: '{"codex":"pnpm"}',
    toolAllowScriptInstall: false,
  })
  const verified = installPreferences()
  await save({ toolInstallMethodsJson: '{"codex":"arbitrary-command"}', toolAllowScriptInstall: true })
  assert.deepEqual(installPreferences(), verified, 'a parse failure never partially enables scripts')
  assert.match(remote.services.installSettingsError(), /不支持安装方式/)
  assert.throws(() => remote.installSettings(), /安装设置无效/)
  for (const action of ['install', 'repair', 'uninstall']) {
    const result = await commands.get('tools').handler({ rawInput: `${action} codex` })
    assert.equal(result.kind, 'error')
    assert.match(result.text, /安装设置无效/)
    await assert.rejects(tools.get(`model_router_tool_${action}`).execute({ tool: 'codex' }, {}), /安装设置无效/)
    const response = await remote[`${action}Tool`]({ tool: 'codex' })
    assert.equal(response.ok, false)
    assert.match(response.error, /安装设置无效/)
    assert.equal(installStatus('codex'), null, 'rejected settings must not start a process or a job')
  }
  await save({ toolInstallMethodsJson: '{"codex":"npm"}', toolAllowScriptInstall: false })
  assert.equal(remote.services.installSettingsError(), null, 'a valid replacement clears the error')
  assert.deepEqual(installPreferences().methods, { codex: 'npm' })
  assert.equal(installPreferences().allowScriptInstall, false)
})


test('health probes and latest lookup use one captured installation preference snapshot', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'zcode-health-preferences-'))
  const previousHome = process.env.DSH_HOME
  const original = installPreferences()
  process.env.DSH_HOME = directory
  t.after(async () => {
    setInstallPreferences(original)
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(directory, { recursive: true, force: true })
  })
  // A separate Host module instance gives this check an isolated persistent store.
  const isolatedHost = await import('../.dsh-plugin/index.mjs?health-preferences-test')
  const expected = { installDir: 'D:/selected/npm-tools', registry: 'https://registry.npmmirror.com/',
    methods: { zcode: 'npm' }, scriptUrls: {}, allowScriptInstall: false }
  setInstallPreferences(expected)
  let probed, lookup
  const report = await isolatedHost.toolHealthReport({ fresh: true,
    runner: async () => { throw new Error('this isolated preference check must not launch a CLI') },
    probeTools: async options => {
      probed = options
      setInstallPreferences({ ...expected, installDir: 'D:/changed/later', methods: { zcode: 'github-release' } })
      return [{ id: 'zcode', installed: false, status: 'not-installed', version: null }]
    },
    latest: { async lookupAll(tools, options) {
      lookup = options
      assert.ok(tools.some(tool => tool.id === 'zcode'))
      return { zcode: { version: '3.16.3' } }
    } },
  })
  assert.equal(probed.fresh, true)
  assert.deepEqual(probed.preferences, expected)
  assert.equal(lookup.preferences, probed.preferences, 'both asynchronous operations use the same captured object')
  assert.deepEqual(lookup.preferences, expected)
  assert.equal(installPreferences().methods.zcode, 'github-release', 'the later global change did not rewrite the captured snapshot')
  assert.equal(report.tools.find(tool => tool.id === 'zcode').latestVersion, '3.16.3')
})
