import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir,mkdtemp,writeFile } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React,{act} from 'react'
import { generateKeyPair,b64u,sha256 } from '../modules/openmaus-protocol/index.mjs'

const parent=resolve('tmp/integration/secure-pairing-ui');await mkdir(parent,{recursive:true})
const directory=await mkdtemp(join(parent,'case-')),file=join(directory,'ui.mjs')
const bundle=await build({entryPoints:['apps/integration-client/secure-pairing.jsx'],bundle:true,platform:'node',format:'esm',external:['react','react-dom'],write:false})
await writeFile(file,bundle.outputFiles[0].contents)
const {SecurePairingSetup}=await import(pathToFileURL(file))
const key=generateKeyPair().publicKey
const invite=()=>({format:'dsh-pairing-invite',version:2,inviteId:'invite-fixture',machineId:'machine-fixture',clientId:'host-a',name:'Fixture computer',endpoint:'http://127.0.0.1:9701',expiresAt:Date.now()+120000,
  token:'dsh_pair_'+'t'.repeat(43),code:'123456',transport:{kind:'noise-v1',publicKey:b64u(key),fingerprint:sha256(key).toString('hex')},ceiling:{botIds:['bot-a'],roots:['project'],tools:['machine_ping']}})
async function domCase(t){
  const dom=new JSDOM('<div id="root"></div>',{url:'http://pairing.fixture/'})
  const replacements={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true}
  const previous=Object.fromEntries(Object.keys(replacements).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]))
  for(const [key,value]of Object.entries(replacements))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true})
  const {createRoot}=await import('react-dom/client'),container=document.getElementById('root'),root=createRoot(container)
  const settle=work=>act(async()=>{await work();await new Promise(setImmediate)})
  const render=props=>settle(()=>root.render(React.createElement(SecurePairingSetup,{snapshot:{mainBotId:'bot-a',bots:[{id:'bot-a'}],machines:{items:[]},availableActions:['machine.pair.invite']},...props})))
  const type=(selector,value)=>settle(()=>{const element=container.querySelector(selector),proto=element.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);element.dispatchEvent(new dom.window.Event('input',{bubbles:true}))})
  const click=label=>settle(()=>{const element=[...container.querySelectorAll('button')].find(button=>button.textContent===label);assert.ok(element,label);element.click()})
  t.after(async()=>{await act(()=>root.unmount());dom.window.close();for(const [key,value]of Object.entries(previous)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]}})
  const importFile=file=>settle(()=>{const input=container.querySelector('input[type="file"][accept=".json,application/json"]');Object.defineProperty(input,'files',{value:[file],configurable:true});input.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})
  return {container,render,type,click,importFile,settle}
}

test('secure pairing UI previews identity and scope without automatic requests and only redeems after the owner clicks',async t=>{
  const f=await domCase(t),calls=[]
  await f.render({dispatch:async(...args)=>{calls.push(args);return {machineId:'machine-fixture',mainBinding:{status:'available'}}}})
  await f.type('textarea',JSON.stringify(invite()))
  assert.equal(calls.length,0);assert.match(f.container.textContent,/Fixture computer/);assert.match(f.container.textContent,/project/)
  assert.equal(f.container.querySelector('input[inputmode="numeric"]').value,'')
  await f.type('input[inputmode="numeric"]','123456')
  await f.click('验证并配对')
  assert.equal(calls.length,1);assert.equal(calls[0][0],'machine.pair.invite');assert.equal(calls[0][1].probeBotId,'bot-a')
  assert.deepEqual(calls[0][2],{errorResult:true});assert.match(calls[0][1].requestId,/^[a-f0-9]{32}$/)
  assert.equal(f.container.querySelector('textarea').value,'');assert.match(f.container.textContent,/已验证设备/)
})

test('lost redemption response keeps the original frozen intent and uses a manual continuation without repeating secret or pair operations',async t=>{
  const f=await domCase(t),calls=[]
  await f.render({dispatch:async(action,payload)=>{calls.push({action,payload:structuredClone(payload)});return calls.length===1?{ok:false,error:{code:'PAIRING_RESULT_UNKNOWN'}}:{machineId:'machine-fixture',mainBinding:{status:'available'}}}})
  await f.type('textarea',JSON.stringify(invite()));await f.type('input[inputmode="numeric"]','123456');await f.click('验证并配对')
  assert.match(f.container.textContent,/兑换结果尚未确认/);assert.equal(f.container.querySelector('textarea').disabled,true)
  assert.equal(f.container.querySelector('input[inputmode="numeric"]').disabled,true);assert.equal(calls.length,1)
  await f.click('继续核对原配对')
  assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(f.container.querySelector('textarea').value,'')
})

test('wrong code may be corrected under a fresh request; unavailable or unrelated Bot scope cannot redeem',async t=>{
  const f=await domCase(t),calls=[]
  await f.render({dispatch:async(action,payload)=>{calls.push(payload);return {ok:false,error:{code:'PAIRING_CODE_INVALID'}}}})
  await f.type('textarea',JSON.stringify(invite()));await f.type('input[inputmode="numeric"]','123456');await f.click('验证并配对')
  assert.equal(f.container.querySelector('input[inputmode="numeric"]').disabled,false)
  await f.type('input[inputmode="numeric"]','654321');await f.click('验证并配对')
  assert.equal(calls.length,2);assert.notEqual(calls[0].requestId,calls[1].requestId);assert.equal(calls[1].code,'654321')
  await f.type('textarea',JSON.stringify({...invite(),ceiling:{botIds:['other'],roots:['project'],tools:['machine_ping']}}))
  assert.match(f.container.textContent,/当前主 Bot 不在目标电脑允许的范围内/)
  assert.equal([...f.container.querySelectorAll('button')].find(button=>button.textContent==='验证并配对').disabled,true)
})

test('large invitation files are not read and a delayed import cannot replace a newer edit or completed pairing',async t=>{
  const f=await domCase(t),calls=[]
  await f.render({dispatch:async(...args)=>{calls.push(args);return {mainBinding:{status:'available'}}}})
  let reads=0,finish
  await f.importFile({size:16385,text:async()=>{reads++;return JSON.stringify(invite())}})
  assert.equal(reads,0);assert.match(f.container.textContent,/超过 16 KB/)
  await f.importFile({size:100,text:()=>new Promise(resolve=>{finish=resolve})})
  await f.type('textarea','a newer draft')
  await f.settle(()=>finish(JSON.stringify(invite())))
  assert.equal(f.container.querySelector('textarea').value,'a newer draft')
  await f.type('textarea',JSON.stringify(invite()));await f.type('input[inputmode="numeric"]','123456')
  await f.importFile({size:100,text:()=>new Promise(resolve=>{finish=resolve})})
  await f.click('验证并配对');assert.equal(calls.length,1)
  await f.settle(()=>finish(JSON.stringify(invite())))
  assert.equal(f.container.querySelector('textarea').value,'');assert.match(f.container.textContent,/已验证设备/)
})
