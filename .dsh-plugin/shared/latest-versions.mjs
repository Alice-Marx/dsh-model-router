/**
 * "Latest version" lookup for the official tools (health card hint only).
 *
 * The plugin no longer pins tool versions: installs take each vendor's latest
 * release, and the health check shows the installed version next to the latest
 * one with an "update available" hint. Lookups are cheap metadata reads (the
 * npm registry's `<package>/latest` document, ZCode CLI's GitHub Release),
 * cached for about 12 hours in memory and in `model-router/latest-versions.json`.
 * Every failure is non-fatal: offline, the last known value (or nothing) is used.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveStateHome } from './router-state.mjs'
import { OFFICIAL_TOOLS } from './official-tool-registry.mjs'
import { compareReleaseVersions, isReleaseVersion } from './version-order.mjs'

export { compareReleaseVersions, isReleaseVersion } from './version-order.mjs'

export const LATEST_CACHE_MS = 12 * 60 * 60_000
export const LATEST_FAILURE_RETRY_MS = 30 * 60_000
export const LATEST_TIMEOUT_MS = 5_000
export const NPM_REGISTRY = 'https://registry.npmjs.org'
export const ZCODE_RELEASE_API = 'https://api.github.com/repos/Alice-Marx/zcode-cli/releases/latest'
/**
 * Step Code has no npm package; its own installer reads this release manifest,
 * so it is the same document the install will use — and the same URL its
 * mirror override redirects to.
 */
export const STEPCODE_RELEASE_BASE = 'https://static-openapi.stepfun.com/stepcode'
const MAX_DOCUMENT_BYTES = 2_000_000

/** True only when both versions parse and the latest is strictly newer. */
export function updateAvailable(installed, latest) {
  return compareReleaseVersions(latest, installed) === 1
}

export function latestCachePath(env = process.env) {
  return join(resolveStateHome(env), 'model-router', 'latest-versions.json')
}

/** Only complete stable releases from the fixed standalone repository are usable. */
export function parseZCodeRelease(body) {
  if (!body || body.draft === true || body.prerelease === true) return null
  const version = String(body.tag_name ?? '').replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null
  const base = `https://github.com/Alice-Marx/zcode-cli/releases/download/${body.tag_name}`
  const url = `${base}/zcode-${version}.tar.gz`
  const sha256Url = `${base}/sha256.txt`
  const assets = Array.isArray(body.assets) ? body.assets : []
  if (!assets.some(asset => asset.name === `zcode-${version}.tar.gz` && asset.browser_download_url === url)
    || !assets.some(asset => asset.name === 'sha256.txt' && asset.browser_download_url === sha256Url)) return null
  return { version, url, sha256Url }
}

async function boundedText(fetchImpl, url, timeoutMs, accept) {
  const response = await fetchImpl(url, {
    headers: { accept },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response?.ok) throw new Error(`HTTP ${response?.status ?? '失败'}`)
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > MAX_DOCUMENT_BYTES) throw new Error('响应过大')
  const body = await response.text()
  if (body.length > MAX_DOCUMENT_BYTES) throw new Error('响应过大')
  return body
}

/** The release version out of a Step Code `latest.json` manifest. */
export function parseStepCodeManifest(text) {
  let body
  try { body = JSON.parse(String(text ?? '')) } catch { throw new Error('阶跃发布清单不是有效 JSON') }
  if (!isReleaseVersion(body?.version)) throw new Error('阶跃发布清单缺少正式版本号')
  return { version: body.version, url: `${STEPCODE_RELEASE_BASE}/${body.version}/manifest.json` }
}

/** Where to look up a tool's latest release; null when there is no cheap source. */
export function latestSourceFor(tool) {
  if (!tool || tool.unsupported) return null
  if (tool.manager === 'npm' && typeof tool.package === 'string') return { kind: 'npm', package: tool.package }
  if (tool.id === 'zcode') return { kind: 'zcode-github-release', url: ZCODE_RELEASE_API }
  if (tool.id === 'stepcode') return { kind: 'stepcode-release-manifest' }
  if (tool.id === 'hermes') return { kind: 'hermes-github-release', url: 'https://api.github.com/repos/NousResearch/hermes-agent/releases/latest' }
  return null
}

async function lookupSource(source, { fetchImpl, timeoutMs }) {
  if (source.kind === 'npm') {
    const body = JSON.parse(await boundedText(fetchImpl, `${NPM_REGISTRY}/${source.package}/latest`, timeoutMs, 'application/json'))
    if (body?.name !== source.package || !isReleaseVersion(body?.version)) throw new Error('npm 元数据格式无效')
    return { version: body.version, source: 'npm' }
  }
  if (source.kind === 'zcode-github-release') {
    const found = parseZCodeRelease(JSON.parse(await boundedText(fetchImpl, source.url, timeoutMs, 'application/json')))
    if (!found) throw new Error('ZCode CLI GitHub Release 缺少正式版本运行包或 SHA256 文件')
    return { ...found, source: 'zcode-github-release' }
  }
  if (source.kind === 'stepcode-release-manifest') {
    const found = parseStepCodeManifest(await boundedText(fetchImpl, `${STEPCODE_RELEASE_BASE}/latest.json`, timeoutMs, 'application/json'))
    return { ...found, source: 'stepcode-release-manifest' }
  }
  if (source.kind === 'hermes-github-release') {
    const body = JSON.parse(await boundedText(fetchImpl, source.url, timeoutMs, 'application/json'))
    if (body?.draft === true || body?.prerelease === true) throw new Error('Hermes 发布不是正式版本')
    const version = String(body?.tag_name ?? '').replace(/^v/, '')
    if (!isReleaseVersion(version)) throw new Error('Hermes 发布标签不是有效版本号')
    return { version, source: 'hermes-github-release' }
  }
  throw new Error('不支持的版本来源')
}

/**
 * Latest-version lookups with a shared cache. Every dependency is injectable so
 * tests can run offline with a mocked fetch and clock.
 */
export function createLatestVersions({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = Date.now,
  cachePath = () => latestCachePath(),
  ttlMs = LATEST_CACHE_MS,
  failureRetryMs = LATEST_FAILURE_RETRY_MS,
  timeoutMs = LATEST_TIMEOUT_MS,
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
      if (saved && typeof saved.entries === 'object' && !Array.isArray(saved.entries)) {
        for (const [id, entry] of Object.entries(saved.entries)) {
          if (entry && typeof entry === 'object' && (entry.version === null || isReleaseVersion(entry.version))) entries[id] = entry
        }
      }
    } catch { /* first run or unreadable cache: start empty */ }
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
    } catch { /* the in-memory cache still serves this process */ }
  }

  const view = (entry, stale = false) => entry ? {
    version: entry.version ?? null,
    checkedAt: entry.checkedAt ?? null,
    source: entry.source ?? null,
    ...(entry.url ? { url: entry.url } : {}),
    ...(entry.sha256Url ? { sha256Url: entry.sha256Url } : {}),
    ...(entry.error ? { error: entry.error } : {}),
    ...(stale ? { stale: true } : {}),
  } : null

  async function lookup(tool, { fresh = false } = {}) {
    const source = latestSourceFor(tool)
    if (!source) return null
    const cache = await load()
    const entry = tool.id === 'zcode' && cache[tool.id]?.source !== 'zcode-github-release' ? null : cache[tool.id]
    const at = now()
    if (!fresh && entry) {
      if (!entry.error && at - (entry.checkedAt ?? 0) < ttlMs) return view(entry)
      if (entry.error && at - (entry.failedAt ?? 0) < failureRetryMs) return view(entry, true)
    }
    if (inflight.has(tool.id)) return inflight.get(tool.id)
    const pending = (async () => {
      try {
        const found = await lookupSource(source, { fetchImpl, timeoutMs })
        cache[tool.id] = { version: found.version, checkedAt: now(), source: found.source, ...(found.url ? { url: found.url } : {}), ...(found.sha256Url ? { sha256Url: found.sha256Url } : {}) }
        await save()
        return view(cache[tool.id])
      } catch (error) {
        const message = String(error?.name === 'TimeoutError' ? '查询超时' : error?.message ?? error).slice(0, 160)
        // Keep the last good version; remember the failure to avoid retrying every call offline.
        cache[tool.id] = { version: entry?.version ?? null, checkedAt: entry?.checkedAt ?? null, source: entry?.source ?? null,
          ...(entry?.url ? { url: entry.url } : {}), ...(entry?.sha256Url ? { sha256Url: entry.sha256Url } : {}), error: message, failedAt: now() }
        await save()
        return view(cache[tool.id], true)
      } finally {
        inflight.delete(tool.id)
      }
    })()
    inflight.set(tool.id, pending)
    return pending
  }

  return {
    lookup,
    /** Look up every registry tool in parallel; never throws. */
    async lookupAll(tools = OFFICIAL_TOOLS, options = {}) {
      const results = await Promise.all(tools.map(async tool => {
        try { return [tool.id, await lookup(tool, options)] } catch { return [tool.id, null] }
      }))
      return Object.fromEntries(results)
    },
    /** Test helper and cache inspection. */
    async snapshot() { return { ...(await load()) } },
    reset() { entries = null; inflight.clear() },
  }
}

export const latestVersions = createLatestVersions()
