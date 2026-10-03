import React from 'react'
import { ROUTING_PRESETS } from '../shared/routing-presets.mjs'
import { formatUsd, launchRequest, unwrapRemote } from './insights-state.mjs'

const text = value => typeof value === 'string' ? value.trim() : ''
const STATUS_TEXT = Object.freeze({
  succeeded: '执行完成', completed: '执行完成', partial: '部分步骤失败', failed: '执行失败', cancelled: '已取消',
  'paused-budget': '已因预算暂停，未启动模型', 'paused-subscription-failure': '有步骤因订阅调用失败而暂停，请在下方执行记录中选择如何继续',
})

/**
 * 工作台直接执行: task + preset (+ one model) → host preview (plan, cost
 * estimate, budget, every reason that needs confirming) → one confirm → run.
 * The run is model_router_execute's read-only path; nothing starts before
 * the user presses the confirm button.
 */
export function RunLauncher({ task, mode, directRoute, budgetUsd, defaultPreset, ledger, previewRun, startRun, onStarted, disabledReason, planningRevision }) {
  const [preset, setPreset] = React.useState(defaultPreset || 'balanced')
  const lastWorkspace = [...(ledger?.runs ?? [])].map(run => run.workspace).find(Boolean) ?? ''
  const [workspace, setWorkspace] = React.useState('')
  const [phase, setPhase] = React.useState({ kind: 'idle' })
  const mounted = React.useRef(true)
  const confirmRef = React.useRef(null)
  const pendingRequest = React.useRef(0)
  const inputSignature = JSON.stringify([task, mode, directRoute?.provider, directRoute?.model, budgetUsd, preset, workspace, lastWorkspace, planningRevision, disabledReason])
  const latestSignature = React.useRef(inputSignature)
  latestSignature.current = inputSignature
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; pendingRequest.current += 1 } }, [])
  React.useEffect(() => { setPreset(defaultPreset || 'balanced') }, [defaultPreset])
  // Any change to the inputs invalidates a shown preview.
  React.useEffect(() => {
    pendingRequest.current += 1
    setPhase(previous => ['previewing', 'preview', 'error'].includes(previous.kind) ? { kind: 'idle' } : previous)
  }, [inputSignature])
  React.useEffect(() => { if (phase.kind === 'preview') confirmRef.current?.focus() }, [phase.kind])

  const request = () => launchRequest({ task, mode, directRoute, budgetUsd, preset, workspace: text(workspace) || lastWorkspace })
  const unavailable = typeof previewRun !== 'function' || typeof startRun !== 'function'
  const blocked = disabledReason || (unavailable ? '工作台执行服务尚未加载，请更新插件后重试。' : !text(task) ? '先在上方“任务规划”中描述任务。' : '')
  const busy = phase.kind === 'previewing' || phase.kind === 'running'

  const preview = async () => {
    if (blocked || busy) return
    const current = ++pendingRequest.current
    const snapshot = request()
    const signature = inputSignature
    setPhase({ kind: 'previewing' })
    try {
      const value = unwrapRemote(await previewRun(snapshot), '执行预览失败。')
      if (mounted.current && current === pendingRequest.current && signature === latestSignature.current) setPhase({ kind: 'preview', value, request: snapshot, signature })
    } catch (error) {
      if (mounted.current && current === pendingRequest.current && signature === latestSignature.current) setPhase({ kind: 'error', message: text(error?.message) || '执行预览失败。' })
    }
  }
  const confirm = async () => {
    if (phase.kind !== 'preview' || phase.signature !== latestSignature.current) return
    const shown = phase.value
    const snapshot = phase.request
    const signature = phase.signature
    setPhase({ kind: 'running', value: shown, request: snapshot, signature })
    try {
      const value = unwrapRemote(await startRun({ ...snapshot, confirmedReasons: (shown.reasons ?? []).map(item => item.code) }), '执行失败。')
      if (!mounted.current) return
      if (value.status === 'needs-confirmation') {
        setPhase(signature === latestSignature.current ? { kind: 'preview', value, request: snapshot, signature, changed: true } : { kind: 'idle' })
        return
      }
      setPhase({ kind: 'done', value })
      onStarted?.(value.runId)
    } catch (error) {
      if (mounted.current) setPhase({ kind: 'error', message: text(error?.message) || '执行失败。' })
    }
  }

  return (
    <section className="mr-card" aria-label="在工作台执行">
      <div className="mr-card-head"><div>
        <h2 className="mr-card-title">在工作台执行</h2>
        <p className="mr-card-copy">使用上方的任务描述与规划模式，先预览执行计划与预估费用，确认后才会调用模型。执行为只读：官方 CLI 以无界面只读方式运行，不修改文件；可编辑任务请在官方会话中使用 model_router_tool_run 或 model_router_team_execute。</p>
      </div></div>
      <div className="mr-card-body">
        <div className="mr-controls">
          <div className="mr-control-group"><span className="mr-control-label" id="mr-launch-preset">路由方案</span>
            <div className="mr-segment" role="group" aria-labelledby="mr-launch-preset">
              {Object.values(ROUTING_PRESETS).map(item => <button key={item.id} type="button" title={item.description} aria-pressed={preset === item.id} disabled={busy || mode === 'direct'} onClick={() => setPreset(item.id)}>{item.label}</button>)}
            </div>
          </div>
          <div className="mr-control-group mr-launch-workspace"><label className="mr-control-label" htmlFor="mr-launch-workspace">工作区（绝对路径）</label>
            <input className="mr-input" id="mr-launch-workspace" value={workspace} disabled={busy} placeholder={lastWorkspace ? `留空沿用上次运行：${lastWorkspace}` : '例如 D:\\projects\\demo 或 /home/me/demo'} onChange={event => setWorkspace(event.target.value)} />
          </div>
        </div>
        <p className="mr-caption">{mode === 'direct' ? `指定模型：${directRoute ? `${directRoute.provider}/${directRoute.model}` : '未选择'}（跳过路由，方案不生效）` : mode === 'team' ? '团队分工：按方案拆分工作包，逐个分配模型。' : '单任务：按方案选择一条路线。'}</p>
        <div className="mr-actions">
          <button className="mr-button" type="button" disabled={Boolean(blocked) || busy} onClick={() => { void preview() }}>{phase.kind === 'previewing' ? '正在生成预览…' : '预览执行计划'}</button>
          {blocked && <span className="mr-caption">{blocked}</span>}
        </div>
        {phase.kind === 'previewing' && <p className="mr-empty" role="status">正在按当前模型目录、登录状态和预算生成执行计划…</p>}
        {phase.kind === 'error' && <p className="mr-error" role="alert">{phase.message}</p>}
        {(phase.kind === 'preview' || phase.kind === 'running') && <LaunchPreview value={phase.value} changed={phase.changed} running={phase.kind === 'running'} confirmRef={confirmRef}
          onConfirm={() => { void confirm() }} onCancel={() => setPhase({ kind: 'idle' })} />}
        {phase.kind === 'done' && (
          <div className={phase.value.status === 'failed' || phase.value.status === 'partial' || phase.value.status?.startsWith('paused') ? 'mr-error' : 'mr-empty'} role="status">
            {STATUS_TEXT[phase.value.status] ?? `状态：${phase.value.status}`}{phase.value.runId ? `；结果已记录（运行 ${phase.value.runId.slice(0, 8)}），见下方“执行记录与子任务”。` : '。'}
            {phase.value.budget?.message ? ` ${phase.value.budget.exceeded && phase.value.status !== 'paused-budget' ? '已按你的确认超预算执行：' : ''}${phase.value.budget.message}` : ''}
          </div>
        )}
      </div>
    </section>
  )
}

function LaunchPreview({ value, changed, running, confirmRef, onConfirm, onCancel }) {
  const packages = value.decision?.packages ?? []
  const reasons = value.reasons ?? []
  return (
    <div className="mr-launch-preview" role="region" aria-label="执行预览">
      {changed && <p className="mr-error" role="alert">确认期间情况有变化（例如预算或登录状态），请重新核对下面的确认项。</p>}
      <div className="mr-result-grid">
        <div className="mr-metric"><div className="mr-metric-label">路线</div><div className="mr-metric-value">{value.selected ? `${value.selected.provider}/${value.selected.model}` : '暂无路线'}{value.routingBypassed ? '（指定模型）' : ''}</div></div>
        <div className="mr-metric"><div className="mr-metric-label">预估费用</div><div className="mr-metric-value">{value.estimatedCost === null || value.estimatedCost === undefined ? '价格待配置' : formatUsd(value.estimatedCost)}</div></div>
        <div className="mr-metric"><div className="mr-metric-label">方案</div><div className="mr-metric-value">{ROUTING_PRESETS[value.decision?.preset]?.label ?? '—'}{value.budget?.downgraded ? '（超预算自动降级）' : ''}</div></div>
        <div className="mr-metric"><div className="mr-metric-label">工作区</div><div className="mr-metric-value mr-break"><code>{value.workspace}</code></div></div>
      </div>
      {value.budget?.message && <p className={value.budget.exceeded ? 'mr-error' : 'mr-caption'}>预算检查：{value.budget.message}</p>}
      {packages.length > 0 && (
        <ol className="mr-launch-packages">
          {packages.map(item => <li key={item.id}><strong>{item.name}</strong> → {item.route} <span className="mr-caption">（预估 {formatUsd(item.estimatedCost)}{item.channel === 'official-cli' ? ' · 官方 CLI' : item.channel ? ' · 模型目录 API' : ''}）</span></li>)}
        </ol>
      )}
      {reasons.length > 0
        ? <div className="mr-confirm-box"><p className="mr-section-title">执行前需要确认以下 {reasons.length} 项：</p><ol>{reasons.map(item => <li key={item.code}>{item.zh}</li>)}</ol></div>
        : <p className="mr-caption">无需额外确认：未超预算，也不会不经沙箱启动 CLI。</p>}
      <div className="mr-actions">
        <button ref={confirmRef} className="mr-button" type="button" disabled={running} onClick={onConfirm}>{running ? '正在执行…' : reasons.length ? '全部确认并执行' : '确认执行'}</button>
        <button className="mr-button mr-button-secondary" type="button" disabled={running} onClick={onCancel}>取消</button>
        {running && <span className="mr-caption" role="status" aria-live="polite">模型调用可能需要几分钟，请勿关闭工作台。</span>}
      </div>
    </div>
  )
}
