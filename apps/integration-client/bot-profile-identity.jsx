import React, { useEffect, useMemo, useRef, useState } from 'react'
import { UiIcon } from './ui-icons.jsx'
import css from './bot-profile.css'
import {
  BOT_PROFILE_FIELDS, BOT_PROFILE_FIELD_META, BOT_PROFILE_GROUPS, botProfileDirty, botProfileDraft, botProfileFailure,
  botProfilePatch, botProfileProblems, botProfileSavedText, botProfileSearch,
} from './bot-profile.mjs'

/**
 * Identity and personality, inside the Bot settings side window.
 *
 * It writes only what the Host persists — name, role, instructions — through the
 * owner product actions `botProfile.inspect` / `botProfile.save`, so the same
 * window that picks the model and the official tools also decides who this Bot
 * is. Three rules shape the panel:
 *
 *   - the Host's committed record is the baseline, never the draft: a save sends
 *     the changed fields plus the values they were read at, so an edit made in
 *     another window is refused instead of overwritten, and an unrelated save
 *     never blocks this one;
 *   - a response that arrives late — a slow save, a switched Bot, a re-read —
 *     updates the baseline, never the draft, so a keystroke made while a save was
 *     in flight is never lost;
 *   - composing text is never a submit: an IMEEnter and a form submit during
 *     composition are both dropped, and nothing resets the draft underneath the
 *     composition.
 *
 * Instructions are text, not a grant: the panel says so where the field is, and
 * it never offers a model, a tool, a permission or a working directory.
 */
export function BotProfileIdentity({ productApi, botId, busy = false, onSaved }) {
  const [view, setView] = useState(null), [draft, setDraft] = useState(null), [query, setQuery] = useState('')
  const [open, setOpen] = useState(() => new Set(BOT_PROFILE_GROUPS.map(group => group.id)))
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState('')
  const [feedback, setFeedback] = useState(null)
  const session = useRef({ live: false, epoch: 0, saving: false, requests: new Set() })
  const saveToken = useRef(0)
  const composing = useRef(false)

  useEffect(() => {
    // The stylesheet ships with this panel so the parent needs one import and one
    // render; a parent that concatenates it into the dialog's own style must not
    // do both at once.
    const style = document.createElement('style')
    style.dataset.botProfileIdentity = '1'
    style.textContent = css
    document.head.append(style)
    return () => { style.remove() }
  }, [])

  const call = async (action, payload, signal) => {
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    session.current.requests.add(controller)
    let rejectAborted
    const deadline = new Promise((_resolve, reject) => { rejectAborted = () => reject(Object.assign(new Error('REQUEST_ABORTED'), { code: 'REQUEST_ABORTED' })); controller.signal.addEventListener('abort', rejectAborted, { once: true }) })
    const timer = setTimeout(abort, 10000)
    if (controller.signal.aborted) rejectAborted()
    try { return await Promise.race([Promise.resolve().then(() => productApi.dispatch(action, payload, controller.signal)), deadline]) }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', rejectAborted); session.current.requests.delete(controller) }
  }

  const read = async () => {
    const current = session.current, epoch = ++current.epoch
    setLoading(true)
    try {
      const value = await call('botProfile.inspect', { botId })
      if (!current.live || epoch !== current.epoch) return
      if (value?.schemaVersion !== 1 || value.bot?.id !== botId || !Number.isSafeInteger(value.revision) || value.revision < 0
        || !BOT_PROFILE_FIELDS.every(field => typeof value.bot[field] === 'string')) throw Object.assign(new Error('WRONG_PROFILE_OWNER'), { code: 'WRONG_PROFILE_OWNER' })
      setView(value); setDraft(botProfileDraft(value)); setError('')
      setFeedback(currentFeedback => (currentFeedback?.kind === 'saved' ? currentFeedback : null))
    } catch (cause) {
      if (!current.live || epoch !== current.epoch) return
      if (cause?.code === 'REQUEST_ABORTED') { setError('读取结果尚未确认，请重新读取后核对。'); return }
      setError(['PRODUCT_ACTION_UNAVAILABLE', 'INVALID_PRODUCT_ACTION'].includes(cause?.code) ? '当前连接尚不支持身份与个性设置，请更新完整插件。' : '暂时无法读取这个 Bot 的身份，请重试。')
    } finally { if (current.live && epoch === current.epoch) setLoading(false) }
  }

  useEffect(() => {
    const current = session.current
    current.live = true
    // A Bot switch invalidates the previous Bot's read and its in-flight save,
    // and drops its values from the panel: no other Bot's identity is ever
    // shown as this one's.
    current.epoch += 1; saveToken.current += 1; current.saving = false; setSaving(false)
    for (const controller of current.requests) controller.abort()
    setView(null); setDraft(null); setFeedback(null)
    void read()
    return () => {
      current.live = false; current.epoch += 1; saveToken.current += 1
      for (const controller of current.requests) controller.abort()
    }
  }, [productApi, botId])

  const edit = (field, value) => { setDraft(current => (current ? { ...current, [field]: value } : current)); setFeedback(null) }
  const reload = () => { void read() }

  const dirty = view && draft ? botProfileDirty(draft, view) : false
  const problems = useMemo(() => (draft ? botProfileProblems(draft) : []), [draft])
  const search = useMemo(() => botProfileSearch(query), [query])
  const groupOpen = id => (search ? search.groups[id] : open.has(id))
  const toggle = id => setOpen(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  // The committed record belongs to one Bot: until this Bot's own read lands,
  // nothing of another Bot's identity is shown or offered for saving, not even
  // for the frame between the switch and its read.
  const owned = view && draft && view.bot.id === botId ? view : null

  const save = async event => {
    if (event) event.preventDefault()
    const current = session.current
    // An IME composition is never a submit, and a second click in the same batch
    // must not send the same revision twice.
    if (composing.current || !current.live || current.saving || busy || !owned || !dirty || problems.length > 0) return
    const profile = botProfilePatch(draft, view)
    if (Object.keys(profile).length === 0) return
    const token = saveToken.current
    const sentDraft = { ...draft }, sentView = view
    current.saving = true; setSaving(true)
    setFeedback({ kind: 'saving', text: '正在保存到宿主…' })
    try {
      const result = await call('botProfile.save', { botId, expectedRevision: view.revision ?? 0, base: botProfileDraft(view), profile })
      if (!current.live || token !== saveToken.current) return
      const expected = Object.keys(profile).filter(field => profile[field].trim() !== (sentView.bot[field] ?? '')).sort()
      const valid = result?.schemaVersion === 1 && result.botId === botId && result.bot?.id === botId
        && Number.isSafeInteger(result.revision) && result.revision >= sentView.revision
        && BOT_PROFILE_FIELDS.every(field => typeof result.bot[field] === 'string')
        && Array.isArray(result.saved) && result.saved.length === expected.length
        && [...result.saved].sort().every((field, index) => field === expected[index])
        && Object.keys(profile).every(field => result.bot[field] === profile[field].trim())
      if (!valid) throw Object.assign(new Error('宿主尚未确认这次身份保存，请重新读取后核对。'), { code: 'BOT_PROFILE_UNCONFIRMED' })
      // The acknowledged record becomes the new baseline. Anything typed while
      // the save was in flight stays in the draft and simply reads as unsaved.
      setView(currentView => (currentView ? { ...currentView, bot: result.bot, revision: result.revision } : currentView))
      setDraft(currentDraft => currentDraft ? Object.fromEntries(BOT_PROFILE_FIELDS.map(field => [field,
        currentDraft[field] === sentDraft[field] ? result.bot[field] : currentDraft[field]])) : currentDraft)
      setFeedback({ kind: 'saved', text: botProfileSavedText(result) })
      onSaved?.(result.bot)
    } catch (cause) {
      if (!current.live || token !== saveToken.current) return
      setFeedback({ kind: cause?.code === 'BOT_PROFILE_CONFLICT' ? 'notice' : 'error', text: botProfileFailure(cause) })
    } finally {
      if (current.live && token === saveToken.current) { current.saving = false; setSaving(false) }
    }
  }

  const scope = `${botId}`
  return <section className="bp-profile" aria-label="身份与个性">
    <header className="bp-profile-head">
      <span className="bp-profile-badge" aria-hidden="true"><UiIcon name="bot" size={18}/></span>
      <div className="bp-profile-title"><h3>身份与个性</h3><p>名称、职责与对话指令；保存只写回这个 Bot 的资料，不会代替你给它发消息。</p></div>
      {owned && <span className="bp-profile-revision" title="宿主已提交状态的修订号">修订号 {owned.revision ?? '—'}</span>}
    </header>
    <div className="bp-profile-search">
      <UiIcon name="search" size={15}/>
      <input type="search" value={query} aria-label="搜索身份设置" placeholder="搜索名称、职责、指令…" onChange={event => setQuery(event.target.value)}/>
      {query !== '' && <button type="button" aria-label="清除搜索" onClick={() => setQuery('')}><UiIcon name="close" size={13}/></button>}
    </div>
    {loading && !view && <p className="bp-muted bp-profile-status" role="status">正在读取 Bot 身份…</p>}
    {error !== '' && <div className="bp-profile-error" role="alert"><p>{error}</p><button type="button" disabled={busy || loading} onClick={reload}>重新读取</button></div>}
    {owned && <>
      {search && !search.any && <p className="bp-muted bp-profile-status" role="status">没有匹配“{query}”的身份设置。</p>}
      {BOT_PROFILE_GROUPS.map(group => <section key={group.id} className="bp-profile-group" data-group={group.id} data-open={groupOpen(group.id) ? 'true' : 'false'} aria-label={group.label}>
        <button type="button" className="bp-profile-group-head" aria-expanded={groupOpen(group.id)} onClick={() => (search ? setQuery('') : toggle(group.id))}>
          <UiIcon name={group.icon} size={16}/>
          <span className="bp-profile-group-label">{group.label}</span>
          <span className="bp-profile-group-hint">{group.hint}</span>
          <UiIcon name="chevron" size={15}/>
        </button>
        {groupOpen(group.id) && <div className="bp-profile-group-body">
          {group.fields.map(field => { const meta = BOT_PROFILE_FIELD_META[field], problem = problems.find(item => item.field === field)
            return <label key={field} className="bp-profile-field" htmlFor={`bp-profile-${scope}-${field}`}>
              <span className="bp-profile-field-head"><span className="bp-profile-field-label">{meta.label}</span>
                <span className="bp-profile-field-count">{draft[field].length}/{meta.limit}</span></span>
              {meta.control === 'input'
                ? <input id={`bp-profile-${scope}-${field}`} type="text" value={draft[field]} maxLength={meta.limit} placeholder={meta.placeholder} disabled={busy || saving}
                    onChange={event => edit(field, event.target.value)}
                    onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}/>
                : <textarea id={`bp-profile-${scope}-${field}`} value={draft[field]} maxLength={meta.limit} rows={5} placeholder={meta.placeholder} disabled={busy || saving}
                    onChange={event => edit(field, event.target.value)}
                    onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}/>}
              <small className="bp-profile-field-help">{meta.help}</small>
              {problem && <small className="bp-profile-field-problem" role="status">{problem.text}</small>}
            </label> })}
        </div>}
      </section>)}
      <form className="bp-profile-save" onSubmit={save} noValidate>
        <span className="bp-profile-pill" data-tone={dirty ? 'warn' : 'muted'}>{dirty ? '有未保存修改' : '与宿主一致'}</span>
        <button type="submit" className="bp-button-primary" disabled={busy || saving || !dirty || problems.length > 0}>
          {saving ? '保存中…' : '保存身份与指令'}</button>
      </form>
    </>}
    {feedback && <p className="bp-profile-feedback" data-kind={feedback.kind} role="status">{feedback.text}</p>}
  </section>
}
