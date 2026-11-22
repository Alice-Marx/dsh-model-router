import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { createRemoteJWKSet, jwtVerify } from 'jose'

export const CHATGPT_RESOURCE = 'https://api.openai.com/v1'
const issuer = 'https://auth.openai.com'
const dynamicClient = 'dynamic_agent_client'
const direct = ['resource.invoke', 'chatgpt.tokens.use.direct']
const scope = ['openid', 'profile', 'email', 'offline_access', ...direct].join(' ')
const callbackPath = '/auth/callback'
const terminalRefresh = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired',
  'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'])
const opaque = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && /^[\x21-\x7e]+$/.test(value)
const issuedClient = value => opaque(value, 240) && /^oaiapp_[\w-]+$/.test(value)
const random = () => randomBytes(32).toString('base64url')
export const planError = (code, message) => Object.assign(new Error(message), { code: 'SUBSCRIPTION_' + code })
export const hasPlanGrant = value => direct.every(item => value?.scope?.split(/\s+/).includes(item))

const oidcKeys = createRemoteJWKSet(new URL(issuer + '/.well-known/jwks.json'))
const verify = async (token, clientId) => (await jwtVerify(token, oidcKeys, {
  issuer, audience: clientId, requiredClaims: ['exp', 'sub', 'iat'],
})).payload

const deadline = signal => AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])])
const safeText = (value, max) => typeof value === 'string' && !/\p{Cc}/u.test(value) ? value.slice(0, max) : ''

export function createChatGptPlanOAuth({ fetcher = globalThis.fetch, verifyIdentity = verify, now = Date.now } = {}) {
  const form = (url, params, signal) => fetcher(url, {
    method: 'POST', body: new URLSearchParams(params), redirect: 'error', signal: deadline(signal),
    headers: { accept: 'application/json' },
  })
  const exchange = async (params, previous, signal) => {
    const response = await form(issuer + '/api/accounts/oauth/token', { ...params, resource: CHATGPT_RESOURCE }, signal)
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      if (previous && terminalRefresh.has(body?.error)) throw planError('AUTH_REQUIRED', 'ChatGPT 授权已失效，请重新登录。')
      throw planError('TOKEN_FAILED', 'ChatGPT 授权服务未能发放凭据（HTTP ' + response.status + '）。')
    }
    const expiresIn = body?.expires_in
    const granted = body?.scope ?? previous?.scope
    if (!opaque(body?.access_token, 32_768) || !Number.isSafeInteger(expiresIn) || expiresIn < 1 || expiresIn > 86_400
        || typeof granted !== 'string' || granted.length > 2_048 || typeof body.token_type !== 'string' || body.token_type.toLowerCase() !== 'bearer'
        || body.id_token !== undefined && !opaque(body.id_token, 32_768)
        || (body.refresh_token !== undefined || previous || granted.split(/\s+/).includes('offline_access'))
          && !opaque(body.refresh_token, 32_768)) {
      throw planError('TOKEN_INVALID', 'ChatGPT 授权服务返回了无效的凭据。')
    }
    return { accessToken: body.access_token, refreshToken: body.refresh_token ?? null,
      scope: granted, expiresAt: now() + expiresIn * 1000, idToken: body.id_token ?? null }
  }

  async function begin({ hostId, account, consent, signal, onResult }) {
    const state = random(), nonce = random(), verifier = random()
    let redirectUri, consumed = false
    const headers = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store',
      'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', connection: 'close' }
    const close = () => {
      signal.removeEventListener('abort', close)
      if (server.listening) server.close()
    }
    const server = createServer({ requestTimeout: 5_000 }, (req, res) => {
      let incoming
      try {
        if (req.url?.startsWith('/')) incoming = new URL(req.url, redirectUri)
      } catch {}
      if (req.method !== 'GET' || !incoming || incoming.origin !== new URL(redirectUri).origin
          || incoming.pathname !== callbackPath || req.headers.host !== incoming.host) {
        res.writeHead(404, headers).end('Not found')
        return
      }
      const query = incoming.searchParams
      if (consumed || query.getAll('state').length !== 1 || query.get('state') !== state) {
        res.writeHead(400, headers).end('Invalid or expired authorization.')
        return
      }
      consumed = true
      res.writeHead(200, headers).end('Return to DS Bot to finish connecting your ChatGPT account.')
      close()
      const result = (async () => {
        if (query.has('error')) throw planError('CONSENT_DECLINED', 'ChatGPT 授权未获批准。')
        const clientId = query.get('client_id') ?? account?.clientId
        if (!issuedClient(clientId) || query.getAll('client_id').length > 1 || account && account.clientId !== clientId
            || query.getAll('code').length !== 1 || !opaque(query.get('code'), 4096)) {
          throw planError('CALLBACK_INVALID', 'ChatGPT 授权回调无效，请重新登录。')
        }
        const tokens = await exchange({ grant_type: 'authorization_code', client_id: clientId, code: query.get('code'),
          code_verifier: verifier, redirect_uri: redirectUri }, null, signal)
        let claims
        try { claims = await verifyIdentity(tokens.idToken, clientId) } catch {}
        if (!opaque(claims?.sub, 1024) || claims.nonce !== nonce || account && claims.sub !== account.subject) {
          throw planError('IDENTITY_INVALID', '无法验证所选 ChatGPT 账户，请重新登录。')
        }
        return { clientId, subject: claims.sub, email: safeText(claims.email, 160), tokens }
      })()
      onResult(result)
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    server.on('error', close)
    signal.addEventListener('abort', close, { once: true })
    if (signal.aborted) { close(); signal.throwIfAborted() }
    redirectUri = `http://127.0.0.1:${server.address().port}${callbackPath}`
    const url = new URL(issuer + '/api/accounts/authorize')
    url.search = new URLSearchParams({
      client_id: account?.clientId ?? dynamicClient, ext_agent_host_id: hostId,
      ...(account ? {} : { agent_name_hint: 'DS Bot' }),
      ...(account?.email ? { login_hint: account.email } : {}),
      ...(consent ? { prompt: 'consent' } : {}),
      response_type: 'code', redirect_uri: redirectUri, scope, resource: CHATGPT_RESOURCE, state, nonce,
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    })
    return { url: url.href, close }
  }

  async function revoke(clientId, refreshToken) {
    if (!refreshToken) return true
    let endpoint
    try {
      const discovery = await fetcher(issuer + '/.well-known/openid-configuration', { redirect: 'error', signal: deadline() })
      if (!discovery.ok) return false
      const config = await discovery.json()
      endpoint = new URL(config.revocation_endpoint)
      if (config.issuer !== issuer || endpoint.origin !== issuer || endpoint.username || endpoint.password) return false
    } catch { return false }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await form(endpoint, { token: refreshToken, token_type_hint: 'refresh_token', client_id: clientId })
        if (response.status === 200) return true
        if (response.status < 500) return false
      } catch {}
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 350))
    }
    return false
  }

  return { begin, revoke, refresh: (clientId, tokens, signal) => exchange({
    grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refreshToken,
  }, tokens, signal) }
}
