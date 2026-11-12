import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { UiIcon } from './ui-icons.jsx'
import css from './model-picker.css'

const routeOf = value => `${value.provider}/${value.model}`
const labelOf = value => value?.label && value.label !== routeOf(value) ? value.label : value?.model ?? ''

/** OpenMausBot-style compact picker: provider rail, searchable models, explicit choice. */
export function BotModelPicker({ models = [], value = '', onSelect, disabled = false, label = '默认模型', note = '此选择用于当前 Bot，保存配置后生效。' }) {
  const providerName = provider => models.find(model => model.provider === provider)?.providerName ?? provider
  const selected = models.find(model => routeOf(model) === value)
  const providers = useMemo(() => [...new Set(models.map(model => model.provider))], [models])
  const [open, setOpen] = useState(false), [provider, setProvider] = useState(''), [query, setQuery] = useState('')
  const [placement, setPlacement] = useState(null)
  const trigger = useRef(null), panel = useRef(null), search = useRef(null)
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus() }
  const filtered = models.filter(model => (!provider || model.provider === provider) && `${model.provider} ${model.model} ${model.label ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  useEffect(() => {
    const style = document.createElement('style'); style.dataset.botModelPicker = '1'; style.textContent = css; document.head.append(style)
    return () => style.remove()
  }, [])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  useLayoutEffect(() => {
    if (!open) return undefined
    const position = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(560, window.innerWidth - 24), height = Math.min(430, window.innerHeight - 24)
      const below = window.innerHeight - rect.bottom - 12
      const top = below >= Math.min(height, 290) ? rect.bottom + 8 : Math.max(12, Math.min(rect.top - height - 8, window.innerHeight - height - 12))
      setPlacement({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top, width, maxHeight: Math.max(160, Math.min(height, window.innerHeight - top - 12)) })
    }
    position()
    const outside = event => { if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) close(false) }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true) }
  }, [open])
  // The first portal paint is hidden until placement is known. Focus it only
  // after that visible paint; focusing a hidden input is ignored by browsers.
  useLayoutEffect(() => { if (open && placement) search.current?.focus() }, [open, Boolean(placement)])
  const choose = model => { if (!disabled && typeof onSelect === 'function') { onSelect(model); close() } }
  const onKey = event => {
    if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
    const rows = [...panel.current.querySelectorAll('[data-model-choice]')]
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (event.target === search.current || event.target.hasAttribute('data-model-choice'))) {
      event.preventDefault()
      const index = rows.indexOf(document.activeElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : index < 0 ? event.key === 'ArrowUp' ? rows.length - 1 : 0 : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
      rows[next]?.focus(); return
    }
    if (event.key === 'Tab') {
      const controls = [...panel.current.querySelectorAll('*')].filter(node => ['BUTTON', 'INPUT'].includes(node.tagName) && !node.disabled)
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
    }
  }
  return <div className="bp-model-picker">
    <span className="bp-model-picker-label">{label}</span>
    <button ref={trigger} className="bp-model-picker-trigger" type="button" disabled={disabled || !models.length} aria-label={`选择${label}：${selected ? labelOf(selected) : value || '未选择'}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => {
      if (open) { close(); return }
      setProvider(selected?.provider ?? ''); setQuery(''); setOpen(true)
    }}>
      <span className="bp-model-provider-mark" aria-hidden="true">{(selected ? providerName(selected.provider) : '?').slice(0, 2).toUpperCase()}</span>
      <span className="bp-model-current"><strong>{selected ? labelOf(selected) : value || '选择模型'}</strong><small>{selected ? providerName(selected.provider) : (value ? '当前模型暂不可用' : '选择提供商和模型')}</small></span>
      <UiIcon name="chevron" size={15}/>
    </button>
    {!models.length && <p className="bp-model-picker-note">还没有可用模型，请先在模型设置中连接提供商。</p>}
    {value && !selected && <p className="bp-model-picker-note" role="status">已保存的模型暂不在可用目录中，请重新选择或恢复连接。</p>}
    {open && createPortal(<div ref={panel} className="bp-model-popover" role="dialog" aria-modal="true" aria-label="选择 Bot 模型" style={placement ?? { visibility: 'hidden' }} onKeyDown={onKey}>
      <header className="bp-model-search"><UiIcon name="search" size={17}/><input ref={search} aria-label="搜索可用模型" placeholder="搜索模型或提供商…" value={query} onChange={event => setQuery(event.target.value)}/><button type="button" aria-label="关闭模型选择" onClick={() => close()}><UiIcon name="close" size={16}/></button></header>
      <div className="bp-model-options">
        <nav className="bp-model-provider-rail" aria-label="模型提供商"><button type="button" aria-pressed={!provider} onClick={() => setProvider('')}>全部提供商</button>{providers.map(id => <button type="button" data-provider={id} aria-pressed={provider === id} key={id} onClick={() => setProvider(id)}><span aria-hidden="true">{providerName(id).slice(0, 2).toUpperCase()}</span>{providerName(id)}</button>)}</nav>
        <div className="bp-model-results" role="group" aria-label="可用模型"><p className="bp-model-results-caption">{provider ? providerName(provider) : '全部模型'}<span>{filtered.length}</span></p>{filtered.length ? filtered.map(model => {
          const route = routeOf(model)
          return <button key={route} data-model-choice={route} data-route={route} className="bp-model-option" type="button" aria-pressed={route === value} onClick={() => choose(model)}><span><strong>{labelOf(model)}</strong><small>{providerName(model.provider)} · {model.model}</small></span>{route === value && <UiIcon name="check" size={16}/>}</button>
        }) : <p className="bp-model-empty">没有匹配的模型，试试其他关键词或提供商。</p>}</div>
      </div>
      <footer>{note}</footer>
    </div>, document.body)}
  </div>
}
