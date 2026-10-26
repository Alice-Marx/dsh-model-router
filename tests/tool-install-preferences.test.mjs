import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join, resolve, sep } from 'node:path'
import {
  OFFICIAL_TOOLS,
  getOfficialTool,
  installMethodFor,
} from '../.dsh-plugin/shared/official-tool-registry.mjs'
import {
  expandInstallDir,
  minimaxScriptRegistry,
  normalizeSourceUrl,
  parseInstallPreferences,
  resolveInstallLocation,
  resolveLegacyScriptLocation,
  resolveInstallPlan,
  resolveUninstallPlan,
  scriptInstallDir,
} from '../.dsh-plugin/shared/tool-install-preferences.mjs'
import {
  appendToProcessPath,
  cancelInstall,
  checkedRemovableFile,
  defaultRunner,
  fetchVendorScript,
  installEnvironment,
  installPreferences,
  installerScriptText,
  installStatus,
  isMarkupDocument,
  minimaxOfficialInstallDir,
  officialUpdatePlan,
  planCommandLine,
  preferredToolDirectories,
  probeToolWith,
  resetForTests,
  resolvePackageJobPlan,
  scriptBinaryCandidate,
  setInstallPreferences,
  startInstall,
  stripPathBlock,
  vendorScriptInvocation,
  WINDOWS_SCRIPT_DOWNLOAD,
} from '../.dsh-plugin/shared/official-tools-runtime.mjs'
import { compareReleaseVersions } from '../.dsh-plugin/shared/latest-versions.mjs'

const HOME = 'D:\\Users\\tester'
const clean = { installDir: '', registry: 'https://registry.npmjs.org/', methods: {}, scriptUrls: {}, allowScriptInstall: true }

test('an install directory must be an absolute path and never a root', () => {
  const env = { TOOLS: 'D:\\Apps' }
  assert.equal(expandInstallDir('', { home: HOME }), '')
  assert.equal(expandInstallDir('   ', { home: HOME }), '')
  assert.equal(expandInstallDir('D:/AI/tools', { home: HOME, env }), 'D:/AI/tools')
  assert.equal(expandInstallDir('%TOOLS%/cli', { home: HOME, env }), 'D:\\Apps/cli', 'expands %VAR%')
  assert.equal(expandInstallDir('$TOOLS/cli', { home: HOME, env }), 'D:\\Apps/cli', 'expands $VAR')
  assert.equal(expandInstallDir('~/cli', { home: '/home/tester', env: {} }), '/home/tester/cli')
  assert.throws(() => expandInstallDir('relative/path', { home: HOME }), /绝对路径/)
  assert.throws(() => expandInstallDir('/'), /根目录/)
  assert.throws(() => expandInstallDir('D:\\'), /根目录/)
  assert.throws(() => expandInstallDir('D:\\' + sep), /根目录/)
  assert.throws(() => expandInstallDir('\\\\server\\share'), /网络共享根目录/)
  assert.throws(() => expandInstallDir('C:\\bad\0path', { home: HOME }), /无效字符/)
})

test('a download source must be an https URL without credentials', () => {
  assert.equal(normalizeSourceUrl('', 'npm 源'), '')
  assert.equal(normalizeSourceUrl('https://registry.npmmirror.com/', 'npm 源'), 'https://registry.npmmirror.com/')
  assert.equal(normalizeSourceUrl('https://registry.npmmirror.com', 'npm 源'), 'https://registry.npmmirror.com/')
  assert.throws(() => normalizeSourceUrl('http://registry.npmjs.org/', 'npm 源'), /https/)
  assert.throws(() => normalizeSourceUrl('file:///C:/x', 'npm 源'), /https/)
  assert.throws(() => normalizeSourceUrl('not a url', 'npm 源'), /有效网址/)
  assert.throws(() => normalizeSourceUrl('https://user:pass@mirror.example.com/i.sh', '脚本源'), /账号密码/)
  assert.throws(() => normalizeSourceUrl(`https://mirror.example.com/${'x'.repeat(3_000)}`, '脚本源'), /过长/)
})

test('settings are validated against the closed registry before anything runs', () => {
  const parsed = parseInstallPreferences({
    toolInstallDir: 'D:/AI/tools',
    toolNpmRegistry: 'https://registry.npmmirror.com/',
    toolInstallMethodsJson: '{ "stepcode": "script-powershell" }',
    toolScriptUrlsJson: '{ "stepcode": "https://mirror.example.com/stepcode/install.ps1" }',
  }, { tools: OFFICIAL_TOOLS })
  assert.equal(parsed.installDir, 'D:/AI/tools')
  assert.equal(parsed.registry, 'https://registry.npmmirror.com/')
  assert.deepEqual(parsed.methods, { stepcode: 'script-powershell' })
  assert.equal(parsed.scriptUrls.stepcode, 'https://mirror.example.com/stepcode/install.ps1')

  assert.throws(() => parseInstallPreferences({ toolInstallMethodsJson: '{ "apt": "npm" }' }, { tools: OFFICIAL_TOOLS }), /不是官方工具 ID/)
  assert.throws(() => parseInstallPreferences({ toolInstallMethodsJson: '{ "opencode": "apt-get" }' }, { tools: OFFICIAL_TOOLS }), /不支持安装方式/)
  assert.throws(() => parseInstallPreferences({ toolScriptUrlsJson: '{ "opencode": "http://x/i.sh" }' }, { tools: OFFICIAL_TOOLS }), /https/)
  assert.throws(() => parseInstallPreferences({ toolScriptUrlsJson: '[]' }, { tools: OFFICIAL_TOOLS }), /JSON 对象/)
  assert.throws(() => parseInstallPreferences({ toolInstallDir: 'nope' }, { tools: OFFICIAL_TOOLS }), /绝对路径/)
})

test('package-manager installs use npm prefixes and pnpm global directories', () => {
  const codex = getOfficialTool('codex')
  const plan = resolveInstallPlan(codex, 'pnpm', { ...clean, installDir: 'D:/AI/tools', registry: 'https://registry.npmmirror.com/' }, { platform: 'win32' })
  assert.equal(plan.kind, 'package-manager')
  assert.equal(plan.command, undefined)
  assert.deepEqual(plan.args, [
    'install', '-g', '@openai/codex@latest',
    '--registry=https://registry.npmmirror.com/',
    '--config.global-dir=D:/AI/tools/.pnpm/global',
    '--config.global-bin-dir=D:/AI/tools',
    '--config.store-dir=D:/AI/tools/.pnpm/store',
  ])
  assert.equal(plan.binDir, 'D:/AI/tools')
  const linux = resolveInstallPlan(codex, 'pnpm', { ...clean, installDir: '/opt/tools' }, { platform: 'linux' })
  assert.equal(linux.binDir, '/opt/tools/bin')
  assert.ok(linux.args.includes('--config.global-bin-dir=/opt/tools/bin'))
  const removal = resolveUninstallPlan(codex, 'pnpm', { ...clean, installDir: '/opt/tools' }, { platform: 'linux' })
  assert.deepEqual(removal.args.slice(-3), linux.args.slice(-3), 'updates and removals use the same pnpm package tree')
  const npm = resolveInstallPlan(codex, 'npm', { ...clean, installDir: '/opt/tools' }, { platform: 'linux' })
  assert.deepEqual(npm.args.slice(-2), ['--prefix', '/opt/tools'])
  assert.equal(npm.binDir, '/opt/tools/bin')
  // The registry flag is replaced, never duplicated, so a mirror wins outright.
  assert.equal(plan.args.filter(arg => arg.startsWith('--registry=')).length, 1)
  assert.equal(resolveInstallPlan(codex, 'npm', clean, { platform: 'win32' }).args.includes('--prefix'), false, 'no directory configured, no prefix')
})

test('a script install never exposes its directory when the vendor hardcodes one', () => {
  const opencode = getOfficialTool('opencode')
  const preferences = { ...clean, installDir: 'D:/AI/tools' }
  const plan = resolveInstallPlan(opencode, 'script-bash', preferences, { platform: 'linux', home: '/home/tester' })
  assert.equal(plan.kind, 'script')
  assert.equal(plan.installDir, '', 'the opencode script has no directory argument')
  assert.match(plan.notices.join(''), /写死了安装路径/)
  // The binary still lands where the vendor puts it, so uninstall finds it there.
  const location = resolveInstallLocation(opencode, plan.method, preferences, { home: '/home/tester' })
  assert.equal(location.dir, '/home/tester/.opencode/bin')
  assert.deepEqual(location.binaries, ['opencode', 'opencode.exe'])
})

test('Step Code honours the configured directory and a script mirror', () => {
  const stepcode = getOfficialTool('stepcode')
  const preferences = {
    ...clean,
    installDir: 'D:/AI/tools',
    scriptUrls: { stepcode: 'https://mirror.example.com/stepcode/install.ps1' },
  }
  const plan = resolveInstallPlan(stepcode, 'script-powershell', preferences, { platform: 'win32', home: HOME })
  assert.equal(plan.kind, 'script')
  assert.equal(plan.scriptUrl, 'https://mirror.example.com/stepcode/install.ps1')
  assert.equal(plan.installDir, 'D:/AI/tools/stepcode')
  assert.deepEqual(plan.env, {
    STEP_INSTALL_DIR: 'D:/AI/tools/stepcode',
    // The mirror must also move the binaries and their checksums, not the script alone.
    STEP_RELEASE_BASE_URL: 'https://mirror.example.com/stepcode',
  })
  assert.match(plan.notices.join(''), /专属子目录/)
  const invocation = vendorScriptInvocation(plan, 'C:\\Temp\\install.ps1')
  assert.deepEqual(invocation.args.slice(-2), ['-InstallDir', 'D:/AI/tools/stepcode'])
  assert.equal(invocation.file.endsWith('powershell.exe'), true)

  const bash = resolveInstallPlan(stepcode, 'script-bash', clean, { platform: 'linux', home: '/home/tester' })
  assert.deepEqual(vendorScriptInvocation(bash, '/tmp/install.sh').args, ['/tmp/install.sh', '--install-dir', '/home/tester/.stepcode/bin'])
  assert.equal(scriptInstallDir(stepcode, clean, { home: '/home/tester' }), '/home/tester/.stepcode/bin')
})

test('every configurable vendor script owns a tool directory while npm keeps the shared prefix', () => {
  const preferences = { ...clean, installDir: 'D:/AI/tools' }
  for (const tool of OFFICIAL_TOOLS) {
    for (const method of tool.installMethods ?? []) {
      if (method.kind !== 'script' || !method.supportsInstallDir) continue
      const platform = method.platforms[0]
      const plan = resolveInstallPlan(tool, method.id, preferences, { platform, home: HOME })
      assert.ok(plan.installDir.startsWith('D:/AI/tools/'), `${tool.id}/${method.id} must never write directly to the shared prefix`)
      assert.ok(method.installDirSubdir, `${tool.id}/${method.id} declares its owned directory`)
      assert.equal(resolveInstallLocation(tool, method, preferences, { platform, home: HOME }).dir, plan.binDir)
      if (method.uninstallUnsupportedReason) {
        assert.throws(() => resolveUninstallPlan(tool, method.id, preferences, { platform, home: HOME }),
          error => error.message === method.uninstallUnsupportedReason)
      } else {
        assert.equal(resolveUninstallPlan(tool, method.id, preferences, { platform, home: HOME }).dir, plan.binDir)
      }
    }
    if (tool.package) {
      const npm = resolveInstallPlan(tool, 'npm', preferences, { platform: 'win32' })
      assert.equal(npm.installDir, 'D:/AI/tools', `${tool.id} retains its existing npm prefix`)
    }
  }
})

test('legacy shared script locations are read-only candidates and never change new operation targets', () => {
  const preferences = { ...clean, installDir: 'D:/AI/tools' }
  const step = getOfficialTool('stepcode')
  const method = installMethodFor(step, 'script-powershell')
  const legacy = resolveLegacyScriptLocation(step, method, preferences, { platform: 'win32', home: HOME })
  assert.deepEqual(legacy, {
    kind: 'script', dir: 'D:/AI/tools', installDir: 'D:/AI/tools',
    binaries: ['step', 'step.exe'], legacySharedInstallDir: true,
  })
  assert.equal(resolveInstallPlan(step, method.id, preferences, { platform: 'win32', home: HOME }).installDir, 'D:/AI/tools/stepcode')
  assert.equal(resolveUninstallPlan(step, method.id, preferences, { platform: 'win32', home: HOME }).dir, 'D:/AI/tools/stepcode')
  assert.equal(resolveLegacyScriptLocation(step, method, clean, { home: HOME }), null, 'vendor defaults do not need a shared-root fallback')
  const kimi = getOfficialTool('kimi-code')
  assert.equal(resolveLegacyScriptLocation(kimi, installMethodFor(kimi, 'script-bash'), preferences, { home: HOME }).dir, 'D:/AI/tools/bin')
  const codex = getOfficialTool('codex')
  assert.equal(resolveLegacyScriptLocation(codex, installMethodFor(codex, 'script-powershell'), preferences), null,
    'Codex Windows already had its dedicated directory before this change')
  assert.equal(resolveLegacyScriptLocation(codex, installMethodFor(codex, 'npm'), preferences), null)
})

test('Step runtime directory replacement preserves earlier npm packages and sibling script resources', async t => {
  const root = await mkdtemp(join(tmpdir(), 'router-step-isolation-'))
  t.after(async () => {
    if (resolve(root).startsWith(`${resolve(tmpdir())}${sep}`)) await rm(root, { recursive: true, force: true })
  })
  const npmPackage = join(root, 'node_modules', '@openai', 'codex', 'package.json')
  const siblingResource = join(root, 'minimax-code', 'node_modules', 'keep.txt')
  const sharedShim = join(root, 'codex.cmd')
  await mkdir(join(root, 'node_modules', '@openai', 'codex'), { recursive: true })
  await mkdir(join(root, 'minimax-code', 'node_modules'), { recursive: true })
  await writeFile(npmPackage, '{"name":"@openai/codex","version":"1.0.0"}')
  await writeFile(siblingResource, 'sibling-runtime')
  await writeFile(sharedShim, 'shared-command')
  const step = getOfficialTool('stepcode')
  for (const [methodId, platform] of [['script-powershell', 'win32'], ['script-bash', 'linux']]) {
    const plan = resolveInstallPlan(step, methodId, { ...clean, installDir: root }, { platform, home: HOME })
    assert.equal(plan.env.STEP_INSTALL_DIR, join(root, 'stepcode'))
    assert.equal(vendorScriptInvocation(plan, 'staged-installer').args.at(-1), join(root, 'stepcode'))
    // Reproduce the vendor installer's whole-resource-directory replacement.
    // All removal paths are checked before the fixture mutates the filesystem.
    for (const resource of ['node_modules', 'native', 'theme', 'docs']) {
      const target = resolve(plan.env.STEP_INSTALL_DIR, resource)
      assert.equal(target, resolve(root, 'stepcode', resource))
      await mkdir(target, { recursive: true })
      await writeFile(join(target, 'previous-release.txt'), 'old')
      await rm(target, { recursive: true, force: true })
      await mkdir(target, { recursive: true })
      await writeFile(join(target, 'current-release.txt'), 'new')
    }
    assert.equal(await readFile(npmPackage, 'utf8'), '{"name":"@openai/codex","version":"1.0.0"}')
    assert.equal(await readFile(siblingResource, 'utf8'), 'sibling-runtime')
    assert.equal(await readFile(sharedShim, 'utf8'), 'shared-command')
  }
})

test('a pinned method is never silently swapped for one that runs here', () => {
  const stepcode = getOfficialTool('stepcode')
  // Asking for the Unix script on Windows gets the reason, not a substitute.
  assert.throws(() => resolveInstallPlan(stepcode, 'script-bash', clean, { platform: 'win32' }), /仅支持 linux \/ darwin/)
  // Naming no method falls back to one that does run here.
  assert.equal(resolveInstallPlan(stepcode, undefined, clean, { platform: 'win32' }).methodId, 'script-powershell')
  // A method this tool does not declare is not a usable choice.
  assert.throws(() => resolveInstallPlan(stepcode, 'npm', clean, { platform: 'linux' }), /没有名为 npm 的安装方式/)
})

test('scripts can be switched off without touching the package managers', () => {
  const stepcode = getOfficialTool('stepcode')
  const locked = { ...clean, allowScriptInstall: false }
  assert.throws(() => resolveInstallPlan(stepcode, 'script-powershell', locked, { platform: 'win32' }), /已在插件设置中关闭/)
  const codex = resolveInstallPlan(getOfficialTool('codex'), 'npm', locked, { platform: 'win32' })
  assert.equal(codex.kind, 'package-manager')
  assert.throws(() => resolveInstallPlan(stepcode, undefined, locked, { platform: 'win32', home: HOME }), /已在插件设置中关闭/, 'automatic script-only methods preserve the correct platform before reporting the switch')
  assert.equal(resolveUninstallPlan(stepcode, undefined, locked, { platform: 'win32', home: HOME }).methodId, 'script-powershell', 'disabling future installs does not prevent removal')
})

test('removal mirrors how the tool was installed', () => {
  const codex = getOfficialTool('codex')
  const preferences = { ...clean, installDir: 'D:/AI/tools', registry: 'https://registry.npmmirror.com/' }
  const removal = resolveUninstallPlan(codex, 'npm', preferences, { platform: 'win32' })
  assert.deepEqual(removal.args, ['uninstall', '-g', '@openai/codex', '--registry=https://registry.npmmirror.com/', '--prefix', 'D:/AI/tools'])

  const stepcode = resolveUninstallPlan(getOfficialTool('stepcode'), undefined, { ...preferences, installDir: 'D:/AI/tools' }, { platform: 'win32' })
  assert.equal(stepcode.kind, 'script')
  assert.equal(stepcode.dir, 'D:/AI/tools/stepcode')
  assert.deepEqual(stepcode.binaries, ['step', 'step.exe'])

  const zcode = resolveUninstallPlan(getOfficialTool('zcode'), undefined, preferences, { platform: 'win32', home: 'C:/Users/test' })
  assert.equal(zcode.kind, 'archive')
  assert.equal(zcode.installDir, 'D:/AI/tools/zcode-cli')
})

test('ZCode npm can use the shared prefix and registry while GitHub retains its independent default', () => {
  const tool = getOfficialTool('zcode')
  const preferences = parseInstallPreferences({ toolInstallDir: 'D:/AI/tools', toolNpmRegistry: 'https://registry.npmmirror.com/', toolInstallMethodsJson: '{"zcode":"npm"}' }, { tools: OFFICIAL_TOOLS })
  for (const platform of ['win32', 'linux', 'darwin']) {
    const options = { platform, home: '/home/test' }
    const plan = resolveInstallPlan(tool, undefined, preferences, options)
    assert.equal(plan.kind, 'package-manager'); assert.equal(plan.manager, 'npm'); assert.equal(plan.installDir, 'D:/AI/tools')
    assert.deepEqual(plan.args, ['install', '-g', '@ljwei-stak/zcode-cli@latest', '--registry=https://registry.npmmirror.com/', '--prefix', 'D:/AI/tools'])
    const remove = resolveUninstallPlan(tool, undefined, preferences, options)
    assert.deepEqual(remove.args, ['uninstall', '-g', '@ljwei-stak/zcode-cli', '--registry=https://registry.npmmirror.com/', '--prefix', 'D:/AI/tools'])
    assert.equal(resolveInstallPlan(tool, 'github-release', preferences, options).installDir, 'D:/AI/tools/zcode-cli')
    assert.equal(resolveInstallPlan(tool, undefined, {}, options).kind, 'archive')
  }
})

test('deleting a vendor binary is bounded to the tool\'s own install directory', () => {
  const home = homedir()
  const tool = getOfficialTool('stepcode')
  const dir = join(home, '.stepcode', 'bin')
  assert.equal(checkedRemovableFile(join(dir, 'step.exe'), { allowedNames: tool.scriptBinaryNames, installDir: dir, home }),
    resolve(join(dir, 'step.exe')))
  // A name the registry never published is refused even inside the directory.
  assert.throws(() => checkedRemovableFile(join(dir, 'payload.exe'), { allowedNames: tool.scriptBinaryNames, installDir: dir, home }), /固定可执行文件名列表/)
  // So is the right name somewhere else entirely.
  assert.throws(() => checkedRemovableFile(join(home, 'step.exe'), { allowedNames: tool.scriptBinaryNames, installDir: dir, home }), /不在该工具的安装目录/)
  assert.throws(() => checkedRemovableFile(join(dir, '..', '..', 'step.exe'), { allowedNames: tool.scriptBinaryNames, installDir: dir, home }), /不在该工具的安装目录/)
  assert.throws(() => checkedRemovableFile(home, { allowedNames: [homedir().split(sep).pop()], installDir: home, home }), /主目录|根目录/)
})

test('only a well-formed vendor PATH block is removed from a shell profile', () => {
  const profile = ['export PATH="$HOME/bin:$PATH"', '# stepcode', 'export PATH="$HOME/.stepcode/bin:$PATH"', '# stepcode end', 'alias ll="ls -l"'].join('\n')
  const stripped = stripPathBlock(profile, '# stepcode')
  assert.equal(stripped, ['export PATH="$HOME/bin:$PATH"', 'alias ll="ls -l"'].join('\n'))
  // A bare mention is left alone, exactly as the vendor installer decides.
  assert.equal(stripPathBlock('# stepcode is nice\nexport PATH=x', '# stepcode'), null)
  assert.equal(stripPathBlock('nothing here', '# stepcode'), null)
  assert.equal(stripPathBlock(null, '# stepcode'), null)
  assert.equal(stripPathBlock('# stepcode\nexport PATH=x\nalias keep=1', '# stepcode'), null, 'a missing closing marker never truncates the profile')
  const grok = '# retained before\r\n# >>> grok installer >>>\r\nexport PATH="$HOME/.grok/bin:$PATH"\r\n# <<< grok installer <<<\r\nalias keep=1\r\n'
  assert.equal(stripPathBlock(grok, '# >>> grok installer >>>', '# <<< grok installer <<<'), '# retained before\r\nalias keep=1\r\n', 'paired markers preserve unrelated content and existing line endings')
  assert.equal(stripPathBlock(grok.replace('# <<< grok installer <<<\r\n', ''), '# >>> grok installer >>>', '# <<< grok installer <<<'), null)
})

test('chosen script methods pass the configured directory and nothing else', () => {
  const preferences = { ...clean, installDir: 'D:/AI/tools', registry: 'https://registry.npmmirror.com/' }
  const minimax = resolveInstallPlan(getOfficialTool('minimax-code'), 'script-powershell', preferences, { platform: 'win32', home: HOME })
  assert.equal(minimax.kind, 'script')
  assert.equal(minimax.installDir, 'D:/AI/tools/minimax-code')
  assert.equal(minimax.env.MCODE_INSTALL_DIR, 'D:/AI/tools/minimax-code')
  assert.equal(minimax.env.MCODE_NPM_REGISTRY, 'https://registry.npmmirror.com/')
  assert.equal(minimax.installArg.length, 0)
  assert.match(vendorScriptInvocation(minimax, 'C:\\Temp\\install.ps1').args.join(' '), /install\.ps1$/)
  const unset = resolveInstallPlan(getOfficialTool('minimax-code'), 'script-powershell', clean, { platform: 'win32', home: HOME })
  assert.equal(unset.installDir, `${HOME}\\.minimax-code`)
  assert.equal(unset.env.MCODE_INSTALL_DIR, unset.installDir)
  // Windows one-click update is the official script unless the user pins npm/pnpm.
  assert.equal(resolveInstallPlan(getOfficialTool('minimax-code'), undefined, clean, { platform: 'win32', home: HOME }).methodId, 'script-powershell')
  assert.equal(resolveInstallPlan(getOfficialTool('minimax-code'), undefined, clean, { platform: 'linux', home: '/home/tester' }).methodId, 'npm')
  assert.equal(resolveInstallPlan(getOfficialTool('minimax-code'), 'npm', clean, { platform: 'win32', home: HOME }).methodId, 'npm')
  assert.equal(resolveInstallPlan(getOfficialTool('minimax-code'), undefined, { ...clean, allowScriptInstall: false }, { platform: 'win32', home: HOME }).methodId, 'npm')

  const codex = resolveInstallPlan(getOfficialTool('codex'), 'script-sh', preferences, { platform: 'linux', home: '/home/tester' })
  assert.equal(codex.env.CODEX_INSTALL_DIR, 'D:/AI/tools/codex/bin')
  const claude = resolveInstallPlan(getOfficialTool('claude-code'), 'script-bash', preferences, { platform: 'linux', home: '/home/tester' })
  assert.equal(claude.installDir, '')
  assert.match(claude.notices.join(''), /写死了安装路径/)
  assert.equal(resolveInstallLocation(getOfficialTool('claude-code'), claude.method, preferences, { home: '/home/tester' }).dir, '/home/tester/.local/bin')

  const kimi = resolveInstallLocation(getOfficialTool('kimi-code'), installMethodFor(getOfficialTool('kimi-code'), 'script-bash'), preferences, { home: '/home/tester' })
  assert.equal(kimi.dir, 'D:/AI/tools/kimi-code/bin')
  assert.deepEqual(kimi.binaries, ['kimi'])
  assert.equal(minimaxScriptRegistry('https://example.invalid/npm'), '')
  assert.equal(minimaxScriptRegistry('https://registry.npmjs.org'), 'https://registry.npmjs.org/')
  const unsupportedRegistry = resolveInstallPlan(getOfficialTool('minimax-code'), 'script-powershell', { ...preferences, registry: 'https://mirror.example.com/npm/' }, { platform: 'win32', home: HOME })
  assert.equal(unsupportedRegistry.env.MCODE_NPM_REGISTRY, undefined, 'the vendor script does not accept an arbitrary registry')
  assert.match(unsupportedRegistry.notices.join(''), /只接受/)
})

test('a script uninstall stays inside the install directory, including bin/', () => {
  const home = homedir()
  const dir = join(home, '.minimax-code')
  const tool = getOfficialTool('minimax-code')
  assert.equal(scriptBinaryCandidate(dir, 'bin/mcode'), join(dir, 'bin', 'mcode'))
  assert.equal(checkedRemovableFile(scriptBinaryCandidate(dir, 'bin/mcode'), {
    allowedNames: tool.scriptBinaryNames, installDir: dir, home,
  }), resolve(join(dir, 'bin', 'mcode')))
  assert.throws(() => scriptBinaryCandidate(dir, '../mcode'), /之外/)
  assert.throws(() => scriptBinaryCandidate(dir, 'bin/../../mcode'), /之外/)
  assert.throws(() => scriptBinaryCandidate(dir, '/mcode'), /之外/)
  assert.throws(() => scriptBinaryCandidate(dir, 'C:\\mcode'), /之外/)
})

test('Host preferences reach the runtime and are cleared by the test reset', () => {
  resetForTests()
  setInstallPreferences({ installDir: 'D:/AI/tools', methods: { stepcode: 'script-powershell' } })
  assert.equal(getOfficialTool('stepcode').id, 'stepcode')
  assert.equal(installMethodFor(getOfficialTool('stepcode'), 'script-powershell').shell, 'powershell')
  resetForTests()
  assert.equal(installMethodFor(getOfficialTool('stepcode'), 'script-powershell').shell, 'powershell')
})

test('environment-only native installers map root directories to actual binary directories', () => {
  const preferences = { ...clean, installDir: 'D:/AI/tools' }
  const kimi = resolveInstallPlan(getOfficialTool('kimi-code'), 'script-powershell', preferences, { platform: 'win32', home: HOME })
  assert.equal(kimi.installDir, 'D:/AI/tools/kimi-code')
  assert.equal(kimi.binDir, 'D:/AI/tools/kimi-code/bin')
  assert.equal(kimi.env.KIMI_INSTALL_DIR, 'D:/AI/tools/kimi-code')
  assert.equal(resolveInstallLocation(getOfficialTool('kimi-code'), kimi.method, preferences, { platform: 'win32', home: HOME }).dir, kimi.binDir)
  assert.deepEqual(vendorScriptInvocation(kimi, 'C:/Temp/install.ps1').args.slice(-1), ['C:/Temp/install.ps1'], 'environment-only installers get no invented positional arguments')
  assert.match(planCommandLine(kimi), /\$env:KIMI_INSTALL_DIR='D:\/AI\/tools\/kimi-code'; irm/)

  const minimax = getOfficialTool('minimax-code')
  const nativeWindows = resolveInstallPlan(minimax, 'script-powershell', preferences, { platform: 'win32', home: HOME })
  assert.equal(nativeWindows.binDir, 'D:/AI/tools/minimax-code')
  assert.equal(nativeWindows.env.MCODE_INSTALL_DIR, 'D:/AI/tools/minimax-code')
  assert.equal(nativeWindows.env.MCODE_NPM_REGISTRY, clean.registry)
  assert.deepEqual(resolveInstallLocation(minimax, nativeWindows.method, preferences, { platform: 'win32', home: HOME }).binaries, ['mcode.cmd', 'mcode.ps1', 'mcode-tools.cmd', 'mcode-tools.ps1'])
  const nativeUnix = resolveInstallPlan(minimax, 'script-bash', clean, { platform: 'linux', home: '/home/tester' })
  assert.equal(nativeUnix.installDir, '/home/tester/.minimax-code')
  assert.equal(nativeUnix.binDir, '/home/tester/.minimax-code/bin')
  assert.match(planCommandLine(nativeUnix), /\| MCODE_INSTALL_DIR='\/home\/tester\/\.minimax-code'/, 'variables belong to bash, rather than the downloader')
})

test('Codex native Windows junction stays inside its tool subdirectory and has explicit removal guidance', () => {
  const codex = getOfficialTool('codex')
  const configured = resolveInstallPlan(codex, 'script-powershell', { ...clean, installDir: 'D:/AI/tools' }, { platform: 'win32', home: HOME })
  assert.equal(configured.installDir, 'D:/AI/tools/codex/bin')
  assert.equal(configured.binDir, configured.installDir)
  assert.equal(configured.env.CODEX_INSTALL_DIR, configured.installDir)
  const defaultWindows = resolveInstallPlan(codex, 'script-powershell', clean, { platform: 'win32', home: HOME, env: { LOCALAPPDATA: 'D:/UserData/Local' } })
  assert.equal(defaultWindows.binDir, 'D:/UserData/Local/Programs/OpenAI/Codex/bin')
  assert.throws(() => resolveUninstallPlan(codex, 'script-powershell', clean, { platform: 'win32' }), /目录联接/)
  const unix = resolveInstallPlan(codex, 'script-sh', clean, { platform: 'linux', home: '/home/tester' })
  assert.equal(vendorScriptInvocation(unix, '/tmp/install.sh').file, 'sh')
})

test('PATH updates are bounded, platform-aware and can put the selected command first', () => {
  const posix = { PATH: '/usr/bin:/opt/tools/bin' }
  appendToProcessPath('/opt/tools/bin', { env: posix, platform: 'linux', prepend: true })
  assert.equal(posix.PATH, '/opt/tools/bin:/usr/bin')
  appendToProcessPath('/opt/Tools/bin', { env: posix, platform: 'linux' })
  assert.equal(posix.PATH, '/opt/tools/bin:/usr/bin:/opt/Tools/bin', 'POSIX paths keep their case')
  appendToProcessPath('D:\\Tools', { env: posix, platform: 'linux', prepend: true })
  assert.equal(posix.PATH, '/opt/tools/bin:/usr/bin:/opt/Tools/bin', 'a Windows absolute path is relative on POSIX, regardless of the test host')
  const windows = { Path: 'C:\\old;d:\\tools' }
  appendToProcessPath('D:\\Tools', { env: windows, platform: 'win32', prepend: true })
  assert.equal(windows.Path, 'D:\\Tools;C:\\old')
  assert.equal(windows.PATH, undefined, 'Windows has only one case-insensitive PATH variable')
  const env = installEnvironment({ binDir: resolve('managed-tools'), env: { TEST_INSTALL: '1' } }, { PATH: 'legacy', KEEP: 'yes' })
  assert.equal(env.TEST_INSTALL, '1')
  assert.equal(env.KEEP, 'yes')
  assert.equal(env.PATH.split(process.platform === 'win32' ? ';' : ':')[0], resolve('managed-tools'))
})

test('a selected package probe reads its package metadata and never executes shared shims', async () => {
  resetForTests()
  const tool = getOfficialTool('codex')
  const directory = resolve('managed-tools')
  setInstallPreferences({ ...clean, installDir: directory, methods: { codex: 'pnpm' } })
  const runner = async () => { throw new Error('the PATH locator and unrelated shims must not run') }
  const packageRoot = join(directory, '.pnpm', 'global', '5', 'node_modules', '@openai', 'codex')
  const entry = join(packageRoot, 'bin', 'codex.js')
  const packageEntries = async (probedTool, { plan, preferences }) => {
    assert.equal(probedTool.package, '@openai/codex')
    assert.equal(plan.manager, 'pnpm')
    assert.equal(preferences.installDir, directory)
    return [{ version: '1.0.0', entry: `${entry}.old`, packageRoot, source: 'verified-npm-package' },
      { version: '1.2.3', entry, packageRoot, source: 'verified-npm-package' }]
  }
  const probe = await probeToolWith(tool, runner, { cache: new Map(), packageEntries })
  assert.equal(probe.version, '1.2.3')
  assert.equal(probe.packageEntry, entry)
  assert.equal(probe.packageRoot, packageRoot)
  assert.equal(probe.source, 'verified-npm-package')
  assert.equal(probe.executablePath, undefined, 'metadata detection does not select a native updater executable')
  const missing = await probeToolWith(tool, runner, { cache: new Map(), packageEntries: async () => [] })
  assert.equal(missing.installed, false)
  assert.match(missing.detail, /所选安装目录/)
  resetForTests()
})

test('npm and pnpm probes remain bound to their own versions when a unified shim is overwritten', async t => {
  const root = await mkdtemp(join(tmpdir(), 'router-package-probe-'))
  t.after(async () => {
    if (resolve(root).startsWith(`${resolve(tmpdir())}${sep}`)) await rm(root, { recursive: true, force: true })
  })
  const tool = getOfficialTool('kimi-code')
  const prefix = join(root, 'tools')
  const fixture = async (modules, version) => {
    const packageRoot = join(modules, ...tool.package.split('/'))
    await mkdir(join(packageRoot, 'dist'), { recursive: true })
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: tool.package, version, bin: { kimi: 'dist/main.mjs' } }))
    await writeFile(join(packageRoot, 'dist', 'main.mjs'), 'throw new Error("must never execute this fixture")')
    return packageRoot
  }
  const npmRoot = await fixture(process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules'), '1.0.0')
  const pnpmRoot = await fixture(join(prefix, '.pnpm', 'global', '5', 'node_modules'), '2.0.0')
  const binDir = process.platform === 'win32' ? prefix : join(prefix, 'bin')
  await mkdir(binDir, { recursive: true })
  await writeFile(join(binDir, process.platform === 'win32' ? 'kimi.cmd' : 'kimi'), 'echo 2.0.0')
  const selected = manager => ({ ...clean, installDir: prefix, methods: { 'kimi-code': manager } })
  // Make the mutable Host settings disagree with the supplied job snapshot.
  const previous = installPreferences()
  setInstallPreferences(selected('pnpm'))
  t.after(() => setInstallPreferences(previous))
  let shimCalls = 0
  const runner = async () => { shimCalls += 1; return { ok: true, code: 0, stdout: '2.0.0', stderr: '', timedOut: false } }
  const npm = await probeToolWith(tool, runner, { preferences: selected('npm'), cache: new Map() })
  assert.equal(npm.version, '1.0.0')
  assert.equal(npm.packageRoot, await realpath(npmRoot))
  const pnpm = await probeToolWith(tool, runner, { preferences: selected('pnpm'), cache: new Map() })
  assert.equal(pnpm.version, '2.0.0')
  assert.equal(pnpm.packageRoot, await realpath(pnpmRoot))
  await rm(npmRoot, { recursive: true })
  const missing = await probeToolWith(tool, runner, { preferences: selected('npm'), cache: new Map() })
  assert.equal(missing.installed, false, 'the pnpm shim/package cannot satisfy a missing selected npm package')
  assert.equal(missing.manager, 'npm')
  assert.equal(shimCalls, 0, 'no shared command shim is executed for package metadata probes')
})

test('an npm job binds its default write prefix before a newer PATH prefix can skip its update', async t => {
  const root = await mkdtemp(join(tmpdir(), 'router-default-prefix-'))
  t.after(async () => {
    if (resolve(root).startsWith(`${resolve(tmpdir())}${sep}`)) await rm(root, { recursive: true, force: true })
  })
  const tool = getOfficialTool('kimi-code')
  const defaultPrefix = join(root, 'default')
  const otherPrefix = join(root, 'other')
  const fixture = async (prefix, version) => {
    const modules = process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules')
    const packageRoot = join(modules, ...tool.package.split('/'))
    await mkdir(join(packageRoot, 'dist'), { recursive: true })
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: tool.package, version, bin: { kimi: 'dist/main.mjs' } }))
    await writeFile(join(packageRoot, 'dist', 'main.mjs'), 'must-not-execute-fixture')
    return packageRoot
  }
  const defaultRoot = await fixture(defaultPrefix, '1.0.0')
  await fixture(otherPrefix, '2.0.0')
  const savedPath = process.env.PATH
  process.env.PATH = process.platform === 'win32' ? otherPrefix : join(otherPrefix, 'bin')
  t.after(() => { if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath })
  const options = { platform: process.platform, home: homedir(), env: process.env }
  const original = resolveInstallPlan(tool, 'npm', clean, options)
  assert.equal(original.binDir, '')
  const ordinary = await probeToolWith(tool, async () => { throw new Error('must not execute a shim') }, { preferences: clean, plan: original, cache: new Map() })
  assert.equal(ordinary.version, '2.0.0', 'ordinary inspection retains same-manager PATH discovery')
  const plan = await resolvePackageJobPlan(tool, original, clean, { options, runner: async (manager, args) => {
    assert.equal(manager, 'npm')
    assert.deepEqual(args, ['config', 'get', 'prefix'])
    return { ok: true, stdout: `${defaultPrefix}\n` }
  } })
  assert.deepEqual(plan.args.slice(-2), ['--prefix', defaultPrefix])
  assert.equal(original.installDir, '', 'resolving the job target does not mutate the saved preferences or UI plan')
  const probe = await probeToolWith(tool, async () => { throw new Error('must not execute a shim') }, { preferences: clean, plan, cache: new Map() })
  assert.equal(probe.version, '1.0.0')
  assert.equal(probe.packageRoot, await realpath(defaultRoot))
  assert.equal(compareReleaseVersions(probe.version, '2.0.0'), -1, 'the default prefix still needs the update despite the current other-prefix version')
  const removal = await resolvePackageJobPlan(tool, resolveUninstallPlan(tool, 'npm', clean, options), clean,
    { operation: 'uninstall', options, runner: async () => ({ ok: true, stdout: defaultPrefix }) })
  assert.deepEqual(removal.args.slice(-2), ['--prefix', defaultPrefix], 'removal binds the same target as install and repair')
  await resolvePackageJobPlan(tool, plan, clean, { runner: async () => { throw new Error('explicit directories require no query') } })
})

test('a failed or invalid default target query refuses installation instead of accepting a PATH version', async () => {
  const tool = getOfficialTool('kimi-code')
  const options = { platform: 'win32', home: HOME, env: {} }
  const plan = resolveInstallPlan(tool, 'npm', clean, options)
  for (const outcome of [{ ok: false, stdout: '' }, { ok: true, stdout: '' }, { ok: true, stdout: 'undefined' },
    { ok: true, stdout: 'D:/tools\nD:/other' }, { ok: true, stdout: 'D:/' }, { ok: true, stdout: 'D:/tools', timedOut: true }]) {
    await assert.rejects(resolvePackageJobPlan(tool, plan, clean, { options, runner: async () => outcome }), /已停止操作/)
  }
  await assert.rejects(resolvePackageJobPlan(tool, plan, clean, { options, runner: async () => { throw new Error('query unavailable') } }), /已停止操作/)
})

test('pnpm jobs bind the queried bin directory and exact versioned global package root', async () => {
  const tool = getOfficialTool('kimi-code')
  const options = { platform: 'win32', home: HOME, env: {} }
  const binDir = 'D:/pnpm/bin'
  const moduleRoot = 'D:/pnpm/packages/global/5/node_modules'
  const query = async (manager, args) => {
    assert.equal(manager, 'pnpm')
    assert.deepEqual(args.slice(1), ['-g'])
    return { ok: true, stdout: args[0] === 'bin' ? binDir : moduleRoot }
  }
  for (const operation of ['install', 'repair', 'uninstall']) {
    const original = operation === 'uninstall' ? resolveUninstallPlan(tool, 'pnpm', clean, options) : resolveInstallPlan(tool, 'pnpm', clean, options)
    const plan = await resolvePackageJobPlan(tool, original, clean, { options, runner: query, operation })
    assert.equal(plan.installDir, '')
    assert.equal(plan.binDir, binDir)
    assert.deepEqual(plan.packageModuleRoots, [moduleRoot])
    assert.deepEqual(plan.args.slice(-2), ['--config.global-dir=D:/pnpm/packages/global', '--config.global-bin-dir=D:/pnpm/bin'])
    assert.equal(plan.args.some(arg => arg.startsWith('--config.store-dir=')), false, 'the existing pnpm store preference is retained')
  }
  for (const output of ['D:/pnpm/other-node_modules', 'D:/pnpm/global/unknown/node_modules', '']) {
    await assert.rejects(resolvePackageJobPlan(tool, resolveInstallPlan(tool, 'pnpm', clean, options), clean,
      { options, runner: async () => ({ ok: true, stdout: output }) }), /已停止操作.*统一安装目录/)
  }
})

test('different frozen pnpm module roots invalidate a probe even if they share a bin directory', async () => {
  const tool = getOfficialTool('kimi-code')
  const plan = { ...resolveInstallPlan(tool, 'pnpm', clean, { platform: 'win32' }), binDir: 'D:/pnpm/bin', packageModuleRoots: ['D:/global/5/node_modules'] }
  const cache = new Map()
  let calls = 0
  const packageEntries = async (_tool, { plan }) => {
    calls += 1
    return [{ version: calls === 1 ? '1.0.0' : '2.0.0', entry: 'entry', packageRoot: plan.packageModuleRoots[0] }]
  }
  const first = await probeToolWith(tool, null, { plan, preferences: clean, cache, packageEntries })
  const second = await probeToolWith(tool, null, { plan: { ...plan, packageModuleRoots: ['D:/global/6/node_modules'] }, preferences: clean, cache, packageEntries })
  assert.equal(first.version, '1.0.0')
  assert.equal(second.version, '2.0.0')
  assert.equal(calls, 2)
})

test('directory changes invalidate probes and preference snapshots do not share mutable maps', async () => {
  resetForTests()
  const methodChoices = { codex: 'npm' }
  const firstDir = resolve('managed-tools-a')
  const nextDir = resolve('managed-tools-b')
  setInstallPreferences({ ...clean, installDir: firstDir, methods: methodChoices })
  methodChoices.codex = 'pnpm'
  assert.equal(installPreferences().methods.codex, 'npm')
  const snapshot = installPreferences()
  snapshot.methods.codex = 'pnpm'
  assert.equal(installPreferences().methods.codex, 'npm')
  const tool = getOfficialTool('codex')
  const cache = new Map()
  let probes = 0
  const runner = async () => { throw new Error('package metadata does not execute command shims') }
  const packageEntries = async (_tool, { plan }) => {
    probes += 1
    return [{ version: '1.2.3', entry: join(plan.installDir, 'codex.js'), packageRoot: plan.installDir, source: 'verified-npm-package' }]
  }
  await probeToolWith(tool, runner, { cache, packageEntries })
  setInstallPreferences({ installDir: nextDir })
  const changed = await probeToolWith(tool, runner, { cache, packageEntries })
  assert.equal(probes, 2, 'a new directory cannot reuse the previous directory version')
  assert.equal(changed.installDir, nextDir)
  resetForTests()
})

test('configured package methods never silently invoke another updater or MiniMax installer', () => {
  for (const toolId of ['claude-code', 'minimax-code']) {
    assert.equal(officialUpdatePlan({ toolId, installed: true, order: -1, platform: 'win32', configured: true }), 'registry-install')
    assert.equal(officialUpdatePlan({ toolId, installed: true, order: 1, platform: 'win32', configured: true }), 'refuse-downgrade')
  }
  resetForTests()
  setInstallPreferences({ ...clean, methods: { 'minimax-code': 'script-powershell' }, allowScriptInstall: false })
  const directories = preferredToolDirectories('minimax-code')
  if (process.platform === 'win32') assert.equal(directories.length, 1, 'script permission controls installs, rather than selection of an existing copy')
  resetForTests()
})

test('a queued installation keeps its reviewed method, source and directory when settings change', () => {
  resetForTests()
  const originalDir = resolve('queued-tools-a')
  setInstallPreferences({ ...clean, installDir: originalDir, registry: 'https://registry.npmmirror.com/' })
  const queued = startInstall('codex', { method: 'pnpm' })
  setInstallPreferences({ installDir: resolve('queued-tools-b'), registry: clean.registry })
  const running = installStatus('codex')
  assert.equal(running.command, queued.command)
  assert.equal(running.installDir, originalDir)
  assert.match(running.command, /registry\.npmmirror\.com/)
  assert.equal(running.methodId, 'pnpm')
  assert.equal(cancelInstall('codex').status, 'cancelled', 'cancel before its microtask starts, without running a real installer')
  resetForTests()
})

test('Windows download fallback uses the same source and validates staged bytes without running them', async () => {
  const source = Buffer.from('<# official installer help #>\n# test-vendor install\n')
  let stagedPath
  let calls = 0
  const bytes = await fetchVendorScript('https://mirror.example.com/install.ps1', undefined, {
    platform: 'win32', verify: { mustInclude: ['test-vendor install'] },
    fetcher: async (_url, options) => {
      assert.equal(options.headers['User-Agent'], 'curl/8.0')
      return { ok: true, status: 200, body: [Buffer.from('<html>blocked</html>')] }
    },
    powershellRunner: async (_executable, args, options) => {
      calls += 1
      assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand'])
      const program = Buffer.from(args[3], 'base64').toString('utf16le')
      assert.equal(program, WINDOWS_SCRIPT_DOWNLOAD)
      assert.equal(program.includes('mirror.example.com'), false, 'URL stays data rather than interpolated PowerShell code')
      assert.equal(program.includes('Invoke-Expression'), false)
      assert.equal(options.env.MODEL_ROUTER_DOWNLOAD_URL, 'https://mirror.example.com/install.ps1')
      stagedPath = options.env.MODEL_ROUTER_DOWNLOAD_FILE
      await writeFile(stagedPath, source)
      return { ok: true, code: 0, stdout: '', stderr: '', timedOut: false }
    },
  })
  assert.deepEqual(bytes, source)
  assert.equal(calls, 1)
  assert.equal(await stat(stagedPath).catch(() => null), null, 'temporary download is cleaned up')
})

test('a fallback transport never accepts HTML, foreign scripts, excess bytes or cancelled downloads', async () => {
  const fallback = payload => async (_file, _args, options) => {
    await writeFile(options.env.MODEL_ROUTER_DOWNLOAD_FILE, payload)
    return { ok: true, code: 0, stdout: '', stderr: '', timedOut: false }
  }
  const unavailable = async () => { throw new Error('network unavailable') }
  for (const payload of ['<html>error</html>', 'another installer']) {
    await assert.rejects(fetchVendorScript('https://example.com/install.ps1', undefined, {
      platform: 'win32', verify: { mustInclude: ['test-vendor'] }, fetcher: unavailable, powershellRunner: fallback(payload),
    }), /安装脚本/)
  }
  await assert.rejects(fetchVendorScript('https://example.com/install.ps1', undefined, {
    platform: 'win32', fetcher: unavailable, powershellRunner: fallback(Buffer.alloc(200_001)),
  }), /大小上限/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(fetchVendorScript('https://example.com/install.ps1', controller.signal, {
    platform: 'win32', fetcher: unavailable, powershellRunner: async () => { throw new Error('must not fall back after cancellation') },
  }), /network unavailable/)
})

test('Windows cmd preserves a selected directory containing spaces and ampersands as one argument', { skip: process.platform !== 'win32' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'model-router-shell-fixture-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const script = join(directory, 'arguments.cjs')
  const shim = join(directory, 'argument shim.cmd')
  await writeFile(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
  await writeFile(shim, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`)
  const target = 'D:/AI tools & test'
  const outcome = await defaultRunner(shim, [target, 'safe-token'], { timeoutMs: 10_000, useShell: true })
  assert.equal(outcome.ok, true, outcome.stderr)
  assert.deepEqual(JSON.parse(outcome.stdout), [target, 'safe-token'])
})

test('vendor download redirects are used only for default sources and every fallback is validated', async () => {
  const sourceTool = getOfficialTool('claude-code')
  const defaultMethod = installMethodFor(sourceTool, 'script-powershell')
  const method = { ...defaultMethod, scriptFallbackUrls: ['https://downloads.vendor.example/bootstrap.ps1'] }
  const tool = { ...sourceTool, installMethods: [method] }
  const defaultPlan = resolveInstallPlan(tool, method.id, clean, { platform: 'win32', home: HOME })
  assert.deepEqual(defaultPlan.downloadUrls, [method.scriptUrl, ...method.scriptFallbackUrls])
  const mirrorPlan = resolveInstallPlan(tool, method.id, { ...clean, scriptUrls: { 'claude-code': 'https://mirror.example/install.ps1' } }, { platform: 'win32', home: HOME })
  assert.deepEqual(mirrorPlan.downloadUrls, ['https://mirror.example/install.ps1'])
  const asked = []
  const bytes = await fetchVendorScript(method.scriptUrl, undefined, {
    platform: 'linux', fallbackUrls: method.scriptFallbackUrls, verify: { mustInclude: ['test-vendor'] },
    fetcher: async url => {
      asked.push(url)
      return { ok: true, status: 200, body: [Buffer.from(url === method.scriptUrl ? '<html>unavailable</html>' : '# test-vendor installer')] }
    },
  })
  assert.deepEqual(asked, defaultPlan.downloadUrls)
  assert.equal(bytes.toString(), '# test-vendor installer')
})

test('a platform-specific default method stays explicit and respects the script switch', () => {
  const tool = { ...getOfficialTool('minimax-code'), defaultMethodsByPlatform: { win32: 'script-powershell' } }
  assert.equal(resolveInstallPlan(tool, undefined, clean, { platform: 'win32', home: HOME }).methodId, 'script-powershell')
  assert.equal(resolveInstallPlan(tool, undefined, { ...clean, allowScriptInstall: false }, { platform: 'win32' }).methodId, 'npm')
  assert.equal(resolveInstallPlan(tool, 'pnpm', clean, { platform: 'win32' }).methodId, 'pnpm')
})

test('automatic MiniMax detection selects npm when scripts are disabled while pinned native copies stay visible', () => {
  resetForTests()
  const directory = resolve('disabled-script-tools')
  const automatic = { ...clean, installDir: directory, allowScriptInstall: false }
  const tool = getOfficialTool('minimax-code')
  const options = { platform: 'win32', home: HOME }
  assert.equal(resolveInstallPlan(tool, undefined, automatic, options).methodId, 'npm')
  assert.deepEqual(preferredToolDirectories(tool.id, automatic, options), [directory])
  const noDirectory = { ...automatic, installDir: '' }
  assert.deepEqual(preferredToolDirectories(tool.id, noDirectory, options), [], 'auto cannot probe a native directory while the install plan uses npm')
  const pinned = { ...noDirectory, methods: { 'minimax-code': 'script-powershell' } }
  assert.deepEqual(preferredToolDirectories(tool.id, pinned, options), [`${HOME}\\.minimax-code`], 'the explicit existing native copy remains selectable')
  resetForTests()
})

test('the upstream installer decoder keeps BOM and bare UTF-16 script bytes equivalent', () => {
  const script = '<# PowerShell help #>\n# MiniMax Code @minimax-ai/code MCODE_INSTALL_DIR\n'
  assert.equal(installerScriptText(Buffer.from(script)), script)
  assert.equal(installerScriptText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(script, 'utf16le')])), script)
  assert.equal(installerScriptText(Buffer.from(script, 'utf16le')), script)
  assert.equal(isMarkupDocument(script), false)
  for (const markup of ['<html>error</html>', '<!DOCTYPE html>', '<?xml version="1.0"?>']) assert.equal(isMarkupDocument(markup), true)
  assert.equal(minimaxOfficialInstallDir({ installDir: 'D:/AI/tools' }, HOME, 'C:/Old'), 'D:/AI/tools/minimax-code')
  assert.equal(minimaxOfficialInstallDir({}, HOME, 'D:/Old/MiniMax'), 'D:/Old/MiniMax')
  assert.equal(minimaxOfficialInstallDir({}, HOME), join(HOME, '.minimax-code'))
})

test('a saved legacy Codex bash method is canonicalized to the actual sh installer', () => {
  const parsed = parseInstallPreferences({ toolInstallMethodsJson: '{"codex":"script-bash"}' }, { tools: OFFICIAL_TOOLS })
  assert.equal(parsed.methods.codex, 'script-sh')
  const plan = resolveInstallPlan(getOfficialTool('codex'), undefined, parsed, { platform: 'linux', home: '/home/tester' })
  assert.equal(plan.methodId, 'script-sh')
  assert.equal(vendorScriptInvocation(plan, '/tmp/install.sh').file, 'sh')
})
