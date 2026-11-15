import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { createServer } from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Agent, ProxyAgent, EnvHttpProxyAgent, fetch as httpFetch } from 'undici'
import { cliProxyArtifact, CLI_PROXY_VERSION } from './cli-proxy-release.mjs'
import { spawnCliProxyComponent, stopCliProxyComponent } from './cli-proxy-process.mjs'

const execute = promisify(execFile)
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const fileSha = async file => { const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex') }
const privateJson = async (file, value) => {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const temporary = file + '.' + randomBytes(8).toString('hex') + '.tmp'
  await writeFile(temporary, JSON.stringify(value) + '\n', { mode: 0o600 })
  await rename(temporary, file)
}
export async function cliProxyJson(response, limit = 2_000_000) {
  if (!response.ok) { await response.body?.cancel().catch(() => {}); throw Object.assign(new Error(`订阅服务请求失败（HTTP ${response.status}）。`), { code: 'SUBSCRIPTION_PROXY_HTTP', status: response.status }) }
  const reader = response.body?.getReader(), chunks = []; let bytes = 0
  if (!reader) fail('SUBSCRIPTION_PROXY_RESPONSE', '订阅服务返回了无效结果。')
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > limit) fail('SUBSCRIPTION_PROXY_RESPONSE', '订阅服务返回的内容过大。'); chunks.push(part.value) }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) { if (error.code === 'SUBSCRIPTION_PROXY_RESPONSE') throw error; fail('SUBSCRIPTION_PROXY_RESPONSE', '订阅服务返回了无效结果。') }
  finally { await reader.cancel().catch(() => {}) }
}

// The only archive accepted by this installer is a hash-pinned upstream release.
// Extract the one named binary, never an archive-controlled path or a directory tree.
export async function installCliProxyArtifact(bytes, root, artifact = cliProxyArtifact()) {
  if (sha(bytes) !== artifact.sha256) fail('SUBSCRIPTION_COMPONENT_HASH', '订阅登录组件校验失败，请重新下载。')
  root = resolve(root); await mkdir(root, { recursive: true, mode: 0o700 })
  const stage = await mkdtemp(join(root, 'install-')), archive = join(stage, artifact.filename)
  try {
    await writeFile(archive, bytes, { mode: 0o600 })
    const { stdout } = await execute('tar', ['-tf', archive], { windowsHide: true, timeout: 30_000, maxBuffer: 256_000 })
    const names = stdout.split(/\r?\n/).filter(Boolean)
    if (!names.includes(artifact.binary) || !names.includes('LICENSE') || names.some(name => isAbsolute(name) || name.replaceAll('\\', '/').split('/').includes('..') || /[\x00-\x1f:]/.test(name))) fail('SUBSCRIPTION_COMPONENT_ARCHIVE', '订阅登录组件的文件结构无效。')
    await execute('tar', ['-xf', archive, '-C', stage, artifact.binary, 'LICENSE'], { windowsHide: true, timeout: 30_000 })
    const extracted = join(stage, artifact.binary), stat = await lstat(extracted), actual = await realpath(extracted)
    if (!stat.isFile() || stat.size < 1 || stat.size > 200_000_000 || relative(stage, actual).startsWith('..') || isAbsolute(relative(stage, actual))) fail('SUBSCRIPTION_COMPONENT_ARCHIVE', '订阅登录组件的可执行文件无效。')
    const target = join(root, 'bin', artifact.version); await mkdir(target, { recursive: true, mode: 0o700 })
    await copyFile(extracted, join(target, artifact.binary)); await chmod(join(target, artifact.binary), 0o700)
    const license = await lstat(join(stage, 'LICENSE'))
    if (!license.isFile() || license.size > 100_000) fail('SUBSCRIPTION_COMPONENT_ARCHIVE', '订阅登录组件的许可文件无效。')
    await copyFile(join(stage, 'LICENSE'), join(target, 'LICENSE'))
    await privateJson(join(target, 'verified.json'), { version: artifact.version, archiveSha256: artifact.sha256, binarySha256: await fileSha(extracted) })
    return { version: artifact.version, installed: true }
  } finally {
    // Resolve and bound every recursive cleanup to this installation's own stage.
    const bounded = relative(root, resolve(stage))
    if (bounded && !bounded.startsWith('..') && !isAbsolute(bounded) && basename(stage).startsWith('install-')) await rm(stage, { recursive: true, force: true }).catch(() => {})
  }
}

async function systemProxy() {
  if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy) return null
  if (process.platform !== 'win32') return null
  try {
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-ItemProperty -LiteralPath "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" | Select-Object ProxyEnable,ProxyServer | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 3000, maxBuffer: 8192 })
    const config = JSON.parse(stdout)
    if (!config.ProxyEnable || typeof config.ProxyServer !== 'string') return null
    const selected = config.ProxyServer.split(';').find(v => v.startsWith('https='))?.slice(6) ?? config.ProxyServer.split(';')[0].replace(/^http=/, '')
    const url = new URL(selected.includes('://') ? selected : 'http://' + selected)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}
const freePort = () => new Promise((done, reject) => { const server = createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(error => error ? reject(error) : done(port)) }) })
export function subscriptionProxyUrl(raw) {
  if (!raw) return ''
  let url; try { url = new URL(raw) } catch { fail('SUBSCRIPTION_PROXY_INVALID', '请输入完整的网络代理地址。') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) fail('SUBSCRIPTION_PROXY_INVALID', '请输入不含账号密码的 HTTP(S) 网络代理地址。')
  return url.href.replace(/\/$/, '')
}

export function createCliProxyRuntime({ root, onState = () => {}, download, spawnProcess = spawnCliProxyComponent, now = Date.now } = {}) {
  if (!root || !isAbsolute(root)) fail('SUBSCRIPTION_STORAGE_REQUIRED', '订阅登录需要本机的私有存储目录。')
  let artifact
  try { artifact = cliProxyArtifact() } catch (error) {
    const status = () => ({ phase: 'unsupported', installed: false, enabled: false, version: CLI_PROXY_VERSION, errorCode: error.code })
    const unavailable = () => { throw error }
    return Object.freeze({ status, connection: unavailable, request: async () => unavailable(), enable: unavailable, stop: async () => status(), verifyInstalled: async () => false, initialize: async () => status(), close: async () => {} })
  }
  const localAgent = new Agent(), closedSignal = new AbortController()
  let phase = 'disabled', installed = false, errorCode = null, child = null, endpoint = null, secrets = null, job = null, enabled = false, proxyUrl = '', closed = false
  const emit = () => { try { void Promise.resolve(onState()).catch(() => {}) } catch {} }
  const status = () => ({ phase, installed, enabled, version: CLI_PROXY_VERSION, canStop: Boolean(child), ...(errorCode ? { errorCode } : {}), proxyConfigured: Boolean(proxyUrl) })
  const setPhase = (next, error = null) => { phase = next; errorCode = error; emit() }
  const verifyInstalled = async () => {
    try {
      const file = join(root, 'bin', artifact.version, artifact.binary), meta = JSON.parse(await readFile(join(dirname(file), 'verified.json'), 'utf8'))
      installed = meta.version === artifact.version && meta.archiveSha256 === artifact.sha256 && /^[a-f0-9]{64}$/.test(meta.binarySha256) && (await lstat(file)).isFile() && await fileSha(file) === meta.binarySha256
    } catch { installed = false }
    return installed
  }
  const connection = () => {
    if (closed || phase !== 'ready' || !endpoint || !secrets || !child || child.exitCode !== null) fail('SUBSCRIPTION_PROXY_NOT_READY', '订阅登录服务尚未就绪，请先启用或重试。')
    return { endpoint, apiKey: secrets.apiKey, managementKey: secrets.managementKey, generation: child.pid }
  }
  const requestAt = async (origin, secret, path, { method = 'GET', body, signal, timeout = 20_000 } = {}) => {
    const joined = AbortSignal.any([closedSignal.signal, AbortSignal.timeout(timeout), ...(signal ? [signal] : [])])
    try {
      const response = await httpFetch(origin + path, { method, headers: { authorization: 'Bearer ' + secret, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: joined, redirect: 'error', dispatcher: localAgent })
      return await cliProxyJson(response)
    } catch (error) { if (error.code?.startsWith('SUBSCRIPTION_')) throw error; if (signal?.aborted) signal.throwIfAborted(); fail('SUBSCRIPTION_PROXY_UNREACHABLE', '本机订阅服务未响应，请重新启动服务。') }
  }
  const request = (path, options = {}) => {
    if (!/^\/v8\/management\//.test(path) && path !== '/v1/models') fail('SUBSCRIPTION_PROXY_PATH', '不支持的订阅管理操作。')
    const current = connection()
    return requestAt(current.endpoint, path === '/v1/models' ? current.apiKey : current.managementKey, path, options)
  }
  const fetchInference = (input, init = {}) => {
    const current = connection(), target = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
    const headers = new Headers(init.headers ?? input.headers)
    if (target.origin !== current.endpoint || target.pathname !== '/v1/chat/completions' || target.search || target.hash
      || (init.method ?? input.method ?? 'GET').toUpperCase() !== 'POST' || headers.get('authorization') !== 'Bearer ' + current.apiKey) fail('SUBSCRIPTION_INFERENCE_TARGET', '订阅推理目标与本机已登录账户不一致。')
    return httpFetch(input, { ...init, redirect: 'error', dispatcher: localAgent, signal: AbortSignal.any([closedSignal.signal, ...(init.signal ? [init.signal] : [])]) })
  }
  const start = async signal => {
    if (!await verifyInstalled()) fail('SUBSCRIPTION_COMPONENT_REQUIRED', '请先安装订阅登录组件。')
    setPhase('starting')
    await mkdir(join(root, 'accounts'), { recursive: true, mode: 0o700 })
    try { secrets = JSON.parse(await readFile(join(root, 'private.json'), 'utf8')); if (!/^[a-f0-9]{64}$/.test(secrets.apiKey) || !/^[a-f0-9]{64}$/.test(secrets.managementKey)) throw Error('invalid') }
    catch (error) { if (error.code !== 'ENOENT') fail('SUBSCRIPTION_PRIVATE_STATE_INVALID', '订阅登录的本机凭据无效，请检查数据备份。'); secrets = { apiKey: randomBytes(32).toString('hex'), managementKey: randomBytes(32).toString('hex') }; await privateJson(join(root, 'private.json'), secrets) }
    signal.throwIfAborted()
    const port = await freePort(), origin = `http://127.0.0.1:${port}`
    const proxy = proxyUrl || await systemProxy() || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || ''
    const config = { host: '127.0.0.1', port, 'auth-dir': join(root, 'accounts'), 'api-keys': [secrets.apiKey],
      'remote-management': { 'allow-remote': false, 'disable-control-panel': true }, 'force-model-prefix': true,
      'request-retry': 0, 'max-retry-interval': 0, 'quota-exceeded': { 'switch-project': false, 'switch-preview-model': false },
      'logging-to-file': false, 'usage-statistics-enabled': false, 'proxy-url': proxy }
    await privateJson(join(root, 'config.json'), config)
    const env = {}
    for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'windir', 'ComSpec', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'LANG', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) if (process.env[key]) env[key] = process.env[key]
    env.MANAGEMENT_PASSWORD = secrets.managementKey
    const processChild = spawnProcess(join(root, 'bin', artifact.version, artifact.binary), ['--config', join(root, 'config.json')], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    child = processChild
    processChild.stdout?.resume(); processChild.stderr?.resume()
    let launchError = false
    processChild.once('error', () => { launchError = true; if (child === processChild) { endpoint = null; setPhase('error', 'SUBSCRIPTION_PROXY_START') } })
    processChild.once('exit', () => { if (child === processChild) { child = null; endpoint = null; if (!closed && phase !== 'stopping') setPhase('error', 'SUBSCRIPTION_PROXY_EXITED') } })
    const deadline = now() + 30_000
    while (now() < deadline) {
      signal.throwIfAborted()
      if (launchError || processChild.exitCode !== null || child !== processChild) fail('SUBSCRIPTION_PROXY_START', '订阅登录服务启动失败，请检查组件并重试。')
      try { const ready = await requestAt(origin, secrets.managementKey, '/v8/management/credentials', { signal, timeout: 1200 }); if (!Array.isArray(ready.files)) throw Error('shape'); endpoint = origin; setPhase('ready'); enabled = true; await privateJson(join(root, 'settings.json'), { enabled, proxyUrl }); return status() }
      catch { signal.throwIfAborted() }
      await new Promise(done => setTimeout(done, 150))
    }
    fail('SUBSCRIPTION_PROXY_START', '订阅登录服务启动超时，请重试。')
  }
  const downloadArtifact = async signal => {
    if (download) return download(artifact, signal)
    const proxy = proxyUrl || await systemProxy(), dispatcher = proxy && /^https?:/.test(proxy) ? new ProxyAgent(proxy) : new EnvHttpProxyAgent()
    try {
      const response = await httpFetch(artifact.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]), dispatcher, redirect: 'follow' })
      if (!response.ok) { await response.body?.cancel().catch(() => {}); fail('SUBSCRIPTION_COMPONENT_DOWNLOAD', '订阅登录组件下载失败，请重试或检查网络代理。') }
      const chunks = []; let size = 0
      for await (const bytes of response.body) { size += bytes.length; if (size > 80_000_000) fail('SUBSCRIPTION_COMPONENT_DOWNLOAD', '订阅登录组件下载大小异常。'); chunks.push(bytes) }
      return Buffer.concat(chunks)
    } finally { await dispatcher.close().catch(() => {}) }
  }
  const enable = (options = {}) => {
    if (closed) fail('SUBSCRIPTION_CLOSED', '订阅登录服务已关闭。')
    if (job || phase === 'ready') return status()
    if (child && child.exitCode === null) fail('SUBSCRIPTION_STOP_UNCONFIRMED', '订阅服务尚未确认停止，请先重试停止。')
    proxyUrl = subscriptionProxyUrl(options.proxyUrl ?? proxyUrl)
    const controller = new AbortController(), operation = { controller }; job = operation
    setPhase('installing')
    operation.done = (async () => {
      if (!await verifyInstalled()) await installCliProxyArtifact(await downloadArtifact(controller.signal), root, artifact)
      installed = true; controller.signal.throwIfAborted(); await start(controller.signal)
    })().catch(async error => {
      const failedChild = child; endpoint = null
      try { await stopCliProxyComponent(failedChild); if (child === failedChild) child = null }
      catch { if (!closed) setPhase('error', 'SUBSCRIPTION_STOP_UNCONFIRMED'); return }
      if (!closed) setPhase(controller.signal.aborted ? 'disabled' : 'error', controller.signal.aborted ? null : error.code?.startsWith('SUBSCRIPTION_') ? error.code : 'SUBSCRIPTION_COMPONENT_DOWNLOAD')
    }).finally(() => { if (job === operation) job = null })
    return status()
  }
  const stop = async ({ persist = true } = {}) => {
    job?.controller.abort(); const stoppingJob = job?.done
    enabled = false; setPhase('stopping'); const stopped = child; endpoint = null
    try { await stopCliProxyComponent(stopped); if (child === stopped) child = null }
    catch (error) { if (!closed) setPhase('error', 'SUBSCRIPTION_STOP_UNCONFIRMED'); throw error }
    if (stoppingJob) await stoppingJob
    if (persist) await privateJson(join(root, 'settings.json'), { enabled: false, proxyUrl })
    if (!closed) setPhase('disabled')
    return status()
  }
  return Object.freeze({ status, connection, request, fetchInference, enable, stop, verifyInstalled,
    async initialize() { await verifyInstalled(); try { const settings = JSON.parse(await readFile(join(root, 'settings.json'), 'utf8')); proxyUrl = subscriptionProxyUrl(settings.proxyUrl); if (settings.enabled === true && installed) enable() } catch {} return status() },
    async close() { if (closed) return; closed = true; closedSignal.abort(); await stop({ persist: false }); await localAgent.close().catch(() => {}) },
  })
}
