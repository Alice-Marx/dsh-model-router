import React, { useEffect, useMemo, useState } from 'react'
import { Blocked } from './panels.jsx'

/** Kept in step with MODEL_EFFORTS in packages/orchestration/src/bot-settings.mjs. */
const MODEL_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max']

const route = model => model ? `${model.provider}/${model.model}` : ''
const workspace = ref => ref ? `${ref.machineId}/${ref.rootId}` : ''
const selectionKey = value => value ? `${value.instanceId}\0${value.model}` : ''
const EFFORT_LABELS = { none: '关闭', low: '低', medium: '中', high: '高', xhigh: '更高', max: '最高' }
const MODE_LABELS = { 'read-only': '只读', 'workspace-write': '工作区可写', 'cli-native': '原生 CLI' }

function optionOf(engines, selection) {
  if (!selection) return null
  const engine = engines.find(item => item.instanceId === selection.instanceId)
  return engine?.models.find(item => item.id === selection.model) ?? null
}

function inferSelection(engines, model) {
  if (!model) return null
  const engine = engines.find(item => item.instanceId === `api:${model.provider}`)
  const option = engine?.models.find(item => item.provider === model.provider && item.model === model.model)
  return option ? { instanceId: engine.instanceId, model: option.id, effort: null, variant: null } : null
}

export function BotBindingEditor({ bot, record, accounts, dispatch, busy }) {
  const [form, setForm] = useState(null)
  const engines = (record?.catalog.engines ?? []).filter(engine => engine.kind !== 'official-tool' || (record.catalog.tools ?? []).some(tool => tool.toolId === engine.toolId && tool.modes?.length))
  useEffect(() => {
    if (!record) { setForm(null); return }
    const value = record.settings
    const selectedWorkspace = value.workspaceRef ?? value.machineGrants[0] ?? null
    const selection = value.selection ?? inferSelection(record.catalog.engines ?? [], value.model)
    setForm({
      enabled: value.enabled, model: route(value.model), selection, fallback: value.fallback ?? [],
      workspace: workspace(selectedWorkspace), workspaceMode: selectedWorkspace?.mode ?? 'read-only',
      capabilities: value.capabilities.length ? value.capabilities : record.catalog.capabilities.map(item => item.id),
      officialTools: value.officialTools, fundingMode: value.funding.mode,
      input: value.funding.pricing?.input ?? 1, output: value.funding.pricing?.output ?? 2,
      maxInputTokens: value.funding.request?.maxInputTokens ?? 100000, maxOutputTokens: value.funding.request?.maxOutputTokens ?? 4096,
      daily: value.funding.dailyBudgetUsd ?? 5, monthly: value.funding.monthlyBudgetUsd ?? 50,
      accountDaily: 10, accountMonthly: 100,
      dailyCalls: value.funding.subscription?.dailyCalls ?? 20, monthlyCalls: value.funding.subscription?.monthlyCalls ?? 200,
      maxConcurrentTasks: value.maxConcurrentTasks,
      routing: {
        preset: value.routing?.preset ?? '',
        dailyBudgetUsd: value.routing?.dailyBudgetUsd ?? '',
        monthlyBudgetUsd: value.routing?.monthlyBudgetUsd ?? '',
      },
    })
  }, [bot.id, record?.revision])
  const model = useMemo(() => {
    if (!form) return null
    const picked = optionOf(engines, form.selection)
    if (picked) return record.catalog.models.find(item => route(item) === route(picked)) ?? null
    return record?.catalog.models.find(item => route(item) === form.model) ?? null
  }, [record, form, engines])
  const account = accounts.items.find(item => item.provider === model?.provider)
  if (!record || !form) return <Blocked value={{ reason: '此 Bot 尚未取得绑定目录。' }} />
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const selectedMachine = form.workspace.split('/')[0]
  const selectedRoot = form.workspace.split('/').slice(1).join('/')
  const routing = form.routing ?? { preset: '', dailyBudgetUsd: '', monthlyBudgetUsd: '' }
  const activeEngine = engines.find(item => item.instanceId === form.selection?.instanceId) ?? null
  const toolsFor = picked => (picked ? record.catalog.models.find(item => route(item) === route(picked))?.cliModels ?? [] : [])
  const keepTools = (tools, picked, engine) => {
    const allowed = new Set(toolsFor(picked).map(item => `${item.toolId}\0${item.model}`))
    let next = tools.filter(tool => allowed.has(`${tool.toolId}\0${tool.cliModel}`))
    if (engine?.kind === 'official-tool') {
      const mapping = toolsFor(picked).find(item => item.toolId === engine.toolId)
      const modes = record.catalog.tools.find(item => item.toolId === engine.toolId)?.modes ?? []
      if (mapping && modes.length && !next.some(tool => tool.toolId === engine.toolId && tool.cliModel === mapping.model)) {
        next = [...next, { toolId: engine.toolId, cliModel: mapping.model, mode: modes[0] }]
      }
    }
    return next
  }
  const chooseEngine = instanceId => {
    const engine = engines.find(item => item.instanceId === instanceId)
    const option = engine?.models[0]
    if (!option) return
    setForm(current => ({ ...current, model: route(option), officialTools: keepTools(current.officialTools, option, engine),
      selection: { instanceId, model: option.id, effort: current.selection?.effort ?? null, variant: current.selection?.variant ?? null } }))
  }
  const chooseModel = modelId => {
    const option = activeEngine?.models.find(item => item.id === modelId)
    if (!option || !activeEngine) return
    setForm(current => ({ ...current, model: route(option), officialTools: keepTools(current.officialTools, option, activeEngine),
      selection: { ...current.selection, instanceId: activeEngine.instanceId, model: option.id } }))
  }
  const enableAccount = () => dispatch('funding.account.save', { scopeId: account.id, expectedRevision: account.revision, enabled: true,
    dailyLimitUsd: Number(form.accountDaily), monthlyLimitUsd: Number(form.accountMonthly) })
  const save = event => {
    event.preventDefault()
    const picked = optionOf(engines, form.selection)
    const settings = {
      schemaVersion: 1, enabled: form.enabled,
      model: picked ? { provider: picked.provider, model: picked.model } : (model ? { provider: model.provider, model: model.model } : null),
      selection: engines.length && picked ? { instanceId: form.selection.instanceId, model: picked.id, effort: form.selection.effort ?? null, variant: form.selection.variant ?? null } : (engines.length ? null : record.settings.selection),
      fallback: form.fallback,
      officialTools: form.officialTools,
      machineGrants: selectedMachine && selectedRoot ? [{ machineId: selectedMachine, rootId: selectedRoot, mode: form.workspaceMode, capabilities: [] }] : [],
      capabilities: form.capabilities,
      workspaceRef: selectedMachine && selectedRoot ? { kind: record.catalog.machines.find(item => item.machineId === selectedMachine)?.location ?? 'local', machineId: selectedMachine, rootId: selectedRoot } : null,
      funding: {
        mode: form.fundingMode, scopeId: account?.enabled ? account.id : null,
        pricing: form.fundingMode === 'api' ? { input: Number(form.input), output: Number(form.output) } : null,
        request: form.fundingMode === 'api' ? { maxInputTokens: Number(form.maxInputTokens), maxOutputTokens: Number(form.maxOutputTokens) } : null,
        dailyBudgetUsd: form.fundingMode === 'api' ? Number(form.daily) : null,
        monthlyBudgetUsd: form.fundingMode === 'api' ? Number(form.monthly) : null,
        subscription: form.fundingMode === 'subscription' ? { dailyCalls: Number(form.dailyCalls), monthlyCalls: Number(form.monthlyCalls) } : null,
      },
      maxConcurrentTasks: Number(form.maxConcurrentTasks),
      routing: routing.preset === '' && routing.dailyBudgetUsd === '' && routing.monthlyBudgetUsd === ''
        ? null
        : {
          preset: routing.preset === '' ? null : routing.preset,
          dailyBudgetUsd: routing.dailyBudgetUsd === '' ? null : Number(routing.dailyBudgetUsd),
          monthlyBudgetUsd: routing.monthlyBudgetUsd === '' ? null : Number(routing.monthlyBudgetUsd),
        },
    }
    return dispatch('binding.save', { botId: bot.id, expectedRevision: record.revision, settings })
  }
  const picked = optionOf(engines, form.selection)
  const cliMappings = (model?.cliModels ?? []).filter((item, index, items) => items.findIndex(other => other.toolId === item.toolId && other.model === item.model) === index)
    .map(mapping => ({ mapping, entry: record.catalog.tools.find(item => item.toolId === mapping.toolId) }))
    .filter(item => item.entry?.modes.length)
  const taken = new Set([selectionKey(form.selection), ...form.fallback.map(selectionKey)])
  const freeModel = engine => engine.models.find(item => !taken.has(`${engine.instanceId}\0${item.id}`))
  const addable = engines.filter(engine => freeModel(engine) && form.fallback.length < 5)
  const addFallback = instanceId => {
    const engine = addable.find(item => item.instanceId === instanceId)
    const option = engine && freeModel(engine)
    if (!option) return
    change('fallback', [...form.fallback, { instanceId, model: option.id }])
  }
  return <details className="bp-card" open={record.status !== 'available'}>
    <summary>配置并启用此 Bot</summary>
    <form className="bp-form" onSubmit={save}>
      {engines.length > 0 ? <fieldset className="bp-engine-block">
        <legend>这个 Bot 用哪一个引擎</legend>
        <p className="bp-muted">左侧是引擎，右侧是该引擎里已经核验过的模型。官方工具引擎会同时授予对应 CLI；备用模型只作记录，不会变成额外的模型授权。</p>
        <div className="bp-engine">
          <div className="bp-engine-rail" role="listbox" aria-label={`${bot.name} 的引擎`}>
            {engines.some(item => item.kind === 'official-tool') && <p>官方工具</p>}
            {engines.filter(item => item.kind === 'official-tool').map(engine => <button key={engine.instanceId} type="button" aria-pressed={engine.instanceId === activeEngine?.instanceId} onClick={() => chooseEngine(engine.instanceId)}>{engine.label}</button>)}
            <p>API 路线</p>
            {engines.filter(item => item.kind === 'api').map(engine => <button key={engine.instanceId} type="button" aria-pressed={engine.instanceId === activeEngine?.instanceId} onClick={() => chooseEngine(engine.instanceId)}>{engine.label}</button>)}
          </div>
          <div className="bp-model-list" role="listbox" aria-label={`${bot.name} 的绑定模型`}>
            {(activeEngine?.models ?? []).map(item => <button key={item.id} type="button" aria-pressed={item.id === form.selection?.model && activeEngine.instanceId === form.selection?.instanceId} onClick={() => chooseModel(item.id)}>{item.label}</button>)}
            {!activeEngine && <p className="bp-muted">先从左侧选择一个引擎。</p>}
            {activeEngine && !activeEngine.models.length && <p className="bp-muted">这个引擎还没有可绑定的模型。</p>}
          </div>
        </div>
        {form.selection?.instanceId && <div className="bp-effort" role="group" aria-label={`${bot.name} 的推理力度`}>
          <button type="button" aria-pressed={!form.selection?.effort} onClick={() => change('selection', { ...form.selection, effort: null })}>默认</button>
          {MODEL_EFFORTS.map(effort => <button key={effort} type="button" aria-pressed={form.selection?.effort === effort} onClick={() => change('selection', { ...form.selection, effort })}>{EFFORT_LABELS[effort]}</button>)}
        </div>}
        <p className="bp-muted">推理力度记在这条绑定上。聊天会话仍使用宿主模型自己的思考档位；这里不会改写厂商参数，也不会扩大授权。</p>
      </fieldset> : <label>准确模型<select aria-label={`${bot.name} 的绑定模型`} value={form.model} onChange={event => { change('model', event.target.value); change('officialTools', []) }} required>
        <option value="" disabled>请选择</option>{record.catalog.models.map(item => <option key={route(item)} value={route(item)}>{route(item)}</option>)}
      </select></label>}
      <fieldset>
        <legend>备用模型</legend>
        <p className="bp-muted">按顺序记下最多五个备用引擎。宿主以后做恢复时才能用到；现在保存不会把它们加入模型授权。</p>
        {form.fallback.length > 0 && <ol className="bp-fallback">{form.fallback.map((entry, index) => {
          const engine = engines.find(item => item.instanceId === entry.instanceId)
          const models = engine?.models.filter(item => item.id === entry.model || !taken.has(`${entry.instanceId}\0${item.id}`) || item.id === entry.model) ?? []
          return <li key={`${entry.instanceId}-${index}`}><span>{index + 1}.</span><span>{engine?.label ?? entry.instanceId}</span>
            <select aria-label={`${engine?.label ?? entry.instanceId} 的备用模型`} value={entry.model} onChange={event => change('fallback', form.fallback.map((item, at) => at === index ? { ...item, model: event.target.value } : item))}>
              {(models.length ? models : [{ id: entry.model, label: entry.model }]).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <button type="button" aria-label={`移除备用 ${engine?.label ?? entry.instanceId}`} onClick={() => change('fallback', form.fallback.filter((_, at) => at !== index))}>移除</button></li>
        })}</ol>}
        {engines.length > 0 && form.fallback.length < 5 && <label>添加备用<select aria-label={`${bot.name} 的备用模型`} value="" onChange={event => addFallback(event.target.value)} disabled={!addable.length}>
          <option value="">{addable.length ? '选择一个引擎' : '没有还能添加的引擎'}</option>
          {addable.map(engine => <option key={engine.instanceId} value={engine.instanceId}>{engine.label}{engine.instanceId === form.selection?.instanceId ? ' · 同一引擎' : ''}</option>)}
        </select></label>}
      </fieldset>
      {model && account && !account.enabled && <aside className="bp-blocked"><strong>资金范围尚未启用</strong><p>{account.provider} 需要本地预算上限；它不是厂商余额。</p>
        <label>账户每日上限（USD）<input type="number" min="0" step="0.01" value={form.accountDaily} onChange={event => change('accountDaily', event.target.value)} /></label>
        <label>账户每月上限（USD）<input type="number" min="0" step="0.01" value={form.accountMonthly} onChange={event => change('accountMonthly', event.target.value)} /></label>
        <button type="button" disabled={busy} onClick={enableAccount}>启用 {account.provider} 资金范围</button></aside>}
      <label>工作区<select aria-label={`${bot.name} 的绑定工作区`} value={form.workspace} onChange={event => change('workspace', event.target.value)} required>
        <option value="" disabled>请选择</option>{record.catalog.machines.flatMap(machine => machine.roots.map(root => <option key={`${machine.machineId}/${root.rootId}`} value={`${machine.machineId}/${root.rootId}`}>{machine.label} / {root.label}</option>))}
      </select></label>
      <label>工作区权限<select value={form.workspaceMode} onChange={event => change('workspaceMode', event.target.value)}><option value="read-only">只读</option><option value="workspace-write">允许写入</option></select></label>
      <fieldset><legend>Bot 路由策略</legend>
        <p className="bp-muted">这个 Bot 派活给别人时用哪套取舍；留空表示沿用全局预设。</p>
        <label>预设<select aria-label={`${bot.name} 的路由预设`} value={routing.preset} onChange={event => change('routing', { ...routing, preset: event.target.value })}>
          <option value="">沿用全局</option><option value="economy">省钱优先</option><option value="balanced">均衡</option><option value="quality">效果优先</option>
        </select></label>
        <label>每日预算（USD）<input type="number" min="0" step="0.01" value={routing.dailyBudgetUsd} onChange={event => change('routing', { ...routing, dailyBudgetUsd: event.target.value })} placeholder="留空表示不单独限制" /></label>
        <label>每月预算（USD）<input type="number" min="0" step="0.01" value={routing.monthlyBudgetUsd} onChange={event => change('routing', { ...routing, monthlyBudgetUsd: event.target.value })} placeholder="留空表示不单独限制" /></label>
      </fieldset>
      <fieldset><legend>路由与任务能力</legend>{record.catalog.capabilities.map(capability => <label key={capability.id}><input type="checkbox" checked={form.capabilities.includes(capability.id)} onChange={event => change('capabilities', event.target.checked ? [...form.capabilities, capability.id] : form.capabilities.filter(id => id !== capability.id))} />{capability.label}</label>)}</fieldset>
      <fieldset><legend>使用官方工具</legend>
        <p className="bp-muted">只列出宿主已经核验过、并且和当前模型对得上的 CLI。执行模式来自该工具获准的列表。选官方工具当引擎时，对应工具必须勾上。</p>
        {cliMappings.length === 0 && <p className="bp-muted">当前模型还没有已核验的官方工具。</p>}
        {cliMappings.map(({ mapping, entry }) => {
          const selected = form.officialTools.find(tool => tool.toolId === mapping.toolId && tool.cliModel === mapping.model)
          const required = activeEngine?.kind === 'official-tool' && activeEngine.toolId === mapping.toolId && picked?.cliModel === mapping.model
          return <div key={`${mapping.toolId}/${mapping.model}`} className="bp-tool-row">
            <label><input type="checkbox" checked={Boolean(selected)} disabled={required} onChange={event => change('officialTools', event.target.checked
              ? [...form.officialTools, { toolId: mapping.toolId, cliModel: mapping.model, mode: entry.modes[0] }]
              : form.officialTools.filter(tool => !(tool.toolId === mapping.toolId && tool.cliModel === mapping.model)))} />{entry.label ?? mapping.toolId} / {mapping.model}{required ? '（当前引擎）' : ''}</label>
            <select aria-label={`${mapping.toolId} 的执行模式`} value={selected?.mode ?? entry.modes[0]} disabled={!selected} onChange={event => change('officialTools', form.officialTools.map(tool => tool.toolId === mapping.toolId && tool.cliModel === mapping.model ? { ...tool, mode: event.target.value } : tool))}>
              {entry.modes.map(mode => <option key={mode} value={mode}>{MODE_LABELS[mode] ?? mode}</option>)}
            </select>
          </div>
        })}
      </fieldset>
      <label>资金渠道<select value={form.fundingMode} onChange={event => change('fundingMode', event.target.value)}><option value="api">API（金额）</option><option value="subscription">订阅（调用次数）</option></select></label>
      {form.fundingMode === 'api' ? <>
        <label>输入价格（USD / 百万 Token）<input type="number" min="0" step="0.000001" value={form.input} onChange={event => change('input', event.target.value)} required /></label>
        <label>输出价格（USD / 百万 Token）<input type="number" min="0" step="0.000001" value={form.output} onChange={event => change('output', event.target.value)} required /></label>
        <label>最大输入 Token<input type="number" min="1" step="1" value={form.maxInputTokens} onChange={event => change('maxInputTokens', event.target.value)} required /></label>
        <label>最大输出 Token<input type="number" min="1" step="1" value={form.maxOutputTokens} onChange={event => change('maxOutputTokens', event.target.value)} required /></label>
        <label>Bot 每日预算（USD）<input type="number" min="0" step="0.01" value={form.daily} onChange={event => change('daily', event.target.value)} required /></label>
        <label>Bot 每月预算（USD）<input type="number" min="0" step="0.01" value={form.monthly} onChange={event => change('monthly', event.target.value)} required /></label>
      </> : <>
        <label>每日订阅调用次数<input type="number" min="0" step="1" value={form.dailyCalls} onChange={event => change('dailyCalls', event.target.value)} required /></label>
        <label>每月订阅调用次数<input type="number" min="0" step="1" value={form.monthlyCalls} onChange={event => change('monthlyCalls', event.target.value)} required /></label>
      </>}
      <label>最大并发任务<input type="number" min="1" max="32" step="1" value={form.maxConcurrentTasks} onChange={event => change('maxConcurrentTasks', event.target.value)} required /></label>
      <label><input type="checkbox" checked={form.enabled} onChange={event => change('enabled', event.target.checked)} />启用此绑定（模型、工作区和资金范围必须完整）</label>
      <button type="submit" disabled={busy || form.enabled && (!model || !account?.enabled || !selectedMachine || !selectedRoot)}>保存绑定</button>
      {record.blockedReason && <Blocked value={record} />}
    </form>
  </details>
}
