// Explicit offline Windows verification against previously downloaded vendor
// archives/registry metadata and the matching upstream provider-config fixture.
// No installed account or live model is read. This does not establish native
// Desktop/Host ACL coverage or vendor subscription authentication.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createNpmAttestor } from '../.dsh-plugin/shared/npm-attestation.mjs'
import { resolveZCodeTuiBundle, zcodeTuiInvocation } from '../.dsh-plugin/shared/zcode-tui.mjs'
import { prepareOfficialRuntime } from '../.dsh-plugin/shared/official-runtime-state.mjs'
import { captureOfficialProcess } from '../.dsh-plugin/shared/official-tool-executor.mjs'

if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('This captured fixture is Windows x64 only')
const args = process.argv.slice(2), option = name => { const at = args.indexOf(name); return at < 0 ? null : args[at + 1] }
const root = resolve(import.meta.dirname, '..'), references = resolve(option('--reference-directory') ?? join(root, 'tmp/references/zcode-tui'))
const json = async file => JSON.parse(await readFile(file, 'utf8'))
const documents = [await json(option('--entry-metadata') ?? join(root, 'tmp/zcode-tui-package-metadata.json')), await json(join(references, 'windows-metadata.json'))]
const archives = [join(references, 'mbearo-zcode-0.1.88.tgz'), join(references, 'mbearo-zcode-win32-x64-0.1.88.tgz')]
const bodies = await Promise.all(archives.map(file => readFile(file))), sha = bytes => createHash('sha256').update(bytes).digest('hex')
for (let i = 0; i < 2; i++) {
  assert.equal(documents[i].version, '0.1.88')
  assert.equal('sha512-' + createHash('sha512').update(bodies[i]).digest('base64'), documents[i].dist.integrity)
}
assert.equal(documents[0].name, '@mbearo/zcode'); assert.equal(documents[1].name, '@mbearo/zcode-win32-x64')
const base = join(root, 'tmp/integration/zcode-tui-runtime'); await mkdir(base, { recursive: true })
const run = await mkdtemp(join(base, 'case-')), prefix = join(run, 'prefix'), home = join(run, 'home'), workspace = join(run, 'work')
await mkdir(workspace, { recursive: true }); await mkdir(home, { recursive: true })
execFileSync('git', ['init', '--quiet'], { cwd: workspace, windowsHide: true })
const entryRoot = join(prefix, 'node_modules/@mbearo/zcode'), nativeRoot = join(prefix, 'node_modules/@mbearo/zcode-win32-x64')
await cp(join(references, 'package'), entryRoot, { recursive: true })
await cp(join(references, 'windows/package'), nativeRoot, { recursive: true })
const attestor = createNpmAttestor({ persist: false, npmCacheDirectory: async () => null, fetchImpl: async url => {
  const at = documents.findIndex(doc => url === `https://registry.npmjs.org/${doc.name}/${doc.version}`)
  if (at >= 0) return Response.json(documents[at])
  const archive = documents.findIndex(doc => url === doc.dist.tarball)
  if (archive >= 0) return new Response(bodies[archive])
  throw Error('Unexpected attestation URL')
} })
const bundle = await resolveZCodeTuiBundle({ packageRoot: entryRoot, entry: join(entryRoot, 'bin/zcode.cjs') }, { workspace, boundary: prefix, attestor })
const requests = [], blocked = []
const provider = createServer(async (req, res) => {
  let text = ''; for await (const chunk of req) text += chunk
  requests.push({ path: req.url, model: JSON.parse(text || '{}').model })
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const chunk of [
    { id: 'offline', choices: [{ index: 0, delta: { role: 'assistant', content: 'TUI-OFFLINE-OK' }, finish_reason: null }] },
    { id: 'offline', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } },
  ]) res.write('data: ' + JSON.stringify(chunk) + '\n\n')
  res.end('data: [DONE]\n\n')
})
const deny = createServer((req, res) => { blocked.push(req.url); res.writeHead(502); res.end() })
deny.on('connect', (req, socket) => { blocked.push(req.url); socket.end('HTTP/1.1 502 Blocked by offline fixture\r\n\r\n') })
await new Promise(done => provider.listen(0, '127.0.0.1', done)); await new Promise(done => deny.listen(0, '127.0.0.1', done))
try {
  const builtin = await json(join(references, 'platform_assets_zcode-builtin.json'))
  builtin.config.providerConfigRules.providerRules = []
  const personal = await json(join(references, 'platform_tests_fixtures_personal.json'))
  personal.config.providerConfigRules.providerRules = personal.config.providerConfigRules.providerRules.filter(row => row.providerId === 'personal:gateway')
  personal.config.providerConfigRules.providerRules[0].config.api.baseUrl = `http://127.0.0.1:${provider.address().port}/v1`
  personal.config.providerConfigRules.providerRules[0].config.access.apiKey = 'offline-not-a-real-key'
  const personalFile = join(home, '.zcode/v2/provider_config.json'), builtinFile = join(run, 'builtin-offline.json')
  await mkdir(dirname(personalFile), { recursive: true }); await writeFile(personalFile, JSON.stringify(personal)); await writeFile(builtinFile, JSON.stringify(builtin))
  const originalSha = sha(await readFile(personalFile)), env = {}
  for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'windir', 'ComSpec']) if (process.env[key]) env[key] = process.env[key]
  for (const key of ['HOME', 'USERPROFILE']) env[key] = home
  for (const key of ['APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP']) { env[key] = join(home, key.toLowerCase()); await mkdir(env[key], { recursive: true }) }
  const proxy = `http://127.0.0.1:${deny.address().port}`
  Object.assign(env, { ZCODE_DATA_BASE_DIR: home, ZCODE_STORAGE_DIR: join(home, '.zcode'), ZCODE_MODEL: 'custom-chat',
    ZCODE_MODEL_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`, ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: builtinFile,
    ZCODE_HTTP_PROXY: proxy, ZCODE_NO_PROXY: '127.0.0.1,localhost', HTTP_PROXY: proxy, HTTPS_PROXY: proxy, NO_PROXY: '127.0.0.1,localhost' })
  const version = execFileSync(bundle.file, ['--version'], { env, cwd: workspace, windowsHide: true, encoding: 'utf8' }).trim()
  assert.match(version, /0\.1\.88/)
  const results = []
  for (const [mode, model] of [['read-only', null], ['workspace-write', 'glm-5']]) {
    const spec = zcodeTuiInvocation(bundle, mode, model), managed = await prepareOfficialRuntime(spec, 'zcode', workspace, mode)
    try {
      const result = await captureOfficialProcess({ ...managed.spec, env: { ...managed.spec.env, ...env } }, 'Return TUI-OFFLINE-OK.', workspace, undefined, 30_000, 'zcode', true)
      assert.equal(result.status, 'succeeded', JSON.stringify(result)); assert.equal(result.finalText, 'TUI-OFFLINE-OK')
      assert.equal(result.usage.inputTokens, 12); assert.equal(result.usage.outputTokens, 5)
      assert.equal(result.reportedModel, model ?? 'custom-chat')
      results.push({ mode, requestedModel: model, reportedModel: result.reportedModel, status: result.status, usage: result.usage, printJsonSha256: sha(result.stdoutTail) })
    } finally { await managed.dispose() }
  }
  assert.deepEqual(requests.map(row => row.model), ['custom-chat', 'glm-5']); assert.equal(blocked.length, 0)
  assert.equal(sha(await readFile(personalFile)), originalSha)
  const report = { packageVersion: JSON.parse(await readFile(join(root, 'package.json'))).version, platform: 'win32-x64', capturedVendorVersion: '0.1.88',
    sourceCommit: 'a7a980de32da5da539d361e937702610b801e03d', version, archiveIntegrityVerified: true, installedFilesAttested: true,
    binarySha256: sha(await readFile(bundle.file)), results, requestCount: requests.length, requests, blockedExternalRequests: blocked.length,
    originalFixtureUnchanged: true, realVendorModelCalls: false, realAccountRead: false, hostAclVerified: false }
  await writeFile(join(run, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await writeFile(join(base, 'current.json'), JSON.stringify({ run, report: join(run, 'report.json') }, null, 2) + '\n')
  console.log(JSON.stringify({ run, ...report }, null, 2))
} finally {
  provider.closeAllConnections(); deny.closeAllConnections()
  await new Promise(done => provider.close(done)); await new Promise(done => deny.close(done))
}
