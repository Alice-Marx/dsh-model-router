import React from 'react'
import { createWorkspacePlan, routesFromModelCatalog } from './catalog.mjs'
import { ModelProfileEditor } from './model-profile-editor.jsx'
import { toolInstallAction } from './tool-install-state.mjs'
import { OFFICIAL_TOOLS, installCommandLine, toolForProvider } from '../shared/official-tool-registry.mjs'
import { ROUTING_PRESETS } from '../shared/routing-presets.mjs'
import { BillingCard, CostControlCard, DagView, OnboardingBanner, RunHistoryCard, SecurityCard, ToolLoginLine } from './router-insights.jsx'
import { healthSummary, planBudget, rerunConfirmations, unwrapRemote } from './insights-state.mjs'
import { RunLauncher } from './run-launcher.jsx'
import { CliTerminalCard } from './cli-terminal.jsx'
import { staleHostNotice } from './host-version.mjs'
import stylesheet from './router-main.css'

const money = value => value === null || value === undefined ? '价格待配置' : `$${Number(value).toFixed(4)}`
const text = value => typeof value === 'string' ? value.trim() : ''

/** The sidebar owns button layout and selection; this is only its glyph. */
export function RouterPanelIcon({ size = 20, active = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 6.5h7M7 17.5h7M15 6.5v11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="5" cy="6.5" r="2" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" />
      <circle cx="5" cy="17.5" r="2" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17" cy="12" r="3" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

function RouteList({ routes, query }) {
  const filtered = routes.filter(route => {
    const haystack = `${route.providerName} ${route.provider} ${route.name} ${route.model}`.toLowerCase()
    return haystack.includes(query.toLowerCase())
  })
  if (filtered.length === 0) return <div className="mr-empty">{routes.length === 0 ? '官方模型目录尚无可规划的路线。请先在“模型”页完成配置。' : '没有匹配的模型。'}</div>
  return (
    <div className="mr-list" role="list" aria-label="官方已登记模型路线">
      {filtered.map(route => (
        <div className="mr-route" role="listitem" key={`${route.provider}/${route.model}`}>
          <div style={{ minWidth: 0 }}>
            <div className="mr-route-name" title={route.name}>{route.name}</div>
            <div className="mr-route-provider" title={`${route.provider}/${route.model}`}>{route.provider}/{route.model}</div>
          </div>
          {route.reasoningKnown && <span className="mr-pill">推理等级</span>}
        </div>
      ))}
    </div>
  )
}

function ChannelBadge({ item }) {
  if (!item?.executionChannel) return null
  const official = item.executionChannel === 'official-cli'
  return (
    <span className={official ? 'mr-pill mr-pill-channel-ok' : 'mr-pill'} title={item.channelDetail ?? ''}>
      {official ? `官方 CLI · ${item.channelLabel ?? item.channelTool}` : '模型目录 API'}
    </span>
  )
}

function PlanResults({ plan, ledger, headingRef }) {
  const selected = plan.selected
  const budget = planBudget(ledger, plan.estimatedCost)
  const packageNames = new Map((plan.team?.workPackages ?? []).map(item => [item.id, item.name]))
  const purposeLabel = { analysis: '任务分析', execution: '任务实施', verification: '独立验证', synthesis: '结果整合' }
  return (
    <section className="mr-card mr-results" aria-label="路由建议">
      <div className="mr-card-head">
        <div>
          <h2 className="mr-card-title" ref={headingRef} tabIndex={-1}>路由建议</h2>
          <p className="mr-card-copy">本地计算完成，未向模型发送任务内容。</p>
        </div>
      </div>
      <div className="mr-card-body">
        <div className="mr-result-grid">
          <div className="mr-metric"><div className="mr-metric-label">推荐路线</div><div className="mr-metric-value">{selected ? `${selected.provider}/${selected.model}` : '暂无路线'}</div></div>
          <div className="mr-metric"><div className="mr-metric-label">任务复杂度 · 分值（0–1）</div><div className="mr-metric-value">{{ simple: '简单', balanced: '中等', complex: '复杂' }[plan.complexity.band] || plan.complexity.band} · {plan.complexity.value}</div></div>
          <div className="mr-metric"><div className="mr-metric-label">估算总成本</div><div className="mr-metric-value">{money(plan.estimatedCost)}</div></div>
          <div className="mr-metric"><div className="mr-metric-label">路由方案</div><div className="mr-metric-value">{ROUTING_PRESETS[plan.preset]?.label ?? '均衡'}</div></div>
        </div>
        {budget?.exceeded && <p className="mr-error" role="alert">执行前预算检查：{budget.message} 实际执行时将按设置自动降级或暂停询问。</p>}
        {budget?.limited && !budget.exceeded && budget.estimateKnown && <p className="mr-caption">执行前预算检查：本次预估 {money(plan.estimatedCost)}，剩余额度 {money(budget.remainingUsd)}。</p>}
        {plan.loginRequired && <p className="mr-caption">推荐模型的官方 CLI 未登录，执行时直接走模型目录 API；可在“官方工具”卡片点“去登录”。</p>}
        <div className="mr-channel-line">
          <span className="mr-control-label">执行渠道</span>
          <ChannelBadge item={plan} />
        </div>
        <details className="mr-plan-explanation"><summary>查看规划依据与估算说明</summary><p className="mr-caption">{plan.reason}</p><p className="mr-caption">{plan.pricingNotice} {plan.qualityNotice} {plan.availabilityNotice} {plan.modalityNotice || ''}</p></details>
        {plan.optimization.budgetExceeded && <p className="mr-error">按已提供单价估算，任务可能超过本次预算。预算只影响建议，不会阻止实际扣费。</p>}
        {plan.mode === 'team' && (
          <>
            <h3 className="mr-section-title">团队工作包</h3>
            <p className="mr-caption">下方模型是规划建议；托管执行会按厂商 CLI 的模型名规则选用，未核验映射时使用该 CLI 的默认模型。</p>
            {plan.team.workPackages.length > 1 && <DagView packages={plan.team.workPackages} label="工作包依赖图" renderNode={item => <p className="mr-package-route">{item.recommendedProvider}/{item.recommendedModel}</p>} />}
            {plan.team.workPackages.length === 0
              ? <div className="mr-empty">当前目录没有可分配的模型路线。</div>
              : plan.team.workPackages.map((item, index) => (
                <details className="mr-package mr-package-details" key={item.id}>
                  <summary><span className="mr-package-name">{index + 1}. {item.name}</span><span className="mr-package-route">{item.recommendedProvider}/{item.recommendedModel}</span></summary>
                  {item.objective && <p className="mr-package-copy">具体目标：{item.objective}</p>}
                  <p className="mr-package-copy">{purposeLabel[item.purpose] ?? item.purpose}{item.dependsOn.length > 0 ? ` · 依赖：${item.dependsOn.map(id => packageNames.get(id) ?? id).join('、')}` : ''}</p>
                  <p className="mr-package-copy">难度：{{ simple: '简单', balanced: '中等', complex: '困难' }[item.difficulty] || item.difficulty || '待评估'} · 费用：{money(item.estimatedCost)}</p>
                  <p className="mr-package-copy">验收：{item.verificationChecklist.join('；')}</p>
                  <div className="mr-channel-line"><ChannelBadge item={item} />{item.loginRequired && <span className="mr-pill">CLI 未登录</span>}</div>
                  {item.channelDetail && <p className="mr-package-copy">渠道说明：{item.channelDetail}</p>}
                </details>
              ))}
          </>
        )}
        {plan.routingBypassed && <p className="mr-caption">已指定单一模型，未与其他路线比较。在官方会话中调用 <code>model_router_execute</code> 并传入该 provider 与 model 即可直接执行；若该模型允许官方工具，会优先使用对应 CLI。</p>}
        {plan.mode === 'team' && <p className="mr-caption">{plan.team.handoff}</p>}
      </div>
    </section>
  )
}

const remoteError = (response, fallback) => text(response?.error?.message) || text(response?.value?.error) || fallback

function probeLabel(probe) {
  if (!probe) return '尚未检测'
  if (probe.installed) return `已安装${probe.version ? ` · ${probe.version}` : ''}`
  if (probe.status === 'not-installed') return '未安装'
  if (probe.status === 'probe-timeout') return '检测超时'
  if (probe.status === 'probe-failed') return '检测失败'
  return probe.detail || '未安装'
}

function OfficialToolsCard({ listOfficialTools, installOfficialTool, cancelOfficialToolInstall, officialToolInstallStatus, onProbes, health, onRefreshHealth }) {
  const healthById = Object.fromEntries((health?.tools ?? []).map(item => [item.id, item]))
  const [probeState, setProbeState] = React.useState({ status: 'loading', probes: [], capabilities: [], readiness: [], error: '' })
  const [jobs, setJobs] = React.useState({})
  const [rowErrors, setRowErrors] = React.useState({})
  const mounted = React.useRef(false)
  const request = React.useRef(0)
  const submitting = React.useRef(new Set())
  const polling = React.useRef(new Set())

  const refresh = async () => {
    onRefreshHealth?.()
    const current = ++request.current
    setProbeState(previous => ({ ...previous, status: 'loading', error: '' }))
    try {
      if (typeof listOfficialTools !== 'function') throw new Error('官方工具安装桥尚未加载。')
      const response = await listOfficialTools()
      if (!mounted.current || current !== request.current) return
      if (!response?.ok) throw new Error(remoteError(response, '无法检测官方工具。'))
      const probes = Array.isArray(response.value?.tools) ? response.value.tools : []
      const capabilities = Array.isArray(response.value?.executionCapabilities) ? response.value.executionCapabilities : []
      const readiness = Array.isArray(response.value?.executionReadiness) ? response.value.executionReadiness : []
      setProbeState({ status: 'ready', probes, capabilities, readiness, error: '' })
      onProbes({ probes, capabilities, readiness, hostVersion: typeof response.value?.hostVersion === 'string' ? response.value.hostVersion : null })
    } catch (error) {
      if (!mounted.current || current !== request.current) return
      setProbeState({ status: 'error', probes: [], capabilities: [], readiness: [], error: text(error?.message) || '无法检测官方工具。' })
      onProbes({ probes: [], capabilities: [], readiness: [] })
    }
  }

  React.useEffect(() => {
    mounted.current = true
    void refresh()
    if (typeof officialToolInstallStatus === 'function') {
      void Promise.all(OFFICIAL_TOOLS.map(async tool => {
        try {
          const response = await officialToolInstallStatus(tool.id)
          return response?.ok && response.value?.job ? [tool.id, response.value.job] : null
        } catch { return null }
      })).then(entries => {
        if (mounted.current) setJobs(previous => ({ ...Object.fromEntries(entries.filter(Boolean)), ...previous }))
      })
    }
    return () => { mounted.current = false; request.current += 1 }
  }, [])

  React.useEffect(() => {
    const active = Object.values(jobs).filter(job => job?.status === 'running').map(job => job.tool)
    if (active.length === 0 || typeof officialToolInstallStatus !== 'function') return undefined
    let listening = true
    const poll = async id => {
      if (polling.current.has(id)) return
      polling.current.add(id)
      try {
        const response = await officialToolInstallStatus(id)
        if (!listening || !mounted.current) return
        if (!response?.ok) throw new Error(remoteError(response, '无法获取安装进度。'))
        const job = response.value?.job
        if (!job) throw new Error('安装任务状态暂不可用。')
        setJobs(previous => ({ ...previous, [id]: job }))
        setRowErrors(previous => ({ ...previous, [id]: '' }))
        if (job.status !== 'running') void refresh()
      } catch (error) {
        if (listening && mounted.current) setRowErrors(previous => ({ ...previous, [id]: text(error?.message) || '安装状态读取失败，将继续重试。' }))
      } finally {
        polling.current.delete(id)
      }
    }
    const timer = setInterval(() => active.forEach(id => { void poll(id) }), 1_500)
    return () => { listening = false; clearInterval(timer) }
  }, [jobs, officialToolInstallStatus])

  const install = async id => {
    const tool = OFFICIAL_TOOLS.find(item => item.id === id)
    if (!tool || tool.unsupported || submitting.current.has(id) || jobs[id]?.status === 'running') return
    submitting.current.add(id)
    setRowErrors(previous => ({ ...previous, [id]: '' }))
    setJobs(previous => ({ ...previous, [id]: { tool: id, status: 'running', outputTail: [] } }))
    try {
      if (typeof installOfficialTool !== 'function') throw new Error('官方工具安装桥尚未加载。')
      const response = await installOfficialTool(id)
      if (!mounted.current) return
      if (!response?.ok || !response.value?.accepted || !response.value?.job) throw new Error(remoteError(response, '安装任务未被接受。'))
      setJobs(previous => ({ ...previous, [id]: response.value.job }))
    } catch (error) {
      if (mounted.current) {
        setJobs(previous => ({ ...previous, [id]: { tool: id, status: 'failed', error: text(error?.message) || '安装启动失败。' } }))
        setRowErrors(previous => ({ ...previous, [id]: text(error?.message) || '安装启动失败。' }))
      }
    } finally {
      submitting.current.delete(id)
    }
  }

  const cancel = async id => {
    if (typeof cancelOfficialToolInstall !== 'function' || jobs[id]?.status !== 'running' || jobs[id]?.cancelRequested) return
    setRowErrors(previous => ({ ...previous, [id]: '' }))
    try {
      const response = await cancelOfficialToolInstall(id)
      if (!mounted.current) return
      if (!response?.ok || !response.value?.accepted || !response.value?.job) throw new Error(remoteError(response, '取消请求未被接受。'))
      setJobs(previous => ({ ...previous, [id]: response.value.job }))
      if (response.value.job.status !== 'running') void refresh()
    } catch (error) {
      if (mounted.current) setRowErrors(previous => ({ ...previous, [id]: text(error?.message) || '无法取消安装。' }))
    }
  }

  const byId = Object.fromEntries(probeState.probes.map(probe => [probe.id, probe]))
  const capabilitiesById = Object.fromEntries(probeState.capabilities.map(item => [item.id, item]))
  const readinessById = Object.fromEntries(probeState.readiness.map(item => [item.id, item]))
  return (
    <section className="mr-card" aria-label="官方工具">
      <div className="mr-card-head"><div>
        <h2 className="mr-card-title">官方工具 · 体检</h2>
        <p className="mr-card-copy">检测本机官方工具的安装、版本和登录状态，并从固定注册表一键安装或更新到各厂商最新版（新版本未经插件测试）。未登录的工具点“去登录”查看登录命令。ZCode 会打开官方安装窗口供你选择目录；完成后重新体检。</p>
      </div><button className="mr-button mr-button-secondary" type="button" disabled={probeState.status === 'loading'} onClick={() => { void refresh() }}>重新体检</button></div>
      <div className="mr-card-body">
        {probeState.status === 'loading' && <p className="mr-empty" role="status">正在检测本机官方工具…</p>}
        {probeState.status === 'error' && <p className="mr-error" role="alert">{probeState.error}</p>}
        <div className="mr-tools" role="list" aria-label="官方工具注册表">
          {OFFICIAL_TOOLS.map(tool => {
            const command = installCommandLine(tool)
            const probe = byId[tool.id]
            const capability = capabilitiesById[tool.id]
            const readiness = readinessById[tool.id]
            const job = jobs[tool.id]
            const running = job?.status === 'running'
            const action = toolInstallAction({ tool, probe, readiness, job, probeStatus: probeState.status, latestVersion: healthById[tool.id]?.latestVersion ?? null })
            const verified = job?.status === 'succeeded' && job.postInstallProbe?.installed === true
            const status = running ? job.cancelRequested ? '正在取消安装…' : '安装中…'
              : job?.status === 'installer-opened' ? '官方安装器已打开，请完成安装后重新检测'
                : job?.status === 'cancelled' ? '安装已取消，请重新检测' : verified ? '安装成功并验证' : probeLabel(probe)
            return (
              <div className="mr-tool" role="listitem" key={tool.id}>
                <div className="mr-tool-info">
                  <div className="mr-route-name" title={tool.purpose}>{tool.label}</div>
                  <div className="mr-route-provider">{tool.vendor} · {tool.id}</div>
                  <div className="mr-tool-status" role="status"><span className={`mr-tool-dot ${running ? 'running' : probe?.installed ? 'installed' : 'missing'}`} />{status}{probe?.installed && probe.version ? ` · ${probe.version}` : ''}{healthById[tool.id]?.latestVersion ? ` · 最新 ${healthById[tool.id].latestVersion}` : ''}</div>
                  <ToolLoginLine entry={healthById[tool.id]} />
                  {probe?.installed && <p className="mr-caption mr-tool-detail">{tool.headlessAdapter
                    ? '已可由 model_router_execute 以无界面方式调用。命令缺失或失败时回退模型目录 API。签名沙箱入口不启动此 CLI。'
                    : readiness?.ready
                    ? `官方执行入口已核验，可在会话中调用 model_router_tool_run；${capability?.modes?.includes('read-only') ? '支持只读和经审批的可编辑任务' : '仅支持经审批的可编辑隔离工作区任务'}，账号及模型仍需实测。`
                    : `已安装，但当前不可托管执行：${readiness?.reason || capability?.reason || '执行入口尚未核验。'}`}</p>}
                  {command
                    ? <code className="mr-tool-command">{command}</code>
                    : <p className="mr-caption" style={{ margin: '6px 0 0' }}>{tool.unsupportedReason}</p>}
                  {probe?.detail && <p className="mr-caption mr-tool-detail">{probe.detail}</p>}
                  {(rowErrors[tool.id] || job?.error) && <p className="mr-error mr-tool-error" role="alert">{rowErrors[tool.id] || job.error}</p>}
                  {Array.isArray(job?.outputTail) && job.outputTail.length > 0 && (
                    <details className="mr-tool-log"><summary>安装日志</summary><pre>{job.outputTail.slice(-6).join('\n')}</pre></details>
                  )}
                </div>
                {command && (
                  <div className="mr-tool-actions">
                    <button className="mr-button mr-tool-button" type="button" disabled={action.disabled} onClick={() => { void install(tool.id) }}>
                      {action.label}
                    </button>
                    {running && <button className="mr-button mr-button-secondary mr-tool-button" type="button" disabled={job.cancelRequested} onClick={() => { void cancel(tool.id) }}>
                      {job.cancelRequested ? '正在取消…' : '取消安装'}
                    </button>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <p className="mr-caption" style={{ marginTop: 12 }}>
          安装由 Host 按注册表固定来源执行，不接受自定义包名；可点“取消安装”终止下载任务，随后重新检测实际版本。ZCode 安装器启动后仍需在原厂窗口选择目录并完成安装。Agent 也可调用 <code>model_router_tool_install</code>，或在会话使用 <code>/tools</code>。
        </p>
      </div>
    </section>
  )
}

/** Root-scoped official Desktop panel. The plan is local; real calls remain in Host tools. */
const HEADLESS_TOOLS = new Set(['claude-code', 'codex', 'gemini'])
const WORKSPACE_VIEWS = [
  { id: 'plan', label: '任务与执行', number: '01' },
  { id: 'models', label: '模型配置', number: '02' },
  { id: 'tools', label: '官方工具', number: '03' },
  { id: 'controls', label: '预算与安全', number: '04' },
]

/** Workbench RPC state: health check, run ledger and security boundaries. */
function useWorkbenchData({ toolHealth, completeOnboarding, loadLedger, rateResult, rerunStep, loadBoundaries }) {
  const [health, setHealth] = React.useState({ report: null, error: '', refreshing: false })
  const [ledger, setLedger] = React.useState({ value: null, error: '' })
  const [boundaries, setBoundaries] = React.useState({ value: null, error: '' })
  const [busy, setBusy] = React.useState(false)
  const mounted = React.useRef(true)
  React.useEffect(() => () => { mounted.current = false }, [])
  const call = async (operation, fallback) => {
    if (typeof operation !== 'function') throw new Error('工作台服务尚未加载，请更新插件后重试。')
    return unwrapRemote(await operation(), fallback)
  }
  const refreshHealth = async fresh => {
    setHealth(previous => ({ ...previous, refreshing: true, error: '' }))
    try {
      const report = await call(() => toolHealth(fresh === true), '体检失败。')
      if (mounted.current) setHealth({ report, error: '', refreshing: false })
    } catch (error) {
      if (mounted.current) setHealth(previous => ({ ...previous, refreshing: false, error: text(error?.message) || '体检失败。' }))
    }
  }
  const refreshLedger = async () => {
    try {
      const value = await call(loadLedger, '执行记录读取失败。')
      if (mounted.current) setLedger({ value, error: '' })
    } catch (error) {
      if (mounted.current) setLedger(previous => ({ ...previous, error: text(error?.message) || '执行记录读取失败。' }))
    }
  }
  const refreshBoundaries = async () => {
    try {
      const value = await call(loadBoundaries, '安全边界读取失败。')
      if (mounted.current) setBoundaries({ value, error: '' })
    } catch (error) {
      if (mounted.current) setBoundaries({ value: null, error: text(error?.message) || '安全边界读取失败。' })
    }
  }
  const finishOnboarding = async () => {
    try {
      const onboarding = await call(completeOnboarding, '无法保存体检状态。')
      if (mounted.current) setHealth(previous => ({ ...previous, report: { ...previous.report, onboarding } }))
    } catch (error) {
      if (mounted.current) setHealth(previous => ({ ...previous, error: text(error?.message) || '无法保存体检状态。' }))
    }
  }
  const rate = async (runId, packageId, rating) => {
    setBusy(true)
    try { await call(() => rateResult({ runId, packageId, rating }), '评价保存失败。'); await refreshLedger() }
    catch (error) { if (mounted.current) setLedger(previous => ({ ...previous, error: text(error?.message) || '评价保存失败。' })) }
    finally { if (mounted.current) setBusy(false) }
  }
  const rerun = async (runId, packageId, override, choice = null) => {
    const run = ledger.value?.runs?.find(item => item.id === runId)
    const item = run?.packages?.find(entry => entry.id === packageId)
    // One prompt lists every reason (file edits, unsandboxed CLI, budget); the Host re-checks all of them.
    const reasons = rerunConfirmations({ run, item, override, choice, ledger: ledger.value, health: health.report, toolFor: toolForProvider, headlessIds: HEADLESS_TOOLS })
    if (reasons.length && !window.confirm(reasons.length === 1
      ? `${reasons[0].text}\n继续吗？`
      : `重跑前需要确认以下 ${reasons.length} 项：\n${reasons.map((entry, index) => `${index + 1}. ${entry.text}`).join('\n')}\n全部确认并继续吗？`)) return
    const codes = new Set(reasons.map(entry => entry.code))
    setBusy(true)
    try {
      const request = { runId, packageId, ...(override ? { provider: override.provider, model: override.model } : {}), ...(choice ? { subscriptionChoice: choice } : {}),
        ...(codes.has('over-budget') ? { confirmOverBudget: true } : {}), ...(codes.has('workspace-write') ? { confirmWrite: true } : {}) }
      let result = await call(() => rerunStep(request), '重跑失败。')
      if (result?.paused && result.budget?.exceeded && !request.confirmOverBudget) {
        // The local estimate missed it (for example a reassigned route): ask once more for the budget only.
        if (!window.confirm(`${result.budget?.message ?? '本次重跑会超出预算。'}\n仍要继续吗？`)) return
        result = await call(() => rerunStep({ ...request, confirmOverBudget: true }), '重跑失败。')
      }
      await refreshLedger()
    } catch (error) {
      if (mounted.current) setLedger(previous => ({ ...previous, error: `${text(error?.message) || '重跑失败。'} 可以修正后再点“重跑此步”，或在官方会话中调用 model_router_rerun_step。` }))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  React.useEffect(() => {
    void refreshHealth(false)
    void refreshLedger()
    void refreshBoundaries()
  }, [])
  return { health, ledger, boundaries, busy, refreshHealth, refreshLedger, refreshBoundaries, finishOnboarding, rate, rerun }
}

export function RouterMainPage({ loadCatalog, settingsScope, listOfficialTools, installOfficialTool, cancelOfficialToolInstall, officialToolInstallStatus, toolHealth, completeOnboarding, loadLedger, rateResult, rerunStep, loadBoundaries, previewRun, startRun, terminalApi }) {
  const workbench = useWorkbenchData({ toolHealth, completeOnboarding, loadLedger, rateResult, rerunStep, loadBoundaries })
  const [catalogState, setCatalogState] = React.useState({ status: 'loading', catalog: null, error: '' })
  const [task, setTask] = React.useState('')
  const [mode, setMode] = React.useState('single')
  const [directKey, setDirectKey] = React.useState('')
  const [budget, setBudget] = React.useState(() => String(settingsScope.getSnapshot().value?.budgetUsd ?? 0))
  const [query, setQuery] = React.useState('')
  const [plan, setPlan] = React.useState(null)
  const [planError, setPlanError] = React.useState('')
  const [toolProbes, setToolProbes] = React.useState(null)
  const [routingSettings, setRoutingSettings] = React.useState(() => {
    const value = settingsScope.getSnapshot().value ?? {}
    return JSON.stringify([value.modelProfilesJson, value.routingPreset])
  })
  const [view, setView] = React.useState('plan')
  const tabRefs = React.useRef({})
  const resultHeading = React.useRef(null)
  const budgetEdited = React.useRef(false)
  const budgetValue = React.useRef(budget)
  const mounted = React.useRef(false)
  const catalogRequest = React.useRef(0)

  React.useEffect(() => {
    if (plan) resultHeading.current?.focus({ preventScroll: true })
  }, [plan])

  const selectView = id => {
    setView(id)
    tabRefs.current[id]?.focus({ preventScroll: true })
  }
  const navigateTabs = (event, index) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % WORKSPACE_VIEWS.length
      : event.key === 'ArrowLeft' ? (index + WORKSPACE_VIEWS.length - 1) % WORKSPACE_VIEWS.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? WORKSPACE_VIEWS.length - 1 : null
    if (next === null) return
    event.preventDefault()
    selectView(WORKSPACE_VIEWS[next].id)
  }

  React.useEffect(() => {
    const syncBudget = () => {
      const value = settingsScope.getSnapshot().value ?? {}
      const signature = JSON.stringify([value.modelProfilesJson, value.routingPreset])
      setRoutingSettings(previous => {
        if (previous === signature) return previous
        return signature
      })
      if (budgetEdited.current) return
      const next = String(value.budgetUsd ?? 0)
      if (next !== budgetValue.current) {
        budgetValue.current = next
        setBudget(next)
        setPlan(null)
        setPlanError('')
      }
    }
    syncBudget()
    return settingsScope.subscribe(syncBudget)
  }, [settingsScope])

  React.useEffect(() => { setPlan(null); setPlanError('') }, [routingSettings])

  React.useEffect(() => {
    mounted.current = true
    const request = ++catalogRequest.current
    Promise.resolve().then(loadCatalog).then(response => {
      if (!mounted.current || request !== catalogRequest.current) return
      if (response?.ok) setCatalogState({ status: 'ready', catalog: response.value, error: '' })
      else setCatalogState({ status: 'error', catalog: null, error: text(response?.error?.message) || '模型目录读取失败' })
    }).catch(error => {
      if (mounted.current && request === catalogRequest.current) setCatalogState({ status: 'error', catalog: null, error: text(error?.message) || '模型目录读取失败' })
    })
    return () => { mounted.current = false; catalogRequest.current += 1 }
  }, [])

  const routes = routesFromModelCatalog(catalogState.catalog)
  const providerCount = new Set(routes.map(route => route.provider)).size
  const refresh = async () => {
    const request = ++catalogRequest.current
    setCatalogState({ status: 'loading', catalog: null, error: '' })
    setPlan(null)
    try {
      const response = await loadCatalog()
      if (!mounted.current || request !== catalogRequest.current) return
      if (response?.ok) setCatalogState({ status: 'ready', catalog: response.value, error: '' })
      else setCatalogState({ status: 'error', catalog: null, error: text(response?.error?.message) || '模型目录读取失败' })
    } catch (error) {
      if (mounted.current && request === catalogRequest.current) setCatalogState({ status: 'error', catalog: null, error: text(error?.message) || '模型目录读取失败' })
    }
  }
  const invalidatePlan = () => {
    setPlan(null)
    setPlanError('')
  }
  const handleToolProbes = React.useCallback(snapshot => {
    setToolProbes(snapshot)
    setPlan(null)
    setPlanError('')
  }, [])
  const generate = () => {
    setPlanError('')
    try {
      if (!text(task)) throw new Error('请先描述任务。')
      if (routes.length === 0) throw new Error('请先在官方“模型”页配置至少一条模型路线。')
      const parsedBudget = Number(budget)
      if (!Number.isFinite(parsedBudget) || parsedBudget < 0) throw new Error('预算必须是不小于 0 的数字。')
      const direct = mode === 'direct' ? routes.find(route => `${route.provider}/${route.model}` === directKey) ?? routes[0] : null
      if (mode === 'direct' && !direct) throw new Error('请选择要直接使用的模型。')
      setPlan(createWorkspacePlan(task, catalogState.catalog, {
        mode,
        ...(direct ? { directProvider: direct.provider, directModel: direct.model } : {}),
        budgetUsd: parsedBudget,
        modelProfilesJson: settingsScope.getSnapshot().value?.modelProfilesJson ?? '[]',
        installedToolIds: (toolProbes?.probes ?? []).filter(probe => probe.installed).map(probe => probe.id),
        runnableToolIds: (toolProbes?.readiness ?? []).filter(item => item.ready).map(item => item.id),
        preset: settingsScope.getSnapshot().value?.routingPreset ?? 'balanced',
        qualityBiases: workbench.ledger.value?.biases ?? null,
        loggedOutToolIds: (workbench.health.report?.tools ?? []).filter(item => item.installed && item.login?.state === 'logged-out').map(item => item.id),
      }))
    } catch (error) {
      setPlan(null)
      setPlanError(text(error?.message) || '无法生成路由建议。')
    }
  }

  const summary = healthSummary(workbench.health.report?.tools)
  return (
    <main className="mr-workspace">
      <style>{stylesheet}</style>
      <div className="mr-shell">
        <header className="mr-header">
          <div>
            <p className="mr-eyebrow">Model Router · DeepSeek Harness</p>
            <h1 className="mr-title">模型路由工作台</h1>
            <p className="mr-subtitle">把任务交给合适的模型。从本地规划，到可确认的执行。</p>
          </div>
          <div className="mr-status"><span className={`mr-status-dot ${catalogState.status === 'loading' ? 'loading' : catalogState.status === 'error' ? 'error' : ''}`} />{catalogState.status === 'ready' ? `${providerCount} 个供应商 · ${routes.length} 条路线` : catalogState.status === 'loading' ? '正在读取模型目录' : '模型目录读取失败'}</div>
        </header>

        <div className="mr-overview" aria-label="工作台概览">
          <button type="button" className="mr-overview-item" onClick={() => selectView('models')}><span className="mr-overview-label">模型路线</span><strong>{catalogState.status === 'ready' ? routes.length : '—'}</strong><span className="mr-overview-detail">{catalogState.status === 'ready' ? `${providerCount} 个供应商 · 配置价格与能力 →` : '等待目录加载'}</span></button>
          <button type="button" className="mr-overview-item" onClick={() => selectView('tools')}><span className="mr-overview-label">官方工具</span><strong>{workbench.health.report ? summary.installed : '—'}<small> / {OFFICIAL_TOOLS.length}</small></strong><span className="mr-overview-detail">{workbench.health.report ? `${summary.ready} 个已登录 · 查看体检 →` : '查看安装与登录状态 →'}</span></button>
          <button type="button" className="mr-overview-item" onClick={() => selectView('controls')}><span className="mr-overview-label">今日 API 费用</span><strong>{workbench.ledger.value ? money(workbench.ledger.value.spent?.today ?? 0) : '—'}</strong><span className="mr-overview-detail">本机记录估算 · 查看预算 →</span></button>
        </div>

        <div className="mr-workspace-tabs" role="tablist" aria-label="工作台功能">
          {WORKSPACE_VIEWS.map((item, index) => <button key={item.id} ref={element => { tabRefs.current[item.id] = element }} type="button" role="tab" id={`mr-tab-${item.id}`} aria-selected={view === item.id} aria-controls={`mr-panel-${item.id}`} tabIndex={view === item.id ? 0 : -1} onKeyDown={event => navigateTabs(event, index)} onClick={() => setView(item.id)}><span className="mr-tab-number" aria-hidden="true">{item.number}</span>{item.label}</button>)}
        </div>

        {staleHostNotice({ hostVersion: toolProbes?.hostVersion, loaded: Boolean(toolProbes?.probes?.length) }) && <div className="mr-error" role="alert">{staleHostNotice({ hostVersion: toolProbes?.hostVersion })}</div>}
        {(workbench.health.report?.notices ?? []).map(notice => (
          <div key={`${notice.kind}-${notice.at}`} className="mr-error" role="alert">{notice.message}</div>
        ))}
        <div className="mr-view mr-stack" role="tabpanel" id="mr-panel-plan" aria-labelledby="mr-tab-plan" hidden={view !== 'plan'}>
        <div className="mr-grid mr-planning-grid">
          <section className="mr-card" aria-label="任务规划">
            <div className="mr-card-head"><div><h2 className="mr-card-title">任务规划</h2><p className="mr-card-copy">写清目标与验收标准，先生成本地建议，再预览执行。</p></div><span className="mr-pill">本地规划 · 不消耗 token</span></div>
            <div className="mr-card-body">
              <label className="mr-label" htmlFor="mr-task">任务描述</label>
              <textarea className="mr-textarea" id="mr-task" value={task} onChange={event => { setTask(event.target.value); invalidatePlan() }} placeholder="例如：分析项目架构，分工修复关键问题，并给出验收清单" aria-describedby="mr-task-hint" />
              <p className="mr-caption mr-task-hint" id="mr-task-hint">团队任务可按编号写出步骤、交付物和依赖；规划不会更改主会话模型。</p>
              <div className="mr-controls">
                <div className="mr-control-group"><span className="mr-control-label">规划模式</span><div className="mr-segment" role="group" aria-label="规划模式"><button type="button" aria-pressed={mode === 'single'} onClick={() => { setMode('single'); invalidatePlan() }}>单任务</button><button type="button" aria-pressed={mode === 'team'} onClick={() => { setMode('team'); invalidatePlan() }}>团队分工</button><button type="button" aria-pressed={mode === 'direct'} onClick={() => { setMode('direct'); invalidatePlan() }}>指定模型</button></div></div>
                {mode === 'direct' && <div className="mr-control-group mr-direct"><label className="mr-control-label" htmlFor="mr-direct-model">直接使用</label><select className="mr-input" id="mr-direct-model" value={directKey || (routes[0] ? `${routes[0].provider}/${routes[0].model}` : '')} onChange={event => { setDirectKey(event.target.value); invalidatePlan() }}>{routes.map(route => <option key={`${route.provider}/${route.model}`} value={`${route.provider}/${route.model}`}>{route.provider}/{route.model}</option>)}</select></div>}
                <div className="mr-control-group mr-budget"><label className="mr-control-label" htmlFor="mr-budget">本次估算预算（USD）</label><input className="mr-input" id="mr-budget" type="number" min="0" step="0.01" value={budget} onChange={event => { budgetEdited.current = true; budgetValue.current = event.target.value; setBudget(event.target.value); invalidatePlan() }} /></div>
              </div>
              <div className="mr-actions"><button className="mr-button" type="button" disabled={catalogState.status !== 'ready' || routes.length === 0 || toolProbes === null} onClick={generate}>生成路由建议</button><span className="mr-caption">{catalogState.status === 'loading' ? '正在读取模型目录…' : catalogState.status === 'error' ? '目录读取失败，请在“模型配置”中刷新。' : routes.length === 0 ? '请先在 Harness 的“模型”页添加模型。' : toolProbes === null ? '正在检测官方工具…' : '预算 0 为不限；费用为估算。'}</span></div>
              {planError && <p className="mr-error" role="alert">{planError}</p>}
            </div>
          </section>

          <aside className="mr-planning-guide" aria-label="规划使用提示">
            <p className="mr-eyebrow">工作流程</p>
            <ol className="mr-workflow"><li><span>01</span><div><strong>描述任务</strong><p>选择单任务、团队分工或指定模型。</p></div></li><li><span>02</span><div><strong>核对路由建议</strong><p>检查模型、工作包依赖和估算费用。</p></div></li><li><span>03</span><div><strong>预览并确认执行</strong><p>确认后调用模型，结果写入执行记录。</p></div></li></ol>
            <div className="mr-guide-links"><button className="mr-button mr-button-secondary" type="button" onClick={() => selectView('models')}>配置模型价格与能力 →</button><button className="mr-button mr-button-secondary" type="button" onClick={() => selectView('tools')}>检查官方工具与登录 →</button></div>
            <p className="mr-caption">缺少价格时会提示“价格待配置”。只读执行可在此完成；修改文件的任务需在官方会话中审批。</p>
          </aside>
        </div>

        {plan && <PlanResults plan={plan} ledger={workbench.ledger.value} headingRef={resultHeading} />}
        <RunLauncher task={task} mode={mode} budgetUsd={budget} ledger={workbench.ledger.value} previewRun={previewRun} startRun={startRun}
          planningRevision={routingSettings}
          directRoute={mode === 'direct' ? routes.find(route => `${route.provider}/${route.model}` === directKey) ?? routes[0] ?? null : null}
          defaultPreset={settingsScope.getSnapshot().value?.routingPreset ?? 'balanced'}
          disabledReason={catalogState.status === 'loading' ? '正在读取模型目录…' : catalogState.status === 'error' ? '模型目录读取失败，请在“模型配置”中刷新。' : routes.length === 0 ? '请先在官方“模型”页配置至少一条模型路线。' : ''}
          onStarted={() => { void workbench.refreshLedger() }} />
        <RunHistoryCard ledger={workbench.ledger.value} routes={routes} busy={workbench.busy} error={workbench.ledger.error}
          onRefresh={() => { void workbench.refreshLedger() }} onRate={(runId, packageId, rating) => { void workbench.rate(runId, packageId, rating) }}
          onRerun={(runId, packageId, override, choice) => { void workbench.rerun(runId, packageId, override, choice) }} />
        </div>

        <div className="mr-view" role="tabpanel" id="mr-panel-models" aria-labelledby="mr-tab-models" hidden={view !== 'models'}>
          <div className="mr-view-heading"><h2>模型配置</h2><p>从官方目录选择路线，补齐比较所需的价格、能力与执行方式。</p></div>
          <div className="mr-grid mr-model-grid">
          <ModelProfileEditor routes={routes} settingsScope={settingsScope} onSaved={invalidatePlan} />

          <section className="mr-card" aria-label="模型目录">
            <div className="mr-card-head"><div><h2 className="mr-card-title">模型目录</h2><p className="mr-card-copy">{routes.length} 条路线 · 只读取官方目录，不读取 API Key。</p></div><button className="mr-button mr-button-secondary" type="button" disabled={catalogState.status === 'loading'} onClick={refresh}>刷新</button></div>
            <div className="mr-card-body">
              {catalogState.status === 'error' && <div className="mr-error" role="alert">{catalogState.error}</div>}
              {catalogState.status === 'loading' && <div className="mr-empty">正在加载官方模型目录…</div>}
              {catalogState.status === 'ready' && <><label className="mr-label" htmlFor="mr-model-search">搜索路线</label><input className="mr-input mr-search" id="mr-model-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="模型或供应商" /><RouteList routes={routes} query={query} />{catalogState.catalog?.failures?.length > 0 && <p className="mr-caption">{catalogState.catalog.failures.length} 个供应商的目录读取失败，请在官方模型页检查配置。</p>}</>}
              <p className="mr-caption" style={{ marginTop: 13 }}>目录登记不代表凭据或网络当前可用；图像能力需要在实际使用前核对。</p>
            </div>
          </section>
        </div>
        </div>

        <div className="mr-view mr-stack" role="tabpanel" id="mr-panel-tools" aria-labelledby="mr-tab-tools" hidden={view !== 'tools'}>
        <div className="mr-view-heading"><h2>官方工具</h2><p>管理本机 CLI、检查登录状态，或打开交互式终端。</p></div>
        {workbench.health.report && !workbench.health.report.onboarding?.completedAt && (
          <OnboardingBanner health={workbench.health.report} error={workbench.health.error} refreshing={workbench.health.refreshing}
            onRefresh={() => { void workbench.refreshHealth(true) }} onDone={() => { void workbench.finishOnboarding() }} />
        )}
        <OfficialToolsCard listOfficialTools={listOfficialTools} installOfficialTool={installOfficialTool} cancelOfficialToolInstall={cancelOfficialToolInstall} officialToolInstallStatus={officialToolInstallStatus} onProbes={handleToolProbes}
          health={workbench.health.report} onRefreshHealth={() => { void workbench.refreshHealth(true) }} />
        {terminalApi && <CliTerminalCard api={terminalApi} health={workbench.health.report} />}
        </div>

        <div className="mr-view mr-stack" role="tabpanel" id="mr-panel-controls" aria-labelledby="mr-tab-controls" hidden={view !== 'controls'}>
        <div className="mr-view-heading"><h2>预算与安全</h2><p>设置成本与质量策略，核对订阅计费和执行边界。</p></div>
        <CostControlCard ledger={workbench.ledger.value} error={workbench.ledger.error && !workbench.ledger.value ? workbench.ledger.error : ''} settingsScope={settingsScope}
          onChanged={() => { invalidatePlan(); void workbench.refreshLedger() }} />
        <BillingCard billing={workbench.health.report?.billing ?? null} error={workbench.health.report ? '' : workbench.health.error}
          refreshing={workbench.health.refreshing} onRefresh={() => { void workbench.refreshHealth(true) }} />
        <SecurityCard data={workbench.boundaries.value} error={workbench.boundaries.error} onRefresh={() => { void workbench.refreshBoundaries() }} />
        </div>
        <footer className="mr-footer">主会话模型由 Harness 管理。更多设置：插件 → 已安装 → <code>@ljwei-stak/dsh-model-router</code>。</footer>
      </div>
    </main>
  )
}
