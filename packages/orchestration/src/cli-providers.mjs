import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
const owner = context => { if (context?.kind !== 'owner') fail('REMOTE_OWNER_REQUIRED', '请使用已认证的拥有者身份配置 CLI 聊天。'); context.signal?.throwIfAborted() }
const token = id => /^[a-f0-9]{32}$/.test(id ?? '')
const route = id => 'bot-cli-' + id
const refPrefix = id => 'DSH_BOT_CLI_' + id.toUpperCase() + '_'
const entryInput = input => {
  if (!plain(input) || Object.keys(input).some(key => !['executable', 'version', 'script'].includes(key))
    || typeof input.executable !== 'string' || !isAbsolute(input.executable) || input.executable.length > 4096 || typeof input.version !== 'string' || !/^[0-9][A-Za-z0-9.+_-]{0,63}$/.test(input.version)
    || input.script !== undefined && (typeof input.script !== 'string' || !input.script || input.script.length > 4096)) fail('CLI_CHAT_ENTRY_INVALID', '请填写 CLI 的绝对路径和已安装版本。')
  return { ...input }
}
const publicEntry = entry => ({ executable: entry.executable, version: entry.version, ...(entry.script ? { script: entry.script } : {}) })

export function openCliProviders({ Database, file, credentials, drivers, inspectEntry, normalizeCredential, importAccount, onChanged = async () => {}, usedBy = () => [], now = Date.now }) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new Database(file), owned = new Set()
  let closed = false, queue = Promise.resolve()
  try { db.pragma('busy_timeout=5000'); if (file !== ':memory:') db.pragma('journal_mode=WAL'); db.pragma('synchronous=FULL'); db.exec('CREATE TABLE IF NOT EXISTS bot_cli_providers(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,health TEXT)') }
  catch (error) { db.close(); throw error }
  const driverList = () => typeof drivers === 'function' ? drivers() : drivers
  const store = () => typeof credentials === 'function' ? credentials() : credentials
  const decode = row => {
    try {
      const data = JSON.parse(row.payload)
      if (!plain(data) || Object.keys(data).some(key => !['schemaVersion', 'id', 'provider', 'driver', 'name', 'model', 'entry', 'credentialRef', 'enabled', 'updatedAt'].includes(key))
        || data.schemaVersion !== 1 || !token(data.id) || row.id !== data.id || data.provider !== route(data.id) || !Number.isSafeInteger(row.revision) || row.revision < 1
        || !driverList().some(driver => driver.id === data.driver) || typeof data.enabled !== 'boolean'
        || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100 || /\p{Cc}/u.test(data.name)
        || typeof data.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,239}$/.test(data.model)
        || !plain(data.entry) || Object.keys(data.entry).some(key => !['executable', 'version', 'sha256', 'script', 'scriptSha256'].includes(key)) || !/^[a-f0-9]{64}$/.test(data.entry.sha256 ?? '')
        || data.entry.script && (!isAbsolute(data.entry.script) || !/^[a-f0-9]{64}$/.test(data.entry.scriptSha256 ?? ''))
        || data.credentialRef !== null && !new RegExp('^cli-secret/' + refPrefix(data.id) + '[A-F0-9]{12}$').test(data.credentialRef)) throw new Error()
      entryInput(publicEntry(data.entry)); owned.add(data.provider)
      return { ...data, revision: row.revision, health: row.health ? JSON.parse(row.health) : null }
    } catch { fail('CLI_CHAT_STORE_INVALID', 'CLI 聊天配置记录无效，请检查插件数据备份。') }
  }
  const rows = () => { if (closed) fail('CLI_CHAT_CLOSED', 'CLI 聊天配置已关闭。'); return db.prepare('SELECT * FROM bot_cli_providers ORDER BY rowid').all().map(decode) }
  const read = id => { if (closed) fail('CLI_CHAT_CLOSED', 'CLI 聊天配置已关闭。'); const row = db.prepare('SELECT * FROM bot_cli_providers WHERE id=?').get(id); return row ? decode(row) : null }
  const serial = operation => { const pending = queue.then(operation); queue = pending.catch(() => {}); return pending }
  const view = async profile => {
    const configured = Boolean(profile.credentialRef && (await store()?.describe(profile.credentialRef.slice(11)))?.configured)
    return { id: profile.id, revision: profile.revision, driver: profile.driver, name: profile.name, provider: profile.provider, model: profile.model,
      entry: publicEntry(profile.entry), credentialConfigured: configured, enabled: profile.enabled, usedBy: usedBy(profile.provider),
      state: !profile.enabled ? 'disabled' : !configured ? 'needs-credentials' : profile.health?.kind === 'error' ? 'needs-attention' : profile.health?.kind === 'verified' ? 'ready' : 'configured',
      ...(profile.health?.kind === 'error' ? { reason: '此原生聊天连接未正常完成，请检查账号、模型与 CLI 版本。' } : {}) }
  }
  const inspect = async (payload, context) => {
    owner(context)
    if (!plain(payload) || Object.keys(payload).some(key => key !== 'entry')) fail('CLI_CHAT_INVALID', '无效的版本核验请求。')
    const result = await inspectEntry(entryInput(payload.entry), null, context.signal)
    return { versionVerified: true, entry: publicEntry(result) }
  }
  const save = (input, context) => serial(async () => {
    owner(context)
    if (!plain(input) || Object.keys(input).some(key => !['id', 'expectedRevision', 'driver', 'name', 'model', 'enabled', 'entry', 'credentialJson', 'clearCredential', 'importLocalAccount'].includes(key))) fail('CLI_CHAT_INVALID', '配置包含不支持的字段。')
    const driver = driverList().find(driver => driver.id === input.driver)
    if (!driver?.implemented || driver.available === false) fail('CLI_CHAT_DRIVER_UNAVAILABLE', driver?.reason ?? '此驱动尚不可用。')
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 || /\p{Cc}/u.test(input.name)
      || typeof input.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,239}$/.test(input.model) || typeof input.enabled !== 'boolean'
      || input.id !== undefined && !token(input.id) || input.clearCredential !== undefined && typeof input.clearCredential !== 'boolean'
      || input.importLocalAccount !== undefined && typeof input.importLocalAccount !== 'boolean' || input.credentialJson !== undefined && typeof input.credentialJson !== 'string') fail('CLI_CHAT_INVALID', '请填写名称、模型、驱动和版本。')
    if ([Boolean(input.credentialJson), input.clearCredential === true, input.importLocalAccount === true].filter(Boolean).length > 1) fail('CLI_CHAT_INVALID', '认证资料、导入本机账号和清除认证只能选择一项。')
    const current = input.id ? read(input.id) : null
    if (input.id && !current) fail('CLI_CHAT_NOT_FOUND', '此连接已删除，请刷新。')
    if ((current?.revision ?? 0) !== input.expectedRevision) fail('CLI_CHAT_CONFLICT', '连接已在其他窗口修改，请刷新后重试。')
    if (current && current.driver !== input.driver) fail('CLI_CHAT_INVALID', '请为另一个驱动创建新的连接。')
    if (!current && rows().length >= 32) fail('CLI_CHAT_LIMIT', 'CLI 聊天连接最多32个。')
    const entry = await inspectEntry(entryInput(input.entry), input.driver, context.signal)
    context.signal?.throwIfAborted()
    const id = current?.id ?? randomUUID().replaceAll('-', ''), service = store()
    let credentialRef = input.clearCredential ? null : current?.credentialRef ?? null, written
    const raw = input.importLocalAccount ? await importAccount(input.driver) : input.credentialJson
    if (raw) {
      const value = normalizeCredential(input.driver, raw)
      if (!service?.set || !service?.unset) fail('CLI_CHAT_CREDENTIAL_STORE_UNAVAILABLE', '宿主没有提供可写的凭据存储。')
      written = refPrefix(id) + randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()
      await service.set(written, value); credentialRef = 'cli-secret/' + written
    }
    const data = { schemaVersion: 1, id, provider: route(id), driver: input.driver, name: input.name.trim(), model: input.model, entry, credentialRef, enabled: input.enabled, updatedAt: now() }
    try {
      context.signal?.throwIfAborted()
      db.transaction(() => {
        if ((read(id)?.revision ?? 0) !== input.expectedRevision) fail('CLI_CHAT_CONFLICT', '连接已在其他窗口修改，请刷新后重试。')
        db.prepare('INSERT INTO bot_cli_providers(id,revision,payload,health) VALUES(?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,health=NULL').run(id, input.expectedRevision + 1, JSON.stringify(data))
      }).immediate()
    } catch (error) { if (written) await service.unset(written).catch(() => {}); throw error }
    try { await onChanged() } finally { if (current?.credentialRef && current.credentialRef !== credentialRef) await service?.unset(current.credentialRef.slice(11)).catch(() => {}) }
    return view(read(id))
  })
  const remove = (payload, context) => serial(async () => {
    owner(context)
    if (!plain(payload) || Object.keys(payload).some(key => !['id', 'expectedRevision'].includes(key)) || !token(payload.id)) fail('CLI_CHAT_INVALID', '请选择已有连接。')
    const current = read(payload.id)
    if (!current) fail('CLI_CHAT_NOT_FOUND', '此连接已删除。')
    if (usedBy(current.provider).length) fail('CLI_CHAT_IN_USE', '仍有 Bot 使用此连接，请先切换模型。')
    if (payload.expectedRevision !== current.revision) fail('CLI_CHAT_CONFLICT', '连接已修改，请刷新。')
    const result = db.prepare('DELETE FROM bot_cli_providers WHERE id=? AND revision=?').run(payload.id, payload.expectedRevision)
    if (!result.changes) fail('CLI_CHAT_CONFLICT', '连接已修改，请刷新。')
    try { await onChanged() } finally { if (current.credentialRef) await store()?.unset(current.credentialRef.slice(11)).catch(() => {}) }
    return { removed: true, id: current.id }
  })
  const profiles = () => rows().filter(profile => profile.enabled && profile.credentialRef).map(profile => ({ id: 'cli-' + profile.id, revision: profile.revision,
    driver: profile.driver, provider: profile.provider, model: profile.model, name: profile.name, entry: profile.entry, credentialRef: profile.credentialRef, deadlineMs: 1_800_000, hostTools: false }))
  return Object.freeze({ inspect, save, remove, profiles,
    async list(context) { owner(context); return { schemaVersion: 1, drivers: driverList(), profiles: await Promise.all(rows().map(view)) } },
    routes: () => profiles().map(profile => ({ provider: profile.provider, model: profile.model })),
    owns: provider => owned.has(provider),
    metadata: provider => { const profile = rows().find(profile => profile.provider === provider); return profile ? { id: profile.id, name: profile.name, driver: profile.driver, enabled: profile.enabled } : null },
    markResult(provider, health, expectedRevision) { const profile = rows().find(profile => profile.provider === provider); if (!profile || profile.revision !== expectedRevision) return
      db.prepare('UPDATE bot_cli_providers SET health=? WHERE id=? AND revision=?').run(JSON.stringify({ kind: health.kind === 'verified' ? 'verified' : 'error', checkedAt: now() }), profile.id, expectedRevision) },
    close() { if (closed) return; closed = true; db.close() },
  })
}
