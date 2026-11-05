import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { RemoteAgentClient } from '../remote-computer-agent/dist/index.mjs'

const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1]
assert.ok(args.includes('--pairing') && args.includes('--ceiling'), 'Explicit private pairing and ceiling files are required')
const pair = JSON.parse(await readFile(resolve(value('--pairing')), 'utf8')), ceiling = JSON.parse(await readFile(resolve(value('--ceiling')), 'utf8'))
const endpoint = pair.endpoint ?? 'http://10.0.0.2:9701', machineId = pair.machineId ?? 'machine-91bda725-81ce-437e-b335-486456d4d617'
const client = new RemoteAgentClient(endpoint, machineId, async () => pair.token, true), botId = ceiling.botIds[0]
const id = randomUUID(), request = { botId, taskId: `browser-watch-${id}`, attemptId: `browser-attempt-${id}`, roots: ['project'],
  tools: ['desktop_screenshot','desktop_click','desktop_type','desktop_key','desktop_scroll'], ttlMs: 60000 }
let grant, ticket, origin, stopped = false
const output = resolve('tmp/integration/live-browser-desktop'); await mkdir(output, { recursive: true })
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {DesktopViewer} from './apps/integration-client/desktop-pane.jsx';
const call=async(path,body)=>{const r=await fetch(path,{method:'POST',body:JSON.stringify(body??{}),headers:{'content-type':'application/json'}});const value=await r.json();if(!r.ok)throw new Error(value.error);return value};
createRoot(document.getElementById('root')).render(React.createElement(DesktopViewer,{botId:${JSON.stringify(botId)},machines:[{id:${JSON.stringify(machineId)},name:'Existing paired computer'}],openSession:(_,id,options)=>call('/open',options),renewSession:()=>call('/renew'),closeSession:()=>call('/close')}));`
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022' })
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET') { res.setHeader('content-type', 'text/html;charset=utf-8'); res.end(`<html><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`); return }
    if (req.headers.origin !== origin) { res.writeHead(403); res.end('{}'); return }
    let body = ''; for await (const bytes of req) { body += bytes; if (body.length > 4096) throw new Error('Input limit') }
    let result
    if (req.url === '/open' && !ticket) {
      grant = (await client.grant(request)).grantToken
      ticket = await client.desktopSession(grant, { ...JSON.parse(body), origin })
      const url = new URL(ticket.path, endpoint); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      result = { ...ticket, canControl: ticket.controlAllowed, websocketUrl: url.href }
    } else if (req.url === '/renew' && ticket) {
      grant = (await client.grant(request)).grantToken
      result = await client.renewDesktopSession(grant, { sessionId: ticket.sessionId, origin })
    } else if (req.url === '/close' && ticket) { result = await client.closeDesktopSession(grant, { sessionId: ticket.sessionId }); stopped = result.stopConfirmed === true }
    else throw new Error('Unsupported test action')
    res.setHeader('content-type','application/json'); res.end(JSON.stringify(result))
  } catch (error) { res.writeHead(400, { 'content-type':'application/json' }); res.end(JSON.stringify({ error: error.message })) }
})
await new Promise(done => server.listen(0,'127.0.0.1',done)); origin = `http://127.0.0.1:${server.address().port}`
const require = createRequire(new URL('../remote-computer-agent/package.json', import.meta.url)), { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true }), page = await browser.newPage(), errors = []
page.on('pageerror', error => errors.push(error.message))
const summary = { status:'failed', errors, actualModelCalls:0 }
try {
  await page.addInitScript(() => { window.desktopDraws = 0; const draw = CanvasRenderingContext2D.prototype.drawImage; CanvasRenderingContext2D.prototype.drawImage = function(...args) { window.desktopDraws++; return draw.apply(this,args) } })
  await page.goto(origin)
  await page.getByRole('button',{name:'连接桌面',exact:true}).click()
  await page.waitForFunction(() => window.desktopDraws > 20)
  await page.getByRole('button',{name:'取得控制权',exact:true}).click()
  await page.getByText('你正在控制这台电脑',{exact:true}).waitFor()
  await page.getByRole('button',{name:'仅观看',exact:true}).click()
  await page.getByRole('button',{name:'断开',exact:true}).click()
  await page.waitForFunction(() => document.body.innerText.includes('未连接'))
  assert.ok(stopped); assert.deepEqual(errors,[])
  summary.status='passed';summary.drawCalls=await page.evaluate(()=>window.desktopDraws)
  summary.physicalDimensions={width:ticket.width,height:ticket.height};summary.stopConfirmed=true
  summary.checks=['Real Chromium decodes and composes live JPEG patches','Authenticated browser WebSocket origin accepted','Control acquisition and release receive remote acknowledgements','Disconnect confirms native teardown; no desktop input was sent']
} catch(error) { summary.error=error.stack;process.exitCode=1 }
finally { if(ticket&&!stopped)await client.closeDesktopSession(grant,{sessionId:ticket.sessionId}).catch(()=>{});await browser.close();await new Promise(done=>server.close(done)) }
await writeFile(`${output}/summary.json`,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary))
