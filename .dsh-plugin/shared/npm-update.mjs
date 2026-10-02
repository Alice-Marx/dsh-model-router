import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROUTER_PACKAGE_NAME = '@ljwei-stak/dsh-model-router'
export const ROUTER_NPM_REGISTRY = 'https://registry.npmjs.org/'
export const ROUTER_UPDATE_CHANNEL = '/model-router-update'
export const ROUTER_UPDATE_ENDPOINT = 'install-plugin'
export const ROUTER_UPDATE_TIMEOUT_MS = 120_000

const MAX_REGISTRY_BODY_BYTES = 64 * 1024
const MAX_PNPM_OUTPUT_BYTES = 32 * 1024
const MAX_LOG_CAUSE_LENGTH = 4 * 1024
const VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function versionParts(value) {
  const match = String(value ?? '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
  if (match === null) return null
  return { core: match.slice(1, 4).map(Number), prerelease: match[4]?.split('.') ?? [] }
}

function compareVersions(left, right) {
  const a = versionParts(left)
  const b = versionParts(right)
  if (a === null || b === null) return null
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    if (a.prerelease[index] === undefined) return -1
    if (b.prerelease[index] === undefined) return 1
    if (a.prerelease[index] === b.prerelease[index]) continue
    const aNumber = /^\d+$/.test(a.prerelease[index])
    const bNumber = /^\d+$/.test(b.prerelease[index])
    if (aNumber && bNumber) return Number(a.prerelease[index]) < Number(b.prerelease[index]) ? -1 : 1
    if (aNumber !== bNumber) return aNumber ? -1 : 1
    return a.prerelease[index] < b.prerelease[index] ? -1 : 1
  }
  return 0
}

function rpcFailure(code, message, details = {}) {
  return { ok: false, error: { code, message, details } }
}

function errorText(error) {
  const value = error instanceof Error ? error.stack ?? error.message : String(error)
  return value.length <= MAX_LOG_CAUSE_LENGTH
    ? value
    : `${value.slice(0, MAX_LOG_CAUSE_LENGTH)}\n[cause truncated]`
}

async function readTextLimited(stream, maximum) {
  if (stream === null) return ''
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximum) throw new Error('response body is too large')
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function isEmptyRecord(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === 0
}

/** Read the running package version from its own ancestor manifest. */
export async function findInstalledPackageVersion(moduleUrl, read = readFile) {
  let current = dirname(fileURLToPath(moduleUrl))
  while (true) {
    try {
      const manifest = JSON.parse(await read(join(current, 'package.json'), 'utf8'))
      if (manifest?.name === ROUTER_PACKAGE_NAME && typeof manifest.version === 'string' && VERSION_PATTERN.test(manifest.version)) {
        return manifest.version
      }
    } catch {
      // Keep walking until the package root is found.
    }
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

async function npmLatest(fetchImpl, signal) {
  const encoded = encodeURIComponent(ROUTER_PACKAGE_NAME)
  const response = await fetchImpl(`${ROUTER_NPM_REGISTRY}${encoded}/latest`, {
    method: 'GET',
    redirect: 'error',
    cache: 'no-store',
    signal,
    headers: {
      accept: 'application/json',
      'user-agent': 'dsh-model-router-updater',
    },
  })
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`)
  const metadata = JSON.parse(await readTextLimited(response.body, MAX_REGISTRY_BODY_BYTES))
  if (metadata?.name !== ROUTER_PACKAGE_NAME || typeof metadata.version !== 'string' || !VERSION_PATTERN.test(metadata.version)) {
    throw new Error('npm registry returned invalid latest metadata')
  }
  return metadata.version
}

function captureBoundedOutput(stream) {
  let output = Buffer.alloc(0)
  let truncated = false
  let settle
  const done = new Promise(resolveDone => { settle = resolveDone })
  const onData = chunk => {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (next.byteLength >= MAX_PNPM_OUTPUT_BYTES) {
      output = next.subarray(-MAX_PNPM_OUTPUT_BYTES)
      truncated = true
      return
    }
    if (output.byteLength + next.byteLength > MAX_PNPM_OUTPUT_BYTES) {
      output = Buffer.concat([output, next]).subarray(-MAX_PNPM_OUTPUT_BYTES)
      truncated = true
      return
    }
    output = Buffer.concat([output, next])
  }
  const onSettled = () => settle()
  stream.on('data', onData)
  stream.once('end', onSettled)
  stream.once('close', onSettled)
  stream.once('error', onSettled)
  stream.resume()
  return {
    done,
    read() {
      const value = output.toString('utf8').trimEnd()
      return truncated ? `[earlier output truncated]\n${value}` : value
    },
    stop() {
      stream.off('data', onData)
      stream.off('end', onSettled)
      stream.off('close', onSettled)
      stream.off('error', onSettled)
    },
  }
}

function abortPromise(signal) {
  let rejectPromise
  const promise = new Promise((_, reject) => { rejectPromise = reject })
  const reject = () => rejectPromise(signal.reason ?? new Error('operation aborted'))
  if (signal.aborted) reject()
  else signal.addEventListener('abort', reject, { once: true })
  return {
    promise,
    dispose() { signal.removeEventListener('abort', reject) },
  }
}

async function runPnpmUpdate(pnpm, profileDir, version, signal) {
  const args = [
    'add',
    '--save-exact',
    `${ROUTER_PACKAGE_NAME}@${version}`,
    `--registry=${ROUTER_NPM_REGISTRY}`,
  ]
  let handle
  try {
    handle = pnpm.runPlugin(args, profileDir, signal)
  } catch (error) {
    const busy = /another desktop pnpm operation is already running/i.test(String(error))
    return { ok: false, busy, details: errorText(error) }
  }
  const stdout = captureBoundedOutput(handle.stdout)
  const stderr = captureBoundedOutput(handle.stderr)
  const onAbort = () => handle.cancel()
  const aborted = abortPromise(signal)
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    let outcome
    try {
      outcome = await Promise.race([handle.done, aborted.promise])
      await Promise.race([Promise.all([stdout.done, stderr.done]), aborted.promise])
    } catch (error) {
      signal.throwIfAborted()
      return { ok: false, busy: false, details: [errorText(error), stdout.read(), stderr.read()].filter(Boolean).join('\n\n') }
    }
    signal.throwIfAborted()
    if (outcome.exitCode !== 0 || outcome.signal !== null) {
      return {
        ok: false,
        busy: false,
        details: [
          `exitCode=${outcome.exitCode ?? 'null'} signal=${outcome.signal ?? 'none'}`,
          stdout.read(),
          stderr.read(),
        ].filter(Boolean).join('\n\n'),
      }
    }
    return { ok: true }
  } finally {
    aborted.dispose()
    signal.removeEventListener('abort', onAbort)
    stdout.stop()
    stderr.stop()
  }
}

export function createNpmUpdateHandler({
  moduleUrl,
  pnpm,
  profileDir,
  fetchImpl = globalThis.fetch,
  logger,
  timeoutMs = ROUTER_UPDATE_TIMEOUT_MS,
}) {
  let active = false
  return async (endpoint, payload, requestSignal = new AbortController().signal) => {
    if (endpoint !== ROUTER_UPDATE_ENDPOINT) {
      return rpcFailure('router/not-found', 'unknown Router update operation')
    }
    if (!isEmptyRecord(payload)) {
      return rpcFailure('router/bad-request', 'the Router update request must be an empty object')
    }
    if (active) return rpcFailure('router/busy', 'a Router update is already running')
    active = true
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = AbortSignal.any([requestSignal, timeoutSignal])
    try {
      const version = await npmLatest(fetchImpl, signal)
      const currentVersion = await findInstalledPackageVersion(moduleUrl)
      const order = currentVersion === null ? null : compareVersions(currentVersion, version)
      if (order !== null && order >= 0) {
        return {
          ok: true,
          value: {
            changed: false,
            packageName: ROUTER_PACKAGE_NAME,
            currentVersion,
            version,
            restartRequired: false,
            message: order === 0
              ? `npm 插件已经是最新版 ${version}。`
              : `当前插件 ${currentVersion} 新于 npm latest ${version}，不会降级。`,
          },
        }
      }
      const result = await runPnpmUpdate(pnpm, profileDir, version, signal)
      if (!result.ok) {
        try { logger?.warn?.(`model-router: npm update failed\n${result.details}`) } catch {}
        return rpcFailure(
          result.busy ? 'router/busy' : 'router/install-failed',
          result.busy ? 'DSH Desktop 正在执行其他插件操作，请稍后重试。' : 'npm 插件更新失败，请查看 DSH Desktop 日志。',
        )
      }
      return {
        ok: true,
        value: {
          changed: true,
          packageName: ROUTER_PACKAGE_NAME,
          currentVersion,
          version,
          restartRequired: true,
          message: `npm 插件及其依赖已更新为 ${version}。请完全退出并重新启动 DSH Desktop。`,
        },
      }
    } catch (error) {
      const timedOut = timeoutSignal.aborted && !requestSignal.aborted
      try { logger?.warn?.(`model-router: npm update failed: ${errorText(error)}`) } catch {}
      return rpcFailure(
        timedOut ? 'router/timeout' : requestSignal.aborted ? 'router/cancelled' : 'router/npm-failed',
        timedOut
          ? 'npm 插件更新超时，请稍后重试。'
          : requestSignal.aborted
            ? 'npm 插件更新已取消。'
            : '无法从 npm 检查或更新插件。',
      )
    } finally {
      active = false
    }
  }
}

export function registerNpmUpdateRoute(ctx, moduleUrl) {
  const connection = ctx.connection ?? ctx.get?.('connection')
  const profiles = ctx.desktopProfiles ?? ctx.get?.('desktopProfiles')
  const pnpm = ctx.desktopPnpm ?? ctx.get?.('desktopPnpm')
  const register = typeof connection?.register === 'function'
    ? (channel, handler) => connection.register(ctx, channel, handler)
    : typeof connection?.rpc?.handle === 'function'
      ? (channel, handler) => connection.rpc.handle(channel, handler)
      : null
  if (register === null
    || typeof pnpm?.runPlugin !== 'function'
    || typeof profiles?.current?.dir !== 'string') return false
  register(ROUTER_UPDATE_CHANNEL, createNpmUpdateHandler({
    moduleUrl,
    pnpm,
    profileDir: profiles.current.dir,
    logger: ctx.logger,
  }))
  return true
}
