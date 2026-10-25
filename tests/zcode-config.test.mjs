import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { parseInstallPreferences, resolveInstallPlan, resolveUninstallPlan } from '../.dsh-plugin/shared/tool-install-preferences.mjs'
import { getOfficialTool } from '../.dsh-plugin/shared/official-tool-registry.mjs'
import { discoverZCodeBundle, ZCODE_MARKER } from '../.dsh-plugin/shared/zcode-bundle.mjs'
import { extractZCodeArchive, installZCodeCli, parseZCodeChecksum, uninstallZCodeCli } from '../.dsh-plugin/shared/zcode-installer.mjs'

const version = '3.16.2'
const latest = { version, url: `https://github.com/Alice-Marx/zcode-cli/releases/download/v${version}/zcode-${version}.tar.gz`, sha256Url: `https://github.com/Alice-Marx/zcode-cli/releases/download/v${version}/sha256.txt` }
const packageJson = JSON.stringify({ name: 'zcode-runtime', version, bin: { zcode: './bin/zcode.mjs' } })
function tarEntry(name, text = '', type = '0') {
  const body = Buffer.from(text), header = Buffer.alloc(512)
  header.write(name, 0, 100); header.write('0000755\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116)
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124); header.write('00000000000\0', 136)
  header.write('        ', 148); header.write(type, 156); header.write('ustar\0', 257); header.write('00', 263)
  const sum = [...header].reduce((total, value) => total + value, 0)
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
  return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)])
}
function archive(entries = [tarEntry('zcode/package.json', packageJson), tarEntry('zcode/bin/zcode.mjs', 'console.log("fixture")'), tarEntry('zcode/agent/zcode.cjs', 'module.exports = {}'), tarEntry('zcode/node_modules/dependency/index.js', 'export {}')]) {
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]))
}
async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), 'router-zcode-cli-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, installDir: join(root, 'tools', 'zcode-cli'), trustPath: join(root, 'state', 'trust.json') }
}
function distributionFetch(bytes, { wrongDigest = false, redirectTo } = {}) {
  const digest = wrongDigest ? '0'.repeat(64) : createHash('sha256').update(bytes).digest('hex')
  return async url => {
    if (url === latest.sha256Url) return new Response(`${digest}  zcode-${version}.tar.gz\n`)
    if (url === latest.url) return redirectTo ? new Response(null, { status: 302, headers: { location: redirectTo } }) : new Response(bytes)
    throw new Error(`Unexpected URL ${url}`)
  }
}

test('ZCode CLI uses the shared root across platforms and ignores the legacy desktop setting', () => {
  for (const platform of ['win32', 'linux', 'darwin']) {
    const preferences = parseInstallPreferences({ toolInstallDir: 'D:/AI/tools', zcodeInstallDir: 'D:/OldDesktop/ZCode.exe' })
    assert.equal(preferences.zcodeInstallDir, undefined)
    const plan = resolveInstallPlan(getOfficialTool('zcode'), undefined, preferences, { platform, home: '/home/test' })
    assert.equal(plan.installDir, 'D:/AI/tools/zcode-cli')
    assert.equal(plan.binDir, 'D:/AI/tools/zcode-cli/bin')
    assert.equal(plan.kind, 'archive')
    assert.deepEqual(resolveUninstallPlan(getOfficialTool('zcode'), undefined, preferences, { platform, home: '/home/test' }), plan)
  }
  assert.equal(resolveInstallPlan(getOfficialTool('zcode'), undefined, {}, { home: '/home/test' }).installDir, '/home/test/.zcode/runtime')
})

test('verified complete runtime installs, is discovered offline, repairs and uninstalls without touching sibling tools or user data', async t => {
  const paths = await scratch(t), bytes = archive()
  const options = { ...paths, latest, fetchImpl: distributionFetch(bytes) }
  await mkdir(join(paths.root, 'user-data'), { recursive: true }); await writeFile(join(paths.root, 'user-data', 'session.json'), 'preserved')
  await mkdir(join(paths.root, 'tools', 'codex'), { recursive: true }); await writeFile(join(paths.root, 'tools', 'codex', 'codex.exe'), 'preserved')
  assert.equal((await installZCodeCli(options)).status, 'succeeded')
  const found = await discoverZCodeBundle(paths)
  assert.equal(found.version, version); assert.equal(found.cliEntry, join(paths.installDir, 'bin', 'zcode.mjs'))
  assert.equal(found.source, 'github-release-sha256')
  assert.match(await readFile(join(paths.installDir, 'bin', 'zcode.cmd'), 'utf8'), /node/)
  await writeFile(join(paths.installDir, 'node_modules', 'dependency', 'index.js'), 'tampered')
  const rejected = []
  assert.equal(await discoverZCodeBundle({ ...paths, onRejected: value => rejected.push(value) }), null)
  assert.match(rejected[0].rejected, /文件与已校验发行包不同/)
  await installZCodeCli(options)
  assert.ok(await discoverZCodeBundle(paths), 'repair restores verified files')
  await uninstallZCodeCli(paths)
  assert.equal(await discoverZCodeBundle(paths), null)
  assert.equal(await readFile(join(paths.root, 'user-data', 'session.json'), 'utf8'), 'preserved')
  assert.equal(await readFile(join(paths.root, 'tools', 'codex', 'codex.exe'), 'utf8'), 'preserved')
})

test('checksum mismatch and off-host redirects preserve the installed runtime', async t => {
  const paths = await scratch(t), bytes = archive()
  await installZCodeCli({ ...paths, latest, fetchImpl: distributionFetch(bytes) })
  for (const fetchImpl of [distributionFetch(bytes, { wrongDigest: true }), distributionFetch(bytes, { redirectTo: 'https://evil.example/installer' })]) {
    await assert.rejects(installZCodeCli({ ...paths, latest, fetchImpl }), /SHA256 不匹配|离开了 GitHub/)
    assert.ok(await discoverZCodeBundle(paths))
  }
})

test('an unmanaged destination and a forged incomplete ownership marker cannot be replaced or removed', async t => {
  const paths = await scratch(t)
  await mkdir(paths.installDir, { recursive: true })
  await writeFile(join(paths.installDir, 'notes.txt'), 'owned by user')
  await assert.rejects(installZCodeCli({ ...paths, latest, fetchImpl: distributionFetch(archive()) }), /并非插件安装/)
  await assert.rejects(uninstallZCodeCli(paths), /并非插件安装/)
  await writeFile(join(paths.installDir, ZCODE_MARKER), JSON.stringify({ repository: 'Alice-Marx/zcode-cli' }))
  await assert.rejects(uninstallZCodeCli(paths), /并非插件安装/)
  assert.equal(await readFile(join(paths.installDir, 'notes.txt'), 'utf8'), 'owned by user')
})

test('extra files are rejected by discovery and preserved by repair/uninstall', async t => {
  const paths = await scratch(t), bytes = archive()
  await installZCodeCli({ ...paths, latest, fetchImpl: distributionFetch(bytes) })
  await writeFile(join(paths.installDir, 'my-notes.txt'), 'user file')
  assert.equal(await discoverZCodeBundle(paths), null)
  await assert.rejects(uninstallZCodeCli(paths), /发行包之外/)
  await assert.rejects(installZCodeCli({ ...paths, latest, fetchImpl: distributionFetch(bytes) }), /发行包之外/)
  assert.equal(await readFile(join(paths.installDir, 'my-notes.txt'), 'utf8'), 'user file')
})

test('tar extraction refuses traversal, absolute paths, Windows aliases, links and duplicate members', async t => {
  const paths = await scratch(t)
  const cases = [['zcode/../escape', '0'], ['/absolute', '0'], ['zcode/C:/escape', '0'], ['zcode/NUL.txt', '0'], ['zcode/link', '2'], ['zcode/hard', '1']]
  for (const [index, [name, type]] of cases.entries()) {
    const tar = join(paths.root, `${index}.tar.gz`); await writeFile(tar, archive([tarEntry(name, '', type)]))
    await assert.rejects(extractZCodeArchive(tar, join(paths.root, `out-${index}`)), /不安全|不允许链接/)
  }
  const tar = join(paths.root, 'duplicate.tar.gz'); await writeFile(tar, archive([tarEntry('zcode/file', 'a'), tarEntry('zcode/file', 'b')]))
  await assert.rejects(extractZCodeArchive(tar, join(paths.root, 'duplicates')), /重复路径/)
})

test('checksum list requires exactly one matching release asset', () => {
  const line = `${'a'.repeat(64)}  zcode-3.16.2.tar.gz`
  assert.equal(parseZCodeChecksum(`${line}\n`, 'zcode-3.16.2.tar.gz'), 'a'.repeat(64))
  assert.throws(() => parseZCodeChecksum(`${line}\n${line}`, 'zcode-3.16.2.tar.gz'), /唯一/)
  assert.throws(() => parseZCodeChecksum(line, 'other.tar.gz'), /唯一/)
})

test('a desktop bundle cannot acquire standalone trust or execute during discovery', async t => {
  const paths = await scratch(t)
  const glm = join(paths.installDir, 'resources', 'glm'); await mkdir(glm, { recursive: true })
  await writeFile(join(paths.installDir, 'ZCode.exe'), 'desktop fixture')
  await writeFile(join(glm, 'zcode.cjs'), 'throw new Error("must not execute")')
  assert.equal(await discoverZCodeBundle(paths), null)
  assert.equal(await readFile(paths.trustPath).catch(() => null), null)
})
