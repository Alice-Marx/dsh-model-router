// Actual Host registration, terminal UI and private-prefix npm installation.
// The explicit test plugin offers fixed owner-only operations, never free argv.
import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {chromium} from 'playwright'
const root=resolve(import.meta.dirname,'..'),base=join(root,'tmp/integration/actual-harness-ui')
const current=JSON.parse(await readFile(join(base,'current.json'),'utf8')),connection=JSON.parse(await readFile(join(current.run,'connection.private.json'),'utf8'))
const output=join(base,'terminal-install-verified');await mkdir(output,{recursive:true})
const expected=await readFile(join(current.source,'.dsh-plugin/client.js')),hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1416,height:1000}}),errors=[],served=[]
page.on('pageerror',error=>errors.push(error.message.replace(/([?&]token=)[^\s&]+/g,'$1[REDACTED]')))
page.on('response',async response=>{if(response.status()!==200||!/javascript/.test(response.headers()['content-type']??''))return;try{const body=await response.body(),at=body.indexOf(expected);if(at>=0)served.push(hash(body.subarray(at,at+expected.length)))}catch{}})
const call=operation=>page.evaluate(async operation=>{const r=await fetch('/api/verify-terminal-0761',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation})});if(!r.ok)throw Error('Fixed verification request failed: '+r.status);return r.json()},operation)
async function tools(){
 await page.locator('.bp-workspace-shortcuts').waitFor({state:'attached',timeout:30000})
 const beta=page.getByText('预览版说明',{exact:true});await beta.waitFor({state:'visible',timeout:3000}).catch(()=>{});if(await beta.isVisible()){await page.getByRole('button',{name:'继续',exact:true}).click();await beta.waitFor({state:'hidden'})}
 const welcome=page.getByText('开始使用',{exact:true});await welcome.waitFor({state:'visible',timeout:2000}).catch(()=>{});if(await welcome.isVisible()){await page.keyboard.press('Escape');await welcome.waitFor({state:'hidden'})}
 await page.locator('.bp-workspace-shortcuts').getByRole('button',{name:'AI 提供方',exact:true}).click();await page.getByRole('group',{name:'AI 连接类型'}).waitFor();await page.getByRole('button',{name:'官方工具',exact:true}).click();await page.getByRole('button',{name:'安装与登录',exact:true}).click()
}
try{
 await page.goto(connection.ownerUrl);await page.locator('.bp-workspace-shortcuts').waitFor({state:'attached',timeout:30000})
 let ready=false;for(let i=0;i<40;i++){ready=await page.evaluate(async()=>{const r=await fetch('/api/bot-product',{method:'POST',headers:{'content-type':'application/json'},body:'{"action":"snapshot"}'});return r.ok});if(ready)break;await page.waitForTimeout(500)}
 assert.equal(ready,true,'wait for the actual product authority before opening tools')
 await call('prepare-zcode');await tools()
 const terminal=page.locator('section[aria-label="官方工具终端"]')
 await terminal.getByText(/终端组件：Windows ConPTY/).waitFor({timeout:35000})
 await terminal.locator('#mr-term-target option[value="zcode"]').waitFor({state:'attached',timeout:35000})
 await terminal.locator('#mr-term-target').selectOption('zcode');await terminal.locator('#mr-term-cwd').fill(current.run)
 await terminal.getByRole('button',{name:'开始',exact:true}).click();await terminal.getByRole('button',{name:'确认启动',exact:true}).click()
 await terminal.getByRole('tab',{name:/ZCode TUI/}).waitFor({timeout:80000})
 assert.equal(await terminal.locator('.mr-error:visible').count(),0)
 await page.waitForTimeout(2000)
 await terminal.scrollIntoViewIfNeeded();await page.screenshot({path:join(output,'zcode-interactive-conpty.png'),animations:'disabled'})
 const stop=terminal.getByRole('button',{name:'结束会话',exact:true});if(await stop.count())await stop.click()
 let records=[];for(let i=0;i<25;i++){records=(await call('terminal-records')).records;if(records.some(row=>row.treeClosed&&row.outputClosed))break;await page.waitForTimeout(500)}
 const record=records.find(row=>row.target==='zcode'&&row.treeClosed&&row.outputClosed);assert.ok(record,'the actual Host must confirm terminal process-tree and output closure')
 assert.equal(record.backend,'managed');assert.equal(record.containment,'windows-job');assert.equal(record.controlLost,false)
 const accepted=await call('start-dsh-install'),started=Date.now(),phases=[];let job
 await page.reload();await tools()
 const dsh=page.locator('#mr-panel-tools .mr-tool').filter({has:page.locator('.mr-route-name',{hasText:/^dsh-TUI/})})
 let progressCaptured=false,lastLog=0
 for(;;){
  job=(await call('dsh-status')).job;assert.ok(job)
  if(phases.at(-1)!==job.phase)phases.push(job.phase)
  if(Date.now()-lastLog>15000){console.log(JSON.stringify({phase:job.phase,status:job.status,elapsedSeconds:Math.floor((Date.now()-started)/1000)}));lastLog=Date.now()}
  if(!progressCaptured&&job.status==='running'&&job.phase==='installing'){
   await dsh.locator('.mr-tool-progress').waitFor({timeout:20000});assert.match(await dsh.locator('.mr-tool-progress').innerText(),/已用时/)
   await dsh.scrollIntoViewIfNeeded();await page.screenshot({path:join(output,'dsh-install-progress.png'),animations:'disabled'});progressCaptured=true
  }
  if(job.status!=='running')break
  assert.ok(Date.now()-started<960000,'actual install must remain bounded');await page.waitForTimeout(3000)
 }
 assert.equal(job.status,'succeeded',JSON.stringify(job));assert.equal(job.exitCode,0);assert.ok(job.postInstallProbe.installed);assert.equal(job.executionReadiness.ready,true)
 const backend=JSON.parse(await readFile(join(accepted.installDir,'node_modules/@deepseek-ai/dsh/package.json'),'utf8'));assert.equal(backend.version,'0.2.2-rc.3')
 assert.ok(progressCaptured||Date.now()-started<15000,'a longer install must expose progress');assert.deepEqual(errors,[]);assert.ok(served.includes(hash(expected)))
 const report={status:'passed',version:current.packageVersion,harnessVersion:current.harnessVersion,actualHarness:true,headlessBrowser:true,nativeDesktopWindowVerified:false,apiMocks:false,exactServedClient:{bytes:expected.length,sha256:hash(expected)},
  terminal:{actualInteractiveZcode:true,backend:record.backend,treeClosed:record.treeClosed,outputClosed:record.outputClosed,controlLost:record.controlLost,stopConfirmed:record.stopConfirmed},
  install:{actualNpmCommand:true,privatePrefix:accepted.installDir,liveToolsModified:false,phases,status:job.status,version:job.postInstallProbe.version,backendVersion:backend.version,executionReady:job.executionReadiness.ready,progressCaptured},realAccountRead:false,paidModelCalls:0,pageErrors:errors}
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n')
}catch(error){
 try{await page.screenshot({path:join(output,'failed-verification.png')});console.log(JSON.stringify({visibleErrors:await page.locator('.mr-error:visible').allTextContents()}))}catch{}
 throw error
}finally{await browser.close()}
// Closing the actual RPC client must not leave a detached policy rejection
// capable of terminating the Host after a successful operation.
await new Promise(resolve=>setTimeout(resolve,2000))
process.kill(current.launcherPid,0)
const hostResponse=await fetch(connection.origin,{signal:AbortSignal.timeout(10000)})
// A fresh request has no owner cookie; an authentication refusal is healthy.
assert.ok([200,401].includes(hostResponse.status),'the Host must survive browser disconnection and serve its normal authentication boundary')
const disconnect={status:'passed',hostSurvivedBrowserDisconnect:true,httpStatus:hostResponse.status,checkedAt:new Date().toISOString(),paidModelCalls:0}
await writeFile(join(output,'post-disconnect-verification.json'),JSON.stringify(disconnect,null,2)+'\n')
const report=JSON.parse(await readFile(join(output,'report.json'),'utf8'));report.hostSurvivedBrowserDisconnect=true
await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
