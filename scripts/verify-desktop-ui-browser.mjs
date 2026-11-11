import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {build} from 'esbuild'
import {chromium} from 'playwright'
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'tmp/integration/desktop-ui-browser');await mkdir(output,{recursive:true})
const bundle=await build({absWorkingDir:root,entryPoints:['tests/fixtures/desktop-preview.jsx'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'text'}})
const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
const server=http.createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].contents)}else{res.setHeader('content-type','text/html; charset=utf-8');res.end(html)}})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1360,height:1000}}),errors=[],images=[],checks=[]
page.on('pageerror',error=>errors.push(error.message));page.on('console',item=>{if(item.type()==='error')errors.push(item.text())})
const capture=async name=>{const path=join(output,`${name}.png`);await page.screenshot({path,fullPage:true,animations:'disabled'});images.push(path)}
try{
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('button',{name:'连接桌面',exact:true}).click();await page.locator('.bp-desktop-status[data-connected=true]').waitFor()
  await page.waitForFunction(()=>document.querySelector('.bp-stream-canvas').width===1440)
  await capture('desktop-watch');assert.equal(await page.evaluate(()=>window.__desktopFixture.clipboardReads),0)
  await page.getByRole('button',{name:'取得控制权',exact:true}).click();await page.getByText('你正在控制这台电脑',{exact:true}).waitFor()
  await page.locator('.bp-stream-canvas').hover();await page.mouse.wheel(0,120)
  await page.waitForFunction(()=>window.__desktopFixture.events.some(event=>event.event?.type==='wheel'))
  await page.getByRole('button',{name:'键盘与文字',exact:true}).click();await page.locator('.bp-desktop-tools-panel textarea').fill('已确认的测试输入')
  await page.getByRole('button',{name:'发送文字',exact:true}).click();await page.waitForFunction(()=>window.__desktopFixture.events.some(event=>event.event?.text==='已确认的测试输入'))
  assert.equal(await page.locator('.bp-desktop-tools-panel textarea').inputValue(),'')
  await page.getByRole('button',{name:'读取本机剪贴板',exact:true}).click();assert.equal(await page.locator('.bp-desktop-tools-panel textarea').inputValue(),'待确认的本机文字')
  assert.equal(await page.evaluate(()=>window.__desktopFixture.events.some(event=>event.event?.text==='待确认的本机文字')),false)
  await page.getByRole('button',{name:'全选',exact:true}).click();await page.waitForFunction(()=>window.__desktopFixture.events.filter(event=>event.event?.type==='key').length===4)
  const keys=await page.evaluate(()=>window.__desktopFixture.events.filter(event=>event.event?.type==='key').map(event=>[event.event.code,event.event.action]))
  assert.deepEqual(keys,[['ControlLeft','down'],['KeyA','down'],['KeyA','up'],['ControlLeft','up']]);checks.push('text waits for native ACK; local clipboard only fills a draft; shortcut keys retain down/up order')
  await capture('desktop-keyboard')
  await page.getByRole('button',{name:'关闭键盘面板'}).click();await page.getByRole('button',{name:'放大',exact:true}).click();await page.getByRole('dialog').waitFor()
  assert.equal(await page.locator('.bp-stream-large').getAttribute('width'),'1440');assert.equal(await page.evaluate(()=>window.__desktopFixture.frames),1)
  await page.locator('.bp-stream-large').click({position:{x:500,y:300}});await page.waitForFunction(()=>window.__desktopFixture.events.some(event=>event.event?.type==='pointer'&&event.event.action==='up'))
  await capture('desktop-expanded');checks.push('expanded viewer paints the existing frame immediately and preserves physical-pointer input')
  await page.getByRole('button',{name:'原始尺寸',exact:true}).click();assert.equal(await page.locator('.bp-desktop-expanded-stage').getAttribute('data-fit'),'false')
  await page.getByRole('button',{name:'适应窗口',exact:true}).click()
  await page.getByRole('button',{name:'系统全屏',exact:true}).click();await page.waitForFunction(()=>!!document.fullscreenElement)
  await page.getByRole('button',{name:'退出系统全屏',exact:true}).click();await page.waitForFunction(()=>!document.fullscreenElement)
  checks.push('fit, original scale and browser fullscreen toggle without creating another session')
  await page.setViewportSize({width:375,height:900});await page.getByRole('button',{name:'键盘与文字',exact:true}).click();await capture('desktop-phone-tools')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  assert.equal(await page.locator('.bp-stream-dialog').evaluate(element=>element.scrollWidth>element.clientWidth),false)
  await page.getByRole('button',{name:'关闭键盘面板'}).click()
  const touch=await page.locator('.bp-stream-large').evaluate(canvas=>{
    const start=window.__desktopFixture.events.length,rect=canvas.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2
    const send=(type,pointerId,clientX,clientY)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId,clientX,clientY,button:0}))
    send('pointerdown',1,x-20,y);send('pointerdown',2,x+20,y);send('pointermove',1,x-20,y-20);send('pointerup',2,x+20,y);send('pointermove',1,x-20,y-40);send('pointerup',1,x-20,y-40)
    return start
  })
  await page.waitForFunction(start=>window.__desktopFixture.events.slice(start).some(event=>event.event?.type==='wheel'),touch)
  const gesture=await page.evaluate(start=>window.__desktopFixture.events.slice(start),touch)
  assert.equal(gesture.filter(event=>event.event?.type==='pointer'&&event.event.action==='down').length,1)
  assert.ok(gesture.findIndex(event=>event.type==='release-input')<gesture.findIndex(event=>event.event?.type==='wheel'))
  assert.equal(gesture.filter(event=>event.event?.type==='pointer'&&event.event.action==='move').length,0)
  checks.push('two-finger scroll releases the initial drag and suppresses stale one-finger movement')
  await page.getByRole('button',{name:'关闭放大',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0)
  checks.push('375px controls and expanded keyboard panel do not overflow; closing returns to the compact viewer')
  assert.deepEqual(errors,[]);const report={status:'passed',localFixture:true,checks,images,pageErrors:errors};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}catch(error){await capture('failure');throw error}
finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
