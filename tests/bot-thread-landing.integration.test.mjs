import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'

// Exercise the shipped sidebar's actual navigation effect, not a replacement
// policy. The previous thread tests mounted only the header and missed this
// second navigation actor redirecting a thread back to its Bot's default chat.
const sidebar = resolve('modules/bot-runtime/vendor/ds-bot/src/client/sidebar.js')
const parent = resolve('tmp/integration/bot-thread-landing')
await mkdir(parent, {recursive:true})
const directory = await mkdtemp(join(parent, 'case-'))
const file = join(directory, 'sidebar.mjs')
// Mount the unmodified hook body without importing unrelated visual components
// and their optional Host UI packages. Both dependencies are the real exports.
const source = await readFile(sidebar,'utf8')
const start = source.indexOf('function useLandOnMainBot(')
const end = source.indexOf('\nexport function FooterAccount',start)
assert.ok(start>=0&&end>start,'The shipped sidebar navigation hook must be found')
await writeFile(file,`import { useEffect, useRef } from 'react';\nimport { currentPart } from ${JSON.stringify(pathToFileURL(resolve('modules/bot-runtime/vendor/ds-bot/src/client/text.js')).href)};\n${source.slice(start,end)}\nexport { useLandOnMainBot };\n`)
const {useLandOnMainBot} = await import(pathToFileURL(file))

test('the native sidebar keeps a Bot thread, including an empty or archived thread, selected', async t => {
  const dom = new JSDOM('<div id="root"></div>',{url:'http://landing.fixture/'})
  const saved = Object.fromEntries(['window','document','IS_REACT_ACT_ENVIRONMENT'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]))
  Object.defineProperties(globalThis,{window:{value:dom.window,writable:true,configurable:true},document:{value:dom.window.document,writable:true,configurable:true},IS_REACT_ACT_ENVIRONMENT:{value:true,writable:true,configurable:true}})
  const {createRoot} = await import('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  t.after(async()=>{await act(()=>root.unmount());dom.window.close();for(const [key,value] of Object.entries(saved)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key]}})
  const worker={id:'worker',sessionId:'worker-default',parts:[],name:'Acceptance Bot'}
  const main={id:'chief',sessionId:'chief',parts:[],name:'Main'}
  const roster={ready:true,mainBotId:'chief',byId:{chief:main,'worker-default':worker,'thread-session':worker},threadsById:{'thread-session':{botId:'worker',threadId:'thread-1',sessionId:'thread-session'}},roomsById:{},agentOf:{}}
  const landings=[]
  const actions={landOn:(...args)=>landings.push(args),openSession:id=>landings.push(['open',id])}
  function Probe({sessionId,blank}){
    useLandOnMainBot(roster,select=>select({byId:{[sessionId]:{id:sessionId,blank,retainedBy:{mainView:1}}}}),actions)
    return null
  }
  for(const blank of [true,false]){
    await act(()=>root.render(React.createElement(Probe,{sessionId:'thread-session',blank})))
    assert.deepEqual(landings,[],'Opening a confirmed thread must not land on the Bot default or Main')
  }
  roster.threadsById['thread-session'].archivedAt=123
  await act(()=>root.render(React.createElement(Probe,{sessionId:'thread-session',blank:true})))
  assert.deepEqual(landings,[],'An archived thread remains a history destination')
  // Preserve the pre-existing rollover behavior for the Bot's own old part.
  roster.byId['old-part']=worker
  await act(()=>root.render(React.createElement(Probe,{sessionId:'old-part',blank:false})))
  assert.deepEqual(landings,[['worker']])
})
