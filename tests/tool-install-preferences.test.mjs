import test from 'node:test'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import {
  OFFICIAL_TOOLS,
  getOfficialTool,
  installMethodFor,
} from '../.dsh-plugin/shared/official-tool-registry.mjs'
import {
  expandInstallDir,
  normalizeSourceUrl,
  parseInstallPreferences,
  resolveInstallLocation,
  resolveInstallPlan,
  resolveUninstallPlan,
  scriptInstallDir,
} from '../.dsh-plugin/shared/tool-install-preferences.mjs'
import {
  checkedRemovableFile,
  resetForTests,
  setInstallPreferences,
  stripPathBlock,
  vendorScriptInvocation,
} from '../.dsh-plugin/shared/official-tools-runtime.mjs'

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

test('package-manager installs carry the configured source and prefix', () => {
  const codex = getOfficialTool('codex')
  const plan = resolveInstallPlan(codex, 'pnpm', { ...clean, installDir: 'D:/AI/tools', registry: 'https://registry.npmmirror.com/' }, { platform: 'win32' })
  assert.equal(plan.kind, 'package-manager')
  assert.equal(plan.command, undefined)
  assert.deepEqual(plan.args, [
    'install', '-g', '@openai/codex@latest',
    '--registry=https://registry.npmmirror.com/', '--prefix', 'D:/AI/tools',
  ])
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
  assert.equal(plan.installDir, 'D:/AI/tools')
  assert.deepEqual(plan.env, {
    STEP_INSTALL_DIR: 'D:/AI/tools',
    // The mirror must also move the binaries and their checksums, not the script alone.
    STEP_RELEASE_BASE_URL: 'https://mirror.example.com/stepcode',
  })
  assert.deepEqual(plan.notices, [])
  const invocation = vendorScriptInvocation(plan, 'C:\\Temp\\install.ps1')
  assert.deepEqual(invocation.args.slice(-2), ['-InstallDir', 'D:/AI/tools'])
  assert.equal(invocation.file.endsWith('powershell.exe'), true)

  const bash = resolveInstallPlan(stepcode, 'script-bash', clean, { platform: 'linux', home: '/home/tester' })
  assert.deepEqual(vendorScriptInvocation(bash, '/tmp/install.sh').args, ['/tmp/install.sh', '--install-dir', '/home/tester/.stepcode/bin'])
  assert.equal(scriptInstallDir(stepcode, clean, { home: '/home/tester' }), '/home/tester/.stepcode/bin')
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
})

test('removal mirrors how the tool was installed', () => {
  const codex = getOfficialTool('codex')
  const preferences = { ...clean, installDir: 'D:/AI/tools', registry: 'https://registry.npmmirror.com/' }
  const removal = resolveUninstallPlan(codex, 'npm', preferences, { platform: 'win32' })
  assert.deepEqual(removal.args, ['uninstall', '-g', '@openai/codex', '--registry=https://registry.npmmirror.com/', '--prefix', 'D:/AI/tools'])

  const stepcode = resolveUninstallPlan(getOfficialTool('stepcode'), undefined, { ...preferences, installDir: 'D:/AI/tools' }, { platform: 'win32' })
  assert.equal(stepcode.kind, 'script')
  assert.equal(stepcode.dir, 'D:/AI/tools')
  assert.deepEqual(stepcode.binaries, ['step', 'step.exe'])

  // The desktop installer is not this plugin's to remove.
  assert.throws(() => resolveUninstallPlan(getOfficialTool('zcode'), undefined, clean, { platform: 'win32' }), /系统“应用”/)
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
})

test('Host preferences reach the runtime and are cleared by the test reset', () => {
  resetForTests()
  setInstallPreferences({ installDir: 'D:/AI/tools', methods: { stepcode: 'script-powershell' } })
  assert.equal(getOfficialTool('stepcode').id, 'stepcode')
  assert.equal(installMethodFor(getOfficialTool('stepcode'), 'script-powershell').shell, 'powershell')
  resetForTests()
  assert.equal(installMethodFor(getOfficialTool('stepcode'), 'script-powershell').shell, 'powershell')
})
