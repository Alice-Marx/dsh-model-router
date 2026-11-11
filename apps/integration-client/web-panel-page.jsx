import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UiIcon } from './ui-icons.jsx'
import {
  MAX_WEB_PANELS, WEB_PANEL_LOAD_TIMEOUT_MS, WEB_PANEL_REFERRER_POLICY, WEB_PANEL_SANDBOX,
  actionError, clientOrigin, framingMessage, isSelfOrigin, movedOrder, openExternally, panelsOf, validateWebPanelDraft,
} from './web-panel-model.mjs'

// A pinned page shown inside the workspace instead of the chat. The list is the
// Host's own directory (never this browser's), the frame is a real cross-origin
// iframe, and a page that refuses framing — or never loads — is answered with the
// reason plus a way to open it in the browser.
//
// Every async result is checked against the Host it was asked of: a replaced Host
// remounts this board, so a late answer from the previous one cannot name a page
// the new Host never served.

let scopeKey = 0
export function WebPanelsPanel(props) {
  // One board per Host. A replaced product API gets a fresh board instead of a
  // component that has to remember which answers are still allowed to land.
  const key = useMemo(() => ++scopeKey, [props.productApi])
  return <WebPanelBoard key={key} {...props} />
}

/** The sidebar's compact pin list: the same Host directory, one click to a page. */
export function WebPanelPins({ panels = [], activeId, onSelect, busy = false }) {
  if (!panels.length) return null
  return <nav className="bp-webpanel-pins" aria-label="固定网页面板">
    <p className="bp-webpanel-pins-label">常用网页</p>
    <ul>{panels.map(panel => <li key={panel.id}>
      <button type="button" className="bp-webpanel-pin" aria-current={activeId === panel.id ? 'page' : undefined}
        disabled={busy} title={`${panel.name} · ${panel.host}`} onClick={() => onSelect?.(panel.id)}>
        <UiIcon name="board" size={15} />
        <span className="bp-webpanel-pin-name">{panel.name}</span>
        <span className="bp-webpanel-pin-host">{panel.host}</span>
      </button>
    </li>)}</ul>
  </nav>
}

function WebPanelBoard({ productApi, dispatch, busy = false, snapshot, available = true, onLeave, selectedId: drivenId, onSelect }) {
  const { status, items, revision, limits, reason, nextAction } = panelsOf(snapshot)
  const [ownId, setOwnId] = useState(null)
  const [reloads, setReloads] = useState(0)
  const [probes, setProbes] = useState({})
  const [draft, setDraft] = useState(null)
  const [draftError, setDraftError] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [frame, setFrame] = useState('loading')
  const origin = clientOrigin()
  const leave = useRef(onLeave)
  leave.current = onLeave
  // The selection is the board's own unless a parent drives it, so the sidebar pin
  // list and the board can never disagree about which page is on screen.
  const selectedId = typeof drivenId === 'string' && drivenId ? drivenId : ownId
  const select = useCallback(id => { setOwnId(id); setReloads(0); setFrame('loading'); if (typeof onSelect === 'function') onSelect(id) }, [onSelect])

  const panel = items.find(entry => entry.id === selectedId) ?? null
  const full = limits ? items.length >= limits.maxPanels : false
  // The board reads the panel it is showing through a ref, so an effect keyed on
  // the panel's identity does not restart because the list was re-projected.
  const shown = useRef(null)
  shown.current = panel

  useEffect(() => { if (!selectedId && items.length) setOwnId(items[0].id) }, [items, selectedId])

  // The selected panel is gone: it was removed here, or this is a different
  // Host's list. Either way nothing of the old page stays on screen.
  useEffect(() => {
    if (selectedId === null || items.some(entry => entry.id === selectedId)) return
    setOwnId(null); setProbes({}); setReloads(0)
    leave.current?.()
  }, [items, selectedId])

  // A page may also change under us (the list was edited elsewhere), so a reload
  // key covers both an explicit refresh and a new URL.
  useEffect(() => {
    if (!selectedId) return
    setFrame('loading')
    const timer = setTimeout(() => setFrame(current => (current === 'loading' ? 'failed' : current)), WEB_PANEL_LOAD_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [selectedId, panel?.url, reloads])

  useEffect(() => {
    if (!available || !selectedId || typeof productApi?.dispatch !== 'function') return
    const entry = shown.current
    if (!entry) return
    const controller = new AbortController()
    setProbes(previous => ({ ...previous, [entry.id]: { state: 'checking' } }))
    productApi.dispatch('webPanels.probe', { id: entry.id }, controller.signal)
      .then(result => { if (!controller.signal.aborted) setProbes(previous => ({ ...previous, [entry.id]: { state: 'done', ...result } })) })
      .catch(() => { if (!controller.signal.aborted) setProbes(previous => ({ ...previous, [entry.id]: { state: 'error' } })) })
    return () => controller.abort()
  }, [available, selectedId, panel?.url, reloads, productApi])

  const run = useCallback(async (action, payload) => {
    setError(''); setNotice('')
    if (typeof dispatch !== 'function') { setError('当前连接暂不能修改固定页面。'); return null }
    let result
    try {
      // The workspace's own dispatch answers a failure as `{ok:false}`; a host that
      // throws instead is answered the same way rather than losing the message.
      result = await dispatch(action, payload, { errorResult: true })
    } catch (cause) { setError(actionError(cause).text); return null }
    if (result?.ok === false) { setError(actionError(result.error).text); return null }
    return result
  }, [dispatch])

  const startAdd = () => { setDraft({ id: null, name: '', url: '' }); setDraftError('') }
  const startEdit = () => { if (panel) { setDraft({ id: panel.id, name: panel.name, url: panel.url }); setDraftError('') } }

  const save = async () => {
    if (!draft) return
    // The draft is checked here only to answer while the person is still typing;
    // the Host re-validates with the real embedding origin and its own limits.
    const check = validateWebPanelDraft(draft, origin)
    if (!check.ok) { setDraftError(actionError({ code: check.error === 'self' ? 'WEB_PANEL_SELF_URL' : check.error === 'name' ? 'WEB_PANEL_NAME' : 'WEB_PANEL_URL' }).text); return }
    const saved = await run('webPanels.save', { ...(draft.id ? { id: draft.id } : {}), name: check.name, url: check.url, expectedRevision: revision })
    if (saved) { setDraft(null); setNotice(draft.id ? '已保存修改。' : '已固定该页面。'); if (draft.id) setReloads(value => value + 1); else select(saved.panel.id) }
  }

  const remove = async panelId => {
    const removed = await run('webPanels.remove', { id: panelId, expectedRevision: revision })
    if (removed) setNotice(panelId === selectedId ? '已取消固定，返回工作空间。' : '已取消固定。')
  }

  const move = async (panelId, delta) => {
    const ids = movedOrder(items, panelId, delta)
    if (!ids) return
    const result = await run('webPanels.order', { ids, expectedRevision: revision })
    if (result) setNotice('顺序已保存。')
  }

  const probe = probes[panel?.id] ?? null
  const verdict = available ? framingMessage(probe) : { tone: 'idle', text: '' }
  const refused = probe?.state === 'done' && probe.framing === 'blocked'
  const selfFramed = Boolean(panel && isSelfOrigin(panel.url, origin))

  if (status !== 'available') {
    return <section className="bp-webpanel" aria-label="固定网页面板">
      <header className="bp-webpanel-bar"><h2>固定网页面板</h2></header>
      <p className="bp-webpanel-note" role="status">{status === 'blocked' ? (reason || '宿主尚未提供固定网页面板目录。') : '当前连接暂时无法读取固定网页面板。恢复连接后会在这里显示。'}</p>
      {status === 'blocked' && nextAction && <p className="bp-webpanel-note bp-webpanel-note-quiet">下一步：{nextAction}</p>}
    </section>
  }

  return <section className="bp-webpanel" aria-label="固定网页面板">
    <header className="bp-webpanel-bar">
      <h2>固定网页面板</h2>
      <span className="bp-webpanel-count" aria-label={`已固定 ${items.length} 个，上限 ${limits?.maxPanels ?? MAX_WEB_PANELS} 个`}>{items.length} / {limits?.maxPanels ?? MAX_WEB_PANELS}</span>
      <button type="button" className="bp-webpanel-button" disabled={busy || !available || full} onClick={startAdd}>
        <UiIcon name="plus" size={15} /><span>新增固定页面</span>
      </button>
    </header>
    {notice && <p className="bp-webpanel-note bp-webpanel-note-ok" role="status">{notice}</p>}
    {error && <p className="bp-webpanel-note bp-webpanel-note-bad" role="alert">{error}</p>}
    {!available && <p className="bp-webpanel-note">当前连接暂不能修改固定页面。</p>}
    {!items.length && <p className="bp-webpanel-note">还没有固定页面。把常用的本地仪表盘或看板固定在这里，之后在侧栏一键打开。</p>}
    <div className="bp-webpanel-body">
      {items.length > 0 && <aside className="bp-webpanel-list" aria-label="已固定的页面">
        <ul>{items.map((entry, index) => <li key={entry.id} className={entry.id === selectedId ? 'is-active' : ''}>
          <button type="button" className="bp-webpanel-pin" aria-current={entry.id === selectedId ? 'page' : undefined}
            disabled={busy} title={`${entry.name} · ${entry.url}`} onClick={() => select(entry.id)}>
            <UiIcon name="board" size={15} />
            <span className="bp-webpanel-pin-text"><span className="bp-webpanel-pin-name">{entry.name}</span>
              <span className="bp-webpanel-pin-host">{entry.host}</span></span>
          </button>
          <span className="bp-webpanel-pin-tools">
            <button type="button" title="上移" aria-label={`把 ${entry.name} 上移`} disabled={busy || !available || index === 0} onClick={() => move(entry.id, -1)}><UiIcon name="chevron" size={14} className="bp-webpanel-chevron-up" /></button>
            <button type="button" title="下移" aria-label={`把 ${entry.name} 下移`} disabled={busy || !available || index === items.length - 1} onClick={() => move(entry.id, 1)}><UiIcon name="chevron" size={14} className="bp-webpanel-chevron-down" /></button>
          </span>
        </li>)}</ul>
      </aside>}
      <div className="bp-webpanel-stage">
        {!panel && <p className="bp-webpanel-note">从左侧选择一个固定页面。</p>}
        {panel && <>
          <header className="bp-webpanel-stage-bar">
            <strong className="bp-webpanel-stage-name" title={panel.url}>{panel.name}</strong>
            <span className="bp-webpanel-stage-host" title={panel.url}>{panel.host}</span>
            <span className="bp-webpanel-stage-tools">
              <button type="button" title="重新加载" aria-label="重新加载该页面" disabled={busy} onClick={() => setReloads(value => value + 1)}><UiIcon name="refresh" size={15} /></button>
              <button type="button" title="修改名称或网址" disabled={busy || !available} onClick={startEdit}><UiIcon name="settings" size={15} /><span>修改</span></button>
              <button type="button" className="bp-webpanel-button-danger" title="取消固定该页面" disabled={busy || !available} onClick={() => remove(panel.id)}><UiIcon name="close" size={15} /><span>取消固定</span></button>
              <button type="button" className="bp-webpanel-button-primary" onClick={() => { if (!openExternally(panel.url)) setError('浏览器没有打开新窗口，请检查弹出窗口设置。') }}><UiIcon name="arrow" size={15} /><span>在浏览器中打开</span></button>
            </span>
          </header>
          {verdict.text && <p className="bp-webpanel-verdict" data-tone={verdict.tone} role="status">{verdict.text}</p>}
          {refused || selfFramed ? <div className="bp-webpanel-refused">
            <p className="bp-webpanel-refused-title">{selfFramed ? '不能显示应用自身的页面' : '该网站不允许在这里显示'}</p>
            <p className="bp-webpanel-refused-body">{selfFramed ? '固定应用自身的页面会让它获得应用的访问权限，因此从不嵌入显示。' : '网站在自己的响应头里拒绝了被其他应用嵌入。可以在浏览器中打开，或换一个允许嵌入的页面。'}</p>
            <button type="button" className="bp-webpanel-button-primary" onClick={() => openExternally(panel.url)}><UiIcon name="arrow" size={15} /><span>在浏览器中打开</span></button>
          </div> : <>
            {frame === 'failed' && <p className="bp-webpanel-note bp-webpanel-note-bad" role="status">页面迟迟没有加载完成。可以在浏览器中打开，或点“重新加载”再试。</p>}
            <iframe key={`${panel.id}:${panel.url}:${reloads}`} className="bp-webpanel-frame" src={panel.url} title={panel.name}
              sandbox={WEB_PANEL_SANDBOX} referrerPolicy={WEB_PANEL_REFERRER_POLICY}
              onLoad={() => setFrame('loaded')} onError={() => setFrame('failed')} />
          </>}
        </>}
      </div>
    </div>
    {draft && <div className="bp-webpanel-editor" role="group" aria-label={draft.id ? '修改固定页面' : '新增固定页面'}>
      <h3>{draft.id ? '修改固定页面' : '新增固定页面'}</h3>
      <label htmlFor="bp-webpanel-draft-name">名称</label>
      <input id="bp-webpanel-draft-name" value={draft.name} maxLength={limits?.maxNameChars ?? 40} autoComplete="off"
        onChange={event => { setDraft({ ...draft, name: event.target.value }); setDraftError('') }} />
      <label htmlFor="bp-webpanel-draft-url">网址</label>
      <input id="bp-webpanel-draft-url" value={draft.url} type="url" inputMode="url" autoComplete="off" spellCheck={false}
        placeholder="http://127.0.0.1:7841/ 或 https://…"
        onChange={event => { setDraft({ ...draft, url: event.target.value }); setDraftError('') }}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save() } }} />
      {draftError && <p className="bp-webpanel-note bp-webpanel-note-bad" role="alert">{draftError}</p>}
      <p className="bp-webpanel-note bp-webpanel-note-quiet">只支持 http/https 地址；保存后才会向宿主确认该页面是否允许嵌入，输入过程中不会发送任何请求。</p>
      <div className="bp-webpanel-editor-tools">
        <button type="button" className="bp-webpanel-button-primary" disabled={busy || !available} onClick={() => void save()}><span>保存</span></button>
        <button type="button" className="bp-webpanel-button" onClick={() => { setDraft(null); setDraftError('') }}><span>取消</span></button>
      </div>
    </div>}
  </section>
}

