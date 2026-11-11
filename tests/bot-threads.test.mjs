import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createBotThreads, parseBotThreads, BOT_THREAD_SCHEMA } from '../packages/orchestration/src/bot-threads.mjs'
import { withStorageFailure } from './helpers/thread-storage-failure.mjs'

// An isolated fixture Host. The committed-Bot table, grants, lifecycle status,
// the principal directory's session ownership and the Host's own thread record
// are the Host's truth; the service only ever sees them through the injected
// facades, exactly as the composition wires lifecycle/directory/authority/rt.
const parent = resolve('tmp/integration/bot-threads/service')
await mkdir(parent, { recursive: true })

function fixture(t) {
  return mkdtemp(join(parent, 'case-')).then(async dir => {
    const bots = new Map([
      ['bot-a', { id: 'bot-a', name: '甲 Bot', model: 'deepseek/deepseek-chat', workDir: 'C:/work/a', sessionId: 'root-a' }],
      ['bot-b', { id: 'bot-b', name: '乙 Bot', model: 'deepseek/deepseek-reasoner', workDir: 'C:/work/b', sessionId: 'root-b' }],
    ])
    const grants = new Map([['bot-a', { tools: ['tool/model_router'], modelRoutes: [{ provider: 'deepseek', model: 'deepseek-chat' }] }], ['bot-b', { tools: [], modelRoutes: [] }]])
    // The Host's own durable record of a Bot's threads: identity and archive.
    const hostThreads = new Map()
    const sessions = new Map()
    const unowned = new Set()
    const host = {
      bots,
      grants,
      sessions,
      hostThreads,
      unowned,
      fixed: null,
      // A test replaces this to make the factory fail in a specific way; the
      // service holds the stable wrapper, exactly as the composition does.
      behavior: null,
      healthy: true,      closed: false,
      created: [],
      ownershipChecks: [],
      renames: [],
      renameBehavior: null,
      committedBot: botId => (bots.has(botId) ? structuredClone(bots.get(botId)) : null),
      lifecycleStatus: () => ({ healthy: host.healthy, closed: host.closed, revision: 1, bots: bots.size }),
      botAuthorized: botId => {
        const grant = grants.get(botId)
        if (!grant) return null
        return grant.tools.length > 0 || grant.modelRoutes.length > 0
      },
      ownsSession: (botId, sessionId) => {
        host.ownershipChecks.push([botId, sessionId])
        return sessions.get(sessionId)?.botId === botId
      },
      inspectSession: sessionId => sessions.has(sessionId),
      committedThreads: botId => structuredClone(hostThreads.get(botId) ?? []),
      // The runtime factory: it makes the Session AND records it in the Bot's
      // committed state, the way the patched rt.addThreadSession does.
      createSession: async ({ botId, threadId, title, dir }) => {
        if (host.behavior) return host.behavior({ botId, threadId, title, dir })
        return host.base({ botId, threadId, title, dir })
      },
      // The default factory: makes the Session and records it in the Bot's
      // committed state, the way the patched rt.addThreadSession does.
      base: async ({ botId, threadId, title, dir }) => {
        host.created.push({ botId, threadId, title, dir })
        if (host.fixed) return host.fixed
        const sessionId = `s-${host.created.length}`
        if (!unowned.has(threadId)) {
          sessions.set(sessionId, { botId, threadId, title, dir })
          const records = hostThreads.get(botId) ?? []
          if (!records.some(record => record.threadId === threadId)) records.push({ threadId, sessionId, createdAt: 1_700_000_000_000, ...(typeof title === 'string' && title.trim() ? { name: title } : {}) })
          hostThreads.set(botId, records)
        }
        return sessionId
      },
      setThreadArchived: async ({ botId, threadId, archivedAt }) => {
        const records = hostThreads.get(botId) ?? []
        const record = records.find(entry => entry.threadId === threadId)
        if (record === undefined) return null
        if (archivedAt === undefined || archivedAt === null) delete record.archivedAt
        else record.archivedAt = archivedAt
        if (record.archivedAt !== undefined) sessions.delete(record.sessionId)
        else sessions.set(record.sessionId, { botId, threadId })
        return { ...record }
      },
      // The Host's own thread title, the way rt.renameThread keeps it: one save
      // in the committed state, answering with the record it wrote.
      renameThread: async ({ botId, threadId, name }) => {
        host.renames.push({ botId, threadId, name })
        if (host.renameBehavior) return host.renameBehavior({ botId, threadId, name })
        const records = hostThreads.get(botId) ?? []
        const record = records.find(entry => entry.threadId === threadId)
        if (record === undefined) return null
        record.name = name
        return { ...record }
      },
    }
    const file = join(dir, 'bot-threads.json')
    const open = () => createBotThreads({
      file,
      committedBot: host.committedBot,
      lifecycleStatus: host.lifecycleStatus,
      botAuthorized: host.botAuthorized,
      ownsSession: host.ownsSession,
      committedThreads: host.committedThreads,
      createSession: host.createSession,
      setThreadArchived: host.setThreadArchived,
      renameThread: host.renameThread,
      inspectSession: host.inspectSession,
      now: () => 1_700_000_000_000,
    })
    return { dir, file, host, open }
  })
}

const opened = async t => await fixture(t)
const codeOf = promise => promise.then(() => null, error => error.code ?? error.message)

test('the catalog survives a restart: names, archive state, selection and session identity are re-read from disk', async t => {
  const { file, host, open } = await opened(t)
  const first = open()
  const alpha = first.create({ botId: 'bot-a', name: '线索甲' }).thread
  const beta = first.create({ botId: 'bot-a', name: '线索乙' }).thread
  first.switchThread({ botId: 'bot-a', threadId: alpha.threadId })
  await first.archive({ botId: 'bot-a', threadId: beta.threadId })
  const bound = await first.ensureSession({ botId: 'bot-a', threadId: alpha.threadId })
  first.close()

  const second = open()
  const view = second.list('bot-a')
  assert.deepEqual(view.threads.map(thread => [thread.name, thread.state]), [['线索甲', 'open'], ['线索乙', 'archived']])
  assert.equal(view.activeThreadId, alpha.threadId)
  const restored = second.resolve({ botId: 'bot-a', threadId: alpha.threadId })
  assert.equal(restored.sessionId, bound.sessionId)
  assert.equal(restored.sessionState, 'owned')
  assert.equal(second.assertSendable({ botId: 'bot-a', threadId: alpha.threadId }).sessionId, bound.sessionId)
  // The Host's own record agrees: one writer per fact, no second copy.
  assert.deepEqual(host.committedThreads('bot-a').map(record => [record.threadId, record.sessionId]), [[alpha.threadId, bound.sessionId]])
  assert.equal(host.created.length, 1)
})

test('a replayed requestKey returns the thread it already made; an unknown one creates; a malformed one is refused', async t => {
  const { open } = await opened(t)
  const threads = open()
  const first = threads.create({ botId: 'bot-a', requestKey: 'composer-1' })
  const replay = threads.create({ botId: 'bot-a', requestKey: 'composer-1' })
  assert.equal(replay.created, false)
  assert.equal(replay.thread.threadId, first.thread.threadId)
  const second = threads.create({ botId: 'bot-a', requestKey: 'composer-2' })
  assert.equal(second.created, true)
  assert.notEqual(second.thread.threadId, first.thread.threadId)
  assert.equal(threads.list('bot-a').threads.length, 2)
  assert.equal(await codeOf(Promise.resolve().then(() => threads.create({ botId: 'bot-a', requestKey: 7 }))), 'INVALID_REQUEST_KEY')
})

test('a thread of one Bot is refused by name under another Bot, and ownership is never checked across Bots', async t => {
  const { host, open } = await opened(t)
  const threads = open()
  const { thread } = threads.create({ botId: 'bot-a', name: '属于甲' })
  for (const call of [
    () => threads.resolve({ botId: 'bot-b', threadId: thread.threadId }),
    () => threads.switchThread({ botId: 'bot-b', threadId: thread.threadId }),
    () => threads.rename({ botId: 'bot-b', threadId: thread.threadId, name: '越权' }),
    () => threads.archive({ botId: 'bot-b', threadId: thread.threadId }),
    () => threads.unarchive({ botId: 'bot-b', threadId: thread.threadId }),
    () => threads.openThread({ botId: 'bot-b', threadId: thread.threadId }),
    () => threads.assertSendable({ botId: 'bot-b', threadId: thread.threadId }),
    () => threads.ensureSession({ botId: 'bot-b', threadId: thread.threadId }),
    () => threads.recover({ botId: 'bot-b', threadId: thread.threadId }),
  ]) assert.equal(await codeOf(Promise.resolve().then(call)), 'THREAD_FOREIGN_BOT', call.toString())
  assert.equal(host.ownershipChecks.length, 0)
  assert.equal(host.created.length, 0)
  assert.deepEqual(threads.threadBySession('s-1'), null)
})

test('every RPC-shaped entry takes a closed set of fields: no path, model, credential or authorization', async t => {
  const { open } = await opened(t)
  const threads = open()
  const { thread } = threads.create({ botId: 'bot-a', name: '字段' })
  for (const call of [
    () => threads.create({ botId: 'bot-a', model: 'deepseek/evil' }),
    () => threads.create({ botId: 'bot-a', workDir: 'C:/elsewhere' }),
    () => threads.create({ botId: 'bot-a', grant: { tools: ['*'] } }),
    () => threads.rename({ botId: 'bot-a', threadId: thread.threadId, name: 'x', model: 'y' }),
    () => threads.switchThread({ botId: 'bot-a', threadId: thread.threadId, sessionId: 'root-a' }),
    () => threads.assertSendable({ botId: 'bot-a', threadId: thread.threadId, endpoint: 'https://x' }),
    () => threads.ensureSession({ botId: 'bot-a', threadId: thread.threadId, dir: 'C:/elsewhere' }),
    () => threads.openThread({ botId: 'bot-a', threadId: thread.threadId, sessionId: 'root-a' }),
    () => threads.archive({ botId: 'bot-a', threadId: thread.threadId, credential: 'k' }),
  ]) assert.equal(await codeOf(Promise.resolve().then(call)), 'INVALID_THREAD_REQUEST', call.toString())
})

test('creating and switching threads calls no model, creates no Session and starts no Task', async t => {
  const { host, open } = await opened(t)
  const threads = open()
  const made = []
  for (let index = 0; index < 5; index += 1) made.push(threads.create({ botId: 'bot-a', name: `线程 ${index}` }).thread)
  for (let round = 0; round < 50; round += 1) {
    threads.switchThread({ botId: 'bot-a', threadId: made[round % made.length].threadId })
  }
  assert.equal(threads.list('bot-a').activeThreadId, made[4].threadId)
  assert.equal(host.created.length, 0)
  assert.equal(host.ownershipChecks.length, 0)
  for (const thread of threads.list('bot-a').threads) {
    assert.equal(thread.sessionId, null)
    assert.equal(thread.sessionState, 'none')
  }
})

test('opening a thread only navigates until the caller explicitly asks for the Session', async t => {
  const { host, open } = await opened(t)
  const threads = open()
  const { thread } = threads.create({ botId: 'bot-a', name: '导航' })
  const navigated = threads.openThread({ botId: 'bot-a', threadId: thread.threadId })
  assert.deepEqual(navigated, { botId: 'bot-a', threadId: thread.threadId, activeThreadId: thread.threadId, sessionId: null, sessionState: 'none', created: false, needsSession: true })
  assert.equal(host.created.length, 0)
  const openedThread = await threads.openThread({ botId: 'bot-a', threadId: thread.threadId, create: true })
  assert.equal(openedThread.created, true)
  assert.equal(openedThread.needsSession, false)
  assert.ok(openedThread.sessionId)
  assert.equal(host.created.length, 1)
  // The default chat is never touched: the Bot's own session id stays out of it.
  assert.equal(host.created[0].sessionId, undefined)
  assert.equal(threads.list('bot-a').activeThreadId, thread.threadId)
})

test('two concurrent ensure calls share one outcome and make one Session', async t => {
  const { host, open } = await opened(t)
  const threads = open()
  const { thread } = threads.create({ botId: 'bot-a', name: '并发' })
  const [left, right] = await Promise.all([
    threads.ensureSession({ botId: 'bot-a', threadId: thread.threadId }),
    threads.ensureSession({ botId: 'bot-a', threadId: thread.threadId }),
  ])
  assert.equal(left.sessionId, right.sessionId)
  assert.equal(host.created.length, 1)
  assert.equal(host.hostThreads.get('bot-a').length, 1)
})

test('a create whose outcome was never recorded is settled from the Host record, never replayed', async t => {
  const { file, host, open } = await opened(t)
  const threads = open()
  const { thread } = threads.create({ botId: 'bot-a', name: '中断' })
  // The Host made the Session and recorded it, then this process died before
  // the catalog could write it down: the factory reports an unknown outcome.
  const base = host.base
  host.behavior = async options => {
    await base(options)
    throw Object.assign(new Error('lost the reply'), { outcome: 'unknown' })
  }
  assert.equal(await codeOf(threads.ensureSession({ botId: 'bot-a', threadId: thread.threadId })), 'lost the reply')
  host.behavior = null
  // On the next boot the durable pending marker is visible, and the Host's own
  // record answers it: the Session is adopted, not made again.
  const reopened = open()
  const settled = reopened.reconcile()
  // The pending path adopts inside itself, so the adoption shows up as the
  // settled outcome rather than as a separate count.
  assert.deepEqual(settled, { checked: 1, owned: 1, unbound: 0, missing: 0, unknown: 0, adopted: 0, pending: 1 })
  const adopted = reopened.resolve({ botId: 'bot-a', threadId: thread.threadId })
  assert.equal(adopted.sessionState, 'owned')
  assert.equal(host.created.length, 1)
  assert.equal(reopened.assertSendable({ botId: 'bot-a', threadId: thread.threadId }).sessionId, adopted.sessionId)
})

test('a create the Host cannot confirm stays unknown until an owner recovers it', async t => {
  const { file, host, open } = await opened(t)
  const threads = open()
  const { thread } = threads.create({ botId: 'bot-a', name: '未知' })
  host.unowned.add(thread.threadId)
  // The Host made nothing and recorded nothing, and the reply was lost: no
  // evidence either way, so nothing is replayed on its own.
  host.behavior = async () => { throw Object.assign(new Error('lost the reply'), { outcome: 'unknown' }) }
  assert.equal(await codeOf(threads.ensureSession({ botId: 'bot-a', threadId: thread.threadId })), 'lost the reply')
  host.behavior = null
  threads.close()
  const reopened = open()
  reopened.reconcile()
  assert.equal(reopened.resolve({ botId: 'bot-a', threadId: thread.threadId }).sessionState, 'unknown')
  assert.equal(await codeOf(reopened.ensureSession({ botId: 'bot-a', threadId: thread.threadId })), 'SESSION_UNKNOWN')
  assert.equal(await codeOf(Promise.resolve().then(() => reopened.assertSendable({ botId: 'bot-a', threadId: thread.threadId }))), 'SESSION_UNKNOWN')
  // The owner's explicit recovery is the only way forward, and it is recorded.
  // The Host is able to own a Session again by then, so the recovery lands.
  host.unowned.delete(thread.threadId)
  const recovered = await reopened.recover({ botId: 'bot-a', threadId: thread.threadId })
  assert.equal(recovered.created, true)
  assert.equal(reopened.resolve({ botId: 'bot-a', threadId: thread.threadId }).sessionState, 'owned')
})

test('a trusted refusal that made no Session clears the intent instead of blocking the thread', async t => {
  const { open, host } = await opened(t)
  const threads = open()
  const { thread } = threads.create({ botId: 'bot-a', name: '拒认' })
  host.behavior = async () => { throw Object.assign(new Error('read only'), { outcome: 'refused' }) }
  assert.equal(await codeOf(threads.ensureSession({ botId: 'bot-a', threadId: thread.threadId })), 'read only')
  host.behavior = null
  const retried = await threads.ensureSession({ botId: 'bot-a', threadId: thread.threadId })
  assert.equal(retried.created, true)
  assert.equal(host.created.length, 1)
})

test('a Session becomes usable only after the Host itself confirms the Bot owns it', async t => {
  const { host, open } = await opened(t)
  const threads = open()
  const first = threads.create({ botId: 'bot-a', name: '待确认' }).thread
  const second = threads.create({ botId: 'bot-a', name: '已确认' }).thread
  host.unowned.add(first.threadId)
  assert.equal(await codeOf(threads.ensureSession({ botId: 'bot-a', threadId: first.threadId })), 'SESSION_NOT_OWNED')
  const unbound = threads.resolve({ botId: 'bot-a', threadId: first.threadId })
  assert.equal(unbound.sessionState, 'unbound')
  assert.ok(unbound.sessionId)
  assert.equal(await codeOf(Promise.resolve().then(() => threads.assertSendable({ botId: 'bot-a', threadId: first.threadId }))), 'SESSION_NOT_OWNED')
  // A retry never makes a second Session: the missing hook is reported, not papered over.
  assert.equal(await codeOf(threads.ensureSession({ botId: 'bot-a', threadId: first.threadId })), 'SESSION_NOT_OWNED')
  assert.equal(host.created.filter(call => call.threadId === first.threadId).length, 1)

  const bound = await threads.ensureSession({ botId: 'bot-a', threadId: second.threadId })
  assert.equal(bound.state, 'owned')
  assert.equal(bound.created, true)
  assert.notEqual(bound.sessionId, unbound.sessionId)
  const sendable = threads.assertSendable({ botId: 'bot-a', threadId: second.threadId })
  assert.deepEqual(sendable, { ok: true, botId: 'bot-a', threadId: second.threadId, sessionId: bound.sessionId, sessionState: 'owned', bot: host.bots.get('bot-a'), grantVerified: true })
  // The working directory came from the committed Bot record, never the caller.
  assert.deepEqual(host.created.map(call => call.dir), ['C:/work/a', 'C:/work/a'])
  // Once the Host confirms the earlier Session, the same thread becomes usable
  // without creating anything new.
  host.sessions.set(unbound.sessionId, { botId: 'bot-a' })
  const adopted = await threads.ensureSession({ botId: 'bot-a', threadId: first.threadId })
  assert.equal(adopted.created, false)
  assert.equal(adopted.sessionId, unbound.sessionId)
  assert.equal(threads.assertSendable({ botId: 'bot-a', threadId: first.threadId }).sessionId, unbound.sessionId)
})

test('a mapping the Host withdraws is refused at the next send even though the catalog said owned', async t => {
  const { open, host } = await opened(t)
  const threads = open()
  const { thread } = threads.create({ botId: 'bot-a', name: '撤销' })
  const bound = await threads.ensureSession({ botId: 'bot-a', threadId: thread.threadId })
  assert.equal(threads.assertSendable({ botId: 'bot-a', threadId: thread.threadId }).sessionId, bound.sessionId)
  // The Bot still exists; only the mapping is gone.
  host.sessions.delete(bound.sessionId)
  assert.equal(await codeOf(Promise.resolve().then(() => threads.assertSendable({ botId: 'bot-a', threadId: thread.threadId }))), 'SESSION_NOT_OWNED')
  assert.equal(threads.resolve({ botId: 'bot-a', threadId: thread.threadId }).sessionState, 'unbound')
  // And the catalog does not offer the revoked identity again on its own.
  assert.equal(await codeOf(Promise.resolve().then(() => threads.assertSendable({ botId: 'bot-a', threadId: thread.threadId }))), 'SESSION_NOT_OWNED')
})

test('one Session can never serve two threads', async t => {
  const { host, open } = await opened(t)
  const threads = open()
  const first = threads.create({ botId: 'bot-a', name: '第一' }).thread
  const second = threads.create({ botId: 'bot-a', name: '第二' }).thread
  const bound = await threads.ensureSession({ botId: 'bot-a', threadId: first.threadId })
  host.fixed = bound.sessionId
  assert.equal(await codeOf(threads.ensureSession({ botId: 'bot-a', threadId: second.threadId })), 'THREAD_SESSION_CONFLICT')
  assert.equal(threads.resolve({ botId: 'bot-a', threadId: second.threadId }).sessionId, null)
})

test('archive only hides: the Host drops the authority, the Session identity is kept, and the thread is restored with it', async t => {
  const { host, open } = await opened(t)
  const threads = open()
  const kept = threads.create({ botId: 'bot-a', name: '保留' }).thread
  const hidden = threads.create({ botId: 'bot-a', name: '归档' }).thread
  const bound = await threads.ensureSession({ botId: 'bot-a', threadId: kept.threadId })
  const boundHidden = await threads.ensureSession({ botId: 'bot-a', threadId: hidden.threadId })
  const archived = await threads.archive({ botId: 'bot-a', threadId: hidden.threadId })
  assert.equal(archived.changed, true)
  const view = threads.list('bot-a')
  assert.deepEqual(view.threads.map(thread => thread.state).sort(), ['archived', 'open'])
  // Archiving the active thread leaves the Bot with a well-defined selection.
  assert.equal(view.activeThreadId, kept.threadId)
  // The Host holds the archive: authority is gone there first, history stays.
  assert.equal(host.committedThreads('bot-a').find(record => record.threadId === hidden.threadId).archivedAt, archived.thread.archivedAt)
  const restored = await threads.unarchive({ botId: 'bot-a', threadId: hidden.threadId })
  assert.equal(restored.state, 'open')
  // The Session identity the archive kept comes back with the thread.
  assert.equal(restored.sessionId, boundHidden.sessionId)
  assert.equal(threads.resolve({ botId: 'bot-a', threadId: kept.threadId }).sessionId, bound.sessionId)
  assert.equal(threads.resolve({ botId: 'bot-a', threadId: kept.threadId }).sessionState, 'owned')
  assert.equal(threads.assertSendable({ botId: 'bot-a', threadId: kept.threadId }).sessionId, bound.sessionId)
})

test('rapid switching settles on the last selection and reopens consistently', async t => {
  const { file, host, open } = await opened(t)
  const threads = open()
  const made = []
  for (let index = 0; index < 12; index += 1) made.push(threads.create({ botId: 'bot-a', name: `快切 ${index}` }).thread)
  for (let round = 0; round < 240; round += 1) threads.switchThread({ botId: 'bot-a', threadId: made[round % made.length].threadId })
  assert.equal(threads.list('bot-a').activeThreadId, made[11].threadId)
  assert.equal(host.created.length, 0)
  threads.close()
  assert.equal(open().list('bot-a').activeThreadId, made[11].threadId)
  const saved = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(saved.schemaVersion, BOT_THREAD_SCHEMA)
  assert.equal(saved.bots['bot-a'].threads.length, 12)
})

test('a revoked grant, a deleted Bot and an unhealthy lifecycle all refuse thread writes while reads stay available', async t => {
  const { open, host } = await opened(t)
  const threads = open()
  const { thread } = threads.create({ botId: 'bot-a', name: '写入门' })
  host.grants.set('bot-a', { tools: [], modelRoutes: [] })
  assert.equal(await codeOf(Promise.resolve().then(() => threads.assertSendable({ botId: 'bot-a', threadId: thread.threadId }))), 'BOT_GRANT_EMPTY')
  assert.equal(await codeOf(threads.ensureSession({ botId: 'bot-a', threadId: thread.threadId })), 'BOT_GRANT_EMPTY')
  host.grants.set('bot-a', { tools: ['tool/model_router'], modelRoutes: [{ provider: 'deepseek', model: 'deepseek-chat' }] })
  // A probe that cannot answer is refused, not assumed.
  host.grants.delete('bot-a')
  assert.equal(await codeOf(Promise.resolve().then(() => threads.assertSendable({ botId: 'bot-a', threadId: thread.threadId }))), 'BOT_GRANT_UNKNOWN')
  host.grants.set('bot-a', { tools: ['tool/model_router'], modelRoutes: [{ provider: 'deepseek', model: 'deepseek-chat' }] })
  host.bots.delete('bot-a')
  for (const call of [
    () => threads.create({ botId: 'bot-a', name: '删除后' }),
    () => threads.rename({ botId: 'bot-a', threadId: thread.threadId, name: '删除后' }),
    () => threads.switchThread({ botId: 'bot-a', threadId: thread.threadId }),
    () => threads.archive({ botId: 'bot-a', threadId: thread.threadId }),
    () => threads.openThread({ botId: 'bot-a', threadId: thread.threadId, create: true }),
    () => threads.assertSendable({ botId: 'bot-a', threadId: thread.threadId }),
    () => threads.ensureSession({ botId: 'bot-a', threadId: thread.threadId }),
  ]) assert.equal(await codeOf(Promise.resolve().then(call)), 'BOT_NOT_COMMITTED', call.toString())
  host.healthy = false
  assert.equal(await codeOf(Promise.resolve().then(() => threads.create({ botId: 'bot-a', name: '未就绪' }))), 'LIFECYCLE_UNHEALTHY')
  // Reads keep working: the owner can still see what the catalog holds.
  assert.equal(threads.list('bot-a').threads.length, 1)
  const model = threads.readModel({ botId: 'bot-a' })
  assert.equal(model.status, 'blocked')
  assert.ok(Array.isArray(model.items))
  assert.equal(model.items.length, 0)
})

test('a Bot moved to the independent runtime gains no Host Session on the integration path', async t => {
  const { file, open, host } = await opened(t)
  const threads = open()
  const { thread } = threads.create({ botId: 'bot-a', name: '迁移边界' })
  const moved = createBotThreads({
    file,
    committedBot: host.committedBot,
    lifecycleStatus: host.lifecycleStatus,
    botAuthorized: host.botAuthorized,
    ownsSession: host.ownsSession,
    committedThreads: host.committedThreads,
    createSession: host.createSession,
    runtimeMode: () => 'independent',
    now: () => 1_700_000_000_000,
  })
  assert.equal(await codeOf(moved.ensureSession({ botId: 'bot-a', threadId: thread.threadId })), 'RUNTIME_MODE_MISMATCH')
  assert.equal(await codeOf(Promise.resolve().then(() => moved.assertSendable({ botId: 'bot-a', threadId: thread.threadId }))), 'RUNTIME_MODE_MISMATCH')
  assert.equal(await codeOf(Promise.resolve().then(() => moved.openThread({ botId: 'bot-a', threadId: thread.threadId, create: true }))), 'RUNTIME_MODE_MISMATCH')  // The catalog itself stays usable: switching and naming never touch a runtime.
  assert.equal(moved.switchThread({ botId: 'bot-a', threadId: thread.threadId }).activeThreadId, thread.threadId)
  // And the projection says the mode plainly instead of pretending.
  assert.equal(moved.readModel({ botId: 'bot-a' }).status, 'blocked')
  assert.match(moved.readModel({ botId: 'bot-a' }).reason, /independent/)
})

test('reconcile re-reads the Host after a restart and reports lost Sessions without dropping threads', async t => {
  const { open, host } = await opened(t)
  const threads = open()
  const first = threads.create({ botId: 'bot-a', name: '其一' }).thread
  const second = threads.create({ botId: 'bot-a', name: '其二' }).thread
  await threads.ensureSession({ botId: 'bot-a', threadId: first.threadId })
  const dropped = await threads.ensureSession({ botId: 'bot-a', threadId: second.threadId })
  threads.close()
  // The Host kept one Session and lost the other.
  host.sessions.delete(dropped.sessionId)
  const reopened = open()
  const result = reopened.reconcile()
  assert.deepEqual(result, { checked: 2, owned: 1, unbound: 0, missing: 1, unknown: 0, adopted: 0, pending: 0 })
  assert.equal(reopened.resolve({ botId: 'bot-a', threadId: first.threadId }).sessionState, 'owned')
  const lost = reopened.resolve({ botId: 'bot-a', threadId: second.threadId })
  assert.equal(lost.sessionState, 'missing')
  assert.equal(await codeOf(Promise.resolve().then(() => reopened.assertSendable({ botId: 'bot-a', threadId: second.threadId }))), 'SESSION_MISSING')
  assert.equal(reopened.list('bot-a').threads.length, 2)
})

test('a thread the Host archived is archived here too, without a second writer', async t => {
  const { open, host } = await opened(t)
  const threads = open()
  const { thread } = threads.create({ botId: 'bot-a', name: '宿主归档' })
  await threads.ensureSession({ botId: 'bot-a', threadId: thread.threadId })
  await host.setThreadArchived({ botId: 'bot-a', threadId: thread.threadId, archivedAt: 1_700_000_009_000 })
  const result = threads.reconcile()
  assert.equal(result.checked, 1)
  assert.equal(threads.resolve({ botId: 'bot-a', threadId: thread.threadId }).state, 'archived')
  assert.equal(threads.list('bot-a').activeThreadId, null)
})

test('a deleted Bot is purged only after the Host retires it', async t => {
  const { open, host } = await opened(t)
  const threads = open()
  threads.create({ botId: 'bot-a', name: '待删' })
  threads.create({ botId: 'bot-b', name: '保留' })
  assert.equal(await codeOf(Promise.resolve().then(() => threads.purgeBot('bot-a'))), 'BOT_STILL_COMMITTED')
  host.bots.delete('bot-a')
  assert.deepEqual(threads.purgeBot('bot-a'), { botId: 'bot-a', removed: 1 })
  assert.equal(threads.list('bot-a').threads.length, 0)
  assert.equal(threads.list('bot-b').threads.length, 1)
})

test('the model always follows the Bot: the catalog stores no model, route, directory or credential', async t => {
  const { file, open } = await opened(t)
  const threads = open()
  const { thread } = threads.create({ botId: 'bot-a', name: '跟随' })
  threads.switchThread({ botId: 'bot-a', threadId: thread.threadId })
  const saved = JSON.parse(await readFile(file, 'utf8'))
  const text = JSON.stringify(saved)
  for (const forbidden of ['model', 'route', 'provider', 'workDir', 'credential', 'endpoint', 'segments', 'parts', 'grant']) {
    assert.ok(!text.includes(forbidden), `the catalog must not carry ${forbidden}`)
  }
  assert.equal(await codeOf(Promise.resolve().then(() => threads.assertSendable({ botId: 'bot-a', threadId: thread.threadId }))), 'SESSION_MISSING')
})

test('a missing file reads as an empty catalog; a newer or malformed one fails loudly; a v1 file still loads', async t => {
  const { dir, open } = await opened(t)
  assert.deepEqual(open().list('bot-a'), { botId: 'bot-a', activeThreadId: null, threads: [] })
  await writeFile(join(dir, 'bot-threads.json'), JSON.stringify({ schemaVersion: BOT_THREAD_SCHEMA + 1, revision: 1, bots: {} }))
  assert.equal(await codeOf(Promise.resolve().then(open)), 'BOT_THREAD_SCHEMA_NEWER')
  await writeFile(join(dir, 'bot-threads.json'), '{ not json')
  assert.equal(await codeOf(Promise.resolve().then(open)), 'BOT_THREADS_INVALID')
  await writeFile(join(dir, 'bot-threads.json'), JSON.stringify({ schemaVersion: 1, revision: 2, bots: { 'bot-a': { threads: [{ threadId: 't-1', name: '旧', createdAt: 5, updatedAt: 6, sessionId: 's-1', archivedAt: 0 }], requestKeys: {} } } }))
  const legacy = open()
  const [record] = legacy.list('bot-a').threads
  assert.equal(record.threadId, 't-1')
  assert.equal(record.state, 'archived')
  assert.equal(record.sessionState, 'unbound')
})

test('a duplicate thread or Session claim in a hand-edited file is refused, not merged', async t => {
  const { dir, open } = await opened(t)
  const threads = open()
  threads.create({ botId: 'bot-a', name: '甲' })
  const saved = JSON.parse(await readFile(join(dir, 'bot-threads.json'), 'utf8'))
  const duplicate = structuredClone(saved.bots['bot-a'].threads[0])
  saved.bots['bot-a'].threads.push(duplicate)
  await writeFile(join(dir, 'bot-threads.json'), JSON.stringify(saved))
  assert.equal(await codeOf(Promise.resolve().then(open)), 'AMBIGUOUS_THREAD_OWNER')
  const shared = JSON.parse(await readFile(join(dir, 'bot-threads.json'), 'utf8'))
  shared.bots['bot-a'].threads.pop()
  shared.bots['bot-a'].threads[0].sessionId = 's-shared'
  shared.bots['bot-b'] = { activeThreadId: null, threads: [{ ...shared.bots['bot-a'].threads[0], threadId: 'other' }], requestKeys: {} }
  await writeFile(join(dir, 'bot-threads.json'), JSON.stringify(shared))
  assert.equal(await codeOf(Promise.resolve().then(open)), 'AMBIGUOUS_THREAD_SESSION')
})

test('the send gate answers with the same reason whether it is probed or thrown', async t => {
  const { open, host } = await opened(t)
  const threads = open()
  const { thread } = threads.create({ botId: 'bot-a', name: '一致' })
  // The branching shape a caller must read and the throwing shape it may catch
  // are one implementation: they can never name different reasons.
  const compare = async label => {
    const probe = threads.probeSendable({ botId: 'bot-a', threadId: thread.threadId })
    const thrown = await codeOf(Promise.resolve().then(() => threads.assertSendable({ botId: 'bot-a', threadId: thread.threadId })))
    assert.equal(probe.ok, false, `${label}: the probe allowed what the throw refused`)
    assert.equal(probe.code, thrown, `${label}: the probe and the throw disagree`)
    return probe
  }
  // Never created: no Session id, no create intent, nothing the Host failed to
  // confirm. This is the only state a caller may ask to have one made.
  const never = await compare('never created')
  assert.equal(never.sessionState, 'none')
  await threads.ensureSession({ botId: 'bot-a', threadId: thread.threadId })
  const owned = threads.probeSendable({ botId: 'bot-a', threadId: thread.threadId })
  assert.deepEqual(owned, { ok: true, botId: 'bot-a', threadId: thread.threadId, sessionId: owned.sessionId, sessionState: 'owned', bot: host.committedBot('bot-a'), grantVerified: true })
  await threads.archive({ botId: 'bot-a', threadId: thread.threadId })
  assert.equal((await compare('archived')).code, 'THREAD_ARCHIVED')
})

test('a rename lands in the Host thread record first, and an unconfirmed one changes nothing', async t => {
  const { open, host } = await opened(t)
  const threads = open()
  const { thread } = threads.create({ botId: 'bot-a', name: '原名' })
  await threads.ensureSession({ botId: 'bot-a', threadId: thread.threadId })
  const renamed = await threads.rename({ botId: 'bot-a', threadId: thread.threadId, name: '新标题' })
  assert.equal(renamed.name, '新标题')
  // The Host holds the title, not only this catalog.
  assert.equal(host.hostThreads.get('bot-a').find(record => record.threadId === thread.threadId).name, '新标题')
  assert.deepEqual(host.renames.at(-1), { botId: 'bot-a', threadId: thread.threadId, name: '新标题' })
  assert.equal(threads.readModel({ botId: 'bot-a' }).renameAuthority, 'host')
  // A reply that never arrives is not a rename: the old name stands.
  host.renameBehavior = async () => { throw Object.assign(new Error('lost the reply'), { outcome: 'unknown' }) }
  assert.equal(await codeOf(threads.rename({ botId: 'bot-a', threadId: thread.threadId, name: '更远的名字' })), 'lost the reply')
  assert.equal(threads.resolve({ botId: 'bot-a', threadId: thread.threadId }).name, '新标题')
  // A partial submit that confirms a different title is not a rename either.
  host.renameBehavior = async () => ({ threadId: thread.threadId, name: '别的标题' })
  assert.equal(await codeOf(threads.rename({ botId: 'bot-a', threadId: thread.threadId, name: '又一個名字' })), 'THREAD_RENAME_UNCONFIRMED')
  assert.equal(threads.resolve({ botId: 'bot-a', threadId: thread.threadId }).name, '新标题')
  assert.equal(host.hostThreads.get('bot-a').find(record => record.threadId === thread.threadId).name, '新标题')
  // A thread with no Session has no Host record to write: its name stays here
  // and travels into the record when the Session is made.
  host.renameBehavior = async () => { throw Object.assign(new Error('Unknown thread'), { code: 'BOT_THREAD_UNKNOWN' }) }
  const fresh = threads.create({ botId: 'bot-a', name: '无会话' }).thread
  assert.equal((await threads.rename({ botId: 'bot-a', threadId: fresh.threadId, name: '还是无会话' })).name, '还是无会话')
  await threads.ensureSession({ botId: 'bot-a', threadId: fresh.threadId })
  assert.equal(host.hostThreads.get('bot-a').find(record => record.threadId === fresh.threadId).name, '还是无会话')
})
test('a create intent keeps its request key through an unknown outcome, so a retry is the same thread', async t => {
  const { open, host } = await opened(t)
  const threads = open()
  host.behavior = async () => { throw Object.assign(new Error('lost the reply'), { outcome: 'unknown' }) }
  const first = threads.create({ botId: 'bot-a', name: '丢键', requestKey: 'key-1' }).thread
  assert.equal(await codeOf(threads.ensureSession({ botId: 'bot-a', threadId: first.threadId })), 'lost the reply')
  host.behavior = null
  // The durable intent stands until the Host record settles it: it is never
  // cleared on its own, and a send is refused meanwhile.
  assert.equal(threads.resolve({ botId: 'bot-a', threadId: first.threadId }).sessionState, 'pending')
  assert.equal(await codeOf(Promise.resolve().then(() => threads.assertSendable({ botId: 'bot-a', threadId: first.threadId }))), 'SESSION_UNKNOWN')
  // The same key answers with the thread it already made: a retry is the same
  // intent, never a second thread.
  const again = threads.create({ botId: 'bot-a', name: '丢键', requestKey: 'key-1' })
  assert.equal(again.created, false)
  assert.equal(again.thread.threadId, first.threadId)
  assert.equal(threads.list('bot-a').threads.length, 1)
  // And the unknown outcome still refuses a send until an owner recovers it.
  assert.equal(await codeOf(Promise.resolve().then(() => threads.assertSendable({ botId: 'bot-a', threadId: first.threadId }))), 'SESSION_UNKNOWN')
})
test('a deleted Bot leaves its threads as a tombstone until an explicit purge, so an old Session keeps its identity', async t => {
  const { open, host } = await opened(t)
  const threads = open()
  const { thread } = threads.create({ botId: 'bot-a', name: '墓碑' })
  const bound = await threads.ensureSession({ botId: 'bot-a', threadId: thread.threadId })
  host.bots.delete('bot-a')
  // Nothing purges on its own: the rows stay, and the Session they name still
  // resolves, so a historical turn is never mistaken for an unknown one.
  assert.equal(threads.list('bot-a').threads.length, 1)
  assert.deepEqual(threads.threadBySession(bound.sessionId), { botId: 'bot-a', threadId: thread.threadId })
  assert.equal(await codeOf(Promise.resolve().then(() => threads.assertSendable({ botId: 'bot-a', threadId: thread.threadId }))), 'BOT_NOT_COMMITTED')
  assert.equal(threads.readModel({ botId: 'bot-a' }).status, 'blocked')
  // Only an explicit owner act removes them.
  assert.deepEqual(threads.purgeBot('bot-a'), { botId: 'bot-a', removed: 1 })
  assert.deepEqual(threads.threadBySession(bound.sessionId), null)
})

test('the parse helper normalises records without inventing identity', () => {  const parsed = parseBotThreads({
    schemaVersion: BOT_THREAD_SCHEMA, revision: 4,
    bots: { 'bot-a': { threads: [{ threadId: 't-1', name: '旧', createdAt: 5, updatedAt: 6, sessionId: 's-1', archivedAt: 0 }], requestKeys: {} } },
  })
  const [record] = parsed.bots['bot-a'].threads
  assert.equal(record.botId, 'bot-a')
  assert.equal(record.sessionState, 'unbound')
  assert.equal(record.archivedAt, 0)
  assert.equal(record.requestKey, null)
  assert.equal(record.operationKey, null)
})

test('a commit that cannot land leaves the durable catalog answering, never the mutation', async t => {
  const { file, open, host } = await opened(t)
  const threads = open()
  const { thread } = threads.create({ botId: 'bot-a', name: '可提交' })
  await threads.ensureSession({ botId: 'bot-a', threadId: thread.threadId })
  const { readFileSync } = await import('node:fs')
  await withStorageFailure(t, 'renameSync', (_from, to) => String(to) === file, () => {
    assert.throws(() => threads.create({ botId: 'bot-a', name: '落不了地', requestKey: 'key-doomed' }), error => error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EBUSY')
  })
  // The mutation did not land, so it must not answer: the catalog re-read what is
  // durable, and the doomed requestKey maps to nothing.
  assert.equal(threads.list('bot-a').threads.length, 1)
  assert.equal(threads.list('bot-a').threads[0].threadId, thread.threadId)
  assert.equal(threads.resolve({ botId: 'bot-a', threadId: thread.threadId }).sessionState, 'owned')
  assert.equal(threads.revision() > 0, true)
  // A restart agrees with what is on disk, and a later write works again.
  const durable = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(durable.bots['bot-a'].threads.length, 1)
  assert.equal(durable.bots['bot-a'].requestKeys['key-doomed'], undefined)
  const retry = open().create({ botId: 'bot-a', name: '落不了地', requestKey: 'key-doomed' })
  assert.equal(retry.created, true)
})

test('a create intent that cannot be written durably never reaches the Session factory', async t => {
  const { file, open, host } = await opened(t)
  const threads = open()
  const { thread } = threads.create({ botId: 'bot-a', name: '意图' })
  await withStorageFailure(t, 'renameSync', (_from, to) => String(to) === file, async () => {
    await assert.rejects(() => threads.ensureSession({ botId: 'bot-a', threadId: thread.threadId }), error => error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EBUSY')
  })
  // No Session was made for an intent that could not be recorded: the durable
  // intent write comes first, and its failure stops the create.
  assert.equal(host.created.length, 0)
  assert.equal(threads.resolve({ botId: 'bot-a', threadId: thread.threadId }).sessionState, 'none')
  // And the next attempt is a clean, recordable one.
  const bound = await threads.ensureSession({ botId: 'bot-a', threadId: thread.threadId })
  assert.equal(bound.created, true)
  assert.equal(host.created.length, 1)
})
