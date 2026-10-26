/** Resolve npm's embedded ZCode runtime without executing its bootstrap or trusting a ready marker. */
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { digestTarMembers, localFileDigest, npmAttestor } from './npm-attestation.mjs'
import { resolveStateHome } from './router-state.mjs'
import { isReleaseVersion } from './version-order.mjs'
import { extractZCodeArchive } from './zcode-installer.mjs'

export const ZCODE_NPM_PACKAGE = '@ljwei-stak/zcode-cli'
const PAYLOAD_FILE = 'payload/zcode-runtime.tar.gz'
const READY_FILE = '.zcode-npm-runtime.json'
const MAX_PAYLOAD_BYTES = 128 * 1024 * 1024
const MAX_RUNTIME_BYTES = 3_000_000_000
const MAX_RUNTIME_FILES = 60_000
const REQUIRED = ['package.json', 'bin/zcode.mjs', 'agent/zcode.cjs', 'server/entry-http.js', 'web/index.html']
const expectedCache = new Map()
const missing = error => error?.code === 'ENOENT'
const key = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
const within = (parent, child) => {
  const part = relative(parent, child)
  return part && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}
const fail = message => new Error(`ZCode CLI npm 核验失败：${message}；请修复所选 npm 安装后重试，不会改用 GitHub 或其他安装副本。`)

async function regularBytes(root, member, maximum, expected, signal) {
  const path = join(root, ...member.split('/'))
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) throw fail(`${member} 不是受限大小的普通文件`)
  if (key(await realpath(path)) !== key(path)) throw fail(`${member} 经过了目录链接`)
  const bytes = await readFile(path, { signal })
  if (bytes.length > maximum || !expected || expected.size !== bytes.length
    || expected.sha256 !== `sha256-${createHash('sha256').update(bytes).digest('base64')}`) throw fail(`${member} 与 npm registry 发行文件不符`)
  return bytes
}

async function expectedFiles(archive, digest) {
  if (expectedCache.has(digest)) return expectedCache.get(digest)
  const files = await digestTarMembers(Readable.from([archive]), { maxExpandedBytes: MAX_RUNTIME_BYTES, maxFiles: MAX_RUNTIME_FILES })
  let bytes = 0
  if (files.size > MAX_RUNTIME_FILES) throw fail('内嵌运行包文件过多')
  for (const [name, info] of files) {
    if (!name || /[\\:\x00-\x1f]/.test(name) || isAbsolute(name)
      || name.split('/').some(part => !part || part === '.' || part === '..')
      || name.split('/').length > 64 || !Number.isSafeInteger(info.size) || info.size < 0
      || (bytes += info.size) > MAX_RUNTIME_BYTES) throw fail('内嵌运行包路径或大小无效')
  }
  if (REQUIRED.some(name => !files.has(name)) || files.has(READY_FILE)) throw fail('内嵌运行包缺少完整运行资源')
  if (expectedCache.size >= 8) expectedCache.delete(expectedCache.keys().next().value)
  expectedCache.set(digest, files)
  return files
}

/** A marker never establishes code trust: every actual runtime file must match the embedded archive. */
async function checkedRuntime(root, expected, payload, signal) {
  const info = await lstat(root).catch(error => { if (missing(error)) return null; throw error })
  if (!info) return null
  if (!info.isDirectory() || info.isSymbolicLink() || key(await realpath(root)) !== key(root)) throw fail('运行目录不是独立的普通目录')
  const seen = new Set()
  let count = 0
  const walk = async (directory, prefix = '', depth = 0) => {
    if (depth > 64) throw fail('运行目录层级过深')
    for (const item of await readdir(directory, { withFileTypes: true })) {
      signal?.throwIfAborted()
      if (++count > MAX_RUNTIME_FILES * 2) throw fail('运行目录条目过多')
      const name = prefix ? `${prefix}/${item.name}` : item.name
      const path = join(directory, item.name)
      if (item.isSymbolicLink()) throw fail(`运行资源 ${name} 是链接`)
      if (item.isDirectory()) { await walk(path, name, depth + 1); continue }
      if (!item.isFile()) throw fail(`运行资源 ${name} 不是普通文件`)
      if (name === READY_FILE) {
        if ((await lstat(path)).size > 4096) throw fail('运行就绪标记无效')
        const marker = JSON.parse(await readFile(path, 'utf8'))
        if (marker.schemaVersion !== 1 || marker.version !== payload.version || marker.sha256 !== payload.sha256) throw fail('运行就绪标记与内嵌运行包不符')
        continue
      }
      const wanted = expected.get(name)
      if (!wanted) throw fail(`运行目录包含发行包之外的文件 ${name}`)
      const actual = await localFileDigest(path)
      if (actual.size !== wanted.size || actual.sha256 !== wanted.sha256) throw fail(`运行资源 ${name} 已改变`)
      seen.add(name)
    }
  }
  await walk(root)
  if (seen.size !== expected.size) throw fail('运行资源缺失')
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (metadata.name !== 'zcode-runtime' || metadata.version !== payload.version
    || String(metadata.bin?.zcode).replace(/^\.\//, '') !== 'bin/zcode.mjs') throw fail('运行包元数据与 payload 不符')
  return root
}

async function canonicalCache(directory) {
  if (!isAbsolute(directory) || resolve(directory) === dirname(resolve(directory))) throw fail('缓存目录必须为独立的绝对路径')
  const requested = resolve(directory)
  for (let cursor = requested;; cursor = dirname(cursor)) {
    const info = await lstat(cursor).catch(error => { if (missing(error)) return null; throw error })
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw fail('缓存路径不能经过目录链接或普通文件')
    if (cursor === dirname(cursor)) break
  }
  await mkdir(requested, { recursive: true })
  return realpath(requested)
}

async function prepareCachedRuntime(base, archive, expected, payload, signal) {
  const parent = await canonicalCache(base)
  const target = join(parent, `${payload.version}-${payload.sha256}`)
  const checkTarget = async () => {
    try { return await checkedRuntime(target, expected, payload, signal) }
    catch (error) {
      if (signal?.aborted) throw error
      throw new Error(`${error.message} 专用缓存位置：${target}；请保留新增文件后核对并清理此缓存。`)
    }
  }
  if (await checkTarget()) return target
  const stage = await mkdtemp(join(parent, '.zcode-npm-stage-'))
  if (!within(parent, stage)) throw fail('暂存目录离开缓存边界')
  try {
    await chmod(stage, 0o700)
    const archivePath = join(stage, 'payload.tar.gz'), prepared = join(stage, 'runtime')
    await writeFile(archivePath, archive, { flag: 'wx', mode: 0o600, signal })
    await extractZCodeArchive(archivePath, prepared, { signal })
    for (const name of ['bin/zcode.mjs', 'agent/zcode.cjs',
      'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper', 'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper']) {
      if (expected.has(name)) await chmod(join(prepared, ...name.split('/')), 0o755)
    }
    await writeFile(join(prepared, READY_FILE), `${JSON.stringify({ schemaVersion: 1, version: payload.version, sha256: payload.sha256 })}\n`, { flag: 'wx', mode: 0o600 })
    await checkedRuntime(prepared, expected, payload, signal)
    signal?.throwIfAborted()
    // Accept a concurrent winner only after the same complete verification.
    if (await checkTarget()) return target
    try { await rename(prepared, target) }
    catch (error) { if (!(await checkTarget())) throw error }
    return await checkTarget()
  } finally {
    if (within(parent, stage)) await rm(stage, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

async function resolveBundle(found, {
  env = process.env, platform = process.platform, home = homedir(), attestor = npmAttestor,
  cacheRoot = join(resolveStateHome(env, home), 'model-router', 'zcode-npm'), signal,
} = {}) {
  if (!found || !isAbsolute(found.packageRoot ?? '') || !isReleaseVersion(found.version)) throw fail('所选 npm 包位置或版本无效')
  const packageRoot = await realpath(found.packageRoot)
  const canonicalEntry = await realpath(found.entry)
  if (key(canonicalEntry) !== key(join(packageRoot, 'bin', 'zcode.mjs'))) throw fail('所选 npm 命令入口离开固定 bin 路径')
  const attested = await attestor.attestPackage(ZCODE_NPM_PACKAGE, found.version)
  const manifestBytes = await regularBytes(packageRoot, 'package.json', 1_000_000, attested.files?.['package.json'], signal)
  const metadata = JSON.parse(manifestBytes.toString('utf8'))
  if (metadata.name !== ZCODE_NPM_PACKAGE || metadata.version !== found.version
    || String(metadata.bin?.zcode).replace(/^\.\//, '') !== 'bin/zcode.mjs') throw fail('npm 包名、版本或 bin 映射无效')
  await regularBytes(packageRoot, 'bin/zcode.mjs', 4_000_000, attested.files?.['bin/zcode.mjs'], signal)
  const payload = JSON.parse((await regularBytes(packageRoot, 'payload.json', 1_000_000, attested.files?.['payload.json'], signal)).toString('utf8'))
  if (payload.schemaVersion !== 1 || payload.file !== PAYLOAD_FILE || !isReleaseVersion(payload.version)
    || !/^[a-f0-9]{64}$/.test(payload.sha256 ?? '') || metadata.zcodeRuntime?.version !== payload.version
    || metadata.zcodeRuntime?.sha256 !== payload.sha256) throw fail('payload 清单与已发布 npm 元数据不符')
  const archive = await regularBytes(packageRoot, PAYLOAD_FILE, MAX_PAYLOAD_BYTES, attested.files?.[PAYLOAD_FILE], signal)
  if (createHash('sha256').update(archive).digest('hex') !== payload.sha256) throw fail('内嵌运行包 SHA256 不符')
  const expected = await expectedFiles(archive, payload.sha256)
  const packageRuntime = join(packageRoot, 'runtime')
  const root = await checkedRuntime(packageRuntime, expected, payload, signal)
    ?? await prepareCachedRuntime(cacheRoot, archive, expected, payload, signal)
  return Object.freeze({ root, cliEntry: join(root, 'bin', 'zcode.mjs'), version: payload.version,
    packageVersion: found.version, source: 'npm-registry-sha256', archiveSha256: payload.sha256, packageRoot })
}

/** The selected npm package is authoritative; this resolver has no download or archive-install fallback. */
export async function resolveZCodeNpmBundle(found, options = {}) {
  try {
    return await resolveBundle(found, options)
  } catch (error) {
    if (options.signal?.aborted || String(error?.message).startsWith('ZCode CLI npm 核验失败：')) throw error
    throw fail(String(error?.message ?? error))
  }
}
