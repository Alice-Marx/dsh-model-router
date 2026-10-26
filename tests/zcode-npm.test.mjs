import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { Readable } from 'node:stream'
import { digestTarMembers, npmAttestor } from '../.dsh-plugin/shared/npm-attestation.mjs'
import { officialToolReadiness } from '../.dsh-plugin/shared/official-tool-executor.mjs'
import { extractZCodeArchive } from '../.dsh-plugin/shared/zcode-installer.mjs'
import { resolveZCodeNpmBundle, ZCODE_NPM_PACKAGE } from '../.dsh-plugin/shared/zcode-npm.mjs'

const runtimeVersion = '3.16.2'

test('embedded runtime digest parsing enforces expanded-byte and file-count ceilings', async () => {
  const archive = gzipSync(Buffer.concat([member('first.txt', 'a'.repeat(1024)), member('second.txt', 'b'), Buffer.alloc(1024)]))
  await assert.rejects(digestTarMembers(Readable.from([archive]), { maxExpandedBytes: 512 }), /解压大小超出上限/)
  await assert.rejects(digestTarMembers(Readable.from([archive]), { maxFiles: 1 }), /文件数量超出上限/)
})
const digest = bytes => ({ sha256: `sha256-${createHash('sha256').update(bytes).digest('base64')}`, size: bytes.length })
function member(name, text) {
  const bytes = Buffer.from(text), header = Buffer.alloc(512)
  header.write(`zcode/${name}`, 0, 100); header.write('0000644\0', 100)
  header.write('0000000\0', 108); header.write('0000000\0', 116)
  header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124)
  header.write('00000000000\0', 136); header.write('        ', 148); header.write('0', 156)
  header.write('ustar\0', 257); header.write('00', 263)
  header.write(`${[...header].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0')}\0 `, 148)
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)])
}
async function fixture(t, { packageRuntime = false, packageVersion = runtimeVersion } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'router-zcode-npm-')))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }))
  const prefix = join(root, 'prefix')
  const packageRoot = join(prefix, ...(process.platform === 'win32' ? ['node_modules'] : ['lib', 'node_modules']), '@ljwei-stak', 'zcode-cli')
  const runtimeFiles = {
    'package.json': JSON.stringify({ name: 'zcode-runtime', version: runtimeVersion, bin: { zcode: './bin/zcode.mjs' } }),
    'bin/zcode.mjs': 'throw new Error("runtime must only execute in the real launch")',
    'agent/zcode.cjs': 'module.exports = "official agent"',
    'server/entry-http.js': 'export const server = true',
    'web/index.html': '<!doctype html>',
    'node_modules/dependency/index.js': 'export const dependency = true',
    'node_modules/native/native.node': 'native fixture',
  }
  const archive = gzipSync(Buffer.concat([...Object.entries(runtimeFiles).map(([name, text]) => member(name, text)), Buffer.alloc(1024)]))
  const sha256 = createHash('sha256').update(archive).digest('hex')
  const payload = { schemaVersion: 1, version: runtimeVersion, file: 'payload/zcode-runtime.tar.gz', sha256 }
  const files = {
    'package.json': Buffer.from(JSON.stringify({ name: ZCODE_NPM_PACKAGE, version: packageVersion,
      bin: { zcode: './bin/zcode.mjs' }, zcodeRuntime: { version: runtimeVersion, sha256 } })),
    'payload.json': Buffer.from(JSON.stringify(payload)),
    'payload/zcode-runtime.tar.gz': archive,
    'bin/zcode.mjs': Buffer.from('throw new Error("must never import npm bootstrap")'),
    'lib/runtime.mjs': Buffer.from('throw new Error("must never import npm extraction dependency")'),
  }
  for (const [name, bytes] of Object.entries(files)) {
    const path = join(packageRoot, ...name.split('/'))
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes)
  }
  const attested = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, digest(bytes)]))
  const attestor = { async attestPackage(name, version) {
    assert.equal(name, ZCODE_NPM_PACKAGE); assert.equal(version, packageVersion)
    return { files: attested }
  } }
  const found = { packageRoot, version: packageVersion, entry: join(packageRoot, 'bin', 'zcode.mjs') }
  const options = { attestor, cacheRoot: join(root, 'state', 'model-router', 'zcode-npm') }
  if (packageRuntime) {
    await extractZCodeArchive(join(packageRoot, payload.file), join(packageRoot, 'runtime'))
    await writeFile(join(packageRoot, 'runtime', '.zcode-npm-runtime.json'), JSON.stringify({ schemaVersion: 1, version: runtimeVersion, sha256 }))
  }
  return { root, prefix, packageRoot, found, options, attested, payload, runtimeFiles, archive }
}

test('managed readiness accepts the attested package at the exact platform npm module root', { skip: Number(process.versions.node.split('.')[0]) !== 24 }, async t => {
  const f = await fixture(t, { packageRuntime: true })
  t.mock.method(npmAttestor, 'attestPackage', (...args) => f.options.attestor.attestPackage(...args))
  const actual = await officialToolReadiness('zcode', process.cwd(), {
    preferences: { installDir: f.prefix, methods: { zcode: 'npm' } }, executionEnvironment: 'cli-native',
  })
  assert.equal(actual.ready, true, actual.reason)
  assert.equal(actual.source, 'npm-registry-sha256')
  assert.deepEqual(actual.readyModes, ['workspace-write'])
})

test('npm package runtime is fully verified and resolves directly without executing either bootstrap', async t => {
  const f = await fixture(t, { packageRuntime: true })
  const actual = await resolveZCodeNpmBundle(f.found, f.options)
  assert.equal(actual.root, join(f.packageRoot, 'runtime'))
  assert.equal(actual.cliEntry, join(actual.root, 'bin', 'zcode.mjs'))
  assert.equal(actual.source, 'npm-registry-sha256')
  assert.equal(actual.version, runtimeVersion)
  assert.equal(await lstat(f.options.cacheRoot).catch(() => null), null)
})

test('an ignore-scripts installation prepares and reuses a canonical verified cache without touching user data', async t => {
  const f = await fixture(t)
  const userFile = join(f.root, 'user-settings.json'); await writeFile(userFile, 'keep')
  const actual = await resolveZCodeNpmBundle(f.found, f.options)
  assert.equal(actual.root, join(f.options.cacheRoot, `${runtimeVersion}-${f.payload.sha256}`))
  assert.equal(await readFile(join(actual.root, 'agent', 'zcode.cjs'), 'utf8'), f.runtimeFiles['agent/zcode.cjs'])
  const ready = join(actual.root, '.zcode-npm-runtime.json'), before = (await stat(ready)).mtimeMs
  assert.equal((await resolveZCodeNpmBundle(f.found, f.options)).root, actual.root)
  assert.equal((await stat(ready)).mtimeMs, before)
  assert.equal(await readFile(userFile, 'utf8'), 'keep')
})

test('a package-local ready marker cannot authorize changed Agent or native dependency code', async t => {
  for (const name of ['agent/zcode.cjs', 'node_modules/native/native.node']) {
    const f = await fixture(t, { packageRuntime: true })
    await writeFile(join(f.packageRoot, 'runtime', ...name.split('/')), 'changed but marker retained')
    await assert.rejects(resolveZCodeNpmBundle(f.found, f.options), /运行资源 .*已改变/)
    assert.equal(await lstat(f.options.cacheRoot).catch(() => null), null, 'must not silently select a second runtime')
  }
})

test('compressed payload, manifest and bootstrap bytes must equal their exact npm registry members', async t => {
  for (const name of ['payload/zcode-runtime.tar.gz', 'payload.json', 'bin/zcode.mjs', 'package.json']) {
    const f = await fixture(t)
    await writeFile(join(f.packageRoot, ...name.split('/')), 'tampered')
    await assert.rejects(resolveZCodeNpmBundle(f.found, f.options), /与 npm registry 发行文件不符/)
    assert.equal(await lstat(f.options.cacheRoot).catch(() => null), null)
  }
})

test('even an attested changed bin map or an entry outside the selected npm tree is refused', async t => {
  const f = await fixture(t)
  const manifestPath = join(f.packageRoot, 'package.json')
  const metadata = JSON.parse(await readFile(manifestPath, 'utf8'))
  metadata.bin.zcode = './lib/runtime.mjs'
  const bytes = Buffer.from(JSON.stringify(metadata))
  await writeFile(manifestPath, bytes); f.attested['package.json'] = digest(bytes)
  await assert.rejects(resolveZCodeNpmBundle(f.found, f.options), /bin 映射无效/)
  await assert.rejects(resolveZCodeNpmBundle({ ...f.found, entry: join(f.packageRoot, 'lib', 'runtime.mjs') }, f.options), /离开固定 bin 路径/)
})

test('registry-attested metadata cannot substitute a mismatched compressed runtime digest', async t => {
  const f = await fixture(t)
  for (const name of ['payload.json', 'package.json']) {
    const path = join(f.packageRoot, name), metadata = JSON.parse(await readFile(path, 'utf8'))
    if (name === 'payload.json') metadata.sha256 = '0'.repeat(64)
    else metadata.zcodeRuntime.sha256 = '0'.repeat(64)
    const bytes = Buffer.from(JSON.stringify(metadata))
    await writeFile(path, bytes); f.attested[name] = digest(bytes)
  }
  await assert.rejects(resolveZCodeNpmBundle(f.found, f.options), /内嵌运行包 SHA256 不符/)
  assert.equal(await lstat(f.options.cacheRoot).catch(() => null), null)
})

test('extra files, GitHub ownership markers and linked runtime resources are rejected', async t => {
  for (const name of ['extra.cjs', '.model-router-zcode.json']) {
    const f = await fixture(t, { packageRuntime: true })
    await writeFile(join(f.packageRoot, 'runtime', name), 'untrusted')
    await assert.rejects(resolveZCodeNpmBundle(f.found, f.options), /发行包之外/)
  }
  const f = await fixture(t, { packageRuntime: true })
  const target = join(f.root, 'foreign-node_modules'); await mkdir(target)
  const link = join(f.packageRoot, 'runtime', 'linked-node_modules')
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(resolveZCodeNpmBundle(f.found, f.options), /是链接/)
})

test('changed existing caches fail closed and are preserved instead of being overwritten', async t => {
  const f = await fixture(t), actual = await resolveZCodeNpmBundle(f.found, f.options)
  const userFile = join(actual.root, 'notes.txt'); await writeFile(userFile, 'owned user data')
  await assert.rejects(resolveZCodeNpmBundle(f.found, f.options), /发行包之外/)
  assert.equal(await readFile(userFile, 'utf8'), 'owned user data')
})

test('cache ancestors cannot redirect resource extraction through directory links', async t => {
  const f = await fixture(t), outside = join(f.root, 'outside'), link = join(f.root, 'linked-cache')
  await mkdir(outside); await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(resolveZCodeNpmBundle(f.found, { ...f.options, cacheRoot: join(link, 'nested') }), /缓存路径不能经过目录链接/)
  assert.equal(await lstat(join(outside, 'nested')).catch(() => null), null)
})

test('concurrent cache preparation accepts only the same verified winner', async t => {
  const f = await fixture(t)
  const outcomes = await Promise.all([resolveZCodeNpmBundle(f.found, f.options), resolveZCodeNpmBundle(f.found, f.options)])
  assert.equal(outcomes[0].root, outcomes[1].root)
  assert.equal((await resolveZCodeNpmBundle(f.found, f.options)).root, outcomes[0].root)
})

test('npm wrapper and payload runtime versions stay distinct and unavailable npm proof cannot fall back', async t => {
  const f = await fixture(t, { packageRuntime: true, packageVersion: '3.16.3' })
  const actual = await resolveZCodeNpmBundle(f.found, f.options)
  assert.equal(actual.packageVersion, '3.16.3'); assert.equal(actual.version, runtimeVersion)
  await assert.rejects(resolveZCodeNpmBundle(f.found, { ...f.options, attestor: { attestPackage: async () => { throw new Error('registry unavailable') } } }), /registry unavailable/)
})
