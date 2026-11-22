import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createCodexSubscriptionBackend } from '../../bot-engines/src/codex-subscription.mjs'

import { ChatGptPlanAdapter } from './chatgpt-plan-adapter.mjs'
import { hasPlanGrant } from './chatgpt-plan-oauth.mjs'

const kind = 'codex'
const chatGpt = 'chatgpt'
const chatGptName = 'ChatGPT 套餐'
const providerName = 'ChatGPT / Codex'
const token = /^[a-f0-9]{32}$/
const modelId = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,239}$/
const digest = value => createHash('sha256').update(value).digest('hex')
const route = (id, model) => 'bot-sub-' + id + '-' + digest(model).slice(0, 16)
const legacyRoute = id => 'bot-sub-' + id
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
const text = (value, max) => typeof value === 'string' && value.length <= max && !/\p{Cc}/u.test(value) ? value : ''
const owner = context => {
  if (context?.kind !== 'owner') fail('REMOTE_OWNER_REQUIRED', '请以宿主拥有者身份管理订阅账户。')
  context.signal?.throwIfAborted()
}
const keys = (input, names = []) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !names.includes(key))) {
    fail('SUBSCRIPTION_INVALID', '订阅账户请求格式无效。')
  }
}
const message = error => typeof error?.code === 'string' && error.code.startsWith('SUBSCRIPTION_')
  ? text(error.message, 240) || '订阅请求未完成。' : '订阅连接未完成，请重试。'

/** The Host stores account metadata and derives all inference routes from it. */
export function openSubscriptionAccounts({ Database, file, root, backend = createCodexSubscriptionBackend({ root }),
  chatGptPlan, llm, usedBy = () => [], checkProfiles = () => {}, onChanged = async () => {}, now = Date.now }) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file)
  db.exec('CREATE TABLE IF NOT EXISTS bot_native_subscription_accounts (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, health TEXT)')
  db.exec('CREATE TABLE IF NOT EXISTS bot_chatgpt_host (key INTEGER PRIMARY KEY CHECK(key=1), host_id TEXT NOT NULL)')
  const hostId = () => db.transaction(() => {
    const current = db.prepare('SELECT host_id FROM bot_chatgpt_host WHERE key=1').get()
    if (current) return current.host_id
    const id = 'urn:uuid:' + randomUUID()
    db.prepare('INSERT INTO bot_chatgpt_host(key,host_id) VALUES(1,?)').run(id)
    return id
  }).immediate()
  const mounted = new Map()
  const legacy = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bot_subscription_accounts'").get())
  let closed = false, pending = null, queue = Promise.resolve()
  const serial = work => {
    const next = queue.then(() => {
      if (closed) fail('SUBSCRIPTION_CLOSED', '订阅账户服务已关闭。')
      return work()
    })
    queue = next.catch(() => {})
    return next
  }
  const parse = row => {
    if (!row) return null
    const account = JSON.parse(row.payload)
    if (!token.test(account.id ?? '') || account.id !== row.id || ![kind, chatGpt].includes(account.kind)
      || account.kind === chatGpt && (!/^oaiapp_[\w-]+$/.test(account.clientId ?? '') || typeof account.subject !== 'string' || !account.subject) || typeof account.active !== 'boolean'
      || !Array.isArray(account.models) || account.models.length > 64 || account.models.some(model => !modelId.test(model.id ?? '') || !text(model.name, 240))
      || new Set(account.models.map(model => model.id)).size !== account.models.length
      || !Number.isSafeInteger(row.revision) || row.revision < 1) fail('SUBSCRIPTION_STORE_INVALID', '订阅账户记录无效。')
    return { ...account, revision: row.revision, health: row.health ? JSON.parse(row.health) : null }
  }
  const rows = () => db.prepare('SELECT * FROM bot_native_subscription_accounts ORDER BY rowid').all().map(parse)
  const read = id => parse(db.prepare('SELECT * FROM bot_native_subscription_accounts WHERE id=?').get(id))
  const viewUsage = providers => [...new Map(providers.flatMap(provider => usedBy(provider)).map(bot => [bot.id, bot])).values()]
  const profileRows = accounts => backend.available ? accounts.filter(account => account.kind === kind && account.active).flatMap(account => account.models.map(model => {
    const provider = route(account.id, model.id)
    return { id: provider, provider, model: model.id, name: account.name, driver: kind, entry: account.entry, revision: account.revision,
      credentialRef: 'subscription-home/' + account.id, hostTools: false }
  })) : []
  const directRows = () => chatGptPlan?.available ? rows().filter(account => account.kind === chatGpt && account.active) : []
  const disposeRoute = item => { item.controller.abort(); item.release() }
  const syncDirect = () => {
    if (closed || !chatGptPlan) return
    const wanted = new Map(directRows().flatMap(account => account.models.map(model => [route(account.id, model.id), { account, model }])))
    for (const [provider, item] of mounted) {
      if (wanted.get(provider)?.account.revision === item.revision) continue
      disposeRoute(item)
      mounted.delete(provider)
    }
    for (const [provider, { account, model }] of wanted) {
      if (mounted.has(provider)) continue
      const controller = new AbortController()
      const adapter = new ChatGptPlanAdapter({ model, provider, name: account.name, fetcher: chatGptPlan.fetcher,
        acquire: async signal => {
          const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
          combined.throwIfAborted()
          try {
            const accessToken = await chatGptPlan.access(account, combined)
            combined.throwIfAborted()
            return { token: accessToken, signal: controller.signal, release() {} }
          } catch (error) {
            if (['SUBSCRIPTION_AUTH_REQUIRED', 'SUBSCRIPTION_PLAN_DISABLED'].includes(error.code) && !combined.aborted) {
              void serial(async () => {
                if (read(account.id)?.revision !== account.revision) return
                write({ ...account, active: false, needsConsent: error.code === 'SUBSCRIPTION_PLAN_DISABLED' }, account)
                await changedRoutes()
              }).catch(() => {})
            }
            throw error
          }
        },
        markVerified: () => {
          if (!closed) db.prepare('UPDATE bot_native_subscription_accounts SET health=? WHERE id=? AND revision=?')
            .run(JSON.stringify({ kind: 'verified' }), account.id, account.revision)
        },
      })
      const release = llm.registerAdapter([provider], adapter)
      mounted.set(provider, { controller, release, revision: account.revision })
    }
  }
  const write = ({ revision, health, ...account }, previous) => {
    const stored = { ...account, revision: (previous?.revision ?? 0) + 1, health: null }
    const all = rows().filter(row => row.id !== account.id)
    checkProfiles(profileRows([...all, stored]))
    db.prepare('INSERT INTO bot_native_subscription_accounts(id, revision, payload, health) VALUES(?,?,?,NULL)'
      + ' ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,health=NULL')
      .run(account.id, stored.revision, JSON.stringify(account))
  }
  const oldAccounts = () => !legacy ? [] : db.prepare('SELECT id,revision,payload FROM bot_subscription_accounts ORDER BY rowid').all().flatMap(row => {
    if (!token.test(row.id)) return []
    try {
      const data = JSON.parse(row.payload)
      const provider = legacyRoute(row.id)
      return [{ id: row.id, revision: row.revision, provider, kind: text(data.kind, 40),
        name: text(data.name, 128) || '旧版订阅账户', email: text(data.email, 160), enabled: false,
        state: 'legacy', models: [], usedBy: usedBy(provider) }]
    } catch { return [] }
  })
  const loginView = session => ({
    loginId: session.id, provider: session.kind ?? kind, expiresAt: session.expiresAt,
    ...(session.authorization ? { url: session.authorization.url } : { preparing: true }),
  })
  const list = context => {
    owner(context)
    return {
      schemaVersion: 1, service: { phase: backend.available || chatGptPlan?.available ? 'ready' : 'unsupported' },
      providers: [
        ...(chatGptPlan ? [{ id: chatGpt, name: chatGptName, available: chatGptPlan.available }] : []),
        { id: kind, name: providerName, available: backend.available },
      ],
      accounts: [...rows().map(account => ({
        id: account.id, revision: account.revision, provider: legacyRoute(account.id), kind: account.kind, name: account.name,
        email: account.email, plan: account.plan, enabled: account.active,
        state: !account.active ? account.needsConsent ? 'needs-consent' : 'needs-login' : !account.models.length ? 'needs-models' : account.health?.kind === 'verified' ? 'ready' : 'configured',
        models: account.models.map(model => ({ ...model, provider: route(account.id, model.id) })),
        usedBy: viewUsage(account.models.map(model => route(account.id, model.id))),
      })), ...oldAccounts()],
      pendingLogins: pending && pending.expiresAt > now() ? [loginView(pending)] : [],
    }
  }
  const retire = async (session, keepAccount = false) => {
    if (!session) return
    session.controller.abort()
    await session.job
    await session.connection?.close()
    if (!keepAccount) {
      if (session.kind !== chatGpt) await backend.forget(session.id)
      else if (!session.previous && session.result) await chatGptPlan.discard(session.result)
    }
    if (pending === session) pending = null
  }
  const statusFor = input => {
    keys(input, ['loginId'])
    if (!pending || pending.id !== input.loginId) fail('SUBSCRIPTION_LOGIN_EXPIRED', '此授权已结束，请重新连接账户。')
    return pending
  }
  const update = async (account, signal, quotaOnly) => {
    let snapshot, entry
    try {
      const connection = await backend.open(account.id, { signal })
      try {
        snapshot = await connection.snapshot(signal, { quotaOnly })
        entry = connection.entry
      } finally { await connection.close() }
      signal?.throwIfAborted()
    } catch (error) {
      signal?.throwIfAborted()
      if (error.code === 'SUBSCRIPTION_AUTH_REQUIRED') {
        if (account.active) write({ ...account, active: false, reading: null }, account)
        return account.active
      }
      if (!quotaOnly) throw error
      return false
    }
    const { windows, ...view } = snapshot
    const reading = windows?.length ? { observedAt: now(), windows } : account.reading
    const { revision, health, ...current } = account
    const next = quotaOnly ? { ...current, reading } : { ...current, ...view, reading, entry, active: true }
    const changed = !quotaOnly && JSON.stringify({ ...current, reading: null }) !== JSON.stringify({ ...next, reading: null })
    if (changed) write(next, account)
    else db.prepare('UPDATE bot_native_subscription_accounts SET payload=? WHERE id=? AND revision=?').run(JSON.stringify(next), account.id, revision)
    return changed
  }
  const updateDirect = async (account, signal) => {
    try {
      const models = await chatGptPlan.models(await chatGptPlan.access(account, signal), signal)
      signal?.throwIfAborted()
      if (JSON.stringify(account.models) === JSON.stringify(models)) return false
      write({ ...account, models }, account)
    } catch (error) {
      signal?.throwIfAborted()
      if (!['SUBSCRIPTION_AUTH_REQUIRED', 'SUBSCRIPTION_PLAN_DISABLED'].includes(error.code)) throw error
      write({ ...account, active: false, needsConsent: error.code === 'SUBSCRIPTION_PLAN_DISABLED' }, account)
    }
    return true
  }
  const changedRoutes = async () => { syncDirect(); await onChanged() }
  const timer = setInterval(() => {
    if (pending?.expiresAt <= now()) void serial(() => pending?.expiresAt <= now() && retire(pending)).catch(() => {})
  }, 30_000)
  timer.unref?.()

  syncDirect()
  return Object.freeze({
    sync: syncDirect,
    list,
    profiles: () => profileRows(rows()),
    routes: () => [...profileRows(rows()).map(({ provider, model }) => ({ provider, model })),
      ...directRows().flatMap(account => account.models.map(model => ({ provider: route(account.id, model.id), model: model.id })))],
    isDirect: provider => mounted.has(provider),
    owns: provider => /^bot-sub-[a-f0-9]{32}(?:-[a-f0-9]{16})?$/.test(provider),
    metadata(provider) {
      const id = /^bot-sub-([a-f0-9]{32})-[a-f0-9]{16}$/.exec(provider)?.[1]
      const account = id && read(id)
      return account?.models.some(model => route(id, model.id) === provider) ? { id, name: account.name, enabled: account.active } : null
    },
    async credentialHome(profile) {
      const id = profile.credentialRef.slice('subscription-home/'.length)
      const record = read(id)
      if (!record || record.revision !== profile.revision || !record.active || route(id, profile.model) !== profile.provider
        || !record.models.some(model => model.id === profile.model) || JSON.stringify(record.entry) !== JSON.stringify(profile.entry)) {
        fail('SUBSCRIPTION_ROUTE_CHANGED', '订阅账户或模型已更改。')
      }
      return backend.credentialHome(id)
    },
    markResult(profile, result) {
      if (closed) return
      const id = profile.credentialRef.slice('subscription-home/'.length)
      db.prepare('UPDATE bot_native_subscription_accounts SET health=? WHERE id=? AND revision=?')
        .run(JSON.stringify({ kind: result.kind }), id, profile.revision)
    },
    accountQuotas: () => rows().map(({ id, name, reading }) => ({ id, name, reading: reading ?? null })),
    refreshQuotas: context => serial(async () => {
      owner(context)
      if (!backend.available || pending) return
      let changed = false
      try {
        for (const account of rows().filter(account => account.kind === kind && account.active)) {
          if (account.reading && now() - account.reading.observedAt < 30_000) continue
          changed = await update(account, context.signal, true) || changed
        }
      } finally { if (changed) await onChanged() }
    }),
    // Keep the published actions available for older clients. There is no service lifecycle to configure.
    enable(input, context) { owner(context); keys(input); return list(context).service },
    stop: (input, context) => serial(async () => { owner(context); keys(input); await retire(pending); return list(context) }),
    refresh: (input, context) => serial(async () => {
      owner(context); keys(input)
      if (pending) return list(context)
      let changed = false
      try {
        for (const account of rows()) {
          if (account.kind === chatGpt) {
            if (chatGptPlan?.available && account.active) changed = await updateDirect(account, context.signal) || changed
          } else if (backend.available) changed = await update(account, context.signal, false) || changed
        }
      } finally { if (changed) await changedRoutes() }
      return list(context)
    }),
    login: (input, context) => serial(async () => {
      owner(context); keys(input, ['provider', 'id', 'expectedRevision', 'consent'])
      const direct = input.provider === chatGpt
      if (!(direct ? chatGptPlan?.available : input.provider === kind && backend.available)) {
        fail('SUBSCRIPTION_PROVIDER_UNAVAILABLE', '当前宿主尚未支持此订阅授权。')
      }
      let previous
      if (input.id !== undefined || input.expectedRevision !== undefined || input.consent !== undefined) {
        previous = direct && token.test(input.id ?? '') && read(input.id)
        if (!previous || previous.kind !== chatGpt || previous.revision !== input.expectedRevision
          || input.consent !== undefined && typeof input.consent !== 'boolean') {
          fail('SUBSCRIPTION_CONFLICT', 'ChatGPT 账户已更改，请刷新。')
        }
      }
      if (pending?.expiresAt <= now()) await retire(pending)
      if (pending) return loginView(pending)
      const session = { id: randomUUID().replaceAll('-', ''), kind: input.provider, previous,
        controller: new AbortController(), expiresAt: now() + 5 * 60_000 }
      pending = session
      session.job = (async () => {
        const { signal } = session.controller
        if (direct) {
          session.connection = await chatGptPlan.begin({ hostId: hostId(), account: previous, consent: input.consent === true, signal,
            onResult(result) {
              void result.then(value => { session.result = value }, error => {
                session.failure = { message: message(error), code: error.code }
              })
            } })
          session.authorization = { url: session.connection.url }
          return
        }
        session.connection = await backend.open(session.id, { signal, create: true, onLogin(peerId, success) { session.outcome = { peerId, success } } })
        signal.throwIfAborted()
        session.authorization = await session.connection.login()
      })().catch(error => {
        session.failure = { message: message(error), ...(error?.code === 'SUBSCRIPTION_CODEX_REQUIRED' ? { code: error.code } : {}) }
      })
      return loginView(session)
    }),
    loginStatus: (input, context) => serial(async () => {
      owner(context)
      const session = statusFor(input)
      if (session.failure || session.expiresAt <= now()) {
        await retire(session)
        return { status: 'error', ...(session.failure ?? { message: '授权已过期，请重新连接账户。' }) }
      }
      if (!session.authorization) return { status: 'preparing' }
      if (session.kind === chatGpt) {
        if (!session.result) return { status: 'pending', login: loginView(session) }
        const { clientId, subject, email, tokens } = session.result
        const previous = session.previous
        const active = hasPlanGrant(tokens)
        let models = previous?.models ?? [], catalogWarning
        if (active) {
          try { models = await chatGptPlan.models(tokens.accessToken, context.signal) }
          catch (error) {
            context.signal?.throwIfAborted()
            models = []
            catalogWarning = '已登录 ChatGPT，暂时无法获取模型目录，请点击同步模型。'
          }
        }
        context.signal?.throwIfAborted()
        const id = previous?.id ?? session.id
        const account = { id, kind: chatGpt, clientId, subject, email, name: previous?.name ?? chatGptName + ' · ' + id.slice(0, 4),
          plan: '', models, active, needsConsent: !active, reading: null }
        await chatGptPlan.install(account, tokens, () => {
          context.signal?.throwIfAborted()
          write(account, previous)
        })
        await retire(session, true)
        await changedRoutes()
        return { status: 'complete', view: list(context), ...(catalogWarning ? { notice: catalogWarning } : !active
          ? { notice: '已登录 ChatGPT，请授权使用套餐后选择模型。' } : {}) }
      }
      if (session.outcome?.peerId !== session.authorization.peerId) {
        if (!session.connection.closed) return { status: 'pending', login: loginView(session) }
        await retire(session)
        return { status: 'error', message: '授权会话已关闭，请重试。' }
      }
      if (!session.outcome.success) {
        await retire(session)
        return { status: 'error', message: '厂商授权未完成，请重试。' }
      }
      const { email, plan, models, windows } = await session.connection.snapshot(context.signal)
      await backend.credentialHome(session.id)
      const account = { id: session.id, kind, name: providerName + ' · ' + session.id.slice(0, 4), email, plan, models,
        entry: session.connection.entry, active: true, reading: windows?.length ? { observedAt: now(), windows } : null }
      await retire(session, true)
      try { write(account) }
      catch (error) { await backend.forget(session.id); throw error }
      await onChanged()
      return { status: 'complete', view: list(context) }
    }),
    callback(input, context) {
      owner(context); keys(input, ['loginId', 'callbackUrl'])
      fail('SUBSCRIPTION_CALLBACK_UNSUPPORTED', '请在 Codex 官方授权页完成登录。')
    },
    cancelLogin: (input, context) => serial(async () => {
      owner(context)
      const session = statusFor(input)
      if (session.kind !== chatGpt && session.authorization) await session.connection.cancel(session.authorization.peerId).catch(() => {})
      await retire(session)
      return { cancelled: true }
    }),
    remove: (input, context) => serial(async () => {
      owner(context); keys(input, ['id', 'expectedRevision'])
      if (!token.test(input.id ?? '')) fail('SUBSCRIPTION_INVALID', '请选择已有订阅账户。')
      const account = read(input.id)
      if (!account || account.revision !== input.expectedRevision) fail('SUBSCRIPTION_CONFLICT', '订阅账户已更改，请刷新。')
      if (account.kind === chatGpt) {
        if (!chatGptPlan?.available) fail('SUBSCRIPTION_STORE_UNAVAILABLE', '当前宿主无法访问 ChatGPT 凭据。')
        write({ ...account, active: false, needsConsent: false }, account)
        syncDirect()
        try {
          const revoked = await chatGptPlan.disconnect(account)
          return { disconnected: true, revoked }
        } finally { await onChanged() }
      }
      if (viewUsage(account.models.map(model => route(account.id, model.id))).length) fail('SUBSCRIPTION_IN_USE', '仍有 Bot 使用此账户，请先切换模型。')
      await backend.forget(account.id)
      db.prepare('DELETE FROM bot_native_subscription_accounts WHERE id=? AND revision=?').run(account.id, account.revision)
      await onChanged()
      return { removed: true }
    }),
    async close() {
      if (closed) return
      clearInterval(timer)
      closed = true
      for (const item of mounted.values()) disposeRoute(item)
      mounted.clear()
      pending?.controller.abort()
      await queue.catch(() => {})
      try { await retire(pending) } finally { db.close() }
    },
  })
}
