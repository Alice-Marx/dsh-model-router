import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {JSDOM} from 'jsdom'
import React,{act} from 'react'

const parent=resolve('tmp/integration/contact-attention');await mkdir(parent,{recursive:true})
const directory=await mkdtemp(join(parent,'case-')),file=join(directory,'ui.mjs')
const bundle=await build({entryPoints:['apps/integration-client/contact-attention.jsx'],bundle:true,platform:'node',format:'esm',external:['react','react-dom'],write:false,loader:{'.css':'text'}})
await writeFile(file,bundle.outputFiles[0].contents)
const {contactAttention,notificationAttention,ContactAttentionNavigation}=await import(pathToFileURL(file))
const snapshot=(n,partial=false)=>({schemaVersion:1,bots:[],tasks:{status:'available',truncated:partial,items:Array.from({length:n},(_,i)=>({id:`task-${i}`,botId:'bot-a',state:'waiting-approval'}))}})

test('contact count uses loaded committed tasks, and unavailable projections do not claim zero outstanding work',()=>{
  assert.deepEqual(contactAttention(snapshot(3,true)),{known:true,count:3,partial:true})
  assert.deepEqual(contactAttention({...snapshot(3),tasks:{status:'blocked',items:snapshot(3).tasks.items}}),{known:false,count:0,partial:false})
  assert.deepEqual(contactAttention({...snapshot(3),schemaVersion:2}),{known:false,count:0,partial:false})
  assert.deepEqual(contactAttention(snapshot(0)),{known:true,count:0,partial:false})
})

test('notification unread status stays separate from the count of tasks needing attention', async t => {
  assert.deepEqual(notificationAttention(snapshot(1)), { known: false, count: 0, partial: false })
  assert.deepEqual(notificationAttention({ ...snapshot(1), notifications: { status: 'available', unreadCount: -1 } }), { known: false, count: 0, partial: false })
  const f = await fixture(t)
  await f.render({ attention: async () => ({ ...snapshot(2), notifications: { status: 'available', unreadCount: 4, truncated: true } }) })
  assert.equal(f.badge(), '2')
  const summary = document.querySelector('.bp-contact-resources summary')
  assert.match(summary.getAttribute('aria-label'), /至少 4 条未读通知/)
  await f.settle(() => summary.click())
  const button = [...document.querySelectorAll('.bp-contact-resources-menu button')].find(node => node.textContent.includes('通知中心'))
  await f.settle(() => button.click())
  assert.deepEqual(f.opened, [{ section: 'notifications' }])
})

async function fixture(t){
  const dom=new JSDOM('<div id="root"></div>',{url:'http://attention.fixture/',pretendToBeVisual:true})
  const values={window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true}
  const previous=Object.fromEntries(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]))
  for(const [key,value] of Object.entries(values))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true})
  const {createRoot}=await import('react-dom/client'),root=createRoot(document.getElementById('root'))
  const settle=fn=>act(async()=>{await fn();await new Promise(setImmediate)})
  const opened=[]
  const render=api=>settle(()=>root.render(React.createElement(ContactAttentionNavigation,{productApi:api,onNavigate:input=>opened.push(input)})))
  const hidden=value=>settle(()=>{Object.defineProperty(document,'hidden',{value,configurable:true});document.dispatchEvent(new dom.window.Event('visibilitychange'))})
  const button=()=>document.querySelector('[data-contact-nav="inbox"]')
  const badge=()=>document.querySelector('.bp-contact-attention')?.textContent
  t.after(async()=>{await act(()=>root.unmount());dom.window.close();for(const [key,value]of Object.entries(previous)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]}})
  return {render,settle,hidden,button,badge,opened}
}

test('native contact footer displays the real lower bound and its button only opens the inbox',async t=>{
  const f=await fixture(t),reads=[],writes=[]
  await f.render({attention:async signal=>{reads.push(signal);return snapshot(2,true)},dispatch:(...args)=>writes.push(args)})
  assert.equal(reads.length,1);assert.equal(f.badge(),'2+');assert.match(f.button().getAttribute('aria-label'),/至少 2.*仅统计已加载任务/)
  await f.settle(()=>f.button().click());assert.deepEqual(f.opened,[{section:'inbox'}]);assert.equal(writes.length,0)
})

test('replacing a Host aborts its pending read and a late result cannot change the new Host badge',async t=>{
  const f=await fixture(t);let oldSignal,finish
  await f.render({attention:signal=>{oldSignal=signal;return new Promise(resolve=>{finish=resolve})}})
  const next={attention:async()=>snapshot(1)};await f.render(next)
  assert.equal(oldSignal.aborted,true);assert.equal(f.badge(),'1')
  await f.settle(()=>finish(snapshot(7)));assert.equal(f.badge(),'1')
})

test('hidden windows stop reading, abort pending requests, and discard late results before refreshing on visibility',async t=>{
  const f=await fixture(t),reads=[];let finish
  await f.hidden(true)
  await f.render({attention:signal=>{reads.push(signal);return reads.length===1?new Promise(resolve=>{finish=resolve}):Promise.resolve(snapshot(1))}})
  assert.equal(reads.length,0)
  await f.hidden(false);assert.equal(reads.length,1)
  await f.hidden(true);assert.equal(reads[0].aborted,true)
  await f.settle(()=>finish(snapshot(6)));assert.equal(f.badge(),undefined)
  await f.hidden(false);assert.equal(reads.length,2);assert.equal(f.badge(),'1')
})

test('a failed read clears the previous badge without leaking server errors into contact navigation',async t=>{
  const f=await fixture(t);let reads=0
  await f.render({attention:async()=>{if(++reads===1)return snapshot(2);throw new Error('private diagnostic detail')}})
  assert.equal(f.badge(),'2')
  await f.hidden(true);await f.hidden(false)
  assert.equal(f.badge(),undefined);assert.match(f.button().title,/状态尚未更新/)
  assert.doesNotMatch(document.body.textContent,/private diagnostic/)
})
