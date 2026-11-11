import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { createBotThreads } from '../packages/orchestration/src/bot-threads.mjs'
import { createBotThreadAdmission } from '../packages/orchestration/src/bot-thread-admission.mjs'
import { withStorageFailure as withFailure } from './helpers/thread-storage-failure.mjs'

const parent = resolve('tmp/integration/thread-storage-failures')
fs.mkdirSync(parent, { recursive: true })
function fixture({ createSession } = {}) {
  const file = join(fs.mkdtempSync(join(parent, 'case-')), 'threads.json'), calls = []
  const threads = createBotThreads({ file, committedBot: id => id === 'bot-a' ? { id, name: '甲' } : null,
    botAuthorized: () => true, ownsSession: () => true, runtimeMode: () => 'integration',
    createSession: async () => { calls.push('create'); return createSession ? createSession() : 'session-a' } })
  const first = threads.create({ botId: 'bot-a', name: '已保存' }).thread
  return { file, threads, calls, first }
}
test('a failed temporary-file write rolls back the thread and request key before a later retry', async t => {
  const f = fixture()
  await withFailure(t, 'writeFileSync', path => String(path).startsWith(`${f.file}.`), () => {
    assert.throws(() => f.threads.create({ botId: 'bot-a', name: '未保存', requestKey: 'failed-write' }), { code: 'EIO' })
  })
  assert.deepEqual(f.threads.list('bot-a').threads.map(row => row.threadId), [f.first.threadId])
  const retry = f.threads.create({ botId: 'bot-a', name: '重试', requestKey: 'failed-write' })
  assert.equal(retry.created, true, 'an in-memory-only request key cannot answer a durable retry')
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).bots['bot-a'].threads.length, 2)
  assert.deepEqual(f.calls, [])
})

test('a failed directory write rolls back a Session-create intent and never reaches the factory', async t => {
  const f = fixture()
  await withFailure(t, 'mkdirSync', path => String(path) === dirname(f.file), async () => {
    await assert.rejects(f.threads.ensureSession({ botId: 'bot-a', threadId: f.first.threadId }), { code: 'EIO' })
  })
  assert.deepEqual(f.calls, [])
  assert.equal(f.threads.resolve({ botId: 'bot-a', threadId: f.first.threadId }).sessionState, 'none')
  const made = await f.threads.ensureSession({ botId: 'bot-a', threadId: f.first.threadId })
  assert.equal(made.created, true)
  assert.deepEqual(f.calls, ['create'])
})

test('an unreadable catalog after a failed replace cannot become an unbound thread lookup', async t => {
  const f = fixture()
  fs.writeFileSync(f.file, '{invalid catalog')
  await withFailure(t, 'renameSync', (_from, to) => String(to) === f.file, () => {
    assert.throws(() => f.threads.create({ botId: 'bot-a', name: '未提交', requestKey: 'failed-replace' }), { code: 'EPERM' })
  })
  assert.throws(() => f.threads.threadBySession('historical-session'), error =>
    ['BOT_THREADS_INVALID', 'BOT_THREADS_STORAGE_FAILED', 'BOT_THREADS_CLOSED'].includes(error.code),
  'a lookup failure must propagate to admission rather than reporting an ordinary Harness Session')
  assert.throws(() => createBotThreadAdmission({ threads: f.threads }).admit('historical-session'), { code: 'BOT_THREADS_STORAGE_FAILED' })
  assert.equal(f.threads.readModel({ botId: 'bot-a' }).status, 'blocked')
  assert.throws(() => f.threads.resolve({ botId: 'bot-a', threadId: f.first.threadId }), { code: 'BOT_THREADS_STORAGE_FAILED' })
})

test('a failed unrelated write preserves the identity of an already admitted Session factory', async t => {
  let finish
  const f = fixture({ createSession: () => new Promise(resolve => { finish = resolve }) })
  const pending = f.threads.ensureSession({ botId: 'bot-a', threadId: f.first.threadId })
  await new Promise(setImmediate)
  assert.equal(typeof finish, 'function')
  await withFailure(t, 'writeFileSync', path => String(path).startsWith(`${f.file}.`), () => {
    assert.throws(() => f.threads.create({ botId: 'bot-a', name: '另一个未提交线程' }), { code: 'EIO' })
  })
  finish('session-a')
  assert.equal((await pending).sessionId, 'session-a')
  assert.deepEqual(f.threads.threadBySession('session-a'), { botId: 'bot-a', threadId: f.first.threadId })
  const disk = JSON.parse(fs.readFileSync(f.file, 'utf8')).bots['bot-a'].threads
  assert.equal(disk.length, 1)
  assert.equal(disk[0].sessionId, 'session-a', 'the Host-confirmed Session must land in the live record, not a detached object')
  assert.deepEqual(f.calls, ['create'])
})

test('transient rename retries finish the same local commit without replaying Session creation', async t => {
  const f = fixture()
  let remaining = 2, injected = 0
  await withFailure(t, 'renameSync', (_from, to) => {
    if (String(to) !== f.file || remaining-- <= 0) return false
    injected++; return true
  }, async () => {
    const made = await f.threads.ensureSession({ botId: 'bot-a', threadId: f.first.threadId })
    assert.equal(made.sessionId, 'session-a')
  })
  assert.equal(injected, 2)
  assert.deepEqual(f.calls, ['create'])
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).bots['bot-a'].threads[0].sessionId, 'session-a')
})
