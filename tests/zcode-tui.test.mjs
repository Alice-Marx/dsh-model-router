import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile, lstat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { OFFICIAL_TOOLS, getOfficialTool } from '../.dsh-plugin/shared/official-tool-registry.mjs'
import { parseInstallPreferences, resolveInstallPlan } from '../.dsh-plugin/shared/tool-install-preferences.mjs'
import { createLatestVersions } from '../.dsh-plugin/shared/latest-versions.mjs'
import { resolveZCodeTuiBundle, zcodeTuiInvocation } from '../.dsh-plugin/shared/zcode-tui.mjs'
import { resolveTerminalLaunch } from '../.dsh-plugin/shared/cli-terminal.mjs'
import { executionEnvironment, parseClaudeProcessOutput, officialToolExecutionCapabilities } from '../.dsh-plugin/shared/official-tool-executor.mjs'
import { prepareZCodeNpmShims } from '../.dsh-plugin/shared/zcode-npm-shims.mjs'
import { prepareOfficialRuntime, managedRuntimeTool } from '../.dsh-plugin/shared/official-runtime-state.mjs'
import { parseModelProfilesJson } from '../.dsh-plugin/shared/model-profiles.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
async function fixture() {
  const base = resolve('tmp/integration/zcode-tui-tests'); await mkdir(base, { recursive: true })
  const dir = await mkdtemp(join(base, 'case-')), prefix = join(dir, 'prefix'), workspace = join(dir, 'work')
  const root = join(prefix, 'node_modules/@mbearo/zcode'), nativeRoot = join(prefix, 'node_modules/@mbearo/zcode-win32-x64')
  const manifest = { name: '@mbearo/zcode', version: '0.1.88', bin: { zcode: 'bin/zcode.cjs' }, optionalDependencies: { '@mbearo/zcode-win32-x64': '0.1.88' } }
  const native = { name: '@mbearo/zcode-win32-x64', version: '0.1.88' }, files = new Map()
  await mkdir(workspace, { recursive: true })
  for (const [owner, name, paths] of [
    [root, manifest.name, { 'package.json': JSON.stringify(manifest), 'bin/zcode.cjs': 'vendor wrapper fixture', 'platforms.json': '[]' }],
    [nativeRoot, native.name, { 'package.json': JSON.stringify(native), 'bin/zcode.exe': 'native fixture, never executed' }],
  ]) for (const [path, body] of Object.entries(paths)) {
    const file = join(owner, path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, body)
    files.set(`${name}:${path}`, hash(body))
  }
  const checked = [], attestor = { async matches(file, name, version, member) {
    checked.push({ name, version, member })
    return { ok: version === '0.1.88' && hash(await readFile(file)) === files.get(`${name}:${member}`), reason: 'changed registry bytes' }
  } }
  return { dir, prefix, root, nativeRoot, manifest, workspace, checked,
    found: { packageRoot: root, entry: join(root, 'bin/zcode.cjs') },
    options: { platform: 'win32', arch: 'x64', boundary: prefix, workspace, attestor } }
}

test('the saved zcode identity selects vendor TUI, npm package and a compatible install preference', () => {
  const tool = getOfficialTool('zcode')
  assert.equal(tool.label, 'ZCode TUI'); assert.equal(tool.package, '@mbearo/zcode')
  assert.deepEqual(tool.installMethods.map(row => row.id), ['npm', 'pnpm'])
  const preferences = parseInstallPreferences({ toolInstallMethodsJson: '{"zcode":"github-release","codex":"npm"}' }, { tools: OFFICIAL_TOOLS })
  assert.equal(preferences.methods.zcode, 'npm'); assert.equal(preferences.methods.codex, 'npm')
  const plan = resolveInstallPlan(tool, undefined, preferences, { platform: 'win32', home: 'C:\\offline' })
  assert.ok(plan.args.some(arg => arg === '@mbearo/zcode@latest'))
  assert.ok(!plan.args.some(arg => arg.includes('@ljwei-stak') || arg.includes('Alice-Marx')))
  const profiles = parseModelProfilesJson('[{"provider":"zcode","model":"bound","cliModel":"glm-5"}]')
  assert.equal(profiles[0].cliModel, 'glm-5')
})

test('latest version cannot inherit the old community package cached version', async () => {
  const f = await fixture(), file = join(f.dir, 'latest.json'), urls = []
  await writeFile(file, JSON.stringify({ version: 1, entries: { 'zcode:npm': { version: '3.9.9', checkedAt: new Date().toISOString(), source: 'npm' } } }))
  const service = createLatestVersions({ cachePath: () => file, fetchImpl: async url => { urls.push(url); return Response.json({ name: '@mbearo/zcode', version: '0.1.88' }) } })
  assert.equal((await service.lookup(getOfficialTool('zcode'))).version, '0.1.88')
  assert.deepEqual(urls, ['https://registry.npmjs.org/@mbearo/zcode/latest'])
})

test('TUI discovery attests the fixed wrapper and matching native platform package', async () => {
  const f = await fixture(), bundle = await resolveZCodeTuiBundle(f.found, f.options)
  assert.equal(bundle.file, join(f.nativeRoot, 'bin/zcode.exe'))
  assert.equal(bundle.source, 'npm:@mbearo/zcode@0.1.88')
  assert.equal(f.checked.length, 5)
  assert.ok(f.checked.some(row => row.member === 'platforms.json'))
  assert.ok(f.checked.some(row => row.name === '@mbearo/zcode-win32-x64' && row.member === 'bin/zcode.exe'))
})

test('changed wrapper/native bytes, old community layout and missing dependencies are refused', async () => {
  for (const mutate of [
    f => writeFile(f.found.entry, 'changed'), f => writeFile(join(f.nativeRoot, 'bin/zcode.exe'), 'changed'),
    f => writeFile(join(f.root, 'package.json'), JSON.stringify({ ...f.manifest, name: '@ljwei-stak/zcode-cli' })),
    f => writeFile(join(f.root, 'package.json'), JSON.stringify({ ...f.manifest, bin: { zcode: 'bin/zcode.mjs' } })),
  ]) { const f = await fixture(); await mutate(f); await assert.rejects(resolveZCodeTuiBundle(f.found, f.options), /核验失败/) }
  const f = await fixture()
  await assert.rejects(resolveZCodeTuiBundle(f.found, { ...f.options, resolveDependency: () => { throw Error('absent') } }), /optional dependencies/)
  await assert.rejects(resolveZCodeTuiBundle(f.found, { ...f.options, workspace: f.prefix }), /工作区/)
  await assert.rejects(resolveZCodeTuiBundle(f.found, { ...f.options, boundary: f.workspace }), /安装目录/)
  await assert.rejects(resolveZCodeTuiBundle(f.found, { ...f.options, platform: 'darwin', arch: 'x64' }), /架构/)
})

test('terminal uses verified TUI wrapper with the supported Node floor and actual zcode login command', async () => {
  const f = await fixture(), bundle = await resolveZCodeTuiBundle(f.found, f.options), minimums = []
  const options = { platform: 'win32', home: f.dir, cwd: f.workspace, env: {}, preferences: { installDir: f.prefix, methods: {}, scriptUrls: {} },
    packageEntry: async () => f.found, zcodeTuiBundle: async () => bundle,
    findNode: async (_, minimum) => { minimums.push(minimum); return process.execPath } }
  const login = await resolveTerminalLaunch('zcode', 'login', options)
  assert.deepEqual(login.args, [bundle.cliEntry, 'login']); assert.equal(login.display, 'zcode login')
  assert.deepEqual((await resolveTerminalLaunch('zcode', 'interactive', options)).args, [bundle.cliEntry])
  assert.deepEqual(minimums, [[22, 16, 0], [22, 16, 0]])
  await assert.rejects(resolveTerminalLaunch('zcode', 'login', { ...options, findNode: async () => null }), /22.16.0/)
  await assert.rejects(resolveTerminalLaunch('zcode', 'login', { ...options, packageEntry: async () => null }), /@mbearo\/zcode/)
})

test('managed TUI uses stdin, native print JSON, explicit model and Host sandbox capability', async () => {
  const f = await fixture(), bundle = await resolveZCodeTuiBundle(f.found, f.options)
  const read = zcodeTuiInvocation(bundle, 'read-only', 'glm-5'), write = zcodeTuiInvocation(bundle, 'workspace-write')
  assert.equal(read.stdinTask, true); assert.equal(read.format, 'claude-json')
  assert.ok(read.args.includes('plan')); assert.ok(write.args.includes('yolo'))
  assert.deepEqual(read.args.slice(-2), ['--model', 'glm-5']); assert.ok(write.modelNotice.includes('默认模型'))
  assert.ok(read.args.includes('--strict-mcp-config')); assert.ok(read.args.includes('{"mcpServers":{}}'))
  for (const flag of ['--cwd', '--prompt', '--mode', '--workflow-mode']) assert.ok(!read.args.includes(flag))
  assert.throws(() => zcodeTuiInvocation(bundle, 'read-only', '--some-command'))
  assert.deepEqual(officialToolExecutionCapabilities().find(row => row.id === 'zcode').modes, ['read-only', 'workspace-write'])
  assert.equal(managedRuntimeTool('zcode'), true)
  const runtime = await prepareOfficialRuntime(read, 'zcode', f.workspace, 'read-only')
  try { assert.notEqual(runtime.policy.workspaceRoot, f.workspace); assert.equal(runtime.policy.mode, 'workspace-write') } finally { await runtime.dispose() }
})

test('subscription-only execution strips the new API key while preserving account root selection', () => {
  const env = { ZCODE_API_KEY: 'fixture-secret', ZAI_API_KEY: 'other', ZCODE_DATA_BASE_DIR: 'C:\\offline', ZCODE_MODEL: 'glm-5', UNRELATED_SECRET: 'not-passed' }
  assert.equal(executionEnvironment('zcode', { env }).ZCODE_API_KEY, 'fixture-secret')
  const session = executionEnvironment('zcode', { env, sessionOnly: true })
  assert.equal(session.ZCODE_API_KEY, undefined); assert.equal(session.ZAI_API_KEY, undefined)
  assert.equal(session.ZCODE_DATA_BASE_DIR, env.ZCODE_DATA_BASE_DIR); assert.equal(session.UNRELATED_SECRET, undefined)
})

test('real TUI terminal shape reports usage only with a completed success', () => {
  const event = { type: 'result', subtype: 'success', is_error: false, terminal_reason: 'completed', result: 'offline proof', session_id: 'sess_offline',
    usage: { input_tokens: 12, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, total_cost_usd: 0, modelUsage: { 'glm-5': { inputTokens: 12, outputTokens: 5 } } }
  const parse = (body, code = 0) => parseClaudeProcessOutput(JSON.stringify(body), code, { toolLabel: 'ZCode TUI', requireCompleted: true })
  assert.equal(parse(event).status, 'succeeded'); assert.equal(parse(event).usage.outputTokens, 5); assert.equal(parse(event).reportedModel, 'glm-5')
  for (const bad of [{ ...event, terminal_reason: 'cancelled' }, { ...event, terminal_reason: undefined }, { ...event, is_error: true }]) assert.equal(parse(bad).status, 'failed')
  assert.equal(parse(event, 1).status, 'failed')
  assert.match(parse({}).error, /ZCode TUI/)
})

async function oldShims() {
  const f = await fixture(), oldRoot = join(f.prefix, 'node_modules/@ljwei-stak/zcode-cli')
  await mkdir(join(oldRoot, 'bin'), { recursive: true })
  await writeFile(join(oldRoot, 'package.json'), JSON.stringify({ name: '@ljwei-stak/zcode-cli', version: '3.1.0', bin: { zcode: 'bin/zcode.mjs' } }))
  await writeFile(join(oldRoot, 'bin/zcode.mjs'), 'old fixture, never executed')
  for (const name of ['zcode', 'zcode.cmd', 'zcode.ps1']) await writeFile(join(f.prefix, name), await readFile(new URL(`./fixtures/zcode-community-npm-shims/${name}.txt`, import.meta.url)))
  return f
}
test('old npm shims are preserved before linking TUI and rollback never overwrites a newly created file', async () => {
  const f = await oldShims(), old = await readFile(join(f.prefix, 'zcode.cmd')), tx = await prepareZCodeNpmShims({ prefix: f.prefix, platform: 'win32' })
  assert.equal(tx.backups.length, 3); assert.deepEqual(await readFile(join(tx.backupDir, 'zcode.cmd')), old)
  assert.equal(await lstat(join(f.prefix, 'zcode.cmd')).catch(() => null), null)
  await writeFile(join(f.prefix, 'zcode.cmd'), 'new TUI wrapper')
  const restored = await tx.restoreMissing()
  assert.deepEqual(restored.preserved, ['zcode.cmd']); assert.equal(restored.restored.length, 2)
  assert.equal(await readFile(join(f.prefix, 'zcode.cmd'), 'utf8'), 'new TUI wrapper')
})
test('modified legacy shim blocks migration atomically and retains every original file', async () => {
  const f = await oldShims(); await writeFile(join(f.prefix, 'zcode.ps1'), 'user-authored script with zcode-cli mentioned')
  await assert.rejects(prepareZCodeNpmShims({ prefix: f.prefix, platform: 'win32' }), /无法识别/)
  assert.ok((await lstat(join(f.prefix, 'zcode.cmd'))).isFile())
  assert.equal(await readFile(join(f.prefix, 'zcode.ps1'), 'utf8'), 'user-authored script with zcode-cli mentioned')
})
