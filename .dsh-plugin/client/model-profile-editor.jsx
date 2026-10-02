import React from 'react'
import { parseModelProfilesJson } from '../shared/model-profiles.mjs'
import {
  PROFILE_SPECIALTY_HINT, profileDraft, profileRouteKey, updateProfileJson,
} from './model-profile-editor-state.mjs'

const messageOf = error => typeof error?.message === 'string' ? error.message : '模型配置保存失败。'

export function ModelProfileEditor({ routes, settingsScope, onSaved }) {
  const [snapshot, setSnapshot] = React.useState(() => settingsScope.getSnapshot())
  const [selected, setSelected] = React.useState('')
  const [drafts, setDrafts] = React.useState({})
  const [saving, setSaving] = React.useState(false)
  const [notice, setNotice] = React.useState(null)

  React.useEffect(() => settingsScope.subscribe(() => setSnapshot(settingsScope.getSnapshot())), [settingsScope])

  const route = routes.find(item => profileRouteKey(item) === selected) ?? routes[0]
  const routeKey = route ? profileRouteKey(route) : ''
  const rawJson = snapshot.value?.modelProfilesJson ?? '[]'
  let profiles = []
  let loadError = ''
  try { profiles = parseModelProfilesJson(rawJson) }
  catch (error) { loadError = messageOf(error) }
  const saved = profiles.find(item => profileRouteKey(item) === routeKey)
  const pending = drafts[routeKey]
  const draft = pending?.fields ?? profileDraft(saved)
  const writable = snapshot.status === 'ready' && snapshot.writable === true && !saving && !loadError
  const unmatched = profiles.filter(item => !routes.some(route => profileRouteKey(route) === profileRouteKey(item))).length

  const edit = (name, value) => {
    if (!route || !writable) return
    setDrafts(previous => {
      const previousEntry = previous[routeKey] ?? { fields: profileDraft(saved), baseRevision: snapshot.revision }
      return { ...previous, [routeKey]: { ...previousEntry, fields: { ...previousEntry.fields, [name]: value } } }
    })
    setNotice(null)
  }

  const write = async remove => {
    if (!route || !writable) return
    const revision = pending?.baseRevision ?? snapshot.revision
    if (revision !== snapshot.revision) {
      setNotice({ tone: 'error', text: '设置已在其他页面更新。当前输入仍在；请核对最新内容，再选择“重新加载此路线”后编辑。' })
      return
    }
    let nextJson
    try { nextJson = updateProfileJson(rawJson, route, remove ? null : draft) }
    catch (error) { setNotice({ tone: 'error', text: messageOf(error) }); return }
    setSaving(true)
    setNotice(null)
    try {
      const accepted = await settingsScope.mutate([{ op: 'set', path: ['modelProfilesJson'], value: nextJson }], revision)
      if (!accepted) throw new Error('设置未被保存，可能被其他页面修改。输入已保留，请重新加载后核对。')
      setDrafts(previous => {
        const next = { ...previous }
        delete next[routeKey]
        return next
      })
      setNotice({ tone: 'success', text: remove ? '已删除该模型的自报配置。' : '该模型配置已保存；重新生成建议即可使用。' })
      onSaved?.()
    } catch (error) {
      setNotice({ tone: 'error', text: messageOf(error) })
    } finally {
      setSaving(false)
    }
  }

  const reload = () => {
    setDrafts(previous => {
      const next = { ...previous }
      delete next[routeKey]
      return next
    })
    setNotice(null)
  }

  return (
    <section className="mr-card mr-profile-card" aria-label="逐模型价格与能力配置">
      <div className="mr-card-head"><div>
        <h2 className="mr-card-title">逐模型价格与能力</h2>
        <p className="mr-card-copy">选择官方模型目录中的准确路线，填写你掌握的质量评分与单价。配置由你提供，插件不会读取账号密钥。</p>
      </div></div>
      <div className="mr-card-body">
        {loadError && <p className="mr-error" role="alert">已有配置无法解析：{loadError}。请先在插件设置页修正 JSON。</p>}
        {snapshot.status !== 'ready' && <p className="mr-caption">设置状态：{snapshot.status === 'loading' ? '正在加载' : '当前不可用'}</p>}
        {snapshot.status === 'ready' && !snapshot.writable && <p className="mr-error" role="status">当前设置为只读，请在可写的本机环境配置。</p>}
        {routes.length === 0
          ? <p className="mr-empty">请先在 DeepSeek Harness 的“模型”页添加模型，再返回这里填写价格与能力。</p>
          : <>
            <label className="mr-label" htmlFor="mr-profile-route">模型路线</label>
            <select className="mr-input" id="mr-profile-route" value={routeKey} onChange={event => { setSelected(event.target.value); setNotice(null) }}>
              {routes.map(item => <option key={profileRouteKey(item)} value={profileRouteKey(item)}>{item.provider}/{item.model}</option>)}
            </select>
            <p className="mr-caption mr-profile-state">{saved ? `已配置${saved.pricing ? '单价' : '能力，价格未知'}` : '未配置，价格与质量来源未知'}{pending ? ' · 当前有未保存输入' : ''}{unmatched > 0 ? ` · 另有 ${unmatched} 条配置不在当前模型目录中，保存时会保留` : ''}</p>
            <div className="mr-profile-grid">
              <label className="mr-profile-field"><span>质量评分（0–100，自报）</span><input className="mr-input" type="number" min="0" max="100" step="any" value={draft.quality} disabled={!writable} onChange={event => edit('quality', event.target.value)} placeholder="例如 85；留空表示未知" /></label>
              <label className="mr-profile-field"><span>输入单价（USD / 百万 token）</span><input className="mr-input" type="number" min="0" step="any" value={draft.input} disabled={!writable} onChange={event => edit('input', event.target.value)} placeholder="留空表示未知" /></label>
              <label className="mr-profile-field"><span>输出单价（USD / 百万 token）</span><input className="mr-input" type="number" min="0" step="any" value={draft.output} disabled={!writable} onChange={event => edit('output', event.target.value)} placeholder="留空表示未知" /></label>
              <label className="mr-profile-field"><span>擅长方向（英文标签，逗号分隔）</span><input className="mr-input" type="text" value={draft.specialties} disabled={!writable} onChange={event => edit('specialties', event.target.value)} placeholder={PROFILE_SPECIALTY_HINT} /></label>
              <label className="mr-profile-field"><span>官方 CLI 模型名（可选）</span><input className="mr-input" type="text" value={draft.cliModel} disabled={!writable} onChange={event => edit('cliModel', event.target.value)} placeholder="仅在厂商 CLI 支持该准确名称时填写" /></label>
              <label className="mr-profile-field"><span>执行方式</span>
                <select className="mr-input" value={draft.execution || 'auto'} disabled={!writable} onChange={event => edit('execution', event.target.value)}>
                  <option value="auto">自动：已安装则用官方工具，失败回退 API</option>
                  <option value="official">官方工具：失败或未安装时回退 API</option>
                  <option value="api">仅模型目录 API</option>
                </select>
              </label>
              <label className="mr-profile-field"><span>计费方式</span>
                <select className="mr-input" value={draft.billing} disabled={!writable} onChange={event => edit('billing', event.target.value)}>
                  <option value="subscription-first">订阅优先：额度用尽或限流时切换 API Key</option>
                  <option value="api-only">只用 API Key</option>
                  <option value="subscription-only">只用订阅：额度用尽时不切换</option>
                </select>
              </label>
              <label className="mr-profile-field"><span>订阅来源</span>
                <select className="mr-input" value={draft.subscription} disabled={!writable} onChange={event => edit('subscription', event.target.value)}>
                  <option value="auto">自动：有官方 CLI 时用 CLI 账号登录</option>
                  <option value="plan-key">编程套餐 Key：该路线本身是套餐端点</option>
                  <option value="cli-login">官方 CLI 账号登录</option>
                  <option value="none">无订阅：始终按 API 计费</option>
                </select>
              </label>
              {draft.subscription === 'plan-key' && <label className="mr-profile-field"><span>额度用尽时回退的 API 路线</span>
                <select className="mr-input" value={draft.apiRoute} disabled={!writable} onChange={event => edit('apiRoute', event.target.value)}>
                  <option value="">不回退（未配置 API 路线）</option>
                  {routes.filter(item => profileRouteKey(item) !== routeKey).map(item => <option key={profileRouteKey(item)} value={profileRouteKey(item)}>{item.provider}/{item.model}</option>)}
                </select>
              </label>}
            </div>
            <details className="mr-profile-advanced"><summary>缓存单价（可选）</summary><div className="mr-profile-grid">
              <label className="mr-profile-field"><span>缓存读取（USD / 百万 token）</span><input className="mr-input" type="number" min="0" step="any" value={draft.cacheRead} disabled={!writable} onChange={event => edit('cacheRead', event.target.value)} placeholder="留空按普通输入价格估算" /></label>
              <label className="mr-profile-field"><span>缓存写入（USD / 百万 token）</span><input className="mr-input" type="number" min="0" step="any" value={draft.cacheWrite} disabled={!writable} onChange={event => edit('cacheWrite', event.target.value)} placeholder="留空按普通输入价格估算" /></label>
            </div></details>
            <div className="mr-actions">
              <button className="mr-button" type="button" disabled={!writable || !pending} onClick={() => { void write(false) }}>{saving ? '保存中…' : '保存此模型'}</button>
              <button className="mr-button mr-button-secondary" type="button" disabled={!pending || saving} onClick={reload}>重新加载此路线</button>
              {saved && <button className="mr-button mr-button-secondary" type="button" disabled={!writable} onClick={() => { void write(true) }}>删除此模型配置</button>}
            </div>
            {notice && <p className={notice.tone === 'error' ? 'mr-error' : 'mr-profile-success'} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
            <p className="mr-caption">质量评分和价格都是用户提供的估值。未填写单价时显示“价格待配置”；预算只影响本地规划，不限制实际账单。CLI 模型名须与厂商工具核对。执行方式决定该模型收到任务时走官方无界面工具还是模型目录 API；官方工具失败时仍会回退 API。计费方式默认订阅优先：先用 CLI 账号登录或编程套餐 Key 路线，订阅额度用尽或限流时同一步骤自动改用 API Key，并记入运行历史。</p>
          </>}
      </div>
    </section>
  )
}
