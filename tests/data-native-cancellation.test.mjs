import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fork } from 'node:child_process'
import { createDataEngine } from '../packages/orchestration/src/bot-data-engine.mjs'

const root = resolve('tmp/integration/native-data-cancellation')
const fresh = async options => {
  await mkdir(root, { recursive: true })
  return createDataEngine({ dataDir: await mkdtemp(join(root, 'case-')), ...options })
}
const cancelled = error => error.error?.code === 'cancelled'

test('native data cancellation before admission opens no worker', async () => {
  let forks = 0
  const engine = await fresh({ forkImpl: (...args) => { forks++; return fork(...args) } })
  const controller = new AbortController()
  controller.abort()
  try {
    await assert.rejects(async () => engine.forBot('a', { signal: controller.signal }).load({ from: 'content', content: 'value\n1' }), cancelled)
    await assert.rejects(engine.forBot('a', { signal: controller.signal }).catalog(), cancelled)
    assert.equal(forks, 0)
  } finally { assert.deepEqual((await engine.closeAll()).unconfirmed, []) }
})

test('cancel during a controlled library read prevents the later table write', async () => {
  let release, started, forks = 0
  const entered = new Promise(resolve => { started = resolve })
  const waiting = new Promise(resolve => { release = resolve })
  const engine = await fresh({ libraryReader: async () => { started(); await waiting; return 'value\n7' },
    forkImpl: (...args) => { forks++; return fork(...args) } })
  const controller = new AbortController()
  try {
    const loading = engine.forBot('a', { signal: controller.signal }).load({ from: 'library', path: 'delayed.csv', name: 'late' })
    await entered
    controller.abort()
    release()
    await assert.rejects(loading, cancelled)
    assert.equal(forks, 0, 'late library completion cannot admit a cancelled write')
    assert.deepEqual((await engine.forBot('a').catalog()).tables, [])
  } finally { release(); assert.deepEqual((await engine.closeAll()).unconfirmed, []) }
})

test('cancel interrupts the actual SQLite worker and a later explicit query waits for its real exit', async () => {
  let child, sends = 0, announce
  const dispatched = new Promise(resolve => { announce = resolve })
  const engine = await fresh({ sqlTimeoutMs: 30000, forkImpl: (...args) => {
    child = fork(...args)
    const send = child.send.bind(child)
    child.send = (message, ...rest) => {
      if (message.op === 'run' && message.sql?.includes('1000000000')) { sends++; announce() }
      return send(message, ...rest)
    }
    return child
  } })
  const controller = new AbortController()
  try {
    const running = engine.forBot('a', { signal: controller.signal }).sql({ sql: 'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT SUM(x) FROM n' })
    await dispatched
    const old = child, exited = new Promise(resolve => old.once('exit', resolve))
    controller.abort()
    await assert.rejects(running, cancelled)
    await exited
    assert.throws(() => process.kill(old.pid, 0), { code: 'ESRCH' })
    assert.deepEqual((await engine.forBot('a').sql({ sql: 'SELECT 9' })).rows, [[9]])
    assert.notEqual(child.pid, old.pid)
    assert.equal(sends, 1, 'the cancelled statement is never automatically replayed')
  } finally { assert.deepEqual((await engine.closeAll()).unconfirmed, []) }
})
