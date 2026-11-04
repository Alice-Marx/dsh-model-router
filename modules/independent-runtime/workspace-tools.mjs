/**
 * A small, confined tool set for the independent Bot runtime.
 *
 * The loop can answer without tools; this module gives it hands without giving it the machine:
 * every path is relative to one workspace root, resolved with `realpath`, and re-checked after the
 * write. Reads and writes are bounded. There is no shell here on purpose — a shell needs the
 * machine ceiling, which the Bot's grant and the remote agent own, not this adapter.
 */

import { mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const MAX_READ_BYTES = 1_000_000
export const MAX_WRITE_BYTES = 1_000_000
export const DEFAULT_LIST_LIMIT = 200

const fail = (code, message) => { const error = new Error(message ?? code); error.code = code; throw error }

/** Reject anything that could address a path outside the root, before touching the disk. */
export function resolveInside(root, relativePath) {
  if (typeof relativePath !== 'string' || relativePath === '' || relativePath.includes('\0')) fail('INVALID_PATH')
  if (isAbsolute(relativePath)) fail('PATH_ABSOLUTE')
  const target = resolve(root, relativePath)
  const rootResolved = resolve(root)
  if (target !== rootResolved && !target.startsWith(rootResolved + sep)) fail('PATH_OUTSIDE_ROOT')
  return target
}

/** After resolution, a symlink could still point outside; compare the real paths. */
function assertRealInside(root, target) {
  const realRoot = realpathSync(root)
  let realTarget
  try { realTarget = realpathSync(target) } catch (error) {
    if (error?.code === 'ENOENT') return // a new file: its parent was already checked
    throw error
  }
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) fail('PATH_OUTSIDE_ROOT')
}

/**
 * @param {{ root: string, origin?: string }} options
 */
export function createWorkspaceTools({ root, origin = '本机工作区' } = {}) {
  if (typeof root !== 'string' || root === '') throw new TypeError('WORKSPACE_ROOT_REQUIRED')
  mkdirSync(root, { recursive: true })
  const base = resolve(root)

  const list = ({ path = '.', limit = DEFAULT_LIST_LIMIT } = {}) => {
    const target = resolveInside(base, path)
    assertRealInside(base, target)
    const info = statSync(target)
    if (!info.isDirectory()) fail('NOT_A_DIRECTORY')
    const entries = []
    for (const name of readdirSync(target).sort()) {
      if (entries.length >= Math.min(Math.max(1, limit), DEFAULT_LIST_LIMIT)) break
      entries.push(name)
    }
    return { path, entries, origin: base }
  }

  const read = ({ path, maxBytes = MAX_READ_BYTES } = {}) => {
    const target = resolveInside(base, path)
    assertRealInside(base, target)
    const info = statSync(target)
    if (!info.isFile()) fail('NOT_A_FILE')
    if (info.size > Math.min(Math.max(1, maxBytes), MAX_READ_BYTES)) fail('FILE_TOO_LARGE')
    return { path, content: readFileSync(target, 'utf8'), bytes: info.size }
  }

  const write = ({ path, content, createOnly = false } = {}) => {
    if (typeof content !== 'string') fail('INVALID_CONTENT')
    if (Buffer.byteLength(content) > MAX_WRITE_BYTES) fail('CONTENT_TOO_LARGE')
    const target = resolveInside(base, path)
    assertRealInside(base, target)
    if (createOnly) {
      try { statSync(target); fail('FILE_EXISTS') } catch (error) { if (error?.code !== 'ENOENT') throw error }
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
    const info = statSync(target)
    return { path, bytes: info.size, created: !createOnly }
  }

  return Object.freeze({
    names: ['fs_list', 'fs_read', 'fs_write', 'workspace_info'],
    origin,
    async call(name, args = {}) {
      if (name === 'fs_list') return list(args)
      if (name === 'fs_read') return read(args)
      if (name === 'fs_write') return write(args)
      if (name === 'workspace_info') return { root: base, origin, tools: ['fs_list', 'fs_read', 'fs_write'], maxReadBytes: MAX_READ_BYTES, maxWriteBytes: MAX_WRITE_BYTES }
      fail('TOOL_NOT_FOUND')
    },
  })
}

