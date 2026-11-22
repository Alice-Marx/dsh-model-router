import { createChatGptPlanOAuth, hasPlanGrant, planError } from './chatgpt-plan-oauth.mjs'
import { chatGptPlanModels } from './chatgpt-plan-adapter.mjs'

export function createChatGptPlanCredentials({ credentials, fetcher = globalThis.fetch,
  now = Date.now, oauth = createChatGptPlanOAuth({ fetcher, now }) }) {
  const key = id => 'model-router-galgame/chatgpt-plan-' + id
  const store = () => {
    const result = credentials?.()
    if (!result?.modifyRecord || !result?.readRecord) {
      throw planError('STORE_UNAVAILABLE', '当前宿主未提供受保护的 ChatGPT 凭据存储。')
    }
    return result
  }
  const matches = (record, account) => record?.kind === 'grant'
    && record.payload?.clientId === account.clientId && record.payload?.subject === account.subject
  const recordFor = (account, tokens) => ({
    kind: 'grant', payload: { clientId: account.clientId, subject: account.subject, tokens },
  })
  const access = async (account, signal) => {
    signal?.throwIfAborted()
    const vault = store(), address = key(account.id)
    const current = await vault.readRecord(address)
    if (matches(current, account) && hasPlanGrant(current.payload.tokens) && current.payload.tokens.expiresAt > now() + 45_000) {
      signal?.throwIfAborted()
      return current.payload.tokens.accessToken
    }
    let ended = false
    const updated = await vault.modifyRecord(address, async record => {
      signal?.throwIfAborted()
      if (!matches(record, account) || !hasPlanGrant(record.payload.tokens) || record.payload.tokens.expiresAt > now() + 45_000) return undefined
      const tokens = record.payload.tokens
      if (!tokens.refreshToken) return undefined
      try {
        // Once sent, let a rotating refresh finish and persist even if the caller cancels.
        const replacement = await oauth.refresh(account.clientId, tokens)
        return recordFor(account, { ...replacement, idToken: replacement.idToken ?? tokens.idToken })
      } catch (error) {
        if (error.code !== 'SUBSCRIPTION_AUTH_REQUIRED') throw error
        ended = true
        return recordFor(account, null)
      }
    })
    signal?.throwIfAborted()
    const tokens = matches(updated, account) && updated.payload.tokens
    if (ended || !tokens || tokens.expiresAt <= now()) throw planError('AUTH_REQUIRED', 'ChatGPT 授权已到期，请重新登录。')
    if (!hasPlanGrant(tokens)) throw planError('PLAN_DISABLED', '请授权使用 ChatGPT 套餐。')
    return tokens.accessToken
  }

  return {
    fetcher,
    get available() { try { store(); return true } catch { return false } },
    begin: oauth.begin,
    discard: result => oauth.revoke(result.clientId, result.tokens.refreshToken),
    models: (token, signal) => chatGptPlanModels(token, fetcher, signal),
    access,
    async install(account, tokens, commit) {
      const vault = store(), address = key(account.id)
      let previous
      const next = recordFor(account, tokens)
      await vault.modifyRecord(address, async current => { previous = current; return next })
      try { commit() }
      catch (error) {
        await vault.modifyRecord(address, async current => {
          if (current?.payload?.tokens?.accessToken !== tokens.accessToken) return undefined
          return previous ?? recordFor(account, null)
        })
        throw error
      }
    },
    async disconnect(account) {
      let revoked = true
      await store().modifyRecord(key(account.id), async record => {
        if (!matches(record, account) || !record.payload.tokens) return undefined
        revoked = await oauth.revoke(account.clientId, record.payload.tokens.refreshToken)
        return recordFor(account, null)
      })
      return revoked
    },
  }
}
