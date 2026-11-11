import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BotBindingEditor } from './binding-editor.jsx'
import { BotProfileIdentity } from './bot-profile-identity.jsx'
import { UiIcon } from './ui-icons.jsx'
import css from './bot-settings-dialog.css'

let nextScope = 0
export function BotSettingsDialog(props) {
  const key = useMemo(() => ++nextScope, [props.productApi, props.botId])
  return <SettingsDialog key={key} {...props}/>
}

function SettingsDialog({ productApi, botId, onClose, onOpenTools }) {
  const [view, setView] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('binding'), [identityVisited, setIdentityVisited] = useState(false)
  const tabId = useId()
  const surface = useRef(null), closeButton = useRef(null)
  const session = useRef({ live: false, epoch: 0, busy: false, requests: new Set() })
  const call = async (action, payload) => {
    const current = session.current, controller = new AbortController()
    current.requests.add(controller)
    let cancel
    const deadline = new Promise((_resolve, reject) => { cancel = () => reject(new Error('REQUEST_ABORTED')); controller.signal.addEventListener('abort', cancel, { once: true }) })
    const timer = setTimeout(() => controller.abort(), action === 'binding.inspect' && payload?.refreshOfficialTools === true ? 45000 : 10000)
    try { return await Promise.race([Promise.resolve().then(() => productApi.dispatch(action, payload, controller.signal)), deadline]) }
    finally { clearTimeout(timer); current.requests.delete(controller); controller.signal.removeEventListener('abort', cancel) }
  }
  const read = async (refreshOfficialTools = false) => {
    const current = session.current, epoch = ++current.epoch
    setLoading(true)
    try {
      const value = await call('binding.inspect', { botId, ...(refreshOfficialTools ? { refreshOfficialTools: true } : {}) })
      if (!current.live || epoch !== current.epoch) return
      if (value?.schemaVersion !== 1 || value.bot?.id !== botId || value.record?.botId !== botId) throw new Error('WRONG_BINDING_OWNER')
      setView(value); setError('')
    } catch (cause) {
      if (current.live && epoch === current.epoch) setError(['PRODUCT_ACTION_UNAVAILABLE', 'INVALID_PRODUCT_ACTION'].includes(cause?.code) ? '当前连接尚不支持模型与工具设置，请更新完整插件。' : '暂时无法读取这个 Bot 的设置，请重试。')
    } finally { if (current.live && epoch === current.epoch) setLoading(false) }
  }
  useEffect(() => {
    const current = session.current; current.live = true
    const restore = document.activeElement
    const style = document.createElement('style'); style.dataset.botSettingsDialog = '1'; style.textContent = css; document.head.append(style)
    closeButton.current?.focus()
    void read(true)
    return () => {
      current.live = false; current.epoch++
      for (const controller of current.requests) controller.abort()
      style.remove()
      if (restore?.isConnected && typeof restore.focus === 'function') restore.focus()
    }
  }, [productApi, botId])
  useEffect(() => {
    const keyboard = event => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || document.querySelector('.bp-model-popover')) return
      const active = document.activeElement
      if (!surface.current?.contains(active)) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose?.() }
      if (event.key === 'Tab') {
        const controls = [...surface.current.querySelectorAll('*')].filter(node => ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(node.tagName) && !node.disabled && node.getClientRects().length)
        if (event.shiftKey && active === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
        else if (!event.shiftKey && active === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
      }
    }
    document.addEventListener('keydown', keyboard)
    return () => document.removeEventListener('keydown', keyboard)
  }, [onClose])
  const dispatch = async (action, payload) => {
    const current = session.current
    if (!current.live || current.busy || !['binding.inspect', 'binding.save', 'funding.account.save'].includes(action) || (action !== 'funding.account.save' && payload?.botId !== botId)) throw new Error('设置暂时无法保存，请重新读取。')
    current.busy = true; setBusy(true)
    try {
      const result = await call(action, payload)
      if (action === 'binding.inspect') {
        if (result?.schemaVersion !== 1 || result.bot?.id !== botId || result.record?.botId !== botId) throw new Error('WRONG_BINDING_OWNER')
        if (current.live) { setView(result); setError('') }
      } else if (current.live) await read()
      return result
    } catch (cause) {
      if (cause?.message === 'REQUEST_ABORTED') {
        if (action === 'binding.inspect') throw new Error('工具检测超时或已取消，请重试。')
        if (current.live) setError('保存结果尚未确认，请重新读取后核对。')
        throw new Error('保存结果尚未确认，请重新读取后核对。')
      }
      throw cause
    } finally { current.busy = false; if (current.live) setBusy(false) }
  }
  const chooseTab = next => { setTab(next); if (next === 'identity') setIdentityVisited(true) }
  const tabKeys = event => {
    if (event.isComposing || event.keyCode === 229 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'binding' : event.key === 'End' ? 'identity' : tab === 'binding' ? 'identity' : 'binding'
    chooseTab(next)
    event.currentTarget.querySelector(`[data-settings-tab="${next}"]`)?.focus()
  }
  return createPortal(<div className="bp-bot-settings-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose?.() }}>
    <section ref={surface} className="bp-bot-settings-dialog" role="dialog" aria-modal="true" aria-label={`${view?.bot?.name ?? 'Bot'} 的设置`}>
      <header className="bp-bot-settings-header"><span className="bp-bot-settings-avatar"><UiIcon name="bot" size={23}/></span><div><h2>{view?.bot?.name ?? 'Bot 设置'}</h2><p>模型、工具与 Bot 个性</p></div><button ref={closeButton} type="button" aria-label="关闭 Bot 设置" onClick={onClose}><UiIcon name="close" size={19}/></button></header>
      <div className="bp-bot-settings-tabs" role="tablist" aria-label="Bot 设置分类" onKeyDown={tabKeys}>
        {[['binding', '模型与工具', 'spark'], ['identity', '身份与个性', 'bot']].map(([id, label, icon]) => <button key={id} type="button" role="tab" data-settings-tab={id} id={`${tabId}-${id}`} aria-controls={`${tabId}-${id}-panel`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => chooseTab(id)}><UiIcon name={icon} size={15}/>{label}</button>)}
      </div>
      <div className="bp-page bp-bot-settings-body">
        <div role="tabpanel" id={`${tabId}-binding-panel`} aria-labelledby={`${tabId}-binding`} hidden={tab !== 'binding'}>
        {loading && !view && <p className="bp-muted" role="status">正在读取 Bot 设置，检测安装、登录与执行能力…</p>}
        {error && <div className="bp-bot-settings-error" role="alert"><p>{error}</p><button type="button" disabled={busy || loading} onClick={() => void read(true)}>重新读取</button></div>}
        {view && <BotBindingEditor bot={view.bot} record={view.record} accounts={view.accounts} dispatch={dispatch} hostScope={productApi} busy={busy || loading || Boolean(error)} onOpenTools={onOpenTools}/>}
        </div>
        <div role="tabpanel" id={`${tabId}-identity-panel`} aria-labelledby={`${tabId}-identity`} hidden={tab !== 'identity'}>
          {identityVisited && <BotProfileIdentity productApi={productApi} botId={botId} busy={busy} onSaved={bot => setView(current => current && bot.id === botId ? { ...current, bot: { ...current.bot, name: bot.name, role: bot.role } } : current)}/>}
        </div>
      </div>
    </section>
  </div>, document.body)
}
