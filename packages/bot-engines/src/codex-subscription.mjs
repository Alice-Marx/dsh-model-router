import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { signedCodexAccountExecutable } from '../../../.dsh-plugin/shared/official-tool-executor.mjs'
import { DEFAULT_LAUNCHER, createSupervisorPipe, launchAcpProcess, pinAcpEntry } from '../../bot-acp/src/native-launch.mjs'
import { createStdioRpc } from '../../bot-acp/src/stdio-rpc.mjs'
import { privateEnvironment } from '../../cli-runtime/src/native-process.mjs'
import { codexProfileConfig, codexSubscriptionWindows } from './codex-engine.mjs'

const execute = promisify(execFile)
const fail = (code, message) => Object.assign(new Error(message), { code })
const accountId = /^[a-f0-9]{32}$/
const modelId = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,239}$/
const authHosts = new Set(['auth.openai.com', 'auth0.openai.com', 'chatgpt.com'])
const profileConfig = codexProfileConfig()
const publicText = (value, max) => typeof value === 'string' && value.length <= max && !/\p{Cc}/u.test(value) ? value.trim() : ''

export function codexAuthorizationUrl(raw) {
  try {
    const url = new URL(raw)
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port && authHosts.has(url.hostname)) return url.href
  } catch {}
  throw fail('SUBSCRIPTION_AUTH_URL', 'Codex 未返回有效的官方授权地址。')
}

export async function resolveCodexSubscriptionEntry(home, signal) {
  const executable = await signedCodexAccountExecutable(home)
  if (!executable) throw fail('SUBSCRIPTION_CODEX_REQUIRED', '请先在 DS Bot 的官方工具页安装或修复 Codex。')
  const { stdout } = await execute(executable, ['--version'], { cwd: home, env: privateEnvironment(home), signal,
    timeout: 10_000, maxBuffer: 4096, windowsHide: true })
  const match = /^codex-cli ([0-9][A-Za-z0-9.+_-]{0,31})$/m.exec(stdout.trim())
  if (!match) throw fail('SUBSCRIPTION_CODEX_REQUIRED', '请在 DS Bot 的官方工具页检查 Codex 版本。')
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(executable)) digest.update(chunk)
  return { executable, version: match[1], sha256: digest.digest('hex') }
}

/** The official control protocol runs only in DS Bot-owned account directories. */
export function createCodexSubscriptionBackend({ root, resolveEntry = resolveCodexSubscriptionEntry, launcher = DEFAULT_LAUNCHER } = {}) {
  const homeFor = async (id, create = false) => {
    if (!accountId.test(id)) throw fail('SUBSCRIPTION_ACCOUNT_INVALID', '订阅账户标识无效。')
    if (create) await mkdir(root, { recursive: true, mode: 0o700 })
    const home = join(await realpath(root), id)
    if (create) await mkdir(home, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
    const info = await lstat(home)
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(home) !== home) {
      throw fail('SUBSCRIPTION_STORAGE_INVALID', '订阅账户目录无效。')
    }
    return home
  }
  const checkedFile = async (home, name, limit) => {
    const path = join(home, name), info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > limit) {
      throw fail('SUBSCRIPTION_STORAGE_INVALID', '订阅账户资料无效。')
    }
    return path
  }
  const checkConfig = async home => {
    const file = await checkedFile(home, 'config.toml', 4096)
    if (await readFile(file, 'utf8') !== profileConfig) throw fail('SUBSCRIPTION_STORAGE_INVALID', '订阅账户的私有配置已更改，请重新授权。')
  }
  const credentialHome = async id => {
    try {
      const home = await homeFor(id)
      await checkConfig(home)
      await checkedFile(home, 'auth.json', 128_000)
      return home
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      throw fail('SUBSCRIPTION_AUTH_REQUIRED', '订阅账户需要重新授权。')
    }
  }
  const forget = async id => {
    try { await unlink(await checkedFile(await homeFor(id), 'auth.json', 128_000)) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const open = async (id, { signal, create = false, onLogin = () => {} } = {}) => {
    signal?.throwIfAborted()
    const home = create ? await homeFor(id, true) : await credentialHome(id)
    const probe = await launcher.probe({ home })
    if (!probe.available) throw fail('SUBSCRIPTION_CODEX_UNAVAILABLE', '当前宿主无法运行受管理的 Codex 会话。')
    await launcher.protect(probe.helper, home)
    for (const directory of ['tmp', 'cache', 'config', 'data', 'appdata', 'local']) await mkdir(join(home, directory), { recursive: true, mode: 0o700 })
    if (create) await writeFile(join(home, 'config.toml'), profileConfig, { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error })
    await checkConfig(home)
    const entry = await resolveEntry(home, signal)
    const pin = await pinAcpEntry(entry, home)
    signal?.throwIfAborted()
    const { supervisor } = await launchAcpProcess({
      entry: pin, args: ['app-server', '--listen', 'stdio://'], cwd: home, home, ttlMs: 360_000, launcher, probe,
    })
    const wire = createSupervisorPipe(supervisor)
    const unpack = ({ jsonrpc: _version, ...frame }) => frame
    const pipe = { ...wire, write: frame => wire.write(unpack(frame)), send: frame => wire.send(unpack(frame)) }
    const rpc = createStdioRpc({ pipe, maxPending: 8, requestTimeoutMs: 12_000, idleTimeoutMs: 12_000 })
    let closeJob, proof
    supervisor.events.on('control', frame => { if (frame.control === 'stopped') proof = frame })
    const close = () => {
      closeJob ??= (async () => {
        const stopped = proof ? Promise.resolve(proof) : supervisor.waitControl('stopped', 6000).catch(() => null)
        rpc.close()
        signal?.removeEventListener('abort', abort)
        const result = await stopped
        if (!result?.treeStopped) throw fail('SUBSCRIPTION_STOP_UNCONFIRMED', '尚未确认 Codex 授权会话已结束。')
      })()
      return closeJob
    }
    const abort = () => { void close().catch(() => {}) }
    signal?.addEventListener('abort', abort, { once: true })
    pipe.events.on('rpc-request', ({ id: frameId }) => rpc.respondError(frameId, -32601, 'Not available in an account session'))
    pipe.events.on('rpc-notification', ({ method, params }) => {
      if (method === 'account/login/completed' && typeof params?.loginId === 'string') onLogin(params.loginId, params.success === true)
    })
    const request = async (method, params, requestSignal = signal, timeoutMs = 12_000) => {
      requestSignal?.throwIfAborted()
      try { return await rpc.request(method, params, { signal: requestSignal, timeoutMs }) }
      catch {
        requestSignal?.throwIfAborted()
        throw fail('SUBSCRIPTION_CODEX_REQUEST', 'Codex 账户服务请求未完成，请重试。')
      }
    }
    try {
      await request('initialize', { clientInfo: { name: 'dsh_bot_accounts', title: 'DSH Bot Accounts', version: '1.0.0' } })
      rpc.notify('initialized', {})
    } catch (error) { await close().catch(() => {}); throw error }
    const readAccount = async requestSignal => {
      const { account } = await request('account/read', { refreshToken: false }, requestSignal)
      if (account?.type !== 'chatgpt') throw fail('SUBSCRIPTION_AUTH_REQUIRED', '请授权 ChatGPT 账户。')
      return { email: publicText(account.email, 160), plan: publicText(account.planType, 40) }
    }
    const readQuota = async requestSignal => {
      try {
        const result = await request('account/rateLimits/read', {}, requestSignal, 7000)
        return codexSubscriptionWindows(result.rateLimitsByLimitId?.codex ?? result.rateLimits)
      } catch {
        requestSignal?.throwIfAborted()
        return null
      }
    }
    return Object.freeze({
      entry,
      async login() {
        const result = await request('account/login/start', { type: 'chatgpt' })
        if (result.type !== 'chatgpt' || !/^[A-Za-z0-9-]{1,128}$/.test(result.loginId ?? '')) {
          throw fail('SUBSCRIPTION_AUTH_URL', 'Codex 未返回有效的授权会话。')
        }
        return { peerId: result.loginId, url: codexAuthorizationUrl(result.authUrl) }
      },
      cancel: peerId => request('account/login/cancel', { loginId: peerId }),
      async snapshot(requestSignal, { quotaOnly = false } = {}) {
        const account = await readAccount(requestSignal)
        if (quotaOnly) return { windows: await readQuota(requestSignal) }
        const models = new Map()
        let cursor
        for (let index = 0; index < 3; index++) {
          const page = await request('model/list', { includeHidden: false, limit: 64, ...(cursor ? { cursor } : {}) }, requestSignal, 7000)
          if (!Array.isArray(page.data)) throw fail('SUBSCRIPTION_MODELS_UNAVAILABLE', 'Codex 未返回模型目录。')
          for (const item of page.data) {
            const id = item?.model ?? item?.id
            if (item?.hidden !== true && modelId.test(id ?? '') && Array.isArray(item.inputModalities) && item.inputModalities.includes('text')) {
              models.set(id, { id, name: publicText(item.displayName, 120) || id })
            }
          }
          const next = publicText(page.nextCursor, 1024)
          if (models.size > 64 || (next && next === cursor)) break
          if (!next) return { ...account, models: [...models.values()], windows: await readQuota(requestSignal) }
          cursor = next
        }
        throw fail('SUBSCRIPTION_MODELS_UNAVAILABLE', 'Codex 模型目录超出宿主可处理范围。')
      },
      close,
      get closed() { return rpc.closed },
    })
  }
  return Object.freeze({ available: process.platform === 'win32', open, credentialHome, forget })
}
