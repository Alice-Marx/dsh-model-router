import React, { useEffect, useRef, useState } from 'react'
import { UiIcon } from './ui-icons.jsx'
import css from './subscription-accounts.css'

const accountStates = {
  legacy: '旧版账户 · 请重新授权',
  'needs-login': '账户需要重新授权',
  'needs-consent': '已登录 · 等待套餐授权',
  'needs-models': '尚未发现可用模型',
  ready: '已验证对话',
  configured: '已授权 · 待验证对话',
}
const failure = (error, fallback = '操作未完成，请重试。') => ({ message: error?.message || fallback, code: error?.code })

export function SubscriptionAccounts({ productApi, onOpenBindings, onOpenTools }) {
  const [view, setView] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  const [login, setLogin] = useState(null)
  const [pollRevision, setPollRevision] = useState(0)
  const scope = useRef({ live: false, requests: new Set(), busy: false })

  const call = async (action, payload = {}) => {
    const controller = new AbortController(), current = scope.current
    current.requests.add(controller)
    let rejectAbort
    const aborted = new Promise((_done, reject) => {
      rejectAbort = () => reject(new Error('请求已取消或超时，请重试。'))
      controller.signal.addEventListener('abort', rejectAbort, { once: true })
    })
    const timeout = setTimeout(() => controller.abort(), 50_000)
    try {
      return await Promise.race([
        Promise.resolve().then(() => { controller.signal.throwIfAborted(); return productApi.dispatch(action, payload, controller.signal) }),
        aborted,
      ])
    } finally {
      clearTimeout(timeout)
      controller.signal.removeEventListener('abort', rejectAbort)
      current.requests.delete(controller)
    }
  }
  const load = async () => {
    const result = await call('subscriptions.list')
    if (!scope.current.live) return
    if (result?.schemaVersion !== 1 || !Array.isArray(result.accounts) || !Array.isArray(result.providers)) {
      throw new Error('请更新完整 Bot 插件以使用订阅账户。')
    }
    setView(result)
    setLogin(result.pendingLogins?.[0] ?? null)
  }
  const run = async (id, operation) => {
    const current = scope.current
    if (current.busy) return
    current.busy = true
    setBusy(id)
    setError(null)
    setNotice('')
    try { await operation() }
    catch (cause) { if (current.live) setError(failure(cause)) }
    finally { current.busy = false; if (current.live) setBusy('') }
  }
  useEffect(() => {
    const current = scope.current
    current.live = true
    const style = document.createElement('style')
    style.dataset.subscriptionAccounts = '1'
    style.textContent = css
    document.head.append(style)
    void load().catch(cause => { if (current.live) setError(failure(cause)) })
    return () => {
      current.live = false
      for (const controller of current.requests) controller.abort()
      style.remove()
    }
  }, [productApi])
  const cancelling = busy === 'cancel'
  useEffect(() => {
    if (!login || cancelling) return
    let live = true, timer
    const tick = async () => {
      try {
        const result = await call('subscriptions.loginStatus', { loginId: login.loginId })
        if (!live || !scope.current.live) return
        if (result.status === 'complete') {
          setView(result.view)
          setLogin(null)
          setNotice(result.notice ?? '账户已授权，模型目录已同步。')
          return
        }
        if (result.status === 'error') {
          setLogin(null)
          setError(failure(result, '授权未完成，请重试。'))
          return
        }
        if (result.login) setLogin(result.login)
      } catch (cause) {
        if (live && scope.current.live) setError(failure(cause))
        return
      }
      if (live) timer = setTimeout(tick, 1500)
    }
    timer = setTimeout(tick, 600)
    return () => { live = false; clearTimeout(timer) }
  }, [login?.loginId, cancelling, pollRevision, productApi])
  const reload = () => run('load', async () => { await load(); if (scope.current.live) setPollRevision(value => value + 1) })
  const refresh = () => run('refresh', async () => {
    const result = await call('subscriptions.refresh')
    if (scope.current.live) { setView(result); setNotice('账户与模型目录已更新。') }
  })
  const connect = (provider, account) => run(provider, async () => {
    const result = await call('subscriptions.login', { provider, ...(account ? {
      id: account.id, expectedRevision: account.revision, ...(account.state === 'needs-consent' ? { consent: true } : {}),
    } : {}) })
    if (scope.current.live) setLogin(result)
  })
  const cancel = () => run('cancel', async () => {
    await call('subscriptions.cancelLogin', { loginId: login.loginId })
    if (scope.current.live) setLogin(null)
  })
  const remove = account => run(account.id, async () => {
    const result = await call('subscriptions.remove', { id: account.id, expectedRevision: account.revision })
    if (scope.current.live) {
      await load()
      setNotice(result?.revoked === false ? '已在本机退出。请在 ChatGPT 设置中断开应用以撤销远端授权。' : '此账户已从 DS Bot 退出。')
    }
  })
  const ready = view?.service?.phase === 'ready'
  return <div className="bp-subscriptions" aria-label="订阅账户">
    <div className="bp-ai-section-head">
      <div><h3>登录套餐账户</h3><p className="bp-ai-hint">完成厂商授权后，可为 Bot 使用这个账户的模型。</p></div>
      <button type="button" disabled={!ready || !view.accounts.some(account => account.state !== 'legacy') || Boolean(busy) || Boolean(login)} onClick={refresh}>
        <UiIcon name="refresh" size={15}/>{busy === 'refresh' ? '同步中…' : '同步模型'}
      </button>
    </div>
    {error && <div className="bp-ai-alert" role="alert">{error.message}
      {error.code === 'SUBSCRIPTION_CODEX_REQUIRED' && onOpenTools
        ? <button type="button" disabled={Boolean(busy)} onClick={onOpenTools}>打开官方工具</button>
        : <button type="button" disabled={Boolean(busy)} onClick={reload}>刷新</button>}
    </div>}
    {notice && <p className="bp-ai-notice" role="status">{notice}</p>}
    {!view && !error && <p role="status">正在读取订阅账户…</p>}
    {view && <>
      {!ready && <p role="status">当前宿主尚未支持 ChatGPT／Codex 订阅授权。</p>}
      <div className="bp-sub-providers">{view.providers.map(provider =>
        <button type="button" key={provider.id} disabled={!ready || Boolean(busy) || Boolean(login) || provider.available === false}
          onClick={() => void connect(provider.id)}>
          {provider.id === 'chatgpt' ? 'Continue with ChatGPT' : <><UiIcon name="bot" size={18}/><span>{provider.name}<small>连接账户</small></span></>}
        </button>)}</div>
      {view.providers.some(provider => provider.id === 'chatgpt' && provider.available) &&
        <p className="bp-ai-hint">ChatGPT 套餐连接用于文本对话。<a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">查看 ChatGPT 套餐用量和限制</a></p>}
      {login?.preparing && <div className="bp-sub-service" role="region" aria-label="正在准备账户授权">
        <strong role="status">正在准备账户授权…</strong><button type="button" disabled={Boolean(busy)} onClick={cancel}>取消登录</button>
      </div>}
      {login?.url && <div className="bp-sub-login" role="region" aria-label="账户授权">
        <strong>完成账户授权</strong>
        <p>在宿主所在电脑的浏览器中确认登录，完成后回到 DS Bot。</p>
        <div className="bp-sub-actions">
          <a className="bp-ai-primary" href={login.url} target="_blank" rel="noopener noreferrer">打开授权页面<UiIcon name="arrow" size={14}/></a>
          <button type="button" disabled={Boolean(busy)} onClick={cancel}>取消登录</button>
        </div>
        <small>等待授权完成…</small>
      </div>}
      <div className="bp-ai-section-head"><h3>订阅账户 <span>{view.accounts.length}</span></h3></div>
      <div className="bp-ai-provider-list">
        {view.accounts.map(account => <article className="bp-ai-provider bp-sub-account" key={account.id} data-subscription-account={account.id}>
          <div className="bp-ai-mark" aria-hidden="true"><UiIcon name="bot" size={20}/></div>
          <div className="bp-ai-copy">
            <h4>{account.name}</h4>
            {(account.email || account.plan) && <small>{[account.email, account.plan].filter(Boolean).join(' · ')}</small>}
            <p className="bp-ai-state" data-state={account.state === 'ready' ? 'ready' : 'configured'}>
              <span/>{accountStates[account.state] ?? '状态待检查'}{account.enabled && ' · ' + account.models.length + ' 个可用模型'}
            </p>
            {account.state === 'legacy' && <small>请在上方重新授权账户，并为相关 Bot 选择新的订阅模型。</small>}
            {account.models.length > 0 && <details><summary>查看模型</summary><ul>{account.models.map(model => <li key={model.id}>{model.name}</li>)}</ul></details>}
            {account.usedBy.length > 0 && <small>使用中：{account.usedBy.map(bot => bot.name).join('、')}。</small>}
          </div>
          {account.kind === 'chatgpt' && <div className="bp-sub-actions">
            <button type="button" disabled={Boolean(busy) || Boolean(login) || !ready} onClick={() => void connect('chatgpt', account)}>
              {account.state === 'needs-consent' ? '启用套餐使用' : '重新授权'}
            </button>
            {account.state !== 'needs-login' && <button type="button" disabled={Boolean(busy) || Boolean(login)} onClick={() => void remove(account)}>退出账户</button>}
          </div>}
          {account.kind !== 'chatgpt' && account.state !== 'legacy' && <button type="button" disabled={Boolean(busy) || Boolean(login) || account.usedBy.length > 0} onClick={() => void remove(account)}>退出账户</button>}
        </article>)}
        {!view.accounts.length && <p className="bp-ai-hint">授权后的账户和模型会显示在这里。</p>}
      </div>
      {onOpenBindings && view.accounts.some(account => account.enabled && account.models.length) &&
        <button type="button" className="bp-ai-bot-link" onClick={onOpenBindings}>为 Bot 选择订阅模型<UiIcon name="chevron" size={15}/></button>}
    </>}
  </div>
}
