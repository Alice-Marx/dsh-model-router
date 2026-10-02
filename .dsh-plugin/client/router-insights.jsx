import React from 'react'
import { ROUTING_PRESETS } from '../shared/routing-presets.mjs'
import {
  LOGIN_LABEL, RUN_KIND_LABEL, RUN_STATUS_LABEL, VERSION_LABEL, budgetMeter, dagLayers, formatUsd, healthSummary,
  packageCost, packageStatus, rerunSupport, runTotals,
} from './insights-state.mjs'

const text = value => typeof value === 'string' ? value.trim() : ''
const BAND = { simple: '简单', balanced: '中等', complex: '困难' }

/** First-open banner: one line per problem, with the way out. */
export function OnboardingBanner({ health, onDone, onRefresh, refreshing, error }) {
  const summary = healthSummary(health?.tools)
  const problems = (health?.tools ?? []).filter(item => item.installed && (item.login?.state === 'logged-out' || item.versionStatus === 'older'))
  return (
    <section className="mr-card mr-onboarding" aria-label="开箱体检">
      <div className="mr-card-head"><div>
        <h2 className="mr-card-title">开箱体检</h2>
        <p className="mr-card-copy">首次打开时检测每个官方工具是否已安装、版本是否符合、是否已登录。未登录的工具会被路由直接跳过，改走模型目录 API，不必等待 CLI 失败。</p>
      </div><button className="mr-button mr-button-secondary" type="button" disabled={refreshing} onClick={onRefresh}>{refreshing ? '检测中…' : '重新体检'}</button></div>
      <div className="mr-card-body">
        {error && <p className="mr-error" role="alert">{error}</p>}
        {!health && !error && <p className="mr-empty" role="status">正在体检本机官方工具…</p>}
        {health && (
          <>
            <div className="mr-result-grid">
              <div className="mr-metric"><div className="mr-metric-label">已安装</div><div className="mr-metric-value">{summary.installed} / {summary.total}</div></div>
              <div className="mr-metric"><div className="mr-metric-label">已登录可用</div><div className="mr-metric-value">{summary.ready}</div></div>
              <div className="mr-metric"><div className="mr-metric-label">未登录</div><div className="mr-metric-value">{summary.loggedOut}</div></div>
              <div className="mr-metric"><div className="mr-metric-label">登录状态未知</div><div className="mr-metric-value">{summary.unknown}</div></div>
            </div>
            {problems.length > 0
              ? <ul className="mr-checklist">{problems.map(item => <li key={item.id}><strong>{item.label}</strong>：{item.login?.state === 'logged-out' ? `未登录，可在下方点“去登录”查看登录方法（${item.login.command ?? '见说明'}）。` : ''}{item.versionStatus === 'older' ? `当前 ${item.version}，低于目标 ${item.pinnedVersion}，可在下方更新。` : ''}</li>)}</ul>
              : <p className="mr-caption">已安装的工具没有发现未登录或版本过旧的问题。未安装的工具可在下方一键安装。</p>}
            <div className="mr-actions"><button className="mr-button" type="button" onClick={onDone}>完成体检</button><span className="mr-caption">之后可随时在“官方工具”卡片中重新体检。</span></div>
          </>
        )}
      </div>
    </section>
  )
}

/** Login line and the “去登录” helper for one tool row. */
export function ToolLoginLine({ entry }) {
  const [open, setOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  if (!entry?.installed) return null
  const state = entry.login?.state ?? 'unknown'
  const copy = async () => {
    try { await navigator.clipboard.writeText(entry.login.command); setCopied(true) } catch { setCopied(false) }
  }
  return (
    <div className="mr-login">
      <div className="mr-tool-status"><span className={`mr-tool-dot ${state === 'logged-in' ? 'installed' : state === 'logged-out' ? 'missing-strong' : ''}`} />{LOGIN_LABEL[state]} · {VERSION_LABEL[entry.versionStatus] ?? '版本未知'}{entry.pinnedVersion ? `（目标 ${entry.pinnedVersion}）` : ''}</div>
      {entry.login?.detail && <p className="mr-caption mr-tool-detail">{entry.login.detail}</p>}
      {state === 'logged-in' && entry.login?.billing === 'subscription' && <p className="mr-caption mr-tool-detail">订阅账号登录：费用只作参考显示，不计入预算。</p>}
      {state === 'logged-in' && entry.login?.billing === 'api-key' && <p className="mr-caption mr-tool-detail">API Key 计费：费用计入每日/每月预算。</p>}
      {state !== 'logged-in' && <button className="mr-button mr-button-secondary mr-tool-button mr-login-button" type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>去登录</button>}
      {open && (
        <div className="mr-login-guide">
          <p className="mr-caption">{entry.login.steps}</p>
          {entry.login.command && <div className="mr-login-command"><code className="mr-tool-command">{entry.login.command}</code><button className="mr-button mr-button-secondary" type="button" onClick={() => { void copy() }}>{copied ? '已复制' : '复制命令'}</button></div>}
          <p className="mr-caption">插件不会替你启动交互式登录。登录完成后点“重新体检”。</p>
        </div>
      )}
    </div>
  )
}

function Meter({ label, meter }) {
  return (
    <div className="mr-meter">
      <div className="mr-meter-top"><span className="mr-control-label">{label}</span><span className={meter.over ? 'mr-meter-over' : ''}>{meter.text}</span></div>
      {meter.limited && <div className="mr-meter-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(meter.share * 100)}><div className={`mr-meter-fill ${meter.over ? 'over' : meter.share > 0.8 ? 'near' : ''}`} style={{ width: `${Math.round(meter.share * 100)}%` }} /></div>}
    </div>
  )
}

/** Shared settings writer for the main page; Host schema keeps the real validation. */
function useSettingsWriter(settingsScope) {
  const [snapshot, setSnapshot] = React.useState(() => settingsScope.getSnapshot())
  const [notice, setNotice] = React.useState('')
  React.useEffect(() => settingsScope.subscribe(() => setSnapshot(settingsScope.getSnapshot())), [settingsScope])
  const writable = snapshot.status === 'ready' && snapshot.writable === true
  const write = async (key, value) => {
    if (!writable) return false
    setNotice('')
    try {
      const accepted = await settingsScope.mutate([{ op: 'set', path: [key], value }], snapshot.revision)
      if (!accepted) setNotice('设置未保存，可能已在其他页面修改，请重试。')
      return accepted
    } catch (error) {
      setNotice(text(error?.message) || '设置保存失败。')
      return false
    }
  }
  return { value: snapshot.value ?? {}, writable, write, notice }
}

/** 成本控制 + 预设方案: prominent spending meters and the knobs that govern routing cost. */
export function CostControlCard({ ledger, settingsScope, onChanged, error }) {
  const settings = useSettingsWriter(settingsScope)
  const [dailyDraft, setDailyDraft] = React.useState('')
  const [monthlyDraft, setMonthlyDraft] = React.useState('')
  const value = settings.value
  const preset = value.routingPreset ?? 'balanced'
  const daily = Number(value.dailyBudgetUsd ?? 0)
  const monthly = Number(value.monthlyBudgetUsd ?? 0)
  const spent = ledger?.spent ?? { today: 0, month: 0, unknownToday: 0, unknownMonth: 0 }
  const set = async (key, next) => { if (await settings.write(key, next)) onChanged?.() }
  const saveLimit = async (key, draft, reset) => {
    const parsed = Number(draft)
    if (draft === '' || !Number.isFinite(parsed) || parsed < 0) return
    if (await settings.write(key, parsed)) { reset(''); onChanged?.() }
  }
  return (
    <section className="mr-card mr-cost" aria-label="成本控制">
      <div className="mr-card-head"><div>
        <h2 className="mr-card-title">成本控制与路由方案</h2>
        <p className="mr-card-copy">预算只计算走 API Key 或模型目录 API 的花费（CLI 自报金额或 token 用量 × 你配置的单价）。官方 CLI 用订阅账号登录、未注入 API Key 时，只显示按 API 价折算的“订阅参考费用”，不计入预算。缺少单价的调用计为“费用未知”。这是本机估算，不是厂商账单。</p>
      </div></div>
      <div className="mr-card-body">
        {error && <p className="mr-error" role="alert">{error}</p>}
        <div className="mr-meters">
          <Meter label="今日已用（计入预算）" meter={budgetMeter(spent.today, daily)} />
          <Meter label="本月已用（计入预算）" meter={budgetMeter(spent.month, monthly)} />
        </div>
        {(spent.subscriptionRunsMonth ?? 0) > 0 && <p className="mr-caption">订阅参考费用（按 API 价折算，不计入预算）：今日 {formatUsd(spent.subscriptionToday ?? 0)} · 本月 {formatUsd(spent.subscriptionMonth ?? 0)}，本月共 {spent.subscriptionRunsMonth} 次订阅登录调用。</p>}
        {(spent.unknownToday > 0 || spent.unknownMonth > 0) && <p className="mr-caption">本月有 {spent.unknownMonth} 次调用缺少单价或用量，未计入金额。请在“模型价格与能力”中补齐单价。</p>}
        {ledger?.budget?.exceeded && <p className="mr-error" role="alert">{ledger.budget.message} {ledger.budget.action === 'pause' ? '新的执行会先暂停并请求确认。' : '新的执行会尝试自动降级为“省钱优先”。'}</p>}
        <div className="mr-controls">
          <div className="mr-control-group"><span className="mr-control-label">路由方案</span>
            <div className="mr-segment" role="group" aria-label="路由方案">
              {Object.values(ROUTING_PRESETS).map(item => <button key={item.id} type="button" title={item.description} aria-pressed={preset === item.id} disabled={!settings.writable} onClick={() => { void set('routingPreset', item.id) }}>{item.label}</button>)}
            </div>
            <span className="mr-caption">{ROUTING_PRESETS[preset]?.description}</span>
          </div>
          <div className="mr-control-group"><label className="mr-control-label" htmlFor="mr-daily-budget">每日上限（USD，0 为不限）</label>
            <div className="mr-inline"><input className="mr-input mr-budget" id="mr-daily-budget" type="number" min="0" step="0.5" placeholder={String(daily)} value={dailyDraft} onChange={event => setDailyDraft(event.target.value)} /><button className="mr-button mr-button-secondary" type="button" disabled={!settings.writable || dailyDraft === ''} onClick={() => { void saveLimit('dailyBudgetUsd', dailyDraft, setDailyDraft) }}>保存</button></div>
          </div>
          <div className="mr-control-group"><label className="mr-control-label" htmlFor="mr-monthly-budget">每月上限（USD，0 为不限）</label>
            <div className="mr-inline"><input className="mr-input mr-budget" id="mr-monthly-budget" type="number" min="0" step="1" placeholder={String(monthly)} value={monthlyDraft} onChange={event => setMonthlyDraft(event.target.value)} /><button className="mr-button mr-button-secondary" type="button" disabled={!settings.writable || monthlyDraft === ''} onClick={() => { void saveLimit('monthlyBudgetUsd', monthlyDraft, setMonthlyDraft) }}>保存</button></div>
          </div>
          <div className="mr-control-group"><span className="mr-control-label">超出预算时</span>
            <div className="mr-segment" role="group" aria-label="超出预算时">
              <button type="button" aria-pressed={(value.overBudgetAction ?? 'downgrade') === 'downgrade'} disabled={!settings.writable} onClick={() => { void set('overBudgetAction', 'downgrade') }}>自动降级</button>
              <button type="button" aria-pressed={value.overBudgetAction === 'pause'} disabled={!settings.writable} onClick={() => { void set('overBudgetAction', 'pause') }}>暂停并询问</button>
            </div>
          </div>
        </div>
        <h3 className="mr-section-title">质量回路</h3>
        <div className="mr-controls">
          <div className="mr-control-group"><span className="mr-control-label">强模型抽查</span>
            <div className="mr-segment" role="group" aria-label="强模型抽查">
              {[['off', '关闭'], ['sample', '按比例抽查'], ['always', '每次审阅']].map(([id, label]) => <button key={id} type="button" aria-pressed={(value.reviewMode ?? 'off') === id} disabled={!settings.writable} onClick={() => { void set('reviewMode', id) }}>{label}</button>)}
            </div>
            <span className="mr-caption">抽查由目录中质量最高的已配置模型完成，只审阅更便宜模型的结果；审阅本身也会计费。抽查比例 {Math.round(Number(value.reviewSampleRate ?? 0.2) * 100)}%（可在插件设置中调整）。</span>
          </div>
          <label className="mr-check"><input type="checkbox" checked={value.allowManualReassign !== false} disabled={!settings.writable} onChange={event => { void set('allowManualReassign', event.target.checked) }} />允许手动改派工作包</label>
          <label className="mr-check"><input type="checkbox" checked={value.confirmUnsandboxedCli !== false} disabled={!settings.writable} onChange={event => { void set('confirmUnsandboxedCli', event.target.checked) }} />直接启动无沙箱 CLI 前先确认</label>
        </div>
        {settings.notice && <p className="mr-error" role="alert">{settings.notice}</p>}
      </div>
    </section>
  )
}

/** Layered dependency view: one column per depth, nodes in plan order. */
export function DagView({ packages, renderNode, label = '子任务依赖图' }) {
  const layers = dagLayers(packages)
  if (layers.length === 0) return null
  const names = new Map((packages ?? []).map(item => [item.id, item.name]))
  return (
    <div className="mr-dag" role="list" aria-label={label}>
      {layers.map((layer, index) => (
        <div className="mr-dag-column" key={index}>
          <div className="mr-dag-step">第 {index + 1} 步</div>
          {layer.map(item => {
            const status = packageStatus(item)
            return (
              <article className={`mr-dag-node ${status.tone}`} role="listitem" key={item.id}>
                <div className="mr-dag-node-top"><span className="mr-package-name">{item.name}</span><span className={`mr-pill mr-status-${status.tone}`}>{status.label}</span></div>
                {(item.dependsOn ?? []).length > 0 && <p className="mr-package-copy">依赖：{item.dependsOn.map(id => names.get(id) ?? id).join('、')}</p>}
                {renderNode?.(item)}
              </article>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function ChannelText({ item }) {
  if (!item.channel) return <span className="mr-pill">待执行</span>
  return <span className={item.channel === 'official-cli' ? 'mr-pill mr-pill-channel-ok' : 'mr-pill'}>{item.channel === 'official-cli' ? `官方 CLI · ${item.toolId ?? ''}` : '模型目录 API'}</span>
}

function RunNode({ run, item, routes, allowReassign, busy, onRate, onRerun }) {
  const [target, setTarget] = React.useState('')
  const cost = packageCost(item)
  const rerun = rerunSupport(run)
  const canRerun = rerun.supported && !item.ok && !busy
  const others = routes.filter(route => `${route.provider}/${route.model}` !== `${item.provider}/${item.model}`)
  return (
    <>
      <p className="mr-package-route">{item.provider}/{item.model}{item.reassigned ? '（已改派）' : ''}</p>
      <div className="mr-channel-line"><ChannelText item={item} /><span className="mr-caption">预估 {formatUsd(item.estimatedCost)} · 实际 {cost.budget}{item.difficulty ? ` · 难度 ${BAND[item.difficulty] ?? item.difficulty}` : ''}</span></div>
      {cost.reference && <p className="mr-package-copy">{cost.reference}</p>}
      {item.actualModel && <p className="mr-package-copy">CLI 回报模型：{item.actualModel}</p>}
      {item.fallback?.reason && <p className="mr-package-copy">回退原因：{item.fallback.reason}</p>}
      {item.fallback?.error && <p className="mr-package-copy mr-fallback-error">CLI 原始错误：<code>{item.fallback.error}</code></p>}
      {!item.ok && item.error && <p className="mr-package-copy mr-fallback-error">{item.error}</p>}
      {item.review && <p className="mr-package-copy">强模型抽查（{item.review.provider}/{item.review.model}）：{item.review.score ? `${item.review.score}/5` : '未评分'} {item.review.summary}</p>}
      {item.answer && <details className="mr-tool-log"><summary>查看结果</summary><pre>{item.answer}{item.answerTruncated ? '\n…（已截断）' : ''}</pre></details>}
      <div className="mr-node-actions">
        {item.ok && <>
          <button className="mr-button mr-button-secondary mr-mini" type="button" aria-pressed={item.rating === 1} disabled={busy} onClick={() => onRate(run.id, item.id, item.rating === 1 ? 'clear' : 'up')}>👍 有用</button>
          <button className="mr-button mr-button-secondary mr-mini" type="button" aria-pressed={item.rating === -1} disabled={busy} onClick={() => onRate(run.id, item.id, item.rating === -1 ? 'clear' : 'down')}>👎 不好</button>
        </>}
        {canRerun && <button className="mr-button mr-mini" type="button" onClick={() => onRerun(run.id, item.id, null)}>重跑此步</button>}
        {!rerun.supported && !item.ok && item.ran && <span className="mr-caption">{rerun.reason}</span>}
        {rerun.supported && allowReassign && others.length > 0 && !busy && (
          <span className="mr-inline">
            <select className="mr-input mr-mini-select" aria-label="改派到" value={target} onChange={event => setTarget(event.target.value)}>
              <option value="">改派到…</option>
              {others.map(route => <option key={`${route.provider}/${route.model}`} value={`${route.provider}\u0000${route.model}`}>{route.provider}/{route.model}</option>)}
            </select>
            <button className="mr-button mr-button-secondary mr-mini" type="button" disabled={!target} onClick={() => { const [provider, model] = target.split('\u0000'); onRerun(run.id, item.id, { provider, model }) }}>改派并重跑</button>
          </span>
        )}
      </div>
    </>
  )
}

/** 路由决策 + 子任务可视化: recent runs with their DAG, channels, real errors, costs and ratings. */
export function RunHistoryCard({ ledger, routes, onRefresh, onRate, onRerun, busy, error }) {
  const runs = ledger?.runs ?? []
  const [openId, setOpenId] = React.useState(null)
  const current = runs.find(run => run.id === openId) ?? runs[0]
  return (
    <section className="mr-card mr-results" aria-label="执行记录">
      <div className="mr-card-head"><div>
        <h2 className="mr-card-title">执行记录与子任务</h2>
        <p className="mr-card-copy">来自会话中的 model_router_execute、model_router_team_execute 和 model_router_tool_run。每个工作包显示分配的模型、原因、渠道、费用；回退时显示 CLI 原始错误。路由执行和只读团队执行中失败的步骤可单独重跑，不会重做已完成的步骤。</p>
      </div><button className="mr-button mr-button-secondary" type="button" disabled={busy} onClick={onRefresh}>刷新</button></div>
      <div className="mr-card-body">
        {error && <p className="mr-error" role="alert">{error}</p>}
        {runs.length === 0 && <p className="mr-empty">还没有执行记录。在官方会话中调用 model_router_execute、model_router_team_execute 或 model_router_tool_run 后，这里会显示决策和结果。</p>}
        {runs.length > 0 && (
          <>
            <label className="mr-label" htmlFor="mr-run-select">选择记录</label>
            <select className="mr-input" id="mr-run-select" value={current?.id ?? ''} onChange={event => setOpenId(event.target.value)}>
              {runs.map(run => <option key={run.id} value={run.id}>{new Date(run.createdAt).toLocaleString()} · {RUN_KIND_LABEL[run.kind ?? 'assign'] ?? run.kind} · {RUN_STATUS_LABEL[run.status] ?? run.status} · {run.task.slice(0, 40)}</option>)}
            </select>
            {current && (
              <div className="mr-run">
                <div className="mr-result-grid">
                  <div className="mr-metric"><div className="mr-metric-label">方案</div><div className="mr-metric-value">{ROUTING_PRESETS[current.preset]?.label ?? current.preset}{current.budget?.downgraded ? '（超预算自动降级）' : ''}</div></div>
                  <div className="mr-metric"><div className="mr-metric-label">难度</div><div className="mr-metric-value">{BAND[current.decision?.complexity?.band] ?? '—'}{current.decision?.complexity?.value !== null && current.decision?.complexity?.value !== undefined ? ` · ${current.decision.complexity.value}` : ''}</div></div>
                  <div className="mr-metric"><div className="mr-metric-label">预估 / 实际（计入预算）</div><div className="mr-metric-value">{formatUsd(current.decision?.estimatedCost)} / {formatUsd(runTotals(current).budgetUsd)}</div></div>
                  <div className="mr-metric"><div className="mr-metric-label">类型</div><div className="mr-metric-value">{RUN_KIND_LABEL[current.kind ?? 'assign'] ?? current.kind}{current.kind === 'team' || current.kind === 'tool' ? ` · ${current.executionMode === 'workspace-write' ? '可编辑' : '只读'}` : ''}</div></div>
                </div>
                {runTotals(current).subscription && <p className="mr-caption">订阅参考费用（按 API 价折算，不计入预算）：{formatUsd(runTotals(current).referenceUsd)}</p>}
                {current.isolatedWorkspace && <p className="mr-caption">独立工作区：<code>{current.isolatedWorkspace}</code></p>}
                {current.decision?.reason && <p className="mr-caption">路由原因：{current.decision.reason}</p>}
                <DagView packages={current.packages} renderNode={item => <RunNode run={current} item={item} routes={routes} allowReassign={ledger?.settings?.allowManualReassign !== false} busy={busy} onRate={onRate} onRerun={onRerun} />} />
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

/** 安全边界: what each configured route can read and write. */
export function SecurityCard({ data, error, onRefresh }) {
  const rows = data?.boundaries ?? []
  return (
    <section className="mr-card mr-results" aria-label="安全边界">
      <div className="mr-card-head"><div>
        <h2 className="mr-card-title">安全边界</h2>
        <p className="mr-card-copy">每条已配置路线可读、可写的范围和是否经过 Harness 进程沙箱。可编辑运行总是需要你在官方审批中确认；直接启动无沙箱 CLI 前默认也会询问。</p>
      </div><button className="mr-button mr-button-secondary" type="button" onClick={onRefresh}>刷新</button></div>
      <div className="mr-card-body">
        {error && <p className="mr-error" role="alert">{error}</p>}
        {data && !data.sandboxAvailable && <p className="mr-error">当前 Host 没有提供 Harness 进程沙箱：可编辑运行会被拒绝，只读的无界面 CLI 将直接启动。</p>}
        {rows.length === 0 && !error && <p className="mr-empty">{data ? '模型目录中没有路线。' : '正在读取…'}</p>}
        {rows.length > 0 && (
          <div className="mr-table-wrap"><table className="mr-table">
            <thead><tr><th>路线</th><th>只读运行可读</th><th>只读运行沙箱</th><th>可编辑运行</th></tr></thead>
            <tbody>{rows.map(row => (
              <tr key={`${row.provider}/${row.model}`}>
                <td><strong>{row.provider}/{row.model}</strong>{row.toolLabel ? <div className="mr-caption">{row.toolLabel}</div> : <div className="mr-caption">仅 API</div>}</td>
                <td>{row.readOnly.readable}</td>
                <td className={row.readOnly.direct ? 'mr-warn-text' : ''}>{row.readOnly.sandbox}</td>
                <td>{row.write ? `${row.write.writable}；需审批` : '不支持'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </section>
  )
}
