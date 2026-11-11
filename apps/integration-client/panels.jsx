import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { PRODUCT_PANELS, TASK_STATES, modelName, money } from './api.mjs'
import { TaskWorkspace } from './tasks-panel.jsx'
import { normalizeEndpoint, parsePairingPaste, secretNameFor } from './pairing.mjs'
import { framePoint } from '../../packages/orchestration/src/desktop-contract.mjs'
import { BotBindingEditor } from './binding-editor.jsx'
import { LibraryPanel } from './library-panel.jsx'
import { SecurePairingSetup } from './secure-pairing.jsx'
import { UsageExplorer } from './usage-explorer.jsx'
import { DesktopWorkbench } from './desktop-pane.jsx'
import { RoutinesPanel } from './routines-panel.jsx'
import { UiIcon } from './ui-icons.jsx'
import { NotificationsPanel } from './notifications-panel.jsx'
import { DataPanel } from './data-panel.jsx'
import { BotThreadsPanel } from './bot-threads-panel.jsx'
import { WebPanelsPanel } from './web-panel-page.jsx'
import { BotConversationLink } from './independent-chat-entry.jsx'
import { openIndependentChat } from './independent-chat-navigation.mjs'
import { requestWorkbenchView } from '../../.dsh-plugin/client/workbench-state.mjs'
import { routingSubmissions, submissionCode } from './routing-submissions.mjs'
import { WORKSPACE_SECTIONS, workspaceNavigation } from './workspace-navigation.mjs'
import { TeamDirectory, WorkspaceCommandPalette, WorkspaceHome, WorkspaceInbox, WorkspaceToolbar } from './workspace-ui.jsx'

const NAV_EVENT = 'bot-product:navigation'
let activePanel = null
const announcePanel = (id, clear = false) => {
  if (clear) { if (activePanel === id) activePanel = null }
  else activePanel = id
  document.dispatchEvent(new document.defaultView.CustomEvent(NAV_EVENT, { detail: { id: activePanel } }))
}

export function ProductNavigation({ openPanel, panels, compact = false, onSearch }) {
  const [active, setActive] = useState(() => activePanel)
  useEffect(() => {
    const change = event => setActive(event.detail.id)
    document.addEventListener(NAV_EVENT, change)
    setActive(activePanel)
    return () => document.removeEventListener(NAV_EVENT, change)
  }, [])
  return <nav className={`bp-nav${compact ? ' bp-nav-compact' : ''}`} aria-label="Bot 工作系统">
    <button type="button" className="bp-nav-search" aria-label="搜索工作空间" onClick={() => onSearch ? onSearch() : openPanel(panels.home)} title="搜索工作空间"><UiIcon name="search" size={17} /><span className="bp-nav-name">搜索工作空间</span><span className="bp-nav-caption">查找</span></button>
    {['工作', '资源', '管理'].map(group => <div className="bp-nav-group" key={group}><p className="bp-nav-label">{group}</p>{WORKSPACE_SECTIONS.filter(row => row.group === group).map(({ section, label, icon }) => <button key={section} type="button" aria-current={active === panels[section] ? 'page' : undefined}
      onClick={() => { announcePanel(panels[section]); openPanel(panels[section]) }} title={label} aria-label={label}>
      <UiIcon name={icon} size={17} /><span className="bp-nav-name">{label}</span><span className="bp-nav-caption">{label.slice(0, 2)}</span>
    </button>)}{group === '管理' && <button type="button" aria-current={active === 'model-router-galgame' ? 'page' : undefined} onClick={() => { announcePanel('model-router-galgame'); openPanel('model-router-galgame') }} title="高级工作台" aria-label="高级工作台"><UiIcon name="settings" size={17} /><span className="bp-nav-name">高级工作台</span><span className="bp-nav-caption">路由</span></button>}</div>)}
  </nav>
}

export function Blocked({ value }) {
  return <aside className="bp-blocked" role="status"><strong>暂不可用</strong><p>{value?.reason ?? '尚未取得宿主状态。'}</p>
    {value?.nextAction && <p className="bp-muted">下一步：{value.nextAction}</p>}</aside>
}
const Value = ({ label, children }) => <div className="bp-value"><dt>{label}</dt><dd>{children ?? '未配置'}</dd></div>
const Tag = ({ children }) => <span className="bp-tag">{children}</span>
const subscriptionText = value => value && typeof value === 'object'
  ? `今日 ${value.callsToday ?? '未知'} 次 · 本月 ${value.callsMonth ?? '未知'} 次`
  : value ?? '见逐来源收据'

export 
/**
 * 运行时: which path serves this Bot. Only rendered when the Host exposes the switch, so an older
 * Host shows nothing instead of a dead control.
 */
function BotRuntimeRow({ botId, dispatch, busy, onOpenChat }) {
  const [state, setState] = React.useState(null), [error, setError] = React.useState(''), [working, setWorking] = React.useState(false)
  const generation = React.useRef(0)
  const load = React.useCallback(async () => {
    const mine = ++generation.current
    try {
      const rows = await dispatch('botRuntimeStatus', {})
      if (mine !== generation.current) return
      if (!Array.isArray(rows)) throw new Error('宿主未确认运行时状态。')
      const row = rows.find(item => item.botId === botId)
      const mode = row ? row.mode : 'integration'
      if (!['integration', 'independent'].includes(mode)) throw new Error('未知运行时，已暂停操作。')
      setState({ runtime: mode, changedAt: row?.changedAt ?? null }); setError('')
    } catch (failure) { if (mine === generation.current) { setState(null); setError(String(failure?.message ?? failure)) } }
  }, [botId, dispatch])
  React.useEffect(() => { void load(); return () => { generation.current++ } }, [load])
  const target = state?.runtime === 'independent' ? 'integration' : 'independent'
  const move = async () => {
    setWorking(true)
    try { await dispatch('botRuntimeMove', { botId, mode: target }); await load() }
    catch (failure) { setError(String(failure?.message ?? failure)) }
    finally { setWorking(false) }
  }
  return <div className="bp-runtime">
    <dl className="bp-facts"><Value label="运行时">{state ? state.runtime === 'independent' ? '独立循环 + 独立会话库' : 'Harness 会话集成' : '等待宿主确认'}</Value><Value label="切换时间">{state?.changedAt ? new Date(state.changedAt).toLocaleString('zh-CN') : '从未切换'}</Value></dl>
    <div className="bp-actions"><button type="button" disabled={!state || busy || working} onClick={() => { void move() }}>{working ? '切换中…' : target === 'independent' ? '迁移到独立运行时' : '迁回 Harness 会话'}</button>{state?.runtime === 'independent' && <button type="button" onClick={() => onOpenChat?.(botId)}>打开独立聊天</button>}</div>
    <p className="bp-muted">Bot 正在对话时不能迁移。独立运行时请打开独立聊天继续发送，完整消息按稳定编号分页读取。迁回后可从“打开私聊”回到此 Bot 的真实原生会话。</p>
    {error && <p className="bp-error" role="alert">{error}</p>}
  </div>
}

let bindingScopeKey = 0
export function BotBindings({ snapshot, openSession, dispatch, busy, focus, scope, onOpenTools, onOpenChatPanel }) {
  const scopeKey = useMemo(() => ++bindingScopeKey, [scope])
  const bots = snapshot.bots ?? []
  const [selected, setSelected] = useState(bots[0]?.id ?? '')
  useEffect(() => { if (focus?.botId && bots.some(row => row.id === focus.botId)) setSelected(focus.botId) }, [focus?.version, focus?.botId])
  const bot = bots.find(row => row.id === selected) ?? bots[0]
  const section = snapshot.botBindings ?? snapshot.bindings
  const binding = section?.items?.find(row => row.botId === bot?.id)
  const capabilities = binding?.tools ?? binding?.capabilities ?? []
  const permissionGroups = [
    ['模型调用', /^model\//], ['模型工作台', /^(?:command\/router|tool\/model_router_)/],
    ['任务管理', /^task\//], ['Bot 协作', /^(?:execution\/bot-turn|tool\/bot_route_task)/],
    ['资料库', /^tool\/bot_library_/], ['例行任务', /^tool\/bot_routine_/], ['远程工具', /^remote\//],
  ].filter(([, pattern]) => capabilities.some(value => pattern.test(value))).map(([label]) => label)
  if (!bots.length) return <p>还没有 Bot。返回 Main 完成首次设置，或从侧栏新建 Bot。</p>
  return <div className="bp-columns bp-team-layout">
    <TeamDirectory snapshot={snapshot} selected={bot?.id} onSelect={setSelected} />
    <article className="bp-card"><div className="bp-card-title"><div className="bp-person-heading"><span className="bp-person-avatar bp-person-avatar-large"><UiIcon name="bot" size={27} /></span><div><h2>{bot.name}</h2><p className="bp-muted">{bot.main ? '团队协调 Bot' : '团队成员'}</p></div></div><BotConversationLink productApi={scope} bot={bot} openSession={openSession} onOpenIndependent={id => openIndependentChat(scope, onOpenChatPanel, id)} available={snapshot.availableActions?.includes('independentChat.view')}/></div>
      {dispatch && (!snapshot.availableActions || snapshot.availableActions.includes('binding.save')) ? <BotBindingEditor key={`${scopeKey}:${bot.id}`} hostScope={scope} bot={bot} record={binding} accounts={snapshot.fundingAccounts} dispatch={dispatch} busy={busy} onOpenTools={onOpenTools} /> : <p className="bp-muted">当前连接可以查看 Bot 配置，暂不支持保存修改。</p>}
      <details className="bp-technical"><summary>当前权限与运行配置</summary><dl className="bp-facts"><Value label="职责">{bot.role || '未填写'}</Value>
        <Value label="宿主已选模型">{modelName(bot.model)}</Value><Value label="最近应用模型">{bot.appliedModel ? modelName(bot.appliedModel) : '宿主尚未报告'}</Value><Value label="模型策略">精确绑定；不可用时暂停并说明原因</Value>
        <Value label="工作区">{binding?.workspace?.root ?? binding?.workspaceRef?.rootId ?? bot.workDir ?? '未指定，请在 Bot 详情选择文件夹'}</Value>
        <Value label="执行位置">{binding?.machineId ?? binding?.workspaceRef?.machineId ?? '尚未取得宿主绑定'}</Value>
        <Value label="最大并发">{binding?.maxConcurrentTasks}</Value></dl>
      {section?.status === 'blocked' ? <Blocked value={section} /> : binding ? <>
        <h3>官方工具</h3>{binding.officialTools?.length ? <ul>{binding.officialTools.map(tool => <li key={tool.toolId}>{tool.toolId} · {tool.cliModel ?? '未核验模型'} · {tool.identityStatus ?? tool.identityPolicy ?? '未知'}</li>)}</ul> : <p className="bp-muted">此 Bot 没有官方工具绑定。</p>}
        <h3>有效权限 <span className="bp-inline-count">{capabilities.length} 项</span></h3><div className="bp-permission-chips">{permissionGroups.map(label => <span key={label}><UiIcon name="check" size={13} />{label}</span>)}{!capabilities.length && <p className="bp-muted">无额外能力</p>}</div>
        {binding.blockedReason && <Blocked value={{ reason: binding.blockedReason, nextAction: binding.nextAction }} />}
      </> : <Blocked value={{ reason: '此 Bot 尚未取得有效绑定。', nextAction: '在宿主 Bot 绑定配置中授予明确工具、机器与工作区。' }} />}
      <p className="bp-muted">角色文本不会授予工具或机器权限。职责、模型、记忆及会话设置沿用私聊右侧的 Bot 详情。</p>
      </details>
      <details className="bp-technical"><summary>连接与运行详情</summary><dl className="bp-facts"><Value label="稳定 Bot ID">{bot.id}</Value><Value label="预算范围">{binding?.budgetScope}</Value></dl><h3>完整权限标识</h3><p className="bp-code">{capabilities.join('、') || '无额外能力'}</p>{snapshot.availableActions?.includes('botRuntimeStatus') && <BotRuntimeRow key={bot.id} botId={bot.id} dispatch={dispatch} busy={busy} onOpenChat={id => openIndependentChat(scope, onOpenChatPanel, id)} />}</details>
    </article>
  </div>
}


/**
 * Bot routing: who should take this task, and why.
 *
 * Preview is read-only. Only an explicit create action can submit the captured, current task.
 * A late response must not revive an edited draft or move a decision to another Host.
 */
const routingPresetLabel = preset => ({ economy: '省钱优先', balanced: '均衡', quality: '效果优先' })[preset] ?? '当前策略'
const routingRefusalMessage = reason => {
  const code = String(reason ?? '').split(':')[0]
  return ({ INVALID_CANDIDATE: '候选信息不完整', BOT_DISABLED: '已停用', MISSING_BOT_ID: '缺少 Bot 标识', BOT_MODEL_UNBOUND: '尚未绑定模型',
    BOT_MACHINE_OFFLINE: '所需电脑未在线', BOT_BUSY: '正在处理其他任务', BOT_MISSING_TOOL: '缺少任务所需工具', BOT_MISSING_CAPABILITY: '缺少任务所需能力',
    BOT_ROUTING_WORKER_CEILING_INSUFFICIENT: '保存的电脑权限不足' })[code] ?? '不满足本次执行条件'
}
const validRoutingView = value => value && typeof value.enabled === 'boolean' && ['economy', 'balanced', 'quality'].includes(value.preset)
  && Array.isArray(value.candidates) && value.candidates.every(row => row && typeof row.botId === 'string' && row.botId !== '')
const submissionFailureMessage = failure => {
  const code = failure?.code
  if (code === 'REMOTE_OWNER_REQUIRED') return '请重新登录宿主拥有者账号后核对原提交；请保留核对码，不要重新创建任务。'
  if (['BOT_ROUTING_STATUS_UNAVAILABLE', 'PRODUCT_ACTION_UNAVAILABLE'].includes(code)) return '当前宿主尚不支持原提交核对，请更新宿主或在任务记录中核对；请保留核对码。'
  if (['BOT_ROUTING_SUBMISSION_IDENTITY_MISMATCH', 'INVALID_ROUTING_SUBMISSION_STATUS'].includes(code)) return '返回记录与原提交身份不一致，尚不能确认结果。请在原宿主核对任务记录并保留核对码。'
  if (code === 'PRODUCT_READ_ONLY') return '宿主目前处于只读状态，请恢复宿主后核对原提交；请保留核对码，不要重新创建任务。'
  return '原提交核对尚未完成，请恢复宿主连接后再次核对；请保留核对码，不会重新提交任务。'
}

function BotRoutingCard({ snapshot, dispatch, busy, submissionScope = dispatch, navigation, focus }) {
  const submissions = useMemo(() => routingSubmissions(submissionScope), [submissionScope])
  const submission = useSyncExternalStore(submissions.subscribe, submissions.getSnapshot, submissions.getSnapshot)
  const [view, setView] = React.useState(null)
  const [error, setError] = React.useState('')
  const [text, setText] = React.useState('')
  const [pin, setPin] = React.useState('')
  const [machine, setMachine] = React.useState('')
  const [root, setRoot] = React.useState('')
  const [effect, setEffect] = React.useState('read')
  const [decision, setDecision] = React.useState(null)
  const [working, setWorking] = React.useState('')
  const [savedCode, setSavedCode] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const codeInput = useRef(null)
  const [viewReady, setViewReady] = React.useState(false)
  const control = useRef({ live: false, epoch: 0, draft: 0, active: null, prepared: null, ready: false })
  const form = useRef({ text: '', pin: '', machine: '', root: '', effect: 'read' })
  const busyRef = useRef(busy)
  const draftFocus = useRef(null)
  const card = useRef(null)
  busyRef.current = busy
  const call = useCallback(async (action, payload) => {
    if (typeof dispatch !== 'function') throw new Error('宿主接口尚未就绪。')
    const value = await dispatch(action, payload, { errorResult: true })
    if (value === undefined || value?.ok === false) throw Object.assign(new Error(value?.error?.message ?? '宿主尚未确认这次请求，请刷新后重试。'), { code: value?.error?.code })
    return value
  }, [dispatch])
  const invalidate = useCallback(() => {
    control.current.draft++; control.current.prepared = null
    setDecision(null)
  }, [])
  const editDraft = changes => {
    const next = { ...form.current, ...changes }
    form.current = next
    if (Object.hasOwn(changes, 'text')) navigation?.saveGoalDraft(next.text)
    setText(next.text); setPin(next.pin); setMachine(next.machine); setRoot(next.root); setEffect(next.effect)
    const previous = submissions.getSnapshot()
    if (previous?.state === 'confirmed') submissions.clear(previous)
    invalidate()
  }
  useEffect(() => {
    draftFocus.current = null
    const restored = navigation?.getGoalDraft() ?? ''
    form.current = { text: restored, pin: '', machine: '', root: '', effect: 'read' }
    setText(restored); setPin(''); setMachine(''); setRoot(''); setEffect('read')
  }, [navigation, submissionScope])
  useEffect(() => {
    if (!focus?.compose || !viewReady || draftFocus.current === focus.version) return
    draftFocus.current = focus.version
    const draft = navigation?.claimDraft(focus.version)
    if (draft !== null && draft !== undefined) editDraft({ text: draft })
    card.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' })
    card.current?.querySelector('textarea')?.focus({ preventScroll: true })
  }, [focus?.version, focus?.compose, viewReady, navigation])
  const begin = useCallback(kind => {
    const state = control.current
    if (!state.live || state.active || busyRef.current) return null
    const token = { epoch: state.epoch }
    state.active = token; setWorking(kind); setError('')
    return token
  }, [])
  const current = token => control.current.live && control.current.epoch === token.epoch && control.current.active === token
  const finish = token => { if (current(token)) { control.current.active = null; setWorking('') } }
  const staleView = () => { control.current.ready = false; setViewReady(false) }
  const load = React.useCallback(async () => {
    const token = begin('inspect')
    if (!token) return
    invalidate(); staleView()
    try {
      const next = await call('botRoutingInspect', {})
      if (!current(token)) return
      if (!validRoutingView(next)) throw new Error('宿主未返回完整候选信息，请刷新后重试。')
      setView(next); control.current.ready = true; setViewReady(true)
    } catch (failure) {
      if (current(token)) setError(String(failure?.message ?? failure))
    } finally { finish(token) }
  }, [call, begin, invalidate])
  useEffect(() => {
    const state = control.current
    state.live = true; state.epoch++; state.active = null; state.ready = false
    setView(null); setViewReady(false); setWorking(''); setSavedCode(''); setCopyStatus(''); setError(''); invalidate()
    void load()
    return () => { state.live = false; state.epoch++; state.draft++; state.active = null; state.prepared = null; state.ready = false }
  }, [load, invalidate])
  useEffect(() => { setCopyStatus('') }, [submissions, submission?.requestKey])
  useEffect(() => {
    if (!busy && !view && control.current.live && !control.current.active) void load()
  }, [busy, view, load])
  const saveSettings = async settings => {
    if (!control.current.ready) return
    const token = begin('settings')
    if (!token) return
    invalidate(); staleView()
    try {
      const value = await call('botRouting.save', { expectedRevision: view.settingsRevision ?? 0, settings })
      if (!current(token)) return
      if (!validRoutingView(value)) throw new Error('设置保存结果尚未确认，请刷新候选核对。')
      setView(value); control.current.ready = true; setViewReady(true)
    } catch (failure) { if (current(token)) setError(String(failure?.message ?? failure)) }
    finally { finish(token) }
  }

  const routeRequest = () => {
    const input = form.current
    return { text: input.text.trim(), requiresMachine: input.machine !== '',
      requesterBotId: view.requesterBotId ?? snapshot.mainBotId ?? snapshot.bots?.find(bot => bot.main)?.id ?? '',
      ...(input.pin ? { pinnedBotId: input.pin } : {}),
      ...(input.machine ? { machineId: input.machine, rootId: input.root || snapshot.machines?.items?.find(item => item.id === input.machine)?.roots?.[0] || '' } : {}),
      needs: { write: input.effect === 'write', desktop: input.effect === 'desktop', browser: input.effect === 'browser' } }
  }
  const submitRouted = async () => {
    const state = control.current, prepared = state.prepared
    if (!state.ready || submissions.getSnapshot() || !prepared || prepared.draft !== state.draft || prepared.epoch !== state.epoch) return
    const token = begin('dispatch')
    if (!token) return
    let reference
    try {
      prepared.requestKey ??= crypto.randomUUID()
      const request = { ...prepared.request, requestKey: prepared.requestKey }
      if (!request.requesterBotId) throw new Error('尚未取得提交任务的主 Bot，请刷新候选后重试。')
      reference = { requestKey: request.requestKey, requesterBotId: request.requesterBotId }
      if (!submissions.start(reference)) return
      const next = await call('botRouting.dispatch', request)
      const planId = next?.planId ?? next?.taskId
      if (next?.accepted !== true || typeof planId !== 'string' || !planId.trim()) throw new Error('未取得有效的任务计划编号。')
      // The receipt belongs to the captured Host even if its card was unmounted meanwhile.
      submissions.update(reference, { state: 'confirmed', planId, planState: next.planState })
      navigation?.saveGoalDraft('')
      if (current(token)) state.prepared = null
    } catch (failure) {
      if (reference) submissions.update(reference, { state: 'unknown' })
      if (current(token)) {
        invalidate(); staleView()
        setError(reference ? '提交结果尚未确认，请刷新任务列表或核对原提交，避免重复创建。' : String(failure?.message ?? failure))
      }
    } finally { finish(token) }
  }
  const checkSubmission = async () => {
    const reference = submissions.getSnapshot()
    if (!reference || !snapshot.availableActions?.includes('botRouting.status')) return
    const token = begin('status')
    if (!token) return
    try {
      const next = await call('botRouting.status', { requestKey: reference.requestKey, requesterBotId: reference.requesterBotId })
      if (typeof next?.found !== 'boolean' || next.originBotId !== reference.requesterBotId
        || next.found && (next.accepted !== true || typeof next.planId !== 'string' || !next.planId.trim())) throw Object.assign(new Error('宿主未返回有效的原提交记录。'), { code: 'INVALID_ROUTING_SUBMISSION_STATUS' })
      submissions.update(reference, next.found ? { state: 'confirmed', planId: next.planId, planState: next.planState } : { state: 'not-found' })
    } catch (failure) {
      if (current(token)) setError(submissionFailureMessage(failure))
    } finally { finish(token) }
  }
  const restoreSubmission = event => {
    event.preventDefault()
    if (busyRef.current || control.current.active || !control.current.live || submissions.getSnapshot()) return
    try {
      if (!submissions.restore(savedCode)) return
      setSavedCode(''); invalidate()
      void checkSubmission()
    } catch { setError('核对码格式无效或版本不支持，请粘贴完整的提交核对码。') }
  }
  const copySubmission = async () => {
    const reference = submissions.getSnapshot(), epoch = control.current.epoch
    if (!reference) return
    const code = submissionCode(reference)
    const stillCurrent = () => control.current.live && control.current.epoch === epoch
      && submissions.getSnapshot()?.requestKey === reference.requestKey && submissions.getSnapshot()?.requesterBotId === reference.requesterBotId
    codeInput.current?.focus(); codeInput.current?.select()
    try {
      if (typeof globalThis.navigator?.clipboard?.writeText !== 'function') throw new Error('CLIPBOARD_UNAVAILABLE')
      await globalThis.navigator.clipboard.writeText(code)
      if (stillCurrent()) setCopyStatus('已复制核对码，请保存后用于原宿主查询。')
    } catch {
      if (stillCurrent()) setCopyStatus('请选中核对码后手动复制，并保存用于原宿主查询。')
    }
  }
  const decide = async () => {
    const state = control.current
    if (!state.ready || submissions.getSnapshot() || !view.enabled || !form.current.text.trim()) return
    const token = begin('preview')
    if (!token) return
    invalidate()
    const draft = state.draft, request = routeRequest()
    try {
      const next = await call('botRoutingDecide', request)
      if (!current(token) || state.draft !== draft) return
      if (!next || !Object.hasOwn(next, 'chosen') || !Array.isArray(next.ranked) || !Array.isArray(next.rejected)
        || next.chosen !== null && typeof next.chosen?.botId !== 'string') throw new Error('宿主未返回完整预览，请刷新后重试。')
      state.prepared = next.chosen ? { request, draft, epoch: token.epoch, requestKey: null } : null
      setDecision(next)
    } catch (failure) {
      if (current(token) && state.draft === draft) { invalidate(); staleView(); setError(String(failure?.message ?? failure)) }
    } finally { finish(token) }
  }

  const submissionNotice = submission && <section className="bp-blocked" role="region" aria-label="原提交核对">
    {submission.state === 'confirmed' ? <p role="status">已提交：{submission.planId}。{TASK_STATES[submission.planState] ?? '请在任务记录中跟踪执行结果。'}</p>
      : submission.state === 'not-found' ? <p role="status">当前尚未查到原提交，原请求仍可能完成，请稍后再次核对。</p>
        : <p role="status">{submission.state === 'submitting' && working === 'dispatch' ? '正在提交任务…' : '提交结果尚未确认，请核对原提交。'}</p>}
    <p>核对只读取原任务记录，不会再次提交或授予权限。</p>
    <details className="bp-technical"><summary>保存提交核对码</summary>
      <p>重载应用前可保存核对码，之后在原宿主粘贴查询。核对码只包含提交编号，不包含任务正文或登录凭据。</p>
      <label>当前提交核对码<input ref={codeInput} aria-label="当前提交核对码" className="bp-submission-code" readOnly value={submissionCode(submission)} onFocus={event => event.target.select()} /></label>
      <div className="bp-actions"><button type="button" onClick={() => { void copySubmission() }}>复制核对码</button>{copyStatus && <small role="status">{copyStatus}</small>}</div>
    </details>
    <div className="bp-actions">
      {snapshot.availableActions?.includes('botRouting.status') ? <button type="button" disabled={busy || Boolean(working)} onClick={() => { void checkSubmission() }}>核对原提交</button>
        : <small>当前宿主尚未提供原提交核对，请先在任务记录中核对。</small>}
      {submission.state === 'confirmed' && <button type="button" disabled={busy || Boolean(working)} onClick={() => { submissions.clear(submission); invalidate() }}>新建另一项任务</button>}
    </div>
    {submission.state === 'not-found' && <details className="bp-technical"><summary>已自行核对记录</summary>
      <p>原请求仍可能完成。清除提醒不会停止原任务，再次创建可能重复；只有自行核对后才清除。</p>
      <button type="button" disabled={busy || Boolean(working)} onClick={() => { submissions.dismissUnconfirmed(submission); invalidate() }}>清除本窗口提醒</button>
    </details>}
  </section>
  const savedSubmissionForm = !submission && snapshot.availableActions?.includes('botRouting.status') && <details className="bp-technical">
    <summary>核对已保存的提交</summary><p>请连接原宿主并粘贴之前保存的核对码。此操作只查询原记录，不会创建任务。</p>
    <form className="bp-submission-restore" onSubmit={restoreSubmission}>
      <label>已保存的提交核对码<input aria-label="已保存的提交核对码" className="bp-submission-code" value={savedCode} maxLength={1024} autoComplete="off" spellCheck={false} disabled={busy || Boolean(working)} onChange={event => setSavedCode(event.target.value)} placeholder="dsh-route-v1:…" /></label>
      <button type="submit" disabled={busy || Boolean(working) || !savedCode.trim()}>核对已保存的提交</button>
    </form>
  </details>
  if (!view) {
    return <article className="bp-card"><div className="bp-card-title"><h2>Bot 路由</h2></div>
      <p className="bp-muted">{error || '正在读取候选…'}</p><button type="button" disabled={busy || working} onClick={() => { void load() }}>读取候选</button>{submissionNotice}{savedSubmissionForm}</article>
  }
  const machines = (snapshot.machines?.items ?? []).filter(item => item.status !== 'revoked')
  const inputDisabled = busy || !viewReady || working === 'dispatch' || working === 'settings'
  const nameOf = botId => view.candidates.find(row => row.botId === botId)?.name ?? botId
  return <article className="bp-card bp-task-composer" ref={card}><div className="bp-card-title"><h2>Bot 路由</h2><Tag>{view.enabled ? `已开启 · ${routingPresetLabel(view.preset)}` : '未开启'}</Tag>
    <button type="button" disabled={busy || Boolean(working)} onClick={() => { void load() }}>刷新候选</button></div>
    <div className="bp-actions"><label className="bp-check"><input type="checkbox" checked={view.enabled} disabled={busy || Boolean(working) || !viewReady} onChange={event => { void saveSettings({ enabled: event.target.checked, preset: view.preset, autoGrant: view.autoGrant }) }} />开启 Bot 路由</label>
      <label>策略<select value={view.preset} disabled={busy || Boolean(working) || !viewReady} onChange={event => { void saveSettings({ enabled: view.enabled, preset: event.target.value, autoGrant: view.autoGrant }) }}>
        <option value="economy">省钱优先</option><option value="balanced">均衡</option><option value="quality">效果优先</option></select></label>
      <label className="bp-check"><input type="checkbox" checked={view.autoGrant?.machineTools === true} disabled={busy || Boolean(working) || !viewReady} onChange={event => { void saveSettings({ enabled: view.enabled, preset: view.preset, autoGrant: { ...view.autoGrant, machineTools: event.target.checked } }) }} />自动授予任务所需电脑权限</label></div>
    {!view.enabled && <p className="bp-muted">开启后，主 Bot 可根据各 Bot 已配置的模型、工具与电脑权限分配任务。手动指定也会检查是否具备执行条件。</p>}
    {error && <p className="bp-error" role="alert">{error}</p>}
    {submissionNotice}
    {savedSubmissionForm}
    {!viewReady && !working && <p className="bp-muted">候选尚未更新，请刷新候选后再预览。</p>}
    {view.enabled ? <div className="bp-table-wrap"><table className="bp-routing-candidates">
      <thead><tr><th>Bot</th><th>模型</th><th>机器</th><th>价格/百万</th><th>质量</th><th>状态</th></tr></thead>
      <tbody>{view.candidates.map(row => <tr key={row.botId}>
        <td>{row.name}{row.main ? <Tag>Main</Tag> : null}<small>{row.botId}</small></td>
        <td>{row.model ? `${row.model.provider}/${row.model.model}` : <em>未绑定</em>}</td>
        <td>{row.machineId ? (row.machineOnline ? '在线' : '未在线') : '无'}</td>
        <td>{row.pricePerMTokUsd === null ? '未知' : `$${row.pricePerMTokUsd}`}</td>
        <td>{row.quality === null ? '未知' : row.quality}</td>
        <td>{row.busy ? '正忙' : '空闲'}</td>
      </tr>)}</tbody></table></div> : null}
    {view.enabled ? <div className="bp-form">
      <label>任务描述<textarea rows={2} value={text} disabled={inputDisabled} onChange={event => editDraft({ text: event.target.value })} placeholder="例如：整理上周的发布记录" /></label>
      <label>路由方式<select value={pin} disabled={inputDisabled} onChange={event => editDraft({ pin: event.target.value })}>
        <option value="">自动路由（按预设打分）</option>
        {view.candidates.map(row => <option key={row.botId} value={row.botId}>指定：{row.name}</option>)}
      </select></label>
      <label>需要远程电脑<select value={machine} disabled={inputDisabled} onChange={event => editDraft({ machine: event.target.value, root: '', effect: 'read' })}>
        <option value="">不需要</option>
        {machines.map(item => <option key={item.id} value={item.id}>{item.name ?? item.id}</option>)}
      </select></label>
      {machine && <label>共享目录<select value={root || machines.find(item => item.id === machine)?.roots?.[0] || ''} disabled={inputDisabled} onChange={event => editDraft({ root: event.target.value })}>
        {(machines.find(item => item.id === machine)?.roots ?? []).map(id => <option key={id} value={id}>{id}</option>)}
      </select></label>}
      <label>任务需要的操作<select value={effect} disabled={inputDisabled} onChange={event => editDraft({ effect: event.target.value })}>
        <option value="read">只读 / 分析</option><option value="write">写入文件</option>
        {machine && <><option value="desktop">操作 Windows 桌面</option><option value="browser">操作远程浏览器</option></>}
      </select></label>
      <button type="button" disabled={busy || Boolean(working) || Boolean(submission) || !viewReady || !text.trim()} onClick={() => { void decide() }}>{working === 'preview' ? '计算中…' : '预览路由'}</button>
    </div> : null}
    {decision ? <div className="bp-blocked" role="region" aria-label="路由预览结果">
      <strong>选中：{decision.chosen ? `${decision.chosen.name ?? decision.chosen.botId}${decision.pinned ? '（手动指定）' : ''}` : '没有可用的 Bot'}</strong>
      <p>{decision.pinned ? '手动指定的 Bot 已通过本次执行条件检查，未与其他 Bot 比较评分。' : `按${routingPresetLabel(decision.preset)}策略比较，综合评分越低越靠前。`}</p>
      {decision.binding ? <><p>所需电脑权限：{decision.binding.mode === 'read-only' ? '只读' : '读写'} · {decision.binding.tools.length} 项工具。</p>
        <p>{decision.grant?.autoGrant === false ? '自动授权已关闭，创建任务时会核对已有授权；权限不足时需先配置。' : '创建任务时才会按已保存的权限上限核对和授权。'}</p></> : null}
      {decision.rejected?.length ? <p>未满足条件：{decision.rejected.map(row => `${nameOf(row.botId)}（${routingRefusalMessage(row.reason)}）`).join('；')}</p> : null}
      {!decision.pinned && decision.ranked?.length > 0 && <details className="bp-technical"><summary>查看比较依据</summary>
        <p>评分只用于本次候选排序，不代表成功率。未知价格按保守值计算，未知质量按中间值参与比较。</p>
        <div className="bp-table-wrap"><table className="bp-routing-comparison" aria-label="候选比较"><thead><tr><th>Bot</th><th>综合评分</th><th>价格/百万</th><th>参考质量</th></tr></thead>
          <tbody>{decision.ranked.map(row => <tr key={row.botId}><td>{nameOf(row.botId)}</td><td>{Number.isFinite(row.score) ? row.score.toFixed(6) : '未知'}</td>
            <td>{Number.isFinite(row.pricePerMTokUsd) ? `$${row.pricePerMTokUsd}` : '未知'}</td><td>{Number.isFinite(row.quality) ? row.quality : '未知'}</td></tr>)}</tbody></table></div>
      </details>}
      {(decision.binding || decision.rejected?.length > 0) && <details className="bp-technical"><summary>执行条件详情</summary>
        {decision.binding && <p>所需工具：{decision.binding.tools.join('、')}</p>}
        {decision.rejected?.map(row => <p key={row.botId}>{row.botId}：{row.reason}</p>)}
      </details>}
      {decision.chosen ? <div className="bp-actions">
        <button type="button" disabled={busy || Boolean(working) || !viewReady || Boolean(submission)} onClick={() => { void submitRouted() }}>按此路由创建任务</button>
      </div> : null}
    </div> : null}
  </article>
}

export function Tasks({ snapshot, dispatch, busy, submissionScope = dispatch, inspect, openSession, focus, navigation }) {
  if (snapshot.tasks?.status !== 'available') return <Blocked value={snapshot.tasks} />
  return <TaskWorkspace snapshot={snapshot} dispatch={dispatch} busy={busy} scope={submissionScope} inspect={inspect} openSession={openSession}
    focus={focus} routingCard={snapshot.availableActions?.includes('botRoutingInspect') ? <BotRoutingCard snapshot={snapshot} dispatch={dispatch} busy={busy} submissionScope={submissionScope} navigation={navigation ?? workspaceNavigation(submissionScope)} focus={focus} /> : null} />
}


/**
 * 电脑操作: watch one frame, then act on it. Every action carries the id of the frame the person
 * actually saw, so a stale picture cannot be clicked; the state line reports what really happened.
 */
function DesktopControl({ snapshot, dispatch, busy }) {
  const machines = (snapshot.machines?.items ?? []).filter(item => item.status !== 'revoked')
  const bots = snapshot.bots ?? []
  const [machineId, setMachineId] = React.useState(machines[0]?.id ?? '')
  const [botId, setBotId] = React.useState(bots[0]?.id ?? '')
  const [frame, setFrame] = React.useState(null)
  const [status, setStatus] = React.useState('idle')
  const [error, setError] = React.useState('')
  const [live, setLive] = React.useState(false)
  const [text, setText] = React.useState('')
  const imageRef = React.useRef(null)
  const machine = machines.find(item => item.id === machineId)
  // The read model reports roots as ids; older shapes nested them as { id }. Accept both rather
  // than sending an empty rootId, which the Host refuses as INVALID_DESKTOP_REQUEST:rootId.
  const firstRoot = machine?.roots?.[0]
  const rootId = typeof firstRoot === 'string' ? firstRoot : firstRoot?.id ?? firstRoot?.rootId ?? ''
  const canView = typeof dispatch === 'function' && Boolean(machineId && rootId && botId)
  const call = async (action, payload) => {
    setError('')
    try {
      const value = await dispatch(action, payload)
      return value
    } catch (failure) {
      setError(String(failure?.message ?? failure))
      return null
    }
  }
  const capture = React.useCallback(async () => {
    if (!canView) return
    setStatus('capturing')
    const value = await call('machine.desktop.view', { botId, machineId, rootId })
    if (!value) { setStatus('error'); return }
    if (value.unavailable) { setStatus('unavailable'); setError(value.reason ?? '桌面帧不可用。'); return }
    setFrame({ ...value, takenAtMs: Date.now() })
    setStatus('ready')
  }, [botId, machineId, rootId, canView])
  React.useEffect(() => {
    if (!live || !canView) return undefined
    void capture()
    const timer = setInterval(() => { void capture() }, 1500)
    return () => clearInterval(timer)
  }, [live, canView, capture])
  const act = async action => {
    if (!frame?.screenshotId) { setError('先取一帧，再操作。'); return }
    const value = await call('machine.desktop.act', { botId, machineId, rootId, screenshotId: frame.screenshotId, action })
    if (!value) return
    setStatus(value.status === 'succeeded' ? 'ready' : 'error')
    if (value.status !== 'succeeded') setError(`操作未成功：${value.status}`)
    if (!live) void capture()
  }
  const clickImage = event => {
    if (!frame?.width || !frame?.height || !imageRef.current) return
    const rect = imageRef.current.getBoundingClientRect()
    try {
      const point = framePoint({ clientX: event.clientX, clientY: event.clientY, rect: { width: rect.width, height: rect.height }, frame: { width: frame.width, height: frame.height } })
      void act({ tool: 'click', x: point.x, y: point.y })
    } catch (failure) {
      setError(String(failure?.message ?? failure))
    }
  }
  const keys = ['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
  return <section className="bp-card" aria-label="电脑操作">
    <div className="bp-card-title"><h2>电脑操作</h2><span className="bp-tag">{`${status}${frame?.screenshotId ? ' · 帧 ' + frame.screenshotId.slice(-6) : ''}`}</span></div>
    <p className="bp-muted">画面来自已配对电脑的桌面；每个操作只对它下面那一帧生效，帧过期请重新截取。</p>
    <div className="bp-form">
      <label>电脑<select value={machineId} onChange={event => { setMachineId(event.target.value); setFrame(null) }}>{machines.map(item => <option key={item.id} value={item.id}>{item.name ?? item.id}</option>)}</select></label>
      <label>以哪个 Bot 执行<select value={botId} onChange={event => setBotId(event.target.value)}>{bots.map(item => <option key={item.id} value={item.id}>{item.name ?? item.id}</option>)}</select></label>
      <div className="bp-actions">
        <button disabled={busy || !canView || status === 'capturing'} onClick={() => { void capture() }}>{status === 'capturing' ? '截取中…' : '截取当前画面'}</button>
        <label className="bp-check"><input type="checkbox" checked={live} disabled={!canView} onChange={event => setLive(event.target.checked)} />实时（1.5 秒）</label>
      </div>
    </div>
    {error && <p className="bp-error" role="alert">{error}</p>}
    {frame?.base64
      ? <img ref={imageRef} className="bp-desktop-frame" alt="远程桌面画面" src={`data:${frame.mediaType};base64,${frame.base64}`} onClick={clickImage} />
      : <p className="bp-empty">{canView ? '还没有画面。点“截取当前画面”。' : '先配对一台电脑，并选择一个 Bot。'}</p>}
    {frame?.base64 && <div className="bp-actions bp-desktop-keys">
      {keys.map(key => <button key={key} disabled={busy} onClick={() => { void act({ tool: 'key', key }) }}>{key}</button>)}
      <button disabled={busy} onClick={() => { void act({ tool: 'scroll', delta: 120 }) }}>滚轮上</button>
      <button disabled={busy} onClick={() => { void act({ tool: 'scroll', delta: -120 }) }}>滚轮下</button>
    </div>}
    {frame?.base64 && <div className="bp-actions">
      <input className="bp-desktop-text" aria-label="要输入的文本" value={text} placeholder="输入文字后发送（发送的是按键，不是剪贴板）" onChange={event => setText(event.target.value)} />
      <button disabled={busy || !text} onClick={() => { void act({ type: 'type', tool: 'type', text }) }}>发送文本</button>
    </div>}
  </section>
}

function MachineSetup({ snapshot, dispatch, busy }) {
  const available = snapshot.availableActions ?? []
  const [paste, setPaste] = React.useState('')
  const [address, setAddress] = React.useState('')
  const [tunnel, setTunnel] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const [error, setError] = React.useState('')
  const [working, setWorking] = React.useState(false)
  const parsed = React.useMemo(() => parsePairingPaste(paste), [paste])
  React.useEffect(() => {
    if (parsed.endpoint) setAddress(parsed.endpoint)
    if (typeof parsed.protectedTunnel === 'boolean') setTunnel(parsed.protectedTunnel)
  }, [parsed.endpoint, parsed.protectedTunnel])
  const endpoint = React.useMemo(() => normalizeEndpoint(address, {}), [address])
  const ready = parsed.problems.length === 0 && endpoint.problem === ''
  // The Agent prints its own ref (`remote-agent/<machine>/<client>`); the Host requires
  // `ds-secret/<NAME>`. Keep the Host shape and derive the name from the client id only.
  const secretName = React.useMemo(() => secretNameFor({ clientId: parsed.clientId, machineId: parsed.machineId }), [parsed])
  const importFile = async event => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      setPaste(await file.text())
      setStatus('已读取 ' + file.name)
      setError('')
    } catch (failure) {
      setError(String(failure?.message ?? failure))
    }
  }
  const submit = async () => {
    if (!ready || working) return
    setWorking(true)
    setError('')
    try {
      // The channel reports failures as {ok:false}; silence here is how a pairing looks successful
      // while nothing was stored, so every step is checked.
      const unwrap = response => {
        if (response === undefined || response === null) throw new Error('宿主尚未确认这一步，请刷新后核对原始结果。')
        if (response && response.ok === false) throw new Error(response.error?.message ?? response.error ?? '宿主拒绝了这一步。')
        return response
      }
      await unwrap(await dispatch('machine.secret', { name: secretName, value: parsed.token }))
      const existing = (snapshot.machines?.items ?? []).find(item => item.id === parsed.machineId)
      const paired = await unwrap(await dispatch('machine.pair', {
        name: parsed.clientId || parsed.machineId,
        machineId: parsed.machineId,
        endpoint: endpoint.endpoint,
        secretRef: 'ds-secret/' + secretName,
        roots: parsed.rootIds.length ? parsed.rootIds : ['project'],
        probeBotId: snapshot.mainBotId ?? snapshot.bots?.[0]?.id ?? '',
        protectedTunnel: tunnel,
        tools: parsed.tools.length ? parsed.tools : ['machine_ping', 'fs_list', 'fs_read', 'fs_write', 'operation_status', 'operation_cancel', 'artifact_stat', 'artifact_read', 'desktop_screenshot', 'desktop_click', 'desktop_type', 'desktop_key', 'desktop_scroll'],
        expectedRevision: existing?.revision ?? 0,
      }))
      setStatus(paired.mainBinding?.status === 'blocked'
        ? '电脑已配对；主 Bot 绑定尚未完成：' + paired.mainBinding.code + '。请检查此电脑允许的 Bot ID 与授权状态。'
        : '已添加 ' + (parsed.clientId || parsed.machineId) + '，主 Bot 已绑定；体检会自动刷新状态。')
      setPaste('')
    } catch (failure) {
      setError(String(failure?.message ?? failure))
    } finally {
      setWorking(false)
    }
  }
  return <><SecurePairingSetup snapshot={snapshot} dispatch={dispatch} busy={busy} /><details className="bp-card bp-machine-setup"><summary>兼容已有电脑（导入长期配对文件）</summary>
    <p className="bp-muted">在你自己的 Windows 电脑或云电脑上解压 Agent 包，双击 <code>start.cmd</code>，按向导选共享文件夹和连接地址。回到这里导入向导生成的 <code>pairing.private.json</code>，地址、目录和权限会自动填好。</p>
    {available.includes('machine.secret') && available.includes('machine.pair') ? <div className="bp-form">
      <label>配对文件<input type="file" accept=".json,application/json" onChange={event => { void importFile(event) }} /></label>
      <label>或粘贴文件内容<textarea rows={3} value={paste} onChange={event => setPaste(event.target.value)} placeholder='{"clientId":"host-office","token":"...","machineId":"machine-..."}' /></label>
      <label>Agent 地址<input value={address} onChange={event => setAddress(event.target.value)} placeholder="10.0.0.2 或 http://10.0.0.2:9701" autoComplete="off" spellCheck={false} /></label>
      <label><input type="checkbox" checked={tunnel} onChange={event => setTunnel(event.target.checked)} />地址位于已配置的 WireGuard / Tailscale 受保护隧道</label>
      {paste !== '' && parsed.problems.length > 0 && <p className="bp-error" role="alert">{parsed.problems.join(' ')}</p>}
      {address !== '' && endpoint.problem !== '' && <p className="bp-error" role="alert">{endpoint.problem}</p>}
      {ready && <p className="bp-muted">将保存凭据 <code>ds-secret/{secretName}</code> 并配对 {parsed.machineId}。</p>}
      {ready && parsed.rootIds.length > 0 && <p className="bp-muted">共享目录：{parsed.rootIds.join('、')}。{parsed.hostManagedBots === true ? '此电脑允许本宿主管理团队 Bot，后续分配无需重新复制 Bot ID。' : parsed.botIds.length > 0 ? `此电脑只允许这些 Bot：${parsed.botIds.join('、')}。` : ''}</p>}
      <button type="button" disabled={!ready || busy || working} onClick={() => { void submit() }}>{working ? '添加中…' : '导入并添加'}</button>
      {status !== '' && <p className="bp-muted" role="status">{status}</p>}
      {error !== '' && <p className="bp-error" role="alert">{error}</p>}
    </div> : <p className="bp-muted">宿主尚未提供配对操作。</p>}
  </details></>
}

function MachineControls({ machine, snapshot, dispatch, busy }) {
  const groups = [
    ['read','文件读取',['machine_ping','fs_list','fs_read']],
    ['write','文件写入',['fs_write']],
    ['command','容器命令',['container_command_v1']],
    ['browser','远程浏览器',['browser_open','browser_snapshot','browser_click','browser_type','browser_script','browser_upload','browser_download','browser_close']],
    ['desktop','Windows 桌面',['desktop_screenshot','desktop_click','desktop_type','desktop_key','desktop_scroll']],
    ['cli','远程 Codex',['cli_probe_v1','cli_task_v1']],
  ]
  const [botId,setBotId]=useState(snapshot.bots?.[0]?.id??'')
  const [rootId,setRootId]=useState(machine.roots?.[0]??'')
  const [relativePath,setRelativePath]=useState('')
  const [mode,setMode]=useState('read-only')
  const [selected,setSelected]=useState(['read'])
  const available=snapshot.availableActions??[],savedBinding=machine.bindings?.find(item=>item.botId===botId),binding=savedBinding&&!savedBinding.revoked?savedBinding:null
  useEffect(()=>{
    const tools=savedBinding?.tools??[]
    setMode(savedBinding?.mode??'read-only')
    setSelected(groups.filter(([, ,names])=>names.some(name=>tools.includes(name))).map(([id])=>id))
  },[botId,savedBinding?.revision])
  const run=(action,payload)=>dispatch(action,{machineId:machine.id,...payload})
  const save=()=>{
    const tools=new Set(['machine_ping','fs_list','fs_read','operation_status','operation_cancel','artifact_stat','artifact_read'])
    for(const [id, ,names] of groups)if(selected.includes(id))for(const name of names)tools.add(name)
    run('machine.bind',{botId,roots:[rootId],tools:[...tools].filter(tool=>machine.tools.includes(tool)),mode,expectedRevision:savedBinding?.revision??0})
  }
  return <div className="bp-form">
    <label>Bot<select aria-label={`机器 ${machine.id} 的 Bot`} value={botId} onChange={event=>setBotId(event.target.value)}>{snapshot.bots.map(bot=><option key={bot.id} value={bot.id}>{bot.name??bot.id}</option>)}</select></label>
    <label>根目录<select aria-label={`机器 ${machine.id} 的根目录`} value={rootId} onChange={event=>setRootId(event.target.value)}>{(machine.roots??[]).map(id=><option key={id}>{id}</option>)}</select></label>
    <fieldset><legend>授予此 Bot 的能力</legend>{groups.map(([id,label,names])=><label key={id}><input type="checkbox" disabled={!names.some(name=>machine.tools.includes(name))} checked={selected.includes(id)} onChange={event=>{
      const next=event.target.checked?[...selected,id]:selected.filter(value=>value!==id)
      setSelected(next)
      if(id!=='read'&&event.target.checked)setMode('workspace-write')
    }} />{label}<small>{names.filter(name=>machine.tools.includes(name)).join('、')||'此 Agent 未提供'}</small></label>)}</fieldset>
    <label>权限模式<select value={mode} onChange={event=>setMode(event.target.value)}><option value="read-only">只读</option><option value="workspace-write">允许写入及已勾选的控制操作</option></select></label>
    {available.includes('machine.bind')&&<button type="button" disabled={busy||!botId||!rootId||selected.length===0} onClick={save}>保存此 Bot 的机器授权</button>}
    {available.includes('machine.probe')&&<><button type="button" disabled={busy||!binding} onClick={()=>run('machine.probe',{botId,rootId})}>检查 Agent 在线状态</button>
      <label>受控读测试的相对路径<input aria-label={`机器 ${machine.id} 的测试路径`} value={relativePath} onChange={event=>setRelativePath(event.target.value)} placeholder="README.md" /></label>
      <button type="button" disabled={busy||!binding||!relativePath} onClick={()=>run('machine.probe',{botId,rootId,relativePath})}>验证可读（不显示文件内容）</button></>}
    {available.includes('machine.revoke')&&<><button type="button" disabled={busy||!binding} onClick={()=>run('machine.revoke',{botId,expectedRevision:binding.revision})}>撤销此 Bot 的机器访问</button>
      <button type="button" disabled={busy} onClick={()=>run('machine.revoke',{expectedRevision:machine.revision})}>撤销电脑配对</button></>}
    <p className="bp-muted">每次保存都会先撤销旧票据再按新范围授权。桌面截图也需要 artifact 权限；撤销离线时会保留“停止未确认”。</p>
  </div>
}

function ArtifactDownload({ machine, snapshot, dispatch, busy }) {
  const [form,setForm]=useState({botId:snapshot.bots?.[0]?.id??'',taskId:'',attemptId:'',operationId:'',artifactId:''})
  const [result,setResult]=useState(null),[error,setError]=useState(null)
  const change=(key,value)=>setForm(current=>({...current,[key]:value}))
  return <details className="bp-form"><summary>下载 artifact</summary>
    <p className="bp-muted">仅下载原任务已授权的 artifact；先核对元数据，再校验完整字节和 SHA-256。内容不会显示在页面中。</p>
    <form onSubmit={async event=>{event.preventDefault();setError(null);setResult(null);try{setResult(await dispatch('machine.artifact',{machineId:machine.id,...form}))}catch(error){setError(error)}}}>
      <label>Bot<select aria-label={`机器 ${machine.id} 的 artifact Bot`} value={form.botId} onChange={event=>change('botId',event.target.value)}>{snapshot.bots.map(bot=><option key={bot.id} value={bot.id}>{bot.name??bot.id}</option>)}</select></label>
      {[['taskId','Task'],['attemptId','Attempt'],['operationId','Operation'],['artifactId','Artifact']].map(([key,label])=><label key={key}>{label}<input aria-label={`机器 ${machine.id} 的 artifact ${label}`} value={form[key]} onInput={event=>change(key,event.target.value)} required autoComplete="off" /></label>)}
      <button type="submit" disabled={busy||Object.values(form).some(value=>!value)}>核验并下载</button>
    </form>
    {error&&<p className="bp-blocked" role="status">下载失败：{error.code??'ARTIFACT_DOWNLOAD_FAILED'}。artifact 不存在、已过期或未获授权。</p>}
    {result&&<a download={`${form.artifactId}.bin`} href={`data:${result.mediaType??'application/octet-stream'};base64,${result.content}`}>下载已核验 artifact（{result.size} 字节，SHA-256 已匹配）</a>}
  </details>
}

export function Machines({ snapshot, dispatch, busy, focus, transport }) {
  const machineCards = useRef(new Map())
  useEffect(() => {
    if (!focus?.machineId) return
    const card = machineCards.current.get(focus.machineId)
    card?.focus({ preventScroll: true }); card?.scrollIntoView?.({ block: 'start' })
  }, [focus?.version, focus?.machineId])
  const section = snapshot.machines
  if (section?.status !== 'available') return <Blocked value={section} />
  return <>{dispatch&&<><DesktopWorkbench snapshot={snapshot} dispatch={dispatch} transport={transport} />
    <details><summary>兼容截图操作</summary><DesktopControl snapshot={snapshot} dispatch={dispatch} busy={busy} /></details>
    <MachineSetup snapshot={snapshot} dispatch={dispatch} busy={busy} /></>}{focus?.machineId && !section.items.some(machine => (machine.id ?? machine.machineId) === focus.machineId) && <p className="bp-blocked" role="status">所选电脑不在当前宿主记录中，请刷新后核对。</p>}{section.items.length ? <div className="bp-grid">{section.items.map(machine => <article className={`bp-card${focus?.machineId === (machine.id ?? machine.machineId) ? ' bp-selected-resource' : ''}`} key={machine.id ?? machine.machineId} tabIndex={-1} ref={node => { const id = machine.id ?? machine.machineId; if (node) machineCards.current.set(id, node); else machineCards.current.delete(id) }}>
    <div className="bp-card-title"><h2>{machine.name ?? machine.id ?? machine.machineId}</h2><Tag>{machine.status ?? '未知'}</Tag></div>
    <dl className="bp-facts"><Value label="平台">{machine.platform}</Value><Value label="Agent 版本">{machine.version}</Value><Value label="最后在线">{machine.lastSeenAt ? new Date(machine.lastSeenAt).toLocaleString('zh-CN') : '从未取得心跳'}</Value>
      <Value label="能力">{machine.capabilities?.join('、')}</Value><Value label="桌面会话">{machine.desktop?.status ?? '未报告'}</Value></dl>
    {(machine.blockedReason || machine.status !== 'online') && <Blocked value={{ reason: machine.blockedReason ?? '机器未在线，任务不会派到此机器。', nextAction: machine.nextAction ?? '启动 Agent 并检查配对、网络及登录桌面。' }} />}
    {machine.revocations?.some(item=>item.status!=='revoked')&&<aside className="bp-blocked" role="status"><strong>远程停止尚未确认</strong><p>本机授权已经撤销。目标电脑恢复连接后，可重新确认远程票据撤销；此操作不会恢复任何权限。</p>
      {dispatch&&snapshot.availableActions?.includes('machine.reconcile')&&<button type="button" disabled={busy} onClick={()=>dispatch('machine.reconcile',{machineId:machine.id})}>重试确认远程撤销</button>}</aside>}
    {dispatch&&machine.status!=='revoked'&&<><MachineControls machine={machine} snapshot={snapshot} dispatch={dispatch} busy={busy} /><ArtifactDownload machine={machine} snapshot={snapshot} dispatch={dispatch} busy={busy} /></>}
  </article>)}</div> : !dispatch && <p className="bp-empty">尚未配对远程电脑。安装 Agent，核验指纹并授予所需根目录后，机器会显示在这里。</p>}</>
}

function UnknownReview({ item, dispatch, busy }) {
  const [note, setNote] = useState('')
  const [amount, setAmount] = useState('')
  // An unconfirmed package fail-closes its Bot and scope until an owner decides
  // the money: attest the vendor-confirmed amount, or waive it with a reason.
  const attestable = note.trim().length > 0 && amount.trim() !== '' && Number.isFinite(Number(amount)) && Number(amount) >= 0
  const submit = kind => dispatch('usage.resolve', { botId: item.botId, runId: item.runId, packageId: item.packageId, kind,
    ...(kind === 'attest' ? { costUsd: Number(amount) } : {}), note: note.trim() })
  return <article className="bp-card">
    <div className="bp-card-title"><h2>{item.botId}</h2><Tag>{item.billing === 'subscription' ? '订阅' : 'API'}</Tag></div>
    <dl className="bp-facts"><Value label="运行">{item.runId}</Value><Value label="工作包">{item.packageId}</Value>
      <Value label="模型">{modelName(item.model ?? (item.provider ? { provider: item.provider, model: item.model } : null))}</Value>
      <Value label="用量">{item.usage ? `${item.usage.inputTokens ?? '未报告'} / ${item.usage.outputTokens ?? '未报告'}` : '未报告'}</Value>
      <Value label="结束于">{item.finishedAt ? new Date(item.finishedAt).toLocaleString('zh-CN') : '未取得'}</Value></dl>
    <label>核对说明（必填，留痕于运行记录）<input aria-label={`核对说明 ${item.runId}`} value={note} onChange={event => setNote(event.target.value)} maxLength={2000} required autoComplete="off" /></label>
    <label>厂商确认金额（美元；留空并按零费用放行）<input aria-label={`核对金额 ${item.runId}`} value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" autoComplete="off" /></label>
    <div className="bp-actions">
      <button type="button" disabled={busy || !attestable} onClick={() => submit('attest')}>按厂商账单确认</button>
      <button type="button" disabled={busy || !note.trim()} onClick={() => submit('waive')}>按零费用放行</button>
    </div>
  </article>
}

export function Usage({ snapshot, dispatch, busy, openAdvanced, scope }) {
  const section = snapshot.usage
  if (section?.status !== 'available') return <><Blocked value={section} /><button onClick={openAdvanced}>打开已有 MR 费用与订阅面板</button></>
  const unresolved = section.unresolved ?? []
  return <><p className="bp-muted">以宿主唯一资金库的收据和预占为准。未知费用保留未知；Token 统计与实际计费分开呈现。</p>
    {section.summary && <dl className="bp-facts bp-card"><Value label="已知 API 费用">{money(section.summary.apiUsd)}</Value><Value label="当前预占">{money(section.summary.reservedUsd)}</Value>
      <Value label="未知费用记录">{section.summary.unknownCount ?? '未报告'}</Value><Value label="订阅用量">{subscriptionText(section.summary.subscriptionSummary)}</Value></dl>}
    {unresolved.length ? <section className="bp-card" aria-label="待人工核对的未确认费用">
      <h2>待人工核对的未确认费用</h2>
      <p className="bp-muted">以下执行已经分派，但没有取得可核验的厂商账单；在核对完成前，其 Bot 与资金范围不会放行新的付费调用。核对说明会记录在运行记录中。</p>
      <div className="bp-grid">{unresolved.map(item => <UnknownReview key={`${item.runId}/${item.packageId}`} item={item} dispatch={dispatch} busy={busy} />)}</div>
    </section> : null}
    <UsageExplorer section={section} busy={busy} scope={scope}/>
    <button onClick={openAdvanced}>打开高级费用、订阅与历史能力</button>
  </>
}


export const Library = LibraryPanel


/**
 * Saved routines: what a Bot was shown once and can run again.
 *
 * Running needs a machine, because a routine is a sequence of desktop actions. The panel picks the
 * machine and asks the Host to run it; the Host still decides whether this caller may act there.
 */
export function Routines({ snapshot, dispatch, busy }) {
  const bots = snapshot.bots ?? []
  const machines = (snapshot.machines?.items ?? []).filter(item => item.status !== 'revoked')
  const [botId, setBotId] = React.useState(bots[0]?.id ?? '')
  const [machineId, setMachineId] = React.useState(machines[0]?.id ?? '')
  const [rows, setRows] = React.useState(null)
  const [result, setResult] = React.useState(null)
  const [error, setError] = React.useState('')
  const call = async (action, payload) => {
    if (typeof dispatch !== 'function') return null
    const value = await dispatch(action, payload)
    if (value && value.ok === false) throw new Error(value.error?.message ?? value.error ?? '宿主拒绝了这一步。')
    return value
  }
  const list = async () => {
    setError(''); setResult(null)
    try { setRows(await call('routine.list', { botId })) } catch (failure) { setError(String(failure?.message ?? failure)) }
  }
  const run = async routineId => {
    setError(''); setResult(null)
    try {
      setResult({ routineId, ...(await call('routine.run', { botId, routineId, machineId, rootId: machines.find(m => m.id === machineId)?.roots?.[0] ?? 'project' })) })
    } catch (failure) { setError(String(failure?.message ?? failure)) }
  }
  if (!bots.length) return <p className="bp-empty">还没有 Bot。</p>
  return <article className="bp-card"><div className="bp-card-title"><h2>例行任务</h2><Tag>{botId || '未选择'}</Tag></div>
    <p className="bp-muted">例行任务是一串验证过的桌面动作；运行会在选定的电脑上逐条执行，失败即停并说明停在第几步。</p>
    <div className="bp-form">
      <label>Bot<select value={botId} onChange={event => { setBotId(event.target.value); setRows(null) }}>
        {bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label>
      <label>电脑<select value={machineId} onChange={event => setMachineId(event.target.value)}>
        {machines.length === 0 ? <option value="">还没有配对的电脑</option> : machines.map(item => <option key={item.id} value={item.id}>{item.name ?? item.id}</option>)}</select></label>
      <button type="button" disabled={busy} onClick={() => { void list() }}>读取例行任务</button>
      {error && <p className="bp-error" role="alert">{error}</p>}
    </div>
    {rows ? (rows.length === 0 ? <p className="bp-muted">这个 Bot 还没有保存过例行任务。</p> : <div className="bp-table-wrap"><table>
      <thead><tr><th>名称</th><th>步数</th><th>保存时间</th><th>操作</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <td>{row.name}<small>{row.id}</small></td><td>{row.steps}</td>
        <td>{row.createdAt ? new Date(row.createdAt).toLocaleString('zh-CN') : '—'}</td>
        <td><button type="button" disabled={busy || !machineId} onClick={() => { void run(row.id) }}>运行</button></td>
      </tr>)}</tbody></table></div>) : null}
    {result ? <div className="bp-blocked"><strong>运行结果：{result.status ?? result.result?.status ?? '已提交'}</strong>
      <p>{result.stoppedAt !== undefined && result.stoppedAt !== null ? `停在第 ${result.stoppedAt + 1} 步` : '全部步骤完成'}</p>
      {result.error ? <p className="bp-error">{result.error}</p> : null}</div> : null}
  </article>
}


/**
 * The role catalog: eight briefs a person can start a Bot from.
 *
 * Creating a Bot belongs to the Bot runtime's own flow, so this card does not pretend to create one.
 * It shows what each role is for and copies its brief, which is the part a person would otherwise
 * have to reinvent in the new-Bot form.
 */
export function RoleCatalog({ dispatch, busy }) {
  const [roles, setRoles] = React.useState(null)
  const [copied, setCopied] = React.useState('')
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    let live = true
    if (typeof dispatch !== 'function') return undefined
    dispatch('roles.list', {})
      .then(value => { if (live && value && value.ok !== false) setRoles(Array.isArray(value) ? value : value?.roles ?? []) })
      .catch(failure => { if (live) setError(String(failure?.message ?? failure)) })
    return () => { live = false }
  }, [dispatch])
  const copy = async role => {
    try {
      await navigator.clipboard?.writeText(`${role.name}: ${role.brief}`)
      setCopied(role.id)
    } catch (failure) {
      setError(String(failure?.message ?? failure))
    }
  }
  if (error) return <article className="bp-card"><div className="bp-card-title"><h2>岗位</h2></div><p className="bp-error" role="alert">{error}</p></article>
  if (!roles) return null
  return <article className="bp-card"><div className="bp-card-title"><h2>岗位</h2><Tag>{roles.length}</Tag></div>
    <p className="bp-muted">这些是给 Bot 的岗位简述。新建 Bot 时把简述粘进描述即可；岗位文本不会授予任何工具或机器权限。</p>
    <div className="bp-table-wrap"><table>
      <thead><tr><th>岗位</th><th>简述</th><th>需要的能力</th><th>操作</th></tr></thead>
      <tbody>{roles.map(role => <tr key={role.id}>
        <td>{role.name}<small>{role.id}</small></td>
        <td>{role.brief}</td>
        <td className="bp-code">{role.tools.join('、')}</td>
        <td><button type="button" disabled={busy} onClick={() => { void copy(role) }}>{copied === role.id ? '已复制' : '复制简述'}</button></td>
      </tr>)}</tbody></table></div>
  </article>
}

export function ProductPage({ section, productApi, openSession, openPanel }) {
  const pageRef = useRef(null)
  useLayoutEffect(() => { if (pageRef.current) { pageRef.current.scrollTop = 0; pageRef.current.scrollLeft = 0 } }, [section, productApi])
  const navigation = useMemo(() => workspaceNavigation(productApi), [productApi])
  const route = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const focus = route?.section === section ? route : null
  const [searchOpen, setSearchOpen] = useState(false)
  const onNavigate = useCallback(destination => {
    navigation.navigate(destination)
    openPanel?.(PRODUCT_PANELS[destination.section])
  }, [navigation, openPanel])
  useEffect(() => { setSearchOpen(false) }, [productApi])
  useEffect(() => { if (focus?.search) setSearchOpen(true) }, [focus?.version, focus?.search])
  useEffect(() => {
    const onKey = event => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return
      if (typeof pageRef.current?.checkVisibility === 'function' && !pageRef.current.checkVisibility()) return
      if (event.target instanceof Element && event.target.closest('.xterm, .bp-stream-canvas[data-control=true]')) return
      if (document.querySelector('[aria-modal="true"]') && !document.querySelector('.bp-palette')) return
      event.preventDefault(); event.stopPropagation(); setSearchOpen(value => !value)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])
  useEffect(() => {
    const id = PRODUCT_PANELS[section]
    announcePanel(id)
    return () => announcePanel(id, true)
  }, [section])
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [snapshotStale, setSnapshotStale] = useState(false)
  const pendingActions = useRef(0)
  const lifecycle = useRef({ live: false, epoch: 0, request: 0 })
  const snapshotApi = useRef(null)
  const dispatchState = useRef(null)
  dispatchState.current = { snapshotStale, readOnly: snapshot?.readOnly }
  const refresh = useCallback(async signal => {
    const state = lifecycle.current
    if (!state.live) return
    const epoch = state.epoch, request = ++state.request
    const current = () => state.live && state.epoch === epoch && state.request === request && !signal?.aborted
    try {
      const value = await productApi.snapshot(signal)
      if (!current()) return
      if (value.schemaVersion !== 1) throw new Error('宿主产品接口版本不兼容。')
      snapshotApi.current = productApi
      setSnapshot(value); setSnapshotStale(false); setError('')
    } catch (cause) {
      if (current()) { setSnapshotStale(true); setError(cause.message) }
    }
  }, [productApi])
  useEffect(() => {
    const controller = new AbortController()
    const state = lifecycle.current
    state.live = true; state.epoch++
    // A changed product API must not keep the previous host's writable view.
    setSnapshotStale(true); pendingActions.current = 0; setBusy(false)
    let timer, stopped = false
    const loop = async () => { await refresh(controller.signal); if (!stopped) timer = setTimeout(loop, document.hidden ? 15000 : 4000) }
    void loop()
    return () => { stopped = true; state.live = false; state.epoch++; state.request++; controller.abort(); clearTimeout(timer) }
  }, [refresh])
  const dispatch = useCallback(async (action, payload, { errorResult = false } = {}) => {
    if (dispatchState.current.snapshotStale || dispatchState.current.readOnly || snapshotApi.current !== productApi || !lifecycle.current.live) return
    const state = lifecycle.current, epoch = state.epoch
    const current = () => state.live && state.epoch === epoch
    pendingActions.current++; setBusy(true)
    try {
      const result = await productApi.dispatch(action, payload)
      if (!current()) return result
      await refresh()
      if (current() && result?.warning) setError('宿主已撤销授权，但远程停止尚未确认；请恢复连接并检查 Agent。')
      return result
    } catch (cause) {
      if (current()) { state.request++; setSnapshotStale(true); setError(errorResult ? '宿主请求未完成，请查看操作区域的提示并刷新记录。' : cause.message) }
      if (errorResult) return { ok: false, error: { code: cause?.code ?? 'PRODUCT_REQUEST_FAILED', message: String(cause?.message ?? cause) } }
    } finally {
      if (current()) { pendingActions.current = Math.max(0, pendingActions.current - 1); setBusy(pendingActions.current > 0) }
    }
  }, [productApi, refresh])
  const inspectTask = useCallback((payload, signal) => productApi.dispatch('task.inspect', payload, signal), [productApi])
  const desktopTransport = useCallback((action,payload,signal) => productApi.dispatch(action,payload,signal),[productApi])
  const disabled = busy || snapshotStale || snapshotApi.current !== productApi || Boolean(snapshot?.readOnly)
  const meta = WORKSPACE_SECTIONS.find(row => row.section === section) ?? { title: '工作空间', icon: 'home', description: '' }
  const title = meta.title
  return <div className="bp-workspace"><WorkspaceToolbar title={title} onHome={() => onNavigate({ section: 'home' })} onSearch={() => setSearchOpen(true)} /><main ref={pageRef} className="bp-page" data-section={section}><div className="bp-page-inner"><header className={`bp-page-header${section === 'home' ? ' bp-home-header' : ''}`}>
    <div className="bp-page-heading">{section === 'home' ? <p className="bp-eyebrow"><span className="bp-live-dot" />团队工作空间</p> : <><p className="bp-eyebrow"><UiIcon name={meta.icon} size={14} />工作空间<UiIcon name="chevron" size={12} /><span>{title}</span></p><h1>{title}</h1><p className="bp-page-description">{meta.description}</p></>}</div>
    <div className="bp-page-tools"><span className="bp-sync" data-state={snapshotStale ? 'stale' : snapshot ? 'ready' : 'loading'}>{snapshotStale ? '等待同步' : snapshot ? '已同步' : '正在连接'}</span>
      <button className="bp-refresh" disabled={busy} onClick={() => refresh()} title="刷新当前页面"><UiIcon name="refresh" size={16} className={busy ? 'bp-spinning' : ''} /><span>刷新</span></button></div>
    </header><div className="bp-page-body">
    {error && <div role="alert" className="bp-blocked"><strong>无法取得最新宿主状态</strong><p>{error}</p>{snapshot && <p>{snapshotStale ? '下面保留上次读取结果；状态未更新时，操作暂不可用。' : '下面保留上次读取结果，操作以宿主当前授权为准。'}</p>}</div>}
    {snapshot?.readOnly && <Blocked value={{ reason: snapshot.readOnly, nextAction: '关闭持有写锁的另一宿主后重新加载。' }} />}
    {!snapshot && !error && <div className="bp-loading" role="status"><span className="bp-loading-line" aria-hidden="true" /><span className="bp-loading-line" aria-hidden="true" /><p>正在读取宿主状态…</p></div>}
    {snapshot && <>{section === 'home' && <WorkspaceHome snapshot={snapshot} onNavigate={onNavigate} openSession={openSession} disabled={disabled} />}
      {section === 'inbox' && <WorkspaceInbox snapshot={snapshot} onNavigate={onNavigate} openSession={openSession} />}
      {section === 'notifications' && <NotificationsPanel productApi={productApi} botIds={snapshot.bots.map(bot => bot.id)} available={!snapshotStale && snapshotApi.current === productApi && !snapshot.readOnly && snapshot.availableActions?.includes('notifications.list')} onNavigate={onNavigate} />}
      {section === 'threads' && <BotThreadsPanel productApi={productApi} botId={focus?.botId ?? snapshot.mainBotId} onOpenSession={!snapshotStale && snapshotApi.current === productApi ? openSession : undefined} available={!snapshotStale && snapshotApi.current === productApi && !snapshot.readOnly && snapshot.availableActions?.includes('threads.list')} />}
      {section === 'webPanel' && <WebPanelsPanel productApi={productApi} dispatch={dispatch} busy={disabled} snapshot={snapshot} focus={focus}
        available={!snapshotStale && snapshotApi.current === productApi && !snapshot.readOnly && snapshot.availableActions?.includes('webPanels.list')}
        selectedId={focus?.panelId} onSelect={panelId => navigation.navigate({ section: 'webPanel', panelId })} onLeave={() => onNavigate({ section: 'home' })} />}
      {section === 'bindings' && <>{!snapshotStale && snapshotApi.current === productApi ? <BotBindings snapshot={snapshot} openSession={openSession} dispatch={dispatch} busy={disabled} focus={focus} scope={productApi} onOpenChatPanel={openPanel} onOpenTools={typeof openPanel === 'function' ? () => { requestWorkbenchView('tools'); openPanel('model-router-galgame') } : undefined} /> : <p role="status">正在读取当前连接的 Bot 配置…</p>}{snapshot.availableActions?.includes('roles.list') && <RoleCatalog dispatch={dispatch} busy={disabled} />}</>}
      {section === 'tasks' && <Tasks snapshot={snapshot} dispatch={dispatch} busy={disabled} submissionScope={productApi} inspect={!snapshotStale && snapshotApi.current === productApi && !snapshot.readOnly ? inspectTask : undefined} openSession={openSession} focus={focus} navigation={navigation} />}
      {section === 'machines' && <Machines snapshot={snapshot} dispatch={dispatch} busy={disabled} focus={focus} transport={desktopTransport} />}
      {section === 'routine' && <RoutinesPanel snapshot={snapshot} dispatch={dispatch} busy={disabled} onOpenMachines={() => openPanel(PRODUCT_PANELS.machines)} />}
      {section === 'library' && <Library snapshot={snapshot} dispatch={dispatch} busy={disabled} focus={focus} />}
      {section === 'data' && <DataPanel snapshot={snapshot} dispatch={dispatch} busy={disabled || !snapshot.availableActions?.includes('data.catalog')} focus={focus} transport={desktopTransport} scope={productApi} />}
      {section === 'usage' && <Usage snapshot={snapshot} dispatch={dispatch} busy={disabled} scope={productApi} openAdvanced={() => openPanel('model-router-galgame')} />}
      <footer className="bp-page-footer bp-muted">上次同步 {new Date(snapshot.observedAt).toLocaleString('zh-CN')}</footer></>}
    </div></div>
  </main><WorkspaceCommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} snapshot={snapshotApi.current === productApi ? snapshot : null} onNavigate={onNavigate} openSession={snapshotApi.current === productApi ? openSession : undefined} /></div>
}
