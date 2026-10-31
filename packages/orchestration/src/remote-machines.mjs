import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const REMOTE_TOOLS = Object.freeze(['machine_ping','fs_list','fs_read','fs_write','shell_exec','container_command_v1',
  'operation_status','operation_cancel','artifact_stat','artifact_read','worktree_create','worktree_diff','worktree_integrate',
  'browser_open','browser_snapshot','browser_click','browser_type','browser_close',
  'desktop_screenshot','desktop_click','desktop_type','desktop_key','desktop_scroll'])
const readonly = new Set(['machine_ping','fs_list','fs_read','operation_status','artifact_stat','artifact_read','worktree_diff','browser_snapshot'])
const ref = value => typeof value === 'string' && /^[-A-Za-z0-9_.]{1,128}$/.test(value)
const fail = code => { throw Object.assign(new Error(code), { code }) }
const owner = context => { if (context?.kind !== 'owner') fail('REMOTE_OWNER_REQUIRED') }
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const keys = (value, allowed) => { if (!plain(value) || Object.keys(value).some(k => !allowed.includes(k))) fail('INVALID_MACHINE_REQUEST') }
const references = (values, allowed) => {
  if (!Array.isArray(values) || !values.length || values.length > 64 || new Set(values).size !== values.length || values.some(v => !ref(v) || allowed && !allowed.includes(v))) fail('INVALID_MACHINE_SCOPE')
  return [...values].sort()
}
export function normalizeMachineEndpoint(value, protectedTunnel = false) {
  let url; try { url = new URL(value) } catch { fail('INVALID_MACHINE_ENDPOINT') }
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') fail('INVALID_MACHINE_ENDPOINT')
  if (url.protocol === 'http:' && !['127.0.0.1','[::1]','localhost'].includes(url.hostname) && protectedTunnel !== true) fail('MACHINE_TLS_REQUIRED')
  return url.origin
}

/** Host metadata only. Long-lived credentials stay in the existing DS secret UI. */
export function openRemoteMachines({ Database, file, resolveSecret, botExists, authority, onChanged = () => {}, now = Date.now, fetchImpl = fetch }) {
  if (typeof Database !== 'function' || typeof resolveSecret !== 'function' || typeof botExists !== 'function') throw new TypeError('REMOTE_MACHINE_SERVICES_REQUIRED')
  if (file !== ':memory:') { file = resolve(file); mkdirSync(dirname(file), { recursive: true }) }
  const db = new Database(file)
  db.pragma('busy_timeout=5000'); db.pragma('journal_mode=WAL'); db.pragma('synchronous=FULL')
  db.exec(`CREATE TABLE IF NOT EXISTS remote_machine_component(component TEXT PRIMARY KEY,version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS remote_machines(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,config TEXT NOT NULL,revoked INTEGER NOT NULL,health TEXT);
    CREATE TABLE IF NOT EXISTS remote_machine_bindings(machine_id TEXT NOT NULL,bot_id TEXT NOT NULL,revision INTEGER NOT NULL,scope TEXT NOT NULL,revoked INTEGER NOT NULL,PRIMARY KEY(machine_id,bot_id));
    CREATE TABLE IF NOT EXISTS remote_machine_revocations(machine_id TEXT NOT NULL,bot_id TEXT NOT NULL,status TEXT NOT NULL,at_ms INTEGER NOT NULL,request_id TEXT NOT NULL,PRIMARY KEY(machine_id,bot_id));
    CREATE TABLE IF NOT EXISTS remote_machine_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,machine_id TEXT NOT NULL,bot_id TEXT,kind TEXT NOT NULL,time INTEGER NOT NULL);`)
  const version = db.prepare('SELECT version FROM remote_machine_component WHERE component=?').get('machines')
  if (version && version.version !== 1) { db.close(); fail('MACHINE_DIRECTORY_VERSION_UNSUPPORTED') }
  db.prepare('INSERT OR IGNORE INTO remote_machine_component VALUES(?,1)').run('machines')
  if(!db.pragma('table_info(remote_machine_revocations)').some(column=>column.name==='request_id'))db.exec("ALTER TABLE remote_machine_revocations ADD COLUMN request_id TEXT NOT NULL DEFAULT ''")
  let closed = false
  const active = new Set()
  const alive = () => { if (closed) fail('MACHINE_DIRECTORY_CLOSED') }
  const machine = id => { alive(); if (!ref(id)) fail('INVALID_MACHINE_ID'); const r = db.prepare('SELECT * FROM remote_machines WHERE id=?').get(id); if (!r || r.revoked) fail('MACHINE_NOT_PAIRED'); return { ...r, config: JSON.parse(r.config), health: r.health ? JSON.parse(r.health) : null } }
  const binding = (machineId,botId) => { const r = db.prepare('SELECT * FROM remote_machine_bindings WHERE machine_id=? AND bot_id=?').get(machineId,botId); if (!r || r.revoked || !botExists(botId)) fail('MACHINE_BOT_DENIED'); return { ...r, scope: JSON.parse(r.scope) } }
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
    if (!response.ok) fail(/^[A-Z][A-Z0-9_]{0,80}$/.test(value?.error?.code) ? value.error.code : 'MACHINE_CONNECTION_FAILED')
    return value
  }
  const request = async (config,path,token,body,signal) => {
    try {
      return await responseJson(await fetchImpl(`${config.endpoint}${path}`, { method: 'POST', redirect: 'error',
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
  const issue = async (record,botId,scope,identity,signal) => {
    const secret = await secretFor(record)
    signal?.throwIfAborted()
    const value = await request(record.config,'/control/v1/grants',secret,{ botId, taskId: identity.taskId, attemptId: identity.attemptId, roots: scope.roots, tools: scope.tools, ttlMs: 60000 },signal)
    if (value.machineId !== record.id || value.agentApiMajor !== 1 || value.botId !== botId || value.taskId !== identity.taskId || value.attemptId !== identity.attemptId || typeof value.grantToken !== 'string') fail('MACHINE_IDENTITY_MISMATCH')
    return value.grantToken
  }
  const invoke = async (record,token,name,args,operationId,signal) => {
    const response = await request(record.config,'/mcp',token,{ jsonrpc:'2.0',id:1,method:'tools/call',params:{ name, arguments:args, ...(operationId ? { _meta:{ 'dsh/operationId':operationId } } : {}) } },signal)
    if (response.error) fail('MACHINE_PROTOCOL_INVALID')
    if (response.result?.isError) { const code=response.result.content?.[0]?.text; fail(/^[A-Z][A-Z0-9_]{0,80}$/.test(code) ? code : 'MACHINE_TOOL_FAILED') }
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
    status: row.revoked ? 'revoked' : row.health && now()-row.health.lastSeenAt<90000 ? 'online' : 'unverified', lastSeenAt: row.health?.lastSeenAt ?? null,
    platform: row.health?.platform ?? null, version: row.health?.version ?? null, capabilities: row.health?.capabilities ?? [], desktop: row.health?.desktop ?? {status:'unverified'},
    revocations:db.prepare('SELECT bot_id,status,at_ms FROM remote_machine_revocations WHERE machine_id=?').all(row.id).map(r=>({botId:r.bot_id,status:r.status,at:r.at_ms})),
    bindings: db.prepare('SELECT bot_id,revision,scope,revoked FROM remote_machine_bindings WHERE machine_id=?').all(row.id).map(b => ({botId:b.bot_id,revision:b.revision,revoked:Boolean(b.revoked),...JSON.parse(b.scope)})) })
  const store = {
    schemaVersion:1, file,
    async pair(input,context) {
      owner(context); alive(); keys(input,['machineId','name','endpoint','secretRef','protectedTunnel','roots','tools','probeBotId','expectedRevision'])
      if (!ref(input.machineId) || !ref(input.probeBotId) || !botExists(input.probeBotId)) fail('INVALID_MACHINE_ID')
      if (typeof input.name !== 'string' || !input.name.trim() || input.name.length>128 || /[\x00-\x1f]/.test(input.name)) fail('INVALID_MACHINE_NAME')
      if (typeof input.secretRef !== 'string' || !/^ds-secret\/[A-Za-z][A-Za-z0-9_]{0,127}$/.test(input.secretRef)) fail('INVALID_MACHINE_SECRET_REF')
      if (input.protectedTunnel !== undefined && typeof input.protectedTunnel !== 'boolean') fail('INVALID_MACHINE_ENDPOINT')
      const config = { name:input.name.trim(), endpoint:normalizeMachineEndpoint(input.endpoint,input.protectedTunnel), secretRef:input.secretRef, protectedTunnel:input.protectedTunnel===true, roots:references(input.roots), tools:references(input.tools,REMOTE_TOOLS) }
      if (!config.tools.includes('machine_ping')) fail('MACHINE_PING_REQUIRED')
      compare(db.prepare('SELECT revision FROM remote_machines WHERE id=?').get(input.machineId),input.expectedRevision)
      const record = {id:input.machineId,config}, identity={taskId:`pair-${randomUUID()}`,attemptId:`attempt-${randomUUID()}`}
      const token=await issue(record,input.probeBotId,{roots:config.roots,tools:['machine_ping']},identity,context.signal)
      const ping=await invoke(record,token,'machine_ping',{},null,context.signal)
      if(ping.machineId!==record.id||ping.agentApiMajor!==1) fail('MACHINE_IDENTITY_MISMATCH')
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
      const affected=botId?[botId]:db.prepare('SELECT bot_id FROM remote_machine_bindings WHERE machine_id=? AND revoked=0').all(record.id).map(r=>r.bot_id)
      const requests=new Map()
      db.transaction(()=>{
        if(botId){compare(db.prepare('SELECT revision FROM remote_machine_bindings WHERE machine_id=? AND bot_id=?').get(record.id,botId),input.expectedRevision);db.prepare('UPDATE remote_machine_bindings SET revoked=1,revision=revision+1 WHERE machine_id=? AND bot_id=?').run(record.id,botId)}
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
      alive();keys(input,['machineId','rootId','tool'])
      const botId=authority.describe(subject).botId,record=machine(input.machineId),grant=binding(record.id,botId)
      if(!grant.scope.roots.includes(input.rootId)||!grant.scope.tools.includes('operation_status'))fail('MACHINE_BOT_DENIED')
      const mutating=input.tool??'fs_write'
      if(mutating!=='fs_write'&&mutating!=='container_command_v1')fail('INVALID_MACHINE_REQUEST')
      if(!observe&&(grant.scope.mode!=='workspace-write'||![mutating,'operation_cancel'].every(t=>grant.scope.tools.includes(t))))fail('MACHINE_BOT_DENIED')
      authority.assertTool(subject,observe?'remote/operation_status':'remote/'+mutating)
      return {machineId:record.id,rootId:input.rootId,remoteMachineRevision:record.revision,remoteBindingRevision:grant.revision}
    },
    async call(subject,input,{signal,expectedTarget}={}) {
      let sent=false
      try{
      alive(); keys(input,['machineId','rootId','taskId','attemptId','tool','args','operationId'])
      const botId=authority.describe(subject).botId
      authority.assertTool(subject,`remote/${input.tool}`)
      if(!ref(input.taskId)||!ref(input.attemptId)||input.operationId!==undefined&&!ref(input.operationId)) fail('INVALID_MACHINE_REQUEST')
      const record=machine(input.machineId), grant=binding(record.id,botId)
      if(expectedTarget&&(expectedTarget.machineId!==record.id||expectedTarget.rootId!==input.rootId||expectedTarget.remoteMachineRevision!==record.revision||expectedTarget.remoteBindingRevision!==grant.revision))fail('MACHINE_GRANT_CHANGED')
      if(!grant.scope.tools.includes(input.tool)||!grant.scope.roots.includes(input.rootId)) fail('MACHINE_BOT_DENIED')
      if(!plain(input.args)||['botId','taskId','attemptId','clientId','grantToken','secretRef','endpoint'].some(k=>Object.hasOwn(input.args,k))) fail('MACHINE_CONTEXT_FORGED')
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
      }catch(error){const code=/^[A-Z][A-Z0-9_]{0,80}$/.test(error?.code??'')?error.code:'MACHINE_CONNECTION_FAILED';throw Object.assign(new Error(code),{code,remoteDispatchNotSent:!sent})}
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
    scopes(botId) { alive(); return db.prepare('SELECT machine_id,revision,scope FROM remote_machine_bindings WHERE bot_id=? AND revoked=0').all(botId).flatMap(r=>{try{machine(r.machine_id);return [{machineId:r.machine_id,revision:r.revision,...JSON.parse(r.scope)}]}catch{return []}}) },
    readModel() { alive(); return {status:'available',items:db.prepare('SELECT * FROM remote_machines ORDER BY id').all().map(row=>publicMachine({...row,config:JSON.parse(row.config),health:row.health?JSON.parse(row.health):null}))} },
    close() { if(!closed){for(const call of active)call.controller.abort(new Error('MACHINE_DIRECTORY_CLOSED'));closed=true;db.close()} },
  }
  return Object.freeze(store)
}
