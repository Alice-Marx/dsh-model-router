import React, { useRef, useState } from 'react'
import { UiIcon } from './ui-icons.jsx'
import { modelLabel } from './models-panel.jsx'

const routeKey = route => `${route.provider}/${route.model}`

/**
 * A team package adds Bots and their group chats. It never brings models, approval levels,
 * credentials, computers or chat history: those stay with the owner and the Host.
 */
export function TeamImport({ snapshot, dispatch, busy, openSession }) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState(null)
  const [model, setModel] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const file = useRef(null)
  const routes = snapshot.quickBinding?.routes ?? []
  const ordered = [...routes.filter(route => route.engine), ...routes.filter(route => !route.engine)]
  const change = value => { setText(value); setPreview(null); setResult(null); setError('') }
  const read = event => {
    const chosen = event.target.files?.[0]
    if (!chosen) return
    const reader = new FileReader()
    reader.onload = () => change(String(reader.result ?? ''))
    reader.onerror = () => setError('无法读取所选文件。')
    reader.readAsText(chosen)
    event.target.value = ''
  }
  const review = async () => {
    setError('')
    const value = await dispatch('team.preview', { text }, { errorResult: true })
    if (value?.ok === false) { setError(value.error.message); return }
    if (value?.bots) setPreview(value)
  }
  const install = async () => {
    setError('')
    const value = await dispatch('team.import', { text, ...(model ? { model } : {}) }, { errorResult: true })
    if (value?.ok === false) { setError(value.error.message); return }
    if (value?.bots) { setResult(value); setPreview(null); setText('') }
  }
  const nameOf = key => preview?.bots.find(bot => bot.key === key)?.name ?? key
  return <section className="bp-card bp-team-import" aria-label="导入团队包">
    <div className="bp-card-title"><div><h2>导入团队包</h2>
      <p className="bp-muted">一次添加一整个 Bot 团队和它们的群聊。只导入「Bot 是谁」，不导入模型、审批级别、密钥、电脑或聊天记录。</p></div></div>
    {result ? <div className="bp-team-result" role="status">
      <p><UiIcon name="check" size={16} /> 已添加 {result.bots.length} 个 Bot{result.rooms.length ? `、${result.rooms.length} 个群聊` : ''}。</p>
      <div className="bp-chip-row">{result.bots.map(bot => <button key={bot.botId} type="button" className="bp-chip-button" disabled={!bot.sessionId} onClick={() => openSession?.(bot.sessionId)}>{bot.name}</button>)}</div>
      {result.routines?.length ? <p className="bp-muted">团队包建议的例行任务没有自动创建：{result.routines.map(item => item.name).join('、')}。</p> : null}
      <div className="bp-actions"><button type="button" onClick={() => setResult(null)}>再导入一个</button></div>
    </div> : <>
      <label className="bp-team-source">团队包 JSON
        <textarea rows={preview ? 3 : 6} spellCheck={false} value={text} placeholder='{"format": "dsh.team-package", "version": 1, "package": { … }}' onChange={event => change(event.target.value)} /></label>
      <div className="bp-actions">
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={read} />
        <button type="button" onClick={() => file.current?.click()}><UiIcon name="folder" size={15} />选择文件…</button>
        <button type="button" className={preview ? undefined : 'bp-button-primary'} disabled={busy || !text.trim()} onClick={() => { void review() }}>预览</button>
      </div>
      {error && <p className="bp-error" role="alert">{error}</p>}
      {preview && <div className="bp-team-preview">
        <div className="bp-team-head"><strong>{preview.package.name}</strong>{preview.package.release && <span className="bp-muted"> · {preview.package.release}</span>}
          {preview.package.tagline && <p className="bp-muted">{preview.package.tagline}</p>}</div>
        <h3>将添加的 Bot <span className="bp-inline-count">{preview.bots.length} 个</span></h3>
        <ul className="bp-team-bots">{preview.bots.map(bot => <li key={bot.key}>
          <span className="bp-template-avatar" data-color={bot.color}>{bot.name.slice(0, 1)}</span>
          <div><strong>{bot.name}{preview.team.leader === bot.key ? <span className="bp-tag-inline">负责人</span> : null}</strong>
            <small>{[bot.role, bot.description].filter(Boolean).join(' · ') || '未写职责'}</small></div></li>)}</ul>
        {preview.rooms.length > 0 && <><h3>将创建的群聊 <span className="bp-inline-count">{preview.rooms.length} 个</span></h3>
          <ul className="bp-team-rooms">{preview.rooms.map(room => <li key={room.key}><strong>{room.name}</strong>
            <small>{room.members.map(nameOf).join('、')} · {room.mode === 'everyone' ? '每个人都回复' : `${room.admin ? nameOf(room.admin) : '负责人'}先回复`}</small></li>)}</ul></>}
        {preview.routines.length > 0 && <p className="bp-muted">建议的例行任务（不会自动创建）：{preview.routines.map(item => item.name).join('、')}</p>}
        {preview.skipped.length > 0 && <><h3>不会导入</h3><ul className="bp-team-skipped">{preview.skipped.map(item => <li key={item}>{item}</li>)}</ul></>}
        <label className="bp-team-model">导入后的模型<select value={model} onChange={event => setModel(event.target.value)}>
          <option value="">稍后在每个 Bot 的私聊中选择</option>
          {ordered.map(route => <option key={routeKey(route)} value={routeKey(route)}>{route.engine ? modelLabel(routeKey(route), snapshot.engines) : routeKey(route)}</option>)}
        </select></label>
        <div className="bp-actions"><button type="button" className="bp-button-primary" disabled={busy} onClick={() => { void install() }}>导入 {preview.bots.length} 个 Bot</button>
          <button type="button" onClick={() => setPreview(null)}>取消</button></div>
      </div>}
    </>}
  </section>
}
