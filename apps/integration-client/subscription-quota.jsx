import React, { useEffect, useState } from 'react'

const periods = { day: '今日', month: '本月' }
const time = (value, timeZone) => new Date(value).toLocaleString('zh-CN', { timeZone })
const calls = value => value.toLocaleString('zh-CN')

function windowLabel({ durationMinutes, id }) {
  if (durationMinutes === null) return id === 'primary' ? '主额度窗口' : '第二额度窗口'
  if (durationMinutes % 1440 === 0) return `${durationMinutes / 1440} 天窗口`
  if (durationMinutes % 60 === 0) return `${durationMinutes / 60} 小时窗口`
  return `${durationMinutes} 分钟窗口`
}

export function SubscriptionQuota({ productApi }) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState({ api: productApi, value: null, loading: true, error: false })

  useEffect(() => {
    const controller = new AbortController()
    setState(previous => ({ api: productApi, value: previous.api === productApi ? previous.value : null, loading: true, error: false }))
    void productApi.dispatch('usage.subscriptionQuota', {}, controller.signal).then(value => {
      if (!controller.signal.aborted) setState({ api: productApi, value, loading: false, error: false })
    }).catch(() => {
      if (!controller.signal.aborted) setState(previous => ({ ...previous, loading: false, error: true }))
    })
    return () => controller.abort()
  }, [productApi, revision])

  const { value, loading, error } = state.api === productApi ? state : { value: null, loading: true, error: false }
  return <section className="bp-card bp-quota" aria-label="订阅额度">
    <header className="bp-usage-heading">
      <div><h2>订阅额度</h2>{value && <p className="bp-muted">更新于 {time(value.observedAt, value.timezone)} · {value.timezone}</p>}</div>
      <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>刷新额度</button>
    </header>
    {loading && <p className="bp-muted" role="status">正在读取订阅额度…</p>}
    {error && <p role="alert">暂时无法读取订阅额度。{value ? '下面显示上次读取结果。' : ''}</p>}
    {value && <>
      <h3>Bot 调用上限</h3>
      {value.historyIncomplete && <p className="bp-muted">用量记录不完整，剩余次数暂不可确认。</p>}
      {value.bots.length === 0 && <p className="bp-muted">暂无生效的订阅调用上限。可在 Bot 的模型路线设置中配置每日和每月上限。</p>}
      {value.bots.map(bot => <article key={bot.id} className="bp-quota-entry">
        <strong>{bot.name}</strong>
        <div className="bp-quota-windows">{bot.windows.map(window => <div key={window.id} className="bp-quota-window">
          <div className="bp-quota-balance">
            <span>{periods[window.id]}</span>
            <strong>{window.remaining === null ? '剩余次数未知' : `剩余 ${calls(window.remaining)} 次`}</strong>
          </div>
          {window.remaining !== null && window.limit > 0 && <progress
            aria-label={`${bot.name} ${periods[window.id]}已占用次数`} value={Math.min(window.used, window.limit)} max={window.limit}/>}
          <small className="bp-muted">
            {window.used === null ? '占用未知' : `已占用 ${calls(window.used)} 次`} · 上限 {calls(window.limit)} 次
          </small>
          <small className="bp-muted">重置于 {time(window.resetAt, value.timezone)}</small>
        </div>)}</div>
      </article>)}
      {value.accountQuotas.length > 0 && <h3>Codex 账号额度</h3>}
      {value.accountQuotas.map(({ id, name, reading }) => <article key={id} className="bp-quota-entry">
        <div className="bp-quota-balance">
          <strong>{name}</strong>
          <small className="bp-muted">{reading ? `报告于 ${time(reading.observedAt, value.timezone)}` : '当前宿主会话尚未收到额度'}</small>
        </div>
        {reading && <div className="bp-quota-windows">{reading.windows.map(window => <div key={window.id} className="bp-quota-window">
          <div className="bp-quota-balance"><span>{windowLabel(window)}</span><strong>上次剩余 {window.remainingPercent}%</strong></div>
          <progress aria-label={`${name} ${windowLabel(window)}上次剩余额度`} value={window.remainingPercent} max={100}/>
          {window.resetAt !== null && <small className="bp-muted">
            重置于 {time(window.resetAt, value.timezone)}{window.resetAt <= value.observedAt && ' · 已过重置时间'}
          </small>}
        </div>)}</div>}
      </article>)}
      <h3>订阅通道限额</h3>
      {value.channelLimits.length === 0 && <p className="bp-muted">暂无仍生效的额度用尽或限流记录。</p>}
      {value.channelLimits.map(channel => <div key={channel.id} className="bp-quota-entry">
        <div className="bp-quota-balance">
          <strong>{channel.label}</strong>
          <span>{channel.kind === 'quota' ? '额度已用尽' : '通道限流'}</span>
        </div>
        <small className="bp-muted">{channel.resetReported ? '服务方报告的重置时间' : '宿主可重试时间'} {time(channel.until, value.timezone)}</small>
      </div>)}
    </>}
  </section>
}
