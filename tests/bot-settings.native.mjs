import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import Database from 'better-sqlite3'
import {openBotSettings,defaultBotSettings} from '../packages/orchestration/src/bot-settings.mjs'

const owner={kind:'owner'}
const catalog=()=>({models:[{provider:'fixture',model:'gpt-exact',cliModels:[{toolId:'codex',model:'gpt-exact'}]}],
  tools:[{toolId:'codex',modes:['read-only'],grantTools:['cli/codex']}],
  capabilities:[{id:'model',tools:['model/infer']},{id:'remote-read',tools:['remote/fs_read']}],
  machines:[{machineId:'machine',location:'local',status:'online',roots:[{rootId:'project',modes:['read-only'],capabilities:['remote-read']}]}],
  fundingScopes:[{id:'account',modes:['api'],models:[{provider:'fixture',model:'gpt-exact'}]}]})
function enabled(){return {...defaultBotSettings(),enabled:true,model:{provider:'fixture',model:'gpt-exact'},officialTools:[{toolId:'codex',cliModel:'gpt-exact',mode:'read-only'}],
  machineGrants:[{machineId:'machine',rootId:'project',mode:'read-only',capabilities:['remote-read']}],capabilities:['model'],workspaceRef:{kind:'local',machineId:'machine',rootId:'project'},
  funding:{mode:'api',scopeId:'account',pricing:{input:1,output:2},request:{maxInputTokens:10000,maxOutputTokens:1000},dailyBudgetUsd:1,monthlyBudgetUsd:20,subscription:null}}}
async function fixture(t,options={}){
  await mkdir(resolve('tmp/integration/bot-settings'),{recursive:true});const dir=await mkdtemp(resolve('tmp/integration/bot-settings/case-'))
  let current=catalog();const changes=[]
  const config={Database,file:join(dir,'settings.sqlite'),catalogFor:()=>current,botExists:id=>id==='bot-a',onCommitted:value=>changes.push(value),...options}
  const store=openBotSettings(config);t.after(()=>store.close())
  return {store,config,changes,catalog:value=>{current=value}}
}
const save=(f,settings=enabled(),expectedRevision=0,context=owner)=>f.store.save({botId:'bot-a',settings,expectedRevision},context)

test('Bot settings/native: owner CAS commits one closed binding and publishes scope only after persistence',async t=>{
  const f=await fixture(t)
  await assert.rejects(save(f,enabled(),0,{kind:'agent'}),/宿主拥有者/)
  const result=await save(f)
  assert.equal(result.revision,1);assert.equal(result.status,'available');assert.deepEqual(result.grant.modelRoutes,[{provider:'fixture',model:'gpt-exact'}])
  assert.ok(result.grant.tools.includes('cli/codex'));assert.ok(result.grant.tools.includes('remote/fs_read'))
  assert.equal(f.changes.length,1)
  const other=openBotSettings(f.config)
  try{await assert.rejects(other.save({botId:'bot-a',expectedRevision:0,settings:enabled()},owner),{code:'BOT_SETTINGS_CONFLICT'});assert.equal(other.get('bot-a').revision,1)}finally{other.close()}
})
test('Bot settings/native: arbitrary paths, unknown CLI identities, forged roots and missing API bounds never commit',async t=>{
  const f=await fixture(t)
  for(const alter of [s=>{s.executable='arbitrary'},s=>{s.officialTools[0].cliModel='gpt-other'},s=>{s.machineGrants[0].rootId='outside'},s=>{s.funding.request=null},s=>{s.funding.request.maxOutputTokens=0},s=>{s.model={provider:'other',model:'gpt-exact'}}]){
    const settings=enabled();alter(settings);await assert.rejects(save(f,settings));assert.equal(f.store.cached('bot-a'),null)
  }
  assert.equal(f.changes.length,0)
})
test('Bot settings/native: zero budgets are explicit zero, null stays unconfigured, and unsupported subscription is refused',async t=>{
  const f=await fixture(t),zero=enabled();zero.funding.dailyBudgetUsd=0;zero.funding.monthlyBudgetUsd=0
  const result=await save(f,zero);assert.equal(result.settings.funding.dailyBudgetUsd,0);assert.equal(result.settings.funding.monthlyBudgetUsd,0)
  const missing=enabled();missing.funding.dailyBudgetUsd=null;await assert.rejects(save(f,missing,1),{code:'BOT_SETTINGS_INCOMPLETE'})
  const subscription=enabled();subscription.funding={...subscription.funding,mode:'subscription',subscription:{dailyCalls:2,monthlyCalls:10}};await assert.rejects(save(f,subscription,1),{code:'BOT_SETTINGS_SCOPE_DENIED'})
})
test('Bot settings/native: lifecycle grant compilation is pure and refuses a DS model mismatch',async t=>{
  const f=await fixture(t);await save(f);f.changes.length=0
  assert.ok(f.store.grantFor({id:'bot-a',model:'fixture/gpt-exact'}).tools.includes('model/infer'))
  assert.deepEqual(f.store.grantFor({id:'bot-a',model:'fixture/gpt-other'}),{tools:[],modelRoutes:[]})
  assert.equal(f.changes.length,0,'compiling a not-yet-committed DS snapshot must not publish authority')
})
test('Bot settings/native: directory revocation publishes empty scope and pause/retirement remain possible offline',async t=>{
  const f=await fixture(t);await save(f)
  const reduced=catalog();reduced.machines=[];f.catalog(reduced)
  assert.deepEqual(f.store.get('bot-a').grant,{tools:[],modelRoutes:[]})
  assert.equal(f.changes.at(-1).status,'blocked')
  f.catalog(null)
  const paused=await save(f,{...enabled(),enabled:false},1)
  assert.equal(paused.revision,2);assert.equal(paused.status,'blocked');assert.deepEqual(paused.grant,{tools:[],modelRoutes:[]})
  const retired=await f.store.retire('bot-a',2,owner);assert.equal(retired.retired,true)
  await assert.rejects(save(f,enabled(),3),{code:'BOT_SETTINGS_CATALOG_UNAVAILABLE'})
})
test('Bot settings/native: callback failures require synchronous suspension; they never report a successful active grant',async t=>{
  let suspended=0
  const f=await fixture(t,{onCommitted:()=>{throw new Error('host callback failed')},onSuspended:value=>{suspended++;assert.deepEqual(value.grant,{tools:[],modelRoutes:[]})}})
  await assert.rejects(save(f),{code:'BOT_SETTINGS_PUBLISH_FAILED'});assert.equal(suspended,1)
  assert.equal(f.store.cached('bot-a').revision,1)
  assert.deepEqual(f.store.grantFor({id:'bot-a',model:'fixture/gpt-exact'}),{tools:[],modelRoutes:[]})
})
test('Bot settings/native: large legitimate model catalogs do not exceed the settings row limit',async t=>{
  const f=await fixture(t),large=catalog()
  large.models.push(...Array.from({length:1500},(_,i)=>({provider:'fixture',model:`gpt-listed-${i}-${'x'.repeat(50)}`})))
  f.catalog(large);const result=await save(f);assert.equal(result.catalog.models.length,1501);assert.equal(f.changes.length,1)
})
test('Bot settings/native: legacy migration is idempotent, disabled and preserves accurate model while refusing arbitrary workspace paths',async t=>{
  const f=await fixture(t),bots=[{id:'bot-a',model:'fixture/gpt-exact',workDir:'unmapped-private-path'}]
  assert.deepEqual(await f.store.migrateLegacyBots(bots,owner),{created:['bot-a'],existing:[]})
  const value=f.store.get('bot-a');assert.equal(value.settings.enabled,false);assert.equal(value.settings.workspaceRef,null);assert.equal(value.settings.model.model,'gpt-exact')
  assert.deepEqual(value.grant,{tools:[],modelRoutes:[]});assert.equal(JSON.stringify(value).includes('unmapped-private-path'),false)
  assert.deepEqual(await f.store.migrateLegacyBots(bots,owner),{created:[],existing:['bot-a']});assert.equal(f.store.get('bot-a').revision,1)
})
