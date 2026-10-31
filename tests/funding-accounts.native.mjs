import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import Database from 'better-sqlite3'
import {openFundingAccounts,providerFundingId} from '../packages/orchestration/src/funding-accounts.mjs'

const owner={kind:'owner'}
const providers=()=>['fixture','other']
async function fixture(t,options={}){
  await mkdir(resolve('tmp/integration/funding-accounts'),{recursive:true})
  const dir=await mkdtemp(resolve('tmp/integration/funding-accounts/case-'))
  const file=join(dir,'accounts.sqlite'),changes=[],suspended=[]
  const config={Database,file,providers,onCommitted:value=>changes.push(value),onSuspended:value=>suspended.push(value),...options}
  const store=openFundingAccounts(config);t.after(()=>store.close())
  return {store,config,file,changes,suspended}
}
const request=(id,overrides={})=>({scopeId:id,expectedRevision:0,enabled:true,dailyLimitUsd:0,monthlyLimitUsd:10,...overrides})

test('funding accounts/native: provider scopes are stable, disabled by default and contain no vendor balance claim',async t=>{
  const f=await fixture(t),id=providerFundingId('fixture')
  assert.equal(id,providerFundingId('fixture'));assert.notEqual(id,providerFundingId('other'))
  const value=f.store.get(id)
  assert.equal(value.enabled,false);assert.equal(value.revision,0);assert.equal(value.balanceKnown,false)
  assert.equal(value.dailyLimitUsd,null);assert.equal(value.monthlyLimitUsd,null)
  assert.throws(()=>f.store.get('missing'),{code:'FUNDING_SCOPE_UNAVAILABLE'})
})

test('funding accounts/native: owner CAS persists explicit zero limits and separate disabled null policy',async t=>{
  const f=await fixture(t),id=providerFundingId('fixture')
  const saved=f.store.save(request(id),owner)
  assert.equal(saved.revision,1);assert.equal(saved.enabled,true);assert.equal(saved.dailyLimitUsd,0)
  assert.equal(f.changes.length,1)
  const other=openFundingAccounts(f.config)
  try{
    assert.equal(other.get(id).enabled,true)
    assert.throws(()=>other.save(request(id),owner),{code:'FUNDING_POLICY_CONFLICT'})
    const disabled=other.save(request(id,{expectedRevision:1,enabled:false,dailyLimitUsd:null,monthlyLimitUsd:null}),owner)
    assert.equal(disabled.revision,2);assert.equal(disabled.enabled,false);assert.equal(disabled.dailyLimitUsd,null)
  }finally{other.close()}
  assert.equal(f.store.get(id).revision,2)
})

test('funding accounts/native: non-owner, malformed and incomplete enabled policies never commit',async t=>{
  const f=await fixture(t),id=providerFundingId('fixture')
  assert.throws(()=>f.store.save(request(id),{kind:'agent'}),{code:'REMOTE_OWNER_REQUIRED'})
  for(const value of [request(id,{dailyLimitUsd:null}),request(id,{monthlyLimitUsd:-1}),request(id,{extra:true}),request(id,{expectedRevision:-1})])
    assert.throws(()=>f.store.save(value,owner))
  assert.equal(f.store.get(id).revision,0);assert.equal(f.changes.length,0)
})

test('funding accounts/native: publish failure durably closes the scope for every host and revokes through suspension callback',async t=>{
  const f=await fixture(t,{onCommitted:()=>{throw new Error('host publish failed')}}),id=providerFundingId('fixture')
  assert.throws(()=>f.store.save(request(id),owner),error=>error.code==='FUNDING_PUBLISH_FAILED'&&error.committed===true)
  assert.equal(f.store.get(id).enabled,false);assert.equal(f.store.get(id).revision,1)
  assert.equal(f.suspended.length,1);assert.equal(f.suspended[0].enabled,false)
  const other=openFundingAccounts(f.config)
  try{assert.equal(other.get(id).enabled,false,'another Host must not observe a committed but unpublished scope as enabled')}finally{other.close()}
})

test('funding accounts/native: asynchronous publish callbacks also fail closed and can be retried explicitly',async t=>{
  let fail=true
  const f=await fixture(t,{onCommitted:value=>{if(fail)return Promise.resolve(value);f.changes.push(value)}}),id=providerFundingId('fixture')
  assert.throws(()=>f.store.save(request(id),owner),{code:'FUNDING_PUBLISH_FAILED'})
  assert.equal(f.store.get(id).enabled,false)
  fail=false
  const saved=f.store.save(request(id,{expectedRevision:1}),owner)
  assert.equal(saved.revision,2);assert.equal(saved.enabled,true);assert.equal(f.changes.length,1)
})

test('funding accounts/native: suspension callback failure is explicit while durable closure still holds',async t=>{
  const f=await fixture(t,{onCommitted:()=>{throw new Error('publish')},onSuspended:()=>{throw new Error('suspend')}}),id=providerFundingId('fixture')
  assert.throws(()=>f.store.save(request(id),owner),{code:'FUNDING_HOST_SUSPENSION_REQUIRED'})
  assert.equal(f.store.get(id).enabled,false)
})
