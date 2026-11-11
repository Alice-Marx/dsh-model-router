import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BotThreadsPanel } from '../../apps/integration-client/bot-threads-panel.jsx'
import { BotThreadHeader } from '../../apps/integration-client/bot-thread-header.jsx'
import botThreadsCss from '../../apps/integration-client/bot-threads.css'

// A controlled fixture for the thread surface: the real panel, the real
// chat-title addon and the real header control against a Host double whose
// answers the verification script can change while they are mounted —
// including a Host that answers late, or not at all.
const style = document.createElement('style')
style.textContent = botThreadsCss
document.head.append(style)
document.body.setAttribute('data-bot-product-ui', '1')
document.body.setAttribute('data-bp-appearance', 'light')

const rows = () => ([
  { threadId: 't-1', botId: 'bot-a', name: '排查线索甲', state: 'open', archivedAt: null, sessionId: 'sess-1', sessionState: 'owned', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_060_000, active: true },
  { threadId: 't-2', botId: 'bot-a', name: '排查线索乙', state: 'open', archivedAt: null, sessionId: 'sess-2', sessionState: 'owned', createdAt: 1_700_000_000_000, updatedAt: 1_700_000_030_000, active: false },
  { threadId: 't-3', botId: 'bot-a', name: '已归档的旧线索', state: 'archived', archivedAt: 1_700_000_090_000, sessionId: 'sess-3', sessionState: 'owned', createdAt: 1_699_999_000_000, updatedAt: 1_700_000_090_000, active: false },
])

const fixture = { calls: [], rows: rows(), available: true, opened: 0, openedSessions: [], made: 0, late: false }
window.__threadFixture = {
  calls: fixture.calls,
  openedSessions: fixture.openedSessions,
  // A late Host answer: the open thread's Session is no longer confirmed. The
  // rest of the list, the selection and any thread made meanwhile stay as they
  // are — a late answer changes one fact, not the whole directory.
  lateHost: () => { fixture.rows = fixture.rows.map(row => row.threadId === 't-2' ? { ...row, sessionState: 'unbound' } : row) },
  setAvailable: value => { fixture.available = value },
  countOpened: () => fixture.opened,
}

// The roster the native header would hand the control: a thread Session resolves
// to its Bot, and the thread itself is indexed by its own Session id.
const rosterOf = () => {
  const bots = [{ id: 'bot-a', name: '甲 Bot', sessionId: 'bot-a', parts: [], threads: fixture.rows }]
  const byId = { 'bot-a': bots[0] }, threadsById = {}
  for (const row of fixture.rows) {
    byId[row.sessionId] = bots[0]
    threadsById[row.sessionId] = { botId: 'bot-a', ...row }
  }
  return { revision: 1, bots, byId, roomsById: {}, threadsById, ready: true }
}

const api = {
  dispatch: (action, payload) => {
    fixture.calls.push({ action, payload })
    // The roster is the native projection: it follows the Host, so a write is
    // followed by a pull here, exactly as the product's own source does.
    if (action !== 'threads.list') window.__threadFixture.rerender?.()
    // The Host double answers like the store would: an open moves the selection
    // and answers with the real Session, a create prepends an active thread.
    if (action === 'threads.open') {
      const target = fixture.rows.find(row => row.threadId === payload.threadId)
      const created = payload.create === true
      const sessionId = target?.sessionId ?? (created ? `sess-new-${++fixture.made}` : null)
      if (created && target && target.sessionId === null) fixture.rows = fixture.rows.map(row => row.threadId === payload.threadId ? { ...row, sessionId, sessionState: 'owned' } : row)
      fixture.rows = fixture.rows.map(row => ({ ...row, active: row.threadId === payload.threadId }))
      return Promise.resolve({ botId: 'bot-a', threadId: payload.threadId, activeThreadId: payload.threadId, sessionId, sessionState: sessionId === null ? 'none' : 'owned', created, needsSession: sessionId === null })
    }
    if (action === 'threads.create') {
      const made = { threadId: `new-${fixture.calls.length}`, botId: 'bot-a', name: payload?.name ?? '新线程', state: 'open', archivedAt: null, sessionId: null, sessionState: 'none', createdAt: 1_700_000_100_000, updatedAt: 1_700_000_100_000, active: true }
      fixture.rows = [made, ...fixture.rows.map(row => ({ ...row, active: false }))]
      return Promise.resolve({ botId: 'bot-a', thread: made, created: true, threads: fixture.rows, activeThreadId: made.threadId })
    }
    if (action === 'threads.unarchive') fixture.rows = fixture.rows.map(row => row.threadId === payload.threadId ? { ...row, state: 'open', archivedAt: null } : row)
    if (action === 'threads.archive') fixture.rows = fixture.rows.map(row => row.threadId === payload.threadId ? { ...row, state: 'archived', archivedAt: 1_700_000_200_000, active: false } : row)
    const active = fixture.rows.find(row => row.active)?.threadId ?? null
    return Promise.resolve({ botId: 'bot-a', activeThreadId: active, threads: fixture.rows })
  },
}

function Fixture() {
  const [available, setAvailable] = useState(true)
  const key = useMemo(() => ({ n: 0 }), [])
  const [tick, setTick] = useState(0)
  window.__threadFixture.setAvailable = value => { fixture.available = value; setAvailable(value) }
  window.__threadFixture.rerender = () => setTick(value => value + 1)
  const roster = useMemo(() => rosterOf(), [tick])
  const active = fixture.rows.find(row => row.active) ?? null
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #dde1e8' }}>
        <strong>Bot 对话</strong>
        <BotThreadHeader productApi={api} roster={roster} sessionId={active?.sessionId ?? 'bot-a'}
          onOpenSession={id => fixture.openedSessions.push(id)}
          onOpenPanel={() => { fixture.opened += 1 }} />
      </header>
      <BotThreadsPanel key={key.n} productApi={api} botId='bot-a' available={available}
        onOpenSession={id => fixture.openedSessions.push(id)} />
    </div>
  )
}

createRoot(document.getElementById('root')).render(React.createElement(Fixture))
