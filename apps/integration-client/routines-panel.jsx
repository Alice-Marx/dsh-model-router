import React, { useEffect, useState } from 'react'
import { normalizeRoutine } from '../../packages/orchestration/src/bot-routine.mjs'

const message = failure => String(failure?.message ?? failure)
const rootOf = machine => typeof machine?.roots?.[0] === 'string' ? machine.roots[0]
  : machine?.rootId ?? machine?.roots?.[0]?.rootId ?? machine?.roots?.[0]?.id ?? ''
const STATUS = { running: '正在执行', succeeded: '全部动作已确认', failed: '执行失败，已停止', cancelled: '已取消', unknown: '结果未知，需要检查电脑', cancel_pending: '正在请求停止' }

/** Render inside the actual desktop viewer; its transport supplies the recorder's ACK hooks. */
export function RoutineCaptureControls({ recorder, sessionId, metadata, mode, connected, drainInputs, releaseInput, saveRoutine }) {
  const [capture, setCapture] = useState(recorder.snapshot), [name, setName] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(null), [draft, setDraft] = useState(null)
  useEffect(() => { setCapture(recorder.snapshot); return recorder.subscribe(setCapture) }, [recorder])
  const start = () => {
    try { setError(''); setSaved(null); setDraft(null); recorder.start({ sessionId, metadata, mode }) }
    catch (failure) { setError(message(failure)) }
  }
  const finish = async () => {
    setBusy(true); setError('')
    try {
      let routine = draft
      if (!routine) {
        await drainInputs?.()
        const ack = await releaseInput?.()
        if (ack?.ok !== true) throw new Error('ROUTINE_RELEASE_UNCONFIRMED')
        recorder.released({ sessionId, ok: true })
        routine = recorder.finish({ name }); setDraft(routine)
      }
      const value = await saveRoutine(routine)
      if (value?.ok === false) throw new Error(value.error?.message ?? value.error ?? '保存失败。')
      let confirmed = false
      try {
        confirmed = typeof value?.id === 'string' && /^routine-[A-Za-z0-9-]+$/u.test(value.id)
          && Number.isSafeInteger(value.createdAt) && value.createdAt >= 0
          && JSON.stringify(normalizeRoutine(value)) === JSON.stringify(normalizeRoutine(routine))
      } catch {}
      if (!confirmed) throw Object.assign(new Error('保存尚未确认，草稿已保留。请刷新例行任务列表检查结果。'), { code: 'ROUTINE_SAVE_UNCONFIRMED' })
      setSaved(value); setDraft(null); recorder.reset()
    } catch (failure) { setError(message(failure)) }
    finally { setBusy(false) }
  }
  return <section className="bp-card bp-routine-capture" aria-label="录制例行任务">
    <h4>演示并保存例行任务</h4>
    <p className="bp-muted">取得控制权后开始录制，像平常一样操作这台电脑。仅保存远端已确认的鼠标、键盘和文字输入；输入文字也会保存在这个 Bot 的私有例行任务中。</p>
    <p className="bp-muted">这是固定显示器和分辨率的动作回放，最多 200 个步骤，单次停顿最多 60 秒。鼠标轨迹按 200 毫秒采样，保留点击和拖动结束位置；不适合精细绘图。开始前把应用恢复到相同界面；页面或布局改变时需要重新演示。</p>
    <div className="bp-actions"><input aria-label="例行任务名称" maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="例如：打开日报并填写日期" />
      <button disabled={busy || !connected || mode !== 'control' || capture.status === 'recording'} onClick={start}>开始录制</button>
      <button disabled={busy || !name.trim() || !(draft || capture.status === 'recording' && capture.length > 0)} onClick={() => { void finish() }}>{draft ? '重试保存' : '结束并保存'}</button>
      <button disabled={busy || capture.status === 'idle'} onClick={() => { recorder.reset(); setDraft(null); setError('') }}>丢弃录制</button></div>
    <p role="status">{capture.status === 'recording' ? `正在录制：${capture.length} 个回放步骤，${capture.observedInputs} 个输入已确认，${capture.pending} 个等待确认`
      : capture.status === 'invalid' ? `录制已中止：${capture.error}，请丢弃后重新演示。` : saved ? '例行任务已保存。' : '尚未录制。'}</p>
    {error && <p className="bp-error" role="alert">{error}</p>}
  </section>
}

/** Owner operations all use the authenticated product channel; model tools cannot reconcile. */
export function RoutinesPanel({ snapshot, dispatch, busy = false }) {
  const bots = snapshot.bots ?? [], machines = (snapshot.machines?.items ?? []).filter(row => row.status !== 'revoked')
  const [botId, setBotId] = useState(bots[0]?.id ?? ''), [machineId, setMachineId] = useState(machines[0]?.id ?? machines[0]?.machineId ?? '')
  const [rows, setRows] = useState([]), [runs, setRuns] = useState([]), [result, setResult] = useState(null)
  const [error, setError] = useState(''), [running, setRunning] = useState(false), [notes, setNotes] = useState({})
  useEffect(() => { if (!botId && bots[0]) setBotId(bots[0].id) }, [botId, bots[0]?.id])
  useEffect(() => { if (!machineId && machines[0]) setMachineId(machines[0].id ?? machines[0].machineId) }, [machineId, machines[0]?.id, machines[0]?.machineId])
  const call = async (action, payload) => {
    if (typeof dispatch !== 'function') throw new Error('宿主通道尚未就绪。')
    const value = await dispatch(action, payload)
    if (value?.ok === false) throw new Error(value.error?.message ?? value.error ?? '宿主拒绝了操作。')
    return value
  }
  const refresh = async () => {
    if (!botId) return
    try {
      const [saved, history] = await Promise.all([call('routine.list', { botId }), call('routine.history', { botId })])
      setRows(Array.isArray(saved) ? saved : []); setRuns(Array.isArray(history) ? history : [])
    } catch (failure) { setError(message(failure)) }
  }
  useEffect(() => { void refresh() }, [botId, dispatch])
  useEffect(() => {
    if (!running && !runs.some(row => row.status === 'running')) return undefined
    const timer = setInterval(() => { void refresh() }, 1_000)
    return () => clearInterval(timer)
  }, [running, botId, dispatch, runs.some(row => row.status === 'running')])
  const run = async routineId => {
    setError(''); setResult(null); setRunning(true)
    try {
      const machine = machines.find(row => (row.id ?? row.machineId) === machineId)
      setResult(await call('routine.run', { botId, routineId, machineId, rootId: rootOf(machine) }))
    } catch (failure) { setError(message(failure)) }
    finally { setRunning(false); await refresh() }
  }
  const stop = async runId => {
    try { await call('routine.cancel', { botId, runId }); await refresh() } catch (failure) { setError(message(failure)) }
  }
  const resolve = async runId => {
    try { await call('routine.resolve', { botId, runId, note: notes[runId] ?? '' }); await refresh() }
    catch (failure) { setError(message(failure)) }
  }
  if (!bots.length) return <p className="bp-empty">还没有 Bot。</p>
  return <article className="bp-card"><h2>例行任务</h2>
    <p className="bp-muted">先在远程桌面取得控制权，演示并保存动作。这里会真正连接所选电脑逐条回放，每个输入都等待远端确认；中途失败即停，确认丢失会阻止再次运行，直到你检查电脑上的实际结果。</p>
    <div className="bp-actions"><label>Bot<select disabled={running} value={botId} onChange={event => { setBotId(event.target.value); setResult(null); setError('') }}>
      {bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name ?? bot.id}</option>)}</select></label>
      <label>电脑<select disabled={running} value={machineId} onChange={event => setMachineId(event.target.value)}>
        {machines.map(machine => <option key={machine.id ?? machine.machineId} value={machine.id ?? machine.machineId}>{machine.name ?? machine.label ?? machine.id ?? machine.machineId}</option>)}</select></label>
      <button disabled={busy} onClick={() => { void refresh() }}>刷新</button></div>
    {error && <p className="bp-error" role="alert">{error}</p>}
    {!rows.length ? <p className="bp-muted">这个 Bot 还没有保存例行任务。</p> : <div className="bp-table-wrap"><table>
      <thead><tr><th>名称</th><th>来源 / 步数</th><th>操作</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}>
        <td>{row.name}{row.display && <small>{row.display.width} × {row.display.height} · {row.display.displayId}</small>}</td>
        <td>{row.demonstrated ? '桌面演示' : '手工步骤'} / {row.steps}</td>
        <td><button disabled={busy || running || !machineId || runs.some(run => run.machineId === machineId && (run.status === 'running' || run.status === 'unknown' && !run.resolvedAt))} onClick={() => { void run(row.id) }}>在这台电脑运行</button></td>
      </tr>)}</tbody></table></div>}
    {result && <p role="status">{STATUS[result.status] ?? result.status}{result.stoppedAt != null ? ` · 停在第 ${result.stoppedAt + 1} 步` : ''}{result.error ? ` · ${result.error}` : ''}</p>}
    <h3>执行记录</h3>{runs.slice().reverse().slice(0, 20).map(row => <section className="bp-blocked" key={row.runId}>
      <strong>{STATUS[row.status] ?? row.status}</strong><small>{row.runId}</small>
      <p>{row.steps.length} 步完成 · {row.evidence.filter(item => item.status === 'acknowledged').length} 个输入已确认{row.stoppedAt != null ? ` · 停在第 ${row.stoppedAt + 1} 步` : ''}</p>
      {row.error && <p className="bp-error">{row.error}</p>}
      {row.status === 'running' && <button onClick={() => { void stop(row.runId) }}>请求停止</button>}
      {row.status === 'unknown' && !row.resolvedAt && <div><p>检查远程电脑，确认任务已经做到哪里，并手动恢复到适合下一次运行的界面。</p>
        <input aria-label="检查结果" value={notes[row.runId] ?? ''} onChange={event => setNotes(before => ({ ...before, [row.runId]: event.target.value }))} placeholder="记录你检查到的结果和恢复操作" />
        <button disabled={!(notes[row.runId] ?? '').trim()} onClick={() => { void resolve(row.runId) }}>已检查实际结果，解除运行阻塞</button></div>}
      {row.resolvedAt && <p>已由你检查：{row.resolution?.note}</p>}
    </section>)}
  </article>
}
