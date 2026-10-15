import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { createNpmAttestor, npmAttestor } from '../.dsh-plugin/shared/npm-attestation.mjs'
import { officialToolReadiness, runOfficialTool } from '../.dsh-plugin/shared/official-tool-executor.mjs'
import { installPreferences, setInstallPreferences } from '../.dsh-plugin/shared/official-tools-runtime.mjs'

const vendors = [
  { id: 'kimi-code', name: '@moonshot-ai/kimi-code', command: 'kimi', bin: 'dist/main.mjs' },
  { id: 'minimax-code', name: '@minimax-ai/code', command: 'mcode', bin: 'cli.js' },
]

function tarEntry(name, source) {
  const body = Buffer.from(source), header = Buffer.alloc(512)
  header.write(`package/${name}`, 0, 100)
  header.write('0000644\0', 100)
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124)
  header.write('        ', 148)
  header.write('0', 156)
  header.write('ustar\0', 257)
  const sum = header.reduce((total, byte) => total + byte, 0)
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
  return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)])
}

async function fixture(t, vendor) {
  const root = await mkdtemp(join(tmpdir(), 'router-native-entry-'))
  t.after(async () => {
    if (resolve(root).startsWith(`${resolve(tmpdir())}${sep}`)) await rm(root, { recursive: true, force: true })
  })
  const version = '1.0.0', prefix = join(root, 'selected')
  const modules = process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules')
  const packageRoot = join(modules, ...vendor.name.split('/'))
  const manifest = { name: vendor.name, version, bin: { [vendor.command]: vendor.bin } }
  const files = { 'package.json': JSON.stringify(manifest), [vendor.bin]: 'throw new Error("fixture must not execute");\n' }
  for (const [name, source] of Object.entries(files)) {
    const path = join(packageRoot, ...name.split('/'))
    await mkdir(resolve(path, '..'), { recursive: true })
    await writeFile(path, source)
  }
  const tgz = gzipSync(Buffer.concat([...Object.entries(files).map(([name, source]) => tarEntry(name, source)), Buffer.alloc(1024)]))
  const integrity = `sha512-${createHash('sha512').update(tgz).digest('base64')}`
  const requests = []
  const attestor = createNpmAttestor({ persist: false, npmCacheDirectory: async () => null, fetchImpl: async raw => {
    requests.push(String(raw))
    assert.ok(String(raw).startsWith(`https://registry.npmjs.org/${vendor.name}/`), 'only the selected vendor may be attested')
    if (String(raw).endsWith('.tgz')) return { ok: true, body: Readable.toWeb(Readable.from([tgz])) }
    assert.equal(String(raw), `https://registry.npmjs.org/${vendor.name}/${version}`)
    return { ok: true, json: async () => ({ name: vendor.name, version,
      dist: { integrity, tarball: `https://registry.npmjs.org/${vendor.name}/-/1.0.0.tgz` } }) }
  } })
  const preferences = { installDir: prefix, methods: { [vendor.id]: 'npm' }, scriptUrls: {}, allowScriptInstall: true }
  return { root, packageRoot: await realpath(packageRoot), manifest, requests, attestor, preferences,
    options: { preferences, executionEnvironment: 'cli-native', attestor } }
}

for (const vendor of vendors) {
  test(`${vendor.id} native readiness accepts the exact registry-attested package and records its source`, async t => {
    const f = await fixture(t, vendor)
    const result = await officialToolReadiness(vendor.id, process.cwd(), f.options)
    assert.equal(result.ready, true, result.reason)
    assert.equal(result.source, 'official-npm-registry-attested')
    assert.deepEqual(result.readyModes, ['workspace-write'])
    assert.equal(f.requests.length, 2, 'package and exact entry checks share one verified tarball')
  })

  test(`${vendor.id} native readiness rejects changed code without substituting a PATH copy`, async t => {
    const f = await fixture(t, vendor)
    await writeFile(join(f.packageRoot, ...vendor.bin.split('/')), 'throw new Error("changed fixture");\n')
    const other = join(f.root, 'other')
    const otherModules = process.platform === 'win32' ? join(other, 'node_modules') : join(other, 'lib', 'node_modules')
    const otherPackage = join(otherModules, ...vendor.name.split('/'))
    await mkdir(resolve(join(otherPackage, ...vendor.bin.split('/')), '..'), { recursive: true })
    await writeFile(join(otherPackage, 'package.json'), JSON.stringify({ ...f.manifest, version: '9.0.0' }))
    await writeFile(join(otherPackage, ...vendor.bin.split('/')), 'throw new Error("unselected copy must never execute");\n')
    const otherBin = process.platform === 'win32' ? other : join(other, 'bin')
    await mkdir(otherBin, { recursive: true })
    const beforePath = process.env.PATH
    process.env.PATH = [otherBin, beforePath].filter(Boolean).join(delimiter)
    t.after(() => { if (beforePath === undefined) delete process.env.PATH; else process.env.PATH = beforePath })
    const result = await officialToolReadiness(vendor.id, process.cwd(), f.options)
    assert.equal(result.ready, false)
    assert.deepEqual(result.readyModes, [])
    assert.match(result.reason, /官方 npm 摘要核验.*不改用其他安装位置/)
    assert.match(result.reason, /与官方 npm 发行文件不符/)
    assert.equal(f.requests.length, 2)
  })

  test(`${vendor.id} native readiness rejects a changed bin map even when official code is intact`, async t => {
    const f = await fixture(t, vendor)
    await writeFile(join(f.packageRoot, 'package.json'), JSON.stringify({ ...f.manifest, bin: { [vendor.command]: 'extra.mjs' } }))
    await writeFile(join(f.packageRoot, 'extra.mjs'), 'throw new Error("unattested extra entry");\n')
    const result = await officialToolReadiness(vendor.id, process.cwd(), f.options)
    assert.equal(result.ready, false)
    assert.match(result.reason, /package\.json.*与官方 npm 发行文件不符/)
  })

  test(`${vendor.id} Harness readiness retains its existing discovery behavior`, async t => {
    const f = await fixture(t, vendor)
    const result = await officialToolReadiness(vendor.id, process.cwd(), { ...f.options, executionEnvironment: 'harness',
      attestor: { matchesPackage() { throw new Error('Harness must not enter the new native attestation path') } } })
    assert.equal(result.ready, true, result.reason)
    assert.equal(result.source, 'verified-npm-package')
    assert.equal(f.requests.length, 0)
  })

  test(`${vendor.id} actual native execution rechecks its selected package before spawning`, async t => {
    const f = await fixture(t, vendor)
    await writeFile(join(f.packageRoot, ...vendor.bin.split('/')), 'throw new Error("changed fixture must never execute");\n')
    const saved = installPreferences()
    setInstallPreferences(f.preferences)
    t.after(() => setInstallPreferences(saved))
    t.mock.method(npmAttestor, 'matchesPackage', (...args) => f.attestor.matchesPackage(...args))
    t.mock.method(npmAttestor, 'matches', (...args) => f.attestor.matches(...args))
    const isolatedRoot = join(f.root, 'isolated'), workspace = join(isolatedRoot, 'task')
    await mkdir(workspace, { recursive: true })
    const result = await runOfficialTool({ toolId: vendor.id, workspace, isolatedRoot, task: 'offline trust fixture',
      mode: 'workspace-write', executionEnvironment: 'cli-native' })
    assert.equal(result.status, 'unsupported')
    assert.match(result.reason, /官方 npm 摘要核验.*不改用其他安装位置/)
    assert.equal(result.startedAt, undefined, 'attestation refuses the entry before process capture starts')
    assert.equal(f.requests.length, 2)
  })
}

test('native entry checking fails closed when the exact entry is absent from the attested package', async t => {
  const vendor = vendors[0], f = await fixture(t, vendor), seen = []
  const result = await officialToolReadiness(vendor.id, process.cwd(), { ...f.options, attestor: {
    async matchesPackage() { return { ok: true } },
    async matches(...args) { seen.push(args); return { ok: false, reason: 'entry is absent from the verified tarball' } },
  } })
  assert.equal(result.ready, false)
  assert.match(result.reason, /入口未通过官方 npm 摘要核验/)
  assert.deepEqual(seen, [[join(f.packageRoot, ...vendor.bin.split('/')), vendor.name, '1.0.0', vendor.bin]])
})

test('native attestation failure is explicit and cannot become an unrestricted fallback', async t => {
  const vendor = vendors[0], f = await fixture(t, vendor)
  const result = await officialToolReadiness(vendor.id, process.cwd(), { ...f.options, attestor: {
    async matchesPackage() { throw new Error('registry unavailable') },
  } })
  assert.equal(result.ready, false)
  assert.match(result.reason, /官方 npm 摘要核验不可用：registry unavailable.*不改用其他安装位置/)
})
