/** Preserve narrowly identified pre-npm desktop launchers before linking ZCode CLI. */
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'

const NAMES = ['zcode', 'zcode.cmd', 'zcode.ps1']
const MAX_SHIM_BYTES = 16_384
const absent = error => error?.code === 'ENOENT'
const key = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const inside = (root, path) => {
  const part = relative(root, path)
  return part && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)
}

function desktopEntry(path, shell = false) {
  if (/[$`%!&;()^]/.test(path)) return null
  if (shell) {
    const match = /^\/([a-z])\/(.+)$/i.exec(path)
    if (!match) return null
    path = `${match[1]}:\\${match[2].replaceAll('/', '\\')}`
  }
  // The old launchers name the Windows desktop's fixed bundled GLM entry.
  // No relative path, traversal, alternate stream or unrelated zcode.cjs qualifies.
  if (!/^[a-z]:\\(?:[^<>:"|?*\x00-\x1f\\]+\\)*ZCode\\resources\\glm\\zcode\.cjs$/i.test(path)
    || path.split('\\').some(part => part === '.' || part === '..')) return null
  return win32.normalize(path).toLowerCase()
}

/** Only the complete three observed handwritten templates qualify; npm shims do not. */
export function legacyZCodeDesktopShim(name, bytes) {
  if (!NAMES.includes(name) || bytes.length > MAX_SHIM_BYTES) return null
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (name === 'zcode') {
    const match = /^#!\/bin\/sh\nexec node "([^"\n]+)" "\$@"\n?$/.exec(text)
    return match ? desktopEntry(match[1], true) : null
  }
  if (name === 'zcode.cmd') {
    const match = /^@echo off\nnode "([^"\n]+)" %\*\n?$/i.exec(text)
    return match ? desktopEntry(match[1]) : null
  }
  const match = /^#!\/usr\/bin\/env pwsh\n\$ret[ \t]*=[ \t]*0\nif \(\$MyInvocation\.ExpectingInput\) \{\n[ \t]*\$input \| & node "([^"\n]+)" \$args\n\} else \{\n[ \t]*& node "\1" \$args\n\}\n\$ret[ \t]*=[ \t]*\$LASTEXITCODE\nexit \$ret\n?$/i.exec(text)
  return match ? desktopEntry(match[1]) : null
}

async function canonicalPrefix(prefix) {
  if (typeof prefix !== 'string' || !isAbsolute(prefix) || resolve(prefix) === dirname(resolve(prefix))) {
    throw new Error('ZCode CLI npm 前缀必须是独立的绝对目录。')
  }
  const requested = resolve(prefix)
  const checkAncestors = async () => {
    for (let path = requested;; path = dirname(path)) {
      const info = await lstat(path).catch(error => { if (absent(error)) return null; throw error })
      if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error('ZCode CLI npm 前缀不能经过目录联接、符号链接或普通文件。')
      if (path === dirname(path)) break
    }
  }
  await checkAncestors()
  await mkdir(requested, { recursive: true })
  await checkAncestors()
  // DOS 8.3 aliases and case differences are allowed after the actual ancestors pass lstat.
  return realpath(requested)
}

/**
 * Only Windows desktop wrappers are moved. Existing npm shims and unrelated files
 * are never overwritten, removed or executed. Backups survive successful installs.
 */
export async function prepareZCodeNpmShims({ prefix, platform = process.platform, signal } = {}) {
  const backups = [], skipped = []
  let backupDir = null, root = null
  const restoreMissing = async () => {
    const restored = [], preserved = []
    if (backups.length && key(await canonicalPrefix(root)) !== key(root)) throw new Error('ZCode CLI npm 前缀已变化，停止自动恢复；请核对启动器备份。')
    for (const item of backups) {
      if (await lstat(item.original).catch(error => { if (absent(error)) return null; throw error })) {
        preserved.push(item.name)
        continue
      }
      const info = await lstat(item.backup)
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SHIM_BYTES || key(await realpath(item.backup)) !== key(item.backup)
        || digest(await readFile(item.backup)) !== item.sha256) throw new Error(`ZCode CLI 启动器备份已变化，请人工核对：${item.backup}`)
      try {
        // Exclusive creation is atomic: a newly written npm/user file always wins.
        await copyFile(item.backup, item.original, constants.COPYFILE_EXCL)
        restored.push(item.name)
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        preserved.push(item.name)
      }
    }
    return { restored, preserved, backupDir }
  }
  const transaction = { backups, skipped, get backupDir() { return backupDir }, restoreMissing }
  if (platform !== 'win32') return transaction
  root = await canonicalPrefix(prefix)
  const candidates = [], blocked = []
  for (const name of NAMES) {
    signal?.throwIfAborted()
    const original = join(root, name)
    const info = await lstat(original).catch(error => { if (absent(error)) return null; throw error })
    if (!info) continue
    if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1
      || key(await realpath(original)) !== key(original)) { blocked.push(name); continue }
    if (info.size > MAX_SHIM_BYTES) { skipped.push(name); continue }
    const bytes = await readFile(original)
    const target = legacyZCodeDesktopShim(name, bytes)
    if (!target) { skipped.push(name); continue }
    candidates.push({ name, original, bytes, target, sha256: digest(bytes), mode: info.mode })
  }
  if (blocked.length) throw new Error(`ZCode CLI npm 命令位置含链接或非普通文件（${blocked.join('、')}）；已保留全部文件，请先核对。`)
  if (!candidates.length) return transaction
  if (skipped.length) throw new Error(`ZCode CLI npm 命令位置还存在无法识别的文件或链接（${skipped.join('、')}）；已保留全部文件，请核对后重试，插件不会使用 --force。`)
  if (new Set(candidates.map(item => item.target)).size !== 1) throw new Error('ZCode CLI 旧启动器指向不同桌面安装，已保留全部文件，请先核对。')
  signal?.throwIfAborted()
  backupDir = await mkdtemp(join(root, '.zcode-legacy-shims-'))
  if (!inside(root, backupDir) || key(await realpath(backupDir)) !== key(backupDir)) throw new Error('ZCode CLI 备份目录离开了 npm 前缀。')
  await writeFile(join(backupDir, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1, owner: 'dsh-model-router', kind: 'zcode-desktop-shims', createdAt: new Date().toISOString(),
    desktopEntry: candidates[0].target,
    files: candidates.map(({ name, sha256, bytes, mode }) => ({ name, sha256, size: bytes.length, mode })),
  }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  try {
    for (const item of candidates) {
      signal?.throwIfAborted()
      const current = await lstat(item.original)
      if (!current.isFile() || current.isSymbolicLink() || current.size > MAX_SHIM_BYTES
        || digest(await readFile(item.original)) !== item.sha256) throw new Error(`旧启动器 ${item.name} 在备份前已改变，已停止安装。`)
      const backup = join(backupDir, item.name)
      await rename(item.original, backup)
      backups.push({ name: item.name, original: item.original, backup, sha256: item.sha256 })
      if (digest(await readFile(backup)) !== item.sha256) throw new Error(`旧启动器 ${item.name} 在移动时已改变，已停止安装。`)
    }
    return transaction
  } catch (error) {
    await restoreMissing()
    throw new Error(`${error.message} 旧启动器备份保留于 ${backupDir}`, { cause: error })
  }
}
