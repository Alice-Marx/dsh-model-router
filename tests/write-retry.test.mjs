import test from 'node:test'
import assert from 'node:assert/strict'
import {sleepSync, writeTransaction} from '../packages/orchestration/src/write-retry.mjs'

// Contention policy for the shared ledger, exercised without a driver. The
// driver-backed half lives in write-retry.native.mjs because this package only
// resolves better-sqlite3 inside the verified probe fixture.

test('write-retry: a policy refusal is surfaced immediately, never retried', () => {
  let calls = 0
  const db = {transaction: (work) => Object.assign(() => { calls++; work() }, {immediate: () => { calls++; work() }})}
  assert.throws(
    () => writeTransaction(db, () => { throw Object.assign(new Error('TASK_REFUSED'), {code: 'TASK_REFUSED'}) }, {deadlineMs: 1000, sleepMs: 1}),
    /TASK_REFUSED/,
  )
  assert.equal(calls, 1, 'a refusal that is not contention must not be attempted twice')
})

test('write-retry: a busy file is retried and then succeeds in the same bound', () => {
  let calls = 0
  const db = {
    transaction: (work) => Object.assign(() => work(), {
      immediate: () => {
        calls++
        if (calls < 4) throw Object.assign(new Error('busy'), {code: 'SQLITE_BUSY'})
        return work()
      },
    }),
  }
  const value = writeTransaction(db, () => 'ok', {deadlineMs: 2000, sleepMs: 1})
  assert.equal(value, 'ok')
  assert.equal(calls, 4)
})

test('write-retry: exhausting the bound reports the deadline it waited', () => {
  const db = {transaction: () => Object.assign(() => {}, {immediate: () => { throw Object.assign(new Error('busy'), {code: 'SQLITE_BUSY'}) }})}
  assert.throws(() => writeTransaction(db, () => {}, {deadlineMs: 30, sleepMs: 5}), (error) => {
    assert.equal(error.code, 'SQLITE_BUSY')
    assert.equal(error.deadlineMs, 30)
    assert.equal(error.sqliteCode, 'SQLITE_BUSY')
    assert.match(error.message, /SQLITE_BUSY after 30ms/)
    assert.ok(error.attempts >= 2)
    return true
  })
})

test('write-retry: a write transaction is immediate, so two writers cannot both read first', () => {
  const modes = []
  const db = {
    transaction: (work) => Object.assign(() => work(), {}),
  }
  db.transaction = (work) => {
    const run = () => { modes.push('run'); return work() }
    run.immediate = () => { modes.push('immediate'); return work() }
    return run
  }
  writeTransaction(db, () => 1, {deadlineMs: 100, sleepMs: 1})
  assert.deepEqual(modes, ['immediate'])
})

test('write-retry: sleepSync does not yield the event loop', () => {
  let turned = false
  setImmediate(() => { turned = true })
  sleepSync(20)
  assert.equal(turned, false, 'a held write transaction must not let other work run')
})
