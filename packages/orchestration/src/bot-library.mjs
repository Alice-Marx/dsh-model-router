/**
 * A Bot's own library: a private directory of files that belongs to one Bot.
 *
 * This is the smallest honest version of the "library" a Bot needs — a place to keep notes,
 * references and artifacts that is not the workspace it shares with people. Three rules:
 *
 *  - a Bot only ever sees its own directory; the id is validated and never concatenated blindly;
 *  - every path resolves inside that directory after symlinks, so `..` or a link cannot escape;
 *  - reads and writes are bounded, so one file cannot exhaust memory or the disk.
 *
 * Callers inject the filesystem, which keeps the module testable and keeps the Host in charge of
 * where the directories actually live.
 */

import { dirname, extname, join, resolve, sep } from 'node:path'

const MAX_FILE_BYTES = 1024 * 1024
export const MAX_LIBRARY_UPLOAD_BYTES = 16 * 1024 * 1024
const MAX_LIST_ENTRIES = 500
const BOT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

const fail = (code, message) => { const error = new Error(message ?? code); error.code = code; throw error }

/** A relative path with no escape, no absolute root, no control characters. */
function cleanRelative(relativePath) {
  const raw = String(relativePath ?? '').trim()
  if (raw === '') return ''
  if (/[\u0000-\u001f]/u.test(raw)) fail('LIBRARY_PATH_INVALID', '路径含控制字符。')
  if (/^[\\/]/u.test(raw) || raw.includes(':')) fail('LIBRARY_PATH_INVALID', '只能使用相对路径。')
  const parts = raw.split(/[\\/]+/u).filter(part => part !== '' && part !== '.')
  if (parts.some(part => part === '..')) fail('LIBRARY_PATH_INVALID', '路径不能跳出所在目录。')
  if (parts.some(part => /[. ]$/u.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(part))) fail('LIBRARY_PATH_INVALID')
  return parts.join(sep)
}

export function createBotLibrary({ root, fs } = {}) {
  if (typeof root !== 'string' || root === '') throw new TypeError('LIBRARY_REQUIRE_ROOT')
  if (!fs || typeof fs.readFileSync !== 'function' || typeof fs.readdirSync !== 'function') throw new TypeError('LIBRARY_REQUIRE_FS')
  const base = resolve(root)

  const dirFor = botId => {
    if (typeof botId !== 'string' || !BOT_ID.test(botId) || /[. ]$/u.test(botId)) fail('LIBRARY_BOT_ID_INVALID')
    const dir = join(base, botId)
    // The resolved path must stay under the base even if the id looked harmless.
    if (resolve(dir) !== resolve(join(base, botId)) || !resolve(dir).startsWith(resolve(base) + sep)) fail('LIBRARY_BOT_ID_INVALID')
    return dir
  }

  /** Resolve a relative path inside one Bot's directory, following links before deciding. */
  const resolveInside = (botId, relativePath) => {
    const dir = dirFor(botId)
    const relative = cleanRelative(relativePath)
    const target = resolve(join(dir, relative))
    if (target !== dir && !target.startsWith(dir + sep)) fail('LIBRARY_PATH_ESCAPE')
    // A link inside the directory may point outside it: check what the path really is.
    ensureDir(base)
    const realBase = fs.realpathSync(base)
    if (fs.existsSync(dir) && fs.realpathSync(dir) !== join(realBase, botId)) fail('LIBRARY_PATH_ESCAPE')
    let ancestor = target
    while (!fs.existsSync(ancestor)) {
      const parent = dirname(ancestor)
      if (parent === ancestor) fail('LIBRARY_PATH_ESCAPE')
      ancestor = parent
    }
    const realAncestor = fs.realpathSync(ancestor)
    const realDir = join(realBase, botId)
    if (ancestor !== base && realAncestor !== realDir && !realAncestor.startsWith(realDir + sep)) fail('LIBRARY_PATH_ESCAPE')
    return { dir, target, relative }
  }

  const ensureDir = dir => {
    if (typeof fs.mkdirSync !== 'function') return
    fs.mkdirSync(dir, { recursive: true })
  }

  return Object.freeze({
    /** Entries of one directory, bounded, with type and size but never file contents. */
    list(botId, relativePath = '') {
      const { dir, target } = resolveInside(botId, relativePath)
      ensureDir(dir)
      let entries
      try { entries = fs.readdirSync(target, { withFileTypes: true }) } catch (error) {
        if (error?.code === 'ENOENT') return []
        if (error?.code === 'LIBRARY_PATH_ESCAPE') throw error
        fail('LIBRARY_LIST_FAILED', String(error?.message ?? error))
      }
      return entries.slice(0, MAX_LIST_ENTRIES).map(entry => {
        const size = entry.isFile() ? (() => { try { return fs.statSync(join(target, entry.name)).size } catch { return null } })() : null
        return { name: entry.name, kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other', size, mediaType: mediaType(entry.name) }
      }).sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name))
    },

    /** Read one file as UTF-8, refusing anything over the bound. */
    read(botId, relativePath) {
      const { target } = resolveInside(botId, relativePath)
      if (!relativePath) fail('LIBRARY_PATH_INVALID', '请指定文件。')
      let stat
      try { stat = fs.statSync(target) } catch { fail('LIBRARY_NOT_FOUND') }
      if (!stat.isFile()) fail('LIBRARY_NOT_A_FILE')
      if (stat.size > MAX_FILE_BYTES) fail('LIBRARY_FILE_TOO_LARGE', `文件超过 ${MAX_FILE_BYTES} 字节。`)
      return fs.readFileSync(target, 'utf8')
    },

    /** Write one file, creating its parent directories; the content is bounded before it is read. */
    write(botId, relativePath, content) {
      if (!relativePath) fail('LIBRARY_PATH_INVALID', '请指定文件。')
      const text = String(content ?? '')
      const bytes = Buffer.byteLength(text)
      if (bytes > MAX_FILE_BYTES) fail('LIBRARY_FILE_TOO_LARGE', `文件超过 ${MAX_FILE_BYTES} 字节。`)
      const { target, dir } = resolveInside(botId, relativePath)
      ensureDir(dir)
      if (typeof fs.mkdirSync === 'function') fs.mkdirSync(dirnameOf(target), { recursive: true })
      fs.writeFileSync(target, text)
      return { bytes }
    },

    upload(botId, relativePath, contentBase64, overwrite = false) {
      if (!relativePath || typeof contentBase64 !== 'string' || contentBase64.length > Math.ceil(MAX_LIBRARY_UPLOAD_BYTES / 3) * 4
        || contentBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(contentBase64)) fail('LIBRARY_UPLOAD_INVALID')
      const bytes = Buffer.from(contentBase64, 'base64')
      if (bytes.toString('base64') !== contentBase64) fail('LIBRARY_UPLOAD_INVALID')
      if (bytes.length > MAX_LIBRARY_UPLOAD_BYTES) fail('LIBRARY_FILE_TOO_LARGE')
      const { target } = resolveInside(botId, relativePath)
      ensureDir(dirname(target))
      try { fs.writeFileSync(target, bytes, { flag: overwrite === true ? 'w' : 'wx' }) }
      catch (error) { if (error?.code === 'EEXIST') fail('LIBRARY_FILE_EXISTS', '同名文件已存在。'); throw error }
      return { bytes: bytes.length, mediaType: mediaType(relativePath) }
    },

    download(botId, relativePath) {
      if (!relativePath) fail('LIBRARY_PATH_INVALID')
      const { target } = resolveInside(botId, relativePath)
      let stat
      try { stat = fs.statSync(target) } catch { fail('LIBRARY_NOT_FOUND') }
      if (!stat.isFile()) fail('LIBRARY_NOT_A_FILE')
      if (stat.size > MAX_LIBRARY_UPLOAD_BYTES) fail('LIBRARY_FILE_TOO_LARGE')
      return { contentBase64: fs.readFileSync(target).toString('base64'), bytes: stat.size, mediaType: mediaType(relativePath) }
    },

    mkdir(botId, relativePath) {
      if (!relativePath) fail('LIBRARY_PATH_INVALID')
      const { target } = resolveInside(botId, relativePath)
      ensureDir(target)
      return { created: true }
    },

    search(botId, query) {
      if (typeof query !== 'string' || !query.trim() || query.length > 256) fail('LIBRARY_QUERY_INVALID')
      const needle = query.trim().toLocaleLowerCase(), results = []
      let visited = 0
      const visit = (relativePath, depth = 0) => {
        if (depth > 8 || results.length >= 50 || visited >= 500) return
        for (const entry of this.list(botId, relativePath)) {
          if (++visited > 500) break
          const path = relativePath ? `${relativePath}/${entry.name}` : entry.name
          if (entry.kind === 'directory') { visit(path, depth + 1); continue }
          if (entry.kind !== 'file' || entry.size > MAX_FILE_BYTES || !isTextFile(entry.name)) continue
          const lines = this.read(botId, path).split(/\r?\n/u)
          for (let line = 0; line < lines.length && results.length < 50; line++) {
            if (lines[line].toLocaleLowerCase().includes(needle)) results.push({ path, line: line + 1, text: lines[line].slice(0, 600) })
          }
        }
      }
      visit('')
      return results
    },

    remove(botId, relativePath) {
      if (!relativePath) fail('LIBRARY_PATH_INVALID', '请指定文件。')
      const { target } = resolveInside(botId, relativePath)
      if (typeof fs.rmSync !== 'function') fail('LIBRARY_REMOVE_UNSUPPORTED')
      fs.rmSync(target, { force: true })
      return { removed: true }
    },

    /** Where this Bot's library lives, for a panel that wants to show it. */
    dirOf(botId) { return dirFor(botId) },
  })
}

function dirnameOf(path) {
  const index = Math.max(path.lastIndexOf(sep), path.lastIndexOf('/'))
  return index <= 0 ? path : path.slice(0, index)
}

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.yaml', '.yml', '.xml', '.html', '.log', '.js', '.mjs', '.ts', '.py'])
export const isTextFile = name => TEXT_EXTENSIONS.has(extname(name).toLowerCase()) || extname(name) === ''
function mediaType(name) {
  const ext = extname(name).toLowerCase()
  return ({ '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.json': 'application/json' })[ext]
    ?? (isTextFile(name) ? 'text/plain;charset=utf-8' : 'application/octet-stream')
}
