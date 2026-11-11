import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir,mkdtemp,writeFile } from 'node:fs/promises'
import { join,resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import React,{act} from 'react'
import { JSDOM } from 'jsdom'

const parent=resolve('tmp/integration/product-slots');await mkdir(parent,{recursive:true})
const directory=await mkdtemp(join(parent,'case-'))
const bundle=await build({entryPoints:['apps/integration-client/product-slots.jsx'],bundle:true,platform:'node',format:'esm',external:['react','react-dom'],write:false,loader:{'.css':'text'}})
const file=join(directory,'slots.mjs');await writeFile(file,bundle.outputFiles[0].contents)
const {createProductSlots}=await import(pathToFileURL(file))

test('header injection preserves the exact component, native navigation store and action identity while adding conversation context',()=>{
  const records=[],api={},opened=[],nativeActions={showDetails(){}},hooks={},store={value:'native-navigation'}
  const slots={register(options,component){records.push({options,component});return 'registration'},entries(){assert.equal(this,slots);return records}}
  const proxy=createProductSlots(slots,id=>opened.push(id),api,()=>null)
  const Header=()=>null
  const options={name:'conversation.session.header',store,priority:100,inject:session=>({actions:nativeActions,hooks,session})}
  assert.equal(proxy.register(options,Header),'registration')
  assert.equal(records[0].component,Header);assert.equal(records[0].options.store,store);assert.equal(proxy.entries(),records)
  const face=records[0].options.inject('original-part')
  assert.equal(face.hooks,hooks);assert.equal(face.session,'original-part');assert.equal(face.actions.showDetails,nativeActions.showDetails)
  assert.equal(Object.hasOwn(nativeActions,'conversationAddon'),false)
  const addon=face.actions.conversationAddon({sessionId:'original-part',bot:{id:'bot-a'}})
  assert.equal(addon.props.sessionId,'original-part');assert.equal(addon.props.bot.id,'bot-a')
  addon.props.onNavigate({section:'library',botId:'bot-a'})
  assert.deepEqual(opened,['bot-product-library'])
  assert.equal(typeof addon.props.onNavigate,'function')
})

test('native contacts remain in place and only their supporting footer is replaced, with drawer-close and advanced callbacks',async t=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://slots.fixture/'})
  const previous=Object.fromEntries(['window','document','IS_REACT_ACT_ENVIRONMENT'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]))
  for(const [key,value]of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true})
  const {createRoot}=await import('react-dom/client'),root=createRoot(document.getElementById('root')),records=[],opened=[],drawers=[]
  t.after(async()=>{await act(()=>root.unmount());dom.window.close();for(const [key,value]of Object.entries(previous)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]}})
  const Team=({actions})=>React.createElement('aside',null,React.createElement('div',{className:'native-contacts'},'Native Bot list'),React.createElement(actions.sidebarAddon,{wide:true}))
  const proxy=createProductSlots({register:(options,component)=>records.push({options,component})},id=>opened.push(id),{},Team)
  proxy.register({name:'sidebar.workspaces'},Team)
  assert.equal(records[0].component.dsBotTeamSidebar,Team)
  await act(()=>root.render(React.createElement(records[0].component,{actions:{setLeftDrawer:value=>drawers.push(value)}})))
  assert.ok(document.querySelector('.native-contacts'))
  assert.equal(document.querySelectorAll('.bp-contact-nav').length,1);assert.equal(document.querySelectorAll('.bp-nav').length,0)
  const button=label=>[...document.querySelectorAll('button')].find(value=>value.textContent===label)
  await act(async()=>{button('待办').click();await new Promise(setImmediate)});assert.deepEqual(opened,['bot-product-inbox']);assert.deepEqual(drawers,[false])
  await act(async()=>{button('高级工作台').click();await new Promise(setImmediate)});assert.equal(opened.at(-1),'model-router-galgame')
})
