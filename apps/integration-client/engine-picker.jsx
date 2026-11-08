import React, { useMemo, useState } from 'react'
import { EXECUTION_MODE_LABELS, engineRail, officialToolCards, patchOfficialTool, routeRef, toggleOfficialTool } from './engine-binding.mjs'

export function EngineBrainPicker({ botName, models, value, onChange }) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState('')
  const rail = useMemo(() => engineRail(models, query), [models, query])
  const currentProvider = value.includes('/') ? value.slice(0, value.indexOf('/')) : ''
  const active = rail.some(group => group.id === picked) ? picked : (rail.find(group => group.id === currentProvider)?.id ?? rail[0]?.id ?? '')
  const group = rail.find(item => item.id === active)
  const visible = group?.models.some(model => routeRef(model) === value)
  return <div className="bp-engine">
    <div className="bp-engine-rail" aria-label={`${botName} 的模型供应商`}>
      {rail.map(item => <button key={item.id} type="button" aria-pressed={item.id === active} onClick={() => setPicked(item.id)}>
        <span>{item.label}</span><small>{item.models.length}</small>
      </button>)}
      {!rail.length && <p className="bp-muted">没有匹配的供应商。</p>}
    </div>
    <div className="bp-engine-main">
      <label className="bp-engine-search">搜索模型
        <input aria-label={`${botName} 的模型搜索`} value={query} onChange={event => setQuery(event.target.value)} placeholder="供应商、模型或名称" />
      </label>
      <div className="bp-engine-models" role="radiogroup" aria-label={`${botName} 的绑定模型`}>
        {(group?.models ?? []).map(model => {
          const ref = routeRef(model)
          const checked = ref === value
          return <button key={ref} type="button" role="radio" aria-checked={checked} onClick={() => onChange(ref)}>
            <span><strong>{model.label && model.label !== ref ? model.label : model.model}</strong><small>{ref}</small></span>
            {checked && <em>当前大脑</em>}
          </button>
        })}
        {!group && <p className="bp-muted">宿主目录里还没有可绑定的准确模型。</p>}
      </div>
      {value && !visible && <p className="bp-muted">当前大脑不在这次搜索结果里，尚未改动。</p>}
    </div>
  </div>
}

export function OfficialToolModule({ botName, tools, model, selected, onChange }) {
  const cards = officialToolCards({ tools, model, selected })
  const ready = cards.filter(card => ['ready', 'on', 'stale'].includes(card.status)).length
  return <fieldset className="bp-tool-module">
    <legend>官方工具</legend>
    <p className="bp-muted">大脑决定这个 Bot 用哪条已配置模型。官方工具是另外授予的本机 CLI，只有宿主核验过的身份才能打开。电脑仍使用你自己配对的机器。</p>
    <p className="bp-muted" aria-live="polite">{botName}：{ready} 个工具可授予，{cards.length - ready} 个尚不可用。</p>
    <div className="bp-tool-grid">
      {cards.map(card => {
        const editable = ['ready', 'on', 'stale'].includes(card.status)
        const checked = card.status === 'on' || card.status === 'stale'
        return <article key={card.toolId} className="bp-tool-card" data-status={card.status}>
          <header>
            <label><input type="checkbox" aria-label={`${botName} 的 ${card.label}`} checked={checked} disabled={!editable}
              onChange={event => onChange(toggleOfficialTool(selected, card, event.target.checked))} />
              <span><strong>{card.label}</strong><small>{[card.vendor, card.source].filter(Boolean).join(' · ')}</small></span>
            </label>
          </header>
          <p>{card.reason}</p>
          {editable && checked && <>
            {card.mappings.length > 1 && <label>CLI 身份<select aria-label={`${card.label} 的 CLI 身份`} value={card.selected?.cliModel ?? ''} onChange={event => onChange(patchOfficialTool(selected, card.toolId, { cliModel: event.target.value }))}>
              {card.mappings.map(item => <option key={item.model} value={item.model}>{item.model}</option>)}
            </select></label>}
            {card.modes.length > 1 && <label>执行模式<select aria-label={`${card.label} 的执行模式`} value={card.selected?.mode ?? ''} onChange={event => onChange(patchOfficialTool(selected, card.toolId, { mode: event.target.value }))}>
              {card.modes.map(mode => <option key={mode} value={mode}>{EXECUTION_MODE_LABELS[mode]}</option>)}
            </select></label>}
            {card.status === 'stale' && <button type="button" onClick={() => onChange(toggleOfficialTool(toggleOfficialTool(selected, card, false), card, true))}>按当前目录重新对齐</button>}
          </>}
          {!editable && card.selected && <button type="button" onClick={() => onChange(toggleOfficialTool(selected, card, false))}>移除此授权</button>}
        </article>
      })}
    </div>
    </fieldset>
}
