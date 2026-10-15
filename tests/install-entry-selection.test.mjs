import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve, sep } from 'node:path'
import { brotliCompressSync } from 'node:zlib'
import {
  findGlobalPackageEntries, findManagedMiniMaxEntry, findSignedPackagedCodex, miniMaxReleaseVersion, officialToolEntrySelection, officialToolReadiness,
} from '../.dsh-plugin/shared/official-tool-executor.mjs'
import {
  currentInstallOptions, installPreferences, loginLaunchForProbe, probeToolWith, setInstallPreferences,
} from '../.dsh-plugin/shared/official-tools-runtime.mjs'
import { checkToolHealth } from '../.dsh-plugin/shared/tool-health.mjs'
import { getOfficialTool } from '../.dsh-plugin/shared/official-tool-registry.mjs'
import { resolveInstallPlan } from '../.dsh-plugin/shared/tool-install-preferences.mjs'
import { resolveMiMoGrokLaunch } from '../.dsh-plugin/shared/vendor-mimo-grok-adapter.mjs'

async function fixtureRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'router-install-entry-'))
  t.after(async () => {
    if (resolve(root).startsWith(`${resolve(tmpdir())}${sep}`)) await rm(root, { recursive: true, force: true })
  })
  return root
}

for (const method of ['npm', 'pnpm']) {
  test(`login status uses the selected ${method} package entry instead of another PATH copy`, async t => {
    const root = await fixtureRoot(t)
    const selected = join(root, 'selected')
    const modules = method === 'pnpm' ? join(selected, '.pnpm', 'global', '5', 'node_modules')
      : process.platform === 'win32' ? join(selected, 'node_modules') : join(selected, 'lib', 'node_modules')
    const packageRoot = await packageFixture(modules, '@openai/codex', '1.0.0', 'codex', 'bin/codex.js')
    const other = join(root, 'other')
    await packageFixture(join(other, 'node_modules'), '@openai/codex', '9.0.0', 'codex', 'bin/codex.js')
    const priorPath = process.env.PATH
    process.env.PATH = [other, priorPath].filter(Boolean).join(delimiter)
    t.after(() => { if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath })
    const preferences = { installDir: selected, methods: { codex: method }, allowScriptInstall: true }
    const probe = await probeToolWith(getOfficialTool('codex'), async () => { throw new Error('installation probe must use package metadata') },
      { preferences, cache: new Map() })
    assert.equal(probe.packageRoot, await realpath(packageRoot))
    const seen = []
    const resolveLoginLaunch = selectedProbe => loginLaunchForProbe(selectedProbe, { findNode: async () => process.execPath })
    const runner = async (file, args, options) => {
      seen.push({ file, args, options })
      return { ok: false, stdout: 'Not logged in', stderr: '', code: 1 }
    }
    const health = await checkToolHealth(probe, { runner, resolveLoginLaunch, env: { OPENAI_API_KEY: 'unprinted-key' } })
    assert.equal(health.login.source, 'environment')
    assert.equal(health.login.accountLogin, false)
    assert.equal(seen.length, 1)
    assert.equal(seen[0].file, process.execPath)
    assert.deepEqual(seen[0].args, [probe.packageEntry, 'login', 'status'])
    assert.equal(seen[0].options.useShell, false)
    assert.equal(seen[0].options.env.OPENAI_API_KEY, undefined)

    const account = await checkToolHealth(probe, { runner, resolveLoginLaunch, env: {} })
    assert.equal(account.login.state, 'logged-out', 'a logged-in PATH copy cannot change the selected copy status')
    await unlink(probe.packageEntry)
    const callsBeforeMissing = seen.length
    const missing = await checkToolHealth(probe, { runner, resolveLoginLaunch, env: {} })
    assert.equal(missing.login.state, 'unknown')
    assert.match(missing.login.detail, /所选安装副本.*PATH/)
    assert.equal(seen.length, callsBeforeMissing, 'a vanished selected entry never falls back to PATH')
  })
}

test('native login checks keep the probed executable and do not substitute a PATH command', async t => {
  const root = await fixtureRoot(t)
  const entry = join(root, 'native', 'claude.exe')
  await mkdir(join(root, 'native'))
  await writeFile(entry, 'selected-native-fixture')
  const probe = { id: 'claude-code', installed: true, version: '2.1.259', executablePath: entry }
  const seen = []
  const health = await checkToolHealth(probe, { env: {}, runner: async (file, args, options) => {
    seen.push({ file, args, options })
    return { ok: true, stdout: '{"loggedIn":true,"authMethod":"claude.ai"}', stderr: '', code: 0 }
  } })
  assert.equal(health.login.state, 'logged-in')
  assert.equal(seen[0].file, entry)
  assert.deepEqual(seen[0].args, ['auth', 'status', '--json'])
  assert.equal(seen[0].options.useShell, false)
})

test('an installed probe without a selected entry cannot run a bare login-status command', async () => {
  const health = await checkToolHealth({ id: 'codex', installed: true, version: '1.0.0' }, {
    env: {}, runner: async () => { throw new Error('bare PATH login check must not run') },
  })
  assert.equal(health.login.state, 'unknown')
  assert.match(health.login.detail, /所选安装副本/)
})

async function packageFixture(modules, name, version, binName, binPath, extra = {}) {
  const root = join(modules, ...name.split('/'))
  await mkdir(join(root, ...binPath.split('/').slice(0, -1)), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name, version, bin: { [binName]: binPath }, ...extra }))
  await writeFile(join(root, ...binPath.split('/')), 'official-entry-fixture')
  return root
}

function configuredPreferences(t, value) {
  const before = installPreferences()
  setInstallPreferences({ installDir: '', registry: '', methods: {}, scriptUrls: {}, allowScriptInstall: true, ...value })
  t.after(() => { setInstallPreferences(before) })
}

test('a configured npm directory wins over a newer PATH copy and missing targets stay missing', async t => {
  const root = await fixtureRoot(t)
  const selected = join(root, 'selected')
  const other = join(root, 'other')
  const modules = process.platform === 'win32' ? join(selected, 'node_modules') : join(selected, 'lib', 'node_modules')
  const installed = await packageFixture(modules, '@moonshot-ai/kimi-code', '1.0.0', 'kimi', 'dist/main.mjs')
  await packageFixture(join(other, 'node_modules'), '@moonshot-ai/kimi-code', '9.0.0', 'kimi', 'dist/main.mjs')
  const beforePath = process.env.PATH
  process.env.PATH = [other, beforePath].filter(Boolean).join(delimiter)
  t.after(() => { if (beforePath === undefined) delete process.env.PATH; else process.env.PATH = beforePath })
  configuredPreferences(t, { installDir: selected, methods: { 'kimi-code': 'npm' } })
  const selection = officialToolEntrySelection('kimi-code')
  assert.deepEqual(selection.directories, [process.platform === 'win32' ? selected : join(selected, 'bin')])
  const entries = await findGlobalPackageEntries('@moonshot-ai/kimi-code', 'kimi', 'dist/main.mjs', process.cwd())
  assert.deepEqual(entries.map(entry => entry.version), ['1.0.0'])
  assert.equal(entries[0].packageRoot, await realpath(installed))
  setInstallPreferences({ installDir: join(root, 'not-installed') })
  assert.deepEqual(await findGlobalPackageEntries('@moonshot-ai/kimi-code', 'kimi', 'dist/main.mjs', process.cwd()), [])
})

test('pnpm uses its configured global tree even when an npm copy exists in the same prefix', async t => {
  const root = await fixtureRoot(t)
  const prefix = join(root, 'bin')
  await packageFixture(join(prefix, 'node_modules'), '@moonshot-ai/kimi-code', '9.0.0', 'kimi', 'dist/main.mjs')
  const installed = await packageFixture(join(prefix, '.pnpm', 'global', '5', 'node_modules'),
    '@moonshot-ai/kimi-code', '1.2.0', 'kimi', 'dist/main.mjs')
  configuredPreferences(t, { installDir: prefix, methods: { 'kimi-code': 'pnpm' } })
  const entries = await findGlobalPackageEntries('@moonshot-ai/kimi-code', 'kimi', 'dist/main.mjs', process.cwd())
  assert.deepEqual(entries.map(entry => entry.version), ['1.2.0'])
  assert.equal(entries[0].packageRoot, await realpath(installed))
})

test('automatic npm probes and launch discovery ignore a newer pnpm copy on the same PATH', async t => {
  const root = await fixtureRoot(t)
  const binDir = process.platform === 'win32' ? root : join(root, 'bin')
  await mkdir(binDir, { recursive: true })
  const npm = await packageFixture(process.platform === 'win32' ? join(root, 'node_modules') : join(root, 'lib', 'node_modules'),
    '@moonshot-ai/kimi-code', '1.0.0', 'kimi', 'dist/main.mjs')
  await packageFixture(join(root, '.pnpm', 'global', '5', 'node_modules'),
    '@moonshot-ai/kimi-code', '2.0.0', 'kimi', 'dist/main.mjs')
  const beforePath = process.env.PATH
  process.env.PATH = binDir
  t.after(() => { if (beforePath === undefined) delete process.env.PATH; else process.env.PATH = beforePath })
  configuredPreferences(t, {})
  const preferences = installPreferences()
  const tool = getOfficialTool('kimi-code')
  const selection = officialToolEntrySelection(tool.id, { preferences })
  assert.equal(selection.plan.manager, 'npm')
  assert.equal(selection.configured, false)
  const runner = async () => { throw new Error('package detection must not execute the shared command shim') }
  const probe = await probeToolWith(tool, runner, { preferences, cache: new Map() })
  const discover = () => findGlobalPackageEntries(tool.package, 'kimi', 'dist/main.mjs', process.cwd(),
    { selection, directories: selection.directories })
  assert.equal(probe.version, '1.0.0')
  assert.deepEqual((await discover()).map(entry => entry.version), ['1.0.0'])
  assert.equal(probe.packageRoot, await realpath(npm))

  assert.ok(resolve(npm).startsWith(`${resolve(root)}${sep}`))
  await rm(npm, { recursive: true })
  const missing = await probeToolWith(tool, runner, { preferences, cache: new Map() })
  assert.equal(missing.installed, false)
  assert.deepEqual(await discover(), [])
  const readiness = await officialToolReadiness(tool.id, process.cwd(), { preferences })
  assert.equal(readiness.ready, false)
  assert.match(readiness.reason, /未找到官方 npm 包/)
})

test('a frozen pnpm job follows exact package roots separated from its bin directory', async t => {
  const root = await fixtureRoot(t)
  const binDir = join(root, 'commands')
  const modules = join(root, 'package-store', 'global', '5', 'node_modules')
  const selected = await packageFixture(modules, '@moonshot-ai/kimi-code', '1.0.0', 'kimi', 'dist/main.mjs')
  await packageFixture(join(binDir, '.pnpm', 'global', '5', 'node_modules'),
    '@moonshot-ai/kimi-code', '9.0.0', 'kimi', 'dist/main.mjs')
  const plan = { kind: 'package-manager', methodId: 'pnpm', manager: 'pnpm', installDir: '', binDir, packageModuleRoots: [modules] }
  const preferences = { installDir: '', registry: '', methods: { 'kimi-code': 'pnpm' }, scriptUrls: {}, allowScriptInstall: true }
  const selection = officialToolEntrySelection('kimi-code', { preferences, plan })
  const find = options => findGlobalPackageEntries('@moonshot-ai/kimi-code', 'kimi', 'dist/main.mjs', process.cwd(), options)
  assert.equal(selection.plan.installDir, '')
  assert.deepEqual(selection.directories, [binDir])
  assert.deepEqual((await find({ selection })).map(entry => entry.version), ['1.0.0'])
  assert.equal((await find({ moduleRoots: [modules], directories: [binDir], manager: 'pnpm' }))[0].packageRoot, await realpath(selected))
  assert.deepEqual(await find({ moduleRoots: [], selection }), [], 'an explicit empty root list cannot fall back to the job or PATH layout')
  const tool = getOfficialTool('kimi-code')
  const runner = async () => { throw new Error('a frozen package target must not execute a shared shim') }
  assert.equal((await probeToolWith(tool, runner, { preferences, plan, cache: new Map() })).version, '1.0.0')
  assert.ok(resolve(selected).startsWith(`${resolve(root)}${sep}`))
  await rm(selected, { recursive: true })
  assert.deepEqual(await find({ selection }), [])
  assert.equal((await probeToolWith(tool, runner, { preferences, plan, cache: new Map() })).installed, false)
  assert.equal((await officialToolReadiness(tool.id, process.cwd(), { preferences, plan })).ready, false)
})

test('an installation job can discover its saved directory after live preferences change', async t => {
  const root = await fixtureRoot(t)
  const oldPrefix = join(root, 'job-target')
  const newPrefix = join(root, 'new-setting')
  const modulesAt = prefix => process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules')
  await packageFixture(modulesAt(oldPrefix), '@moonshot-ai/kimi-code', '1.0.0', 'kimi', 'dist/main.mjs')
  await packageFixture(modulesAt(newPrefix), '@moonshot-ai/kimi-code', '2.0.0', 'kimi', 'dist/main.mjs')
  configuredPreferences(t, { installDir: oldPrefix, methods: { 'kimi-code': 'npm' } })
  const snapshot = installPreferences()
  setInstallPreferences({ installDir: newPrefix })
  const selection = officialToolEntrySelection('kimi-code', { preferences: snapshot })
  assert.equal(selection.plan.installDir, oldPrefix)
  const entries = await findGlobalPackageEntries('@moonshot-ai/kimi-code', 'kimi', 'dist/main.mjs', process.cwd(), { selection })
  assert.deepEqual(entries.map(entry => entry.version), ['1.0.0'])
  const fallback = officialToolEntrySelection('minimax-code', { preferences: snapshot, preferredDirs: [oldPrefix] })
  assert.deepEqual(fallback.directories, [oldPrefix])
  assert.equal(fallback.directoryOverride, true)
  const noTargets = officialToolEntrySelection('kimi-code', { preferences: snapshot, preferredDirs: [] })
  assert.deepEqual(await findGlobalPackageEntries('@moonshot-ai/kimi-code', 'kimi', 'dist/main.mjs', process.cwd(), { selection: noTargets }), [])
})

test('Codex follows pnpm sibling platform links only inside its selected global tree', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixtureRoot(t)
  const prefix = join(root, 'selected')
  const virtualStore = join(prefix, '.pnpm', 'global', '5', 'node_modules', '.pnpm')
  const platform = process.arch === 'arm64' ? 'arm64' : 'x64'
  const wrapper = await packageFixture(join(virtualStore, '@openai+codex@0.162.1', 'node_modules'),
    '@openai/codex', '0.162.1', 'codex', 'bin/codex.js',
    { optionalDependencies: { [`@openai/codex-win32-${platform}`]: `npm:@openai/codex@0.162.1-win32-${platform}` } })
  const target = platform === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
  const nativeModules = join(virtualStore, `@openai+codex@0.162.1-win32-${platform}`, 'node_modules')
  const native = await packageFixture(nativeModules, '@openai/codex', `0.162.1-win32-${platform}`, 'codex', `vendor/${target}/bin/codex.exe`)
  const optionalLink = resolve(wrapper, '..', `codex-win32-${platform}`)
  await symlink(native, optionalLink, 'junction')
  const checked = []
  const options = { installDir: prefix, manager: 'pnpm', verifySignature: async (file, signer) => { checked.push([file, signer]); return true } }
  const found = await findSignedPackagedCodex(wrapper, process.cwd(), options)
  assert.equal(found?.entry, await realpath(join(native, 'vendor', target, 'bin', 'codex.exe')))
  assert.equal(checked.at(-1)[1], 'OpenAI OpCo, LLC')
  const defaultJob = await findSignedPackagedCodex(wrapper, process.cwd(), {
    ...options, installDir: '', moduleRoots: [join(prefix, '.pnpm', 'global', '5', 'node_modules')],
  })
  assert.equal(defaultJob?.entry, found.entry, 'a default pnpm job clamps its native package to the virtual store without assuming a custom prefix')
  assert.equal(await findSignedPackagedCodex(wrapper, process.cwd(), { ...options, verifySignature: async () => false }), null)
  await writeFile(join(native, 'package.json'), JSON.stringify({ name: '@openai/codex', version: `0.157.0-win32-${platform}` }))
  const beforeOlderCopy = checked.length
  assert.equal(await findSignedPackagedCodex(wrapper, process.cwd(), options), null)
  assert.equal(checked.length, beforeOlderCopy, 'a signed but different native package version cannot replace the wrapper dependency')
  await writeFile(join(native, 'package.json'), JSON.stringify({ name: '@openai/codex', version: `0.162.1-win32-${platform}` }))

  const outside = await packageFixture(join(root, 'outside'), '@openai/codex', `0.162.1-win32-${platform}`, 'codex', `vendor/${target}/bin/codex.exe`)
  await unlink(optionalLink)
  await symlink(outside, optionalLink, 'junction')
  const beforeOutside = checked.length
  assert.equal(await findSignedPackagedCodex(wrapper, process.cwd(), options), null)
  assert.equal(checked.length, beforeOutside, 'outside store targets fail before publisher verification')
})

test('a native script choice retains its directory when new script installations are disabled', () => {
  const before = installPreferences()
  try {
    setInstallPreferences({ installDir: '', registry: '', methods: { 'claude-code': process.platform === 'win32' ? 'script-powershell' : 'script-bash' }, scriptUrls: {}, allowScriptInstall: false })
    const selection = officialToolEntrySelection('claude-code')
    assert.equal(selection.plan.kind, 'script')
    assert.equal(selection.preferred, true)
    assert.equal(selection.directories.length, 1)
    assert.match(selection.directories[0], /[\\/]\.local[\\/]bin$/)
  } finally { setInstallPreferences(before) }
})

test('MiniMax automatic launch follows the Windows installation default and script switch', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixtureRoot(t)
  const tool = getOfficialTool('minimax-code')
  const preferences = { installDir: root, registry: '', methods: {}, scriptUrls: {}, allowScriptInstall: true }
  const enabled = officialToolEntrySelection(tool.id, { preferences })
  assert.equal(enabled.plan.methodId, 'script-powershell')
  assert.deepEqual(enabled.directories, [join(root, 'minimax-code')])

  const disabled = { ...preferences, allowScriptInstall: false }
  const installation = resolveInstallPlan(tool, undefined, disabled, currentInstallOptions())
  const automatic = officialToolEntrySelection(tool.id, { preferences: disabled })
  assert.equal(installation.methodId, 'npm')
  assert.equal(automatic.plan.methodId, installation.methodId)
  assert.deepEqual(automatic.directories, [installation.binDir])
  assert.equal(automatic.configured, true, 'disabling scripts cannot silently fall through to a managed script copy')

  const unconfigured = officialToolEntrySelection(tool.id, { preferences: { ...disabled, installDir: '' } })
  assert.equal(unconfigured.plan.methodId, 'npm')
  assert.equal(unconfigured.preferred, false)
  for (const methodId of ['script-powershell', 'npm', 'pnpm']) {
    const pinned = officialToolEntrySelection(tool.id, { preferences: { ...disabled, methods: { [tool.id]: methodId } } })
    assert.equal(pinned.plan.methodId, methodId, 'a saved method remains the detection and launch target')
    assert.equal(pinned.preferred, true)
    assert.deepEqual(pinned.directories, [pinned.plan.binDir])
  }
})

test('MiniMax repair pointers identify the stable npm version and reject malformed or escaping keys', () => {
  const guid = '0123456789abcdef0123456789abcdef'
  assert.equal(miniMaxReleaseVersion(`0.6.8-repair-1234-${guid}`), '0.6.8')
  assert.equal(miniMaxReleaseVersion('0.6.8'), '0.6.8')
  for (const pointer of [`0.6.8-repair-1234-${guid.slice(1)}`, `0.6.8-repair-0-${guid}`, `../0.6.8`, `0.6.8-repair-1234-${guid}/other`]) {
    assert.equal(miniMaxReleaseVersion(pointer), null)
  }
})

test('MiniMax repair releases attest manifest version while keeping release root guards', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixtureRoot(t)
  const pointer = '0.6.8-repair-1234-0123456789abcdef0123456789abcdef'
  const managed = join(root, 'managed')
  const packageRoot = await packageFixture(join(managed, 'releases', pointer, 'node_modules'),
    '@minimax-ai/code', '0.6.8', 'mcode', 'cli.js')
  await mkdir(join(packageRoot, 'node_modules', 'better-sqlite3', 'build', 'Release'), { recursive: true })
  await writeFile(join(packageRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'), 'native-fixture')
  await writeFile(join(managed, 'mcode.cmd'), '@ECHO off\r\n')
  await writeFile(join(managed, 'current'), pointer)
  const asked = []
  const attestor = { async matchesPackage(directory, name, version) { asked.push([directory, name, version]); return { ok: true } } }
  const found = await findManagedMiniMaxEntry(process.cwd(), [managed], attestor)
  assert.equal(found.version, '0.6.8')
  assert.equal(found.installDir, await realpath(managed))
  assert.equal(found.binDir, found.installDir)
  assert.deepEqual(asked.at(-1), [await realpath(packageRoot), '@minimax-ai/code', '0.6.8'])
  assert.equal(await findManagedMiniMaxEntry(process.cwd(), [managed], { async matchesPackage() { return { ok: false } } }), null)
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@minimax-ai/code', version: '0.6.9', bin: { mcode: 'cli.js' } }))
  assert.equal(await findManagedMiniMaxEntry(process.cwd(), [managed], attestor), null)
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@minimax-ai/code', version: '0.6.8', bin: { mcode: 'cli.js' } }))

  const escaped = join(root, 'escaped')
  await mkdir(join(escaped, 'releases'), { recursive: true })
  await writeFile(join(escaped, 'mcode.cmd'), '@ECHO off\r\n')
  await writeFile(join(escaped, 'current'), pointer)
  await symlink(join(managed, 'releases', pointer), join(escaped, 'releases', pointer), 'junction')
  const attestationsBeforeEscape = asked.length
  assert.equal(await findManagedMiniMaxEntry(process.cwd(), [escaped], attestor), null)
  assert.equal(asked.length, attestationsBeforeEscape, 'escaped release roots are rejected before digest verification')
})

test('MiMo follows pnpm sibling platform packages within the selected store and attests the pinned version', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixtureRoot(t)
  const modules = join(root, 'package-store', 'global', '5', 'node_modules')
  const store = join(modules, '.pnpm')
  const platformName = `@mimo-ai/mimocode-windows-${process.arch}`
  const wrapper = await packageFixture(join(store, '@mimo-ai+cli@0.1.15', 'node_modules'), '@mimo-ai/cli', '0.1.15', 'mimo', 'bin/mimo',
    { optionalDependencies: { [platformName]: '0.1.15' } })
  const native = await packageFixture(join(store, `@mimo-ai+mimocode-windows-${process.arch}@0.1.15`, 'node_modules'), platformName, '0.1.15', 'mimo', 'bin/mimo.exe')
  await mkdir(join(modules, '@mimo-ai'), { recursive: true })
  await symlink(wrapper, join(modules, '@mimo-ai', 'cli'), 'junction')
  const platformLink = resolve(wrapper, '..', platformName.split('/')[1])
  await symlink(native, platformLink, 'junction')
  const asked = []
  const options = { toolId: 'mimo-code', workspace: process.cwd(), mode: 'read-only', task: 'fixture',
    directories: [join(root, 'commands')], moduleRoots: [modules], manager: 'pnpm', attestor: { async matches(...args) { asked.push(args); return { ok: true } } } }
  const launch = await resolveMiMoGrokLaunch(options)
  assert.equal(launch.file, await realpath(join(native, 'bin', 'mimo.exe')))
  assert.equal(launch.version, '0.1.15')
  assert.equal(asked[0][1], platformName)
  assert.match((await resolveMiMoGrokLaunch({ ...options, moduleRoots: [] })).unsupported, /未找到/)
  assert.match((await resolveMiMoGrokLaunch({ ...options, attestor: { async matches() { return { ok: false, reason: 'digest mismatch' } } } })).unsupported, /digest mismatch/)
  await writeFile(join(native, 'package.json'), JSON.stringify({ name: platformName, version: '0.1.14' }))
  const askedBeforeWrongVersion = asked.length
  assert.match((await resolveMiMoGrokLaunch(options)).unsupported, /未找到/)
  assert.equal(asked.length, askedBeforeWrongVersion, 'another platform version fails before registry attestation')
  await writeFile(join(native, 'package.json'), JSON.stringify({ name: platformName, version: '0.1.15' }))
  const outside = await packageFixture(join(root, 'outside'), platformName, '0.1.15', 'mimo', 'bin/mimo.exe')
  await unlink(platformLink)
  await symlink(outside, platformLink, 'junction')
  const askedBeforeOutside = asked.length
  assert.match((await resolveMiMoGrokLaunch(options)).unsupported, /未找到/)
  assert.equal(asked.length, askedBeforeOutside, 'an outside-store platform link fails before registry attestation')
})

test('Grok follows pnpm sibling platform packages and requires the attested decompressed binary', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixtureRoot(t)
  const modules = join(root, '.pnpm', 'global', '5', 'node_modules')
  const store = join(modules, '.pnpm')
  const platformName = `@xai-official/grok-win32-${process.arch}`
  const wrapper = await packageFixture(join(store, '@xai-official+grok@1.0.41', 'node_modules'), '@xai-official/grok', '1.0.41', 'grok', 'bin/grok',
    { optionalDependencies: { [platformName]: '1.0.41' } })
  const native = await packageFixture(join(store, `@xai-official+grok-win32-${process.arch}@1.0.41`, 'node_modules'), platformName, '1.0.41', 'grok', 'bin/grok.exe.br')
  const binary = Buffer.from('official-grok-native-fixture')
  await writeFile(join(native, 'bin', 'grok.exe.br'), brotliCompressSync(binary))
  await mkdir(join(modules, '@xai-official'), { recursive: true })
  await symlink(wrapper, join(modules, '@xai-official', 'grok'), 'junction')
  await symlink(native, resolve(wrapper, '..', platformName.split('/')[1]), 'junction')
  const home = join(root, 'payload-home')
  await mkdir(join(home, 'bin'), { recursive: true })
  const expanded = join(home, 'bin', 'grok-1.0.41.exe')
  await writeFile(expanded, binary)
  const beforeHome = process.env.GROK_HOME
  process.env.GROK_HOME = home
  t.after(() => { if (beforeHome === undefined) delete process.env.GROK_HOME; else process.env.GROK_HOME = beforeHome })
  const asked = []
  const options = { toolId: 'grok-build', workspace: process.cwd(), mode: 'read-only', task: 'fixture',
    directories: [root], manager: 'pnpm', attestor: { async matches(...args) { asked.push(args); return { ok: true } } } }
  const launch = await resolveMiMoGrokLaunch(options)
  assert.equal(launch.file, await realpath(expanded))
  assert.equal(launch.version, '1.0.41')
  assert.deepEqual(asked[0].slice(1), [platformName, '1.0.41', 'bin/grok.exe.br'])
  assert.match((await resolveMiMoGrokLaunch({ ...options, attestor: { async matches() { return { ok: false, reason: 'digest mismatch' } } } })).unsupported, /digest mismatch/)
  await writeFile(expanded, 'another-grok-binary')
  assert.match((await resolveMiMoGrokLaunch(options)).unsupported, /尚未找到/)
})
