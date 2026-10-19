import React from 'react'
import { ROUTING_PRESETS } from '../shared/routing-presets.mjs'
import { formatUsd, launchRequest, unwrapRemote } from './insights-state.mjs'

const text = value => typeof value === 'string' ? value.trim() : ''
const STATUS_TEXT = Object.freeze({
  succeeded: '执行完成', completed: '执行完成', partial: '部分步骤失败', failed: '执行失败', cancelled: '已取消',
  'cli-completed': '执行完成', blocked: '执行被阻止', incomplete: '执行未完成', paused: '有步骤等待确认',
  'integration-pending': '执行完成，改动等待整合', pending: '等待执行',
  'paused-budget': '已因预算暂停，未启动模型', 'paused-subscription-failure': '有步骤因订阅调用失败而暂停，请在下方执行记录中选择如何继续',
})

/**
 * 工作台直接执行: task + preset (+ one model) → host preview (plan, cost
 * estimate, budget, every reason that needs confirming) → one confirm → run.
 * Routed runs are read-only; official teams can use an isolated editable
 * worktree. Nothing starts before the user presses the confirm button.
 */
export function RunLauncher({ task, mode, directRoute, budgetUsd, defaultPreset, ledger, previewRun, startRun, onStarted, disabledReason, planningRevision, assignmentMode = 'algorithm', packageAssignments = {}, packagePlanKey }) {
  const [preset, setPreset] = React.useState(defaultPreset || 'balanced')
  const [executor, setExecutor] = React.useState('routed')
  const [executionMode, setExecutionMode] = React.useState('read-only')
  const [executionEnvironment, setExecutionEnvironment] = React.useState('harness')
  const manual = assignmentMode === 'manual' && mode !== 'direct'
  const runExecutor = manual ? 'routed' : executor
  const runMode = manual ? 'read-only' : executionMode
  const runEnvironment = manual ? 'harness' : executionEnvironment
  const runPreset = manual ? defaultPreset || 'balanced' : preset
  const lastWorkspace = [...(ledger?.runs ?? [])].map(run => run.workspace).find(Boolean) ?? ''
  const [workspace, setWorkspace] = React.useState('')
  const [phase, setPhase] = React.useState({ kind: 'idle' })
  const mounted = React.useRef(true)
  const confirmRef = React.useRef(null)
  const pendingRequest = React.useRef(0)
  const inputSignature = JSON.stringify([task, mode, directRoute?.provider, directRoute?.model, budgetUsd, runPreset, workspace, lastWorkspace, planningRevision, disabledReason, runExecutor, runMode, runEnvironment, assignmentMode, packagePlanKey, packageAssignments])
  const latestSignature = React.useRef(inputSignature)
  latestSignature.current = inputSignature
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; pendingRequest.current += 1 } }, [])
  React.useEffect(() => { setPreset(defaultPreset || 'balanced') }, [defaultPreset])
  React.useEffect(() => {
    if (mode !== 'team' || manual) {
      setExecutor('routed')
      setExecutionMode('read-only')
      setExecutionEnvironment('harness')
    }
  }, [mode, manual])
  // Any change to the inputs invalidates a shown preview.
  React.useEffect(() => {
    pendingRequest.current += 1
    setPhase(previous => ['previewing', 'preview', 'error'].includes(previous.kind) ? { kind: 'idle' } : previous)
  }, [inputSignature])
  React.useEffect(() => { if (phase.kind === 'preview') confirmRef.current?.focus() }, [phase.kind])

  const request = () => launchRequest({ task, mode, directRoute, budgetUsd, preset: runPreset, workspace: text(workspace) || lastWorkspace,
    executor: runExecutor, executionMode: runMode, executionEnvironment: runEnvironment,
    assignmentMode: manual ? 'manual' : 'algorithm', packageAssignments, packagePlanKey })
  const unavailable = typeof previewRun !== 'function' || typeof startRun !== 'function'
  const blocked = disabledReason || (unavailable ? '工作台执行服务尚未加载，请更新插件后重试。' : !text(task) ? '先在上方“任务规划”中描述任务。' : manual && !packagePlanKey ? '请重新生成工作包后再手动分配。' : runExecutor === 'official-team' && mode !== 'team' ? '官方工具协作需要先在上方选择“团队分工”。' : '')
  const busy = phase.kind === 'previewing' || phase.kind === 'running'
  // Reruns update the ledger separately from the original startRun response.
  // Only the launcher's own run may replace its displayed terminal status.
  const recordedRun = phase.kind === 'done' && phase.value.runId
    ? (ledger?.runs ?? []).find(run => run.id === phase.value.runId) : null
  const resultStatus = recordedRun?.status ?? phase.value?.status

  const preview = async () => {
    if (blocked || busy) return
    const current = ++pendingRequest.current
    let snapshot
    try { snapshot = request() } catch (error) { setPhase({ kind: 'error', message: text(error?.message) || '分配设置无效。' }); return }
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
    if (blocked || phase.kind !== 'preview' || phase.signature !== latestSignature.current || phase.value.status === 'blocked') return
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
        <p className="mr-card-copy">使用上方的任务描述与规划模式，先预览执行计划、权限与预估费用，确认后才会启动执行。模型路由执行只读任务；官方工具协作可选择只读检查，或在隔离工作树中使用 CLI 的正常工具编辑文件。</p>
      </div></div>
      <div className="mr-card-body">
        <div className="mr-controls">
          <div className="mr-control-group"><span className="mr-control-label" id="mr-launch-executor">执行方式</span>
            <div className="mr-segment" role="group" aria-labelledby="mr-launch-executor">
              <button type="button" aria-pressed={runExecutor === 'routed'} disabled={busy} onClick={() => { setExecutor('routed'); setExecutionMode('read-only'); setExecutionEnvironment('harness') }}>{manual ? '手动分配（只读）' : '模型路由（只读）'}</button>
              <button type="button" aria-pressed={runExecutor === 'official-team'} disabled={busy || mode !== 'team' || manual} title={manual ? '手动分配按包执行只读任务' : mode !== 'team' ? '先在上方选择“团队分工”' : '由官方 CLI 协作执行工作包'} onClick={() => { if (mode === 'team' && !manual) setExecutor('official-team') }}>官方工具协作</button>
            </div>
          </div>
          {runExecutor === 'official-team' && <div className="mr-control-group"><span className="mr-control-label" id="mr-launch-permission">任务权限</span>
            <div className="mr-segment" role="group" aria-labelledby="mr-launch-permission">
              <button type="button" aria-pressed={executionMode === 'read-only'} disabled={busy} onClick={() => { setExecutionMode('read-only'); setExecutionEnvironment('harness') }}>只读检查</button>
              <button type="button" aria-pressed={executionMode === 'workspace-write'} disabled={busy} onClick={() => setExecutionMode('workspace-write')}>编辑文件</button>
            </div>
          </div>}
          {runExecutor === 'official-team' && executionMode === 'workspace-write' && <div className="mr-control-group"><span className="mr-control-label" id="mr-launch-environment">执行环境</span>
            <div className="mr-segment" role="group" aria-labelledby="mr-launch-environment">
              <button type="button" aria-pressed={executionEnvironment === 'harness'} disabled={busy} onClick={() => setExecutionEnvironment('harness')}>Harness 受限环境</button>
              <button type="button" aria-pressed={executionEnvironment === 'cli-native'} disabled={busy} onClick={() => setExecutionEnvironment('cli-native')}>厂商 CLI 正常环境</button>
            </div>
          </div>}
          <div className="mr-control-group"><span className="mr-control-label" id="mr-launch-preset">路由方案</span>
            <div className="mr-segment" role="group" aria-labelledby="mr-launch-preset">
              {Object.values(ROUTING_PRESETS).map(item => <button key={item.id} type="button" title={manual ? '手动分配沿用当前建议的方案；更改方案后请重新生成建议。' : item.description} aria-pressed={runPreset === item.id} disabled={busy || mode === 'direct' || manual} onClick={() => setPreset(item.id)}>{item.label}</button>)}
            </div>
          </div>
          <div className="mr-control-group mr-launch-workspace"><label className="mr-control-label" htmlFor="mr-launch-workspace">工作区（绝对路径）</label>
            <input className="mr-input" id="mr-launch-workspace" value={workspace} disabled={busy} placeholder={lastWorkspace ? `留空沿用上次运行：${lastWorkspace}` : '例如 D:\\projects\\demo 或 /home/me/demo'} onChange={event => setWorkspace(event.target.value)} />
          </div>
        </div>
        <p className="mr-caption">{manual ? '手动分配按包执行只读任务，可混合模型 API 与官方工具；工具使用默认模型。所选目标、就绪状态和费用以执行预览为准。' : executor === 'official-team'
          ? `${executionMode === 'workspace-write' ? '编辑文件：各工作包在独立 Git 工作树中使用 CLI 正常工具，完成后整合回所选工作区。' : '只读检查：各工作包使用受限工具集，不修改工作区文件；Claude 禁用 shell、技能及既有 MCP，并忽略用户设置。'}失败时不会自动替换为模型目录 API。已登录不代表当前任务权限已就绪，预览会检查可用工具。`
          : mode === 'direct' ? `指定模型：${directRoute ? `${directRoute.provider}/${directRoute.model}` : '未选择'}（跳过路由，方案不生效）` : mode === 'team' ? '团队分工：按依赖执行只读工作包，每步使用可用的官方 CLI 或模型目录 API。' : '单任务：按方案选择一条路线。'}</p>
        {mode !== 'team' && !manual && <p className="mr-caption">使用官方工具协作前，先在上方选择“团队分工”。</p>}
        {runEnvironment === 'cli-native' && <p className="mr-caption">厂商 CLI 使用原登录、配置、技能及 MCP，以当前用户权限运行，不经过 Harness 进程沙箱。独立 Git 工作树用于收集改动，不是操作系统读写边界；不会自动切换到此环境。</p>}
        <div className="mr-actions">
          <button className="mr-button" type="button" disabled={Boolean(blocked) || busy} onClick={() => { void preview() }}>{phase.kind === 'previewing' ? '正在生成预览…' : '预览执行计划'}</button>
          {blocked && <span className="mr-caption">{blocked}</span>}
        </div>
        {phase.kind === 'previewing' && <p className="mr-empty" role="status">正在按当前模型目录、登录状态和预算生成执行计划…</p>}
        {phase.kind === 'error' && <p className="mr-error" role="alert">{phase.message}</p>}
        {((phase.kind === 'preview' && phase.signature === inputSignature) || phase.kind === 'running') && <LaunchPreview value={phase.value} request={phase.request} changed={phase.changed} running={phase.kind === 'running'} confirmRef={confirmRef}
          onConfirm={() => { void confirm() }} onCancel={() => setPhase({ kind: 'idle' })} />}
        {phase.kind === 'done' && (
          <div className={['failed', 'partial', 'blocked', 'incomplete'].includes(resultStatus) || resultStatus?.startsWith('paused') ? 'mr-error' : 'mr-empty'} role="status">
            {STATUS_TEXT[resultStatus] ?? `状态：${resultStatus}`}{phase.value.runId ? `；结果已记录（运行 ${phase.value.runId.slice(0, 8)}），见下方“执行记录与子任务”。` : '。'}
            {phase.value.budget?.message ? ` ${phase.value.budget.exceeded && resultStatus !== 'paused-budget' ? '已按你的确认超预算执行：' : ''}${phase.value.budget.message}` : ''}
          </div>
        )}
      </div>
    </section>
  )
}

const reasonText = value => typeof value === 'string' ? text(value) : text(value?.zh) || text(value?.message) || text(value?.reason) || text(value?.code)

function LaunchPreview({ value, request, changed, running, confirmRef, onConfirm, onCancel }) {
  const packages = value.decision?.packages ?? []
  const reasons = value.reasons ?? []
  const officialTeam = (value.executor ?? request?.executor) === 'official-team'
  const native = (value.executionEnvironment ?? request?.executionEnvironment) === 'cli-native'
  const readOnly = value.readOnly !== false && (value.executionMode ?? request?.executionMode) !== 'workspace-write'
  const blocked = value.status === 'blocked'
  const manual = request?.assignmentMode === 'manual' || value.assignmentMode === 'manual'
  const blocking = [...new Set([value.reason, ...(Array.isArray(value.blocking) ? value.blocking : [value.blocking])].map(reasonText).filter(Boolean))]
  return (
    <div className="mr-launch-preview" role="region" aria-label="执行预览">
      {changed && <p className="mr-error" role="alert">确认期间情况有变化（例如预算或登录状态），请重新核对下面的确认项。</p>}
      {blocked && <div className="mr-error" role="alert"><strong>当前无法启动执行。</strong>{blocking.length ? <ul>{blocking.map(message => <li key={message}>{message}</li>)}</ul> : <p>执行条件尚未满足，请检查所选权限、工作区和官方工具状态后重新预览。</p>}</div>}
      <div className="mr-result-grid">
        <div className="mr-metric"><div className="mr-metric-label">{officialTeam || manual ? '执行方式' : '路线'}</div><div className="mr-metric-value">{manual ? '手动分配 · 按包只读执行' : officialTeam ? '官方工具协作' : value.selected ? `${value.selected.provider}/${value.selected.model}` : '暂无路线'}{value.routingBypassed ? '（指定模型）' : ''}</div></div>
        <div className="mr-metric"><div className="mr-metric-label">预估费用</div><div className="mr-metric-value">{value.estimatedCost === null || value.estimatedCost === undefined ? '价格待配置' : formatUsd(value.estimatedCost)}</div></div>
        <div className="mr-metric"><div className="mr-metric-label">方案</div><div className="mr-metric-value">{ROUTING_PRESETS[value.decision?.preset]?.label ?? '—'}{value.budget?.downgraded ? '（超预算自动降级）' : ''}</div></div>
        <div className="mr-metric"><div className="mr-metric-label">工作区</div><div className="mr-metric-value mr-break"><code>{value.workspace}</code></div></div>
      </div>
      {officialTeam && <p className="mr-caption">任务权限：{readOnly ? '只读检查，不修改工作区文件。使用受限工具集；Claude 禁用 shell、技能及既有 MCP，并忽略用户设置。' : <>编辑文件。编辑范围：所选工作区 <code>{value.workspace}</code> 内的任务文件。官方 CLI 使用自己的正常工具，在独立 Git 工作树中完成后整合回该工作区。</>}失败时不会自动替换为模型目录 API。</p>}
      {native && <p className="mr-caption">执行环境：厂商 CLI 正常环境，以当前用户权限运行，不经 Harness 进程沙箱。工作树不限制工具访问工作树外资源。</p>}
      {!officialTeam && !readOnly && <p className="mr-caption">编辑范围：所选工作区 <code>{value.workspace}</code> 内的任务文件；在独立 Git 工作树中完成后整合回该工作区。不会自动回退模型目录 API。</p>}
      {value.budget?.message && <p className={value.budget.exceeded ? 'mr-error' : 'mr-caption'}>预算检查：{value.budget.message}</p>}
      {packages.length > 0 && (
        <ol className="mr-launch-packages">
          {packages.map(item => {
            const tool = item.manualAssignment?.kind === 'tool'
            return <li key={item.id}><strong>{item.name}</strong>{(manual || item.selectionSource === 'manual') && <span className="mr-pill">手动</span>} → {tool ? `${item.toolLabel || item.toolId || item.manualAssignment.toolId} · 默认模型` : item.route || item.toolLabel || item.toolId || item.tool || '待分配路线'} <span className="mr-caption">（预估 {tool ? '费用未知' : item.estimatedCost === null || item.estimatedCost === undefined ? '价格待配置' : formatUsd(item.estimatedCost)}{item.channel === 'official-cli' ? ' · 官方 CLI' : item.channel ? ' · 模型目录 API' : ''}）</span>{item.channelDetail && <p className="mr-caption">{item.channelDetail}</p>}</li>
          })}
        </ol>
      )}
      {reasons.length > 0
        ? <div className="mr-confirm-box"><p className="mr-section-title">执行前需要确认以下 {reasons.length} 项：</p><ol>{reasons.map(item => <li key={item.code}>{reasonText(item)}</li>)}</ol></div>
        : <p className="mr-caption">当前没有额外确认项。{value.estimatedCost === null || value.estimatedCost === undefined ? '费用未知，无法确认本次费用是否在预算内。' : value.budget?.limited && value.budget?.estimateKnown && !value.budget?.exceeded ? '按已提供单价估算，本次未超出预算；实际费用以执行记录和账单为准。' : '实际费用以执行记录和账单为准。'}</p>}
      <div className="mr-actions">
        <button ref={confirmRef} className="mr-button" type="button" disabled={running || blocked} onClick={onConfirm}>{running ? '正在执行…' : reasons.length ? '全部确认并执行' : '确认执行'}</button>
        <button className="mr-button mr-button-secondary" type="button" disabled={running} onClick={onCancel}>取消</button>
        {running && <span className="mr-caption" role="status" aria-live="polite">模型调用可能需要几分钟，请勿关闭工作台。</span>}
      </div>
    </div>
  )
}
