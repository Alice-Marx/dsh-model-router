import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {createHash} from 'node:crypto'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { Store, serve } from '../remote-computer-agent/dist/index.mjs'
import { openRemoteMachines } from '../packages/orchestration/src/remote-machines.mjs'
import { openSecurePairingHost } from '../packages/orchestration/src/secure-pairing-host.mjs'

const ceiling={botIds:['bot-a'],roots:['project'],tools:['machine_ping','fs_list']}
const owner={kind:'owner'}
const rejectsCode=(pending,code)=>assert.rejects(pending,error=>error.code===code)
async function fixture(t){
  const root=resolve('tmp/integration/secure-pairing-host');await mkdir(root,{recursive:true})
  const directory=await mkdtemp(join(root,'case-')),file=join(directory,'host.sqlite')
  let store=new Store(join(directory,'agent'),Database,{admin:true});t.after(()=>store.close())
  let pings=0,pairs=0,writes=0,saveFails=0,pairFails=0,saveAfterCommitFails=0,clock=Date.now()
  const secrets=new Map()
  const agent={store,desktopSessions:{close:async()=>{},hasOrigin:()=>false,sweep:async()=>{}},call:async(name)=>{
    assert.equal(name,'machine_ping');pings++;return {machineId:store.machineId,agentApiMajor:1,agentVersion:'0.1.1',os:{platform:'fixture'},capabilities:[]}
  }}
  let listener=await serve(agent,{mode:'e2e',port:0});t.after(()=>listener.close())
  const endpoint=`http://127.0.0.1:${listener.address.port}`
  const machines=openRemoteMachines({Database,file,resolveSecret:async ref=>secrets.get(ref),botExists:id=>id==='bot-a'})
  t.after(()=>machines.close())
  const create=()=>openSecurePairingHost({Database,file,machines,botExists:id=>id==='bot-a',now:()=>clock,
    resolveSecret:async ref=>secrets.get(ref),
    saveSecret:async(name,value)=>{writes++;if(saveFails-->0)throw Object.assign(new Error('fixture secret unavailable'),{code:'SECRET_STORE_UNAVAILABLE'});secrets.set(`ds-secret/${name}`,value);if(saveAfterCommitFails-->0)throw Object.assign(new Error('fixture acknowledgement lost'),{code:'SECRET_SAVE_ACK_LOST'})},
    pair:async(payload,context)=>{pairs++;if(pairFails-->0)throw Object.assign(new Error('fixture pair unavailable'),{code:'MACHINE_CONNECTION_FAILED'});return machines.pair(payload,context)},
  })
  const invite=store.invite('host-a',ceiling,{endpoint}),input={invite,code:invite.code,requestId:'request-original-12345',probeBotId:'bot-a',expectedRevision:0}
  return {get store(){return store},machines,file,input,create,secrets,stats:()=>({pings,pairs,writes}),failSave:()=>{saveFails=1},failAfterSave:()=>{saveAfterCommitFails=1},failPair:()=>{pairFails=1},advance:()=>{clock+=200_000},
    restartAgent:async()=>{const port=listener.address.port;await listener.close();store.close();store=new Store(join(directory,'agent'),Database,{admin:true});agent.store=store;listener=await serve(agent,{mode:'e2e',port})}}
}

test('Host redeems over a pinned connection; raw device credentials only enter the secret service; completed retry does not pair twice',async t=>{
  const f=await fixture(t),service=f.create();t.after(()=>service.close())
  const result=await service.redeem(f.input,owner)
  assert.equal(result.machineId,f.input.invite.machineId);assert.deepEqual(result.transport,f.input.invite.transport)
  assert.equal(Object.hasOwn(result,'token'),false)
  const token=[...f.secrets.values()][0];assert.equal(f.store.client(token).id,'host-a')
  assert.deepEqual(f.stats(),{pings:1,pairs:1,writes:1})
  const recovered=await service.redeem({...f.input,requestId:'new-ui-request-123456'},owner)
  assert.equal(recovered.recovered,true);assert.deepEqual(f.stats(),{pings:1,pairs:1,writes:1})
  const view=JSON.stringify(f.machines.readModel());assert.equal(view.includes(token),false);assert.equal(view.includes(f.input.invite.token),false)
  const db=new Database(f.file);const rows=db.prepare('SELECT * FROM secure_pairing_requests').all();db.close()
  assert.equal(rows.length,1);assert.equal(rows[0].request_id,f.input.requestId)
  assert.equal(JSON.stringify(rows).includes(f.input.invite.token),false);assert.equal(JSON.stringify(rows).includes(token),false)
  assert.equal(JSON.stringify(rows).includes(createHash('sha256').update(token).digest('hex')),false,'the Host journal must not store the reusable Noise credential hash')
  await rejectsCode(service.redeem({...f.input,code:f.input.code==='000000'?'111111':'000000'},owner),'PAIRING_REQUEST_CONFLICT')
})

test('Host restart after secret failure recovers the original redemption identity with a new UI request id',async t=>{
  const f=await fixture(t);let service=f.create();f.failSave()
  await rejectsCode(service.redeem(f.input,owner),'SECRET_STORE_UNAVAILABLE')
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM clients').get().n,1)
  service.close();service=f.create();t.after(()=>service.close())
  const result=await service.redeem({...f.input,requestId:'new-ui-request-654321'},owner)
  assert.equal(result.machineId,f.input.invite.machineId)
  assert.equal(f.store.db.prepare('SELECT consumed_request FROM pairing_invites').get().consumed_request,f.input.requestId)
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM clients').get().n,1)
  assert.deepEqual(f.stats(),{pings:1,pairs:1,writes:2})
})

test('saved Host credentials finish the original pair after invite expiry without another redemption or widening',async t=>{
  const f=await fixture(t);let service=f.create();f.failPair()
  await rejectsCode(service.redeem(f.input,owner),'MACHINE_CONNECTION_FAILED')
  service.close();f.advance();service=f.create();t.after(()=>service.close())
  const result=await service.redeem({...f.input,requestId:'new-ui-request-expired'},owner)
  assert.equal(result.machineId,f.input.invite.machineId);assert.deepEqual(result.roots,ceiling.roots);assert.deepEqual(result.tools,[...ceiling.tools].sort())
  assert.deepEqual(f.stats(),{pings:1,pairs:2,writes:1})
  const control=f.store.client([...f.secrets.values()][0])
  assert.throws(()=>f.store.issue(control,{botId:'bot-a',taskId:'task-a',attemptId:'attempt-a',roots:['elsewhere'],tools:['fs_write']}),/SCOPE_DENIED/)
})

test('owner, fixed invite scope and machine revision are checked before redemption',async t=>{
  const f=await fixture(t),service=f.create();t.after(()=>service.close())
  await rejectsCode(service.redeem(f.input,{kind:'bot'}),'REMOTE_OWNER_REQUIRED')
  await rejectsCode(service.redeem({...f.input,probeBotId:'bot-forged'},owner),'PAIRING_REQUEST_INVALID')
  await rejectsCode(service.redeem({...f.input,expectedRevision:1},owner),'MACHINE_CONFIG_CONFLICT')
  await rejectsCode(service.redeem({...f.input,invite:{...f.input.invite,transport:{...f.input.invite.transport,fingerprint:'0'.repeat(64)}}},owner),'PAIRING_IDENTITY_MISMATCH')
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM clients').get().n,0)
  assert.deepEqual(f.stats(),{pings:0,pairs:0,writes:0})
})

test('a committed Secret is reconciled after both processes restart and the invite expires without a second redemption or write',async t=>{
  const f=await fixture(t);let service=f.create();f.failAfterSave()
  await rejectsCode(service.redeem(f.input,owner),'SECRET_SAVE_ACK_LOST')
  const token=[...f.secrets.values()][0]
  service.close();await f.restartAgent();f.advance();service=f.create();t.after(()=>service.close())
  const result=await service.redeem({...f.input,requestId:'recovered-after-crash'},owner)
  assert.equal(result.machineId,f.input.invite.machineId);assert.equal(f.store.client(token).id,'host-a')
  assert.deepEqual(f.stats(),{pings:1,pairs:1,writes:1})
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM clients').get().n,1)
})

test('an unsaved device credential after Agent restart has an actionable failure and can be explicitly revoked and re-invited under the same client identity',async t=>{
  const f=await fixture(t);let service=f.create();f.failSave()
  await rejectsCode(service.redeem(f.input,owner),'SECRET_STORE_UNAVAILABLE')
  service.close();await f.restartAgent();service=f.create();t.after(()=>service.close())
  await rejectsCode(service.redeem(f.input,owner),'PAIRING_DEVICE_ALREADY_COMMITTED')
  assert.equal(f.machines.readModel().items.length,0);assert.equal(f.secrets.size,0)
  assert.throws(()=>f.store.invite('host-a',ceiling,{endpoint:f.input.invite.endpoint}),/CLIENT_ALREADY_PAIRED/)
  f.store.revoke('host-a')
  const invite=f.store.invite('host-a',ceiling,{endpoint:f.input.invite.endpoint})
  const result=await service.redeem({...f.input,invite,code:invite.code,requestId:'explicit-owner-reinvite'},owner)
  assert.equal(result.machineId,f.input.invite.machineId)
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM clients').get().n,1)
  assert.ok(f.store.client([...f.secrets.values()][0]).revision>1)
})

test('a different Secret cannot be promoted as the original credential during crash recovery',async t=>{
  const f=await fixture(t);let service=f.create();f.failAfterSave()
  await rejectsCode(service.redeem(f.input,owner),'SECRET_SAVE_ACK_LOST')
  const name=[...f.secrets.keys()][0];f.secrets.set(name,'z'.repeat(43));service.close();service=f.create();t.after(()=>service.close())
  await rejectsCode(service.redeem(f.input,owner),'PAIRING_CREDENTIAL_CHANGED')
  assert.equal(f.stats().pairs,0);assert.equal(f.stats().writes,1);assert.equal(f.secrets.get(name),'z'.repeat(43))
})
