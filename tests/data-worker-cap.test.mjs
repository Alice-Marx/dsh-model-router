import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDataEngine } from '../packages/orchestration/src/bot-data-engine.mjs'
import { DATA_LIMITS } from '../packages/orchestration/src/bot-data-surface.mjs'

// The strict worker cap and the confirmed-exit rule.
//
// Two kinds of evidence are used, and neither is faked:
//  - a CONTROLLED FAKE CHILD (no real process, no user data) so the fork count,
//    the open count and the exit timing can be observed exactly and made to
//    misbehave (a child that never confirms its exit);
//  - REAL SQLite in REAL forked children for the cap under real load and for the
//    read/write loop after a timeout reopen.
//
// No real model calls, no user data, no network.

const CAP = DATA_LIMITS.activeWorkersMax
const removeQuietly = async path => {
  for (let attempt = 0; attempt < 8; attempt++) {
    try { await rm(path, { recursive: true, force: true }); return } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code)) throw error
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)))
    }
  }
}

/**
 * A fake `fork` that records everything the engine can observe. `hangExit`
 * makes a killed child NEVER emit 'exit', which is the only way to prove the
 * engine refuses to reopen and refuses to claim a close.
 */
const createFakeFork = ({ openDelayMs = 2, exitDelayMs = 2, hangExit = false, holdReplies = false } = {}) => {
  const stats = { forks: 0, live: 0, peakLive: 0, opens: 0, sends: 0, kills: 0, exits: 0, log: [] }
  const timers = new Set()
  const later = (ms, fn) => { const timer = setTimeout(() => { timers.delete(timer); fn() }, ms); timers.add(timer); return timer }
  const records = new Map()
  const hangs = serial => (typeof hangExit === 'function' ? hangExit(serial) : hangExit === true)
  const held = []
  let holding = holdReplies === true
  const forkImpl = () => {
    stats.forks += 1
    const serial = stats.forks
    stats.live += 1
    stats.peakLive = Math.max(stats.peakLive, stats.live)
    stats.log.push(`fork#${serial}`)
    const listeners = new Map()
    const record = { serial, releaseExit: null }
    records.set(record, true)
    const emit = (event, ...args) => { for (const fn of listeners.get(event) ?? []) fn(...args) }
    const finishExit = () => {
      if (record.exited) return
      record.exited = true
      stats.live -= 1
      stats.exits += 1
      stats.log.push(`exit#${serial}`)
      emit('exit', null, 'SIGKILL')
    }
    const child = {
      pid: 9000 + serial,
      connected: true,
      killed: false,
      send(message) {
        stats.sends += 1
        if (message.op === 'open') {
          stats.opens += 1
          stats.log.push(`open#${serial}`)
          later(openDelayMs, () => emit('message', { id: message.id, ok: true, value: {} }))
          return
        }
        const reply = { id: message.id, ok: true, value: message.op === 'listTables' ? [] : {} }
        // A held reply keeps this worker busy, so it cannot be reclaimed.
        if (holding) { held.push(() => emit('message', reply)); return }
        emit('message', reply)
      },
      kill() {
        if (child.killed) return
        child.killed = true
        stats.kills += 1
        stats.log.push(`kill#${serial}`)
        if (hangs(serial)) { record.releaseExit = finishExit; return }
        later(exitDelayMs, finishExit)
      },
      on(event, fn) {
        const list = listeners.get(event) ?? []
        list.push(fn)
        listeners.set(event, list)
      },
      once(event, fn) { child.on(event, fn) },
      removeListener() {},
    }
    return child
  }
  return {
    forkImpl, stats,
    /** The children this fake has produced, newest last. */
    get records() { return [...records.keys()] },
    /** Start holding every non-open reply, so those workers stay busy. */
    hold: () => { holding = true },
    /** Stop holding and let the held replies through. */
    release: () => { holding = false; for (const send of held.splice(0)) send() },
    dispose: () => { for (const timer of timers) clearTimeout(timer) },
  }
}

let dir

/** A per-test data directory: the Host owns the directory, so a test creates it. */
const room = async name => { const path = join(dir, name); await mkdir(path, { recursive: true }); return path }

before(async () => { dir = await mkdtemp(join(tmpdir(), 'mb-data-cap-')) })
after(async () => { await removeQuietly(dir) })
test('cap: with more Bots than slots, only the cap is ever forked and the rest are refused', async () => {
  const fake = createFakeFork({ openDelayMs: 25, exitDelayMs: 1 })
  const engine = createDataEngine({ dataDir: await room('cap-a'), sqlTimeoutMs: 4000, forkImpl: fake.forkImpl })
  const bots = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']
  try {
    const settled = await Promise.allSettled(bots.map(botId => engine.forBot(botId).catalog()))
    const refused = settled.filter(row => row.status === 'rejected')
    assert.equal(fake.stats.peakLive, CAP, `at most ${CAP} children are alive at once (saw ${fake.stats.peakLive})`)
    assert.equal(fake.stats.forks, CAP, `only ${CAP} workers are ever started (saw ${fake.stats.forks})`)
    assert.equal(fake.stats.opens, CAP, 'every started worker opened exactly one database')
    assert.equal(refused.length, bots.length - CAP, 'the Bots without a slot are refused, not queued')
    for (const row of refused) {
      assert.equal(row.reason.error.code, 'engine_unavailable')
      assert.match(row.reason.error.message, /slot is in use/)
      assert.equal(row.reason.error.retryable, true)
    }
    // A refusal is not a replay: nothing was sent for the refused Bots.
    assert.equal(fake.stats.sends, CAP * 2, 'only the admitted workers sent open + listTables')
    // Once a slot is free again, a NEW call works — the refusal is not sticky.
    const report = await engine.closeAll()
    assert.deepEqual(report.unconfirmed, [])
    const again = await engine.forBot('c5').catalog()
    assert.ok(again, 'a refused Bot succeeds on a later call once a slot is free')
  } finally { fake.dispose() }
})

test('cap: concurrent first admits cannot race past the cap', async () => {
  const fake = createFakeFork({ openDelayMs: 15, exitDelayMs: 1 })
  const engine = createDataEngine({ dataDir: await room('cap-b'), sqlTimeoutMs: 4000, forkImpl: fake.forkImpl })
  try {
    // Twenty simultaneous first calls for twenty Bots: the admission queue must
    // hand out exactly CAP slots.
    const settled = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => engine.forBot(`r${index}`).catalog()))
    assert.equal(fake.stats.peakLive, CAP, `never more than ${CAP} live children (saw ${fake.stats.peakLive})`)
    assert.equal(fake.stats.forks, CAP, `exactly ${CAP} forks (saw ${fake.stats.forks})`)
    assert.equal(settled.filter(row => row.status === 'fulfilled').length, CAP)
    assert.equal(settled.filter(row => row.status === 'rejected').length, 20 - CAP)
  } finally { fake.dispose() }
})

test('cap: an idle worker is reclaimed only after its exit is confirmed', async () => {
  const fake = createFakeFork({ openDelayMs: 1, exitDelayMs: 8 })
  const engine = createDataEngine({ dataDir: await room('cap-c'), sqlTimeoutMs: 4000, forkImpl: fake.forkImpl })
  try {
    for (const botId of ['i1', 'i2', 'i3', 'i4']) await engine.forBot(botId).catalog()
    assert.equal(fake.stats.live, CAP)
    const before = fake.stats.forks
    // The fifth Bot must take an idle slot, and only after that worker exited.
    await engine.forBot('i5').catalog()
    assert.equal(fake.stats.forks, before + 1, 'one worker was replaced')
    assert.equal(fake.stats.peakLive, CAP, `the cap held during the swap (saw ${fake.stats.peakLive})`)
    const exit = fake.stats.log.indexOf('exit#1')
    const replacement = fake.stats.log.indexOf(`fork#${before + 1}`)
    assert.ok(exit >= 0 && replacement > exit, 'the replacement is forked only after the exit is confirmed')
    assert.equal(fake.stats.live, CAP)
  } finally { fake.dispose() }
})

test('cap: a Bot asking for work while its slot is being handed over never doubles its worker', async () => {
  const fake = createFakeFork({ openDelayMs: 1, exitDelayMs: 25 })
  const engine = createDataEngine({ dataDir: await room('cap-e'), sqlTimeoutMs: 4000, forkImpl: fake.forkImpl })
  try {
    for (const botId of ['j1', 'j2', 'j3', 'j4']) await engine.forBot(botId).catalog()
    assert.equal(fake.stats.forks, CAP)
    // The fifth Bot takes the least recently used slot while its owner asks for
    // work at the same moment: the owner is either served by the worker it still
    // has or refused, but it never starts a replacement behind the hand-over.
    const settled = await Promise.allSettled([
      engine.forBot('j5').catalog(),
      engine.forBot('j1').catalog(),
    ])
    assert.equal(fake.stats.peakLive, CAP, `never more than ${CAP} live children (saw ${fake.stats.peakLive})`)
    assert.ok(fake.stats.forks <= CAP + 2, `forking stayed bounded (saw ${fake.stats.forks})`)
    assert.equal(settled[0].status, 'fulfilled', 'the Bot that took the freed slot is served')
    assert.equal(settled[1].status === 'fulfilled' || settled[1].reason.error.code === 'engine_unavailable', true)
    // Whatever happened, the cap still holds and every Bot can still be served.
    for (const botId of ['j1', 'j2', 'j3', 'j4', 'j5']) {
      const value = await engine.forBot(botId).catalog()
      assert.ok(value, `${botId} is still served`)
      assert.ok(fake.stats.peakLive <= CAP)
    }
  } finally { fake.dispose() }
})

test('cap: a worker that never confirms its exit keeps its slot, is never replaced and is never reported closed', async () => {
  // Only the FIRST child refuses to confirm its exit; the others behave. The
  // statement budget is long so the held requests stay in flight for the whole
  // proof (the exit budget itself is the production 10s, never shortened).
  const fake = createFakeFork({ openDelayMs: 1, exitDelayMs: 2, hangExit: serial => serial === 1 })
  const engine = createDataEngine({ dataDir: await room('cap-d'), sqlTimeoutMs: 60_000, forkImpl: fake.forkImpl })
  try {
    for (const botId of ['h1', 'h2', 'h3', 'h4']) await engine.forBot(botId).catalog()
    assert.equal(fake.stats.forks, CAP)
    // Hold the other three slots with a statement that has not been answered.
    fake.hold()
    const held = ['h2', 'h3', 'h4'].map(botId => engine.forBot(botId).catalog().catch(() => {}))
    await new Promise(resolve => setTimeout(resolve, 20))

    // A stop request kills this Bot's worker, and this worker never confirms it.
    engine.forBot('h1').cancel()
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(fake.stats.kills, 1)
    assert.equal(fake.stats.exits, 0, 'the fake child never confirms its exit')

    // Reopening must be refused, and no replacement may be forked.
    await assert.rejects(() => engine.forBot('h1').catalog(), error => {
      assert.equal(error.error.code, 'engine_unavailable')
      assert.match(error.error.message, /never confirmed its exit/)
      assert.equal(error.error.retryable, true)
      return true
    })
    assert.equal(fake.stats.forks, CAP, 'no replacement worker is started while the exit is unconfirmed')

    // The unconfirmed worker still holds its slot, and every other slot is busy,
    // so a new Bot is refused instead of being quietly queued.
    await assert.rejects(() => engine.forBot('h5').catalog(), error => error.error.code === 'engine_unavailable' && /slot is in use/.test(error.error.message))
    assert.equal(fake.stats.forks, CAP, 'the unconfirmed worker still occupies its slot')

    // closeAll must report the truth instead of claiming success.
    const report = await engine.closeAll()
    assert.equal(report.unconfirmed.length, 1, 'only the unconfirmed worker is reported as not closed')
    assert.equal(report.unconfirmed[0].botId, 'h1')
    assert.match(report.unconfirmed[0].error.message, /did not confirm its exit/)
    assert.deepEqual(report.closed.sort(), ['h2', 'h3', 'h4'], 'the workers that did confirm their exit are reported closed')
    assert.equal(fake.stats.forks, CAP, 'a close that did not happen does not start a worker')

    // The real exit finally arrives: only now may this Bot open again.
    const release = fake.records.find(record => record.serial === 1)
    assert.ok(release && typeof release.releaseExit === 'function', 'the hung child is still reachable so its exit can be released')
    release.releaseExit()
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(fake.stats.exits, CAP, 'every worker has now confirmed its exit')
    fake.release()
    await engine.forBot('h1').catalog()
    assert.equal(fake.stats.forks, CAP + 1, 'a new worker starts only after the confirmed exit')
  } finally { fake.release(); fake.dispose() }
})

test('cap: a real SQLite engine keeps the cap under real concurrent load', async () => {
  const children = []
  const forkImpl = (url, args, options) => {
    const child = fork(url, args, options)
    children.push(child)
    return child
  }
  const engine = createDataEngine({ dataDir: await room('cap-real'), sqlTimeoutMs: 4000, forkImpl })
  const live = () => children.filter(child => child.exitCode === null && child.signalCode === null).length
  try {
    // Six Bots, each with real work, admitted one after another: the engine may
    // only ever hold CAP real child processes.
    for (const botId of ['real-a', 'real-b', 'real-c', 'real-d', 'real-e', 'real-f']) {
      await engine.forBot(botId).load({ from: 'content', content: 'n\n1\n2\n3', name: 't' })
      assert.ok(live() <= CAP, `at most ${CAP} real workers stay resident (saw ${live()})`)
    }
    // Every Bot still answers, whether or not its worker is resident right now.
    for (const botId of ['real-a', 'real-b', 'real-c', 'real-d', 'real-e', 'real-f']) {
      const value = await engine.forBot(botId).sql({ sql: 'SELECT COUNT(*) AS n FROM t' })
      assert.deepEqual(value.rows, [[3]])
      assert.ok(live() <= CAP, `at most ${CAP} real workers stay resident (saw ${live()})`)
    }
    const report = await engine.closeAll()
    assert.deepEqual(report.unconfirmed, [])
    assert.equal(live(), 0, 'every real worker confirmed its exit')
  } finally { for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }
})

test('cap: a real SQLite engine refuses a new Bot while every slot is busy, then serves it', async () => {
  const children = []
  const forkImpl = (url, args, options) => { const child = fork(url, args, options); children.push(child); return child }
  const engine = createDataEngine({ dataDir: await room('cap-busy'), sqlTimeoutMs: 2500, forkImpl })
  const live = () => children.filter(child => child.exitCode === null && child.signalCode === null).length
  const runaway = 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT COUNT(*) FROM c'
  try {
    // Hold every slot with a statement that cannot finish before its timeout.
    const busy = Array.from({ length: CAP }, (_, index) => engine.forBot(`busy-${index}`).sql({ sql: runaway }))
    await new Promise(resolve => setTimeout(resolve, 400))
    assert.equal(live(), CAP, `all ${CAP} slots are busy (saw ${live()})`)
    const refused = await engine.forBot('busy-extra').sql({ sql: 'SELECT 1 AS a' }).then(() => null, error => error)
    assert.ok(refused, 'a new Bot is refused while every slot is busy')
    assert.equal(refused.error.code, 'engine_unavailable')
    assert.match(refused.error.message, /slot is in use/)
    assert.ok(live() <= CAP, 'the refusal does not start a worker')
    assert.equal(children.length, CAP, 'no extra child was forked for the refused Bot')

    // The busy statements time out; the slots come back and the refused Bot works.
    const settled = await Promise.allSettled(busy)
    assert.ok(settled.every(row => row.status === 'rejected' && row.reason.error.code === 'timeout'))
    const value = await engine.forBot('busy-extra').sql({ sql: 'SELECT 1 AS a' })
    assert.deepEqual(value.rows, [[1]])
    assert.ok(live() <= CAP)
    const report = await engine.closeAll()
    assert.deepEqual(report.unconfirmed, [])
  } finally { for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }
})

test('cap: a real timeout reopen and the read/write loop still work under the strict cap', async () => {
  const engine = createDataEngine({ dataDir: await room('cap-loop'), sqlTimeoutMs: 1200 })
  try {
    const bot = engine.forBot('loop')
    const loaded = await bot.load({ from: 'content', content: 'region,sales\nNorth,120\nSouth,80\nEast,95', name: 'sales' })
    assert.equal(loaded.tables[0].rowCount, 3)
    await assert.rejects(() => bot.sql({ sql: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT COUNT(*) FROM c' }), error => error.error.code === 'timeout')
    const after = await bot.sql({ sql: 'SELECT region, SUM(sales) AS total FROM sales GROUP BY region ORDER BY total DESC' })
    assert.deepEqual(after.rows, [['North', 120], ['East', 95], ['South', 80]])
    const card = await bot.show({ table: 'sales', kind: 'chart', title: 'By region', chart: { type: 'bar', x: 'region', y: 'sales', agg: 'sum' } })
    const reopened = await bot.show({ cardId: card.id })
    assert.deepEqual(reopened.chart.series[0].points.map(point => point.y).sort((a, b) => a - b), [80, 95, 120])
    const exported = await bot.exportCsv({ table: 'sales' })
    assert.equal(exported.rowCount, 3)
    assert.match(exported.content, /region,sales/)
  } finally { await engine.closeAll() }
})
