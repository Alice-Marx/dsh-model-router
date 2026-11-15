import React, { useEffect, useRef, useState } from 'react'
import { UiIcon } from './ui-icons.jsx'
import css from './subscription-accounts.css'

const phases = { disabled: '尚未启用', installing: '正在下载并校验登录组件…', starting: '正在启动登录服务…', ready: '登录服务已就绪', stopping: '正在停止…', error: '登录服务需要处理', unsupported: '当前系统尚不支持订阅登录' }
const accountStates = { disabled: '已停用', offline: '登录服务未连接', 'needs-login': '账户需要检查', 'needs-models': '尚未发现可用模型', ready: '已验证对话', configured: '已登录 · 待验证对话' }
const componentError = code => code === 'SUBSCRIPTION_COMPONENT_HASH' ? '下载的登录组件未通过校验，请重试。'
  : code === 'SUBSCRIPTION_COMPONENT_DOWNLOAD' ? '登录组件下载未完成，请检查网络或设置网络代理后重试。'
    : code === 'SUBSCRIPTION_PRIVATE_STATE_INVALID' ? '本机登录资料无效，请检查插件数据备份。' : '登录服务未能正常启动，请重试。'

export function SubscriptionAccounts({ productApi, onOpenBindings }) {
  const [view, setView] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [login, setLogin] = useState(null), [proxyUrl, setProxyUrl] = useState(''), [callbackUrl, setCallbackUrl] = useState('')
  const scope = useRef({ live: false, requests: new Set(), busy: false, epoch: 0 })
  const call = async (action, payload = {}) => {
    const current = scope.current, controller = new AbortController(); current.requests.add(controller)
    let rejectAbort
    const aborted = new Promise((_done, reject) => { rejectAbort = () => reject(new Error('请求已取消或超时，请重试。')); controller.signal.addEventListener('abort', rejectAbort, { once: true }) })
    const timeout = setTimeout(() => controller.abort(), action === 'subscriptions.login' ? 50_000 : 30_000)
    try { return await Promise.race([Promise.resolve().then(() => { controller.signal.throwIfAborted(); return productApi.dispatch(action, payload, controller.signal) }), aborted]) }
    finally { clearTimeout(timeout); current.requests.delete(controller); controller.signal.removeEventListener('abort', rejectAbort) }
  }
  const load = async () => {
    const current = scope.current, epoch = ++current.epoch
    const result = await call('subscriptions.list')
    if (!current.live || current.epoch !== epoch) return
    if (result?.schemaVersion !== 1 || !Array.isArray(result.accounts) || !Array.isArray(result.providers)) throw new Error('请更新完整 Bot 插件以使用订阅账户。')
    setView(result); setLogin(previous => previous ?? result.pendingLogins?.[0] ?? null)
  }
  const run = async (id, operation) => {
    const current = scope.current
    if (current.busy) return
    current.busy = true; current.epoch++; setBusy(id); setError(''); setNotice('')
    try { await operation() } catch (failure) { if (current.live) setError(failure?.message || '操作未完成，请重试。') }
    finally { current.busy = false; if (current.live) setBusy('') }
  }
  useEffect(() => {
    const current = scope.current; current.live = true
    const style = document.createElement('style'); style.dataset.subscriptionAccounts = '1'; style.textContent = css; document.head.append(style)
    void load().catch(failure => { if (current.live) setError(failure.message) })
    return () => { current.live = false; current.epoch++; for (const controller of current.requests) controller.abort(); style.remove() }
  }, [productApi])
  const phase = view?.service?.phase, ready = phase === 'ready', installing = ['installing', 'starting', 'stopping'].includes(phase)
  useEffect(() => setCallbackUrl(''), [login?.loginId])
  useEffect(() => {
    if (!installing) return
    let live = true, timer
    const tick = async () => { try { if (live) await load() } catch (failure) { if (live && scope.current.live) setError(failure.message) } finally { if (live) timer = setTimeout(tick, 1500) } }
    timer = setTimeout(tick, 600)
    return () => { live = false; clearTimeout(timer) }
  }, [installing])
  useEffect(() => {
    if (!login) return
    let live = true, timer
    const tick = async () => {
      try {
        const result = await call('subscriptions.loginStatus', { loginId: login.loginId })
        if (!live || !scope.current.live) return
        if (result.status === 'complete') { scope.current.epoch++; setView(result.view); setLogin(null); setNotice('账户已登录，模型已同步。可以为 Bot 选择模型和订阅额度。'); return }
        if (result.status === 'error') { setLogin(null); setError(result.message || '授权未完成，请重新登录。'); return }
      } catch (failure) { if (live && scope.current.live) { setLogin(null); setError(failure.message) } return }
      if (live) timer = setTimeout(tick, 2000)
    }
    timer = setTimeout(tick, 1000)
    return () => { live = false; clearTimeout(timer) }
  }, [login?.loginId])
  const refresh = () => run('refresh', async () => { const result = await call('subscriptions.refresh'); if (scope.current.live) { setView(result); setNotice('账户与模型目录已同步。') } })
  const enable = () => run('enable', async () => { await call('subscriptions.enable', { proxyUrl: proxyUrl.trim() }); await load() })
  const startLogin = provider => run(provider, async () => { const result = await call('subscriptions.login', { provider }); if (scope.current.live) setLogin(result) })
  const cancel = () => run('cancel', async () => { try { await call('subscriptions.cancelLogin', { loginId: login.loginId }) } finally { if (scope.current.live) setLogin(null) } })
  const submitCallback = () => run('callback', async () => { const url = callbackUrl.trim(); setCallbackUrl(''); await call('subscriptions.callback', { loginId: login.loginId, callbackUrl: url }); if (scope.current.live) setNotice('授权结果已提交，正在同步账户…') })
  const remove = account => run(account.id, async () => { await call('subscriptions.remove', { id: account.id, expectedRevision: account.revision }); await load(); if (scope.current.live) setNotice('此账户已从本机退出。') })
  return <div className="bp-subscriptions" aria-label="订阅账户">
    <div className="bp-ai-section-head"><div><h3>登录套餐账户</h3><p className="bp-ai-hint">使用你自己的订阅账户，登录后同步该账户可用的模型。</p></div><button type="button" disabled={!ready || Boolean(busy) || Boolean(login)} onClick={refresh}><UiIcon name="refresh" size={15}/>{busy === 'refresh' ? '同步中…' : '同步模型'}</button></div>
    {error && <div className="bp-ai-alert" role="alert">{error}<button type="button" disabled={Boolean(busy)} onClick={() => void run('load', load)}>刷新</button></div>}
    {notice && <p className="bp-ai-notice" role="status">{notice}</p>}
    {!view && !error && <p role="status">正在读取订阅账户…</p>}
    {view && <>
      <div className="bp-sub-service"><div><strong>{phases[phase] ?? '状态未知'}</strong><p>{ready ? '授权资料保存在这台电脑。可用模型与额度由你的账户提供。' : '启用后可在提供方的授权页面登录，无需填写提供方 API Key。'}</p></div>
        {!ready && <button type="button" className="bp-ai-primary" disabled={installing || phase === 'unsupported' || Boolean(busy)} onClick={enable}>{installing ? '正在准备…' : phase === 'error' ? '重试启动' : view.service.installed ? '启动登录服务' : '启用订阅登录'}</button>}
        {installing && phase !== 'stopping' && <button type="button" disabled={Boolean(busy)} onClick={() => void run('stop', async () => { const result = await call('subscriptions.stop'); if (scope.current.live) setView(result) })}>取消准备</button>}
      </div>
      {view.service.errorCode && <p className="bp-ai-alert" role="alert">{componentError(view.service.errorCode)}</p>}
      <details className="bp-sub-options"><summary>连接选项</summary><label>网络代理（可选）<input aria-label="订阅网络代理" value={proxyUrl} disabled={ready || installing || Boolean(busy)} onChange={event => setProxyUrl(event.target.value)} placeholder="自动使用本机网络设置"/></label><p>更改网络代理后重新启动登录服务。登录组件：CLIProxyAPI {view.service.version}。</p>
        {(ready || view.service.canStop) && <button type="button" disabled={Boolean(busy) || Boolean(login)} onClick={() => void run('stop', async () => { const result = await call('subscriptions.stop'); if (scope.current.live) setView(result) })}>停止登录服务</button>}
      </details>
      {login && <div className="bp-sub-login" role="region" aria-label="账户授权"><strong>完成账户授权</strong><p>在提供方页面确认登录。完成后，这里会自动同步账户与模型。</p>{login.userCode && <p>授权码：<code>{login.userCode}</code></p>}<div className="bp-sub-actions"><a className="bp-ai-primary" href={login.url} target="_blank" rel="noopener noreferrer">打开授权页面<UiIcon name="arrow" size={14}/></a><button type="button" disabled={Boolean(busy)} onClick={cancel}>取消登录</button></div><small>等待授权完成…</small>
        {login.supportsCallback && <details className="bp-sub-options"><summary>授权后无法自动返回？</summary><p>如果在其他设备授权，或授权后 localhost 页面打不开，请复制地址栏中的完整回调地址并粘贴到这里。</p><label>回调地址<input type="password" autoComplete="off" aria-label="授权回调地址" value={callbackUrl} onChange={event => setCallbackUrl(event.target.value)} placeholder="http://localhost:…/callback?code=…&state=…" disabled={Boolean(busy)}/></label><button type="button" disabled={Boolean(busy) || !callbackUrl.trim()} onClick={submitCallback}>提交授权结果</button></details>}
      </div>}
      <div className="bp-sub-providers">{view.providers.map(provider => <button type="button" key={provider.id} disabled={!ready || Boolean(busy) || Boolean(login) || provider.available === false} onClick={() => void startLogin(provider.id)}><UiIcon name="bot" size={18}/><span>{provider.name}<small>{provider.available === false ? provider.reason : busy === provider.id ? '正在准备授权…' : '登录账户'}</small></span></button>)}</div>
      <div className="bp-ai-section-head"><h3>已登录账户 <span>{view.accounts.length}</span></h3></div>
      <div className="bp-ai-provider-list">{view.accounts.map(account => <article className="bp-ai-provider bp-sub-account" key={account.id} data-subscription-account={account.id}><div className="bp-ai-mark" aria-hidden="true"><UiIcon name="bot" size={20}/></div><div className="bp-ai-copy"><h4>{account.name}</h4>{account.email && <small>{account.email}</small>}<p className="bp-ai-state" data-state={account.state === 'ready' ? 'ready' : 'configured'}><span/>{accountStates[account.state] ?? '状态待检查'} · {account.models.length} 个可用模型</p>
        {account.models.length > 0 && <details><summary>查看模型</summary><ul>{account.models.map(model => <li key={model.id}>{model.name}</li>)}</ul></details>}
        {account.missingModels.length > 0 && <small>另有 {account.missingModels.length} 个模型尚未提供容量信息，暂未加入选择列表。</small>}
        {account.usedBy.length > 0 && <small>使用中：{account.usedBy.map(bot => bot.name).join('、')}。切换这些 Bot 的模型后可退出账户。</small>}
      </div><button type="button" disabled={!ready || Boolean(busy) || account.usedBy.length > 0} onClick={() => void remove(account)}>退出账户</button></article>)}{!view.accounts.length && <p className="bp-ai-hint">尚未登录套餐账户。授权完成后，账户和模型会显示在这里。</p>}</div>
      {onOpenBindings && <button type="button" className="bp-ai-bot-link" onClick={onOpenBindings}>为 Bot 选择订阅模型<UiIcon name="chevron" size={15}/></button>}
    </>}
  </div>
}
