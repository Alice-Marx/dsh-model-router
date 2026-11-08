import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { UiIcon } from './ui-icons.jsx'
import {
  ROUTER_CAPABILITY, SEARCH_THRESHOLD, apiEngines, brainSummary, engineMark, engineSetup, engineStatus, filterModels,
  initialEngine, officialEngines, pickModel, routerAccess, setRouterAccess, suggestedModels, toggleDelegation, toolLabel,
} from './brain-catalog.mjs'

const MODE_LABEL = { 'read-only': '只读', 'workspace-write': '可写' }

export function EngineMark({ mark, size = 'md' }) {
  return <span className={`bp-engine-mark bp-engine-mark-${size}`} style={{ '--bp-mark': mark.color }} aria-hidden="true">{mark.letters}</span>
}

export function StatusPill({ status }) {
  return <span className="bp-pill" data-tone={status.tone}>{status.text}</span>
}

/** The Bot card's read-only view of its brain and attached official tools. */
export function BrainBadge({ model, officialTools = [], canCallTools = false }) {
  const ref = typeof model === 'string' ? model : model?.provider && model?.model ? `${model.provider}/${model.model}` : ''
  const provider = ref ? ref.slice(0, ref.indexOf('/')) : ''
  return <div className="bp-brain-badge">
    <span className="bp-brain-badge-main"><EngineMark mark={engineMark(provider || '?')} /><span className="bp-brain-copy">
      <strong>{ref || '尚未选择准确模型'}</strong><small>{ref ? '大脑 · 精确绑定，不可用时暂停并说明原因' : '在下方编辑绑定中选择大脑'}</small></span></span>
    {(officialTools.length > 0 || canCallTools) && <ul className="bp-brain-tools" aria-label="官方工具">
      {officialTools.map(tool => <li key={`${tool.toolId}/${tool.cliModel}`}><EngineMark mark={engineMark(toolLabel(tool.toolId), tool.toolId)} size="xs" />
        {toolLabel(tool.toolId)}<small>{tool.cliModel ?? '未核验模型'} · {tool.identityStatus ?? tool.identityPolicy ?? tool.mode ?? '委派'}</small></li>)}
      {canCallTools && <li><UiIcon name="terminal" size={14} />可通过模型路由调用官方工具</li>}
    </ul>}
  </div>
}

/**
 * The binding picker: brain (one exact API route) plus the official tools this Bot may use.
 * `selection` is `{ model, officialTools, capabilities }`, in the shape the binding form saves.
 */
export function BrainPicker({ botName, catalog, selection, onChange, readEngines, openTools, disabled = false }) {
  const [open, setOpen] = useState(false)
  const [engineId, setEngineId] = useState('')
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [view, setView] = useState(null)
  const [viewError, setViewError] = useState('')
  const [loading, setLoading] = useState(false)
  const root = useRef(null)
  const trigger = useRef(null)
  const paneId = useId()
  const api = useMemo(() => apiEngines(catalog), [catalog])
  const official = useMemo(() => officialEngines(view, catalog), [view, catalog])
  const engines = useMemo(() => [...api, ...official], [api, official])
  const engine = engines.find(item => item.id === engineId) ?? engines.find(item => item.id === initialEngine(engines, selection.model)) ?? null
  const summary = brainSummary(selection, catalog)
  const routerOffered = (catalog?.capabilities ?? []).some(item => item.id === ROUTER_CAPABILITY)

  const load = useCallback(async fresh => {
    if (typeof readEngines !== 'function') return
    setLoading(true)
    try {
      const value = await readEngines(fresh ? { fresh: true } : {})
      if (value?.status === 'available' && Array.isArray(value.items)) { setView(value); setViewError('') }
      else setViewError(value?.reason ?? '宿主没有返回官方工具状态。')
    } catch (failure) {
      setViewError(String(failure?.message ?? failure))
    } finally {
      setLoading(false)
    }
  }, [readEngines])

  useEffect(() => { if (open && !view && !loading && !viewError) void load(false) }, [open])
  useEffect(() => {
    if (!open) return undefined
    const outside = event => { if (root.current && !root.current.contains(event.target)) setOpen(false) }
    const escape = event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus() } }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape, true) }
  }, [open])

  const choose = id => { setEngineId(id); setQuery(''); setShowAll(false) }
  const attachedCount = item => item.kind === 'official'
    ? selection.officialTools.filter(tool => tool.toolId === item.toolId).length
    : item.models.some(model => model.ref === selection.model) ? 1 : 0

  const rail = (label, items) => items.length ? <div className="bp-brain-rail-group" role="group" aria-label={label}>
    <span className="bp-brain-rail-label" aria-hidden="true">{label}</span>
    {items.map(item => {
      const status = engineStatus(item)
      return <button key={item.id} type="button" className="bp-brain-engine" role="tab" aria-selected={item.id === engine?.id} aria-controls={paneId}
        aria-label={`${item.label}（${status.text}）`} title={`${item.label} · ${status.text}`} onClick={() => choose(item.id)}
        data-attention={status.tone === 'warning' ? 'true' : undefined} data-attached={attachedCount(item) ? 'true' : undefined}>
        <EngineMark mark={engineMark(item.label, item.toolId)} size="sm" />
      </button>
    })}
  </div> : null

  return <div className="bp-brain" ref={root}>
    <button ref={trigger} type="button" className="bp-brain-trigger" aria-haspopup="dialog" aria-expanded={open} disabled={disabled}
      aria-label={`${botName} 的大脑与官方工具：${summary.ref || '尚未选择'}`} onClick={() => setOpen(value => !value)}>
      <EngineMark mark={summary.mark} />
      <span className="bp-brain-copy"><strong>{summary.title}</strong><small>{summary.detail}</small></span>
      <UiIcon name="caret" size={15} />
    </button>
    {open && <div className="bp-brain-pop" role="dialog" aria-label={`${botName} 的大脑与官方工具`}>
      <div className="bp-brain-rail" role="tablist" aria-orientation="vertical" aria-label="引擎">
        {rail('大脑', api)}
        {rail('官方工具', official)}
        {!view && typeof readEngines === 'function' && <span className="bp-brain-rail-label" aria-live="polite">{loading ? '体检中' : '官方'}</span>}
      </div>
      <section className="bp-brain-pane" id={paneId} role="tabpanel" aria-label={engine?.label ?? '引擎'}>
        {engine ? <EnginePane engine={engine} catalog={catalog} selection={selection} onChange={onChange} query={query} setQuery={setQuery}
          showAll={showAll} setShowAll={setShowAll} routerOffered={routerOffered} loading={loading} refresh={readEngines ? () => load(true) : null} openTools={openTools} />
          : <p className="bp-brain-empty">宿主目录里还没有可绑定的模型。先在 Harness 模型页配置供应商，再刷新本页。</p>}
        {viewError && <p className="bp-brain-note" role="status">官方工具状态暂不可用：{viewError}</p>}
        <footer className="bp-brain-foot">
          {openTools && <button type="button" onClick={openTools}><UiIcon name="terminal" size={14} />官方工具设置</button>}
          <span>精确路由 · 保存后由宿主核验</span>
        </footer>
      </section>
    </div>}
  </div>
}

function EnginePane({ engine, catalog, selection, onChange, query, setQuery, showAll, setShowAll, routerOffered, loading, refresh, openTools }) {
  const status = engineStatus(engine)
  const header = <header className="bp-brain-head">
    <span className="bp-brain-head-copy"><strong>{engine.label}</strong><small>{engine.kind === 'api' ? 'API 模型 · 精确路由' : engine.vendor}</small></span>
    {engine.kind === 'official' && refresh && <button type="button" className="bp-brain-icon" onClick={refresh} disabled={loading} aria-label="重新体检官方工具" title="重新体检（只读）">
      <UiIcon name="refresh" size={14} className={loading ? 'bp-spinning' : ''} /></button>}
    <StatusPill status={status} />
  </header>
  if (engine.kind === 'api') {
    const found = filterModels(engine.models, query)
    const list = query || showAll ? found : suggestedModels(found, selection.model)
    return <>
      {header}
      {engine.models.length > SEARCH_THRESHOLD && <label className="bp-brain-search"><UiIcon name="search" size={14} />
        <input type="search" value={query} placeholder="搜索模型" aria-label={`搜索 ${engine.label} 的模型`} onChange={event => setQuery(event.target.value)} /></label>}
      <div className="bp-brain-list" role="listbox" aria-label={`${engine.label} 的模型`}>
        {list.map(model => {
          const selected = model.ref === selection.model
          return <button key={model.ref} type="button" role="option" aria-selected={selected} className="bp-brain-model" onClick={() => onChange(pickModel(selection, model.ref, catalog))}>
            <span className="bp-brain-model-copy"><strong>{model.label}</strong>
              <small>{[model.provider, model.cliTools.length ? `可委派 ${model.cliTools.join('、')}` : ''].filter(Boolean).join(' · ')}</small></span>
            {selected && <UiIcon name="check" size={15} />}
          </button>
        })}
        {!list.length && <p className="bp-brain-empty">没有匹配“{query}”的模型。</p>}
      </div>
      {!query && engine.models.length > list.length && <button type="button" className="bp-brain-more" onClick={() => setShowAll(true)}>全部模型（{engine.models.length}）</button>}
      {!query && showAll && engine.models.length > SEARCH_THRESHOLD && <button type="button" className="bp-brain-more" onClick={() => setShowAll(false)}>只看推荐</button>}
    </>
  }
  const setup = engineSetup(engine)
  const { row } = engine
  const access = routerAccess(selection)
  return <>
    {header}
    {setup && <div className="bp-brain-setup" role="status"><strong>{setup.title}</strong><p>{setup.detail}</p>
      {setup.command && <code>{setup.command}</code>}
      {openTools && <button type="button" onClick={openTools}>打开官方工具页</button>}</div>}
    {row.updateAvailable && row.latestVersion && <p className="bp-brain-note">有新版本 v{row.latestVersion}，可在官方工具页更新。</p>}
    <h4 className="bp-brain-section">托管委派</h4>
    {engine.delegations.length ? <div className="bp-brain-list" role="group" aria-label={`${engine.label} 的托管委派`}>
      {engine.delegations.map(delegation => {
        const attached = selection.officialTools.some(tool => tool.toolId === engine.toolId && tool.cliModel === delegation.cliModel)
        const moves = !attached && delegation.ref !== selection.model
        return <button key={`${delegation.ref}/${delegation.cliModel}`} type="button" className="bp-brain-model" aria-pressed={attached}
          onClick={() => onChange(toggleDelegation(selection, { toolId: engine.toolId, cliModel: delegation.cliModel, ref: delegation.ref, mode: delegation.modes[0] }, catalog))}>
          <span className="bp-brain-model-copy"><strong>{delegation.cliModel}</strong>
            <small>{[`对应 ${delegation.ref}`, delegation.modes.map(mode => MODE_LABEL[mode] ?? mode).join('、'), moves ? '选择后大脑同时切换' : ''].filter(Boolean).join(' · ')}</small></span>
          {attached && <UiIcon name="check" size={15} />}
        </button>
      })}
    </div> : <p className="bp-brain-empty">宿主尚未为 {engine.label} 核验托管委派模型。目前只有在插件配置 taskCli 中登记并核验过入口的 Codex 模型可以委派为 Bot 任务。</p>}
    {routerOffered && <>
      <h4 className="bp-brain-section">通过模型路由使用</h4>
      <label className="bp-brain-switch"><input type="checkbox" checked={access} onChange={event => onChange(setRouterAccess(selection, event.target.checked))} />
        <span><strong>允许此 Bot 调用官方工具</strong><small>授予模型路由能力（model_router_tool_run 等），对所有已就绪的官方工具生效；写入与安装仍逐次请求批准。</small></span></label>
      <p className="bp-brain-note">{row.execution.supported
        ? `宿主可托管执行 ${row.label}：${row.execution.modes.map(mode => MODE_LABEL[mode] ?? mode).join('、') || '模式待核验'}。`
        : `${row.label}：${row.execution.reason}`}</p>
    </>}
  </>
}
