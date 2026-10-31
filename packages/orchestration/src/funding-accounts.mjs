import {createHash} from 'node:crypto'
import {mkdirSync} from 'node:fs'
import {dirname} from 'node:path'

const fail=code=>{throw Object.assign(new Error(code),{code})}
export const providerFundingId=provider=>`provider-${createHash('sha256').update(provider).digest('hex').slice(0,32)}`
const cap=value=>value===null||typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1e9

/** Local policy scopes for Harness provider routes; these are not vendor balances. */
export function openFundingAccounts({Database,file,providers,onCommitted=()=>{},onSuspended=()=>{},now=Date.now}){
  if(file!==':memory:')mkdirSync(dirname(file),{recursive:true})
  const db=new Database(file);let closed=false
  try{
    db.pragma('busy_timeout=5000');db.pragma('synchronous=FULL')
    if(file!==':memory:'&&db.pragma('journal_mode=WAL',{simple:true})!=='wal')fail('FUNDING_WAL_REQUIRED')
    db.exec('CREATE TABLE IF NOT EXISTS bot_funding_accounts(scope_id TEXT PRIMARY KEY,provider TEXT NOT NULL,schema_version INTEGER NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL)')
    if(db.prepare('SELECT 1 FROM bot_funding_accounts WHERE schema_version!=1').get())fail('FUNDING_SCHEMA_UNSUPPORTED')
  }catch(error){db.close();throw error}
  const catalog=()=>{
    if(closed)fail('FUNDING_CLOSED')
    return [...new Set(providers())].map(provider=>{
      const id=providerFundingId(provider),row=db.prepare('SELECT * FROM bot_funding_accounts WHERE scope_id=?').get(id)
      if(row&&row.provider!==provider)fail('FUNDING_SCOPE_CONFLICT')
      const value=row?JSON.parse(row.payload):{enabled:false,dailyLimitUsd:null,monthlyLimitUsd:null,updatedAt:null}
      if(typeof value.enabled!=='boolean'||!cap(value.dailyLimitUsd)||!cap(value.monthlyLimitUsd)||value.enabled&&(value.dailyLimitUsd===null||value.monthlyLimitUsd===null))fail('FUNDING_POLICY_CORRUPT')
      return{id,provider,label:provider,revision:row?.revision??0,...value,mode:'api',scopeKind:'harness-provider',balanceKnown:false}
    })
  }
  const get=id=>{const value=catalog().find(item=>item.id===id);if(!value)fail('FUNDING_SCOPE_UNAVAILABLE');return value}
  const suspend=(saved,cause)=>{
    let value
    try{
      value={enabled:false,dailyLimitUsd:saved.dailyLimitUsd,monthlyLimitUsd:saved.monthlyLimitUsd,updatedAt:now()}
      db.transaction(()=>{db.prepare('UPDATE bot_funding_accounts SET payload=? WHERE scope_id=?').run(JSON.stringify(value),saved.id)}).immediate()
    }catch(error){throw Object.assign(new Error('资金授权同步失败，且持久关闭未完成；宿主必须停止此资金范围。'),{code:'FUNDING_HOST_SUSPENSION_REQUIRED',committed:true,cause:error})}
    try{
      const response=onSuspended({...get(saved.id),reason:cause.message})
      if(response&&typeof response.then==='function')fail('FUNDING_SYNC_CALLBACK_REQUIRED')
    }catch(error){throw Object.assign(new Error('资金范围已持久关闭，但宿主暂停回调失败；宿主必须停止此资金范围。'),{code:'FUNDING_HOST_SUSPENSION_REQUIRED',committed:true,cause:error})}
    throw Object.assign(new Error('资金范围已提交，但授权同步失败；范围已持久关闭，请修复后由拥有者重新启用。'),{code:'FUNDING_PUBLISH_FAILED',committed:true,revision:saved.revision,cause})
  }
  return Object.freeze({catalog,get,
    save(request,context){
      if(context?.kind!=='owner')fail('REMOTE_OWNER_REQUIRED')
      if(!request||Object.keys(request).some(key=>!['scopeId','expectedRevision','enabled','dailyLimitUsd','monthlyLimitUsd'].includes(key))||!Number.isSafeInteger(request.expectedRevision)||request.expectedRevision<0||typeof request.enabled!=='boolean'||!cap(request.dailyLimitUsd)||!cap(request.monthlyLimitUsd))fail('INVALID_FUNDING_POLICY')
      if(request.enabled&&(request.dailyLimitUsd===null||request.monthlyLimitUsd===null))fail('FUNDING_LIMITS_REQUIRED')
      const current=catalog().find(item=>item.id===request.scopeId);if(!current)fail('FUNDING_SCOPE_UNAVAILABLE')
      db.transaction(()=>{
        const previous=db.prepare('SELECT revision FROM bot_funding_accounts WHERE scope_id=?').get(current.id)
        if((previous?.revision??0)!==request.expectedRevision)fail('FUNDING_POLICY_CONFLICT')
        const value={enabled:request.enabled,dailyLimitUsd:request.dailyLimitUsd,monthlyLimitUsd:request.monthlyLimitUsd,updatedAt:now()}
        db.prepare('INSERT INTO bot_funding_accounts VALUES(?,?,1,?,?) ON CONFLICT(scope_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload').run(current.id,current.provider,request.expectedRevision+1,JSON.stringify(value))
      }).immediate()
      const saved=get(current.id)
      try{
        const response=onCommitted(saved)
        if(response&&typeof response.then==='function')fail('FUNDING_SYNC_CALLBACK_REQUIRED')
      }catch(error){suspend(saved,error)}
      return saved
    },
    close(){if(!closed){closed=true;db.close()}},
  })
}
