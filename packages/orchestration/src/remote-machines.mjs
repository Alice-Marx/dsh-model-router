import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createDesktopSessionHost } from './desktop-sessions.mjs'
import { connectSecureTransport, normalizeSecureTransport } from '../../../modules/openmaus-protocol/transport.mjs'

export const REMOTE_TOOLS = Object.freeze(['machine_ping','fs_list','fs_read','fs_write','shell_exec','container_command_v1','cli_probe_v1','cli_task_v1',
  'operation_status','operation_cancel','artifact_stat','artifact_read','worktree_create','worktree_diff','worktree_integrate',
  'browser_open','browser_snapshot','browser_click','browser_type','browser_script','browser_upload','browser_download','browser_close',
  'desktop_screenshot','desktop_click','desktop_type','desktop_key','desktop_scroll'])
// Cancelling an owned operation does not grant workspace mutation. Read-only CLI
// tasks require this explicit control permission so their process can be stopped.
const readonly = new Set(['machine_ping','fs_list','fs_read','cli_probe_v1','cli_task_v1','operation_status','operation_cancel','artifact_stat','artifact_read','worktree_diff','browser_snapshot'])
const ref = value => typeof value === 'string' && /^[-A-Za-z0-9_.]{1,128}$/.test(value)
const DOWNLOAD_LIMIT_BYTES = 8 * 1024 * 1024
const DOWNLOAD_CHUNK_BYTES = 1024 * 1024
const fail = code => { throw Object.assign(new Error(code), { code }) }
const owner = context => { if (context?.kind !== 'owner') fail('REMOTE_OWNER_REQUIRED') }
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const keys = (value, allowed) => { if (!plain(value) || Object.keys(value).some(k => !allowed.includes(k))) fail('INVALID_MACHINE_REQUEST') }
const references = (values, allowed) => {
  if (!Array.isArray(values) || !values.length || values.length > 64 || new Set(values).size !== values.length || values.some(v => !ref(v) || allowed && !allowed.includes(v))) fail('INVALID_MACHINE_SCOPE')
  return [...values].sort()
}
export function normalizeMachineEndpoint(value, protectedTunnel = false, transport) {
  let url; try { url = new URL(value) } catch { fail('INVALID_MACHINE_ENDPOINT') }
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') fail('INVALID_MACHINE_ENDPOINT')
  if (transport !== undefined) normalizeSecureTransport(transport)
  if (url.protocol === 'http:' && !['127.0.0.1','[::1]','localhost'].includes(url.hostname) && protectedTunnel !== true && transport?.kind !== 'noise-v1') fail('MACHINE_TLS_REQUIRED')
  return url.origin
}

/** Host metadata only. Long-lived credentials stay in the existing DS secret UI. */
export function openRemoteMachines({ Database, file, resolveSecret, botExists, mainBotIds = () => [], authority, desktopProxy, desktopHttp, cliProfiles = [], onChanged = () => {}, now = Date.now, fetchImpl = fetch }) {
  if (typeof Database !== 'function' || typeof resolveSecret !== 'function' || typeof botExists !== 'function') throw new TypeError('REMOTE_MACHINE_SERVICES_REQUIRED')
  if (typeof mainBotIds !== 'function') throw new TypeError('REMOTE_MACHINE_MAIN_ROLE_REQUIRED')
  if (!Array.isArray(cliProfiles) || cliProfiles.length > 64 || new Set(cliProfiles.map(p=>`${p?.machineId}/${p?.rootId}`)).size !== cliProfiles.length
    || cliProfiles.some(p=>!p||!['machineId','rootId','profileId'].every(k=>ref(p[k]))||!Number.isSafeInteger(p.profileRevision)||p.profileRevision<1
      ||!/^[a-f0-9]{64}$/.test(p.entry?.sha256??'')||!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(p.entry?.version??''))) throw new TypeError('REMOTE_CLI_PROFILES_INVALID')
  cliProfiles=Object.freeze(cliProfiles.map(p=>Object.freeze({machineId:p.machineId,rootId:p.rootId,profileId:p.profileId,profileRevision:p.profileRevision,entry:Object.freeze({sha256:p.entry.sha256,version:p.entry.version})})))
  if (file !== ':memory:') { file = resolve(file); mkdirSync(dirname(file), { recursive: true }) }
  const db = new Database(file)
  db.pragma('busy_timeout=5000'); db.pragma('journal_mode=WAL'); db.pragma('synchronous=FULL')
  db.exec(`CREATE TABLE IF NOT EXISTS remote_machine_component(component TEXT PRIMARY KEY,version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS remote_machines(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,config TEXT NOT NULL,revoked INTEGER NOT NULL,health TEXT);
    CREATE TABLE IF NOT EXISTS remote_machine_bindings(machine_id TEXT NOT NULL,bot_id TEXT NOT NULL,revision INTEGER NOT NULL,scope TEXT NOT NULL,revoked INTEGER NOT NULL,PRIMARY KEY(machine_id,bot_id));
    CREATE TABLE IF NOT EXISTS remote_machine_grant_subjects(machine_id TEXT NOT NULL,bot_id TEXT NOT NULL,PRIMARY KEY(machine_id,bot_id));
    CREATE TABLE IF NOT EXISTS remote_machine_revocations(machine_id TEXT NOT NULL,bot_id TEXT NOT NULL,status TEXT NOT NULL,at_ms INTEGER NOT NULL,request_id TEXT NOT NULL,PRIMARY KEY(machine_id,bot_id));
    CREATE TABLE IF NOT EXISTS remote_machine_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,machine_id TEXT NOT NULL,bot_id TEXT,kind TEXT NOT NULL,time INTEGER NOT NULL);`)
  const version = db.prepare('SELECT version FROM remote_machine_component WHERE component=?').get('machines')
  if (version && version.version !== 1) { db.close(); fail('MACHINE_DIRECTORY_VERSION_UNSUPPORTED') }
  db.prepare('INSERT OR IGNORE INTO remote_machine_component VALUES(?,1)').run('machines')
  if(!db.pragma('table_info(remote_machine_revocations)').some(column=>column.name==='request_id'))db.exec("ALTER TABLE remote_machine_revocations ADD COLUMN request_id TEXT NOT NULL DEFAULT ''")
  let closed = false
  const active = new Set()
  const channels = new Map()
  const alive = () => { if (closed) fail('MACHINE_DIRECTORY_CLOSED') }
  const machine = id => { alive(); if (!ref(id)) fail('INVALID_MACHINE_ID'); const r = db.prepare('SELECT * FROM remote_machines WHERE id=?').get(id); if (!r || r.revoked) fail('MACHINE_NOT_PAIRED'); return { ...r, config: JSON.parse(r.config), health: r.health ? JSON.parse(r.health) : null } }
  const binding = (machineId,botId) => {
    const row = db.prepare('SELECT * FROM remote_machine_bindings WHERE machine_id=? AND bot_id=?').get(machineId,botId)
    if (!botExists(botId) || row?.revoked) fail('MACHINE_BOT_DENIED')
    if (mainBotIds().includes(botId)) {
      const record = machine(machineId)
      // Main inherits only this paired client's verified ceiling. The remote
      // authority still authenticates the client, Bot and every issued grant.
      return { machine_id: record.id, bot_id: botId, revision: record.revision,
        scope: { roots: [...record.config.roots], tools: [...record.config.tools], mode: 'workspace-write' } }
    }
    if (!row) fail('MACHINE_BOT_DENIED')
    return { ...row, scope: JSON.parse(row.scope) }
  }
  const mainScopes = botId => db.prepare('SELECT * FROM remote_machines WHERE revoked=0').all().flatMap(row => {
    if (db.prepare('SELECT revoked FROM remote_machine_bindings WHERE machine_id=? AND bot_id=?').get(row.id,botId)?.revoked) return []
    const config=JSON.parse(row.config)
    return [{machineId:row.id,revision:row.revision,roots:[...config.roots],tools:[...config.tools],mode:'workspace-write',inheritedMain:true}]
  })
  const inheritedMainScopes = botId => botExists(botId)&&mainBotIds().includes(botId) ? mainScopes(botId) : null
  const event = (id,botId,kind) => db.prepare('INSERT INTO remote_machine_events(machine_id,bot_id,kind,time) VALUES(?,?,?,?)').run(id,botId,kind,now())
  const requestRevocation = (id,botId) => {
    const key=randomUUID()
    db.prepare("INSERT INTO remote_machine_revocations(machine_id,bot_id,status,at_ms,request_id) VALUES(?,?,'requested',?,?) ON CONFLICT(machine_id,bot_id) DO UPDATE SET status=excluded.status,at_ms=excluded.at_ms,request_id=excluded.request_id").run(id,botId,now(),key)
    return key
  }
  const settleRevocation = (id,botId,status,key) => db.prepare('UPDATE remote_machine_revocations SET status=?,at_ms=? WHERE machine_id=? AND bot_id=? AND request_id=?').run(status,now(),id,botId,key).changes===1
  const abort = (id,botId) => { for (const call of active) if (call.machineId === id && (!botId || call.botId === botId)) call.controller.abort(Object.assign(new Error('MACHINE_GRANT_CHANGED'), { code: 'MACHINE_GRANT_CHANGED' })) }
  const responseJson = async response => {
    const reader = response.body?.getReader(); if (!reader) fail('MACHINE_PROTOCOL_INVALID')
    const chunks = []; let bytes = 0
    try { while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > 2 * 1024 * 1024) fail('MACHINE_RESPONSE_LIMIT'); chunks.push(Buffer.from(item.value)) } }
    finally { await reader.cancel().catch(() => {}) }
    let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { fail('MACHINE_PROTOCOL_INVALID') }
    if (!response.ok) {
      const code=/^[A-Z][A-Z0-9_]{0,80}$/.test(value?.error?.code) ? value.error.code : 'MACHINE_CONNECTION_FAILED'
      const retry=response.headers.get('retry-after'),seconds=/^[0-9]{1,2}$/.test(retry??'')?Number(retry):0
      throw Object.assign(new Error(code),{code,...(response.status===429&&code==='AUTH_RATE_LIMIT'&&seconds>0&&seconds<=60?{retryAfterMs:seconds*1000}:{})})
    }
    return value
  }
  const request = async (config,path,token,body,signal) => {
    try {
      const channel = config.transport ? await secureChannel(config,signal) : null
      const send = channel ? (url,options) => channel.fetch(path,options) : fetchImpl
      return await responseJson(await send(`${config.endpoint}${path}`, { method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' },
        body: JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(35000), ...(signal ? [signal] : [])]) }))
    } catch (error) { if (signal?.aborted) throw signal.reason; if (/^[A-Z][A-Z0-9_]{0,80}$/.test(error?.code)) throw error; fail('MACHINE_CONNECTION_FAILED') }
  }
  const secretFor = async record => {
    let secret
    try { secret = await resolveSecret(record.config.secretRef) } catch { fail('MACHINE_SECRET_UNAVAILABLE') }
    if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) fail('MACHINE_SECRET_UNAVAILABLE')
    return secret
  }
  const secureChannel = async (config,signal) => {
    alive()
    const token=await secretFor({config})
    const key=JSON.stringify([config.endpoint,config.transport.publicKey,config.secretRef,createHash('sha256').update(token).digest('hex')])
    let entry=channels.get(key)
    if(!entry){
      if(channels.size>=32)fail('MACHINE_CONNECTION_LIMIT')
      const pending=connectSecureTransport({endpoint:config.endpoint,transport:config.transport,token,signal})
      entry={config,pending};channels.set(key,entry)
      void pending.then(channel=>{if(closed){channel.close();return};void channel.closed.then(()=>{if(channels.get(key)===entry)channels.delete(key)})},()=>{if(channels.get(key)===entry)channels.delete(key)})
    }
    const channel=await entry.pending
    signal?.throwIfAborted();alive()
    if(channel.state!=='open')fail('MACHINE_CONNECTION_FAILED')
    return channel
  }
  const closeChannels = config => {
    for(const [key,entry] of channels)if(!config||entry.config.secretRef===config.secretRef&&entry.config.endpoint===config.endpoint){channels.delete(key);void entry.pending.then(channel=>channel.close(),()=>{})}
  }
  const versionUnsupported = (code,details) => { throw Object.assign(new Error(`${code}: require agentApiMajor=1 and MCP protocol 2025-11-25`), { code, details }) }
  const issue = async (record,botId,scope,identity,signal) => {
    // Persist the identity before any network await, including pair probes and
    // inherited Main grants that have no per-Bot binding row. Whole-machine
    // revocation must reach every identity for which this Host requested tickets.
    db.prepare('INSERT OR IGNORE INTO remote_machine_grant_subjects VALUES(?,?)').run(record.id,botId)
    const secret = await secretFor(record)
    signal?.throwIfAborted()
    const value = await request(record.config,'/control/v1/grants',secret,{ botId, taskId: identity.taskId, attemptId: identity.attemptId, roots: scope.roots, tools: scope.tools, ttlMs: 60000 },signal)
    if (value.agentApiMajor !== 1) versionUnsupported('MACHINE_VERSION_UNSUPPORTED', { requiredAgentApiMajor: 1, actualAgentApiMajor: value.agentApiMajor ?? null })
    if (value.machineId !== record.id || record.config.clientId && value.clientId !== record.config.clientId || value.botId !== botId || value.taskId !== identity.taskId || value.attemptId !== identity.attemptId || typeof value.grantToken !== 'string') fail('MACHINE_IDENTITY_MISMATCH')
    return value.grantToken
  }
  const invoke = async (record,token,name,args,operationId,signal) => {
    const response = await request(record.config,'/mcp',token,{ jsonrpc:'2.0',id:1,method:'tools/call',params:{ name, arguments:args, ...(operationId ? { _meta:{ 'dsh/operationId':operationId } } : {}) } },signal)
    if (response.error) fail('MACHINE_PROTOCOL_INVALID')
    if (response.result?.isError) {
      const code=response.result.content?.[0]?.text
      if (['MCP_VERSION_UNSUPPORTED','PROTOCOL_VERSION_UNSUPPORTED'].includes(code)) versionUnsupported('MACHINE_MCP_VERSION_UNSUPPORTED', { requiredMcpProtocolVersion: '2025-11-25', actualErrorCode: code })
      fail(/^[A-Z][A-Z0-9_]{0,80}$/.test(code) ? code : 'MACHINE_TOOL_FAILED')
    }
    if (!plain(response.result?.structuredContent)) fail('MACHINE_PROTOCOL_INVALID')
    return response.result.structuredContent
  }
  const remoteRevoke = async (record,botId,signal) => {
    const secret = await secretFor(record)
    const value = await request(record.config,'/control/v1/grants/revoke',secret,{botId},signal)
    if (value.machineId !== record.id || value.agentApiMajor !== 1) fail('MACHINE_IDENTITY_MISMATCH')
    return { remoteRevoked: true }
  }
  const compare = (old, expectedRevision) => { if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || (old?.revision ?? 0) !== expectedRevision) fail('MACHINE_CONFIG_CONFLICT') }
  const publicMachine = row => ({ id: row.id, machineId: row.id, revision: row.revision, name: row.config.name, endpoint: row.config.endpoint,
    secretRef: row.config.secretRef, roots: row.config.roots, tools: row.config.tools, protectedTunnel: row.config.protectedTunnel,
    ...(row.config.transport?{transport:row.config.transport}:{}),
    status: row.revoked ? 'revoked' : row.health && now()-row.health.lastSeenAt<90000 ? 'online' : 'unverified', lastSeenAt: row.health?.lastSeenAt ?? null,
    platform: row.health?.platform ?? null, version: row.health?.version ?? null, capabilities: row.health?.capabilities ?? [], desktop: row.health?.desktop ?? {status:'unverified'},
    revocations:db.prepare('SELECT bot_id,status,at_ms FROM remote_machine_revocations WHERE machine_id=?').all(row.id).map(r=>({botId:r.bot_id,status:r.status,at:r.at_ms})),
    bindings: db.prepare('SELECT bot_id,revision,scope,revoked FROM remote_machine_bindings WHERE machine_id=?').all(row.id).map(b => ({botId:b.bot_id,revision:b.revision,revoked:Boolean(b.revoked),...JSON.parse(b.scope)})) })
  const desktopSessions = createDesktopSessionHost({ machine, binding, authority, issue, request, event, now, desktopProxy, desktopHttp,
    cleanupRequest:async(record,input,signal)=>request(record.config,'/control/v1/desktop/close',await secretFor(record),input,signal),
    connectDesktop: async (record,signal,origin,options={}) => {
      if(machine(record.id).revision!==record.revision)fail('MACHINE_GRANT_CHANGED')
      const channel=await secureChannel(record.config,signal)
      if(machine(record.id).revision!==record.revision)fail('MACHINE_GRANT_CHANGED')
      return channel.openWebSocket('/desktop/v1/socket',{origin,...options})
    },
  })
  const store = {
    schemaVersion:1, file,
    desktopSession: (subject, input, context) => desktopSessions.open(subject, input, context),
    routineDesktopSession: (subject,input,context) => desktopSessions.openInternal(subject,input,context),
    renewDesktopSession: (subject, input, context) => desktopSessions.renew(subject, input, context),
    closeDesktopSession: (subject, input, context) => desktopSessions.close(subject, input, context),
    closeDesktopSessions: () => desktopSessions.closeAll(),
    async pair(input,context) {
      owner(context); alive(); keys(input,['machineId','clientId','name','endpoint','secretRef','protectedTunnel','transport','roots','tools','probeBotId','expectedRevision'])
      if (!ref(input.machineId) || !ref(input.probeBotId) || !botExists(input.probeBotId)) fail('INVALID_MACHINE_ID')
      if (typeof input.name !== 'string' || !input.name.trim() || input.name.length>128 || /[\x00-\x1f]/.test(input.name)) fail('INVALID_MACHINE_NAME')
      if (typeof input.secretRef !== 'string' || !/^ds-secret\/[A-Za-z][A-Za-z0-9_]{0,127}$/.test(input.secretRef)) fail('INVALID_MACHINE_SECRET_REF')
      if (input.protectedTunnel !== undefined && typeof input.protectedTunnel !== 'boolean') fail('INVALID_MACHINE_ENDPOINT')
      if (input.clientId !== undefined && !ref(input.clientId)) fail('INVALID_MACHINE_ID')
      const transport = input.transport === undefined ? undefined : normalizeSecureTransport(input.transport)
      const config = { name:input.name.trim(), endpoint:normalizeMachineEndpoint(input.endpoint,input.protectedTunnel,transport), secretRef:input.secretRef, protectedTunnel:input.protectedTunnel===true, roots:references(input.roots), tools:references(input.tools,REMOTE_TOOLS), ...(transport?{transport}:{}), ...(input.clientId?{clientId:input.clientId}:{}) }
      if (!config.tools.includes('machine_ping')) fail('MACHINE_PING_REQUIRED')
      compare(db.prepare('SELECT revision FROM remote_machines WHERE id=?').get(input.machineId),input.expectedRevision)
      const record = {id:input.machineId,config}, identity={taskId:`pair-${randomUUID()}`,attemptId:`attempt-${randomUUID()}`}
      const token=await issue(record,input.probeBotId,{roots:config.roots,tools:['machine_ping']},identity,context.signal)
      const ping=await invoke(record,token,'machine_ping',{},null,context.signal)
      if(ping.agentApiMajor!==1) versionUnsupported('MACHINE_VERSION_UNSUPPORTED', { requiredAgentApiMajor: 1, actualAgentApiMajor: ping.agentApiMajor ?? null })
      if(ping.machineId!==record.id) fail('MACHINE_IDENTITY_MISMATCH')
      db.transaction(()=>{
        compare(db.prepare('SELECT revision FROM remote_machines WHERE id=?').get(record.id),input.expectedRevision)
        db.prepare('INSERT INTO remote_machines VALUES(?,?,?,0,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,config=excluded.config,revoked=0,health=excluded.health')
          .run(record.id,input.expectedRevision+1,JSON.stringify(config),JSON.stringify({lastSeenAt:now(),platform:ping.os?.platform??null,version:ping.agentVersion,capabilities:ping.capabilities??[],desktop:ping.desktop??{status:'unverified'}}))
        // Changing endpoint, secretRef or ceilings requires explicit reauthorization.
        db.prepare('UPDATE remote_machine_bindings SET revoked=1,revision=revision+1 WHERE machine_id=?').run(record.id)
        event(record.id,null,'paired')
      }).immediate()
      abort(record.id); await onChanged({machineId:record.id}); return publicMachine(machine(record.id))
    },
    async bind(input,context) {
      owner(context); alive(); keys(input,['machineId','botId','expectedRevision','roots','tools','mode'])
      const record=machine(input.machineId); if(!ref(input.botId)||!botExists(input.botId)) fail('MACHINE_BOT_DENIED')
      const scope={ roots:references(input.roots,record.config.roots), tools:references(input.tools,record.config.tools), mode:input.mode }
      if(!['read-only','workspace-write'].includes(scope.mode)||scope.mode==='read-only'&&scope.tools.some(t=>!readonly.has(t))) fail('INVALID_MACHINE_SCOPE')
      let revocationKey
      db.transaction(()=>{
        compare(db.prepare('SELECT revision FROM remote_machine_bindings WHERE machine_id=? AND bot_id=?').get(record.id,input.botId),input.expectedRevision)
        db.prepare('INSERT INTO remote_machine_bindings VALUES(?,?,?,?,1) ON CONFLICT(machine_id,bot_id) DO UPDATE SET revision=excluded.revision,scope=excluded.scope,revoked=1')
          .run(record.id,input.botId,input.expectedRevision+1,JSON.stringify(scope)); event(record.id,input.botId,'bound')
        revocationKey=requestRevocation(record.id,input.botId)
      }).immediate()
      abort(record.id,input.botId); await onChanged({machineId:record.id,botId:input.botId})
      // Tickets from a wider earlier scope must also cease at the remote authority.
      try { await remoteRevoke(record,input.botId,context.signal);if(!settleRevocation(record.id,input.botId,'revoked',revocationKey))fail('MACHINE_GRANT_CHANGED') } catch { settleRevocation(record.id,input.botId,'unconfirmed',revocationKey);return {revision:input.expectedRevision+1,remoteRevoked:false,warning:'REMOTE_REVOCATION_UNCONFIRMED'} }
      db.prepare('UPDATE remote_machine_bindings SET revoked=0 WHERE machine_id=? AND bot_id=? AND revision=?').run(record.id,input.botId,input.expectedRevision+1)
      await onChanged({machineId:record.id,botId:input.botId})
      return { revision:input.expectedRevision+1,remoteRevoked:true }
    },
    async revoke(input,context) {
      owner(context); alive(); keys(input,['machineId','botId','expectedRevision'])
      const record=machine(input.machineId), botId=input.botId??null
      if(botId!==null&&!ref(botId)) fail('INVALID_MACHINE_ID')
      const affected=botId?[botId]:db.prepare('SELECT bot_id FROM remote_machine_bindings WHERE machine_id=? UNION SELECT bot_id FROM remote_machine_grant_subjects WHERE machine_id=?').all(record.id,record.id).map(r=>r.bot_id)
      const requests=new Map()
      db.transaction(()=>{
        if(botId){
          const previous=db.prepare('SELECT revision FROM remote_machine_bindings WHERE machine_id=? AND bot_id=?').get(record.id,botId)
          compare(previous,input.expectedRevision)
          if(previous)db.prepare('UPDATE remote_machine_bindings SET revoked=1,revision=revision+1 WHERE machine_id=? AND bot_id=?').run(record.id,botId)
          else db.prepare('INSERT INTO remote_machine_bindings VALUES(?,?,1,?,1)').run(record.id,botId,JSON.stringify({roots:[],tools:[],mode:'read-only'}))
        }
        else{compare(record,input.expectedRevision);db.prepare('UPDATE remote_machines SET revoked=1,revision=revision+1 WHERE id=?').run(record.id);db.prepare('UPDATE remote_machine_bindings SET revoked=1,revision=revision+1 WHERE machine_id=?').run(record.id)}
        event(record.id,botId,'revoked')
        for(const id of affected)requests.set(id,requestRevocation(record.id,id))
      }).immediate()
      abort(record.id,botId); await onChanged({machineId:record.id,botId})
      const results=await Promise.allSettled(affected.map(async id=>{try{const result=await remoteRevoke(record,id,context.signal);if(!settleRevocation(record.id,id,'revoked',requests.get(id)))fail('MACHINE_GRANT_CHANGED');return result}catch(e){settleRevocation(record.id,id,'unconfirmed',requests.get(id));throw e}}))
      return {revoked:true,remoteRevoked:results.every(r=>r.status==='fulfilled'),...(results.some(r=>r.status==='rejected')?{warning:'REMOTE_REVOCATION_UNCONFIRMED'}:{})}
    },
    async reconcile(input,context){
      owner(context);alive();keys(input,['machineId'])
      if(!ref(input.machineId))fail('INVALID_MACHINE_ID')
      const row=db.prepare('SELECT * FROM remote_machines WHERE id=?').get(input.machineId)
      if(!row)fail('MACHINE_NOT_PAIRED')
      const record={...row,config:JSON.parse(row.config)}
      const pending=db.prepare("SELECT bot_id,request_id FROM remote_machine_revocations WHERE machine_id=? AND status!='revoked'").all(record.id)
      const results=await Promise.allSettled(pending.map(async item=>{
        await remoteRevoke(record,item.bot_id,context.signal);if(!settleRevocation(record.id,item.bot_id,'revoked',item.request_id))fail('MACHINE_GRANT_CHANGED');event(record.id,item.bot_id,'remote-revocation-confirmed')
      }))
      return {remoteRevoked:results.every(r=>r.status==='fulfilled'),grantsRestored:false,...(results.some(r=>r.status==='rejected')?{warning:'REMOTE_REVOCATION_UNCONFIRMED'}:{})}
    },
    taskTarget(subject,input,{observe=false}={}) {
      alive();keys(input,['machineId','rootId','tool','profileId','profileRevision','entry','workspaceRelativePath','model'])
      const botId=authority.describe(subject).botId,record=machine(input.machineId),grant=binding(record.id,botId)
      if(!grant.scope.roots.includes(input.rootId)||!grant.scope.tools.includes('operation_status'))fail('MACHINE_BOT_DENIED')
      const mutating=input.tool??'fs_write'
      if(!['fs_write','container_command_v1','cli_probe_v1','cli_task_v1'].includes(mutating))fail('INVALID_MACHINE_REQUEST')
      const cli=mutating==='cli_probe_v1'||mutating==='cli_task_v1'
      if(cli){
        const profile=cliProfiles.find(p=>p.machineId===record.id&&p.rootId===input.rootId&&p.profileId===input.profileId)
        if(!profile||profile.profileRevision!==input.profileRevision||profile.entry.sha256!==input.entry?.sha256||profile.entry.version!==input.entry?.version
          ||typeof input.workspaceRelativePath!=='string'||input.workspaceRelativePath.length>2048
          ||!['cli_probe_v1','cli_task_v1','operation_status','operation_cancel'].every(t=>grant.scope.tools.includes(t)))fail('MACHINE_BOT_DENIED')
        authority.assertTool(subject,'cli/codex')
        if(!input.model||typeof input.model.provider!=='string'||typeof input.model.model!=='string')fail('CLI_MODEL_BINDING_REQUIRED')
        authority.assertModel(subject,input.model.provider,input.model.model)
      }else if(!observe&&(grant.scope.mode!=='workspace-write'||![mutating,'operation_cancel'].every(t=>grant.scope.tools.includes(t))))fail('MACHINE_BOT_DENIED')
      authority.assertTool(subject,observe?'remote/operation_status':'remote/'+mutating)
      return {machineId:record.id,rootId:input.rootId,remoteMachineRevision:record.revision,remoteBindingRevision:grant.revision}
    },
    async call(subject,input,{signal,expectedTarget}={}) {
      let sent=false
      try{
      alive(); keys(input,['machineId','rootId','taskId','attemptId','tool','args','operationId','artifactId'])
      const botId=authority.describe(subject).botId
      authority.assertTool(subject,`remote/${input.tool}`)
      if(!ref(input.taskId)||!ref(input.attemptId)||input.operationId!==undefined&&!ref(input.operationId)) fail('INVALID_MACHINE_REQUEST')
      const record=machine(input.machineId), grant=binding(record.id,botId)
      if(expectedTarget&&(expectedTarget.machineId!==record.id||expectedTarget.rootId!==input.rootId||expectedTarget.remoteMachineRevision!==record.revision||expectedTarget.remoteBindingRevision!==grant.revision))fail('MACHINE_GRANT_CHANGED')
      if(!grant.scope.tools.includes(input.tool)||!grant.scope.roots.includes(input.rootId)) fail('MACHINE_BOT_DENIED')
      if(!plain(input.args)||['botId','taskId','attemptId','clientId','grantToken','secretRef','endpoint'].some(k=>Object.hasOwn(input.args,k))
        ||['cli_probe_v1','cli_task_v1'].includes(input.tool)&&['credentialRef','credentials','executable','runtimeRoot','env','argv'].some(k=>Object.hasOwn(input.args,k))) fail('MACHINE_CONTEXT_FORGED')
      const observation=['operation_status','operation_cancel'].includes(input.tool)
      if(observation? !ref(input.operationId)||input.args.operationId!==input.operationId: Object.hasOwn(input.args,'operationId'))fail('MACHINE_CONTEXT_FORGED')
      if(input.args.rootId&&input.args.rootId!==input.rootId||input.args.workspaceRef&&(input.args.workspaceRef.machineId!==record.id||input.args.workspaceRef.rootId!==input.rootId)) fail('MACHINE_BOT_DENIED')
      const call={machineId:record.id,botId,controller:new AbortController()};active.add(call)
      const combined=AbortSignal.any([call.controller.signal,...(signal?[signal]:[])])
      const leaseBinding={taskId:input.taskId,attemptId:input.attemptId,machineId:record.id,workspaceId:'remote_'+createHash('sha256').update(JSON.stringify({rootId:input.rootId})).digest('hex'),location:'remote'}
      let lease
      try {
        lease=authority.issue(subject,{binding:leaseBinding,tools:[`remote/${input.tool}`],ttlMs:60000})
        return await authority.run(lease.token,leaseBinding,`remote/${input.tool}`,async({signal:currentSignal})=>{
          const token=await issue(record,botId,{roots:[input.rootId],tools:[input.tool]},input,currentSignal)
          if(machine(record.id).revision!==record.revision||binding(record.id,botId).revision!==grant.revision) fail('MACHINE_GRANT_CHANGED')
          authority.assertTool(subject,`remote/${input.tool}`)
          sent=true
          const result=await invoke(record,token,input.tool,input.args,input.operationId,currentSignal)
          currentSignal.throwIfAborted();authority.assertTool(subject,`remote/${input.tool}`)
          return result
        },{signal:combined})
      } finally { if(lease)authority.release(lease.token);active.delete(call) }
      }catch(error){
        const code=/^[A-Z][A-Z0-9_]{0,80}$/.test(error?.code??'')?error.code:'MACHINE_CONNECTION_FAILED'
        throw Object.assign(new Error(error?.message??code),{code,remoteDispatchNotSent:!sent,...(error?.details?{details:error.details}:{}),...(Number.isSafeInteger(error?.retryAfterMs)&&error.retryAfterMs>0&&error.retryAfterMs<=60000?{retryAfterMs:error.retryAfterMs}:{})})
      }
    },
    async probe(input,context) {
      owner(context); keys(input,['machineId','botId','rootId','relativePath'])
      // This owner diagnostic uses an explicit selected Bot scope, not a synthetic owner grant.
      const record=machine(input.machineId), grant=binding(record.id,input.botId)
      const tool=input.relativePath===undefined?'machine_ping':'fs_read'
      if(!grant.scope.roots.includes(input.rootId)||!grant.scope.tools.includes(tool)) fail('MACHINE_BOT_DENIED')
      const identity={taskId:`probe-${randomUUID()}`,attemptId:`attempt-${randomUUID()}`}
      const token=await issue(record,input.botId,{roots:[input.rootId],tools:[tool]},identity,context.signal)
      const value=await invoke(record,token,tool,tool==='fs_read'?{rootId:input.rootId,relativePath:input.relativePath,length:4096}:{},null,context.signal)
      if(machine(record.id).revision!==record.revision||binding(record.id,input.botId).revision!==grant.revision) fail('MACHINE_GRANT_CHANGED')
      if(tool==='machine_ping') {
        if(value.machineId!==record.id||value.agentApiMajor!==1)fail('MACHINE_IDENTITY_MISMATCH')
        db.prepare('UPDATE remote_machines SET health=? WHERE id=? AND revision=?').run(JSON.stringify({lastSeenAt:now(),platform:value.os?.platform??null,version:value.agentVersion,capabilities:value.capabilities??[],desktop:value.desktop??{status:'unverified'}}),record.id,record.revision)
      }
      event(record.id,input.botId,tool==='fs_read'?'diagnostic-read':'probed')
      return tool==='fs_read'?{...value,content:undefined,diagnostic:'read-confirmed',bytes:Buffer.from(value.content,'base64').length}:publicMachine(machine(record.id))
    },
    async download(subject,input,{signal}={}) {
      alive(); keys(input,['machineId','rootId','taskId','attemptId','operationId','artifactId'])
      for(const key of ['machineId','rootId','taskId','attemptId','operationId','artifactId'])if(!ref(input[key]))fail('INVALID_MACHINE_REQUEST')
      try {
        const metadata=await this.call(subject,{...input,tool:'artifact_stat',args:{artifactId:input.artifactId}},{signal})
        if(metadata?.artifactId!==input.artifactId||!/^[a-f0-9]{64}$/.test(metadata.sha256??'')||!Number.isSafeInteger(metadata.size)||metadata.size<0)fail('ARTIFACT_CORRUPT')
        // One screenshot of a 1080p window is routinely larger than the 1 MiB single-read
        // limit, so the content is read in bounded chunks up to the artifact ceiling.
        if(metadata.size>DOWNLOAD_LIMIT_BYTES)fail('ARTIFACT_DOWNLOAD_LIMIT')
        const chunks=[];let offset=0
        while(offset<metadata.size){
          const value=await this.call(subject,{...input,tool:'artifact_read',args:{artifactId:input.artifactId,offset,length:Math.min(DOWNLOAD_CHUNK_BYTES,metadata.size-offset)}},{signal})
          const chunk=Buffer.from(value?.content??'','base64')
          if(!chunk.length||chunk.length>metadata.size-offset)fail('ARTIFACT_CORRUPT')
          chunks.push(chunk);offset+=chunk.length
        }
        const bytes=Buffer.concat(chunks)
        if(bytes.length!==metadata.size||createHash('sha256').update(bytes).digest('hex')!==metadata.sha256)fail('ARTIFACT_CORRUPT')
        return {artifactId:metadata.artifactId,sha256:metadata.sha256,size:metadata.size,mediaType:metadata.mediaType,content:bytes.toString('base64')}
      } catch(error) {
        if(error?.code==='ARTIFACT_NOT_FOUND')fail('ARTIFACT_DOWNLOAD_EXPIRED')
        throw error
      }
    },
    scopes(botId) { alive(); return inheritedMainScopes(botId) ?? db.prepare('SELECT machine_id,revision,scope FROM remote_machine_bindings WHERE bot_id=? AND revoked=0').all(botId).flatMap(r=>{try{machine(r.machine_id);return [{machineId:r.machine_id,revision:r.revision,...JSON.parse(r.scope)}]}catch{return []}}) },
    /**
     * A Bot's grants, straight from committed state.
     *
     * Grant compilation runs on every DS save, long before a machine directory is opened, so it
     * must not depend on `scopes()` (which needs the directory alive). This reads the same rows
     * without the availability check: what was authorised stays authorised across a restart.
     */
    bindingsFor(botId,{main=mainBotIds().includes(botId)}={}) {
      alive()
      if (typeof botId !== 'string' || !botId) return []
      // Only Host grant compilation supplies this override, from the saved role
      // being adopted. The currently committed role may still be the old one.
      if(main)return mainScopes(botId)
      return db.prepare('SELECT machine_id, revision, scope FROM remote_machine_bindings WHERE bot_id=? AND revoked=0').all(botId).flatMap(row => {
        try { const scope = JSON.parse(row.scope); return [{ machineId: row.machine_id, revision: row.revision, roots: scope.roots ?? [], tools: scope.tools ?? [], mode: scope.mode ?? 'read-only' }] } catch { return [] }
      })
    },

    readModel() { alive(); return {status:'available',items:db.prepare('SELECT * FROM remote_machines ORDER BY id').all().map(row=>publicMachine({...row,config:JSON.parse(row.config),health:row.health?JSON.parse(row.health):null}))} },
    close() { if(!closed){for(const call of active)call.controller.abort(new Error('MACHINE_DIRECTORY_CLOSED'));closed=true;closeChannels();db.close()} },
  }
  return Object.freeze(store)
}
