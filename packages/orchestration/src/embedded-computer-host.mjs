import { mkdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve, relative } from 'node:path'
import { hostname, homedir, networkInterfaces } from 'node:os'
import { isIP } from 'node:net'
import { randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import { Agent, Store, serve } from '../../../remote-computer-agent/dist/index.mjs'
import { startEmbeddedDesktop, protectEmbeddedComputerRoot } from './embedded-computer-native.mjs'

const fail = code => { throw Object.assign(new Error(code), { code }) }
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const keys = (value, allowed) => { if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('LOCAL_COMPUTER_REQUEST_INVALID') }
const owner = context => { if (context?.kind !== 'owner') fail('REMOTE_OWNER_REQUIRED'); context.signal?.throwIfAborted() }
const contains = (parent, child) => { const path = relative(parent, child); return !path || path !== '..' && !path.startsWith('..\\') && !path.startsWith('../') && !isAbsolute(path) }
const safeCode = e => e?.code === 'EADDRINUSE' ? 'LOCAL_COMPUTER_PORT_BUSY' : /^[A-Z][A-Z0-9_]{2,80}$/.test(e?.code ?? '') ? e.code : 'LOCAL_COMPUTER_START_FAILED'
const addresses = () => [...new Set(Object.values(networkInterfaces()).flat().filter(x => x && x.family === 'IPv4' && !x.internal).map(x => x.address)), '127.0.0.1']
const baseTools = ['machine_ping', 'fs_list', 'fs_read', 'operation_status', 'operation_cancel', 'artifact_stat', 'artifact_read']
const desktopTools = ['desktop_screenshot', 'desktop_click', 'desktop_type', 'desktop_key', 'desktop_scroll']
const toolsOf = config => [...baseTools, ...(config.allowWrite ? ['fs_write'] : []), ...(config.allowDesktop ? desktopTools : [])]

/** A private Agent is owned by this Host lifecycle, never installed as a separate application. */
export async function createEmbeddedComputerRuntime(config, { dataRoot, Database, desktopFactory = startEmbeddedDesktop } = {}) {
  let desktop, agent, server
  try {
    if (config.allowDesktop) desktop = await desktopFactory(dataRoot)
    agent = new Agent({ dataDir: join(dataRoot, 'agent'), roots: { shared: config.sharedDirectory }, isolation: 'application',
      executables: {}, browserOrigins: [], ...(desktop ? { desktop: desktop.config } : {}) }, Database)
    const advertised = new URL(config.endpoint)
    server = await serve(agent, { mode: 'e2e', host: config.listenAddress, port: config.port,
      allowedHosts: [...new Set([advertised.host, `${config.listenAddress.includes(':') ? '[' + config.listenAddress + ']' : config.listenAddress}:${config.port}`])] })
  } catch (e) {
    let uncertain = false
    try { await server?.close() } catch { uncertain = true }
    try { await agent?.close() } catch { uncertain = true }
    if (desktop) try { if ((await desktop.stop()).treeStopped !== true) uncertain = true } catch { uncertain = true }
    if (uncertain) fail('LOCAL_COMPUTER_STOP_UNCONFIRMED')
    throw e
  }
  let stopping
  return { machineId: agent.store.machineId, address: server.address,
    health: () => ({ listening: !stopping, desktopReady: config.allowDesktop ? desktop?.alive === true : false }),
    stop: () => stopping ??= (async () => {
      let failure
      try { await server.close() } catch (e) { failure = e }
      try { await agent.close() } catch (e) { failure ??= e }
      const stopped = desktop ? await desktop.stop() : { treeStopped: true, status: 'confirmed' }
      if (failure || stopped.treeStopped !== true) fail('LOCAL_COMPUTER_STOP_UNCONFIRMED')
      return { listening: false, treeStopped: true, status: 'confirmed' }
    })() }
}

/** All operations are authenticated owner actions. Neither model tools nor ordinary snapshots expose pairing secrets. */
export async function openEmbeddedComputerHost({ Database, dataRoot, protectedRoot = dataRoot, runtimeFactory = createEmbeddedComputerRuntime,
  protect = protectEmbeddedComputerRoot } = {}) {
  if (!Database || !isAbsolute(dataRoot ?? '') || !isAbsolute(protectedRoot ?? '')) fail('LOCAL_COMPUTER_HOST_REQUIRED')
  await mkdir(dataRoot, { recursive: true, mode: 0o700 })
  dataRoot = await realpath(dataRoot)
  let guard, db
  try {
    guard = new Database(join(dataRoot, 'controller.sqlite')); guard.pragma('busy_timeout=0'); guard.exec('BEGIN IMMEDIATE')
    db = new Database(join(dataRoot, 'settings.sqlite')); db.pragma('journal_mode=WAL'); db.pragma('synchronous=FULL')
    db.exec('CREATE TABLE IF NOT EXISTS embedded_computer_settings(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,payload TEXT NOT NULL)')
  } catch (e) { db?.close(); guard?.close(); fail('LOCAL_COMPUTER_LOCKED') }
  let config = null, revision = 0, runtime = null, phase = 'disabled', errorCode = null, closed = false, pending = Promise.resolve(), protection = null, uncertainStart = false
  const row = db.prepare('SELECT * FROM embedded_computer_settings WHERE id=1').get()
  if (row) {
    try {
      config = JSON.parse(row.payload); revision = row.revision
      keys(config, ['name', 'listenAddress', 'port', 'endpoint', 'sharedDirectory', 'allowWrite', 'allowDesktop', 'enabled'])
      const endpoint = new URL(config.endpoint)
      if (typeof config.name !== 'string' || !config.name.trim() || config.name.length > 60 || !isIP(config.listenAddress)
        || !Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65535 || !isAbsolute(config.sharedDirectory ?? '')
        || !['enabled', 'allowWrite', 'allowDesktop'].every(key => typeof config[key] === 'boolean') || !Number.isSafeInteger(revision) || revision < 1
        || !['http:', 'https:'].includes(endpoint.protocol) || endpoint.origin !== config.endpoint || endpoint.username || endpoint.password) throw Error()
    }
    catch { db.close(); guard.close(); fail('LOCAL_COMPUTER_CONFIG_INVALID') }
  }
  const serial = operation => { const run = pending.then(() => { if (closed) fail('LOCAL_COMPUTER_CLOSED'); return operation() }); pending = run.catch(() => {}); return run }
  const secure = () => protection ??= protect(dataRoot).catch(e => { protection = null; throw e })
  const admin = async operation => { await secure(); const store = new Store(join(dataRoot, 'agent'), Database, { admin: true }); try { return await operation(store) } finally { store.close() } }
  const devices = store => store.db.prepare('SELECT id,revision,revoked,ceiling FROM clients ORDER BY id').all().map(row => ({ id: row.id, revision: row.revision, revoked: Boolean(row.revoked), tools: JSON.parse(row.ceiling).tools }))
  const status = () => ({ schemaVersion: 1, state: phase === 'running' && config?.allowDesktop && !runtime?.health().desktopReady ? 'needs-attention' : phase,
    revision, desktopSupported: process.platform === 'win32', addresses: addresses(), config: config ? structuredClone(config) : null, ...(errorCode ? { errorCode } : {}),
    ...(runtime ? { machineId: runtime.machineId, ...runtime.health() } : { listening: false, desktopReady: false }),
    defaults: { name: hostname(), listenAddress: addresses()[0], port: 9781, sharedDirectory: join(homedir(), 'DSH-Share'), allowWrite: false, allowDesktop: process.platform === 'win32' } })
  const persist = next => {
    db.transaction(() => {
      const current = db.prepare('SELECT revision FROM embedded_computer_settings WHERE id=1').get()?.revision ?? 0
      if (current !== revision) fail('LOCAL_COMPUTER_CONFLICT')
      db.prepare('INSERT INTO embedded_computer_settings VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(revision + 1, JSON.stringify(next))
    }).immediate(); config = next; revision++
  }
  const start = async () => {
    if (uncertainStart) fail('LOCAL_COMPUTER_STOP_UNCONFIRMED')
    if (runtime) return status()
    phase = 'starting'; errorCode = null
    try {
      await secure()
      if (!config?.enabled) fail('LOCAL_COMPUTER_NOT_ENABLED')
      const shared = await realpath(config.sharedDirectory)
      if (shared !== config.sharedDirectory || !(await stat(shared)).isDirectory()) fail('LOCAL_COMPUTER_SHARED_DIRECTORY_CHANGED')
      const protectedPath = await realpath(protectedRoot)
      if ([protectedPath, dataRoot].some(path => contains(path, shared) || contains(shared, path))) fail('LOCAL_COMPUTER_PRIVATE_DIRECTORY')
      runtime = await runtimeFactory(config, { dataRoot, Database }); phase = 'running'
    } catch (e) { errorCode = safeCode(e); uncertainStart = errorCode === 'LOCAL_COMPUTER_STOP_UNCONFIRMED'; phase = uncertainStart ? 'needs-attention' : 'failed' }
    return status()
  }
  const stop = async () => {
    if (uncertainStart) fail('LOCAL_COMPUTER_STOP_UNCONFIRMED')
    phase = 'stopping'
    try { if (runtime) await runtime.stop(); runtime = null; phase = 'disabled'; errorCode = null }
    catch (e) { phase = 'needs-attention'; errorCode = safeCode(e); throw e }
  }
  const normalize = async input => {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 60 || /[\x00-\x1f]/.test(input.name)
      || !addresses().includes(input.listenAddress) || !isIP(input.listenAddress) || !Number.isSafeInteger(input.port) || input.port < 1 || input.port > 65535
      || !isAbsolute(input.sharedDirectory ?? '') || typeof input.allowWrite !== 'boolean' || typeof input.allowDesktop !== 'boolean' || typeof input.enabled !== 'boolean') fail('LOCAL_COMPUTER_CONFIG_INVALID')
    if (input.allowDesktop && process.platform !== 'win32') fail('LOCAL_DESKTOP_WINDOWS_REQUIRED')
    let endpoint
    try { endpoint = new URL(input.endpoint || `http://${input.listenAddress}:${input.port}`) } catch { fail('LOCAL_COMPUTER_ENDPOINT_INVALID') }
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.hash || endpoint.search || endpoint.href.length > 1024) fail('LOCAL_COMPUTER_ENDPOINT_INVALID')
    if ([resolve(protectedRoot), dataRoot].some(path => contains(path, resolve(input.sharedDirectory)) || contains(resolve(input.sharedDirectory), path))) fail('LOCAL_COMPUTER_PRIVATE_DIRECTORY')
    await mkdir(input.sharedDirectory, { recursive: true, mode: 0o700 })
    const sharedDirectory = await realpath(input.sharedDirectory), protectedPath = await realpath(protectedRoot)
    if ([protectedPath, dataRoot].some(path => contains(path, sharedDirectory) || contains(sharedDirectory, path))) fail('LOCAL_COMPUTER_PRIVATE_DIRECTORY')
    return { name: input.name.trim(), listenAddress: input.listenAddress, port: input.port, endpoint: endpoint.origin, sharedDirectory, allowWrite: input.allowWrite, allowDesktop: input.allowDesktop, enabled: input.enabled }
  }
  const checkRevision = input => { if (input.expectedRevision !== revision) fail('LOCAL_COMPUTER_CONFLICT') }
  const result = {
    async status(payload, context) { owner(context); keys(payload, []); return status() },
    configure: (input, context) => serial(async () => {
      owner(context); keys(input, ['expectedRevision', 'name', 'listenAddress', 'port', 'endpoint', 'sharedDirectory', 'allowWrite', 'allowDesktop', 'enabled']); checkRevision(input)
      const next = await normalize(input); context.signal?.throwIfAborted()
      await stop()
      // Saved grants name a physical directory and capability ceiling. Changing
      // settings revokes them rather than retargeting a previously paired peer.
      await admin(store => { store.db.transaction(() => {
        for (const device of devices(store).filter(item => !item.revoked)) store.revoke(device.id)
        store.db.exec('UPDATE pairing_invites SET attempts_left=0 WHERE consumed_request IS NULL')
      }).immediate() })
      persist(next); return next.enabled ? start() : status()
    }),
    start: (input, context) => serial(async () => { owner(context); keys(input, ['expectedRevision']); checkRevision(input); if (!config) fail('LOCAL_COMPUTER_CONFIG_REQUIRED'); if (!config.enabled) persist({ ...config, enabled: true }); return start() }),
    stop: (input, context) => serial(async () => {
      owner(context); keys(input, ['expectedRevision']); checkRevision(input)
      if (config?.enabled) persist({ ...config, enabled: false })
      await stop(); await admin(store => store.db.exec('UPDATE pairing_invites SET attempts_left=0 WHERE consumed_request IS NULL')); return status()
    }),
    invite: (input, context) => serial(async () => {
      owner(context); keys(input, ['expectedRevision']); checkRevision(input)
      if (phase !== 'running' || !runtime || config.allowDesktop && !runtime.health().desktopReady) fail('LOCAL_COMPUTER_NOT_RUNNING')
      return admin(async store => {
        store.db.exec('UPDATE pairing_invites SET attempts_left=0 WHERE consumed_request IS NULL')
        const created = store.invite('host-' + randomUUID(), { botIds: [], hostManagedBots: true, roots: ['shared'], tools: toolsOf(config) }, { endpoint: config.endpoint, name: config.name })
        const { code, ...invite } = created
        const text = JSON.stringify(invite)
        return { schemaVersion: 1, invite, code, qrDataUrl: await QRCode.toDataURL(text, { errorCorrectionLevel: 'M', width: 300, margin: 2 }) }
      })
    }),
    devices: (input, context) => serial(async () => { owner(context); keys(input, []); return admin(store => ({ items: devices(store), revision })) }),
    revoke: (input, context) => serial(async () => {
      owner(context); keys(input, ['id', 'revision']); if (typeof input.id !== 'string' || !Number.isSafeInteger(input.revision)) fail('LOCAL_COMPUTER_REQUEST_INVALID')
      return admin(store => { const device = devices(store).find(item => item.id === input.id); if (!device || device.revision !== input.revision) fail('LOCAL_COMPUTER_CONFLICT'); store.revoke(input.id); return { revoked: true, id: input.id } })
    }),
    async close() { if (closed) return; closed = true; await pending; try { await stop() } finally { db.close(); try { guard.exec('ROLLBACK') } finally { guard.close() } } },
  }
  // Restoring a user-enabled listener never blocks the rest of Host startup.
  if (config?.enabled) void serial(start).catch(() => {})
  return Object.freeze(result)
}
