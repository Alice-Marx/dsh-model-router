/** Install the complete standalone runtime from a fixed GitHub Release, never Electron. */
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { ZCODE_MARKER, ZCODE_REPOSITORY, recordZCodeInstall, zcodeFileDigest, zcodeRootKey, zcodeTreeFiles, zcodeTrustPath, zcodeWithin } from './zcode-bundle.mjs'

const MAX_DOWNLOAD_BYTES = 1_000_000_000
const MAX_EXTRACT_BYTES = 3_000_000_000
const MAX_FILES = 60_000
const ASSET_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'])

/** Only matching tarballs and checksum files from this repository can be downloaded. */
export function zcodeInstallerRelease(latest) {
  const version = String(latest?.version ?? '')
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null
  const pattern = new RegExp(`^https://github\\.com/Alice-Marx/zcode-cli/releases/download/(v?${version.replaceAll('.', '\\.')})/zcode-${version.replaceAll('.', '\\.') }\\.tar\\.gz$`)
  const match = pattern.exec(String(latest?.url ?? ''))
  if (!match) return null
  const sha256Url = `https://github.com/Alice-Marx/zcode-cli/releases/download/${match[1]}/sha256.txt`
  if (latest.sha256Url && latest.sha256Url !== sha256Url) return null
  return { version, url: latest.url, sha256Url, fileName: `zcode-${version}.tar.gz` }
}

async function responseFor(url, { fetchImpl, signal }) {
  let current = new URL(url)
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (current.protocol !== 'https:' || !ASSET_HOSTS.has(current.hostname) || current.username || current.password) throw new Error('ZCode CLI 下载重定向离开了 GitHub HTTPS 资源域名。')
    const response = await fetchImpl(current.toString(), { redirect: 'manual', signal })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.get?.('location')
      await response.body?.cancel?.()
      if (!location || redirects === 5) throw new Error('ZCode CLI 下载重定向过多。')
      current = new URL(location, current)
      continue
    }
    if (!response.ok) throw new Error(`ZCode CLI 下载失败：HTTP ${response.status}。`)
    return response
  }
}

export function parseZCodeChecksum(text, fileName) {
  const matches = String(text ?? '').trim().split(/\r?\n/).map(line => /^([a-fA-F0-9]{64})\s+\*?([^\s]+)$/.exec(line)).filter(match => match?.[2] === fileName)
  if (matches.length !== 1) throw new Error('ZCode CLI SHA256 文件缺少唯一的运行包摘要。')
  return matches[0][1].toLowerCase()
}

function memberPath(name) {
  if (/[\\:\x00-\x1f]/.test(name) || !name.startsWith('zcode/')) throw new Error('ZCode CLI 运行包包含不安全路径。')
  const relative = name.slice(6).replace(/\/$/, '')
  if (relative.split('/').some(part => part === '..' || part === '.' || part === '')) {
    if (!relative) return ''
    throw new Error('ZCode CLI 运行包包含不安全路径。')
  }
  // Avoid Windows device and alternate-stream aliases even while testing on Unix.
  if (relative.split('/').some(part => /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(part))) throw new Error('ZCode CLI 运行包包含不安全文件名。')
  return relative
}

function headerField(header, start, length) {
  const bytes = header.subarray(start, start + length)
  const end = bytes.indexOf(0)
  return bytes.subarray(0, end < 0 ? length : end).toString('utf8')
}

function paxName(body) {
  let offset = 0, path = null
  while (offset < body.length) {
    const space = body.indexOf(32, offset)
    const size = Number(body.subarray(offset, space).toString())
    if (space < offset || !Number.isSafeInteger(size) || size <= space - offset + 1 || offset + size > body.length) throw new Error('ZCode CLI tar PAX 元数据无效。')
    const record = body.subarray(space + 1, offset + size - 1).toString('utf8')
    if (record.startsWith('path=')) path = record.slice(5)
    if (/^(?:linkpath|size)=/.test(record)) throw new Error('ZCode CLI tar PAX 不允许链接或大小覆盖。')
    offset += size
  }
  return path
}

/** Streaming tar extraction: checks checksums, sizes, paths and forbids links/devices. */
export async function extractZCodeArchive(archive, destination, { signal } = {}) {
  await mkdir(destination, { recursive: false })
  const input = createReadStream(archive)
  const stream = input.pipe(createGunzip())
  input.on('error', error => stream.destroy(error))
  let pending = Buffer.alloc(0), state = null, nextName = null, expanded = 0, count = 0, ended = false
  const names = new Set()
  let activeFile
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted()
      expanded += chunk.length
      if (expanded > MAX_EXTRACT_BYTES) throw new Error('ZCode CLI 解压大小超出限制。')
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
      for (;;) {
        if (ended) break
        if (!state) {
          if (pending.length < 512) break
          const header = pending.subarray(0, 512); pending = pending.subarray(512)
          if (header.every(byte => byte === 0)) { ended = true; break }
          const sum = [...header].reduce((total, value, index) => total + (index >= 148 && index < 156 ? 32 : value), 0)
          if (sum !== Number.parseInt(headerField(header, 148, 8).trim(), 8)) throw new Error('ZCode CLI tar 头校验失败。')
          const sizeText = headerField(header, 124, 12).trim()
          if (!/^[0-7]+$/.test(sizeText)) throw new Error('ZCode CLI tar 大小无效。')
          const size = Number.parseInt(sizeText, 8)
          if (!Number.isSafeInteger(size) || size > MAX_DOWNLOAD_BYTES) throw new Error('ZCode CLI tar 文件超出限制。')
          const type = String.fromCharCode(header[156] || 48)
          let name = headerField(header, 0, 100)
          const prefix = headerField(header, 345, 155)
          if (prefix && headerField(header, 257, 6).startsWith('ustar')) name = `${prefix}/${name}`
          name = nextName ?? name; nextName = null
          state = { remaining: size, skip: (512 - size % 512) % 512, type, parts: [] }
          if (['x', 'g', 'L'].includes(type)) {
            if (size > 1_000_000) throw new Error('ZCode CLI tar 元数据超出限制。')
          } else {
            if (!['0', '5'].includes(type)) throw new Error('ZCode CLI 运行包不允许链接或特殊文件。')
            const relative = memberPath(name)
            if (!relative && type !== '5') throw new Error('ZCode CLI tar 根目录无效。')
            if (relative) {
              const key = process.platform === 'win32' ? relative.toLowerCase() : relative
              if (names.has(key)) throw new Error('ZCode CLI tar 包含重复路径。')
              names.add(key)
              if (++count > MAX_FILES) throw new Error('ZCode CLI 运行包文件过多。')
              const target = join(destination, ...relative.split('/'))
              if (!zcodeWithin(destination, target)) throw new Error('ZCode CLI tar 路径离开目标目录。')
              if (type === '5') await mkdir(target, { recursive: true })
              else {
                await mkdir(dirname(target), { recursive: true })
                activeFile = await open(target, 'wx', Number.parseInt(headerField(header, 100, 8).trim() || '644', 8) & 0o777)
                state.file = activeFile
              }
            }
            if (type === '5' && size !== 0) throw new Error('ZCode CLI tar 目录带有无效数据。')
          }
        }
        if (state.remaining > 0) {
          if (!pending.length) break
          const take = Math.min(pending.length, state.remaining)
          const piece = pending.subarray(0, take); pending = pending.subarray(take); state.remaining -= take
          if (state.file) await state.file.writeFile(piece)
          else if (['x', 'g', 'L'].includes(state.type)) state.parts.push(Buffer.from(piece))
          if (state.remaining > 0) break
        }
        if (state.file) { await state.file.close(); activeFile = null; state.file = null }
        if (state.parts) {
          if (state.type === 'L') nextName = Buffer.concat(state.parts).toString().replace(/\0+$/, '')
          if (state.type === 'x') nextName = paxName(Buffer.concat(state.parts))
          if (state.type === 'g' && paxName(Buffer.concat(state.parts))) throw new Error('ZCode CLI tar 不支持全局路径覆盖。')
          state.parts = null
        }
        const skip = Math.min(pending.length, state.skip); pending = pending.subarray(skip); state.skip -= skip
        if (state.skip > 0) break
        state = null
      }
    }
    if (!ended || state?.remaining > 0) throw new Error('ZCode CLI 运行包不完整。')
  } finally {
    await activeFile?.close().catch(() => {})
    input.destroy()
    stream.destroy()
  }
}

async function ownedRuntime(root, trustPath) {
  const info = await lstat(root).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  if (!info) return null
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('ZCode CLI 目标不是独立目录，已停止操作。')
  const canonical = await realpath(root)
  const marker = JSON.parse(await readFile(join(canonical, ZCODE_MARKER), 'utf8').catch(() => '{}'))
  const record = JSON.parse(await readFile(trustPath, 'utf8').catch(() => '{}')).entries?.[zcodeRootKey(canonical)]
  if (marker.repository !== ZCODE_REPOSITORY || !/^\d+\.\d+\.\d+$/.test(marker.version ?? '')
    || !/^[a-f0-9]{64}$/.test(marker.archiveSha256 ?? '') || !record?.files || typeof record.files !== 'object' || Array.isArray(record.files)
    || marker.archiveSha256 !== record.archiveSha256 || marker.version !== record.version) throw new Error('目标目录并非插件安装的 ZCode CLI，已停止以保护已有文件。')
  const files = await zcodeTreeFiles(canonical)
  if (Object.keys(files).some(name => !record.files?.[name])) throw new Error('ZCode CLI 目录含发行包之外的文件，请先移出这些文件再重试。')
  return { root: canonical, record }
}

async function targetParent(installDir) {
  if (typeof installDir !== 'string' || !isAbsolute(installDir) || resolve(installDir) === dirname(resolve(installDir))) throw new Error('ZCode CLI 安装目标必须是独立的绝对目录。')
  const requestedRoot = resolve(installDir), requestedParent = dirname(requestedRoot)
  // realpath expands ordinary Windows 8.3 names (including the runner TEMP
  // directory). Check actual links in every ancestor instead of rejecting
  // harmless textual aliases, then bind all writes/removal to canonical paths.
  for (let cursor = requestedParent;; cursor = dirname(cursor)) {
    const info = await lstat(cursor).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error('ZCode CLI 安装父目录不能经过目录联接或符号链接。')
    if (cursor === dirname(cursor)) break
  }
  await mkdir(requestedParent, { recursive: true })
  const parent = await realpath(requestedParent)
  const candidate = join(parent, basename(requestedRoot))
  const info = await lstat(candidate).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  const root = info?.isDirectory() && !info.isSymbolicLink() ? await realpath(candidate) : candidate
  if (zcodeRootKey(dirname(root)) !== zcodeRootKey(parent)) throw new Error('ZCode CLI 安装目标离开了已核对的父目录。')
  return { root, parent }
}

export async function installZCodeCli({ installDir, latest, env = process.env, signal, onProgress, fetchImpl = (...args) => fetch(...args), trustPath = zcodeTrustPath(env) } = {}) {
  const release = zcodeInstallerRelease(latest)
  if (!release || latest?.stale || latest?.error) throw new Error('无法核实 ZCode CLI 最新 GitHub Release；请检查网络后重试。')
  const { root, parent } = await targetParent(installDir)
  const previous = await ownedRuntime(root, trustPath)
  const stage = join(parent, `.zcode-stage-${randomUUID()}`)
  const archive = `${stage}.tar.gz`
  const backup = join(parent, `.zcode-backup-${randomUUID()}`)
  let moved = false, committed = false
  const downloadSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(600_000)]) : AbortSignal.timeout(600_000)
  try {
    const checksumResponse = await responseFor(release.sha256Url, { fetchImpl, signal: downloadSignal })
    if (!checksumResponse.body || Number(checksumResponse.headers?.get?.('content-length')) > 16_384) throw new Error('ZCode CLI SHA256 文件过大或无内容。')
    const checksumParts = []
    let checksumBytes = 0
    for await (const part of Readable.fromWeb(checksumResponse.body)) {
      checksumBytes += part.length
      if (checksumBytes > 16_384) throw new Error('ZCode CLI SHA256 文件过大。')
      checksumParts.push(part)
    }
    const checksumText = Buffer.concat(checksumParts).toString('utf8')
    const expected = parseZCodeChecksum(checksumText, release.fileName)
    const response = await responseFor(release.url, { fetchImpl, signal: downloadSignal })
    if (!response.body || Number(response.headers?.get?.('content-length')) > MAX_DOWNLOAD_BYTES) throw new Error('ZCode CLI 运行包超出下载限制。')
    let receivedBytes = 0
    const meter = new Transform({ transform(chunk, encoding, callback) {
      receivedBytes += chunk.length
      if (receivedBytes > MAX_DOWNLOAD_BYTES) return callback(new Error('ZCode CLI 运行包超出下载限制。'))
      onProgress?.({ receivedBytes, declaredBytes: Number(response.headers?.get?.('content-length')) || null })
      callback(null, chunk)
    } })
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(archive, { flags: 'wx', mode: 0o600 }), { signal: downloadSignal })
    if ((await zcodeFileDigest(archive)).sha256 !== expected) throw new Error('ZCode CLI 运行包 SHA256 不匹配，已拒绝安装。')
    signal?.throwIfAborted()
    await extractZCodeArchive(archive, stage, { signal })
    const pkg = JSON.parse(await readFile(join(stage, 'package.json'), 'utf8'))
    if (pkg.name !== 'zcode-runtime' || pkg.version !== release.version || pkg.bin?.zcode !== './bin/zcode.mjs') throw new Error('ZCode CLI 运行包元数据与发布版本不一致。')
    await lstat(join(stage, 'bin', 'zcode.mjs')); await lstat(join(stage, 'agent', 'zcode.cjs'))
    // Keep runtime invocations relocatable; neither shim changes global PATH or runs an installer script.
    await writeFile(join(stage, 'bin', 'zcode'), '#!/bin/sh\nexec node "$(dirname "$0")/zcode.mjs" "$@"\n', { mode: 0o755 })
    await writeFile(join(stage, 'bin', 'zcode.cmd'), '@echo off\r\nnode "%~dp0zcode.mjs" %*\r\n')
    await chmod(join(stage, 'bin', 'zcode.mjs'), 0o755)
    const files = await zcodeTreeFiles(stage)
    await writeFile(join(stage, ZCODE_MARKER), `${JSON.stringify({ repository: ZCODE_REPOSITORY, version: release.version, archiveSha256: expected })}\n`, { mode: 0o600 })
    signal?.throwIfAborted()
    if (previous) { await rename(root, backup); moved = true }
    await rename(stage, root)
    try { await recordZCodeInstall({ root, version: release.version, archiveSha256: expected, files, trustPath }) }
    catch (error) {
      // Only the newly installed, path-checked dedicated runtime may be removed here.
      if (!zcodeWithin(parent, root)) throw error
      await rm(root, { recursive: true, force: true })
      if (moved) { await rename(backup, root); moved = false }
      throw error
    }
    committed = true
    return { status: 'succeeded', version: release.version, installDir: root, url: release.url, archiveSha256: expected }
  } finally {
    if (zcodeWithin(parent, archive)) await rm(archive, { force: true }).catch(() => {})
    if (zcodeWithin(parent, stage)) await rm(stage, { recursive: true, force: true }).catch(() => {})
    if (committed && moved && zcodeWithin(parent, backup)) await rm(backup, { recursive: true, force: true }).catch(() => {})
    else if (moved) await rename(backup, root).catch(() => {})
  }
}

export async function uninstallZCodeCli({ installDir, env = process.env, trustPath = zcodeTrustPath(env) } = {}) {
  const { root, parent } = await targetParent(installDir)
  const owned = await ownedRuntime(root, trustPath)
  if (!owned) return { status: 'succeeded', installDir: root }
  if (zcodeRootKey(owned.root) !== zcodeRootKey(root) || !zcodeWithin(parent, owned.root)) throw new Error('ZCode CLI 卸载路径离开了已核对的目标目录。')
  await rm(owned.root, { recursive: true, force: true })
  return { status: 'succeeded', installDir: root }
}
