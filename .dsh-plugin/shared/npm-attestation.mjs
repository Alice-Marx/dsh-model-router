/**
 * Registry-attested file digests for unsigned files shipped in official npm
 * packages (MiMo's mimo.exe, Grok's grok.exe.br, MiniMax's cli.js).
 *
 * These vendors do not Authenticode-sign their binaries, so a publisher check
 * is impossible. Instead of a per-version hash compiled into the plugin, the
 * expected digest is derived at runtime from the official npm registry for the
 * exact installed version: the version document (over TLS from
 * registry.npmjs.org) gives the tarball's sha512 `dist.integrity`; the tarball
 * (from npm's local cache when present, otherwise downloaded from the same
 * registry) must match it; the file is then hashed straight out of the tarball.
 * Installed files must equal those digests. Results are cached per
 * package@version, so only the first use of a new version needs network.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'
import { resolveStateHome } from './router-state.mjs'
import { NPM_REGISTRY, isReleaseVersion } from './latest-versions.mjs'

const PACKAGE_NAME = /^@[a-z0-9][a-z0-9._-]{0,100}\/[a-z0-9][a-z0-9._-]{0,100}$|^[a-z0-9][a-z0-9._-]{0,100}$/
const MAX_TARBALL_BYTES = 400_000_000
const METADATA_TIMEOUT_MS = 15_000
const TARBALL_TIMEOUT_MS = 180_000
/** Files that run as code: what the executor must not trust without attestation. */
export const CODE_FILE = /\.(?:js|cjs|mjs|node|exe|dll|br|wasm)$/i

export function attestationCachePath(env = process.env) {
  return join(resolveStateHome(env), 'model-router', 'npm-attestations.json')
}

/** npm's content-addressed cache location for one sha512 integrity string. */
export function npmCacheContentPath(cacheDir, integrity) {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(String(integrity ?? ''))
  if (!match || !cacheDir) return null
  const hex = Buffer.from(match[1], 'base64').toString('hex')
  if (hex.length !== 128) return null
  return join(cacheDir, '_cacache', 'content-v2', 'sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4))
}

export function defaultNpmCacheDirectory(env = process.env, platform = process.platform) {
  const configured = env.npm_config_cache ?? env.NPM_CONFIG_CACHE
  if (typeof configured === 'string' && configured.trim()) return configured.trim()
  if (platform === 'win32') return env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'npm-cache') : null
  return join(homedir(), '.npm')
}

/** Parse one 512-byte tar header; returns null for the end-of-archive block. */
function tarHeader(block) {
  if (block.every(byte => byte === 0)) return null
  const field = (start, length) => {
    const raw = block.subarray(start, start + length)
    const end = raw.indexOf(0)
    return raw.subarray(0, end === -1 ? length : end).toString('utf8')
  }
  const sizeField = block.subarray(124, 136)
  let size
  if (sizeField[0] & 0x80) {
    size = 0
    for (let index = 1; index < 12; index += 1) size = size * 256 + sizeField[index]
  } else {
    size = Number.parseInt(field(124, 12).trim() || '0', 8)
  }
  const magic = field(257, 6)
  const prefix = magic.startsWith('ustar') ? field(345, 155) : ''
  const name = field(0, 100)
  return { name: prefix ? `${prefix}/${name}` : name, size, type: String.fromCharCode(block[156] || 48) }
}

function paxPath(buffer) {
  let offset = 0
  while (offset < buffer.length) {
    const space = buffer.indexOf(0x20, offset)
    if (space === -1) break
    const length = Number.parseInt(buffer.subarray(offset, space).toString('utf8'), 10)
    if (!Number.isSafeInteger(length) || length <= 0) break
    const record = buffer.subarray(space + 1, offset + length - 1).toString('utf8')
    if (record.startsWith('path=')) return record.slice(5)
    offset += length
  }
  return null
}

/**
 * Stream a .tgz and return a Map of every regular member below `package/`
 * (path relative to the package root) to { sha256: 'sha256-<base64>', size }.
 */
export async function digestTarMembers(tgzStream) {
  const gunzip = tgzStream.pipe(createGunzip())
  const members = new Map()
  let pending = Buffer.alloc(0)
  let state = { kind: 'header' }
  let nextName = null
  for await (const chunk of gunzip) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
    for (;;) {
      if (state.kind === 'done') break
      if (state.kind === 'header') {
        if (pending.length < 512) break
        const header = tarHeader(pending.subarray(0, 512))
        pending = pending.subarray(512)
        if (!header) { state = { kind: 'done' }; break }
        const padded = Math.ceil(header.size / 512) * 512
        const name = nextName ?? header.name
        nextName = null
        if (header.type === 'x' || header.type === 'L') {
          state = { kind: 'meta', type: header.type, remaining: header.size, skip: padded - header.size, parts: [] }
        } else if (header.type === '0' || header.type === '\0') {
          state = { kind: 'data', name, remaining: header.size, skip: padded - header.size, hash: createHash('sha256'), size: header.size }
        } else {
          state = { kind: 'skip', remaining: padded }
        }
        continue
      }
      if (state.kind === 'meta' || state.kind === 'data') {
        if (state.remaining > 0) {
          if (pending.length === 0) break
          const take = Math.min(state.remaining, pending.length)
          const piece = pending.subarray(0, take)
          if (state.kind === 'meta') state.parts.push(Buffer.from(piece)); else state.hash.update(piece)
          state.remaining -= take
          pending = pending.subarray(take)
          if (state.remaining > 0) break
        }
        if (state.kind === 'meta') {
          const body = Buffer.concat(state.parts)
          nextName = state.type === 'x' ? paxPath(body) : body.toString('utf8').replace(/\0+$/, '')
        } else {
          // npm packs every file under one top-level directory (usually "package/").
          const relativePath = state.name.replace(/^\.?\/?[^/]+\//, '')
          if (relativePath && !relativePath.split('/').includes('..')) {
            members.set(relativePath, { sha256: `sha256-${state.hash.digest('base64')}`, size: state.size })
          }
        }
        state = { kind: 'skip', remaining: state.skip }
        continue
      }
      if (state.kind === 'skip') {
        const take = Math.min(state.remaining, pending.length)
        state.remaining -= take
        pending = pending.subarray(take)
        if (state.remaining > 0) break
        state = { kind: 'header' }
      }
    }
    if (state.kind === 'done') break
  }
  gunzip.destroy()
  return members
}

async function sha512Of(stream) {
  const hash = createHash('sha512')
  for await (const chunk of stream) hash.update(chunk)
  return `sha512-${hash.digest('base64')}`
}

/** Digest of a local file in the same `sha256-<base64>` form. */
export async function localFileDigest(path) {
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of createReadStream(path)) { hash.update(chunk); size += chunk.length }
  return { sha256: `sha256-${hash.digest('base64')}`, size }
}

export function createNpmAttestor({
  fetchImpl = (...args) => globalThis.fetch(...args),
  cachePath = () => attestationCachePath(),
  npmCacheDirectory = async () => defaultNpmCacheDirectory(),
  now = Date.now,
  persist = true,
} = {}) {
  let entries = null
  const inflight = new Map()

  async function load() {
    if (entries) return entries
    entries = {}
    if (!persist) return entries
    try {
      const saved = JSON.parse(await readFile(cachePath(), 'utf8'))
      if (saved?.entries && typeof saved.entries === 'object') {
        for (const [key, value] of Object.entries(saved.entries)) {
          if (value && typeof value.files === 'object' && /^sha512-/.test(value.integrity ?? '')) entries[key] = value
        }
      }
    } catch { /* empty */ }
    return entries
  }

  async function save() {
    if (!persist) return
    try {
      const path = cachePath()
      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, 'utf8')
      await rename(temporary, path)
    } catch { /* memory cache still applies */ }
  }

  async function registryTarball(name, version) {
    const response = await fetchImpl(`${NPM_REGISTRY}/${name}/${version}`, {
      headers: { accept: 'application/json' }, signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    })
    if (!response?.ok) throw new Error(`npm 元数据 HTTP ${response?.status ?? '失败'}`)
    const document = await response.json()
    const integrity = document?.dist?.integrity
    const tarball = document?.dist?.tarball
    if (document?.name !== name || document?.version !== version || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity ?? '')) {
      throw new Error('npm 元数据缺少 sha512 完整性信息')
    }
    const url = new URL(tarball)
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') throw new Error('npm tarball 不在官方 registry 上')
    return { integrity, url: url.href }
  }

  async function verifiedTarballStream({ integrity, url }) {
    const cached = npmCacheContentPath(await npmCacheDirectory().catch(() => null), integrity)
    if (cached) {
      try {
        if (await sha512Of(createReadStream(cached)) === integrity) return createReadStream(cached)
      } catch { /* not in npm's cache */ }
    }
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(TARBALL_TIMEOUT_MS) })
    if (!response?.ok || !response.body) throw new Error(`npm tarball HTTP ${response?.status ?? '失败'}`)
    const chunks = []
    let length = 0
    const hash = createHash('sha512')
    for await (const chunk of Readable.fromWeb(response.body)) {
      length += chunk.length
      if (length > MAX_TARBALL_BYTES) throw new Error('npm tarball 超出大小上限')
      hash.update(chunk)
      chunks.push(chunk)
    }
    if (`sha512-${hash.digest('base64')}` !== integrity) throw new Error('npm tarball 与 registry 完整性值不符')
    return Readable.from([Buffer.concat(chunks)])
  }

  /** Every file of name@version → { sha256, size }, attested by the npm registry. */
  async function attestPackage(name, version) {
    if (!PACKAGE_NAME.test(String(name)) || !isReleaseVersion(version)) throw new TypeError('无效的 npm 包或版本')
    const key = `${name}@${version}`
    const cache = await load()
    if (cache[key]) return cache[key]
    if (inflight.has(key)) return inflight.get(key)
    const pending = (async () => {
      try {
        const source = await registryTarball(name, version)
        const members = await digestTarMembers(await verifiedTarballStream(source))
        if (members.size === 0) throw new Error(`官方 npm 包 ${key} 为空`)
        cache[key] = { integrity: source.integrity, attestedAt: now(), files: Object.fromEntries(members) }
        await save()
        return cache[key]
      } finally {
        inflight.delete(key)
      }
    })()
    inflight.set(key, pending)
    return pending
  }

  async function attest(name, version, path) {
    if (typeof path !== 'string' || !path || path.split('/').includes('..')) throw new TypeError('无效的文件路径')
    const entry = (await attestPackage(name, version)).files[path]
    if (!entry) throw new Error(`官方 npm 包 ${name}@${version} 中没有 ${path}`)
    return entry
  }

  return {
    attest,
    attestPackage,
    /** Does one local file equal the registry-attested member? Never throws. */
    async matches(localPath, name, version, path) {
      try {
        const expected = await attest(name, version, path)
        const actual = await localFileDigest(localPath)
        return actual.size === expected.size && actual.sha256 === expected.sha256
          ? { ok: true, expected }
          : { ok: false, reason: `本地文件与官方 npm ${name}@${version} 的 ${path} 摘要不符` }
      } catch (error) {
        return { ok: false, reason: String(error?.message ?? error).slice(0, 200) }
      }
    },
    /**
     * Compare every attested member selected by `include` (default: code files)
     * with the installed package directory. Missing or different files fail.
     */
    async matchesPackage(packageRoot, name, version, include = CODE_FILE) {
      try {
        const { files } = await attestPackage(name, version)
        const selected = Object.entries(files).filter(([path]) => include.test(path))
        if (selected.length === 0) return { ok: false, reason: `官方 npm 包 ${name}@${version} 没有可核验的代码文件` }
        for (const [path, expected] of selected) {
          let actual
          try { actual = await localFileDigest(join(packageRoot, ...path.split('/'))) }
          catch { return { ok: false, reason: `已安装的 ${name}@${version} 缺少 ${path}` } }
          if (actual.size !== expected.size || actual.sha256 !== expected.sha256) {
            return { ok: false, reason: `已安装的 ${name}@${version} 中 ${path} 与官方 npm 发行文件不符` }
          }
        }
        return { ok: true, files: selected.length }
      } catch (error) {
        return { ok: false, reason: String(error?.message ?? error).slice(0, 200) }
      }
    },
    reset() { entries = null; inflight.clear() },
  }
}

export const npmAttestor = createNpmAttestor()
