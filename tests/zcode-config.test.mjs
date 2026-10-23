import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeZCodeInstallDir, parseInstallPreferences } from '../.dsh-plugin/shared/tool-install-preferences.mjs'
import { discoverZCodeBundle, zcodeDiscoveryCandidates, zcodeWindowsPowerShellEnvironment, ZCODE_INSTALL_ENV_VAR } from '../.dsh-plugin/shared/zcode-bundle.mjs'

test('ZCode location is independent of the shared npm root and supports desktop root or executable', () => {
  const preferences = parseInstallPreferences({ toolInstallDir: 'D:/AI/tools', zcodeInstallDir: '"D:/Program Files/ZCode/ZCode.exe"' })
  assert.equal(preferences.installDir, 'D:/AI/tools')
  assert.equal(preferences.zcodeInstallDir, 'D:/Program Files/ZCode/ZCode.exe')
  assert.equal(normalizeZCodeInstallDir('D:\\Program Files\\ZCode\\'), 'D:\\Program Files\\ZCode')
  assert.equal(parseInstallPreferences({ zcodeInstallDir: { get: () => '%ZCODE_PARENT%/ZCode' } }, {
    env: { ZCODE_PARENT: 'D:/Program Files' },
  }).zcodeInstallDir, 'D:/Program Files/ZCode')
  assert.equal(parseInstallPreferences({ toolInstallDir: 'D:/AI/tools' }).zcodeInstallDir, '', 'empty means automatic desktop discovery')
})

test('ZCode location rejects relative, network, root, control-character and unrelated executable paths', () => {
  for (const invalid of ['../ZCode', 'D:\\', '/', '\\\\server\\share\\ZCode', '/opt/ZCode', 'D:/app/node.exe', 'D:/app/ZCode\n']) {
    assert.throws(() => normalizeZCodeInstallDir(invalid), /ZCode 安装位置|ZCode 程序路径/)
  }
  assert.throws(() => normalizeZCodeInstallDir('D:/app/\0ZCode'), /无效字符/)
})

test('explicit ZCode location wins over environment and registry without alternate installation candidates', () => {
  const env = { [ZCODE_INSTALL_ENV_VAR]: 'D:/Other/ZCode', ProgramFiles: 'C:/Program Files' }
  const records = [{ installLocation: 'E:/Registered/ZCode', displayVersion: '3.15.1' }]
  assert.deepEqual(zcodeDiscoveryCandidates({ installDir: 'D:/Missing/ZCode', env, records }), [
    { path: 'D:/Missing/ZCode', source: 'operator-config', registryVersion: null },
  ])
  assert.deepEqual(zcodeDiscoveryCandidates({ env, records }), [
    { path: 'D:/Other/ZCode', source: 'operator-env', registryVersion: null },
  ])
  assert.equal(zcodeDiscoveryCandidates({ installDir: {}, env, records }).length, 0, 'invalid explicit type cannot enable fallback')
})

test('clearing the independent ZCode selection restores registry and standard-directory discovery', () => {
  const candidates = zcodeDiscoveryCandidates({ installDir: '', env: { ProgramFiles: 'D:/Program Files' }, records: [
    { displayVersion: '3.15.1', displayIcon: '"E:\\Apps\\ZCode\\ZCode.exe",0' },
  ] })
  assert.equal(candidates[0].path, 'E:\\Apps\\ZCode')
  assert.equal(candidates[0].source, 'uninstall-registry')
  assert.equal(candidates[0].registryVersion, '3.15.1')
  assert.ok(candidates.some(candidate => candidate.path === 'D:\\Program Files\\Programs\\ZCode'), 'Windows standard paths use Windows separators on every host')
  assert.ok(candidates.some(candidate => candidate.path.replaceAll('\\', '/') === 'D:/Program Files/ZCode'))
})

test('ZCode verification uses Windows PowerShell system modules despite an inherited PowerShell 7 module path', () => {
  const polluted = { SystemRoot: 'C:\\Windows', PSModulePath: 'D:/UserModules;D:/PowerShell/7/Modules', ZAI_API_KEY: 'preserved' }
  const actual = zcodeWindowsPowerShellEnvironment(polluted)
  assert.equal(actual.PSModulePath.replaceAll('\\', '/'), 'C:/Windows/System32/WindowsPowerShell/v1.0/Modules')
  assert.equal(actual.ZAI_API_KEY, 'preserved')
  assert.equal(polluted.PSModulePath, 'D:/UserModules;D:/PowerShell/7/Modules', 'host environment is never mutated')
})

test('a missing explicitly selected ZCode location refuses fallback to installed desktops', { skip: process.platform !== 'win32' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'zcode-config-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const rejected = []
  const result = await discoverZCodeBundle({
    installDir: join(directory, 'missing'),
    env: { ...process.env, [ZCODE_INSTALL_ENV_VAR]: 'D:/Program Files/ZCode', ProgramFiles: 'D:/Program Files' },
    trustPath: join(directory, 'trust.json'),
    onRejected: value => rejected.push(value),
  })
  assert.equal(result, null)
  assert.equal(rejected.length, 1)
  assert.match(rejected[0].rejected, /指定的 ZCode 安装位置.*独立安装位置/)
})

test('an unsigned configured desktop cannot acquire trust or execute its bundled JavaScript', { skip: process.platform !== 'win32' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'zcode-untrusted-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const glm = join(directory, 'resources', 'glm')
  await mkdir(glm, { recursive: true })
  await writeFile(join(directory, 'ZCode.exe'), 'untrusted')
  await writeFile(join(glm, 'zcode.cjs'), 'throw new Error("must not execute")')
  await writeFile(join(glm, '.node-bundle-meta.json'), '{"runtime":"electron-node","entry":"zcode.cjs"}')
  const trustPath = join(directory, 'trust.json')
  assert.equal(await discoverZCodeBundle({ installDir: join(directory, 'ZCode.exe'), trustPath }), null)
  assert.equal(await readFile(trustPath).catch(() => null), null)
})
