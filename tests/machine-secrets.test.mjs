import test from 'node:test'
import assert from 'node:assert/strict'
import {guardMachineSecrets} from '../packages/orchestration/src/machine-secrets.mjs'
function fixture(){
  let hook,revocations=0,calls=0,released=false
  const runtime={state:{secretRequests:{bot:[{id:'card',name:'REMOTE_AGENT_TEST'}]}},loadSecrets:async()=>{},secretsView:()=>[{name:'REMOTE_AGENT_TEST',scope:[]}],secretEndpoint:async()=>{calls++;return {saved:true}}}
  const original=runtime.secretEndpoint
  const release=guardMachineSecrets({on:(event,value)=>{assert.equal(event,'tools/execute');hook=value;return()=>{released=true}}},runtime,{readModel:()=>({items:[{id:'machine',revision:2,secretRef:'ds-secret/REMOTE_AGENT_TEST',status:'online'}]}),revoke:async(input,context)=>{assert.deepEqual(input,{machineId:'machine',expectedRevision:2});assert.equal(context.kind,'owner');revocations++}})
  return{runtime,release,original,hook:()=>hook,stats:()=>({revocations,calls,released})}
}
test('machine secrets: existing secret UI cannot share control keys or allow a Bot request card',async()=>{
  const f=fixture()
  for(const request of [['secret-update',{name:'REMOTE_AGENT_TEST',scope:'all'}],['secret-set',{name:'REMOTE_AGENT_TEST',value:'secret',scope:['bot']}],['secret-allow',{requestId:'card'}],['secret-set',{requestId:'card',value:'secret',scope:'bot'}]])await assert.rejects(f.runtime.secretEndpoint(...request),{code:'MACHINE_SECRET_MUST_BE_HOST_ONLY'})
  assert.equal(f.stats().calls,0)
  for(const name of ['remote-agent-test',' remote agent test ','$env:DSH_SECRET_REMOTE_AGENT_TEST'])await assert.rejects(f.runtime.secretEndpoint('secret-update',{name,scope:'all'}),{code:'MACHINE_SECRET_MUST_BE_HOST_ONLY'})
  assert.throws(()=>f.hook()({name:'request_secret',arguments:{name:'REMOTE_AGENT_TEST'}},()=>{throw new Error('must not execute')}),{code:'MACHINE_SECRET_MUST_BE_HOST_ONLY'})
  f.release()
})
test('machine secrets: host-only saves reuse existing secret service and deletion first revokes the machine',async()=>{
  const f=fixture()
  await f.runtime.secretEndpoint('secret-set',{name:'REMOTE_AGENT_TEST',value:'secret',scope:[]})
  await f.runtime.secretEndpoint('secret-set',{name:'REMOTE_AGENT_TEST',value:'changed'})
  await f.runtime.secretEndpoint('secret-delete',{name:'REMOTE_AGENT_TEST'})
  assert.deepEqual(f.stats(),{revocations:1,calls:3,released:false})
  assert.equal(f.hook()({name:'request_secret',arguments:{name:'NORMAL_SECRET'}},()=>true),true)
  f.release();assert.equal(f.runtime.secretEndpoint,f.original);assert.equal(f.stats().released,true)
})
