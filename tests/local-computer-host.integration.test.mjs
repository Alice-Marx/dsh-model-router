import './helpers/ui-dom-bootstrap.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'

const parent=resolve('tmp/integration/local-computer-ui');await mkdir(parent,{recursive:true})
const directory=await mkdtemp(join(parent,'case-')),file=join(directory,'ui.mjs')
const bundled=await build({entryPoints:['apps/integration-client/local-computer-host.jsx'],bundle:true,platform:'node',format:'esm',external:['react','react-dom'],write:false})
await writeFile(file,bundled.outputFiles[0].contents)
const {LocalComputerHost}=await import(pathToFileURL(file))
const defaults={name:'Target',listenAddress:'127.0.0.1',port:9781,sharedDirectory:'C:/FixtureShare',allowWrite:false,allowDesktop:true}
const status=(over={})=>({state:'disabled',revision:0,config:null,desktopSupported:true,addresses:['127.0.0.1'],defaults,...over})
const invitation=()=>({code:'654321',invite:{token:'fixture-private-invite',expiresAt:Date.now()+120000,transport:{fingerprint:'fixture-fingerprint'}},qrDataUrl:'data:image/png;base64,AA=='})
async function fixture(t){
  const dom=new JSDOM('<div id="root"></div>',{url:'http://local-computer.fixture/'})
  const replacements={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true}
  const previous=Object.fromEntries(Object.keys(replacements).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]))
  for(const [key,value]of Object.entries(replacements))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true})
  const {createRoot}=await import('react-dom/client'),container=document.getElementById('root'),root=createRoot(container)
  const settle=work=>act(async()=>{await work();await new Promise(setImmediate)})
  const render=props=>settle(()=>root.render(React.createElement(LocalComputerHost,{snapshot:{availableActions:['machine.host.status']},...props})))
  const click=label=>settle(()=>{const button=[...container.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(button,label);button.click()})
  const type=(label,value)=>settle(()=>{const input=container.querySelector(`[aria-label="${label}"]`);Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}))})
  t.after(async()=>{await settle(()=>root.unmount());dom.window.close();for(const [key,value]of Object.entries(previous))if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]})
  return {container,render,click,type,settle}
}

test('opening the computer panel only reads state; save uses the edited owner draft and prevents duplicate mutation',async t=>{
  const f=await fixture(t),calls=[];let release,view=status()
  const transport=async(action,payload)=>{calls.push({action,payload});if(action==='machine.host.status')return view;if(action==='machine.host.devices')return {items:[]};if(action==='machine.host.configure'){await new Promise(r=>{release=r});view=status({state:'running',revision:1,listening:true,config:{...payload,endpoint:'http://127.0.0.1:9781'}});return view}throw Error(action)}
  await f.render({transport,dispatch:()=>assert.fail('local polling must not refresh the entire workspace')})
  assert.deepEqual(calls.map(x=>x.action),['machine.host.status'])
  await f.type('本机名称','My target');await f.type('本机共享文件夹','C:/OwnerShare')
  await f.click('保存并开启远程访问')
  assert.equal(calls[1].payload.name,'My target');assert.equal(calls[1].payload.sharedDirectory,'C:/OwnerShare');assert.equal(calls[1].payload.expectedRevision,0);assert.equal(calls[1].payload.enabled,true)
  await f.click('正在开启…');assert.equal(calls.filter(x=>x.action==='machine.host.configure').length,1)
  await f.settle(()=>release());assert.match(f.container.textContent,/远程访问已开启/)
  assert.equal(f.container.querySelector('[aria-label="本机连接地址"]').value,'','an automatic endpoint continues following the selected network interface')
})

test('confirmation code stays separate from exported invite and Host replacement clears all old pairing secrets',async t=>{
  const f=await fixture(t),running=status({state:'running',revision:2,listening:true,config:{...defaults,endpoint:'http://127.0.0.1:9781',enabled:true}})
  const transport=async action=>action==='machine.host.status'?running:action==='machine.host.devices'?{items:[]}:invitation()
  await f.render({transport});await f.click('生成两分钟配对邀请')
  assert.match(f.container.textContent,/654321/)
  const exported=JSON.parse(f.container.querySelector('textarea').value);assert.equal(exported.code,undefined);assert.equal(exported.token,'fixture-private-invite')
  await f.render({transport:async()=>status()})
  assert.doesNotMatch(f.container.textContent,/654321|fixture-fingerprint/);assert.equal(f.container.querySelector('textarea'),null)
})

test('a late invitation reply cannot appear after changing to another Host; failed saves preserve the draft',async t=>{
  const f=await fixture(t);let finish
  const transport=async action=>action==='machine.host.status'?status({state:'running',revision:1,listening:true,config:{...defaults,enabled:true}}):action==='machine.host.devices'?{items:[]}:new Promise(r=>{finish=r})
  await f.render({transport});await f.click('生成两分钟配对邀请')
  const next=async action=>{if(action==='machine.host.status')return status();throw Object.assign(Error('conflict'),{code:'LOCAL_COMPUTER_CONFLICT'})}
  await f.render({transport:next});await f.settle(()=>finish(invitation()))
  assert.doesNotMatch(f.container.textContent,/654321/)
  await f.type('本机名称','Unsaved owner name');await f.click('保存并开启远程访问')
  assert.match(f.container.textContent,/其他窗口修改/);assert.equal(f.container.querySelector('[aria-label="本机名称"]').value,'Unsaved owner name')
})
