import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { getOfficialTool, installMethodFor, toolForProvider } from '../.dsh-plugin/shared/official-tool-registry.mjs'
import { resolveInstallPlan, resolveUninstallPlan } from '../.dsh-plugin/shared/tool-install-preferences.mjs'
import { vendorScriptInvocation, planCommandLine, verifiedVendorScript } from '../.dsh-plugin/shared/official-tools-runtime.mjs'
import { resolveTerminalLaunch } from '../.dsh-plugin/shared/cli-terminal.mjs'
import { officialToolExecutionCapabilities, officialToolReadiness } from '../.dsh-plugin/shared/official-tool-executor.mjs'
import { checkLogin, LOGIN_GUIDES } from '../.dsh-plugin/shared/tool-health.mjs'
import { TERMINAL_TARGETS, TERMINAL_LOGIN_ARGS, terminalCanLogin, terminalCommandPreview, parseTerminalStart } from '../.dsh-plugin/shared/cli-terminal-protocol.mjs'
import { createLatestVersions, latestSourceFor } from '../.dsh-plugin/shared/latest-versions.mjs'

const normalize = value => String(value).replaceAll('\\', '/')
const throwFn = async () => { throw new Error('injected dependency must not be called') }

test('pi package plans and hermes script defaults', () => {
  const pi = getOfficialTool('pi')
  const hermes = getOfficialTool('hermes')
  assert.ok(pi && hermes)
  assert.equal(toolForProvider('api'), null)
  assert.equal(toolForProvider('example-api'), null)

  for (const manager of ['npm', 'pnpm']) {
    const method = installMethodFor(pi, manager)
    assert.ok(method)
    const plan = resolveInstallPlan(pi, manager, { installDir: 'D:/AI/tools' }, { platform: 'win32', home: 'C:/Users/test', env: {} })
    assert.equal(plan.kind, 'package-manager')
    assert.ok(Array.isArray(plan.args))
    assert.equal('spec' in plan, false)
    assert.ok(plan.args.includes('--ignore-scripts'))
    assert.ok(plan.args.includes(method.spec))
    assert.equal(plan.installDir, 'D:/AI/tools')
    assert.equal(normalize(plan.binDir), 'D:/AI/tools')
  }

  const winPlan = resolveInstallPlan(hermes, undefined, {}, { platform: 'win32', home: 'C:/Users/test', env: { LOCALAPPDATA: 'C:/Users/test/AppData/Local' } })
  assert.equal(winPlan.kind, 'script')
  assert.equal(winPlan.shell, 'powershell')
  const linuxPlan = resolveInstallPlan(hermes, undefined, {}, { platform: 'linux', home: '/home/test', env: {} })
  assert.equal(linuxPlan.shell, 'bash')

  const invocation = vendorScriptInvocation(winPlan, 'C:/temp/install.ps1')
  assert.ok(Array.isArray(invocation.args))
  assert.deepEqual(invocation.args.slice(invocation.args.indexOf('C:/temp/install.ps1') + 1), ['-NonInteractive'])
  assert.deepEqual(vendorScriptInvocation(linuxPlan, '/tmp/install.sh').args, ['/tmp/install.sh', '--non-interactive'])
  assert.match(planCommandLine(winPlan), /scriptblock.*-NonInteractive/)
  assert.match(planCommandLine(linuxPlan), /bash -s -- --non-interactive/)

  assert.throws(() => resolveInstallPlan(hermes, 'script-powershell', {}, { platform: 'linux', home: '/home/test', env: {} }), /仅支持/)
})

test('hermes binary locations and uninstall rejection', () => {
  const hermes = getOfficialTool('hermes')
  const cases = [
    [{ platform: 'win32', env: { HERMES_HOME: 'C:/data/hermes' }, home: 'C:/Users/test' }, 'C:/data/hermes/bin'],
    [{ platform: 'win32', env: { LOCALAPPDATA: 'C:/Users/test/AppData/Local' }, home: 'C:/Users/test' }, 'C:/Users/test/AppData/Local/hermes/bin'],
    [{ platform: 'win32', env: {}, home: 'C:/Users/test' }, 'C:/Users/test/AppData/Local/hermes/bin'],
    [{ platform: 'linux', env: {}, home: '/home/test' }, '/home/test/.local/bin'],
    [{ platform: 'linux', env: { HERMES_HOME: '/data/hermes' }, home: '/home/test' }, '/home/test/.local/bin'],
  ]
  for (const [options, expected] of cases) {
    assert.equal(normalize(resolveInstallPlan(hermes, undefined, {}, options).binDir), expected)
  }

  const custom = resolveInstallPlan(hermes, undefined, { installDir: 'D:/AI/tools' }, { platform: 'win32', env: { HERMES_HOME: 'C:/data/hermes' }, home: 'C:/Users/test' })
  assert.equal(normalize(custom.binDir), 'C:/data/hermes/bin')
  assert.equal('HERMES_HOME' in custom.env, false)
  assert.ok(custom.notices.length > 0)

  assert.throws(() => resolveUninstallPlan(hermes, undefined, { installDir: 'D:/AI/tools' }, { platform: 'win32', env: { HERMES_HOME: 'C:/data/hermes' }, home: 'C:/Users/test' }), /hermes uninstall/)
})

test('terminal and health contracts', async () => {
  assert.ok(TERMINAL_TARGETS.includes('hermes'))
  assert.ok(TERMINAL_TARGETS.includes('pi'))
  assert.deepEqual(TERMINAL_LOGIN_ARGS.hermes, ['auth'])
  assert.equal(terminalCanLogin('hermes'), true)
  assert.equal(terminalCanLogin('pi'), false)
  assert.equal(terminalCommandPreview('hermes', 'login', 'win32'), 'hermes auth')
  assert.equal(LOGIN_GUIDES.hermes.command, 'hermes auth')
  assert.equal(LOGIN_GUIDES.pi.command, 'pi')
  assert.ok(LOGIN_GUIDES.pi.steps.includes('/login'))

  assert.throws(() => parseTerminalStart({ target: 'pi', mode: 'login', cwd: 'C:/work', cols: 80, rows: 24, confirmed: true }), /no login mode/)

  for (const id of ['hermes', 'pi']) {
    const login = await checkLogin(id, { env: {}, home: '/fake-home', runner: throwFn, exists: throwFn, readAuthState: throwFn })
    assert.equal(login.state, 'unknown')
  }

  const caps = officialToolExecutionCapabilities()
  for (const id of ['hermes', 'pi']) {
    const capability = caps.find(item => item.id === id)
    assert.equal(capability.supported, false)
    assert.deepEqual(capability.modes, [])
    assert.equal((await officialToolReadiness(id)).ready, false)
  }
})

test('windows hermes terminal launch uses injected file checks', async () => {
  const launch = await resolveTerminalLaunch('hermes', 'login', {
    platform: 'win32',
    env: { HERMES_HOME: 'C:/data/hermes' },
    home: 'C:/Users/test',
    preferences: { installDir: 'D:/AI/tools' },
    fileExists: async path => normalize(path) === 'C:/data/hermes/bin/hermes.exe',
    locate: throwFn,
  })
  assert.deepEqual(launch.args, ['auth'])
  assert.equal(normalize(launch.file), 'C:/data/hermes/bin/hermes.exe')
})

test('pi manifest fixture launch', async t => {
  const root = await mkdtemp(join(tmpdir(), 'router-pi-'))
  t.after(async () => {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('boundary')
    await rm(root, { recursive: true, force: true })
  })

  const pkgDir = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent')
  await mkdir(join(pkgDir, 'dist', 'bundle'), { recursive: true })
  await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '1.3.0', bin: { pi: 'dist/bundle/cli.js' } }))
  const entry = join(pkgDir, 'dist', 'bundle', 'cli.js')
  await writeFile(entry, '// fixture\n')
  const expectedEntry = await realpath(entry)

  const launch = await resolveTerminalLaunch('pi', 'interactive', {
    platform: 'win32',
    env: {},
    cwd: root,
    home: root,
    preferences: { installDir: root, methods: { pi: 'npm' } },
    findNode: async (cwd, min) => {
      assert.deepEqual(min, [22, 19, 0])
      return 'C:/node/node.exe'
    },
    locate: throwFn,
  })
  assert.equal(launch.file, 'C:/node/node.exe')
  assert.deepEqual(launch.args, [expectedEntry])

  await assert.rejects(resolveTerminalLaunch('pi', 'interactive', {
    platform: 'win32',
    env: {},
    cwd: root,
    home: root,
    preferences: { installDir: root, methods: { pi: 'npm' } },
    findNode: async () => null,
    locate: throwFn,
  }), /22\.19/)

  await rm(entry)
  await assert.rejects(resolveTerminalLaunch('pi', 'interactive', {
    platform: 'win32', env: {}, cwd: root, home: root,
    preferences: { installDir: root, methods: { pi: 'npm' } },
    findNode: throwFn, locate: throwFn,
  }), /真实命令入口/)
})

test('vendor script verification', () => {
  const hermes = getOfficialTool('hermes')
  const verify = installMethodFor(hermes, 'script-bash').verify
  const markers = Array.from(verify.mustInclude)

  const good = `#!/usr/bin/env bash\n# ${markers.join('\n# ')}\n`
  const verified = verifiedVendorScript(Buffer.from(good), verify)
  assert.equal(verified, good)

  assert.throws(() => verifiedVendorScript(Buffer.from('<html><body>hermes</body></html>'), verify))
  const partial = `#!/usr/bin/env bash\n# ${markers[0]}\n`
  assert.throws(() => verifiedVendorScript(Buffer.from(partial), verify))
})

test('latest version offline and pi source', async () => {
  const hermes = getOfficialTool('hermes')
  const pi = getOfficialTool('pi')
  assert.deepEqual(latestSourceFor(pi), { kind: 'npm', package: '@earendil-works/pi-coding-agent' })

  const expectedUrl = 'https://api.github.com/repos/NousResearch/hermes-agent/releases/latest'
  assert.deepEqual(latestSourceFor(hermes), { kind: 'hermes-github-release', url: expectedUrl })

  const urls = []
  const versions = createLatestVersions({
    persist: false,
    fetchImpl: async url => {
      urls.push(url)
      return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ tag_name: 'v0.5.0', draft: false, prerelease: false }) }
    },
  })
  const result = await versions.lookup(hermes, { fresh: true })
  assert.equal(result.version, '0.5.0')
  assert.deepEqual(urls, [expectedUrl])

  for (const body of [
    { tag_name: 'v0.6.0', draft: true, prerelease: false },
    { tag_name: 'v0.6.0-beta.1', draft: false, prerelease: true },
    { tag_name: 'nightly', draft: false, prerelease: false },
  ]) {
    const badUrls = []
    const badVersions = createLatestVersions({
      persist: false,
      fetchImpl: async url => {
        badUrls.push(url)
        return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(body) }
      },
    })
    const badResult = await badVersions.lookup(hermes, { fresh: true })
    assert.equal(badResult.version, null)
    assert.ok(badResult.error)
    assert.deepEqual(badUrls, [expectedUrl])
  }
})
