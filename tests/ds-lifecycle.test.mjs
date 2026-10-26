import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthority } from '../packages/capability-broker/src/authority.mjs'
import { createPrincipalDirectory } from '../packages/orchestration/src/principals.mjs'
import { attachDsLifecycle, compileDsOwnership } from '../packages/orchestration/src/ds-lifecycle.mjs'

const grantFor = bot => ({tools:['tool/read'],modelRoutes:bot.model ? [{provider:'fixture',model:bot.model}] : []})
const snapshot = () => ({version:1,revision:1,bots:{a:{id:'a',sessionId:'a-current',model:'gpt-a',segments:[{sessionId:'a-old'}]}},rooms:{r:{members:['a'],sessions:{a:'a-group'},segments:{a:[{sessionId:'a-past-group'}]}}}})
const agent = id => ({id,session:{id}})
async function fixture() {
  const authority = createAuthority(), directory = createPrincipalDirectory(authority)
  let persisted = snapshot(), hold, rejectSave = false
  const saves = []
  const runtime = {state:structuredClone(persisted),statePath:'unused-test-path',
    async load(){},async refresh(){},async resolveAgent(id){return agent(id)},
    save(options){
      saves.push(options)
      if(rejectSave)return Promise.reject(new Error('simulated committed-store failure'))
      this.state.revision++
      const captured = structuredClone(this.state)
      return (async()=>{if(hold)await hold;persisted=captured})()
    },
  }
  const originals={...runtime}
  const bridge=attachDsLifecycle({runtime,directory,grantFor,readSaved:async()=>structuredClone(persisted)})
  await runtime.load()
  return {runtime,bridge,authority,directory,saves,originals,setPersisted:value=>{persisted=value},hold:value=>{hold=value},failSave:()=>{rejectSave=true}}
}

test('DS lifecycle: active own/group Sessions are mapped; archived parts have no owner',()=>{
  const compiled=compileDsOwnership(snapshot(),grantFor)
  assert.deepEqual([...compiled.sessions],[['a-current','a'],['a-group','a']])
  assert.equal(compiled.sessions.has('a-old'),false)
  assert.equal(compiled.sessions.has('a-past-group'),false)
})

test('DS lifecycle: ambiguous Sessions and nonmember owners fail; prototype-looking keys stay literal data',()=>{
  const bad=snapshot();bad.rooms.r.sessions.a='a-current'
  assert.throws(()=>compileDsOwnership(bad,grantFor),/AMBIGUOUS_SESSION_OWNER/)
  const outsider=snapshot();outsider.rooms.r.members=[]
  assert.throws(()=>compileDsOwnership(outsider,grantFor),/INVALID_GROUP_OWNER/)
  const injected=JSON.parse('{"version":1,"revision":1,"bots":{"__proto__":{"id":"__proto__","sessionId":"proto-session"}},"rooms":{}}')
  assert.deepEqual([...compileDsOwnership(injected,grantFor).sessions],[['proto-session','__proto__']])
  assert.equal(Object.prototype.sessionId,undefined)
})

test('DS lifecycle: cached and later-resolved real object identities bind automatically',async()=>{
  const {runtime,directory,bridge}=await fixture()
  const own=await runtime.resolveAgent('a-current'),group=await runtime.resolveAgent('a-group')
  assert.equal(directory.forAgent(own),directory.forAgent(group))
  assert.throws(()=>directory.forAgent({...own}),/UNKNOWN_SUBJECT/)
  assert.throws(()=>directory.forAgent(agent('a-old')),/UNKNOWN_SUBJECT/)
  assert.equal(bridge.status().boundAgents,2)
})

test('DS lifecycle: a newly resolved Session gets no grant until its Bot is saved',async()=>{
  const {runtime,directory}=await fixture()
  const fresh=await runtime.resolveAgent('b-chat')
  assert.throws(()=>directory.forAgent(fresh),/UNKNOWN_SUBJECT/)
  runtime.state.bots.b={id:'b',sessionId:'b-chat',model:'gpt-b'}
  await runtime.save()
  directory.forAgent(fresh)
})

test('DS lifecycle: deferred saves use their captured snapshot and never grant later memory-only changes',async()=>{
  const {runtime,directory,authority,hold,saves}=await fixture()
  const own=await runtime.resolveAgent('a-current')
  let finish
  hold(new Promise(resolve=>{finish=resolve}))
  runtime.state.bots.a.model='gpt-committed'
  const pending=runtime.save({required:false})
  runtime.state.bots.a.model='gpt-memory-only'
  authority.assertModel(directory.forAgent(own),'fixture','gpt-a')
  finish();await pending
  authority.assertModel(directory.forAgent(own),'fixture','gpt-committed')
  assert.throws(()=>authority.assertModel(directory.forAgent(own),'fixture','gpt-memory-only'),/MODEL_DENIED/)
  assert.equal(saves[0].required,true)
})

test('DS lifecycle: failed writes suspend existing grants and detach all active Sessions',async()=>{
  const {runtime,directory,bridge,failSave,authority}=await fixture()
  const own=await runtime.resolveAgent('a-current'),subject=directory.forAgent(own)
  const binding={taskId:'t',attemptId:'a',machineId:'m',workspaceId:'w',location:'local'}
  const {token}=authority.issue(subject,{binding,tools:['tool/read']})
  const active=authority.run(token,binding,'tool/read',({signal})=>new Promise((_,reject)=>{
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true})
  }))
  const revoked=assert.rejects(active,/GRANT_CHANGED/)
  runtime.state.bots.a.model='memory-only-model'
  failSave()
  await assert.rejects(runtime.save(),/simulated committed-store failure/)
  await revoked
  assert.equal(bridge.status().healthy,false)
  assert.throws(()=>directory.forAgent(own),/UNKNOWN_SUBJECT/)
  assert.throws(()=>authority.assertTool(subject,'tool/read'),/TOOL_DENIED/)
  await runtime.refresh()
  assert.equal(bridge.status().healthy,true)
  authority.assertModel(directory.forAgent(own),'fixture','gpt-a')
  assert.throws(()=>authority.assertModel(subject,'fixture','memory-only-model'),/MODEL_DENIED/)
})

test('DS lifecycle: a current-chat change detaches its past Agent and binds the new one',async()=>{
  const {runtime,directory}=await fixture()
  const previous=await runtime.resolveAgent('a-current'),next=await runtime.resolveAgent('a-next')
  const subject=directory.forAgent(previous)
  runtime.state.bots.a.sessionId='a-next'
  runtime.state.bots.a.segments.push({sessionId:'a-current'})
  await runtime.save()
  assert.throws(()=>directory.forAgent(previous),/UNKNOWN_SUBJECT/)
  assert.equal(directory.forAgent(next),subject)
})

test('DS lifecycle: deletion retires the Bot; a stale refresh cannot restore its Sessions',async()=>{
  const {runtime,directory,setPersisted}=await fixture()
  const own=await runtime.resolveAgent('a-current')
  delete runtime.state.bots.a
  runtime.state.rooms={}
  await runtime.save()
  assert.throws(()=>directory.forAgent(own),/UNKNOWN_SUBJECT/)
  setPersisted(snapshot())
  await runtime.refresh()
  assert.throws(()=>directory.forAgent(own),/UNKNOWN_SUBJECT/)
})

test('DS lifecycle: a same-revision conflict or reassigned Session suspends instead of widening access',async()=>{
  const {runtime,bridge,setPersisted}=await fixture()
  const conflict=snapshot();conflict.bots.a.model='other'
  setPersisted(conflict)
  await assert.rejects(runtime.refresh(),/DS_REVISION_CONFLICT/)
  assert.equal(bridge.status().healthy,false)
  const changed=snapshot();changed.revision=2;changed.bots={b:{id:'b',sessionId:'a-current'}};changed.rooms={}
  setPersisted(changed)
  await assert.rejects(runtime.refresh(),/SESSION_OWNER_CHANGED/)
})

test('DS lifecycle: new process hydration restores grants; disposal restores only its own wrappers',async()=>{
  const {runtime,bridge,directory,originals}=await fixture()
  const own=await runtime.resolveAgent('a-current')
  directory.forAgent(own)
  bridge.close();bridge.close()
  assert.equal(runtime.save,originals.save)
  assert.equal(runtime.resolveAgent,originals.resolveAgent)
  assert.throws(()=>directory.forAgent(own),/UNKNOWN_SUBJECT/)
  const fresh=createPrincipalDirectory(createAuthority())
  const next=attachDsLifecycle({runtime,directory:fresh,grantFor,readSaved:async()=>snapshot()})
  await runtime.load()
  fresh.forAgent(await runtime.resolveAgent('a-current'))
  next.close()
})

test('DS lifecycle: a late save completion after close cannot recreate grants or touch a disposed authority',async()=>{
  const {runtime,bridge,authority,directory,hold}=await fixture()
  const own=await runtime.resolveAgent('a-current')
  let finish
  hold(new Promise(resolve=>{finish=resolve}))
  const pending=runtime.save()
  const refused=assert.rejects(pending,/DS_LIFECYCLE_CLOSED/)
  bridge.close();authority.dispose();finish()
  await refused
  assert.throws(()=>directory.forAgent(own),/UNKNOWN_SUBJECT/)
  assert.equal(bridge.status().boundAgents,0)
})

test('DS lifecycle: a missing committed file after hydration suspends instead of preserving old access',async()=>{
  const {runtime,directory,bridge,setPersisted}=await fixture()
  const own=await runtime.resolveAgent('a-current')
  setPersisted(null)
  await assert.rejects(runtime.refresh(),/DS_COMMITTED_STATE_MISSING/)
  assert.equal(bridge.status().healthy,false)
  assert.throws(()=>directory.forAgent(own),/UNKNOWN_SUBJECT/)
})
