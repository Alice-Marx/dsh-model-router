import React, { useEffect, useMemo, useState } from 'react'
import { Blocked } from './panels.jsx'

const route = model => model ? `${model.provider}/${model.model}` : ''
const workspace = ref => ref ? `${ref.machineId}/${ref.rootId}` : ''

export function BotBindingEditor({ bot, record, accounts, dispatch, busy }) {
  const [form, setForm] = useState(null)
  useEffect(() => {
    if (!record) { setForm(null); return }
    const value = record.settings
    const selectedWorkspace = value.workspaceRef ?? value.machineGrants[0] ?? null
    setForm({
      enabled: value.enabled, model: route(value.model), workspace: workspace(selectedWorkspace), workspaceMode: selectedWorkspace?.mode ?? 'read-only',
      capabilities: value.capabilities.length ? value.capabilities : record.catalog.capabilities.map(item => item.id),
      officialTools: value.officialTools, fundingMode: value.funding.mode,
      input: value.funding.pricing?.input ?? 1, output: value.funding.pricing?.output ?? 2,
      maxInputTokens: value.funding.request?.maxInputTokens ?? 100000, maxOutputTokens: value.funding.request?.maxOutputTokens ?? 4096,
      daily: value.funding.dailyBudgetUsd ?? 5, monthly: value.funding.monthlyBudgetUsd ?? 50,
      accountDaily: 10, accountMonthly: 100,
      dailyCalls: value.funding.subscription?.dailyCalls ?? 20, monthlyCalls: value.funding.subscription?.monthlyCalls ?? 200,
      maxConcurrentTasks: value.maxConcurrentTasks,
      // Loaded from committed settings so the form shows what is actually stored, not a default.
      routing: {
        preset: value.routing?.preset ?? '',
        dailyBudgetUsd: value.routing?.dailyBudgetUsd ?? '',
        monthlyBudgetUsd: value.routing?.monthlyBudgetUsd ?? '',
      },
    })
  }, [bot.id, record?.revision])
  const model = useMemo(() => record?.catalog.models.find(item => route(item) === form?.model) ?? null, [record, form?.model])
  const account = accounts.items.find(item => item.provider === model?.provider)
  if (!record || !form) return <Blocked value={{ reason: '此 Bot 尚未取得绑定目录。' }} />
  const change = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const selectedMachine = form.workspace.split('/')[0]
  const selectedRoot = form.workspace.split('/').slice(1).join('/')
  // This Bot's own routing policy: empty means it inherits the global preset.
  const routing = form.routing ?? { preset: '', dailyBudgetUsd: '', monthlyBudgetUsd: '' }
  const enableAccount = () => dispatch('funding.account.save', { scopeId: account.id, expectedRevision: account.revision, enabled: true,
    dailyLimitUsd: Number(form.accountDaily), monthlyLimitUsd: Number(form.accountMonthly) })
  const save = event => {
    event.preventDefault()
    const settings = {
      schemaVersion: 1, enabled: form.enabled,
      model: model ? { provider: model.provider, model: model.model } : null,
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
      // An empty preset inherits; a budget left blank means "no separate ceiling for this Bot".
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
  const cliMappings = (model?.cliModels ?? []).filter((item, index, items) => items.findIndex(other => other.toolId === item.toolId && other.model === item.model) === index)
  return <details className="bp-card" open={record.status !== 'available'}>
    <summary>配置并启用此 Bot</summary>
    <form className="bp-form" onSubmit={save}>
      <label>准确模型<select aria-label={`${bot.name} 的绑定模型`} value={form.model} onChange={event => { change('model', event.target.value); change('officialTools', []) }} required>
        <option value="" disabled>请选择</option>{record.catalog.models.map(item => <option key={route(item)} value={route(item)}>{route(item)}</option>)}
      </select></label>
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
      {cliMappings.length > 0 && <fieldset><legend>已核验官方 CLI</legend>{cliMappings.map(mapping => {
        const selected = form.officialTools.some(tool => tool.toolId === mapping.toolId && tool.cliModel === mapping.model)
        return <label key={`${mapping.toolId}/${mapping.model}`}><input type="checkbox" checked={selected} onChange={event => change('officialTools', event.target.checked
          ? [...form.officialTools, { toolId: mapping.toolId, cliModel: mapping.model, mode: 'read-only' }]
          : form.officialTools.filter(tool => !(tool.toolId === mapping.toolId && tool.cliModel === mapping.model)))} />{mapping.toolId} / {mapping.model}（只读）</label>
      })}</fieldset>}
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
