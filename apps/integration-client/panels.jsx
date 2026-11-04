import React, { useCallback, useEffect, useRef, useState } from 'react'
import { TASK_STATES, modelName, money } from './api.mjs'
import { botAttentionSummary, deriveBotAttention } from './bot-attention.mjs'
import { normalizeEndpoint, parsePairingPaste, secretNameFor } from './pairing.mjs'
import { framePoint } from '../../packages/orchestration/src/desktop-contract.mjs'
import { BotBindingEditor } from './binding-editor.jsx'

export function ProductNavigation({ openPanel, panels, compact = false }) {
  return <nav className={`bp-nav${compact ? ' bp-nav-compact' : ''}`} aria-label="Bot 工作系统">
    {[
      [panels.bindings, 'Bot 绑定', '◈', '绑定'], [panels.tasks, '任务', '☑', '任务'], [panels.machines, '远程电脑', '▣', '电脑'],
      [panels.usage, '费用与用量', '◷', '费用'], ['model-router-galgame', '高级工作台', '⚙', '工作台'],
    ].map(([id, label, icon, caption]) => <button key={id} type="button" onClick={() => openPanel(id)} title={label} aria-label={label}>
      {/* A narrow column still says what each icon opens, so the row is readable without hovering. */}
      <span aria-hidden="true">{icon}</span>{compact ? <span className="bp-nav-caption">{caption}</span> : <span>{label}</span>}
    </button>)}
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
function BotRuntimeRow({ botId, dispatch, busy }) {
  const [state, setState] = React.useState(null)
  const [error, setError] = React.useState('')
  const [working, setWorking] = React.useState(false)
  const load = React.useCallback(async () => {
    if (typeof dispatch !== 'function') return
    try {
      const rows = await dispatch('botRuntimeStatus', {})
      const row = Array.isArray(rows) ? rows.find(item => item.botId === botId) : null
      setState({ runtime: row?.mode ?? 'integration', changedAt: row?.changedAt ?? null,
        turns: row?.turns ?? null, messages: row?.messages ?? null, snapshot: row?.snapshot ?? null })
      setError('')
    } catch (failure) {
      setState(null)
      setError(String(failure?.message ?? failure))
    }
  }, [botId, dispatch])
  const [history, setHistory] = React.useState([])
  const [historyError, setHistoryError] = React.useState('')
  const loadHistory = React.useCallback(async () => {
    if (typeof dispatch !== 'function') return
    try {
      const rows = await dispatch('botRuntimeHistory', { botId, limit: 20 })
      setHistory(Array.isArray(rows) ? rows : [])
      setHistoryError('')
    } catch (failure) {
      setHistory([])
      setHistoryError(String(failure?.message ?? failure))
    }
  }, [botId, dispatch])
  const [full, setFull] = React.useState(null)
  const openFull = React.useCallback(async index => {
    try {
      const message = await dispatch('botRuntimeMessage', { botId, index })
      setFull({ index, ...message })
      setHistoryError('')
    } catch (failure) {
      setHistoryError(String(failure?.message ?? failure))
      setFull(null)
    }
  }, [botId, dispatch])
  React.useEffect(() => { void load() }, [load])
  if (!state && !error) return null
  const target = state?.runtime === 'independent' ? 'integration' : 'independent'
  const move = async () => {
    setWorking(true)
    try {
      await dispatch('botRuntimeMove', { botId, mode: target })
      await load()
    } catch (failure) {
      setError(String(failure?.message ?? failure))
    } finally {
      setWorking(false)
    }
  }
  return <div className="bp-runtime">
    <dl className="bp-facts"><Value label="运行时">{state?.runtime === 'independent' ? '独立循环 + 独立会话库' : 'Harness 会话集成'}</Value>
      <Value label="切换时间">{state?.changedAt ? new Date(state.changedAt).toLocaleString('zh-CN') : '从未切换'}</Value></dl>
    <div className="bp-actions"><button disabled={busy || working} onClick={() => { void move() }}>{working ? '切换中…' : target === 'independent' ? '迁移到独立运行时' : '迁回 Harness 会话'}</button></div>
    <p className="bp-muted">迁移是原子的：Bot 正在对话时会被拒绝。搬过去后该 Bot 的会话写进独立会话库，界面与工具沿用现有授权。</p>
    {error && <p className="bp-error" role="alert">{error}</p>}
    {state ? <details className="bp-log"><summary>最近会话（仅预览）</summary>
      <button type="button" disabled={working} onClick={() => { void loadHistory() }}>读取预览</button>
      {historyError && <p className="bp-error" role="alert">{historyError}</p>}
      {history.length === 0 ? <p className="bp-muted">点“读取预览”加载最近 20 条。</p> : <ul className="bp-checklist">{history.map((row, index) => (
        <li key={index}><strong>{row.role}</strong>{row.name ? ` · ${row.name}` : ''} · {row.chars} 字
          {row.at ? ` · ${new Date(row.at).toLocaleTimeString('zh-CN')}` : ''}
          <small>{row.preview}{String(row.preview ?? '').length < row.chars ? '…' : ''}</small>
          <button type="button" onClick={() => { void openFull(index) }}>查看全文</button></li>
      ))}</ul>}
      {full ? <div className="bp-fulltext"><p className="bp-muted">第 {full.index + 1} 条（从最新往前数）· {full.role} · {full.chars} 字</p>
        <pre>{full.content}</pre></div> : null}
    </details> : null}
  </div>
}

function BotBindings({ snapshot, openSession, dispatch, busy }) {
  const bots = snapshot.bots ?? []
  const [selected, setSelected] = useState(bots[0]?.id ?? '')
  const bot = bots.find(row => row.id === selected) ?? bots[0]
  const section = snapshot.botBindings ?? snapshot.bindings
  const binding = section?.items?.find(row => row.botId === bot?.id)
  if (!bots.length) return <p>还没有 Bot。返回 Main 完成首次设置，或从侧栏新建 Bot。</p>
  return <div className="bp-columns">
    <div className="bp-bot-list" aria-label="Bot 列表">{bots.map(item => <button key={item.id} aria-current={item.id === bot?.id ? 'true' : undefined} onClick={() => setSelected(item.id)}>
      <strong>{item.name}</strong>{item.main && <Tag>Main</Tag>}<small>{item.role || item.id}</small></button>)}</div>
    <article className="bp-card"><div className="bp-card-title"><h2>{bot.name}</h2><button onClick={() => openSession(bot.sessionId)}>打开私聊</button></div>
      <dl className="bp-facts"><Value label="稳定 Bot ID">{bot.id}</Value><Value label="职责">{bot.role || '未填写'}</Value>
        <Value label="准确模型">{modelName(bot.model)}</Value><Value label="模型策略">精确绑定；不可用时暂停并说明原因</Value>
        <Value label="工作区">{binding?.workspace?.root ?? binding?.workspaceRef?.rootId ?? bot.workDir ?? '未指定，请在 Bot 详情选择文件夹'}</Value>
        <Value label="执行位置">{binding?.machineId ?? binding?.workspaceRef?.machineId ?? '尚未取得宿主绑定'}</Value>
        <Value label="预算范围">{binding?.budgetScope}</Value><Value label="最大并发">{binding?.maxConcurrentTasks}</Value></dl>
      {section?.status === 'blocked' ? <Blocked value={section} /> : binding ? <>
        <h3>官方工具</h3>{binding.officialTools?.length ? <ul>{binding.officialTools.map(tool => <li key={tool.toolId}>{tool.toolId} · {tool.cliModel ?? '未核验模型'} · {tool.identityStatus ?? tool.identityPolicy ?? '未知'}</li>)}</ul> : <p className="bp-muted">此 Bot 没有官方工具绑定。</p>}
        <h3>有效权限</h3><p className="bp-code">{(binding.tools ?? binding.capabilities ?? []).join('、') || '无额外能力'}</p>
        {binding.blockedReason && <Blocked value={{ reason: binding.blockedReason, nextAction: binding.nextAction }} />}
      </> : <Blocked value={{ reason: '此 Bot 尚未取得有效绑定。', nextAction: '在宿主 Bot 绑定配置中授予明确工具、机器与工作区。' }} />}
      <p className="bp-muted">角色文本不会授予工具或机器权限。职责、模型、记忆及会话设置沿用私聊右侧的 Bot 详情。</p>
      <BotRuntimeRow botId={bot.id} dispatch={dispatch} busy={busy} />
      {dispatch && <BotBindingEditor bot={bot} record={binding} accounts={snapshot.fundingAccounts} dispatch={dispatch} busy={busy} />}
    </article>
  </div>
}


/**
 * What the team needs from a person, above the task table. Healthy state renders nothing,
 * and each row offers the action it names instead of a link into a report.
 */
function BotAttention({ snapshot, dispatch, busy, openTask }) {
  const rows = deriveBotAttention(snapshot)
  if (rows.length === 0) return null
  const actions = snapshot?.availableActions ?? []
  const run = (row, action, payload) => {
    if (!dispatch || busy || !actions.includes(action)) return
    void dispatch(action, { botId: row.botId, taskId: row.taskId, requestKey: crypto.randomUUID(), ...payload })
  }
  return <section className="bp-card bp-attention" aria-label="需要你处理">
    <div className="bp-card-title"><h2>需要你处理</h2><Tag>{botAttentionSummary(rows)}</Tag></div>
    <ul className="bp-attention-list">{rows.map(row => <li key={row.key} className={`bp-attention-row bp-attention-${row.stage}`}>
      <div><strong>{row.title}</strong><p className="bp-muted">{row.detail}</p></div>
      {row.action === 'reconcile' && actions.includes('task.reconcile') && <button disabled={busy} onClick={() => run(row, 'task.reconcile')}>核对原收据</button>}
      {row.action === 'retry' && actions.includes('task.retry') && <button disabled={busy} onClick={() => run(row, 'task.retry')}>重试</button>}
      {row.action !== 'reconcile' && row.action !== 'retry' && <button disabled={busy} onClick={() => openTask(row.taskId)}>打开任务</button>}
    </li>)}</ul>
  </section>
}

export function Tasks({ snapshot, dispatch, busy }) {
  const section = snapshot.tasks
  const [selected, setSelected] = useState(null)
  if (section?.status !== 'available') return <Blocked value={section} />
  const rows = section.items
  const task = rows.find(row => (row.taskId ?? row.id) === selected)
  const actions = snapshot.availableActions ?? []
  return <><BotAttention snapshot={snapshot} dispatch={dispatch} busy={busy} openTask={setSelected} />{section.plans?.map(plan=><article className="bp-card" key={plan.planId}>
    <div className="bp-card-title"><h2>计划 {plan.planId}</h2><Tag>{TASK_STATES[plan.state]??plan.state}</Tag>
      {actions.includes('task.plan.cancel')&&!['succeeded','cancelled'].includes(plan.state)&&<button disabled={busy} onClick={()=>dispatch('task.plan.cancel',{botId:plan.ownerBotId,planId:plan.planId})}>停止整个计划</button>}</div>
    {plan.needsReconciliation&&<p role="status">有工作包停止尚未确认，请核对原收据；计划尚未完成停止。</p>}
    <ul>{plan.packages.map(item=><li key={item.id}><strong>{item.id}</strong> · {snapshot.bots?.find(bot=>bot.id===item.targetBotId)?.name??item.targetBotId} · {TASK_STATES[item.state]??item.state}
      {item.dependsOn.length>0&&<small> 前置：{item.dependsOn.join('、')}</small>}{item.result?.code==='DEPENDENCY_FAILED'&&<small> 前置包失败，尚未执行</small>}</li>)}</ul>
  </article>)}{rows.length === 0 ? <p className="bp-empty">尚无持久任务。在 Main 私聊中提出目标后，可在这里查看工作包、执行尝试与收据。</p> : <div className="bp-table-wrap"><table>
    <thead><tr><th>任务</th><th>Bot</th><th>状态</th><th>执行尝试</th><th>操作</th></tr></thead><tbody>{rows.map(row => {
      const id = row.taskId ?? row.id
      const canCancel = !['cancelled', 'succeeded', 'failed', 'skipped'].includes(row.state)
      const remote = row.result?.remote
      // A terminal Task state alone does not prove that the original remote
      // operation stopped. The host still makes the authoritative decision.
      const stopKnown = !remote || remote.stopConfirmed === true
      return <tr key={id}><td><button className="bp-text-button" onClick={() => setSelected(id)}>{row.title ?? row.input?.task ?? id}</button><small>{id}</small></td>
        <td>{snapshot.bots?.find(bot => bot.id === row.botId)?.name ?? row.botId ?? '未取得归属'}</td><td><Tag>{TASK_STATES[row.state] ?? row.state}</Tag>{row.blockedReason && <small>{row.blockedReason}</small>}
          {remote&&(!stopKnown?<small role="status">写入或停止尚未确认，请核对原操作；不会自动重发，也暂不能重试。</small>:remote.notStarted===true&&remote.possiblyApplied!==true?<small>原操作未启动。</small>:remote.status==='succeeded'?<small>写入已确认。{row.state==='cancelled'?'取消未撤销文件变更。':''}</small>:remote.possiblyApplied===true&&<small>操作已停止，文件可能已改变；重试不会撤销已有变更，请先核对产物。</small>)}
        </td>
        <td>{Number.isSafeInteger(row.attempts)?row.attempts:row.attempts?.length ?? row.attemptCount ?? '未知'}</td><td className="bp-actions">
          {actions.includes('task.cancel') && canCancel && <button disabled={busy} onClick={() => dispatch('task.cancel', { botId:row.botId,taskId: id })}>停止</button>}
          {actions.includes('task.retry') && ['failed', 'cancelled', 'waiting-budget'].includes(row.state) && <button disabled={busy || !stopKnown} onClick={() => { if (stopKnown) dispatch('task.retry', { botId:row.botId,taskId: id, requestKey: crypto.randomUUID() }) }}>重试</button>}
          {actions.includes('task.reconcile') && row.state === 'needs-reconciliation' && <button disabled={busy} onClick={() => dispatch('task.reconcile', { botId:row.botId,taskId: id, requestKey: crypto.randomUUID() })}>核对原收据</button>}
        </td></tr>
    })}</tbody></table></div>}
    {task && <article className="bp-card"><div className="bp-card-title"><h2>任务详情</h2><button onClick={() => setSelected(null)}>关闭</button></div>
      <dl className="bp-facts"><Value label="Task">{task.taskId ?? task.id}</Value><Value label="Package">{task.packageId}</Value><Value label="Attempt">{task.attemptId}</Value><Value label="Operation">{task.operationId}</Value>
        <Value label="期限">{task.deadlineAt ? new Date(task.deadlineAt).toLocaleString('zh-CN') : '未取得'}</Value><Value label="MR 运行">{task.legacyRunIds?.join('、')}</Value></dl>
      <h3>执行与收据依据</h3><pre>{JSON.stringify({ attempts: task.attempts, executionRef: task.executionRef, remoteReceipt:task.result?.remote,reconciliation: task.reconciliation, packages: task.packages }, null, 2)}</pre>
    </article>}
  </>
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
  const rootId = machine?.roots?.[0]?.id ?? ''
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
  const [tunnel, setTunnel] = React.useState(true)
  const [status, setStatus] = React.useState('')
  const [error, setError] = React.useState('')
  const [working, setWorking] = React.useState(false)
  const parsed = React.useMemo(() => parsePairingPaste(paste), [paste])
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
        if (response && response.ok === false) throw new Error(response.error?.message ?? response.error ?? '宿主拒绝了这一步。')
        return response
      }
      await unwrap(await dispatch('machine.secret', { name: secretName, value: parsed.token }))
      const existing = (snapshot.machines?.items ?? []).find(item => item.id === parsed.machineId)
      await unwrap(await dispatch('machine.pair', {
        name: parsed.clientId || parsed.machineId,
        machineId: parsed.machineId,
        endpoint: endpoint.endpoint,
        secretRef: 'ds-secret/' + secretName,
        roots: ['project'],
        probeBotId: snapshot.bots?.[0]?.id ?? '',
        protectedTunnel: tunnel,
        tools: ['machine_ping', 'fs_list', 'fs_read', 'fs_write', 'shell_exec', 'operation_status', 'operation_cancel', 'artifact_stat', 'artifact_read', 'desktop_screenshot', 'desktop_click', 'desktop_type', 'desktop_key', 'desktop_scroll'],
        expectedRevision: existing?.revision ?? 0,
      }))
      setStatus('已添加 ' + (parsed.clientId || parsed.machineId) + '，几秒后体检会刷新状态。')
      setPaste('')
    } catch (failure) {
      setError(String(failure?.message ?? failure))
    } finally {
      setWorking(false)
    }
  }
  return <details className="bp-card"><summary>添加电脑（导入配对文件）</summary>
    <p className="bp-muted">在目标电脑上运行 <code>node dist/cli.mjs pair config.json 名称 ceiling.json &gt; pair.json</code>，把生成的 <code>pair.json</code> 导入即可；文件里已有 token、machineId 与 secretRef，不用手抄。</p>
    {available.includes('machine.secret') && available.includes('machine.pair') ? <div className="bp-form">
      <label>配对文件<input type="file" accept=".json,application/json" onChange={event => { void importFile(event) }} /></label>
      <label>或粘贴文件内容<textarea rows={3} value={paste} onChange={event => setPaste(event.target.value)} placeholder='{"clientId":"host-office","token":"...","machineId":"machine-..."}' /></label>
      <label>Agent 地址<input value={address} onChange={event => setAddress(event.target.value)} placeholder="10.0.0.2 或 http://10.0.0.2:9701" autoComplete="off" spellCheck={false} /></label>
      <label><input type="checkbox" checked={tunnel} onChange={event => setTunnel(event.target.checked)} />地址位于已配置的 WireGuard / Tailscale 受保护隧道</label>
      {paste !== '' && parsed.problems.length > 0 && <p className="bp-error" role="alert">{parsed.problems.join(' ')}</p>}
      {address !== '' && endpoint.problem !== '' && <p className="bp-error" role="alert">{endpoint.problem}</p>}
      {ready && <p className="bp-muted">将保存凭据 <code>ds-secret/{secretName}</code> 并配对 {parsed.machineId}。</p>}
      <button type="button" disabled={!ready || busy || working} onClick={() => { void submit() }}>{working ? '添加中…' : '导入并添加'}</button>
      {status !== '' && <p className="bp-muted" role="status">{status}</p>}
      {error !== '' && <p className="bp-error" role="alert">{error}</p>}
    </div> : <p className="bp-muted">宿主尚未提供配对操作。</p>}
  </details>
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

export function Machines({ snapshot, dispatch, busy }) {
  // The Bot drawer's desktop tab reads this bridge: it lives in the vendored client, which owns no
  // remote authority, so every call still runs through this panel's owner channel.
  React.useEffect(() => {
    if (typeof dispatch !== 'function') return undefined
    const rows = (snapshot.machines?.items ?? []).filter(item => item.status !== 'revoked')
    globalThis.__dshDesktop = Object.freeze({
      machines: () => rows.map(item => ({ machineId: item.id, rootId: item.roots?.[0]?.id ?? '', label: item.name ?? item.id })),
      view: (botId, machineId) => {
        const machine = rows.find(item => item.id === machineId)
        return dispatch('machine.desktop.view', { botId, machineId, rootId: machine?.roots?.[0]?.id ?? '' })
      },
      act: (botId, machineId, screenshotId, action) => {
        const machine = rows.find(item => item.id === machineId)
        return dispatch('machine.desktop.act', { botId, machineId, rootId: machine?.roots?.[0]?.id ?? '', screenshotId, action })
      },
    })
    return () => { delete globalThis.__dshDesktop }
  }, [dispatch, snapshot.machines])

  const section = snapshot.machines
  if (section?.status !== 'available') return <Blocked value={section} />
  return <>{dispatch&&<><DesktopControl snapshot={snapshot} dispatch={dispatch} busy={busy} />
    <MachineSetup snapshot={snapshot} dispatch={dispatch} busy={busy} /></>}{section.items.length ? <div className="bp-grid">{section.items.map(machine => <article className="bp-card" key={machine.id ?? machine.machineId}>
    <div className="bp-card-title"><h2>{machine.name ?? machine.id ?? machine.machineId}</h2><Tag>{machine.status ?? '未知'}</Tag></div>
    <dl className="bp-facts"><Value label="平台">{machine.platform}</Value><Value label="Agent 版本">{machine.version}</Value><Value label="最后在线">{machine.lastSeenAt ? new Date(machine.lastSeenAt).toLocaleString('zh-CN') : '从未取得心跳'}</Value>
      <Value label="能力">{machine.capabilities?.join('、')}</Value><Value label="桌面会话">{machine.desktop?.status ?? '未报告'}</Value></dl>
    {(machine.blockedReason || machine.status !== 'online') && <Blocked value={{ reason: machine.blockedReason ?? '机器未在线，任务不会派到此机器。', nextAction: machine.nextAction ?? '启动 Agent 并检查配对、网络及登录桌面。' }} />}
    {machine.revocations?.some(item=>item.status!=='revoked')&&<aside className="bp-blocked" role="status"><strong>远程停止尚未确认</strong><p>本机授权已经撤销。目标电脑恢复连接后，可重新确认远程票据撤销；此操作不会恢复任何权限。</p>
      {dispatch&&snapshot.availableActions?.includes('machine.reconcile')&&<button type="button" disabled={busy} onClick={()=>dispatch('machine.reconcile',{machineId:machine.id})}>重试确认远程撤销</button>}</aside>}
    {dispatch&&machine.status!=='revoked'&&<><MachineControls machine={machine} snapshot={snapshot} dispatch={dispatch} busy={busy} /><ArtifactDownload machine={machine} snapshot={snapshot} dispatch={dispatch} busy={busy} /></>}
  </article>)}</div> : <p className="bp-empty">尚未配对远程电脑。安装同版本 Agent，核验指纹并授予所需根目录后，机器会显示在这里。</p>}</>
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

export function Usage({ snapshot, dispatch, busy, openAdvanced }) {
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
    {!section.items.length ? <p className="bp-empty">尚无费用收据。</p> : <div className="bp-table-wrap"><table><thead><tr><th>Bot / 任务</th><th>来源</th><th>准确模型</th><th>金额</th><th>状态</th></tr></thead>
      <tbody>{section.items.map((row, i) => <tr key={row.id ?? row.receiptId ?? i}><td>{row.botName ?? row.botId ?? '未归属'}<small>{row.taskId ?? row.runId}</small></td>
        <td>{({ bot: 'Bot 对话', aux: 'Bot 辅助调用', 'mr-api': 'MR API', cli: '官方 CLI', review: '评审' })[row.source] ?? row.source ?? '未报告'}</td>
        <td>{modelName(row.model ?? (row.provider ? { provider: row.provider, model: row.modelId } : null))}</td><td>{row.billing === 'subscription' ? '订阅' : money(row.amountUsd ?? row.costUsd)}</td>
        <td>{row.status ?? '未知'}{row.resolution && <Tag>{row.resolution.kind === 'waive' ? '已按零费用放行' : `已确认 ${money(row.resolution.costUsd)}`}</Tag>}</td></tr>)}</tbody></table></div>}
    <button onClick={openAdvanced}>打开高级费用、订阅与历史能力</button>
  </>
}

export function ProductPage({ section, productApi, openSession, openPanel }) {
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [snapshotStale, setSnapshotStale] = useState(false)
  const lifecycle = useRef({ live: false, epoch: 0, request: 0 })
  const snapshotApi = useRef(null)
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
    setSnapshotStale(true); setBusy(false)
    let timer, stopped = false
    const loop = async () => { await refresh(controller.signal); if (!stopped) timer = setTimeout(loop, document.hidden ? 15000 : 4000) }
    void loop()
    return () => { stopped = true; state.live = false; state.epoch++; state.request++; controller.abort(); clearTimeout(timer) }
  }, [refresh])
  const dispatch = async (action, payload) => {
    if (busy || snapshotStale || snapshot?.readOnly || snapshotApi.current !== productApi || !lifecycle.current.live) return
    const state = lifecycle.current, epoch = state.epoch
    const current = () => state.live && state.epoch === epoch
    setBusy(true)
    try {
      const result = await productApi.dispatch(action, payload)
      if (!current()) return result
      await refresh()
      if (current() && result?.warning) setError('宿主已撤销授权，但远程停止尚未确认；请恢复连接并检查 Agent。')
      return result
    } catch (cause) { if (current()) { state.request++; setSnapshotStale(true); setError(cause.message) } } finally { if (current()) setBusy(false) }
  }
  const disabled = busy || snapshotStale || snapshotApi.current !== productApi || Boolean(snapshot?.readOnly)
  const title = { bindings: 'Bot 绑定与权限', tasks: '任务', machines: '远程电脑', usage: '费用与用量' }[section]
  return <main className="bp-page"><header><div><p className="bp-eyebrow">BOT 工作系统</p><h1>{title}</h1></div><button disabled={busy} onClick={() => refresh()}>刷新</button></header>
    {error && <div role="alert" className="bp-blocked"><strong>无法取得最新宿主状态</strong><p>{error}</p>{snapshot && <p>{snapshotStale ? '下面保留上次读取结果；状态未更新时，操作暂不可用。' : '下面保留上次读取结果，操作以宿主当前授权为准。'}</p>}</div>}
    {snapshot?.readOnly && <Blocked value={{ reason: snapshot.readOnly, nextAction: '关闭持有写锁的另一宿主后重新加载。' }} />}
    {!snapshot && !error && <p role="status">正在读取宿主状态…</p>}
    {snapshot && <>{section === 'bindings' && <BotBindings snapshot={snapshot} openSession={openSession} dispatch={dispatch} busy={disabled} />}
      {section === 'tasks' && <Tasks snapshot={snapshot} dispatch={dispatch} busy={disabled} />}
      {section === 'machines' && <Machines snapshot={snapshot} dispatch={dispatch} busy={disabled} />}
      {section === 'usage' && <Usage snapshot={snapshot} dispatch={dispatch} busy={disabled} openAdvanced={() => openPanel('model-router-galgame')} />}
      <footer className="bp-muted">宿主读取时间：{new Date(snapshot.observedAt).toLocaleString('zh-CN')}</footer></>}
  </main>
}
