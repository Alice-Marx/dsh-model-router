import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

const parent = resolve('tmp/integration/desktop-viewer-adaptive'); await mkdir(parent, { recursive: true })
const dir = await mkdtemp(join(parent, 'run-')), compiled = join(dir, 'viewer.mjs')
await build({ entryPoints: ['apps/integration-client/desktop-pane.jsx'], outfile: compiled, bundle: true, platform: 'node', format: 'esm', external: ['react'] })
const { DesktopViewer } = await import(pathToFileURL(compiled))

test('a reduced JPEG maps a real canvas pointer to physical monitor pixels', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' }), globals = ['window','document','Element','HTMLElement','WebSocket','createImageBitmap','IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(globals.map(key => [key, globalThis[key]]))
  let socket, drew = 0
  const draws = []
  class Socket {
    readyState = 1; sent = []
    constructor() { socket = this }
    send(text) { this.sent.push(JSON.parse(text)) }
    close() { this.readyState = 3 }
  }
  for (const key of globals) globalThis[key] = key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key]
  globalThis.WebSocket = Socket
  let bitmapSize = { width: 960, height: 540 }
  globalThis.createImageBitmap = async () => ({ ...bitmapSize, close() {} })
  dom.window.HTMLCanvasElement.prototype.getContext = function () { const canvas = this; return { drawImage(...args) { drew++; draws.push({ canvas, args }) } } }
  const container = dom.window.document.getElementById('root'), root = createRoot(container)
  const button = name => [...container.querySelectorAll('button')].find(item => item.textContent === name)
  try {
    await act(async () => root.render(React.createElement(DesktopViewer, { botId: 'main', machines: [{ id: 'pc' }],
      openSession: async () => ({ sessionId: 's', token: 'a'.repeat(43), websocketUrl: 'ws://localhost/', canControl: true, expiresAt: Date.now() + 60000 }),
      renewSession: async () => ({}), closeSession: async () => ({ stopConfirmed: true }) })))
    await act(async () => button('连接桌面').click())
    const message = value => socket.onmessage({ data: JSON.stringify(value) })
    await act(async () => { socket.onopen(); message({ type: 'ready', mode: 'watch', width: 1920, height: 1080, displayId: 'monitor' }) })
    await act(async () => { message({ type: 'frame', width: 1920, height: 1080, frameWidth: 960, frameHeight: 540 }); socket.onmessage({ data: new Uint8Array([255,216,255,217]).buffer }) })
    assert.equal(drew, 2, 'keyframe is decoded to the backing surface then presented')
    bitmapSize = { width: 64, height: 32 }
    await act(async () => {
      message({ type: 'frame', width: 1920, height: 1080, frameWidth: 960, frameHeight: 540, region: { x: 100, y: 80, width: 64, height: 32 }, keyframe: false })
      socket.onmessage({ data: new Uint8Array([255,216,255,217]).buffer })
    })
    assert.deepEqual(draws[2].args.slice(1), [100,80], 'a delta updates its rectangle without clearing the rest of the display')
    assert.equal(container.querySelector('canvas').width, 960)
    await act(async () => button('取得控制权').click())
    await act(async () => message({ type: 'control', mode: 'control', ok: true }))
    const canvas = container.querySelector('canvas')
    let top = 50
    canvas.getBoundingClientRect = () => ({ left: 100, top, width: 960, height: 540 })
    canvas.focus = options => { if (!options?.preventScroll) top -= 100 }
    await act(async () => canvas.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 580, clientY: 320, button: 0 })))
    const packet = socket.sent.find(item => item.type === 'input')
    assert.equal(packet.event.x, 960); assert.equal(packet.event.y, 540)
    await act(async () => message({ type: 'input', id: packet.id, ok: true }))
    await act(async () => canvas.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, clientX: 580, clientY: 320, button: 0 })))
    const released = socket.sent.filter(item => item.type === 'input').at(-1)
    assert.deepEqual(released.event, { ...packet.event, action: 'up' }, 'focusing an offscreen canvas must not move the pointer-up position')
    await act(async () => message({ type: 'input', id: released.id, ok: true }))
    for (const type of ['keydown', 'keyup']) {
      await act(async () => canvas.dispatchEvent(new dom.window.KeyboardEvent(type, { bubbles: true, key: 'Enter', code: '' })))
      const input = socket.sent.filter(item => item.type === 'input').at(-1)
      assert.deepEqual(input.event, { type: 'key', action: type === 'keydown' ? 'down' : 'up', code: 'Enter', key: 'Enter' })
      await act(async () => message({ type: 'input', id: input.id, ok: true }))
    }
    await act(async()=>canvas.dispatchEvent(new dom.window.MouseEvent('pointerdown',{bubbles:true,clientX:580,clientY:320,button:0})))
    const held=socket.sent.filter(item=>item.type==='input').at(-1);await act(async()=>message({type:'input',id:held.id,ok:true}))
    await act(async()=>canvas.dispatchEvent(new dom.window.MouseEvent('pointerup',{bubbles:true,clientX:50,clientY:0,button:0})))
    assert.equal(socket.sent.at(-1).type,'release-input','a captured release outside the visible frame must not leave a remote drag held')
    await act(async()=>message({type:'release-input',id:socket.sent.at(-1).id,ok:true}))
  } finally { await act(async () => root.unmount()); for (const key of globals) globalThis[key] = previous[key]; dom.window.close() }
})

test('duplicate connect clicks share one attempt, and reconnect cannot discard an unconfirmed original desktop stop',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),keys=['window','document','Element','HTMLElement','WebSocket','IS_REACT_ACT_ENVIRONMENT']
  const previous=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));let socket,opens=0,confirmed=false;const closes=[],gate=Promise.withResolvers()
  class Socket{readyState=1;constructor(){socket=this}send(){}close(){this.readyState=3}}
  for(const key of keys)globalThis[key]=key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key]
  globalThis.WebSocket=Socket
  const container=document.getElementById('root'),root=createRoot(container),button=label=>[...container.querySelectorAll('button')].find(value=>value.textContent===label)
  try{
    await act(()=>root.render(React.createElement(DesktopViewer,{botId:'bot-a',machines:[{id:'machine-a'}],openSession:async()=>{opens++;if(opens===1)await gate.promise;return {sessionId:`desktop-${opens}`,token:'a'.repeat(43),websocketUrl:'ws://localhost/',expiresAt:Date.now()+60000}},
      renewSession:async()=>({}),closeSession:async(botId,sessionId)=>{closes.push({botId,sessionId});return {stopConfirmed:confirmed}}})))
    await act(async()=>{button('连接桌面').click();button('连接桌面').click();await new Promise(setImmediate)})
    assert.equal(opens,1)
    await act(async()=>{gate.resolve();await new Promise(setImmediate);socket.onopen();socket.onmessage({data:JSON.stringify({type:'ready',mode:'watch'})})})
    await act(async()=>{button('重新连接').click();await new Promise(setImmediate)})
    assert.equal(opens,1);assert.match(container.textContent,/上一桌面尚未确认释放输入/)
    assert.equal(button('断开').disabled,false)
    confirmed=true
    await act(async()=>{button('断开').click();await new Promise(setImmediate)})
    assert.deepEqual(closes,[{botId:'bot-a',sessionId:'desktop-1'},{botId:'bot-a',sessionId:'desktop-1'}])
    await act(async()=>{button('连接桌面').click();await new Promise(setImmediate)})
    assert.equal(opens,2)
  }finally{await act(()=>root.unmount());dom.window.close();for(const key of keys)globalThis[key]=previous[key]}
})
