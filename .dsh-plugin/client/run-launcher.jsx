import React from 'react'
import { ROUTING_PRESETS } from '../shared/routing-presets.mjs'
import { apiPlanEstimate, formatUsd, launchRequest, packageAccounting, packageEstimateText, subscriptionEstimateText, unwrapRemote } from './insights-state.mjs'

const text = value => typeof value === 'string' ? value.trim() : ''
const STATUS_TEXT = Object.freeze({
  succeeded: '执行完成', completed: '执行完成', partial: '部分步骤失败', failed: '执行失败', cancelled: '已取消',
  'cli-completed': '执行完成', blocked: '执行被阻止', incomplete: '执行未完成', paused: '有步骤等待确认',
  'integration-pending': '执行完成，改动等待整合', pending: '等待执行',
  'paused-budget': '已因预算暂停，未启动模型', 'paused-subscription-failure': '有步骤因订阅调用失败而暂停，请在下方执行记录中选择如何继续',
})
const LIVE_STATUSES = new Set(['running', 'cancelling'])
const JOB_STATUSES = new Set([...LIVE_STATUSES, 'completed', 'cancelled', 'failed'])
const PACKAGE_STATUS_TEXT = Object.freeze({ pending: '等待执行', running: '正在执行', succeeded: '已完成', failed: '执行失败', cancelled: '已取消', blocked: '依赖未完成', skipped: '已跳过' })
const STAGE_TEXT = Object.freeze({ starting: '正在启动任务…', preparing: '正在准备执行计划…', executing: '正在安排工作包…',
  integrating: '正在整合工作包结果…', reviewing: '正在检查执行结果…', saving: '正在保存执行记录…' })
const ACTIVE_JOB_KEY = 'dsh-model-router:active-run-job'
const isJobSnapshot = value => Boolean(text(value?.jobId) && JOB_STATUSES.has(value.status))
const REMOTE_WAIT_MS = 15_000
// Only retryable reads/cancel requests use this deadline. Aborting their HTTP
// wait does not cancel a Host job, and startRun must never be replayed on timeout.
async function waitForRemote(operation, controllers) {
  const controller = new AbortController()
  controllers.add(controller)
  let timer
  try {
    return await new Promise((resolve, reject) => {
      controller.signal.onabort = () => { clearTimeout(timer); reject(new Error('工作台请求等待超时，请在连接恢复后重试。')) }
      timer = setTimeout(() => controller.abort(), REMOTE_WAIT_MS)
      Promise.resolve(operation(controller.signal)).then(resolve, reject)
    })
  } finally {
    clearTimeout(timer)
    controller.signal.onabort = null
    controllers.delete(controller)
  }
}
// The browser retains only this opaque ID. Task text, configuration, and
// answers remain in Host memory/the existing ledger.
function savedJob() {
  try { return typeof sessionStorage === 'undefined' ? '' : text(sessionStorage.getItem(ACTIVE_JOB_KEY)) } catch { return '' }
}
function rememberJob(jobId) {
  try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(ACTIVE_JOB_KEY, jobId) } catch { /* storage may be disabled */ }
}
function forgetJob(jobId) {
  try { if (typeof sessionStorage !== 'undefined' && savedJob() === jobId) sessionStorage.removeItem(ACTIVE_JOB_KEY) } catch { /* storage may be disabled */ }
}
const unknownJob = error => /unknown run job id\.?/i.test(text(error?.message))
// A launch ACK may outlive its panel. Keep only an opaque in-memory identity
// until it arrives, so a replacement panel can wait and take over the job.
let pendingLaunch = null
const launchListeners = new Set()
function notifyLaunch(event) {
  for (const listener of launchListeners) listener(event)
}
function settleLaunch(identity, value, error) {
  if (pendingLaunch !== identity) return
  pendingLaunch = null
  if (isJobSnapshot(value) && LIVE_STATUSES.has(value.status)) rememberJob(value.jobId)
  notifyLaunch({ kind: 'settled', identity, value, error })
}

/**
 * 工作台直接执行: task + preset (+ one model) → host preview (plan, cost
 * estimate, budget, every reason that needs confirming) → one confirm → run.
 * Routed runs are read-only; official teams can use an isolated editable
 * worktree. Nothing starts before the user presses the confirm button.
 */
export function RunLauncher({ task, mode, directRoute, budgetUsd, defaultPreset, ledger, previewRun, startRun, runStatus, cancelRun, onStarted, disabledReason, planningRevision, assignmentMode = 'algorithm', packageAssignments = {}, packagePlanKey }) {
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
  const currentPhase = React.useRef(phase)
  currentPhase.current = phase
  const [now, setNow] = React.useState(Date.now)
  const mounted = React.useRef(true)
  const confirmRef = React.useRef(null)
  const pendingRequest = React.useRef(0)
  // This identity is independent of the editable form and preview revision.
  const activeRun = React.useRef(null)
  const launchSequence = React.useRef(0)
  const launching = React.useRef(false)
  const awaitingLaunch = React.useRef(null)
  const pendingRemotes = React.useRef(new Set())
  const onFinished = React.useRef(onStarted)
  onFinished.current = onStarted
  const inputSignature = JSON.stringify([task, mode, directRoute?.provider, directRoute?.model, budgetUsd, runPreset, workspace, lastWorkspace, planningRevision, disabledReason, runExecutor, runMode, runEnvironment, assignmentMode, packagePlanKey, packageAssignments])
  const latestSignature = React.useRef(inputSignature)
  latestSignature.current = inputSignature
  React.useEffect(() => {
    mounted.current = true
    const resume = (jobId, snapshot) => {
      activeRun.current = { token: ++launchSequence.current, jobId, terminal: false, cancelRequested: false,
        cancelPending: false, requestSequence: 0, appliedSequence: 0, restoring: true }
      launching.current = true
      setPhase({ kind: 'running', job: snapshot ?? { jobId, status: 'running' }, restoring: !snapshot })
    }
    const receiveLaunch = event => {
      if (!mounted.current) return
      if (event.kind === 'pending') {
        if (activeRun.current?.launchIdentity === event.identity || (activeRun.current?.jobId && !activeRun.current.terminal)) return
        awaitingLaunch.current = event.identity
        pendingRequest.current += 1
        launching.current = true
        setPhase({ kind: 'starting' })
        return
      }
      if (awaitingLaunch.current !== event.identity) return
      awaitingLaunch.current = null
      const value = event.value
      if (isJobSnapshot(value) && LIVE_STATUSES.has(value.status)) {
        resume(value.jobId, value)
        return
      }
      launching.current = false
      if (event.error || value?.status === 'needs-confirmation') {
        setPhase({ kind: 'error', message: event.error || '启动前的确认项已变化，请重新预览并确认执行。' })
        return
      }
      const result = isJobSnapshot(value) ? value.result ?? { status: value.status } : value
      if (isJobSnapshot(value)) forgetJob(value.jobId)
      setPhase({ kind: 'done', value: result })
      onFinished.current?.(result.runId)
    }
    launchListeners.add(receiveLaunch)
    if (pendingLaunch) receiveLaunch({ kind: 'pending', identity: pendingLaunch })
    else {
      const jobId = savedJob()
      if (jobId && !activeRun.current) resume(jobId)
    }
    return () => {
      mounted.current = false
      for (const controller of pendingRemotes.current) controller.abort()
      pendingRemotes.current.clear()
      launchListeners.delete(receiveLaunch)
      pendingRequest.current += 1
      activeRun.current = null
    }
  }, [])
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

  const acceptSnapshot = React.useCallback((value, token, sequence, cancelAcknowledged = false) => {
    const active = activeRun.current
    if (!mounted.current || !active || active.token !== token || active.terminal || value.jobId !== active.jobId) return false
    if (!isJobSnapshot(value)) throw new Error('暂时无法读取执行进度。')
    const terminal = !LIVE_STATUSES.has(value.status)
    // A cancellation ACK can overtake a status request. Never regress to the
    // earlier running snapshot, and never replace an accepted terminal state.
    if (!terminal && sequence < active.appliedSequence) {
      if (cancelAcknowledged) {
        active.cancelRequested = true
        setPhase(previous => previous.kind === 'running' ? { ...previous,
          job: { ...previous.job, status: 'cancelling', cancelRequested: true }, cancelPending: false, cancelError: '' } : previous)
        return true
      }
      return false
    }
    active.appliedSequence = Math.max(active.appliedSequence, sequence)
    active.cancelRequested ||= cancelAcknowledged || value.cancelRequested || value.status === 'cancelling'
    const job = { ...value, cancelRequested: Boolean(active.cancelRequested),
      status: !terminal && active.cancelRequested ? 'cancelling' : value.status }
    if (terminal) {
      active.terminal = true
      launching.current = false
      forgetJob(value.jobId)
      const result = value.result ?? { status: value.status }
      setPhase({ kind: 'done', value: result, job })
      onFinished.current?.(result.runId)
    } else {
      rememberJob(value.jobId)
      setPhase(previous => previous.kind === 'running' ? { ...previous, job, restoring: false, pollError: '', cancelError: cancelAcknowledged ? '' : previous.cancelError,
        cancelPending: cancelAcknowledged ? false : previous.cancelPending } : previous)
    }
    return true
  }, [])

  const runningJobId = phase.kind === 'running' ? phase.job?.jobId : null
  React.useEffect(() => {
    if (!runningJobId || typeof runStatus !== 'function') return
    const active = activeRun.current
    if (!active || active.jobId !== runningJobId) return
    let disposed = false, timer
    const poll = async () => {
      if (disposed || activeRun.current !== active || active.terminal) return
      const sequence = ++active.requestSequence
      try {
        const value = unwrapRemote(await waitForRemote(signal => runStatus({ jobId: runningJobId }, signal), pendingRemotes.current), '暂时无法读取执行进度。')
        if (disposed) return
        if (!isJobSnapshot(value) || value.jobId !== runningJobId) throw new Error('暂时无法读取执行进度。')
        acceptSnapshot(value, active.token, sequence)
      } catch (error) {
        if (!disposed && mounted.current && activeRun.current === active && !active.terminal) {
          if (unknownJob(error)) {
            active.terminal = true
            launching.current = false
            forgetJob(runningJobId)
            setPhase({ kind: 'error', message: '无法找到此前的执行，可能已过期或工作台已重新启动。请刷新下方执行记录核对结果。' })
          } else {
            setPhase(previous => previous.kind === 'running' && previous.job?.jobId === runningJobId
              ? { ...previous, restoring: false, pollError: '暂时无法更新执行进度，将自动重试；任务可能仍在执行。' } : previous)
          }
        }
      } finally {
        if (!disposed && activeRun.current === active && !active.terminal) timer = setTimeout(poll, 1000)
      }
    }
    timer = setTimeout(poll, active.restoring ? 0 : 1000)
    active.restoring = false
    return () => { disposed = true; clearTimeout(timer) }
  }, [runningJobId, runStatus, acceptSnapshot])
  React.useEffect(() => {
    if (!runningJobId) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [runningJobId])

  const request = () => launchRequest({ task, mode, directRoute, budgetUsd, preset: runPreset, workspace: text(workspace) || lastWorkspace,
    executor: runExecutor, executionMode: runMode, executionEnvironment: runEnvironment,
    assignmentMode: manual ? 'manual' : 'algorithm', packageAssignments, packagePlanKey })
  const unavailable = typeof previewRun !== 'function' || typeof startRun !== 'function'
  const blocked = disabledReason || (unavailable ? '工作台执行服务尚未加载，请更新插件后重试。' : !text(task) ? '先在上方“任务规划”中描述任务。' : manual && !packagePlanKey ? '请重新生成工作包后再手动分配。' : runExecutor === 'official-team' && mode !== 'team' ? '官方工具协作需要先在上方选择“团队分工”。' : '')
  const busy = phase.kind === 'previewing' || phase.kind === 'running' || phase.kind === 'starting'
  // Reruns update the ledger separately from the original startRun response.
  // Only the launcher's own run may replace its displayed terminal status.
  const recordedRun = phase.kind === 'done' && phase.value.runId
    ? (ledger?.runs ?? []).find(run => run.id === phase.value.runId) : null
  const resultStatus = recordedRun?.status ?? phase.value?.status

  const preview = async () => {
    if (blocked || busy || launching.current || pendingLaunch) return
    const current = ++pendingRequest.current
    let snapshot
    try { snapshot = request() } catch (error) { setPhase({ kind: 'error', message: text(error?.message) || '分配设置无效。' }); return }
    const signature = inputSignature
    setPhase({ kind: 'previewing' })
    try {
      const value = unwrapRemote(await waitForRemote(signal => previewRun(snapshot, signal), pendingRemotes.current), '执行预览失败。')
      if (mounted.current && current === pendingRequest.current && signature === latestSignature.current) setPhase({ kind: 'preview', value, request: snapshot, signature })
    } catch (error) {
      if (mounted.current && current === pendingRequest.current && signature === latestSignature.current) setPhase({ kind: 'error', message: text(error?.message) || '执行预览失败。' })
    }
  }
  const confirm = async () => {
    if (launching.current || pendingLaunch || currentPhase.current !== phase || blocked || phase.kind !== 'preview' || phase.signature !== latestSignature.current || phase.value.status === 'blocked') return
    const shown = phase.value
    const snapshot = phase.request
    const signature = phase.signature
    launching.current = true
    const identity = Symbol('launch')
    const active = { token: ++launchSequence.current, launchIdentity: identity, jobId: null, terminal: false, cancelRequested: false,
      cancelPending: false, requestSequence: 0, appliedSequence: 0 }
    activeRun.current = active
    pendingLaunch = identity
    notifyLaunch({ kind: 'pending', identity })
    setPhase({ kind: 'running', value: shown, request: snapshot, signature })
    try {
      const value = unwrapRemote(await startRun({ ...snapshot, confirmedReasons: (shown.reasons ?? []).map(item => item.code) }), '执行失败。')
      settleLaunch(identity, value)
      if (!mounted.current) return
      if (activeRun.current !== active) return
      if (isJobSnapshot(value)) {
        active.jobId = value.jobId
        acceptSnapshot(value, active.token, ++active.requestSequence)
        return
      }
      active.terminal = true
      launching.current = false
      if (value.status === 'needs-confirmation') {
        setPhase(signature === latestSignature.current ? { kind: 'preview', value, request: snapshot, signature, changed: true } : { kind: 'idle' })
        return
      }
      setPhase({ kind: 'done', value })
      onStarted?.(value.runId)
    } catch (error) {
      settleLaunch(identity, null, text(error?.message) || '执行失败。')
      if (mounted.current && activeRun.current === active) {
        active.terminal = true
        launching.current = false
        setPhase({ kind: 'error', message: text(error?.message) || '执行失败。' })
      }
    }
  }

  const cancel = async () => {
    const active = activeRun.current
    if (!active?.jobId || active.terminal || active.cancelPending || active.cancelRequested || typeof cancelRun !== 'function') return
    active.cancelPending = true
    const sequence = ++active.requestSequence
    setPhase(previous => previous.kind === 'running' ? { ...previous, cancelPending: true, cancelError: '' } : previous)
    try {
      const value = unwrapRemote(await waitForRemote(signal => cancelRun({ jobId: active.jobId }, signal), pendingRemotes.current), '取消请求未确认。')
      if (!isJobSnapshot(value) || value.jobId !== active.jobId) throw new Error('取消请求未确认。')
      acceptSnapshot(value, active.token, sequence, true)
    } catch {
      if (mounted.current && activeRun.current === active && !active.terminal) {
        setPhase(previous => previous.kind === 'running' ? { ...previous, cancelPending: false,
          cancelError: '取消请求未确认，任务可能仍在执行。请重试取消。' } : previous)
      }
    } finally { active.cancelPending = false }
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
        {phase.kind === 'starting' && <p className="mr-empty" role="status">正在等待已确认任务的启动结果，请稍候…</p>}
        {phase.kind === 'error' && <p className="mr-error" role="alert">{phase.message}</p>}
        {((phase.kind === 'preview' && phase.signature === inputSignature) || (phase.kind === 'running' && !phase.job)) && <LaunchPreview value={phase.value} request={phase.request} changed={phase.changed} running={phase.kind === 'running'} confirmRef={confirmRef}
          onConfirm={() => { void confirm() }} onCancel={() => { if (!launching.current) setPhase({ kind: 'idle' }) }} />}
        {phase.kind === 'running' && phase.job && <RunProgress job={phase.job} now={now} restoring={phase.restoring} cancelPending={phase.cancelPending}
          pollError={phase.pollError || (typeof runStatus !== 'function' ? '当前无法更新执行进度，任务可能仍在执行。请更新插件后查看执行记录。' : '')}
          cancelError={phase.cancelError} canCancel={typeof cancelRun === 'function'} onCancel={() => { void cancel() }} />}
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
  const estimate = apiPlanEstimate(value)
  const subscriptionEstimate = subscriptionEstimateText(value)
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
        <div className="mr-metric"><div className="mr-metric-label">API 预估费用</div><div className="mr-metric-value">{estimate === null ? '价格待配置' : formatUsd(estimate)}</div></div>
        <div className="mr-metric"><div className="mr-metric-label">方案</div><div className="mr-metric-value">{ROUTING_PRESETS[value.decision?.preset]?.label ?? '—'}{value.budget?.downgraded ? '（超预算自动降级）' : ''}</div></div>
        <div className="mr-metric"><div className="mr-metric-label">工作区</div><div className="mr-metric-value mr-break"><code>{value.workspace}</code></div></div>
      </div>
      {subscriptionEstimate && <p className="mr-caption">{subscriptionEstimate} 若改用 API，将重新估价并核验预算。</p>}
      {officialTeam && <p className="mr-caption">任务权限：{readOnly ? '只读检查，不修改工作区文件。使用受限工具集；Claude 禁用 shell、技能及既有 MCP，并忽略用户设置。' : <>编辑文件。编辑范围：所选工作区 <code>{value.workspace}</code> 内的任务文件。官方 CLI 使用自己的正常工具，在独立 Git 工作树中完成后整合回该工作区。</>}失败时不会自动替换为模型目录 API。</p>}
      {native && <p className="mr-caption">执行环境：厂商 CLI 正常环境，以当前用户权限运行，不经 Harness 进程沙箱。工作树不限制工具访问工作树外资源。</p>}
      {!officialTeam && !readOnly && <p className="mr-caption">编辑范围：所选工作区 <code>{value.workspace}</code> 内的任务文件；在独立 Git 工作树中完成后整合回该工作区。不会自动回退模型目录 API。</p>}
      {value.budget?.message && <p className={value.budget.exceeded ? 'mr-error' : 'mr-caption'}>预算检查：{value.budget.message}</p>}
      {packages.length > 0 && (
        <ol className="mr-launch-packages">
          {packages.map(item => {
            const tool = item.manualAssignment?.kind === 'tool'
            return <li key={item.id}><strong>{item.name}</strong>{(manual || item.selectionSource === 'manual') && <span className="mr-pill">手动</span>} → {tool ? `${item.toolLabel || item.toolId || item.manualAssignment.toolId} · 默认模型` : item.route || item.toolLabel || item.toolId || item.tool || '待分配路线'} <span className="mr-caption">（{packageAccounting(value, item.id) ? packageEstimateText(value, item) : `预估 ${tool ? '费用未知' : item.estimatedCost === null || item.estimatedCost === undefined ? '价格待配置' : formatUsd(item.estimatedCost)}`}{item.channel === 'official-cli' ? ' · 官方 CLI' : item.channel ? ' · 模型目录 API' : ''}）</span>{item.channelDetail && <p className="mr-caption">{item.channelDetail}</p>}</li>
          })}
        </ol>
      )}
      {reasons.length > 0
        ? <div className="mr-confirm-box"><p className="mr-section-title">执行前需要确认以下 {reasons.length} 项：</p><ol>{reasons.map(item => <li key={item.code}>{reasonText(item)}</li>)}</ol></div>
        : <p className="mr-caption">当前没有额外确认项。{estimate === null ? '费用未知，无法确认本次费用是否在预算内。' : value.budget?.limited && value.budget?.estimateKnown && !value.budget?.exceeded ? '按已提供单价估算，API 部分未超出预算；API 实际费用以执行记录和账单为准。' : 'API 实际费用以执行记录和账单为准，订阅仅记录用量。'}</p>}
      <div className="mr-actions">
        <button ref={confirmRef} className="mr-button" type="button" disabled={running || blocked} onClick={onConfirm}>{running ? '正在执行…' : reasons.length ? '全部确认并执行' : '确认执行'}</button>
        <button className="mr-button mr-button-secondary" type="button" disabled={running} onClick={onCancel}>取消</button>
        {running && <span className="mr-caption" role="status" aria-live="polite">正在启动执行，请稍候…</span>}
      </div>
    </div>
  )
}

function RunProgress({ job, now, restoring, pollError, cancelError, cancelPending, canCancel, onCancel }) {
  const progress = job.progress ?? {}
  const packages = Array.isArray(progress.packages) ? progress.packages : []
  const startedAt = typeof job.startedAt === 'number' ? job.startedAt : Date.parse(job.startedAt)
  const seconds = Number.isFinite(startedAt) ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
  const elapsed = Number.isFinite(startedAt) ? `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒` : '待更新'
  const cancelling = job.cancelRequested || job.status === 'cancelling'
  return <div className="mr-launch-preview mr-run-progress" role="region" aria-label="执行进度">
    <div className="mr-run-progress-head"><strong role="status">{cancelling ? '正在取消…' : restoring ? '正在恢复执行进度…' : '正在执行…'}</strong>
      <span className="mr-caption">已耗时 {elapsed}</span></div>
    {job.progress && <><p className="mr-caption">已处理 {progress.completed ?? 0} / {progress.total ?? packages.length} 个工作包</p>
      <progress className="mr-run-meter" aria-label="工作包完成进度" value={progress.completed ?? 0} max={Math.max(1, progress.total ?? packages.length)} /></>}
    <p className="mr-caption" aria-live="polite">{progress.current ? `当前工作包：${progress.current.name || progress.current.id}` : cancelling ? '正在结束当前执行并保留已完成结果。' : STAGE_TEXT[progress.stage] ?? '正在读取执行进度…'}</p>
    {packages.length > 0 && <ol className="mr-run-packages">{packages.map(item => <li key={item.id}>
      <span>{item.name || item.id}</span><span className={`mr-pill mr-run-package-${item.status}`}>{PACKAGE_STATUS_TEXT[item.status] ?? '等待更新'}</span>
    </li>)}</ol>}
    {pollError && <p className="mr-error" role="status">{pollError}</p>}
    {cancelError && <p className="mr-error" role="alert">{cancelError}</p>}
    <div className="mr-actions"><button className="mr-button mr-button-secondary" type="button"
      disabled={!canCancel || cancelPending || cancelling} onClick={onCancel}>{cancelPending ? '正在请求取消…' : cancelling ? '正在取消…' : '取消执行'}</button>
      {cancelling && <span className="mr-caption">取消已请求，等待执行结束；已完成结果会保留在执行记录中。</span>}
      {!canCancel && <span className="mr-caption">当前工作台暂不支持取消，请更新插件。</span>}
    </div>
  </div>
}
