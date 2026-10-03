import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  LATEST_CACHE_MS, compareReleaseVersions, createLatestVersions, latestSourceFor, parseZCodeDownloadPage, updateAvailable,
} from '../.dsh-plugin/shared/latest-versions.mjs'
import { createNpmAttestor, digestTarMembers, npmCacheContentPath } from '../.dsh-plugin/shared/npm-attestation.mjs'
import { getOfficialTool, OFFICIAL_TOOLS } from '../.dsh-plugin/shared/official-tool-registry.mjs'
import { checkZCodeCliRecord, zcodeSignatureVerdict, ZCODE_SIGNER } from '../.dsh-plugin/shared/zcode-bundle.mjs'
import { zcodeInstallerRelease } from '../.dsh-plugin/shared/zcode-installer.mjs'
import { OFFICIAL_SIGNERS, signatureAccepted } from '../.dsh-plugin/shared/official-tool-executor.mjs'
import { Readable } from 'node:stream'

async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), 'model-router-latest-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const json = (body, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) })
const html = body => ({ ok: true, status: 200, headers: new Headers(), text: async () => body })

const ZCODE_PAGE = `<a href="https://cdn-zcode.z.ai/zcode/electron/releases/3.14.4/windows-x64/ZCode-3.14.4-win-x64.exe">Windows</a>
<a href="https://cdn-zcode.z.ai/zcode/electron/releases/3.14.4/mac-arm64/ZCode-3.14.4-mac-arm64.dmg">mac</a>
<a href="https://cdn-zcode.z.ai/zcode/electron/releases/3.14.2/windows-x64/ZCode-3.14.2-win-x64.exe">old</a>
<a href="https://evil.example/zcode/electron/releases/9.9.9/windows-x64/ZCode-9.9.9-win-x64.exe">fake</a>`

test('release versions compare numerically and prereleases sort below releases', () => {
  assert.equal(compareReleaseVersions('0.160.0', '0.157.1'), 1)
  assert.equal(compareReleaseVersions('2.1.9', '2.1.10'), -1)
  assert.equal(compareReleaseVersions('1.0.0-beta.1', '1.0.0'), -1)
  assert.equal(compareReleaseVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareReleaseVersions('latest', '1.0.0'), null)
  assert.equal(updateAvailable('3.14.3', '3.14.4'), true)
  assert.equal(updateAvailable('3.14.4', '3.14.4'), false)
  assert.equal(updateAvailable(null, '3.14.4'), false)
})

test('every supported tool has a cheap latest-version source', () => {
  for (const tool of OFFICIAL_TOOLS) {
    if (tool.unsupported) continue
    assert.ok(latestSourceFor(tool), `${tool.id} has a latest source`)
  }
  assert.deepEqual(latestSourceFor(getOfficialTool('codex')), { kind: 'npm', package: '@openai/codex' })
  assert.deepEqual(latestSourceFor(getOfficialTool('zcode')), { kind: 'zcode-download-page' })
})

test('ZCode download page parsing only trusts the official CDN and picks the newest Windows build', () => {
  assert.deepEqual(parseZCodeDownloadPage(ZCODE_PAGE), {
    version: '3.14.4', url: 'https://cdn-zcode.z.ai/zcode/electron/releases/3.14.4/windows-x64/ZCode-3.14.4-win-x64.exe',
  })
  assert.equal(parseZCodeDownloadPage('<html>no links</html>'), null)
  const release = zcodeInstallerRelease(parseZCodeDownloadPage(ZCODE_PAGE))
  assert.equal(release.fileName, 'ZCode-3.14.4-win-x64.exe')
  assert.equal(zcodeInstallerRelease({ version: '3.14.4', url: 'http://cdn-zcode.z.ai/zcode/electron/releases/3.14.4/windows-x64/ZCode-3.14.4-win-x64.exe' }), null)
  assert.equal(zcodeInstallerRelease({ version: '3.14.5', url: release.url }), null, 'version must match the URL')
  assert.equal(zcodeInstallerRelease({ version: '3.14.4', url: 'https://cdn-zcode.z.ai.evil/zcode/electron/releases/3.14.4/windows-x64/ZCode-3.14.4-win-x64.exe' }), null)
  assert.equal(zcodeInstallerRelease(null), null)
})

test('latest lookups use npm and the ZCode page, cache ~12 h and persist', async t => {
  const dir = await scratch(t)
  const cachePath = join(dir, 'latest-versions.json')
  let clock = 1_000
  const calls = []
  const fetchImpl = async url => {
    calls.push(url)
    if (url === 'https://registry.npmjs.org/@openai/codex/latest') return json({ name: '@openai/codex', version: '0.160.0' })
    if (url === 'https://zcode.z.ai/en/docs/install') return html(ZCODE_PAGE)
    return json({}, 404)
  }
  const latest = createLatestVersions({ fetchImpl, now: () => clock, cachePath: () => cachePath })
  const codex = await latest.lookup(getOfficialTool('codex'))
  assert.equal(codex.version, '0.160.0')
  assert.equal(codex.source, 'npm')
  const zcode = await latest.lookup(getOfficialTool('zcode'))
  assert.equal(zcode.version, '3.14.4')
  assert.match(zcode.url, /ZCode-3\.14\.4-win-x64\.exe$/)
  assert.equal(calls.length, 2)
  clock += LATEST_CACHE_MS - 1
  await latest.lookup(getOfficialTool('codex'))
  assert.equal(calls.length, 2, 'cached within 12 h')
  const persisted = JSON.parse(await readFile(cachePath, 'utf8'))
  assert.equal(persisted.entries.codex.version, '0.160.0')
  const reloaded = createLatestVersions({ fetchImpl: async () => { throw new Error('must not fetch') }, now: () => clock, cachePath: () => cachePath })
  assert.equal((await reloaded.lookup(getOfficialTool('codex'))).version, '0.160.0', 'a new process reuses the disk cache')
  clock += 2
  await latest.lookup(getOfficialTool('codex'))
  assert.equal(calls.length, 3, 'expired after 12 h')
  await latest.lookup(getOfficialTool('codex'), { fresh: true })
  assert.equal(calls.length, 4, 'fresh bypasses the cache')
})

test('latest lookup failures are non-fatal: offline keeps the stale value and backs off', async t => {
  const dir = await scratch(t)
  let clock = 0
  let online = true
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    if (!online) throw new TypeError('fetch failed')
    return json({ name: '@google/gemini-cli', version: '0.62.0' })
  }
  const latest = createLatestVersions({ fetchImpl, now: () => clock, cachePath: () => join(dir, 'c.json') })
  const gemini = getOfficialTool('gemini')
  assert.equal((await latest.lookup(gemini)).version, '0.62.0')
  online = false
  clock += LATEST_CACHE_MS + 1
  const stale = await latest.lookup(gemini)
  assert.equal(stale.version, '0.62.0')
  assert.equal(stale.stale, true)
  assert.match(stale.error, /fetch failed/)
  await latest.lookup(gemini)
  assert.equal(calls, 2, 'a failure is not retried on every call')
  const cold = createLatestVersions({ fetchImpl, now: () => clock, persist: false })
  const unknown = await cold.lookup(gemini)
  assert.equal(unknown.version, null)
  const all = await cold.lookupAll()
  assert.equal(Object.keys(all).length, OFFICIAL_TOOLS.length, 'lookupAll never throws')
  const wrong = createLatestVersions({ fetchImpl: async () => json({ name: 'other', version: '9.9.9' }), persist: false })
  assert.equal((await wrong.lookup(gemini)).version, null, 'metadata for a different package is rejected')
  const bad = createLatestVersions({ fetchImpl: async () => json({ name: '@google/gemini-cli', version: 'latest' }), persist: false })
  assert.equal((await bad.lookup(gemini)).version, null)
})

function tarEntry(name, body) {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write('0000644\0', 100)
  header.write('0000000\0', 108)
  header.write('0000000\0', 116)
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124)
  header.write('00000000000\0', 136)
  header.write('        ', 148)
  header.write('0', 156)
  header.write('ustar\0', 257)
  header.write('00', 263)
  let sum = 0
  for (const byte of header) sum += byte
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
  return Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512)])
}

function fixturePackage(files) {
  const tar = Buffer.concat([...Object.entries(files).map(([name, body]) => tarEntry(`package/${name}`, Buffer.from(body))), Buffer.alloc(1024)])
  const tgz = gzipSync(tar)
  return { tgz, integrity: `sha512-${createHash('sha512').update(tgz).digest('base64')}` }
}

function registryFetch(name, version, pkg, counter = { meta: 0, tarball: 0 }) {
  const tarball = `https://registry.npmjs.org/${name}/-/x-${version}.tgz`
  return Object.assign(async url => {
    if (url === `https://registry.npmjs.org/${name}/${version}`) {
      counter.meta += 1
      return json({ name, version, dist: { integrity: pkg.integrity, tarball } })
    }
    if (url === tarball) {
      counter.tarball += 1
      return { ok: true, status: 200, body: Readable.toWeb(Readable.from([pkg.tgz])) }
    }
    return json({}, 404)
  }, { counter })
}

test('tar members are digested relative to the package root', async () => {
  const pkg = fixturePackage({ 'cli.js': 'console.log(1)', 'chunks/a.js': 'export {}' })
  const members = await digestTarMembers(Readable.from([pkg.tgz]))
  assert.deepEqual([...members.keys()].sort(), ['chunks/a.js', 'cli.js'])
  assert.equal(members.get('cli.js').sha256, `sha256-${createHash('sha256').update('console.log(1)').digest('base64')}`)
})

test('npm attestation accepts files equal to the registry tarball and rejects tampering', async t => {
  const dir = await scratch(t)
  const name = '@minimax-ai/code'
  const pkg = fixturePackage({ 'cli.js': 'import "./chunks/a.js"', 'chunks/a.js': 'export const a = 1', 'README.md': 'docs' })
  const fetchImpl = registryFetch(name, '0.6.2', pkg)
  const attestor = createNpmAttestor({ fetchImpl, cachePath: () => join(dir, 'att.json'), npmCacheDirectory: async () => join(dir, 'npm-cache') })
  const root = join(dir, 'installed')
  await mkdir(join(root, 'chunks'), { recursive: true })
  await writeFile(join(root, 'cli.js'), 'import "./chunks/a.js"')
  await writeFile(join(root, 'chunks', 'a.js'), 'export const a = 1')
  assert.deepEqual(await attestor.matchesPackage(root, name, '0.6.2'), { ok: true, files: 2 })
  assert.equal((await attestor.matches(join(root, 'cli.js'), name, '0.6.2', 'cli.js')).ok, true)
  assert.equal(fetchImpl.counter.tarball, 1)
  await attestor.matchesPackage(root, name, '0.6.2')
  assert.equal(fetchImpl.counter.meta, 1, 'cached per package@version')
  await writeFile(join(root, 'chunks', 'a.js'), 'export const a = 2')
  const tampered = await attestor.matchesPackage(root, name, '0.6.2')
  assert.equal(tampered.ok, false)
  assert.match(tampered.reason, /chunks\/a\.js/)
  await rm(join(root, 'chunks'), { recursive: true })
  assert.match((await attestor.matchesPackage(root, name, '0.6.2')).reason, /缺少/)
  const reloaded = createNpmAttestor({ fetchImpl: async () => { throw new Error('offline') }, cachePath: () => join(dir, 'att.json'), npmCacheDirectory: async () => null })
  assert.equal((await reloaded.matches(join(root, 'cli.js'), name, '0.6.2', 'cli.js')).ok, true, 'attested digests persist; works offline afterwards')
  assert.equal((await reloaded.matches(join(root, 'cli.js'), name, '0.6.3', 'cli.js')).ok, false, 'an unattested version fails closed offline')
})

test('npm attestation prefers a verified npm cache entry and rejects integrity mismatches', async t => {
  const dir = await scratch(t)
  const name = '@xiaomi/mimo-code-win32-x64'
  const pkg = fixturePackage({ 'bin/mimo.exe': 'MZ fake binary' })
  const cacheDir = join(dir, 'npm-cache')
  const content = npmCacheContentPath(cacheDir, pkg.integrity)
  await mkdir(join(content, '..'), { recursive: true })
  await writeFile(content, pkg.tgz)
  const fetchImpl = registryFetch(name, '0.1.16', pkg)
  const attestor = createNpmAttestor({ fetchImpl, persist: false, npmCacheDirectory: async () => cacheDir })
  assert.ok((await attestor.attest(name, '0.1.16', 'bin/mimo.exe')).sha256.startsWith('sha256-'))
  assert.equal(fetchImpl.counter.tarball, 0, 'served from the npm cache')
  const other = fixturePackage({ 'bin/mimo.exe': 'MZ evil binary' })
  const lying = createNpmAttestor({
    fetchImpl: async url => url.endsWith('/0.1.16')
      ? json({ name, version: '0.1.16', dist: { integrity: pkg.integrity, tarball: `https://registry.npmjs.org/${name}/-/x.tgz` } })
      : { ok: true, status: 200, body: Readable.toWeb(Readable.from([other.tgz])) },
    persist: false, npmCacheDirectory: async () => null,
  })
  await assert.rejects(lying.attest(name, '0.1.16', 'bin/mimo.exe'), /完整性/)
  const offHost = createNpmAttestor({
    fetchImpl: async () => json({ name, version: '0.1.16', dist: { integrity: pkg.integrity, tarball: 'https://evil.example/x.tgz' } }),
    persist: false, npmCacheDirectory: async () => null,
  })
  await assert.rejects(offHost.attest(name, '0.1.16', 'bin/mimo.exe'), /官方 registry/)
  await assert.rejects(attestor.attest(name, 'latest', 'bin/mimo.exe'), /无效/)
})

test('ZCode.exe acceptance is signer-only: any signed version, never an unsigned or foreign one', () => {
  const signed = { signatureStatus: 'Valid', signerSubject: `CN=${ZCODE_SIGNER}, O=${ZCODE_SIGNER}, C=CN`, signerThumbprint: 'AB', productVersion: '3.14.4.7801', fileVersion: '3.14.4.7801' }
  assert.equal(zcodeSignatureVerdict(signed).version, '3.14.4')
  assert.equal(zcodeSignatureVerdict({ ...signed, productVersion: '3.15.0' }).version, '3.15.0')
  assert.equal(zcodeSignatureVerdict({ ...signed, productVersion: '3.14.3.7762' }).version, '3.14.3')
  assert.equal(zcodeSignatureVerdict({ ...signed, signatureStatus: 'NotSigned' }), null)
  assert.equal(zcodeSignatureVerdict({ ...signed, signatureStatus: 'HashMismatch' }), null)
  assert.equal(zcodeSignatureVerdict({ ...signed, signerSubject: 'CN=Someone Else' }), null)
  assert.equal(zcodeSignatureVerdict({ ...signed, productVersion: 'dev', fileVersion: '' }), null)
})

test('Codex and Claude acceptance is signer-only and independent of the version', () => {
  assert.equal(signatureAccepted({ status: 'Valid', subject: 'CN="OpenAI OpCo, LLC", O="OpenAI OpCo, LLC"' }, OFFICIAL_SIGNERS.codex), true)
  assert.equal(signatureAccepted({ status: 'Valid', subject: 'CN=Evil Corp' }, OFFICIAL_SIGNERS.codex), false)
  assert.equal(signatureAccepted({ status: 'NotSigned', subject: 'CN="OpenAI OpCo, LLC"' }, OFFICIAL_SIGNERS.codex), false)
  assert.equal(signatureAccepted({ status: 'Valid', subject: 'CN="Anthropic, PBC"' }, OFFICIAL_SIGNERS['claude-code']), true)
  assert.equal(signatureAccepted(null, OFFICIAL_SIGNERS.codex), false)
})

test('ZCode CLI script is trusted on first use per signed build and refused if it changes under that build', async t => {
  const dir = await scratch(t)
  const trustPath = join(dir, 'zcode-trust.json')
  const base = { root: 'D:\\Program Files\\ZCode', buildVersion: '3.14.3.7762', signer: 'AB12', size: 100, trustPath, now: () => 5 }
  const first = await checkZCodeCliRecord({ ...base, sha256: 'a'.repeat(64) })
  assert.equal(first.ok, true)
  assert.equal(first.recorded, true)
  const again = await checkZCodeCliRecord({ ...base, root: 'd:\\program files\\zcode', sha256: 'a'.repeat(64), now: () => 9 })
  assert.deepEqual(again, { ok: true, sha256: 'a'.repeat(64), firstSeen: 5 })
  const swapped = await checkZCodeCliRecord({ ...base, sha256: 'b'.repeat(64) })
  assert.equal(swapped.ok, false)
  assert.match(swapped.reason, /首次核验/)
  const updated = await checkZCodeCliRecord({ ...base, buildVersion: '3.14.4.7801', sha256: 'c'.repeat(64), size: 120 })
  assert.equal(updated.ok, true, 'a new signed build re-records the script')
  const saved = JSON.parse(await readFile(trustPath, 'utf8')).entries
  assert.deepEqual(Object.keys(saved), ['d:\\program files\\zcode|3.14.4.7801|AB12'], 'old build records for the same root are replaced')
  assert.equal((await checkZCodeCliRecord({ ...base, buildVersion: '3.14.4.7801', sha256: 'c'.repeat(64), size: 121 })).ok, false)
})
