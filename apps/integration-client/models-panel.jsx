import React, { useEffect, useMemo, useState } from 'react'
import { UiIcon } from './ui-icons.jsx'

const ENGINE = /^engine-/
const usd = value => typeof value === 'number' && Number.isFinite(value) ? `$${value % 1 === 0 ? value : value.toFixed(2)}` : '—'
const tokens = value => Number.isSafeInteger(value) ? value >= 1000 ? `${Math.round(value / 1000)}k` : String(value) : '—'
const routeKey = route => `${route.provider}/${route.model}`

/** "Claude Code · Sonnet" for an engine route, the exact route otherwise. */
export function modelLabel(ref, engines) {
  if (typeof ref !== 'string' || !ref) return '尚未选择模型'
  for (const engine of engines?.items ?? []) {
    const model = engine.models?.find(item => item.ref === ref)
    if (model) return `${String(engine.name).replace(/（官方工具）$/, '')} · ${model.name}`
  }
  return ref
}

/** How a Bot is funded right now, in the words a person would use. */
export function modeBadge(item) {
  if (!item) return { label: '读取中', tone: 'muted' }
  if (item.mode === 'advanced') return { label: item.funding === 'subscription' ? '高级绑定 · 订阅' : '高级绑定 · API', tone: 'accent' }
  if (item.mode === 'quick') {
    if (item.funding === 'subscription') return { label: '快速 · 官方工具', tone: 'success' }
    return item.priced ? { label: '快速 · API', tone: 'accent' } : { label: '需要价格', tone: 'warning' }
  }
  return ({ off: { label: '已停用', tone: 'muted' }, disabled: { label: '快速模式已关闭', tone: 'muted' },
    'no-model': { label: '未选模型', tone: 'warning' }, blocked: { label: '绑定异常', tone: 'danger' } })[item.mode] ?? { label: '未知', tone: 'muted' }
}

export const Pill = ({ tone = 'muted', children }) => <span className="bp-pill" data-tone={tone}>{children}</span>

const policyForm = settings => ({ enabled: settings.enabled, botDailyUsd: settings.botDailyUsd, botMonthlyUsd: settings.botMonthlyUsd,
  totalDailyUsd: settings.totalDailyUsd, totalMonthlyUsd: settings.totalMonthlyUsd, maxInputTokens: settings.maxInputTokens, maxOutputTokens: settings.maxOutputTokens,
  prices: Object.fromEntries(settings.prices.map(row => [routeKey(row), { input: String(row.input), output: String(row.output) }])) })

const pricesOf = (form, routes) => {
  const rows = []
  for (const [key, value] of Object.entries(form.prices)) {
    if (value.input === '' || value.output === '') continue
    const at = key.indexOf('/')
    const route = routes.find(item => routeKey(item) === key) ?? { provider: key.slice(0, at), model: key.slice(at + 1) }
    rows.push({ provider: route.provider, model: route.model, input: Number(value.input), output: Number(value.output) })
  }
  return rows
}

/** Save one more price without disturbing the rest of the committed policy. */
export function savePrice(section, dispatch, route, input, output) {
  const settings = structuredClone(section.settings)
  settings.prices = [...settings.prices.filter(row => routeKey(row) !== routeKey(route)), { provider: route.provider, model: route.model, input, output }]
  return dispatch('quickBinding.save', { expectedRevision: section.revision, settings })
}

/**
 * Quick mode: a Bot runs on the model picked in its chat. Official tools use the
 * person's own subscription; API models need a price and stay inside these caps.
 */
export function QuickPolicyCard({ snapshot, dispatch, busy }) {
  const section = snapshot.quickBinding
  const [form, setForm] = useState(null)
  const [filter, setFilter] = useState('')
  useEffect(() => { if (section?.status === 'available') setForm(policyForm(section.settings)) }, [section?.revision, section?.status])
  if (section?.status !== 'available' || !form) return null
  const settings = section.settings
  const apiRoutes = (section.routes ?? []).filter(route => !route.engine)
  const priced = apiRoutes.filter(route => settings.prices.some(row => routeKey(row) === routeKey(route)) || route.profilePrice).length
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const changePrice = (key, field, value) => setForm(current => ({ ...current, prices: { ...current.prices, [key]: { input: '', output: '', ...current.prices[key], [field]: value } } }))
  const visible = apiRoutes.filter(route => !filter.trim() || routeKey(route).toLowerCase().includes(filter.trim().toLowerCase()))
  const save = event => {
    event.preventDefault()
    const next = { enabled: form.enabled, botDailyUsd: Number(form.botDailyUsd), botMonthlyUsd: Number(form.botMonthlyUsd),
      totalDailyUsd: Number(form.totalDailyUsd), totalMonthlyUsd: Number(form.totalMonthlyUsd),
      maxInputTokens: Number(form.maxInputTokens), maxOutputTokens: Number(form.maxOutputTokens), prices: pricesOf(form, apiRoutes) }
    return dispatch('quickBinding.save', { expectedRevision: section.revision, settings: next })
  }
  return <section className="bp-card bp-quick" aria-label="快速模式">
    <div className="bp-card-title">
      <div className="bp-person-heading"><span className="bp-feature-icon" data-tone={settings.enabled ? 'success' : 'muted'}><UiIcon name="spark" size={19} /></span>
        <div><h2>快速模式 <Pill tone={settings.enabled ? 'success' : 'muted'}>{settings.enabled ? '已开启' : '已关闭'}</Pill></h2>
          <p className="bp-muted">选好模型就能开始。官方工具用你自己的订阅登录；API 模型按价格计费，并受下面的上限约束。</p></div></div>
    </div>
    <ul className="bp-quick-facts">
      <li><span>每个 Bot</span><strong>每日 {usd(settings.botDailyUsd)} · 每月 {usd(settings.botMonthlyUsd)}</strong></li>
      <li><span>全部快速 Bot 合计</span><strong>每日 {usd(settings.totalDailyUsd)} · 每月 {usd(settings.totalMonthlyUsd)}</strong></li>
      <li><span>单次请求上界</span><strong>输入 {tokens(settings.maxInputTokens)} · 输出 {tokens(settings.maxOutputTokens)} Token</strong></li>
      <li><span>API 模型价格</span><strong>{priced} / {apiRoutes.length} 个已知</strong></li>
    </ul>
    <details className="bp-edit-section"><summary><UiIcon name="settings" size={16} />调整上限与价格</summary>
      <form className="bp-form" onSubmit={save}>
        <label className="bp-switch-row"><input type="checkbox" checked={form.enabled} onChange={event => change('enabled', event.target.checked)} />
          <span><strong>开启快速模式</strong><small>关闭后，没有高级绑定的 Bot 不能调用模型。</small></span></label>
        <div className="bp-form-grid">
          <label>每个 Bot 每日（USD）<input type="number" min="0" step="0.01" value={form.botDailyUsd} onChange={event => change('botDailyUsd', event.target.value)} required /></label>
          <label>每个 Bot 每月（USD）<input type="number" min="0" step="0.01" value={form.botMonthlyUsd} onChange={event => change('botMonthlyUsd', event.target.value)} required /></label>
          <label>合计每日（USD）<input type="number" min="0" step="0.01" value={form.totalDailyUsd} onChange={event => change('totalDailyUsd', event.target.value)} required /></label>
          <label>合计每月（USD）<input type="number" min="0" step="0.01" value={form.totalMonthlyUsd} onChange={event => change('totalMonthlyUsd', event.target.value)} required /></label>
          <label>最大输入 Token<input type="number" min="1" step="1" value={form.maxInputTokens} onChange={event => change('maxInputTokens', event.target.value)} required /></label>
          <label>最大输出 Token<input type="number" min="1" step="1" value={form.maxOutputTokens} onChange={event => change('maxOutputTokens', event.target.value)} required /></label>
        </div>
        <p className="bp-muted">0 表示禁止付费调用。合计上限也包含尚未归属到任何 Bot 的支出。每次调用先按上界预留费用，结束后按实际用量结算。</p>
        <h3>API 模型价格 <span className="bp-inline-count">USD / 百万 Token</span></h3>
        {apiRoutes.length === 0 ? <p className="bp-muted">宿主目录里还没有 API 模型。</p> : <>
          {apiRoutes.length > 8 && <label className="bp-search-field"><UiIcon name="search" size={15} /><input aria-label="筛选模型" placeholder="筛选模型" value={filter} onChange={event => setFilter(event.target.value)} /></label>}
          <div className="bp-table-wrap"><table className="bp-price-table"><thead><tr><th>模型</th><th>输入</th><th>输出</th></tr></thead>
            <tbody>{visible.map(route => {
              const key = routeKey(route), value = form.prices[key] ?? { input: '', output: '' }
              return <tr key={key}><td>{route.model}<small>{route.provider}{route.profilePrice && !settings.prices.some(row => routeKey(row) === key) ? ' · 已从模型档案读取价格' : ''}</small></td>
                <td><input aria-label={`${key} 输入价格`} type="number" min="0" step="0.000001" value={value.input} placeholder={route.profilePrice ? String(route.profilePrice.input) : '未填写'} onChange={event => changePrice(key, 'input', event.target.value)} /></td>
                <td><input aria-label={`${key} 输出价格`} type="number" min="0" step="0.000001" value={value.output} placeholder={route.profilePrice ? String(route.profilePrice.output) : '未填写'} onChange={event => changePrice(key, 'output', event.target.value)} /></td></tr>
            })}</tbody></table></div></>}
        <div className="bp-actions"><button type="submit" className="bp-button-primary" disabled={busy}>保存快速模式</button>
          <small className="bp-muted">修订 {section.revision}{section.updatedAt ? ` · ${new Date(section.updatedAt).toLocaleString('zh-CN')}` : ''}</small></div>
      </form>
    </details>
  </section>
}

/** The Bot's model and how it is funded, with the one fix a person can make right here. */
export function BotModelRow({ bot, item, record, section, engines, dispatch, busy, openSession }) {
  const [price, setPrice] = useState({ input: '', output: '' })
  const badge = modeBadge(item)
  const engine = ENGINE.test(String(bot.model ?? ''))
  const route = typeof bot.model === 'string' && bot.model.includes('/') ? { provider: bot.model.slice(0, bot.model.indexOf('/')), model: bot.model.slice(bot.model.indexOf('/') + 1) } : null
  const canToggle = typeof dispatch === 'function' && record && item && item.mode !== 'advanced' && item.mode !== 'blocked'
  const toggle = value => dispatch('binding.quick', { botId: bot.id, expectedRevision: record.revision, quickBinding: value })
  const explain = !item ? '' : item.mode === 'advanced' ? '按高级绑定里的准确模型、资金范围和权限运行。'
    : item.mode === 'quick' ? item.funding === 'subscription' ? '通过已登录的官方工具运行，按你的订阅计费，不消耗 API 额度。'
      : item.priced ? `按 API 价格计费${item.pricing ? `（输入 ${item.pricing.input} / 输出 ${item.pricing.output} USD 每百万 Token）` : ''}，受快速模式上限约束。`
        : '这个 API 模型还没有价格，调用会被拒绝。填写价格后即可使用。'
      : item.mode === 'off' ? '此 Bot 的模型调用已停用。' : item.mode === 'disabled' ? '快速模式已整体关闭；请开启快速模式或启用高级绑定。'
        : item.mode === 'no-model' ? '在私聊顶部的模型菜单里选一个模型。' : item.reason ?? '绑定记录需要修复。'
  return <div className="bp-model-row">
    <div className="bp-model-main">
      <span className="bp-model-glyph" data-engine={engine ? 'true' : 'false'}><UiIcon name={engine ? 'spark' : 'chip'} size={17} /></span>
      <div className="bp-model-copy"><strong>{modelLabel(bot.model, engines)}</strong><small>{explain}</small></div>
      <Pill tone={badge.tone}>{badge.label}</Pill>
    </div>
    {item?.mode === 'quick' && item.funding === 'api' && !item.priced && route && section?.status === 'available' && typeof dispatch === 'function' &&
      <form className="bp-inline-price" onSubmit={event => { event.preventDefault(); return savePrice(section, dispatch, route, Number(price.input), Number(price.output)) }}>
        <label>输入 USD/百万<input type="number" min="0" step="0.000001" required value={price.input} onChange={event => setPrice(current => ({ ...current, input: event.target.value }))} /></label>
        <label>输出 USD/百万<input type="number" min="0" step="0.000001" required value={price.output} onChange={event => setPrice(current => ({ ...current, output: event.target.value }))} /></label>
        <button type="submit" disabled={busy}>保存价格</button>
      </form>}
    <div className="bp-actions">
      {bot.sessionId && <button type="button" onClick={() => openSession(bot.sessionId)}>在私聊中更换模型</button>}
      {canToggle && <label className="bp-check"><input type="checkbox" checked={item.mode !== 'off'} disabled={busy} onChange={event => { void toggle(event.target.checked) }} />允许此 Bot 使用快速模式</label>}
    </div>
  </div>
}

/** Ready-made Bots: who the Bot is. Model, folder, funding and permissions stay the owner's. */
export function TemplateGallery({ snapshot, dispatch, busy, openSession }) {
  const [catalog, setCatalog] = useState(null)
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    if (typeof dispatch !== 'function') return undefined
    Promise.resolve(dispatch('templates.list', {}))
      .then(value => { if (live && value?.items) setCatalog(value) })
      .catch(failure => { if (live) setError(String(failure?.message ?? failure)) })
    return () => { live = false }
  }, [dispatch])
  const routes = useMemo(() => {
    const rows = snapshot.quickBinding?.routes ?? []
    return [...rows.filter(route => route.engine), ...rows.filter(route => !route.engine)]
  }, [snapshot.quickBinding?.routes])
  if (error) return <article className="bp-card"><div className="bp-card-title"><h2>现成 Bot</h2></div><p className="bp-error" role="alert">{error}</p></article>
  if (!catalog) return null
  const needle = query.trim().toLowerCase()
  const items = catalog.items.filter(item => (category === 'all' || item.category === category)
    && (!needle || [item.name, item.title, item.description].some(text => text.toLowerCase().includes(needle))))
  const create = async event => {
    event.preventDefault()
    const result = await dispatch('bot.template.create', { templateId: creating.id, name: creating.name, ...(creating.model ? { model: creating.model } : {}) })
    if (result?.botId) { setCreating(null); if (result.sessionId) openSession?.(result.sessionId) }
  }
  return <section className="bp-card" aria-label="现成 Bot">
    <div className="bp-card-title"><div><h2>现成 Bot <span className="bp-inline-count">{catalog.items.length} 个</span></h2>
      <p className="bp-muted">挑一个现成角色马上开始。模板只决定 Bot 是谁；模型、文件夹、资金和权限仍由你决定。</p></div></div>
    <div className="bp-gallery-tools">
      <div className="bp-segmented" role="group" aria-label="分类">
        {[{ id: 'all', label: '全部' }, ...catalog.categories].map(item => <button key={item.id} type="button" aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.label}</button>)}
      </div>
      <label className="bp-search-field"><UiIcon name="search" size={15} /><input aria-label="搜索现成 Bot" placeholder="搜索" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </div>
    {items.length === 0 ? <p className="bp-empty">没有匹配的现成 Bot。</p> : <div className="bp-template-grid">{items.map(item => <article key={item.id} className="bp-template" data-color={item.color}>
      <div className="bp-template-head"><span className="bp-template-avatar" data-color={item.color}>{item.name.slice(0, 1)}</span>
        <div><strong>{item.name}</strong><small>{item.title}</small></div></div>
      <p>{item.description}</p>
      <p className="bp-template-try"><span>试试问</span>{item.tryAsking[0]}</p>
      {creating?.id === item.id ? <form className="bp-form bp-template-form" onSubmit={create}>
        <label>名称<input value={creating.name} maxLength={40} required onChange={event => setCreating(current => ({ ...current, name: event.target.value }))} /></label>
        <label>模型<select value={creating.model} onChange={event => setCreating(current => ({ ...current, model: event.target.value }))}>
          <option value="">DSH 默认模型</option>
          {routes.map(route => <option key={routeKey(route)} value={routeKey(route)}>{route.engine ? modelLabel(routeKey(route), snapshot.engines) : routeKey(route)}</option>)}
        </select></label>
        <div className="bp-actions"><button type="submit" className="bp-button-primary" disabled={busy}>创建并打开私聊</button><button type="button" onClick={() => setCreating(null)}>取消</button></div>
      </form> : <div className="bp-actions"><button type="button" disabled={busy || !snapshot.availableActions?.includes('bot.template.create')} onClick={() => setCreating({ id: item.id, name: item.name, model: '' })}><UiIcon name="plus" size={15} />用这个模板创建</button></div>}
    </article>)}</div>}
  </section>
}
