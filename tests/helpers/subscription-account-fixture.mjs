import { mkdir, writeFile, unlink, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { codexProfileConfig } from '../../packages/bot-engines/src/codex-engine.mjs'
import { nativeRpcFixtureEntry } from './native-rpc-fixture-launcher.mjs'

const missingAuth = () => Object.assign(new Error('请重新授权账户。'), { code: 'SUBSCRIPTION_AUTH_REQUIRED' })
const authorization = 'https://auth.openai.com/authorize?state=offline-fixture'
const peerId = 'fixture-login'

export async function subscriptionFixture(root) {
  const entry = await nativeRpcFixtureEntry(resolve('tests/fixtures/native-chat-protocol-fixture.mjs'))
  const accounts = new Map(), sessions = new Map(), operations = []
  const model = { id: 'gpt-fixture', name: 'Fixture Codex' }
  const primary = { id: 'primary', remainingPercent: 65, durationMinutes: 300, resetAt: 1900000000000 }
  const fixture = {
    accounts, sessions, operations, entry,
    prepare: async () => {},
    async complete(id = [...sessions.keys()].at(-1), fields = {}) {
      const session = sessions.get(id)
      if (!session) throw new Error('Start fixture authorization before completing it')
      const home = join(root, id)
      await mkdir(home, { recursive: true })
      await writeFile(join(home, 'config.toml'), codexProfileConfig())
      await writeFile(join(home, 'auth.json'), '{"fixture":"private-oauth-token"}', { mode: 0o600 })
      accounts.set(id, { email: 'fixture@example.invalid', plan: 'plus', models: [model], windows: [primary], ...fields })
      session.onLogin(peerId, true)
    },
  }
  fixture.backend = {
    available: true,
    async open(id, { signal, create, onLogin } = {}) {
      operations.push({ kind: 'open', id })
      await fixture.prepare({ id, signal, create })
      signal?.throwIfAborted()
      const session = {
        entry, onLogin, closed: false,
        async login() {
          operations.push({ kind: 'login', id })
          return { peerId, url: authorization }
        },
        async cancel(loginId) { operations.push({ kind: 'cancel', id, loginId }) },
        async snapshot(requestSignal, { quotaOnly } = {}) {
          requestSignal?.throwIfAborted()
          const value = accounts.get(id)
          if (!value) throw missingAuth()
          operations.push({ kind: 'snapshot', id, quotaOnly: Boolean(quotaOnly) })
          return quotaOnly ? { windows: value.windows } : { ...value }
        },
        async close() {
          if (session.closed) return
          operations.push({ kind: 'close', id })
          session.closed = true
        },
      }
      if (create) sessions.set(id, session)
      return session
    },
    async credentialHome(id) {
      if (!accounts.has(id)) throw missingAuth()
      const home = join(root, id)
      await access(join(home, 'auth.json'))
      return home
    },
    async forget(id) {
      accounts.delete(id)
      sessions.delete(id)
      await unlink(join(root, id, 'auth.json')).catch(error => { if (error.code !== 'ENOENT') throw error })
    },
  }
  return fixture
}

export async function pendingSubscription(dispatch) {
  const started = await dispatch('login', { provider: 'codex' })
  for (let attempt = 0; attempt < 50; attempt++) {
    const result = await dispatch('loginStatus', { loginId: started.loginId })
    if (result.status === 'pending') return result.login
    if (result.status === 'error') throw new Error(result.message)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Fixture could not reach authorization')
}
