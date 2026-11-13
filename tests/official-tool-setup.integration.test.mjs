import test from 'node:test'
import assert from 'node:assert/strict'
import React,{act} from 'react'
import {JSDOM} from 'jsdom'
import {build} from 'esbuild'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
const parent=resolve('tmp/integration/official-tool-setup');await mkdir(parent,{recursive:true});const directory=await mkdtemp(join(parent,'case-')),file=join(directory,'setup.mjs')
const bundle=await build({entryPoints:['apps/integration-client/official-tool-setup.jsx'],bundle:true,platform:'node',format:'esm',external:['react','react-dom'],write:false,loader:{'.css':'text'}});await writeFile(file,bundle.outputFiles[0].contents)
const {OfficialToolSetup}=await import(pathToFileURL(file))
const entry={executable:'C:\\Tools\\step.exe',version:'0.1.7'}
function fixture(handler){const calls=[];return {calls,async dispatch(action,payload,signal){calls.push({action,payload:structuredClone(payload),signal});const value=handler?.(action,payload,signal);if(value!==undefined)return value
 if(action==='cliProviders.setup')return {schemaVersion:1,toolId:payload.toolId,label:'Step Code',driver:'stepAgent',entry,billing:'subscription',loginCommand:'step login',modelHint:'step/模型名',reason:'原生聊天路线'}
 if(action==='cliProviders.repair')return {toolId:payload.toolId,job:payload.operation==='start'?{status:'running',id:'fixture-job'}:null}
 if(action==='cliProviders.list')return {schemaVersion:1,drivers:[{id:'stepAgent',name:'Step Code',implemented:true,available:true,hostTools:false}],profiles:[]}
 if(action==='cliProviders.inspect')return {versionVerified:true,entry:payload.entry}
 if(action==='cliProviders.save')return {id:'fixture-connection',revision:1}
 throw Error('Unexpected '+action)
}}}
async function withDom(work){const dom=new JSDOM('<div id="root"></div>',{url:'http://setup.fixture/'}),previous={}
 for(const [key,value]of Object.entries({window:dom.window,document:dom.window.document,Element:dom.window.Element,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){previous[key]=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true,writable:true})}
 const {createRoot}=await import('react-dom/client'),root=createRoot(document.getElementById('root')),container=document.getElementById('root')
 const flush=async()=>act(async()=>{await new Promise(setImmediate);await new Promise(setImmediate)})
 const render=async api=>{await act(async()=>{root.render(React.createElement(OfficialToolSetup,{productApi:api,toolId:'stepcode'}));await new Promise(setImmediate)});await flush()}
 const field=label=>container.querySelector(`[aria-label="${label}"]`)
 const click=async label=>{const button=[...container.querySelectorAll('button')].find(item=>item.textContent.trim()===label);assert.ok(button,label);assert.equal(button.disabled,false);await act(async()=>{button.click();await new Promise(setImmediate)});await flush()}
 const fill=async(label,value)=>act(async()=>{const input=field(label);Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await new Promise(setImmediate)})
 try{await work({container,render,field,click,fill,flush})}finally{await act(()=>root.unmount());dom.window.close();for(const [key,value]of Object.entries(previous))if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]}
}
test('tool setup prefills only the detected entry, and repair/re-detection cannot overwrite unsaved model or account choices',async()=>{
 await withDom(async({render,field,click,fill,container})=>{const api=fixture();await render(api)
  assert.equal(field('CLI 可执行文件路径').value,entry.executable);assert.equal(field('CLI 模型 ID').value,'');assert.equal(field('CLI 登录资料 JSON').value,'');assert.equal(field('使用本机已登录账号').checked,false)
  assert.equal(api.calls.some(call=>call.action==='cliProviders.save'||call.payload?.operation==='start'),false)
  await fill('CLI 模型 ID','step/owner-model');await fill('CLI 登录资料 JSON','unsaved-secret-fixture')
  await click('检测入口');assert.equal(field('CLI 模型 ID').value,'step/owner-model');assert.equal(field('CLI 登录资料 JSON').value,'unsaved-secret-fixture')
  await click('安装/修复 CLI');assert.deepEqual(api.calls.find(call=>call.payload?.operation==='start').payload,{toolId:'stepcode',operation:'start'})
  assert.match(container.textContent,/安装正在进行/);assert.equal(field('CLI 模型 ID').value,'step/owner-model')
 })
})
test('configuration save is explicit and does not bind a Bot, grant tools or start a model request',async()=>{
 await withDom(async({render,field,click,fill})=>{const api=fixture();await render(api);await fill('CLI 模型 ID','step/owner-model');await click('保存 CLI 聊天连接')
  const save=api.calls.find(call=>call.action==='cliProviders.save');assert.equal(save.payload.driver,'stepAgent');assert.equal(save.payload.model,'step/owner-model');assert.deepEqual(save.payload.entry,entry)
  assert.equal(Object.hasOwn(save.payload,'importLocalAccount'),false);assert.equal(api.calls.some(call=>/^binding\.|chat|model.*run/.test(call.action)),false)
 })
})
test('changing Host drops a secret draft and late old setup/status results cannot affect the new Host',async()=>{
 await withDom(async({render,fill,field,flush})=>{let resolveStatus;const old=fixture((action)=>action==='cliProviders.repair'?new Promise(resolve=>{resolveStatus=resolve}):undefined),current=fixture();await render(old);await fill('CLI 登录资料 JSON','old-private-draft');await render(current)
  assert.equal(field('CLI 登录资料 JSON').value,'');assert.ok(old.calls.find(call=>call.action==='cliProviders.repair').signal.aborted)
  resolveStatus({toolId:'stepcode',job:{status:'failed',error:'old-error'}});await flush();assert.doesNotMatch(document.body.textContent,/old-error|old-private-draft/)
 })
})
