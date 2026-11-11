import React, { useState } from 'react'
import { BotModelPicker } from './model-picker.jsx'
import { UiIcon } from './ui-icons.jsx'
import { accountFor, findModel, FUNDING_MODES, numberOrNull, routeOf, textOf } from './binding-model.mjs'
import { MAIN_LIMIT_FIELDS, newMainRoute } from './main-route-model.mjs'

const PRICES = [['input', '输入价格'], ['output', '输出价格'], ['cacheRead', '缓存读取价格'], ['cacheWrite', '缓存写入价格']]
const BOUNDS = [['maxInputTokens', '最大输入 Token'], ['maxOutputTokens', '最大输出 Token']]

function NumberField({ label, value, onChange, min = 0, step = 'any' }) {
  return <label className="bb-field"><span>{label}</span>
    <input type="number" min={min} step={step} value={textOf(value)} onChange={event => onChange(event.target.value)} />
  </label>
}

function EnableAccount({ account, onEnable }) {
  const [daily, setDaily] = useState(textOf(account.dailyLimitUsd))
  const [monthly, setMonthly] = useState(textOf(account.monthlyLimitUsd))
  const day = numberOrNull(daily), month = numberOrNull(monthly)
  return <div className="bb-route-account">
    <div className="bb-fields">
      <NumberField label="账户每日上限（USD）" value={daily} onChange={setDaily} />
      <NumberField label="账户每月上限（USD）" value={monthly} onChange={setMonthly} />
    </div>
    <button type="button" disabled={day === null || month === null || day < 0 || month < 0}
      onClick={() => onEnable(account, day, month)}>启用 {account.provider} 资金范围</button>
  </div>
}

export function MainRouteEditor({ draft, defaultRoute, catalog, accounts, busy, onChange, onDefault, onEnableAccount, onSingleRoute }) {
  const used = new Set(draft.routes.map(routeOf))
  const offered = (catalog?.models ?? []).filter(model => !used.has(routeOf(model)))
  const update = (index, route) => onChange({ ...draft, routes: draft.routes.map((item, at) => at === index ? route : item) })
  return <section className="bb-route-editor" aria-label="Main 模型路线">
    <header className="bb-route-heading">
      <strong><UiIcon name="chart" size={16} />Main 模型路线</strong>
      <span className="bb-pill">{draft.routes.filter(route => route.enabled).length} / {draft.routes.length} 已启用</span>
      <p className="bb-note">每条路线单独设置资金渠道。API 路线共用金额预算，订阅路线共用调用次数。</p>
    </header>
    <fieldset className="bb-fieldset" disabled={busy}>
      <details className="bb-fold">
        <summary>共享预算与订阅次数</summary>
        <div className="bb-fold-body">
          <div className="bb-fields">{Object.entries(MAIN_LIMIT_FIELDS).flatMap(([mode, fields]) => fields.map(([key, label]) =>
            <NumberField key={key} label={label} value={draft.limits[mode]?.[key]} step={mode === 'subscription' ? 1 : 'any'}
              onChange={value => onChange({ ...draft, limits: { ...draft.limits, [mode]: { ...draft.limits[mode], [key]: value } } })} />))}</div>
          <p className="bb-note">每日与每月限额成对填写。0 表示禁止消费或调用。</p>
        </div>
      </details>
      {draft.routes.map((route, index) => {
        const id = routeOf(route), model = findModel(catalog, id), primary = defaultRoute === id
        const account = accountFor(accounts, route.provider), funding = route.funding
        const changeFunding = patch => update(index, { ...route, funding: { ...funding, ...patch } })
        return <details key={id} className="bb-route" data-main-route={id}>
          <summary><span><strong>{model?.label ?? route.model}</strong><small>{id}</small></span>
            <span className="bb-pill" data-tone={route.enabled && account?.enabled && model ? 'current' : 'muted'}>
              {primary ? '默认 · ' : ''}{route.enabled ? (account?.enabled && model ? '已启用' : '待配置') : '已停用'}</span>
          </summary>
          <div className="bb-fold-body">
            <div className="bb-row">
              <label className="bb-check"><input type="checkbox" aria-label={`启用路线 ${id}`} checked={route.enabled} onChange={event => update(index, { ...route, enabled: event.target.checked })} />启用路线</label>
              <button type="button" className="bb-link" disabled={primary || !route.enabled || !model} onClick={() => onDefault(route)}>设为默认</button>
              <button type="button" className="bb-link" disabled={primary} onClick={() => onChange({ ...draft, routes: draft.routes.filter(item => item !== route) })}>移除路线</button>
            </div>
            <label className="bb-field"><span>资金渠道</span>
              <select value={funding.mode} onChange={event => changeFunding({ mode: event.target.value, pricing: model?.pricing ?? null, request: null })}>
                {FUNDING_MODES.filter(mode => mode.value === funding.mode || !model?.fundingModes || model.fundingModes.includes(mode.value))
                  .map(mode => <option value={mode.value} key={mode.value}>{mode.label}</option>)}
              </select>
            </label>
            <p className="bb-note">{account?.id === funding.scopeId ? `${account.provider} · ${account.enabled ? '资金范围已启用' : '资金范围未启用'}` : '需要重新选择此提供商的资金范围。'}</p>
            {account && account.id !== funding.scopeId && <button type="button" className="bb-link" onClick={() => changeFunding({ scopeId: account.id })}>选择 {account.provider} 资金范围</button>}
            {account && !account.enabled && <EnableAccount key={`${account.id}:${account.revision}`} account={account} onEnable={onEnableAccount} />}
            {funding.mode === 'api' && <>
              <div className="bb-fields">{PRICES.map(([key, label]) => <NumberField key={key} label={`${label}（USD / 百万 Token）`} value={funding.pricing?.[key]}
                onChange={value => changeFunding({ pricing: { ...funding.pricing, [key]: value } })} />)}
                {BOUNDS.map(([key, label]) => <NumberField key={key} label={label} value={funding.request?.[key]} min={1} step={1}
                  onChange={value => changeFunding({ request: { ...funding.request, [key]: value } })} />)}
              </div>
              {model?.pricing && <button type="button" className="bb-link" onClick={() => changeFunding({ pricing: { ...model.pricing } })}>使用宿主登记的准确价格</button>}
            </>}
          </div>
        </details>
      })}
      {offered.length > 0 && draft.routes.length < 64 && <BotModelPicker label="添加路线" models={offered} disabled={busy}
        note="添加后先配置资金渠道和限额，再启用该路线。"
        onSelect={model => onChange({ ...draft, routes: [...draft.routes, newMainRoute(model, accounts)] })} />}
      <div className="bb-row">
        <button type="button" className="bb-link" onClick={onSingleRoute}>改用单路线</button>
        <small className="bb-note">保存后只保留默认模型的资金配置。</small>
      </div>
    </fieldset>
  </section>
}
