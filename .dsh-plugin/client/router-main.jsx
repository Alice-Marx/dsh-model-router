import React from 'react'
import { createWorkspacePlan, routesFromModelCatalog } from './catalog.mjs'
import { OFFICIAL_TOOLS, installCommandLine } from '../shared/official-tool-registry.mjs'
import stylesheet from './router-main.css'

const money = value => `$${Number(value || 0).toFixed(4)}`
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

function PlanResults({ plan }) {
  const selected = plan.selected
  return (
    <section className="mr-card mr-results" aria-label="路由建议">
      <div className="mr-card-head">
        <div>
          <h2 className="mr-card-title">路由建议</h2>
          <p className="mr-card-copy">本地计算完成，未向模型发送任务内容。</p>
        </div>
      </div>
      <div className="mr-card-body">
        <div className="mr-result-grid">
          <div className="mr-metric"><div className="mr-metric-label">推荐路线</div><div className="mr-metric-value">{selected ? `${selected.provider}/${selected.model}` : '暂无路线'}</div></div>
          <div className="mr-metric"><div className="mr-metric-label">任务复杂度</div><div className="mr-metric-value">{{ simple: '简单', balanced: '中等', complex: '复杂' }[plan.complexity.band] || plan.complexity.band}</div></div>
          <div className="mr-metric"><div className="mr-metric-label">估算总成本</div><div className="mr-metric-value">{money(plan.estimatedCost)}</div></div>
        </div>
        <div className="mr-channel-line">
          <span className="mr-control-label">执行渠道</span>
          <ChannelBadge item={plan} />
        </div>
        <p className="mr-caption">{plan.reason}</p>
        {plan.optimization.budgetExceeded && <p className="mr-error">按当前实验价格估算，任务可能超过本次预算。预算只影响建议，不会阻止实际扣费。</p>}
        {plan.mode === 'team' && (
          <>
            <h3 className="mr-section-title">交给官方 Agent Teams 的工作包</h3>
            {plan.team.workPackages.length === 0
              ? <div className="mr-empty">当前目录没有可分配的模型路线。</div>
              : plan.team.workPackages.map((item, index) => (
                <article className="mr-package" key={item.id}>
                  <div className="mr-package-top"><div className="mr-package-name">{index + 1}. {item.name}</div><div className="mr-package-route">{item.recommendedProvider}/{item.recommendedModel}</div></div>
                  <p className="mr-package-copy">{item.purpose}{item.dependsOn.length > 0 ? ` · 依赖：${item.dependsOn.join('、')}` : ''}</p>
                  <p className="mr-package-copy">验收：{item.verificationChecklist.join('；')}</p>
                  <div className="mr-channel-line"><ChannelBadge item={item} /></div>
                </article>
              ))}
          </>
        )}
        <div className="mr-notice">{plan.pricingNotice} {plan.availabilityNotice} {plan.modalityNotice || ''}</div>
      </div>
    </section>
  )
}

function OfficialToolsCard() {
  const [copied, setCopied] = React.useState('')
  const copy = async tool => {
    const command = installCommandLine(tool)
    if (!command) return
    try {
      await navigator.clipboard.writeText(command)
      setCopied(tool.id)
      setTimeout(() => setCopied(current => (current === tool.id ? '' : current)), 2_000)
    } catch { /* clipboard unavailable; the command is visible for manual copy */ }
  }
  return (
    <section className="mr-card" aria-label="官方工具">
      <div className="mr-card-head"><div>
        <h2 className="mr-card-title">官方工具</h2>
        <p className="mr-card-copy">各厂商官方 CLI 的固定版本安装命令。已安装的工具可直接执行对应模型的任务。</p>
      </div></div>
      <div className="mr-card-body">
        <div className="mr-tools" role="list" aria-label="官方 CLI 工具注册表">
          {OFFICIAL_TOOLS.map(tool => {
            const command = installCommandLine(tool)
            return (
              <div className="mr-tool" role="listitem" key={tool.id}>
                <div style={{ minWidth: 0 }}>
                  <div className="mr-route-name" title={tool.purpose}>{tool.label}</div>
                  <div className="mr-route-provider">{tool.vendor} · {tool.id}</div>
                  {command
                    ? <code className="mr-tool-command">{command}</code>
                    : <p className="mr-caption" style={{ margin: '6px 0 0' }}>{tool.unsupportedReason}</p>}
                </div>
                {command && (
                  <button className="mr-button mr-button-secondary mr-tool-button" type="button" onClick={() => copy(tool)}>
                    {copied === tool.id ? '已复制' : '复制命令'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <p className="mr-caption" style={{ marginTop: 12 }}>
          一键安装：在官方会话输入 <code>/tools</code> 查看检测状态、<code>/tools install kimi-code</code> 一条命令安装（Agent 也可自动调用 <code>model_router_tool_install</code>）。检测与安装由 Host 按注册表固定命令执行，不接受自定义包名。
        </p>
      </div>
    </section>
  )
}

/** Root-scoped official Desktop panel. The plan is local; real calls remain in Host tools. */
export function RouterMainPage({ loadCatalog, settingsScope }) {
  const [catalogState, setCatalogState] = React.useState({ status: 'loading', catalog: null, error: '' })
  const [task, setTask] = React.useState('')
  const [mode, setMode] = React.useState('single')
  const [budget, setBudget] = React.useState(() => String(settingsScope.getSnapshot().value?.budgetUsd ?? 0))
  const [query, setQuery] = React.useState('')
  const [plan, setPlan] = React.useState(null)
  const [planError, setPlanError] = React.useState('')
  const budgetEdited = React.useRef(false)
  const mounted = React.useRef(false)
  const catalogRequest = React.useRef(0)

  React.useEffect(() => {
    const syncBudget = () => {
      if (!budgetEdited.current) setBudget(String(settingsScope.getSnapshot().value?.budgetUsd ?? 0))
    }
    syncBudget()
    return settingsScope.subscribe(syncBudget)
  }, [settingsScope])

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
  const generate = () => {
    setPlanError('')
    try {
      if (!text(task)) throw new Error('请先描述任务。')
      if (routes.length === 0) throw new Error('请先在官方“模型”页配置至少一条模型路线。')
      const parsedBudget = Number(budget)
      if (!Number.isFinite(parsedBudget) || parsedBudget < 0) throw new Error('预算必须是不小于 0 的数字。')
      setPlan(createWorkspacePlan(task, catalogState.catalog, { mode, budgetUsd: parsedBudget }))
    } catch (error) {
      setPlan(null)
      setPlanError(text(error?.message) || '无法生成路由建议。')
    }
  }

  return (
    <main className="mr-workspace">
      <style>{stylesheet}</style>
      <div className="mr-shell">
        <header className="mr-header">
          <div>
            <p className="mr-eyebrow">Model Router · DeepSeek Harness</p>
            <h1 className="mr-title">模型路由工作台</h1>
            <p className="mr-subtitle">查看官方模型目录，为任务生成路线建议与团队工作包。主会话模型仍由官方选择器管理。</p>
          </div>
          <div className="mr-status"><span className={`mr-status-dot ${catalogState.status === 'loading' ? 'loading' : catalogState.status === 'error' ? 'error' : ''}`} />{catalogState.status === 'ready' ? `${providerCount} 个供应商 · ${routes.length} 条路线` : catalogState.status === 'loading' ? '正在读取模型目录' : '模型目录读取失败'}</div>
        </header>

        <div className="mr-grid">
          <section className="mr-card" aria-label="任务规划">
            <div className="mr-card-head"><div><h2 className="mr-card-title">任务规划</h2><p className="mr-card-copy">规划在本机完成，不会启动模型或团队任务。</p></div></div>
            <div className="mr-card-body">
              <label className="mr-label" htmlFor="mr-task">任务描述</label>
              <textarea className="mr-textarea" id="mr-task" value={task} onChange={event => setTask(event.target.value)} placeholder="例如：分析项目架构，分工修复关键问题，并给出验收清单" />
              <div className="mr-controls">
                <div className="mr-control-group"><span className="mr-control-label">规划模式</span><div className="mr-segment" role="group" aria-label="规划模式"><button type="button" aria-pressed={mode === 'single'} onClick={() => setMode('single')}>单任务</button><button type="button" aria-pressed={mode === 'team'} onClick={() => setMode('team')}>团队分工</button></div></div>
                <div className="mr-control-group mr-budget"><label className="mr-control-label" htmlFor="mr-budget">本次估算预算（USD）</label><input className="mr-input" id="mr-budget" type="number" min="0" step="0.01" value={budget} onChange={event => { budgetEdited.current = true; setBudget(event.target.value) }} /></div>
              </div>
              <div className="mr-actions"><button className="mr-button" type="button" disabled={catalogState.status !== 'ready' || routes.length === 0} onClick={generate}>生成路由建议</button><span className="mr-caption">0 表示不限制本次建议；不会设置真实支出上限。</span></div>
              {planError && <p className="mr-error" role="alert">{planError}</p>}
            </div>
          </section>

          <section className="mr-card" aria-label="模型目录">
            <div className="mr-card-head"><div><h2 className="mr-card-title">模型目录</h2><p className="mr-card-copy">只显示官方已登记的 provider/model，不读取 API Key。</p></div><button className="mr-button mr-button-secondary" type="button" onClick={refresh}>刷新</button></div>
            <div className="mr-card-body">
              {catalogState.status === 'error' && <div className="mr-error" role="alert">{catalogState.error}</div>}
              {catalogState.status === 'loading' && <div className="mr-empty">正在加载官方模型目录…</div>}
              {catalogState.status === 'ready' && <><label className="mr-label" htmlFor="mr-model-search">搜索路线</label><input className="mr-input mr-search" id="mr-model-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="模型或供应商" /><RouteList routes={routes} query={query} />{catalogState.catalog?.failures?.length > 0 && <p className="mr-caption">{catalogState.catalog.failures.length} 个供应商的目录读取失败，请在官方模型页检查配置。</p>}</>}
              <p className="mr-caption" style={{ marginTop: 13 }}>目录登记不代表凭据或网络当前可用；图像能力需要在实际使用前核对。</p>
            </div>
          </section>
        </div>

        {plan && <PlanResults plan={plan} />}
        <OfficialToolsCard />
        <div className="mr-notice">需要其他模型的实际意见时，在官方会话中请 Agent 调用 <code>model_router_consult</code>；需要执行团队分工时，由官方 Agent Teams 接管成员与任务生命周期。设置位于“插件 → 已安装 → @ljwei-stak/model-router-galgame”。</div>
      </div>
    </main>
  )
}
