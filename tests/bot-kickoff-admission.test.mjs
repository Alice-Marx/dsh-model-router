import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { withProductIndependent } from './helpers/product-independent-composition.mjs'
import { botModelStatus } from '../apps/integration-client/bot-model-status.mjs'

const parent=resolve('tmp/integration/kickoff-admission')
await mkdir(parent,{recursive:true})
const folder=await mkdtemp(join(parent,'case-'))
const sourceDir=resolve('modules/bot-runtime/vendor/ds-bot/src/host')
const compiled=await build({stdin:{contents:await readFile(join(sourceDir,'roster.js'),'utf8'),resolveDir:sourceDir,sourcefile:'roster.js'},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'})
const entry=join(folder,'roster.mjs');await writeFile(entry,compiled.outputFiles[0].contents)
const {install}=await import(pathToFileURL(entry))
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate)}

function roster({guard=true,wait=async()=>{}}={}){
  let ready=false,id=0
  const delivered=[],saved=[],applied=[]
  const state={workspaceId:'workspace',bots:{},mainBotIds:[],rooms:{},agents:{}}
  const rt={state,defaults:{},ctx:{workspaceRegistry:{get:()=>({}),archiveSession:async()=>{}},sessionController:{create:async()=>({sessionId:'new-'+(++id)})},sessionTitle:{rename:async()=>{}},get:()=>undefined},
    readOnly:()=>undefined,teamFolder:()=>undefined,resolveAgent:async sessionId=>({session:{id:sessionId}}),
    resolveModel:async value=>value,defaultBotModel:async()=> 'fixture/model',resolveEffort:async()=>undefined,defaultEffort:async()=>undefined,
    botOf:id=>state.bots[id],findBot:name=>Object.values(state.bots).find(bot=>bot.name===name),
    save:async()=>saved.push(structuredClone(state)),chatOwners:new Map(),chatOf:id=>id,
    waitForModel:wait,applyModel:async bot=>applied.push(bot.id),
    deliver:async value=>delivered.push(value),warn:()=>{},uiLanguage:()=> 'en',
    isMain:id=>state.mainBotIds.includes(id)}
  if(guard)rt.kickoffReady=()=>ready
  install(rt)
  return {rt,state,delivered,saved,applied,setReady:value=>{ready=value}}
}

test('creating a selected-model Bot holds its first greeting until owner readiness is committed',async()=>{
  const f=roster()
  const bot=await f.rt.createBot({name:'Acceptance',model:'fixture/model'})
  await settle()
  assert.ok(bot.kickoff)
  assert.equal(f.saved.at(-1).bots[bot.id].kickoff.text,bot.kickoff.text)
  assert.deepEqual(f.delivered,[])
  assert.deepEqual(f.applied,[])
  assert.equal(await f.rt.releaseKickoff(bot),false)
  f.setReady(true)
  assert.equal(await f.rt.releaseKickoff(bot),true)
  assert.equal(await f.rt.releaseKickoff(bot),false)
  await settle()
  assert.equal(f.delivered.length,1)
  assert.equal(f.delivered[0].role,'kickoff')
  assert.equal(bot.kickoff,undefined)
})

test('revocation while a greeting waits for its provider restores the held greeting and dispatches nothing',async()=>{
  let release
  const f=roster({wait:()=>new Promise(resolve=>{release=resolve})})
  const bot=await f.rt.createBot({name:'Revocation',model:'fixture/model'})
  f.setReady(true)
  assert.equal(await f.rt.releaseKickoff(bot),true)
  f.setReady(false);release();await settle()
  assert.deepEqual(f.delivered,[])
  assert.ok(bot.kickoff)
  assert.ok(f.saved.at(-1).bots[bot.id].kickoff)
})

test('the standalone upstream roster retains its selected-model greeting without a product gate',async()=>{
  const f=roster({guard:false})
  await f.rt.createBot({name:'Standalone',model:'fixture/model'})
  await settle();assert.equal(f.delivered.length,1)
})

test('actual product kickoff readiness requires committed route, model inference and funding even for Main',async()=>{
  await withProductIndependent(async({product,bind,dispatch})=>{
    assert.equal(product.rt.kickoffReady(product.rt.botOf('a')),false,'Main authority alone cannot supply a missing funding binding')
    assert.equal(product.rt.kickoffReady(product.rt.botOf('b')),false)
    await bind('b','beta','vendor/two')
    assert.equal(product.rt.kickoffReady(product.rt.botOf('b')),true)
    assert.equal(product.rt.kickoffReady({...product.rt.botOf('b'),model:'alpha/one'}),false)
    const view=await dispatch('binding.inspect',{botId:'b'})
    await dispatch('binding.save',{botId:'b',expectedRevision:view.record.revision,settings:{...view.record.settings,capabilities:[]}})
    assert.equal(product.rt.kickoffReady(product.rt.botOf('b')),false)
    await bind('a','alpha','one')
    assert.equal(product.rt.kickoffReady(product.rt.botOf('a')),true)
  })
})

test('binding save releases a held greeting once only after the real composition refreshes authority and funding',async()=>{
  await withProductIndependent(async({product,bind,dispatch})=>{
    const delivered=[]
    product.rt.deliver=async value=>delivered.push(value)
    const bot=product.rt.botOf('b');bot.kickoff={text:'Synthetic greeting',from:null}
    await product.rt.save()
    const disabled=await dispatch('binding.inspect',{botId:'b'})
    await dispatch('binding.save',{botId:'b',expectedRevision:disabled.record.revision,settings:disabled.record.settings})
    await settle();assert.deepEqual(delivered,[]);assert.ok(bot.kickoff)
    await bind('b','beta','vendor/two');await settle()
    assert.equal(delivered.length,1);assert.equal(bot.kickoff,undefined)
    await bind('b','beta','vendor/two');await settle();assert.equal(delivered.length,1)
  })
})

test('pending setup directs the owner to settings while retaining the exact selected model',()=>{
  const value=botModelStatus({model:'fixture/model',setupPending:true})
  assert.equal(value.label,'完成 Bot 设置')
  assert.equal(value.selected,'fixture/model')
  assert.match(value.title,/权限与资金绑定/)
  assert.equal(botModelStatus({model:'fixture/model'}).label,'fixture/model')
})
