import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getOfficialTool } from '../.dsh-plugin/shared/official-tool-registry.mjs'
import { resolveInstallPlan } from '../.dsh-plugin/shared/tool-install-preferences.mjs'
import { assertVendorInstallDirectory, miniMaxFallbackPlan, probeToolWith } from '../.dsh-plugin/shared/official-tools-runtime.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'router-script-safety-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
const preferences = root => ({ installDir: root, registry: '', methods: {}, scriptUrls: {}, allowScriptInstall: true })
const options = root => ({ platform: process.platform, home: root })
const stepMethod = process.platform === 'win32' ? 'script-powershell' : 'script-bash'

test('script preflight refuses a shared prefix and leaves other npm files untouched', async t => {
  const root = await fixture(t)
  const sentinel = join(root, 'node_modules', '@openai', 'codex', 'package.json')
  await mkdir(join(root, 'node_modules', '@openai', 'codex'), { recursive: true })
  await writeFile(sentinel, 'codex remains')
  const tool = getOfficialTool('stepcode')
  const prefs = preferences(root)
  const plan = resolveInstallPlan(tool, stepMethod, prefs, options(root))
  await assert.rejects(assertVendorInstallDirectory(tool, { ...plan, installDir: root }, prefs), /专属子目录/)
  await assertVendorInstallDirectory(tool, plan, prefs)
  assert.equal(await readFile(sentinel, 'utf8'), 'codex remains')
})

test('a private script directory used by another CLI is refused before vendor cleanup', async t => {
  const root = await fixture(t)
  const tool = getOfficialTool('stepcode')
  const prefs = preferences(root)
  const plan = resolveInstallPlan(tool, stepMethod, prefs, options(root))
  await mkdir(plan.installDir, { recursive: true })
  await writeFile(join(plan.installDir, 'gemini.cmd'), 'foreign command')
  await assert.rejects(assertVendorInstallDirectory(tool, plan, prefs), /Gemini/)
  assert.equal(await readFile(join(plan.installDir, 'gemini.cmd'), 'utf8'), 'foreign command')
})

test('a junction or symlink to the shared prefix cannot defeat script isolation', async t => {
  const root = await fixture(t)
  const tool = getOfficialTool('stepcode')
  const prefs = preferences(root)
  const plan = resolveInstallPlan(tool, stepMethod, prefs, options(root))
  try { await symlink(root, plan.installDir, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('symlink permission unavailable'); throw error }
  await assert.rejects(assertVendorInstallDirectory(tool, plan, prefs), /专属子目录/)
})

test('a legacy shared-root executable is explained without satisfying the isolated target', async t => {
  const root = await fixture(t)
  const tool = getOfficialTool('stepcode')
  const name = process.platform === 'win32' ? 'step.exe' : 'step'
  await writeFile(join(root, name), 'legacy binary must not execute')
  const prefs = { ...preferences(root), methods: { stepcode: stepMethod } }
  const probe = await probeToolWith(tool, () => { throw new Error('legacy program must not run') }, { preferences: prefs, cache: new Map() })
  assert.equal(probe.installed, false)
  assert.equal(probe.status, 'legacy-install')
  assert.equal(probe.legacyExecutablePath, join(root, name))
  assert.equal(probe.installDir, join(root, 'stepcode'))
})

test('a tool junction cannot point into a sibling npm package root', async t => {
  const root = await fixture(t)
  const packageRoot = join(root, 'node_modules', '@openai', 'codex')
  await mkdir(packageRoot, { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), '{"name":"@openai/codex"}')
  const tool = getOfficialTool('stepcode')
  const prefs = preferences(root)
  const plan = resolveInstallPlan(tool, stepMethod, prefs, options(root))
  try { await symlink(packageRoot, plan.installDir, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('symlink permission unavailable'); throw error }
  await assert.rejects(assertVendorInstallDirectory(tool, plan, prefs), /包目录|其他工具/)
})

test('foreign commands under a script bin directory are protected too', async t => {
  const root = await fixture(t)
  const tool = getOfficialTool('kimi-code')
  const prefs = preferences(root)
  const plan = resolveInstallPlan(tool, stepMethod, prefs, options(root))
  await mkdir(plan.binDir, { recursive: true })
  await writeFile(join(plan.binDir, 'gemini.cmd'), 'foreign command')
  await assert.rejects(assertVendorInstallDirectory(tool, plan, prefs), /Gemini/)
})

test('a Codex bin junction inside its own release tree remains valid', async t => {
  const root = await fixture(t)
  const tool = getOfficialTool('codex')
  const prefs = preferences(root)
  const method = process.platform === 'win32' ? 'script-powershell' : 'script-sh'
  const plan = resolveInstallPlan(tool, method, prefs, options(root))
  const releaseBin = join(root, 'codex', 'releases', '0.1', 'bin')
  await mkdir(releaseBin, { recursive: true })
  try { await symlink(releaseBin, plan.installDir, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('symlink permission unavailable'); throw error }
  await assertVendorInstallDirectory(tool, plan, prefs)
})

test('MiniMax fallback retains a resolved target without appending a second child directory', () => {
  const prefs = preferences('D:/AI/tools')
  const fallback = miniMaxFallbackPlan(prefs, { installed: true, installDir: 'C:/old' }, '', { platform: 'win32', home: 'C:/User' })
  assert.equal(fallback.plan.installDir, 'D:/AI/tools/minimax-code')
  assert.equal(fallback.plan.env.MCODE_INSTALL_DIR, fallback.plan.installDir)
  assert.equal(fallback.executionPreferences.installDir, prefs.installDir)
})

test('binary-only default installers can share a bin directory with other CLIs', async t => {
  const root = await fixture(t)
  const directory = join(root, '.local', 'bin')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'gemini.cmd'), 'other launcher')
  const tool = getOfficialTool('claude-code')
  const method = process.platform === 'win32' ? 'script-powershell' : 'script-bash'
  const plan = resolveInstallPlan(tool, method, preferences(''), options(root))
  await assertVendorInstallDirectory(tool, plan, {})
  assert.equal(await readFile(join(directory, 'gemini.cmd'), 'utf8'), 'other launcher')
})

test('Codex Windows visible bin can link to the documented user-owned standalone release', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixture(t)
  const base = join(root, 'AI-tools')
  const home = join(root, 'user-home')
  const release = join(home, '.codex', 'packages', 'standalone', 'releases', '0.1-x64')
  await mkdir(release, { recursive: true })
  const tool = getOfficialTool('codex')
  const prefs = preferences(base)
  const plan = resolveInstallPlan(tool, 'script-powershell', prefs, { platform: 'win32', home })
  await mkdir(join(base, 'codex'), { recursive: true })
  await symlink(release, plan.installDir, 'junction')
  await assertVendorInstallDirectory(tool, plan, prefs, { home, env: {} })
})
