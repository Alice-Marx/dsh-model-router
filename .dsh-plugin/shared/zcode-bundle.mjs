/** Standalone ZCode CLI discovery. Desktop executables and Electron bundles are never used. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { resolveStateHome } from './router-state.mjs'

export const ZCODE_MARKER = '.model-router-zcode.json'
export const ZCODE_REPOSITORY = 'Alice-Marx/zcode-cli'
export const ZCODE_REQUIRED_NODE = '24.14.0'

export function zcodeTrustPath(env = process.env) {
  return join(resolveStateHome(env), 'model-router', 'zcode-cli-attestations.json')
}

export function zcodeRootKey(root) {
  const value = resolve(root)
  return process.platform === 'win32' ? value.toLowerCase() : value
}

export function zcodeWithin(root, child) {
  const part = relative(root, child)
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

export async function zcodeFileDigest(path) {
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of createReadStream(path)) { hash.update(chunk); size += chunk.length }
  return { sha256: hash.digest('hex'), size }
}

/** Runtime trees deliberately contain only regular files and directories, never links. */
export async function zcodeTreeFiles(root) {
  const files = {}
  const walk = async (directory, prefix = '') => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name
      if (!prefix && entry.name === ZCODE_MARKER) continue
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`ZCode CLI 运行目录含目录联接或符号链接：${name}`)
      if (entry.isDirectory()) await walk(path, name)
      else if (entry.isFile()) files[name] = await zcodeFileDigest(path)
      else throw new Error(`ZCode CLI 运行目录含不支持的文件：${name}`)
    }
  }
  await walk(root)
  return files
}

export async function recordZCodeInstall({ root, version, archiveSha256, files, trustPath = zcodeTrustPath() }) {
  let entries = {}
  try { entries = JSON.parse(await readFile(trustPath, 'utf8')).entries ?? {} } catch { /* empty */ }
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) entries = {}
  entries[zcodeRootKey(root)] = { version, archiveSha256, files }
  await mkdir(dirname(trustPath), { recursive: true })
  const temporary = `${trustPath}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify({ version: 1, entries })}\n`, { mode: 0o600 })
  await rename(temporary, trustPath)
}

export async function discoverZCodeBundle({ installDir = '', env = process.env, home = homedir(), trustPath = zcodeTrustPath(env), onRejected } = {}) {
  const input = installDir || join(home, '.zcode', 'runtime')
  try {
    if (!isAbsolute(input) || resolve(input) === dirname(resolve(input))) return null
    const info = await lstat(input)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('ZCode CLI 安装目录不能是目录联接或符号链接。')
    const root = await realpath(input)
    const marker = JSON.parse(await readFile(join(root, ZCODE_MARKER), 'utf8'))
    const saved = JSON.parse(await readFile(trustPath, 'utf8')).entries?.[zcodeRootKey(root)]
    if (marker.repository !== ZCODE_REPOSITORY || !/^\d+\.\d+\.\d+$/.test(marker.version ?? '')
      || !/^[a-f0-9]{64}$/.test(marker.archiveSha256 ?? '') || marker.version !== saved?.version
      || marker.archiveSha256 !== saved?.archiveSha256 || !saved.files || typeof saved.files !== 'object') {
      throw new Error('ZCode CLI 未找到经过 GitHub Release SHA256 校验的安装记录，请从官方工具重新安装。')
    }
    const actual = await zcodeTreeFiles(root)
    const names = Object.keys(actual)
    if (names.length !== Object.keys(saved.files).length || names.some(name => actual[name].sha256 !== saved.files[name]?.sha256 || actual[name].size !== saved.files[name]?.size)) {
      throw new Error('ZCode CLI 文件与已校验发行包不同，请修复安装。')
    }
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    if (pkg.name !== 'zcode-runtime' || pkg.version !== marker.version || pkg.bin?.zcode !== './bin/zcode.mjs') throw new Error('ZCode CLI 发行包元数据不匹配。')
    for (const name of ['bin/zcode.mjs', 'agent/zcode.cjs']) if (!actual[name]) throw new Error(`ZCode CLI 发行包缺少 ${name}。`)
    return Object.freeze({ id: 'zcode', root, version: marker.version, buildVersion: marker.version,
      cliEntry: join(root, 'bin', 'zcode.mjs'), agentEntry: join(root, 'agent', 'zcode.cjs'),
      cliSha256: actual['bin/zcode.mjs'].sha256, archiveSha256: marker.archiveSha256,
      source: 'github-release-sha256', repository: ZCODE_REPOSITORY })
  } catch (error) {
    if (error?.code !== 'ENOENT') onRejected?.({ root: input, rejected: String(error?.message ?? error) })
    return null
  }
}
