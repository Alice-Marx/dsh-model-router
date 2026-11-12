import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Blocked } from './panels.jsx'
import { UiIcon } from './ui-icons.jsx'
import bindingCss from './binding.css'
import { BotModelPicker } from './model-picker.jsx'
import { botModelStatus } from './bot-model-status.mjs'
import { MainRouteEditor } from './main-route-editor.jsx'
import { mainDefaultFields, mainRoutePayload, mainRouteProblems, startMainRoutes } from './main-route-model.mjs'
import {
  accountFor, bindingProblems, buildBinding, defaultMode, EXECUTION_MODES, failureText, findModel, FUNDING_MODES,
  MODE_HELP, MODE_LABEL, numberOrNull, routeOf, ROUTING_PRESETS, scopeAllows, seedForm,
  toolCards, TOOL_STATUS_LABEL, workspaceKey, workspaceLabel, workspaceOptions,
} from './binding-model.mjs'

/**
 * Bot binding editor.
 *
 * The props contract is unchanged: `{ bot, record, accounts, dispatch, busy }`.
 * `record` is the Host's committed read model (settings + trusted catalog); every
 * choice offered here comes from that catalog, and a save always carries the
 * revision it was read at, so the Host keeps authority over what is granted.
 *
 * Layout follows the Bot first: pick a provider, then an exact model, then the
 * funding scope; workspace, capabilities and budgets stay available but folded.
 * The official-tools module is a separate region because granting a CLI execution
 * path is a different decision from choosing the model this Bot talks with.
 */
export function BotBindingEditor({ bot, record, accounts, dispatch, busy, hostScope, onOpenTools, onOpenAi }) {
  const connection = hostScope ?? dispatch
  const draftConnection = useRef(connection)
  const [inspectedCatalog, setInspectedCatalog] = useState(null)
  const catalog = inspectedCatalog?.connection === connection && inspectedCatalog?.botId === bot?.id && inspectedCatalog?.record === record
    ? inspectedCatalog.catalog : record?.catalog
  const [form, setForm] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [working, setWorking] = useState('')
  const [toolFeedback, setToolFeedback] = useState(null)
  const seedKey = useRef('')
  const seedRevision = useRef(null)
  const saveToken = useRef(0)
  const workingRef = useRef('')

  useEffect(() => {
    // The stylesheet ships with this component so the editor needs no parent wiring;
    // index.jsx may concatenate it instead, but not both at once.
    const style = document.createElement('style')
    style.dataset.botBindingEditor = '1'
    style.textContent = bindingCss
    document.head.append(style)
    return () => { saveToken.current++; workingRef.current = ''; style.remove() }
  }, [])

  useEffect(() => {
    if (draftConnection.current !== connection) {
      draftConnection.current = connection; seedKey.current = ''; saveToken.current++; workingRef.current = ''; setWorking(''); setFeedback(null); setToolFeedback(null); setInspectedCatalog(null)
    }
    if (!record) { saveToken.current++; seedKey.current = ''; seedRevision.current = null; setForm(null); return }
    const botId = bot?.id ?? ''
    const key = `${botId}#${record.revision ?? 0}`
    if (seedKey.current === key) return
    const sameBot = seedKey.current.split('#')[0] === botId
    seedKey.current = key
    // A late Host or Bot switch invalidates the in-flight save of the previous Bot.
    if (!sameBot) { saveToken.current += 1; workingRef.current = ''; setWorking(''); setToolFeedback(null); setInspectedCatalog(null) }
    // A revision bump from another window must not silently drop unsaved work.
    if (sameBot && dirty) {
      setFeedback({ kind: 'notice', text: `宿主中的绑定已更新到修订号 ${record.revision ?? 0}；你在此处未保存的修改仍然保留，保存时会按旧修订号提交，宿主可能拒绝。` })
      return
    }
    seedRevision.current = record.revision
    setForm(seedForm(record, accounts))
    setDirty(false)
    setFeedback(current => (current?.kind === 'saved' ? current : null))
  }, [bot?.id, record, dirty, accounts, connection])

  const edit = patch => {
    setForm(current => (current ? { ...current, ...patch } : current))
    setFeedback(null)
    setDirty(true)
  }

  const model = form ? findModel(catalog, form.model) : null
  const savedRoute = form?.model ?? ''
  const savedMissing = Boolean(savedRoute) && !model
  const machineOptions = useMemo(() => workspaceOptions(catalog), [catalog])
  const [machineId, rootId] = (form?.workspace ?? '').split('/')
  const machine = machineOptions.find(item => item.machineId === machineId) ?? null
  const root = machine?.roots.find(item => item.rootId === rootId) ?? null
  const account = accountFor(accounts, model?.provider)
  const mainRoutes = bot?.main ? form?.mainRoutes : undefined
  const scope = (catalog?.fundingScopes ?? []).find(item => item.id === account?.id) ?? null
  const tools = useMemo(() => toolCards({ catalog, model, grants: form?.officialTools }), [catalog, model, form?.officialTools])
  const problems = form ? bindingProblems({ form, model, account, machine, root, catalog, scope, mainRoutes: Boolean(mainRoutes) }) : []
  if (mainRoutes) problems.push(...mainRouteProblems(mainRoutes, { defaultRoute: form.model, enabled: form.enabled, catalog, accounts }))
  const staleTools = tools.filter(tool => tool.stale)
  const hostModel = botModelStatus(bot, catalog?.models)

  if (!record || !form) return <Blocked value={{ reason: '此 Bot 尚未取得绑定目录。' }} />

  const accountLimitsReady = numberOrNull(form.accountDaily) !== null && numberOrNull(form.accountMonthly) !== null

  const setToolGrant = (tool, cliModel, checked) => {
    if (checked && (!tool.available || !tool.identities.some(identity => identity.model === cliModel))) return
    const others = form.officialTools.filter(item => item.toolId !== tool.toolId)
    edit({ officialTools: checked
      ? [...others, { toolId: tool.toolId, cliModel, mode: tool.grant?.mode ?? defaultMode(tool.modes) }]
      : others })
  }
  const setToolMode = (toolId, mode) => {
    if (!tools.some(tool => tool.toolId === toolId && tool.available && tool.modes.includes(mode))) return
    edit({ officialTools: form.officialTools.map(item => (item.toolId === toolId ? { ...item, mode } : item)) })
  }
  const dropStaleTools = () => edit({ officialTools: form.officialTools.filter(item => !staleTools.some(tool => tool.toolId === item.toolId)) })
  const refreshTools = async () => {
    if (workingRef.current || busy) return
    const token = saveToken.current
    workingRef.current = 'tools'; setWorking('tools'); setToolFeedback({ kind: 'saving', text: '检测安装、登录与执行能力…' })
    try {
      const value = await dispatch('binding.inspect', { botId: bot.id, refreshOfficialTools: true })
      if (saveToken.current !== token) return
      if (value?.schemaVersion !== 1 || value.bot?.id !== bot.id || value.record?.botId !== bot.id || !Array.isArray(value.record.catalog?.tools)) throw new Error('未收到当前 Bot 的工具检测结果。')
      setInspectedCatalog({ connection, botId: bot.id, record, catalog: value.record.catalog })
      setToolFeedback({ kind: 'saved', text: '工具状态已更新，未保存的修改仍然保留。' })
    } catch (error) {
      if (saveToken.current === token) setToolFeedback({ kind: 'error', text: '暂时无法重新检测工具，请稍后重试。未保存的修改仍然保留。' })
    } finally { if (saveToken.current === token) { workingRef.current = ''; setWorking('') } }
  }

  const enableAccount = async (target, dailyLimitUsd, monthlyLimitUsd) => {
    if (!target || workingRef.current) return
    const token = saveToken.current
    workingRef.current = 'funding'
    setWorking('funding')
    setFeedback(null)
    try {
      await dispatch('funding.account.save', { scopeId: target.id, expectedRevision: target.revision, enabled: true,
        dailyLimitUsd, monthlyLimitUsd })
      if (saveToken.current !== token) return
      setFeedback({ kind: 'saved', text: `已启用 ${target.provider} 资金范围。保存绑定后生效。` })
    } catch (error) {
      if (saveToken.current !== token) return
      setFeedback({ kind: 'error', text: failureText(error) })
    } finally { if (saveToken.current === token) { workingRef.current = ''; setWorking('') } }
  }

  const save = async event => {
    event.preventDefault()
    // A second click in the same batch must not submit twice against the same revision.
    if (workingRef.current || problems.length) return
    const token = saveToken.current
    const defaultForm = mainRoutes ? { ...form, ...mainDefaultFields(mainRoutes, form.model) } : form
    const settings = buildBinding({ form: defaultForm, model, account, machine, root })
    if (mainRoutes !== undefined) settings.mainRoutes = mainRoutePayload(mainRoutes)
    workingRef.current = 'binding'
    setWorking('binding')
    setFeedback({ kind: 'saving', text: '正在提交到宿主校验…' })
    try {
      const expectedRevision = seedRevision.current
      const result = await dispatch('binding.save', { botId: bot.id, expectedRevision, settings })
      if (saveToken.current !== token) return
      if (!Number.isSafeInteger(result?.revision) || result.revision <= expectedRevision || (result.botId && result.botId !== bot.id)) throw new Error('尚未收到当前 Bot 的保存确认，请刷新配置后核对。')
      seedRevision.current = result?.revision ?? seedRevision.current
      setDirty(false)
      setFeedback({ kind: 'saved', text: `设置已保存。` })
    } catch (error) {
      if (saveToken.current !== token) return
      setFeedback({ kind: 'error', text: failureText(error) })
    } finally { if (saveToken.current === token) { workingRef.current = ''; setWorking('') } }
  }

  const fundingMode = FUNDING_MODES.find(item => item.value === form.fundingMode) ?? FUNDING_MODES[0]
  const summary = [
    ['准确模型', savedRoute || '未选择'],
    ['资金范围', mainRoutes ? `${mainRoutes.routes.filter(route => route.enabled).length} 条路线 · 共享限额` : account ? `${(account.label ?? account.provider)} · ${form.fundingMode === 'api' ? 'API' : '订阅'}${account.enabled ? '' : '（未启用）'}` : '未匹配'],
    ['工作区', machine && root ? workspaceLabel(machine, root) : '未选择'],
    ['官方工具', form.officialTools.length ? form.officialTools.map(tool => `${tool.toolId}/${tool.cliModel}·${MODE_LABEL[tool.mode] ?? tool.mode}`).join('，') : bot?.main ? 'Main 全权限 · 待配置默认执行方式' : '未授予'],
    ['绑定状态', record.status === 'available' ? '已启用' : '未启用'],
  ]

  return <div className="bb-root">
    <header className="bb-head">
      <p className="bb-eyebrow">Bot 绑定 · {bot?.name ?? ''}</p>
      <h3 className="bb-title">模型与工具</h3>
      {onOpenAi && <button type="button" className="bb-link" disabled={busy} onClick={onOpenAi}><UiIcon name="spark" size={15}/>管理 AI 提供方</button>}
      <p className="bb-sub">{bot?.main ? '配置 Main 的模型路线、默认模型与官方工具。' : '选择默认模型，为这个 Bot 添加官方工具。'}</p>
      {bot?.main && <p className="bb-note" role="note"><strong>Main · 全权限主控</strong> 可使用宿主全部已接入模型路线与工具。下方配置默认模型、工作区和资金。</p>}
      <details className="bb-overview"><summary>配置概览<span>{form.enabled ? '已启用' : '未启用'}</span></summary><dl className="bb-summary">{summary.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>
    </header>
    {record.status !== 'available' && record.settings?.enabled && <Blocked value={{ reason: record.blockedReason ?? '此 Bot 的执行绑定尚未就绪。', nextAction: record.nextAction }} />}
    <form className="bp-form bb-form" onSubmit={save}>
      <section className="bb-model-card" aria-label="Bot 模型设置">
        <BotModelPicker models={mainRoutes ? (catalog?.models ?? []).filter(item => mainRoutes.routes.some(route => route.enabled && routeOf(route) === routeOf(item))) : catalog?.models ?? []} value={form.model} disabled={Boolean(busy || working)}
          note={form.enabled ? '保存后用于当前 Bot。' : '此 Bot 的绑定已停用。保存会保留选择，启用后用于对话。'}
          onSelect={choice => {
            const selected = findModel(catalog, routeOf(choice)), modes = selected?.fundingModes
            edit({ provider: choice.provider, model: routeOf(choice), ...(modes && !modes.includes(form.fundingMode) ? { fundingMode: modes[0] } : {}) })
          }}/>
        <p className="bb-model-applied" data-model-different={hostModel.different ? '' : undefined} title={hostModel.title} role="status">{hostModel.appliedText}</p>
        {bot?.main && !mainRoutes && <button type="button" className="bb-link" disabled={Boolean(busy || working)}
          onClick={() => edit({ mainRoutes: startMainRoutes(form, model, account, record.settings?.funding) })}>配置多条模型路线</button>}
      </section>
      {mainRoutes ? <MainRouteEditor draft={mainRoutes} defaultRoute={form.model} catalog={catalog} accounts={accounts} busy={Boolean(busy || working)}
        onChange={draft => edit({ mainRoutes: draft })}
        onDefault={route => edit({ provider: route.provider, model: routeOf(route) })}
        onEnableAccount={enableAccount}
        onSingleRoute={() => edit({ ...mainDefaultFields(mainRoutes, form.model), mainRoutes: null })} /> :
      <details className="bb-budget-config"><summary><UiIcon name="chart" size={16}/>费用与预算<span className="bb-pill">{(account?.label ?? account?.provider) ?? '待配置'}</span></summary>
      <ol className="bb-steps">
        <li className="bb-step" data-state={model && account?.enabled ? 'done' : 'blocked'}>
          <div className="bb-step-head"><UiIcon name="chart" size={17}/>
            <div><strong>资金范围</strong><p>{fundingMode.help}</p></div>
            <span className="bb-step-state"><span className="bb-pill" data-tone={account?.enabled ? 'current' : 'warn'}>{account ? `${(account.label ?? account.provider)}${account.enabled ? '' : ' · 未启用'}` : '无匹配范围'}</span></span></div>
          <div className="bb-step-body">
            <div className="bb-row">{FUNDING_MODES.map(item => <button key={item.value} type="button" className="bb-option bb-option-inline"
              aria-pressed={form.fundingMode === item.value} disabled={Boolean(model?.fundingModes && !model.fundingModes.includes(item.value))} onClick={() => edit({ fundingMode: item.value })}>{item.label}</button>)}</div>
            {!model && <p className="bb-note">先选择模型，宿主才能给出这个提供商的资金范围。</p>}
            {model && !account && <p className="bb-warn">宿主目录里没有 {model.provider} 的资金范围。请刷新宿主或改选模型；未匹配范围时无法启用绑定。</p>}
            {model && account && !account.enabled && <aside className="bp-blocked">
              <strong>资金范围尚未启用</strong><p>{(account.label ?? account.provider)} 需要本地预算上限；它不是厂商余额。</p>
              <div className="bb-fields">
                <label className="bb-field"><span>账户每日上限（USD）</span><input type="number" min="0" step="0.01" value={form.accountDaily} onChange={event => edit({ accountDaily: event.target.value })} /></label>
                <label className="bb-field"><span>账户每月上限（USD）</span><input type="number" min="0" step="0.01" value={form.accountMonthly} onChange={event => edit({ accountMonthly: event.target.value })} /></label>
              </div>
              <div className="bb-row"><button type="button" disabled={busy || Boolean(working) || !accountLimitsReady} onClick={() => enableAccount(account, numberOrNull(form.accountDaily), numberOrNull(form.accountMonthly))}>
                {working === 'funding' ? '启用中…' : `启用 ${(account.label ?? account.provider)} 资金范围`}</button>
                {!accountLimitsReady && <small className="bb-note">留空表示未配置，宿主会拒绝启用；0 表示禁止付费。</small>}</div>
            </aside>}
            {model && account?.enabled && scope && !scopeAllows(scope, form.fundingMode, routeOf(model)) && <p className="bb-warn">宿主发布该资金范围时不包含当前渠道或准确模型，保存会被拒绝。</p>}
            {form.fundingMode === 'api' ? <>
              <div className="bb-fields">
                <label className="bb-field"><span>输入价格（USD / 百万 Token）</span><input type="number" min="0" step="0.000001" value={form.input} onChange={event => edit({ input: event.target.value })} /></label>
                <label className="bb-field"><span>输出价格（USD / 百万 Token）</span><input type="number" min="0" step="0.000001" value={form.output} onChange={event => edit({ output: event.target.value })} /></label>
                <label className="bb-field"><span>最大输入 Token</span><input type="number" min="1" step="1" value={form.maxInputTokens} onChange={event => edit({ maxInputTokens: event.target.value })} /></label>
                <label className="bb-field"><span>最大输出 Token</span><input type="number" min="1" step="1" value={form.maxOutputTokens} onChange={event => edit({ maxOutputTokens: event.target.value })} /></label>
                <label className="bb-field"><span>Bot 每日预算（USD）</span><input type="number" min="0" step="0.01" value={form.daily} onChange={event => edit({ daily: event.target.value })} /></label>
                <label className="bb-field"><span>Bot 每月预算（USD）</span><input type="number" min="0" step="0.01" value={form.monthly} onChange={event => edit({ monthly: event.target.value })} /></label>
              </div>
              <p className="bb-note">价格与请求上界由 Bot 绑定自己承担，即使别的 Bot 用同一个模型。留空的字段会按“未配置”提交，不会变成 0。</p>
            </> : <>
              <div className="bb-fields">
                <label className="bb-field"><span>每日订阅调用次数</span><input type="number" min="0" step="1" value={form.dailyCalls} onChange={event => edit({ dailyCalls: event.target.value })} /></label>
                <label className="bb-field"><span>每月订阅调用次数</span><input type="number" min="0" step="1" value={form.monthlyCalls} onChange={event => edit({ monthlyCalls: event.target.value })} /></label>
              </div>
              <p className="bb-note">订阅按次数计数；不会自动回退到 API 计价。</p>
            </>}
          </div>
        </li>
      </ol>
      </details>}

      <details className="bb-fold">
        <summary><UiIcon name="folder" size={16} />工作区与能力<small>{bot?.main ? 'Main 全权限' : machine && root ? `${workspaceLabel(machine, root)} · ${form.workspaceMode === 'read-only' ? '只读' : '可写'} · ${form.capabilities.length} 项能力` : '未选择'}</small></summary>
        <div className="bb-fold-body">
          <label className="bb-field bb-field-wide"><span>工作区（机器 / 根目录）</span>
            <select aria-label={`${bot?.name ?? ''} 的绑定工作区`} value={form.workspace} onChange={event => edit({ workspace: event.target.value })}>
              <option value="">请选择</option>
              {machineOptions.flatMap(entry => entry.roots.map(entry2 => <option key={workspaceKey(entry.machineId, entry2.rootId)} value={workspaceKey(entry.machineId, entry2.rootId)}>{entry.label} / {entry2.label}</option>))}
            </select></label>
          {machine && root && <label className="bb-field bb-field-wide"><span>工作区权限</span>
            <select aria-label={`${bot?.name ?? ''} 的工作区权限`} value={form.workspaceMode} onChange={event => edit({ workspaceMode: event.target.value })}>
              {['read-only', 'workspace-write'].filter(mode => root.modes.includes(mode)).map(mode => <option key={mode} value={mode}>{mode === 'read-only' ? '只读' : '允许写入'}</option>)}
            </select></label>}
          {machine && root && !root.modes.includes(form.workspaceMode) && <p className="bb-warn">所选根目录已不支持当前权限模式，请重新选择。</p>}
          {!bot?.main && <><div className="bb-row"><strong className="bb-note">路由与任务能力</strong>
            <button type="button" className="bb-link" onClick={() => edit({ capabilities: (catalog?.capabilities ?? []).map(item => item.id) })}>全选</button>
            <button type="button" className="bb-link" onClick={() => edit({ capabilities: [] })}>清空</button></div>
          <p className="bb-note">留空表示不授予额外能力；此界面不会在打开时替你勾选。</p>
          <div className="bb-list">{(catalog?.capabilities ?? []).map(item => <label key={item.id} className="bb-check">
            <input type="checkbox" checked={form.capabilities.includes(item.id)} onChange={event => edit({ capabilities: event.target.checked ? [...form.capabilities, item.id] : form.capabilities.filter(id => id !== item.id) })} />
            <span>{item.label}<small>{item.tools.join('、') || '无工具'}</small></span></label>)}</div></>}
          <label className="bb-field bb-field-wide"><span>最大并发任务</span><input type="number" min="1" max="32" step="1" value={form.maxConcurrentTasks} onChange={event => edit({ maxConcurrentTasks: event.target.value })} /></label>
          <fieldset className="bb-fieldset">
            <legend className="bb-note">Bot 路由策略（这个 Bot 派活给别人时用哪套取舍）</legend>
            <label className="bb-field bb-field-wide"><span>预设</span>
              <select aria-label={`${bot?.name ?? ''} 的路由预设`} value={form.routing.preset} onChange={event => edit({ routing: { ...form.routing, preset: event.target.value } })}>
                {ROUTING_PRESETS.map(item => <option key={item.value || 'global'} value={item.value}>{item.label}</option>)}</select></label>
            <div className="bb-fields">
              <label className="bb-field"><span>每日预算（USD）</span><input type="number" min="0" step="0.01" value={form.routing.dailyBudgetUsd} onChange={event => edit({ routing: { ...form.routing, dailyBudgetUsd: event.target.value } })} placeholder="留空表示不单独限制" /></label>
              <label className="bb-field"><span>每月预算（USD）</span><input type="number" min="0" step="0.01" value={form.routing.monthlyBudgetUsd} onChange={event => edit({ routing: { ...form.routing, monthlyBudgetUsd: event.target.value } })} placeholder="留空表示不单独限制" /></label>
            </div>
          </fieldset>
        </div>
      </details>

      <section className="bb-tools" aria-label={bot?.main ? '官方工具（默认执行配置）' : '官方工具（额外执行授权）'}>
        <div className="bb-tools-head">
          <strong><UiIcon name="settings" size={15} />官方工具</strong>
          <button type="button" className="bb-link" disabled={Boolean(busy || working)} onClick={() => void refreshTools()}>{working === 'tools' ? '检测中…' : '重新检测'}</button>
          {typeof onOpenTools === 'function' && <button type="button" className="bb-link" onClick={() => {
            const token = saveToken.current
            Promise.resolve().then(onOpenTools).catch(() => { if (saveToken.current === token) setFeedback({ kind: 'error', text: '暂时无法打开官方工具设置，请重试。' }) })
          }}>安装与登录<UiIcon name="arrow" size={13}/></button>}
          <p>{bot?.main ? 'Main 已有全部工具权限；下方配置就绪 CLI 的默认模型与执行方式。' : '为这个 Bot 添加官方工具。CLI 模型与聊天模型分别配置，授权保存后生效。'}</p>
        </div>
        {toolFeedback && <p className="bb-feedback bb-tools-feedback" data-kind={toolFeedback.kind} role="status">{toolFeedback.text}</p>}
        {tools.length === 0 ? <p className="bb-tool-empty">宿主目录里没有可授予的官方 CLI 工具。安装与登录状态在官方工具面板查看；未核验的身份不会在这里显示为可用。</p> : (
          <ul className="bb-tool-list">{tools.map(tool => <li key={tool.toolId} className="bb-tool" data-tool-id={tool.toolId} data-granted={Boolean(tool.grant)} data-stale={tool.stale}>
            <div className="bb-tool-head"><div className="bb-tool-title">
              <strong>{tool.label}</strong>
              <p>{tool.vendor ? `${tool.vendor} · ` : ''}{tool.source || '厂商官方 CLI'}</p></div>
              <span className="bb-pill" data-tone={tool.grant ? (tool.stale ? 'warn' : 'ok') : 'muted'}>{bot?.main ? (tool.stale ? '配置待核验' : tool.grant ? '执行已配置' : '全权限 · 待配置') : tool.grant ? (tool.stale ? '授权已失效' : '已授予') : '未授予'}</span></div>
            <div className="bb-tool-body">
              <p className="bb-tool-readiness" data-state={tool.status}><strong>{TOOL_STATUS_LABEL[tool.status] ?? '暂不可用'}</strong>{tool.reason && <span>{tool.reason}</span>}</p>
              {tool.grantTools.length > 0 && <details className="bb-tool-permissions"><summary>工具权限明细</summary><p className="bb-note">{tool.grantTools.join('、')}</p></details>}
              {tool.identities.length > 0 && (
                <div className="bb-list">{tool.identities.map(identity => {
                  const checked = tool.grant?.cliModel === identity.model
                  return <label key={`${tool.toolId}/${identity.model}`} className="bb-check">
                    <input type="checkbox" aria-label={`${tool.label}：${identity.label ?? identity.model}`} checked={checked} disabled={Boolean(busy || working)} onChange={event => setToolGrant(tool, identity.model, event.target.checked)} />
                    <span>{identity.label ?? `${tool.toolId} / ${identity.model}`}<small>{identity.model === 'vendor-default' ? '使用 CLI 当前配置的模型，不改变 Bot 的聊天模型。' : '宿主提供的 CLI 模型配置'}</small></span></label>
                })}</div>)}
              {tool.grant && <label className="bb-field bb-field-wide"><span>执行模式</span>
                <select aria-label={`${tool.label} 的执行模式`} value={tool.grant.mode} disabled={Boolean(busy || working || !tool.available)} onChange={event => setToolMode(tool.toolId, event.target.value)}>
                  {!tool.modes.includes(tool.grant.mode) && <option value={tool.grant.mode}>{MODE_LABEL[tool.grant.mode] ?? tool.grant.mode}（已不可用）</option>}
                  {EXECUTION_MODES.filter(mode => tool.modes.includes(mode)).map(mode => <option key={mode} value={mode}>{MODE_LABEL[mode]}</option>)}</select>
                <small>{MODE_HELP[tool.grant.mode] ?? ''}</small></label>}
              {tool.grant && tool.stale && <p className="bb-warn">已保存：{tool.toolId}/{tool.grant.cliModel} · {MODE_LABEL[tool.grant.mode] ?? tool.grant.mode}。当前 CLI 身份或执行模式尚未核验，宿主会拒绝保存。请移除，或改选就绪身份。</p>}
            </div></li>)}</ul>)}
        <p className="bb-tools-foot">{bot?.main ? 'Main 的全权限不受普通 Bot 能力勾选限制。工具仍需安装、登录并通过执行入口检测；这里保存默认执行配置。' : '每个工具选择一个执行身份；切换聊天模型不改变 CLI 配置。可写执行还需要工作区明确允许写入。仅终端交互的工具可在安装与登录面板中使用。'}</p>
        <p className="bb-tools-foot">官方工具使用 CLI 自身的账号、模型与额度，调用单独记账；不会占用或切换 Bot 聊天模型的资金配置。</p>
        {staleTools.length > 0 && <div className="bb-row"><button type="button" className="bb-link" onClick={dropStaleTools}>移除 {staleTools.length} 项未核验授权</button></div>}
      </section>

      <div className="bb-save">
        <label className="bb-check"><input type="checkbox" checked={form.enabled} onChange={event => edit({ enabled: event.target.checked })} />
          <span>启用此绑定<small>模型、工作区、资金范围与必要预算必须完整；未启用时保持停用，不授予执行权。</small></span></label>
        {problems.length > 0 && <div className="bb-danger"><strong>还不能保存</strong>
          <ul>{problems.map(item => <li key={item}>{item}</li>)}</ul></div>}
        <div className="bb-save-row">
          <span className="bb-pill" data-tone={dirty ? 'warn' : 'muted'}>{dirty ? '有未保存修改' : '与宿主一致'}</span>
          <span className="bb-pill">修订号 {record.revision ?? 0}</span>
          <button type="submit" className="bp-button-primary" disabled={busy || Boolean(working) || problems.length > 0}>
            {working === 'binding' ? '保存中…' : '保存绑定'}</button>
        </div>
        {feedback && <p className="bb-feedback" data-kind={feedback.kind} role="status">{feedback.text}</p>}
        {dirty && seedRevision.current !== record.revision && <button type="button" className="bb-link" onClick={() => {
          saveToken.current++; workingRef.current = ''; setWorking(''); seedRevision.current = record.revision
          setForm(seedForm(record, accounts)); setDirty(false); setFeedback(null)
        }}>放弃草稿并载入最新设置</button>}
      </div>
    </form>
  </div>
}
