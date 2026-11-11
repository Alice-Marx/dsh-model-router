import React, { useCallback, useEffect, useRef, useState } from 'react'
import { UiIcon } from './ui-icons.jsx'

/**
 * The Data panel: the human-facing half of the load → describe → sql → show →
 * export loop. It is embeddable and chat-first; the parent wires its entry
 * (see data-wiring.patch). It renders ONLY declared data — a semantic table or
 * an inline SVG chart built from a declarative series — and never executes
 * HTML or JavaScript (no dangerouslySetInnerHTML anywhere). Real data, real
 * errors and real limits (truncated / row caps / byte caps) are always shown.
 *
 * Props mirror the other panels; `transport` is the raw owner dispatch so a
 * page or query does not refresh the whole snapshot (the Machines pattern).
 * `scope` is the parent's Host handle (productApi): when it changes — a new
 * Host, a new connection — everything in flight is dropped and the panel starts
 * over, so a late answer from the previous Host can never land in this one.
 * `busy`, `dispatch` and `transport` stay exactly as they were; `scope` is
 * optional and a panel without one behaves like before.
 */

const SERIES_COLORS = ['#5b7cba', '#c07ab0', '#5fa38a', '#c99a5b', '#8a7fc0', '#b06a6a']
/** No bots, ever: a stable empty list keeps the effects from re-running. */
const NO_BOTS = []
/** A request that outlives this is reported as a timeout, never silently dropped. */
const REQUEST_TIMEOUT_MS = 45_000
const CANCEL_TIMEOUT_MS = 10_000

const errorMessage = value => {
  if (value?.error) return value.error.message ?? '操作失败。'
  return ''
}

const formatCell = cell => {
  if (cell === null || cell === undefined) return ''
  if (typeof cell === 'boolean') return cell ? 'true' : 'false'
  return String(cell)
}

/** A category label for a declared point; a null x is shown, never guessed. */
const categoryOf = point => (point?.x === null || point?.x === undefined ? '（空）' : String(point.x))
/** Only a finite number may become a coordinate. */
const finiteY = value => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/** A semantic, read-only table. Cells are text nodes; nothing is interpreted. */
export function DataTable({ columns, rows, caption }) {
  if (!columns?.length) return <p className="bp-muted">没有可显示的列。</p>
  return (
    <div className="bp-data-table-wrap">
      <table className="bp-data-table">
        {caption && <caption>{caption}</caption>}
        <thead><tr>{columns.map((column, index) => <th key={`${column.name}-${index}`} scope="col">{column.name}<span className="bp-data-type">{column.type}</span></th>)}</tr></thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{formatCell(cell)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Inline SVG bar/line/area chart from a declarative series. No scripts run. */
export function DataChart({ chart }) {
  const width = 640
  const height = 260
  const pad = { top: 12, right: 12, bottom: 44, left: 52 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  // NaN/Infinity are not data points: they are dropped before any coordinate is
  // computed, so no NaN ever reaches an SVG attribute.
  const series = (chart?.series ?? [])
    .map(entry => ({ key: entry.key, points: (entry.points ?? []).filter(point => finiteY(point.y) !== null) }))
    .filter(entry => entry.points.length)
  if (!series.length) return <p className="bp-muted">图表没有可绘制的数据点。</p>

  const categories = [...new Set(series.flatMap(entry => entry.points.map(categoryOf)))]
  const values = series.flatMap(entry => entry.points.map(point => point.y))
  const maxY = values.length ? Math.max(...values) : 0
  // Zero is always on the scale, so the baseline below is always inside the plot.
  const minY = values.length ? Math.min(...values, 0) : 0
  const span = maxY - minY || 1
  const xStep = categories.length ? plotW / categories.length : plotW
  const yOf = value => pad.top + plotH - ((value - minY) / span) * plotH
  const xOf = index => pad.left + index * xStep + xStep / 2
  const baseline = yOf(0)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(fraction => minY + span * fraction)
  // Show a bounded number of category labels so 375px stays readable.
  const labelEvery = Math.max(1, Math.ceil(categories.length / 8))

  return (
    <figure className="bp-data-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${chart.type} 图：${chart.xLabel} 对 ${chart.yLabel}`} preserveAspectRatio="xMidYMid meet">
        <title>{`${chart.type} 图：${chart.xLabel} 对 ${chart.yLabel}`}</title>
        {yTicks.map((tick, index) => (
          <g key={`t${index}`}>
            <line x1={pad.left} x2={width - pad.right} y1={yOf(tick)} y2={yOf(tick)} className="bp-data-grid" />
            <text x={pad.left - 8} y={yOf(tick) + 4} textAnchor="end" className="bp-data-axis">{Number.isInteger(tick) ? tick : tick.toFixed(1)}</text>
          </g>
        ))}
        {categories.map((category, index) => (
          index % labelEvery === 0
            ? <text key={`c${index}`} x={xOf(index)} y={height - pad.bottom + 18} textAnchor="middle" className="bp-data-axis">{category.length > 10 ? `${category.slice(0, 9)}…` : category}</text>
            : null
        ))}
        {chart.type === 'bar' && series.map((entry, sIndex) => entry.points.map((point, index) => {
          const categoryIndex = categories.indexOf(categoryOf(point))
          if (categoryIndex < 0) return null
          const barW = Math.max(2, (xStep / series.length) - 2)
          const x = pad.left + categoryIndex * xStep + (sIndex * barW) + (series.length > 1 ? 1 : (xStep - barW) / 2)
          const value = yOf(point.y)
          // A bar is drawn from the ZERO baseline: a negative value extends below
          // it, a positive one above, and neither is clipped into the axis.
          const top = Math.min(value, baseline)
          const barHeight = Math.max(1, Math.abs(baseline - value))
          return <rect key={`${sIndex}-${index}`} x={x} y={top} width={barW} height={barHeight} fill={SERIES_COLORS[sIndex % SERIES_COLORS.length]} rx="2" />
        }))}
        {(chart.type === 'line' || chart.type === 'area') && series.map((entry, sIndex) => {
          const color = SERIES_COLORS[sIndex % SERIES_COLORS.length]
          const drawn = entry.points.filter(point => categories.indexOf(categoryOf(point)) >= 0)
          if (drawn.length < 1) return null
          const path = drawn.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xOf(categories.indexOf(categoryOf(point)))} ${yOf(point.y)}`).join(' ')
          // An area closes on the ZERO baseline, not on the bottom of the plot,
          // so the filled region is the value itself and stays readable with
          // negative values on the same axis.
          const areaPath = `${path} L ${xOf(categories.indexOf(categoryOf(drawn.at(-1))))} ${baseline} L ${xOf(categories.indexOf(categoryOf(drawn[0])))} ${baseline} Z`
          return (
            <g key={`s${sIndex}`}>
              {chart.type === 'area' && <path d={areaPath} fill={color} opacity="0.18" />}
              <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {drawn.map((point, index) => <circle key={index} cx={xOf(categories.indexOf(categoryOf(point)))} cy={yOf(point.y)} r="2.5" fill={color} />)}
            </g>
          )
        })}
      </svg>
      {series.length > 1 && <figcaption className="bp-data-legend">{series.map((entry, sIndex) => (
        <span key={entry.key}><i style={{ background: SERIES_COLORS[sIndex % SERIES_COLORS.length] }} aria-hidden="true" />{entry.key}</span>
      ))}</figcaption>}
    </figure>
  )
}

const CHART_TYPES = [['bar', '柱形图'], ['line', '折线图'], ['area', '面积图']]
const CHART_AGGS = [['sum', '求和'], ['avg', '平均'], ['min', '最小'], ['max', '最大']]
const looksNumeric = type => /INT|REAL|NUM|DEC|FLOA|DOUB|BOOL/i.test(String(type ?? ''))

export function DataPanel({ snapshot, dispatch, busy, focus, transport, scope, requestTimeoutMs = REQUEST_TIMEOUT_MS }) {
  const bots = snapshot?.bots ?? NO_BOTS
  const call = useCallback(async (action, payload, { timeoutMs = requestTimeoutMs } = {}) => {
    const send = typeof transport === 'function' ? transport : dispatch
    if (typeof send !== 'function') throw new Error('宿主未连接，无法执行该操作。')
    const controller = new AbortController()
    inflight.current.add(controller)
    let timer = null
    try {
      const value = await Promise.race([
        Promise.resolve(send(action, payload, controller.signal)),
        new Promise((resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('宿主响应超时；本次结果已放弃，不会自动重放。')) }, timeoutMs)
          timer?.unref?.()
        }),
      ])
      // No answer is not a success: the Host said nothing, so nothing is applied.
      if (value === undefined) throw new Error('宿主没有返回结果；本次操作已放弃，不会自动重放。')
      const message = errorMessage(value)
      if (message) throw new Error(message)
      return value
    } finally {
      if (timer !== null) clearTimeout(timer)
      inflight.current.delete(controller)
    }
  }, [transport, dispatch, scope, requestTimeoutMs])

  const [botId, setBotId] = useState(bots[0]?.id ?? '')
  const [catalog, setCatalog] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [working, setWorking] = useState(false)
  const [sql, setSql] = useState('')
  const [result, setResult] = useState(null)
  const [card, setCard] = useState(null)
  const [loadForm, setLoadForm] = useState({ from: 'library', path: '', content: '', format: 'csv', name: '' })
  // The chart editor works from the REAL columns of a result the Host returned;
  // nothing is guessed from the SQL text.
  const [chartSource, setChartSource] = useState(null)
  const [chartColumns, setChartColumns] = useState([])
  const [chartDraft, setChartDraft] = useState({ type: 'bar', x: '', y: '', agg: 'sum' })
  const sequence = useRef(0)
  const inflight = useRef(new Set())

  /** Re-read the catalog for the current Bot; a stale token applies nothing. */
  const refresh = useCallback(async token => {
    const value = await call('data.catalog', { botId })
    if (token !== sequence.current) return
    setCatalog(value)
    setError('')
  }, [botId, call])

  /** Drop every answer still on the wire; the next request starts a new generation. */
  const dropInflight = useCallback(() => {
    sequence.current += 1
    for (const controller of inflight.current) controller.abort()
    inflight.current.clear()
  }, [])

  // A new Host (scope), a new Bot or a new transport: nothing from before may
  // land here, so the generation moves and every in-flight request is aborted.
  useEffect(() => {
    dropInflight()
    setCatalog(null); setResult(null); setCard(null); setChartSource(null); setChartColumns([])
    if (!botId) return
    const token = sequence.current
    void refresh(token).catch(failure => { if (token === sequence.current) setError(String(failure?.message ?? failure)) })
  }, [botId, call, dropInflight, refresh])

  // Hidden or unmounted: late answers are dropped instead of applied.
  useEffect(() => () => { dropInflight() }, [dropInflight])

  useEffect(() => { if (!botId && bots[0]) setBotId(bots[0].id) }, [botId, bots])
  // A Bot that is no longer in the team must not keep serving requests: the
  // selection is replaced (and said out loud) rather than silently reused.
  useEffect(() => {
    if (!botId || bots.some(bot => bot.id === botId)) return
    const next = bots[0]?.id ?? ''
    setBotId(next)
    setStatus(next ? '之前选择的 Bot 已不在团队中，已切换到当前列表中的 Bot。' : '之前选择的 Bot 已不在团队中；请先创建一个 Bot。')
  }, [bots, botId])
  useEffect(() => { if (focus?.botId && bots.some(bot => bot.id === focus.botId)) setBotId(focus.botId) }, [focus?.version, focus?.botId])

  const perform = async work => {
    const token = ++sequence.current
    setWorking(true); setError(''); setStatus('')
    try { await work(token) } catch (failure) { if (token === sequence.current) setError(String(failure?.message ?? failure)) } finally { if (token === sequence.current) setWorking(false) }
  }

  /** Stop the statement at the Host. A cancel is a request, never a confirmation. */
  const cancelWork = () => {
    dropInflight()
    setWorking(false)
    const token = sequence.current
    void (async () => {
      try {
        await call('data.cancel', { botId }, { timeoutMs: CANCEL_TIMEOUT_MS })
        if (token === sequence.current) setStatus('已请求取消：宿主会中止正在执行的语句。取消请求不等于取消确认。')
      } catch (failure) { if (token === sequence.current) setError(String(failure?.message ?? failure)) }
    })()
  }

  const disabled = busy || working || !botId
  const tables = catalog?.tables ?? []
  const cards = catalog?.cards ?? []

  /** Open the chart editor from the columns a real result actually returned. */
  const beginChart = (columns, source) => {
    const list = columns ?? []
    const numeric = list.filter(column => looksNumeric(column.type)).map(column => column.name)
    setChartSource(source); setChartColumns(list)
    setChartDraft({ type: 'bar', x: list[0]?.name ?? '', y: numeric[0] ?? '', agg: 'sum' })
  }

  if (!bots.length) return <p className="bp-empty">还没有 Bot。先创建一个 Bot，再为它加载数据。</p>

  return (
    <article className="bp-card bp-data">
      <div className="bp-card-title">
        <h2>数据</h2>
        <select aria-label="数据 Bot" value={botId} disabled={working} onChange={event => { setBotId(event.target.value); setStatus('') }}>
          {bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name ?? bot.id}</option>)}
        </select>
      </div>
      <p className="bp-muted">按 Bot 隔离的 SQLite 数据集：从资料库或内联内容加载，用 SQL 查询，渲染为表格或图表并导出 CSV。所有结果按行数、列数与字节设上限；超时查询会被取消，不会挂起界面。</p>

      {error && <p className="bp-error" role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {working && <p className="bp-muted">正在等待宿主…<button className="bp-text-button" onClick={cancelWork}>取消执行</button></p>}

      <section className="bp-data-load" aria-label="加载数据集">
        <h3>加载数据集</h3>
        <div className="bp-data-load-form">
          <label>来源
            <select value={loadForm.from} onChange={event => setLoadForm({ ...loadForm, from: event.target.value })}>
              <option value="library">资料库文件</option>
              <option value="content">内联 CSV / JSON</option>
            </select>
          </label>
          {loadForm.from === 'library'
            ? <label>资料库路径<input value={loadForm.path} onChange={event => setLoadForm({ ...loadForm, path: event.target.value })} placeholder="data/sales.csv" /></label>
            : <label>内容<textarea rows={4} value={loadForm.content} onChange={event => setLoadForm({ ...loadForm, content: event.target.value })} placeholder="col1,col2&#10;a,1" /></label>}
          <label>格式
            <select value={loadForm.format} onChange={event => setLoadForm({ ...loadForm, format: event.target.value })}>
              <option value="csv">CSV</option><option value="tsv">TSV</option><option value="json">JSON</option>
            </select>
          </label>
          <label>表名<input value={loadForm.name} onChange={event => setLoadForm({ ...loadForm, name: event.target.value })} placeholder="默认取文件名" /></label>
          <button className="bp-button-primary" disabled={disabled} onClick={() => { void perform(async token => {
            const value = await call('data.load', { botId, from: loadForm.from, path: loadForm.path, content: loadForm.content, format: loadForm.format, name: loadForm.name || undefined })
            if (token !== sequence.current) return
            const loaded = value?.tables?.[0]
            setStatus(loaded ? `已加载 ${loaded.name}：${loaded.rowCount} 行，${loaded.columns.length} 列。` : '已加载。')
            await refresh(token)
          }) }}>加载</button>
        </div>
      </section>

      <section className="bp-data-catalog" aria-label="数据集目录">
        <h3>已加载的表</h3>
        {!tables.length ? <p className="bp-muted">还没有加载任何表。</p> : (
          <ul className="bp-data-tables">
            {tables.map(table => (
              <li key={table.name}>
                <button className="bp-text-button" disabled={disabled} onClick={() => { void perform(async token => {
                  setResult(null)
                  const value = await call('data.show', { botId, table: table.name, kind: 'table', title: table.name })
                  if (token !== sequence.current) return
                  setCard(value)
                }) }}>{table.name}</button>
                <span className="bp-muted">{table.columns.map(column => column.name).join(', ')}</span>
                <span className="bp-row-actions">
                  <button disabled={disabled} onClick={() => { void perform(async token => {
                    const statement = `SELECT * FROM ${table.name} LIMIT 100`
                    const value = await call('data.sql', { botId, sql: statement })
                    if (token !== sequence.current) return
                    setSql(statement); setCard(null); setResult(value)
                    beginChart(value.columns, { table: table.name })
                  }) }}>查询</button>
                  <button disabled={disabled} onClick={() => { void perform(async token => {
                    beginChart(table.columns, { table: table.name })
                    if (token === sequence.current) setStatus(`已按 ${table.name} 的真实列打开图表编辑。`)
                  }) }}>图表</button>
                  <button disabled={disabled} onClick={() => { void perform(async token => {
                    const value = await call('data.export', { botId, table: table.name, filename: table.name })
                    if (token !== sequence.current) return
                    setStatus(exportStatus(value))
                  }) }}>导出 CSV</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bp-data-query" aria-label="SQL 查询">
        <h3>SQL 查询</h3>
        <textarea rows={3} value={sql} onChange={event => setSql(event.target.value)} placeholder="SELECT region, SUM(sales) AS total FROM sales GROUP BY region" aria-label="SQL" />
        <div className="bp-actions">
          <button className="bp-button-primary" disabled={disabled || !sql.trim()} onClick={() => { void perform(async token => {
            setCard(null)
            const value = await call('data.sql', { botId, sql })
            if (token !== sequence.current) return
            setResult(value)
            beginChart(value.columns, { sql })
          }) }}>运行</button>
        </div>
        {result && <div className="bp-data-result">
          <p className="bp-muted">{result.table ? `结果表 ${result.table} · ` : ''}{result.rowCount} 行{result.truncated ? ' · 已截断（结果受上限约束）' : ''}</p>
          {result.error ? <p className="bp-error">{result.error.message}</p> : <DataTable columns={result.columns} rows={result.rows} />}
        </div>}
      </section>

      {chartSource && chartColumns.length > 0 && <section className="bp-data-chart-editor" aria-label="图表编辑">
        <h3>图表（按上面结果的真实列显式选择）</h3>
        <div className="bp-data-load-form">
          <label>类型
            <select value={chartDraft.type} onChange={event => setChartDraft({ ...chartDraft, type: event.target.value })}>
              {CHART_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>X 列（分组）
            <select value={chartDraft.x} onChange={event => setChartDraft({ ...chartDraft, x: event.target.value })}>
              {chartColumns.map(column => <option key={column.name} value={column.name}>{column.name}（{column.type}）</option>)}
            </select>
          </label>
          <label>Y 列
            <select value={chartDraft.y} onChange={event => setChartDraft({ ...chartDraft, y: event.target.value })}>
              <option value="">不选：按行计数</option>
              {chartColumns.map(column => <option key={column.name} value={column.name}>{column.name}（{column.type}）</option>)}
            </select>
          </label>
          {chartDraft.y && <label>聚合
            <select value={chartDraft.agg} onChange={event => setChartDraft({ ...chartDraft, agg: event.target.value })}>
              {CHART_AGGS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>}
          <button className="bp-button-primary" disabled={disabled || !chartDraft.x} onClick={() => { void perform(async token => {
            const chart = { type: chartDraft.type, x: chartDraft.x, ...(chartDraft.y ? { y: chartDraft.y, agg: chartDraft.agg } : {}) }
            const value = await call('data.show', { botId, ...chartSource, kind: 'chart', title: card?.title ?? '查询图表', chart })
            if (token !== sequence.current) return
            setCard(value)
          }) }}>生成图表</button>
        </div>
        <p className="bp-muted">列名来自宿主返回的真实结果；若所选组合无法聚合，宿主会直接报错，不会替您猜测。</p>
      </section>}

      {card && <section className="bp-data-card" aria-label="结果卡片">
        <div className="bp-card-title"><h3>{card.title ?? '结果'}</h3>
          <span className="bp-muted">{card.rowCount} 行{card.truncated ? ' · 已截断' : ''}</span>
          <button disabled={disabled} onClick={() => { void perform(async token => {
            const value = await call('data.export', { botId, cardId: card.id, filename: card.title ?? 'card' })
            if (token !== sequence.current) return
            setStatus(exportStatus(value))
          }) }}>导出 CSV</button>
        </div>
        {card.error ? <p className="bp-error">{card.error.message}</p> : card.chart
          ? <DataChart chart={card.chart} />
          : <DataTable columns={card.columns} rows={card.rows} />}
      </section>}

      {cards.length > 0 && <section className="bp-data-cards" aria-label="已保存卡片">
        <h3>已保存的卡片</h3>
        <ul className="bp-data-card-list">
          {cards.map(entry => (
            <li key={entry.id}>
              <button className="bp-text-button" disabled={disabled} onClick={() => { void perform(async token => {
                setResult(null)
                // A card is re-opened by its id — a chart card re-renders from
                // its saved spec instead of being looked up as a table.
                const value = await call('data.show', { botId, cardId: entry.id, kind: entry.kind })
                if (token !== sequence.current) return
                setCard(value)
              }) }}>{entry.title}</button>
              <span className="bp-muted">{entry.kind === 'chart' ? '图表' : '表格'}</span>
            </li>
          ))}
        </ul>
      </section>}
    </article>
  )
}

/** A completed export says what was written; a failed one never reaches here. */
function exportStatus(value) {
  const rows = `已导出 ${value.rowCount} 行`
  const source = value.sourceRowCount !== undefined && value.sourceRowCount !== value.rowCount ? `（源共 ${value.sourceRowCount} 行）` : ''
  const bytes = `，${value.bytes} 字节`
  const where = value.path ? `到 ${value.path}` : '（未写入资料库，仅返回内容）'
  const cut = value.truncated ? ' · 已截断' : ''
  return `${rows}${source}${bytes}${where}${cut}。`
}

export default DataPanel
