/** The vendor-supplied Rust TUI. The old community Node runtime is a different
 * distribution; it cannot satisfy this package or native-binary verification. */
import { createRequire } from 'node:module'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { npmAttestor } from './npm-attestation.mjs'
import { isReleaseVersion } from './latest-versions.mjs'

export const ZCODE_TUI_PACKAGE = '@mbearo/zcode'
export const ZCODE_TUI_NODE_MINIMUM = Object.freeze([22, 16, 0])
const platforms = Object.freeze({
  'win32-x64': 'win32-x64', 'win32-arm64': 'win32-arm64', 'darwin-arm64': 'darwin-arm64',
  'linux-x64': 'linux-x64-gnu', 'linux-arm64': 'linux-arm64-gnu',
})
const inside = (root, file) => { const part = relative(root, file); return part !== '' && part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part) }
const fail = reason => { throw new Error('ZCode TUI 核验失败：' + reason) }
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b

export async function resolveZCodeTuiBundle(found, {
  workspace = null, boundary = null, platform = process.platform, arch = process.arch,
  attestor = npmAttestor, resolveDependency = (root, name) => createRequire(join(root, 'package.json')).resolve(name + '/package.json'),
} = {}) {
  const suffix = platforms[platform + '-' + arch]
  if (!suffix) fail('当前系统或架构没有可用的厂商平台包。')
  if (!found?.packageRoot || !found?.entry) fail('请先安装 @mbearo/zcode。')
  const root = await realpath(found.packageRoot), entry = await realpath(found.entry)
  const allowed = boundary ? await realpath(boundary) : resolve(root, '..', '..')
  const working = workspace ? await realpath(workspace) : null
  if (!inside(allowed, root) || working && (same(root, working) || inside(working, root))) fail('安装目录不属于所选包管理器，或位于任务工作区中。')
  if (!same(entry, join(root, 'bin', 'zcode.cjs'))) fail('不是新 TUI 的固定命令入口。')
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== ZCODE_TUI_PACKAGE || !isReleaseVersion(manifest.version) || String(manifest.bin?.zcode).replace(/^\.\//, '') !== 'bin/zcode.cjs') fail('包名、版本或命令入口无效。')
  const verify = async (owner, name, version, file) => {
    const target = join(owner, ...file.split('/')), info = await lstat(target), actual = await realpath(target)
    if (!info.isFile() || info.isSymbolicLink() || !inside(owner, actual) || working && inside(working, actual)) fail('程序文件离开安装目录。')
    const checked = await attestor.matches(actual, name, version, file)
    if (!checked.ok) fail(checked.reason ?? '文件与 npm 发布内容不符。')
    return actual
  }
  for (const file of ['package.json', 'bin/zcode.cjs', 'platforms.json']) await verify(root, ZCODE_TUI_PACKAGE, manifest.version, file)
  const nativeName = ZCODE_TUI_PACKAGE + '-' + suffix
  if (manifest.optionalDependencies?.[nativeName] !== manifest.version) fail('平台包必须与入口包使用相同版本。')
  let nativeRoot
  try { nativeRoot = await realpath(resolve(resolveDependency(root, nativeName), '..')) }
  catch { fail('缺少匹配的原生平台包，请保留 optional dependencies 并修复安装。') }
  if (!inside(allowed, nativeRoot) || working && (same(nativeRoot, working) || inside(working, nativeRoot))) fail('原生平台包离开所选安装目录。')
  const native = JSON.parse(await readFile(join(nativeRoot, 'package.json'), 'utf8'))
  if (native.name !== nativeName || native.version !== manifest.version) fail('原生平台包名称或版本不符。')
  await verify(nativeRoot, nativeName, native.version, 'package.json')
  const file = await verify(nativeRoot, nativeName, native.version, 'bin/' + (platform === 'win32' ? 'zcode.exe' : 'zcode-rs'))
  return Object.freeze({ root, cliEntry: entry, file, version: manifest.version, platformPackage: nativeName, source: `npm:${ZCODE_TUI_PACKAGE}@${manifest.version}` })
}

export function zcodeTuiInvocation(bundle, mode, modelId = null) {
  if (!['read-only', 'workspace-write'].includes(mode) || !bundle?.file || !isAbsolute(bundle.file)) throw new TypeError('ZCODE_TUI_INVOCATION_INVALID')
  if (modelId !== null && (typeof modelId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/.test(modelId))) throw new TypeError('ZCODE_TUI_MODEL_INVALID')
  return { file: bundle.file, args: ['--print', '--output-format', 'json', '--permission-mode', mode === 'workspace-write' ? 'yolo' : 'plan',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disallowed-tools', 'AskUserQuestion EnterPlanMode ExitPlanMode',
    ...(modelId ? ['--model', modelId] : [])], format: 'claude-json', source: bundle.source, stdinTask: true, requestedModel: modelId,
    modelNotice: modelId ? null : '本次使用 ZCode TUI 已配置的默认模型。' }
}
