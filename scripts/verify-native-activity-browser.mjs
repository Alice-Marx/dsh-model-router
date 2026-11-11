// Actual Chromium + production activity components against an offline owner API.
// This does not run a model/tool or prove acceptance in a live user Host.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const output = resolve(process.argv[2] ?? join(root, 'tmp/integration/native-activity-browser/chromium'))
await mkdir(output, { recursive: true })
const source = String.raw`
import React, {useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {NativeActivityHeader,NativeActivityCard} from './apps/integration-client/native-activity.jsx';
import chatCss from './apps/integration-client/chat.css';
const css=document.createElement('style');css.textContent=chatCss+String.raw` + '`' + String.raw`
html,body{margin:0;min-height:100%;font:14px/1.5 "Segoe UI",sans-serif}*{box-sizing:border-box}
body{background:var(--bp-chat-canvas);color:var(--bp-chat-ink)}main{max-width:860px;margin:auto;padding:18px}
.fixture-caption{font-size:11px;color:var(--bp-chat-muted);margin:0 0 16px}.fixture-header{display:flex;gap:12px;align-items:center;justify-content:space-between;min-width:0;padding:14px;background:var(--bp-chat-surface);border:1px solid var(--bp-chat-line);border-radius:16px}.fixture-header>strong{flex:none}.fixture-transcript{margin-top:24px;padding:18px;background:var(--bp-chat-surface);border:1px solid var(--bp-chat-line);border-radius:18px;min-width:0}.fixture-transcript>h2{font-size:12px;color:var(--bp-chat-muted);margin:0 0 12px}button{font:inherit}.bp-na-card{margin:0!important}
@media(max-width:480px){main{padding:12px}.fixture-header{padding:12px;gap:8px}.fixture-transcript{padding:12px}}
` + '`' + String.raw`;document.head.append(css);document.body.dataset.botProductUi='1';document.body.dataset.bpAppearance='light';
const fixture=window.__nativeActivityFixture={calls:[],snapshots:[],holding:null,held:[],stopConfirmed:false,view:{host:'A',context:'ctx-one'}};
const now=Date.now();
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),value=>value.toString(16).padStart(2,'0')).join('');
async function reply(host,payload){
 const independent=payload.mode==='independent';
 const conversationId=independent?payload.contextId:'host-'+await hash(payload.sessionId);
 const scope={botId:payload.botId,mode:payload.mode,conversationId,contextId:independent?payload.contextId:null,sessionId:independent?null:payload.sessionId};
 const older=payload.cursor!=null;
 const states=older?['cli-ok','cli-error']:['running','cli-ok','cli-error','turn-unconfirmed','cli-ok','cli-ok'];
 const items=states.map((state,index)=>{
  const offset=older?index+6:index;const tool=['Bash','mcp__dsh_task__data_sql','Read','Write'][offset%4];
  return {schemaVersion:1,callKey:'call-'+host+'-'+conversationId+'-'+offset,callId:'call-'+offset,
   botId:scope.botId,mode:scope.mode,conversationId,contextId:scope.contextId,processGeneration:'native-'+host,
   turnId:'turn-'+host+'-one',toolName:tool,toolNameRecorded:true,callIdRecorded:true,toolNameTruncated:false,redacted:false,
   state,cliOk:state==='cli-ok'?true:state==='cli-error'?false:null,
   startedAt:now-offset*1000,endedAt:state==='running'?null:now-offset*1000+1,updatedAt:Date.now(),
   turnSettled:state!=='running',turnOutcome:state==='turn-unconfirmed'?'unknown':state==='running'?null:'succeeded',
   cancelRequested:state==='turn-unconfirmed',stopConfirmed:state==='turn-unconfirmed'&&fixture.stopConfirmed,
   lateCliReturn:state==='turn-unconfirmed',lateCliOk:state==='turn-unconfirmed'?true:null,
   duplicateStarts:0,duplicateCompletions:0,input:{command:'fixture-private-command'}};
 });
 return {schemaVersion:1,scope,items,nextCursor:older?null:'cursor-'+host+'-'+payload.mode+'-'+(payload.contextId??payload.sessionId),nativeRoute:true,recording:{status:'ready',failures:0}};
}
function apiFor(host){return {
 snapshot:async()=>{fixture.snapshots.push(host);return {schemaVersion:1,availableActions:host==='legacy'?[]:['nativeActivity.list']};},
 dispatch:async(action,payload,signal)=>{
  fixture.calls.push({host,action,payload:structuredClone(payload)});
  if(action!=='nativeActivity.list')throw Error('unexpected mutation '+action);
  const context=payload.mode==='independent'?payload.contextId:payload.sessionId.slice('session-'.length);
  if(fixture.holding?.host===host&&fixture.holding?.context===context){return new Promise(resolve=>fixture.held.push({host,payload,resolve,signal}));}
  return reply(host,payload);
 }
};}
function App(){const [view,setView]=useState(fixture.view);const api=useMemo(()=>apiFor(view.host),[view.host]);
 fixture.view=view;fixture.setHost=host=>setView(old=>({...old,host}));fixture.setContext=context=>setView(old=>({...old,context}));
 fixture.hold=()=>{fixture.holding={...fixture.view};};
 fixture.release=async()=>{const held=fixture.held.splice(0);fixture.holding=null;await Promise.all(held.map(async item=>item.resolve(await reply(item.host,item.payload))));};
 return <main><p className="fixture-caption">原生工具过程 · 离线组件验收</p><header className="fixture-header"><strong>研究伙伴</strong><NativeActivityHeader productApi={api} botId="bot-a" sessionId={'session-'+view.context} pollMs={100}/></header>
 <section className="fixture-transcript"><h2>独立聊天 · 研究伙伴</h2><NativeActivityCard productApi={api} botId="bot-a" contextId={view.context} pollMs={100}/></section></main>;
}createRoot(document.getElementById('root')).render(<App/>);
`
await writeFile(join(output, 'fixture.jsx'), source)
const bundle = await build({ absWorkingDir: root, stdin: { contents: source, sourcefile: 'native-activity-fixture.jsx', resolveDir: root, loader: 'jsx' }, bundle: true, write: false,
  format: 'iife', platform: 'browser', target: 'es2022', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const javascript = bundle.outputFiles[0].contents
const server = createServer((request, response) => {
  if (request.url === '/') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>') }
  else if (request.url === '/fixture.js') { response.writeHead(200, { 'content-type': 'application/javascript' }); response.end(javascript) }
  else { response.writeHead(404); response.end() }
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
const errors = [], checks = [], images = [], externalRequests = []
page.on('pageerror', error => errors.push(error.message))
const origin = `http://127.0.0.1:${server.address().port}`
page.on('request', request => { if (!request.url().startsWith(origin)) externalRequests.push(request.url()) })
const card = () => page.locator('.bp-na-card')
const openCard = async () => { const toggle = page.locator('.bp-na-card-toggle'); if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click() }
const capture = async name => { const path = join(output, name + '.png'); await page.screenshot({ path, fullPage: false, animations: 'disabled' }); images.push(path) }
try {
  await page.goto(origin)
  await card().waitFor(); await page.locator('.bp-na-chip').waitFor(); await openCard()
  assert.equal(await card().locator('.bp-na-row').count(), 4)
  assert.deepEqual(await card().locator('.bp-na-state').allTextContents(), ['进行中', '已返回', '返回错误', '待核对'])
  assert.equal((await page.locator('body').textContent()).includes('fixture-private-command'), false)
  checks.push('production header and card render canonical states, latest-four view crop and no raw tool payload')
  for (const width of [1360, 375]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(value => { document.body.dataset.bpAppearance = value }, theme)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    const contrast = await card().locator('.bp-na-state').evaluateAll(nodes => {
      const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number)
      const luminance = colour => rgb(colour).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0)
      return nodes.map(node => {
        let parent = node, background = 'rgb(255,255,255)'
        while (parent) { const colour = getComputedStyle(parent).backgroundColor; if (colour !== 'rgba(0, 0, 0, 0)' && colour !== 'transparent') { background = colour; break }; parent = parent.parentElement }
        const foreground = getComputedStyle(node).color, values = [luminance(foreground), luminance(background)].sort((a,b) => b-a)
        return (values[0] + .05) / (values[1] + .05)
      })
    })
    assert.ok(contrast.every(value => value >= 4.5), JSON.stringify({ width, theme, contrast }))
    await capture(`activity-${width}-${theme}`)
    checks.push(`${width}px ${theme}: no horizontal overflow and all four state labels clear4.5:1 contrast`)
  }
  await page.locator('.bp-na-chip').click()
  const dialog = page.getByRole('dialog', { name: '工具记录' }); await dialog.waitFor()
  assert.equal(await dialog.evaluate(node => node === document.activeElement), true)
  await page.keyboard.press('Shift+Tab')
  assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true)
  await page.keyboard.press('Tab')
  assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await page.locator('.bp-na-chip').evaluate(node => node === document.activeElement), true)
  checks.push('header dialog traps both Tab directions and Escape returns focus to its trigger')
  await card().getByRole('button', { name: '查看已读取的 6 条', exact: true }).click()
  assert.equal(await card().locator('.bp-na-row').count(), 6)
  await card().getByRole('button', { name: '读取更早的记录', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.bp-na-card .bp-na-row').length === 8)
  const cursors = await page.evaluate(() => window.__nativeActivityFixture.calls.filter(row => row.payload.cursor).map(row => row.payload.cursor))
  assert.deepEqual(cursors, ['cursor-A-independent-ctx-one'])
  checks.push('loaded rows expand without execution; older records use the original cursor exactly once')
  await page.evaluate(() => { window.__nativeActivityFixture.stopConfirmed = true })
  await card().locator('.bp-na-row[data-state="turn-unconfirmed"]').getByText('会话进程已停止', { exact: true }).waitFor()
  assert.equal(await card().locator('.bp-na-row[data-state="turn-unconfirmed"]').count(), 1)
  checks.push('a later stop confirmation updates a terminal unknown row while keeping it pending reconciliation')
  await page.evaluate(() => window.__nativeActivityFixture.hold())
  await page.waitForFunction(() => window.__nativeActivityFixture.held.length >= 2)
  await page.evaluate(() => window.__nativeActivityFixture.setHost('B'))
  await page.waitForFunction(() => window.__nativeActivityFixture.calls.some(row => row.host === 'B'))
  await card().waitFor(); await openCard()
  await page.waitForFunction(() => { const rows = [...document.querySelectorAll('.bp-na-card .bp-na-row')]; return rows.length === 4 && rows.every(node => node.dataset.callKey.startsWith('call-B-')) })
  await page.evaluate(async () => { await window.__nativeActivityFixture.release(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
  assert.equal(await page.locator('[data-call-key^="call-A-"]').count(), 0)
  checks.push('retired Host/API replies cannot replace or append to the new Host activity')
  await page.evaluate(() => window.__nativeActivityFixture.hold())
  await page.waitForFunction(() => window.__nativeActivityFixture.held.length >= 2)
  await page.evaluate(() => window.__nativeActivityFixture.setContext('ctx-two'))
  await page.waitForFunction(() => window.__nativeActivityFixture.calls.some(row => row.payload.contextId === 'ctx-two'))
  await card().waitFor(); await openCard()
  await page.waitForFunction(() => { const rows = [...document.querySelectorAll('.bp-na-card .bp-na-row')]; return rows.length === 4 && rows.every(node => node.dataset.callKey.includes('ctx-two')) })
  await page.evaluate(async () => { await window.__nativeActivityFixture.release(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
  assert.equal(await card().locator('[data-call-key*="ctx-one"]').count(), 0)
  checks.push('retired context replies cannot append records to a new independent conversation')
  await page.evaluate(() => window.__nativeActivityFixture.setHost('legacy'))
  await card().waitFor({ state: 'detached' })
  await page.waitForFunction(() => window.__nativeActivityFixture.snapshots.filter(value => value === 'legacy').length === 2)
  assert.equal(await page.evaluate(() => window.__nativeActivityFixture.calls.some(row => row.host === 'legacy')), false)
  assert.equal(await page.evaluate(() => window.__nativeActivityFixture.calls.every(row => row.action === 'nativeActivity.list')), true)
  checks.push('an unadvertised old Host makes no activity read; all activity interactions remain observation-only')
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, [])
  const report = { status: 'passed', checks, images, pageErrors: errors, externalRequests, kind: 'real-Chromium-production-components-offline-owner-API', liveUserHost: false }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
