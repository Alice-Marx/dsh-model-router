/**
 * Bounded retry for SQLite write contention, and the database's own clock.
 *
 * Why this exists: the router ledger opens the shared connection with
 * `busy_timeout=0` on purpose (its CAS commits must not block an await), so a
 * borrowed journal connection inherits a non-blocking handle. A journal write
 * that collides with another Host then fails with a bare `SQLITE_BUSY` instead
 * of waiting, and the second Host cannot start. Read-modify-write contention on
 * this file is expected — several Hosts, one ledger — so the failure must be a
 * bounded wait, not a crash.
 *
 * Retry is synchronous on purpose: journal writes run inside a synchronous
 * transaction and must not yield the event loop while holding a lock.
 */

const BUSY = Object.freeze(new Set(['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_LOCKED']))

/** Sleep without yielding: safe inside a held write transaction. */
export function sleepSync(ms) {
  if (!(ms > 0)) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(ms, 1000))
}

/** The database's own wall clock in milliseconds, independent of the caller's. */
export function readDatabaseClock(db) {
  const row = db.prepare("SELECT CAST(round(julianday('now')*86400000) AS INTEGER) AS ms").get()
  if (!row || !Number.isSafeInteger(row.ms) || row.ms <= 0) throw Object.assign(new Error('SQLITE_CLOCK_UNAVAILABLE'), { code: 'SQLITE_CLOCK_UNAVAILABLE' })
  return row.ms
}

/**
 * Run `work` inside an immediate transaction, retrying while the file is
 * write-locked by another connection. Any other error, including a policy
 * refusal thrown by `work`, propagates on the first attempt.
 */
export function writeTransaction(db, work, { deadlineMs = 10_000, sleepMs = 10 } = {}) {
  if (typeof work !== 'function') throw new TypeError('writeTransaction requires work')
  const until = Date.now() + Math.max(1, deadlineMs)
  let attempt = 0
  for (;;) {
    try {
      return db.transaction(work).immediate()
    } catch (error) {
      if (!BUSY.has(error?.code) || Date.now() >= until) {
        if (BUSY.has(error?.code)) {
          throw Object.assign(new Error(`SQLITE_BUSY after ${deadlineMs}ms of retries`), {
            code: 'SQLITE_BUSY', cause: error, sqliteCode: error?.code, deadlineMs, attempts: attempt + 1,
          })
        }
        throw error
      }
      attempt++
      sleepSync(Math.min(sleepMs * attempt, 100))
    }
  }
}
