// A durable, read-only notification feed derived from committed Task-journal
// events. It is a second READ of the journal, never a second execution
// authority: nothing here starts, stops, retries or approves a Task, and no
// notification text is taken from a model's own words or from task input —
// every line is composed from structured journal state (outcome, category, Bot
// name) plus the durable identity needed to open the original detail.
//
// Read state lives in this Host's own SQLite under a single owner scope. It is
// keyed by the journal's monotonic event `seq`, so the same event can never
// become two notifications, and an owner's read position never trusts a client
// clock: the browser may only confirm event ids it was actually shown, or ask
// to mark everything read (the Host computes that watermark itself).

// State transitions a person should hear about. Transient requests (a bare
// `cancel-requested`) are deliberately absent: a stop request is not a stop
// confirmation, so it must not read as a finished outcome.
export const NOTIFY_KINDS = Object.freeze([
  'settled', 'blocked', 'dependency-blocked', 'deadline', 'budget-wait-expired',
  'interrupted', 'admission-conflict', 'retry-fenced', 'reconciled',
  'cancelled-before-dispatch', 'cancelled-while-waiting-budget', 'admission-recovered-cancelled',
])

const SCOPE = 'owner'
const UNREAD_CAP = 512

// One structured category per outcome, with a tone the panel can colour without
// parsing any text. `reconcile` is the one that must never read as "stopped".
const categorize = (kind, outcome) => {
  if (kind === 'reconciled') return { category: 'reconciled', tone: 'ok' }
  if (kind === 'settled') {
    if (outcome === 'succeeded') return { category: 'succeeded', tone: 'ok' }
    if (outcome === 'cancelled') return { category: 'cancelled', tone: 'idle' }
    if (outcome === 'waiting-budget') return { category: 'waiting-budget', tone: 'wait' }
    if (outcome === 'needs-reconciliation') return { category: 'reconcile', tone: 'urgent' }
    return { category: 'failed', tone: 'bad' }
  }
  if (kind === 'blocked' || kind === 'dependency-blocked') return { category: 'blocked', tone: 'wait' }
  if (kind === 'deadline' || kind === 'budget-wait-expired') return { category: 'failed', tone: 'bad' }
  if (kind === 'interrupted' || kind === 'admission-conflict' || kind === 'retry-fenced') return { category: 'reconcile', tone: 'urgent' }
  if (kind === 'cancelled-before-dispatch' || kind === 'cancelled-while-waiting-budget' || kind === 'admission-recovered-cancelled') return { category: 'cancelled', tone: 'idle' }
  return { category: 'update', tone: 'idle' }
}

const line = (category, botName) => {
  switch (category) {
    case 'succeeded': return `${botName} 的任务已完成`
    case 'failed': return `${botName} 的任务失败`
    case 'blocked': return `${botName} 的任务受阻，等待处理`
    case 'reconcile': return `${botName} 的执行需要核对收据：结果未知，不会自动重试`
    case 'waiting-budget': return `${botName} 的任务等待预算`
    case 'cancelled': return `${botName} 的任务已取消`
    case 'reconciled': return `${botName} 的收据已核对`
    default: return `${botName} 的任务有更新`
  }
}

export function createBotNotifications({ Database, file, journal, botIds, botNames, kinds = NOTIFY_KINDS, limit = 50 }) {
  if (typeof journal?.notificationEvents !== 'function') throw new TypeError('BOT_NOTIFICATIONS_JOURNAL_REQUIRED')
  if (typeof Database !== 'function') throw new TypeError('BOT_NOTIFICATIONS_DATABASE_REQUIRED')
  const wanted = [...new Set((Array.isArray(kinds) ? kinds : NOTIFY_KINDS).filter(kind => typeof kind === 'string'))]
  if (!wanted.length) throw new TypeError('BOT_NOTIFICATIONS_KINDS_REQUIRED')
  const pageSize = Number.isSafeInteger(limit) && limit >= 1 && limit <= 200 ? limit : 50

  const db = new Database(file)
  const prior = db.pragma('busy_timeout', { simple: true })
  try {
    db.pragma('busy_timeout = 5000')
    try { db.pragma('journal_mode = WAL') } catch { /* a read-position store does not require WAL */ }
    db.pragma('synchronous = FULL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS bot_notification_state(scope TEXT PRIMARY KEY, cursor_seq INTEGER NOT NULL, baseline_seq INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS bot_notification_reads(seq INTEGER PRIMARY KEY);
    `)
  } catch (error) { db.pragma(`busy_timeout=${prior}`); db.close(); throw error }

  let closed = false
  const run = sql => { if (closed) throw Object.assign(new Error('BOT_NOTIFICATIONS_CLOSED'), { code: 'BOT_NOTIFICATIONS_CLOSED' }); return db.prepare(sql) }
  const ownerIds = () => {
    const value = typeof botIds === 'function' ? botIds() : botIds
    return [...new Set((Array.isArray(value) ? value : []).filter(id => typeof id === 'string' && id.length > 0))]
  }
  const names = () => {
    const value = typeof botNames === 'function' ? botNames() : botNames
    return value && typeof value === 'object' ? value : {}
  }

  // The read watermark is fixed on first use and never advances on its own: a
  // restart, a second window or a late response cannot silently mark the future
  // read. Everything at or below it is treated as already-seen history. The
  // parent arms it once, right after the Bot directory has loaded, so "history"
  // is exactly what existed at boot and everything after is new.
  const ensureState = () => {
    const existing = run('SELECT scope,cursor_seq,baseline_seq FROM bot_notification_state WHERE scope=?').get(SCOPE)
    if (existing) return existing
    const { maxSeq } = journal.notificationEvents(ownerIds(), wanted, { limit: 1 })
    run('INSERT OR IGNORE INTO bot_notification_state(scope,cursor_seq,baseline_seq) VALUES(?,?,?)').run(SCOPE, maxSeq, maxSeq)
    return run('SELECT scope,cursor_seq,baseline_seq FROM bot_notification_state WHERE scope=?').get(SCOPE)
  }
  const readSeqs = () => new Set(run('SELECT seq FROM bot_notification_reads').all().map(row => row.seq))
  const countUnread = (state, reads) => {
    const feed = journal.notificationEvents(ownerIds(), wanted, { after: state.cursor_seq, limit: UNREAD_CAP })
    let unread = 0
    for (const item of feed.items) if (!reads.has(item.seq)) unread++
    return { unread, truncated: feed.items.length >= UNREAD_CAP, maxSeq: feed.maxSeq }
  }
  const decorate = (item, state, reads, names) => {
    const { category, tone } = categorize(item.kind, item.outcome)
    const botName = names[item.ownerBotId] ?? item.ownerBotId
    return {
      seq: item.seq, kind: item.kind, category, tone, at: item.at,
      botId: item.ownerBotId, botName, taskId: item.taskId, attemptId: item.attemptId,
      outcome: item.outcome, code: item.code,
      read: item.seq <= state.cursor_seq || reads.has(item.seq), isNew: item.seq > state.baseline_seq,
      text: line(category, botName),
    }
  }

  return Object.freeze({
    kinds: wanted,
    readModel() {
      const state = ensureState(), reads = readSeqs()
      const { unread, truncated, maxSeq } = countUnread(state, reads)
      return { schemaVersion: 1, status: 'available', unreadCount: unread, maxSeq, cursorSeq: state.cursor_seq, baselineSeq: state.baseline_seq, truncated }
    },
    list({ before = null, limit: size = pageSize } = {}) {
      const state = ensureState(), reads = readSeqs(), botNames = names()
      const cap = Number.isSafeInteger(size) && size >= 1 && size <= 200 ? size : pageSize
      const { items, maxSeq } = journal.notificationEvents(ownerIds(), wanted, { before, limit: cap })
      const { unread, truncated } = countUnread(state, reads)
      return {
        schemaVersion: 1, items: items.map(item => decorate(item, state, reads, botNames)),
        nextBefore: items.length === cap ? items[items.length - 1].seq : null,
        maxSeq, cursorSeq: state.cursor_seq, baselineSeq: state.baseline_seq, unreadCount: unread, truncated,
      }
    },
    // The browser may only confirm an event id it was shown: an unknown, future
    // or foreign seq is refused instead of silently widening the read set.
    read(seq) {
      if (!Number.isSafeInteger(seq) || seq < 1) throw Object.assign(new Error('INVALID_NOTIFICATION_SEQ'), { code: 'INVALID_NOTIFICATION_SEQ' })
      const state = ensureState()
      const probe = journal.notificationEvents(ownerIds(), wanted, { after: seq - 1, before: seq + 1, limit: 1 })
      if (!probe.items.some(item => item.seq === seq)) throw Object.assign(new Error('NOTIFICATION_NOT_FOUND'), { code: 'NOTIFICATION_NOT_FOUND' })
      if (seq > state.cursor_seq) run('INSERT OR IGNORE INTO bot_notification_reads(seq) VALUES(?)').run(seq)
      return this.readModel()
    },
    // Mark everything the Host currently shows as read. The watermark is the
    // Host's own max seq, so a later or reordered event is never swallowed.
    markAll() {
      const state = ensureState()
      const { maxSeq } = journal.notificationEvents(ownerIds(), wanted, { limit: 1 })
      if (maxSeq > state.cursor_seq) {
        run('UPDATE bot_notification_state SET cursor_seq=? WHERE scope=?').run(maxSeq, SCOPE)
        run('DELETE FROM bot_notification_reads WHERE seq<=?').run(maxSeq)
      }
      return this.readModel()
    },
    close() { if (!closed) { closed = true; try { db.pragma(`busy_timeout=${prior}`) } catch {}; db.close() } },
  })
}
