import assert from 'node:assert/strict'
import http from 'node:http'
import {execFileSync} from 'node:child_process'
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {build} from 'esbuild'
import {chromium} from 'playwright'

const root=resolve(import.meta.dirname,'..'),parent=resolve(root,'tmp/integration/secure-pairing-browser');await mkdir(parent,{recursive:true})
const directory=await mkdtemp(join(parent,'case-')),config=join(directory,'config.json'),ceiling=join(directory,'ceiling.json'),qrPage=join(directory,'pairing.html')
await writeFile(config,JSON.stringify({dataDir:join(directory,'data'),roots:{project:directory}}));await writeFile(ceiling,JSON.stringify({botIds:['bot-a'],roots:['project'],tools:['machine_ping']}))
execFileSync(process.execPath,['remote-computer-agent/dist/cli.mjs','invite-page',config,'host-browser',ceiling,'http://127.0.0.1:9701',qrPage],{cwd:root,stdio:'pipe',windowsHide:true})
const pageHtml=await readFile(qrPage),invitation=JSON.parse(await readFile(`${qrPage}.private.json`,'utf8'))
const bundle=await build({absWorkingDir:root,entryPoints:['tests/fixtures/secure-pairing-preview.jsx'],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',loader:{'.css':'text'}})
const fixtureHtml='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
const server=http.createServer((req,res)=>{if(req.method!=='GET'){res.writeHead(405);res.end();return};if(req.url==='/pairing.html'){res.setHeader('content-type','text/html; charset=utf-8');res.end(pageHtml)}else if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript; charset=utf-8');res.end(bundle.outputFiles[0].contents)}else if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end(fixtureHtml)}else{res.writeHead(404);res.end()}})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1000,height:1000}}),errors=[],checks=[],images=[]
page.on('pageerror',error=>errors.push(error.message))
const capture=async name=>{const path=join(parent,`${name}.png`);await page.screenshot({path,fullPage:true,animations:'disabled'});images.push(path)}
try{
  await page.goto(`${origin}/pairing.html`);await page.getByRole('heading',{name:'把这台电脑连接到 Bot'}).waitFor()
  assert.match(await page.locator('#timer').innerText(),/剩余/)
  const confirmationCode=(await page.locator('.code').innerText()).trim();assert.match(confirmationCode,/^\d{6}$/);
  const qr=join(directory,'qr.png');await page.locator('.qr').screenshot({path:qr})
  assert.equal(JSON.parse(await page.locator('#invite').inputValue()).code,undefined)
  await capture('device-invitation');checks.push('CLI page renders QR, separate confirmation code and countdown without remote assets')
  await page.addInitScript(()=>{
    window.__fakeCamera={requests:0,stops:0,pending:null}
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>{window.__fakeCamera.requests++;return new Promise(resolve=>{window.__fakeCamera.pending=resolve})}}})
    window.__resolveFakeCamera=()=>{const stream=new MediaStream();stream.getTracks=()=>[{stop:()=>window.__fakeCamera.stops++}];window.__fakeCamera.pending(stream)}
  })
  await page.goto(origin);await page.getByRole('heading',{name:'连接你的电脑'}).waitFor()
  assert.equal(await page.evaluate(()=>window.__fakeCamera.requests),0)
  await page.locator('input[type=file][accept="image/png,image/jpeg,image/webp"]').setInputFiles(qr)
  await page.locator('.bp-pairing-identity').waitFor();assert.equal(await page.locator('input[inputmode=numeric]').inputValue(),'')
  assert.equal(await page.evaluate(()=>window.__pairingFixture.calls.length),0)
  assert.match(await page.locator('.bp-pairing-identity').innerText(),new RegExp(invitation.transport.fingerprint.slice(0,8)))
  checks.push('actual QR screenshot imports through the real browser decoder, preserving identity and requiring a separate code without dispatch')
  await capture('host-pairing-light')
  await page.getByRole('button',{name:'扫描配对二维码',exact:true}).click();await page.getByRole('dialog').waitFor()
  assert.equal(await page.evaluate(()=>window.__fakeCamera.requests),1)
  await page.getByRole('button',{name:'关闭摄像头',exact:true}).click();await page.evaluate(()=>window.__resolveFakeCamera())
  await page.waitForFunction(()=>window.__fakeCamera.stops===1)
  assert.equal(await page.getByRole('dialog').count(),0)
  checks.push('camera starts only on request; a stream granted after close is stopped immediately')
  await page.getByLabel('外观与显示',{exact:true}).click();await page.getByRole('button',{name:'深色',exact:true}).click();await page.getByLabel('外观与显示',{exact:true}).click()
  await capture('host-pairing-dark');await page.setViewportSize({width:375,height:900})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await capture('host-pairing-phone');checks.push('dark and 375px pairing layouts remain readable with no horizontal overflow')
  await page.locator('input[inputmode=numeric]').fill(confirmationCode);await page.getByRole('button',{name:'验证并配对',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'离线夹具未进行真实设备配对'}).waitFor()
  assert.equal(await page.evaluate(()=>window.__pairingFixture.calls.length),1)
  assert.equal(await page.evaluate(()=>window.__pairingFixture.calls[0].action),'machine.pair.invite')
  assert.deepEqual(errors,[])
  const report={status:'passed',localFixture:true,checks,images,pageErrors:errors};await writeFile(join(parent,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}catch(error){await capture('failure');throw error}
finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
