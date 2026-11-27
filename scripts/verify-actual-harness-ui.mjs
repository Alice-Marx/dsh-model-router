// Exercises the installed Harness runtime and the real plugin entry. No UI
// shell, model replies, API responses or slots are replaced by a preview.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'

const root=resolve(import.meta.dirname,'..'),base=join(root,'tmp/integration/actual-harness-ui')
const {run,source=root,packageVersion,harnessVersion}=JSON.parse(await readFile(join(base,'current.json'),'utf8'))
assert.equal(typeof harnessVersion,'string','start the real runtime with start-harness-ui-check.mjs')
const connection=JSON.parse(await readFile(join(run,'connection.private.json'),'utf8'))
assert.equal(new URL(connection.origin).hostname,'127.0.0.1')
const output=join(base,'verified');await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1360,height:1000}})
const errors=[],actions=[],checks=[],images=[],clientBundles=[],resources=[],repairStarts=[],attentionViews=[],submissionLookups=[]
const expectedClient=await readFile(join(source,'.dsh-plugin/client.js'))
const sanitized=text=>text.replace(/([?&]token=)[^\s&]+/g,'$1[REDACTED]')
page.on('pageerror',e=>errors.push(sanitized(e.message)))
page.on('request',request=>{
 if(request.method()!=='POST'||new URL(request.url()).pathname!=='/api/bot-product')return
 try{
  const input=JSON.parse(request.postData())
  actions.push(input.action)
  if(input.action==='cliProviders.repair'&&input.payload?.operation==='start')repairStarts.push(input.payload.toolId)
  if(input.action==='task.attention')attentionViews.push(input.payload?.view??'summary')
  if(input.action==='botRouting.status')submissionLookups.push(input.payload)
 }catch{}
})
page.on('response',async response=>{
 const path=new URL(response.url()).pathname,type=response.headers()['content-type']??''
 if(/javascript|json/.test(type))resources.push({path,type,status:response.status()})
 if(response.status()!==200||!/javascript/.test(type))return
 try{const data=await response.body(),offset=data.indexOf(expectedClient);if(offset>=0)clientBundles.push({servedBytes:data.length,offset,bytes:expectedClient.length,sha256:createHash('sha256').update(data.subarray(offset,offset+expectedClient.length)).digest('hex')})}catch{}
})
const capture=async name=>{const file=join(output,name+'.png');await page.screenshot({path:file,fullPage:false,animations:'disabled'});images.push(file)}
const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
const ready=async()=>{
 const beta=page.getByText('预览版说明',{exact:true})
 await page.locator('.bp-workspace-shortcuts').waitFor({state:'attached',timeout:30000})
 await beta.waitFor({state:'visible',timeout:5000}).catch(()=>{})
 if(await beta.isVisible()){await page.getByRole('button',{name:'继续',exact:true}).click();await beta.waitFor({state:'hidden'})}
 const welcome=page.getByText('开始使用',{exact:true})
 await welcome.waitFor({state:'visible',timeout:3000}).catch(()=>{})
 if(await welcome.isVisible()){await page.keyboard.press('Escape');await welcome.waitFor({state:'hidden'})}
}
try{
 await page.goto(connection.ownerUrl)
 await ready()
 await page.locator('[data-contact-nav="inbox"]').click()
 const inbox = page.locator('.bp-page[data-section="inbox"]')
 await inbox.getByRole('heading',{name:'会话待办 0',exact:true}).waitFor()
 await inbox.getByRole('heading',{name:/任务待办/}).waitFor()
 await capture('harness-inbox-light')
 await inbox.getByRole('button',{name:'任务通知',exact:true}).click()
 await inbox.getByRole('heading',{name:'通知中心',exact:true}).waitFor()
 const notificationContract = await page.evaluate(async () => {
  const call = async (action, payload) => (await fetch('api/bot-product', {
   method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, payload }),
  })).json()
  const list = await call('notifications.list', { limit: 1 })
  const invalid = await call('notifications.markAll', { throughSeq: 0 })
  return { bounded: list.value?.supportsMarkThrough, refused: invalid.error?.code }
 })
 assert.deepEqual(notificationContract,{bounded:true,refused:'INVALID_NOTIFICATION_SEQ'})
 checks.push('the real Host advertises bounded bulk reads and refuses an invalid read watermark')
 let idleInbox
 if(process.argv.includes('--inbox-recovery')){
  const before=actions.length, taskViews=attentionViews.length
  await page.waitForTimeout(6200)
  const idle=actions.slice(before)
  idleInbox={windowMs:6200,fullSnapshots:idle.filter(action=>action==='snapshot').length,
   attentionViews:attentionViews.slice(taskViews),notificationLists:idle.filter(action=>action==='notifications.list').length}
  assert.equal(idleInbox.fullSnapshots,0)
  assert.ok(idleInbox.attentionViews.length>=1&&idleInbox.attentionViews.length<=2)
  assert.ok(idleInbox.attentionViews.every(view=>view==='inbox'))
  assert.ok(idleInbox.notificationLists>=1)
  checks.push('idle inbox and sidebar share one lightweight attention poll while the notification feed polls independently')
 }
 await inbox.getByRole('button',{name:'待处理',exact:true}).click()
 await inbox.getByRole('heading',{name:'会话待办 0',exact:true}).waitFor()
 checks.push('the registered product inbox combines native conversation status and task attention and opens task notifications inline')
 if(process.argv.includes('--inbox-navigation')){
  const sidebar = page.locator('.bt-leftcol')
  const main = sidebar.locator('.bt-tile[data-bot-id]')
  const footer = sidebar.locator('[data-contact-nav="inbox"]')
  const menu = page.locator('.bt-menu')
  const mainId = await main.getAttribute('data-bot-id')
  const existing = await sidebar.locator('[data-bot-id]').evaluateAll(rows=>rows.map(row=>row.dataset.botId))
  await main.click({button:'right'})
  await menu.getByRole('menuitem',{name:/复制一份|Duplicate/}).click()
  const copyId = await (await page.waitForFunction(ids=>Array.from(document.querySelectorAll('.bt-leftcol [data-bot-id]'))
    .find(row=>!ids.includes(row.dataset.botId) && row.getAttribute('aria-current')==='page')?.dataset.botId,existing)).jsonValue()
  const copy = sidebar.locator(`[data-bot-id=${JSON.stringify(copyId)}]`)
  await main.click()
  await sidebar.locator('.bt-tile[aria-current="page"]').waitFor()
  await copy.click({button:'right'})
  await menu.getByRole('menuitem',{name:/标为未读|Mark as Unread/}).click()
  const copyName = await copy.locator('.bt-row-title').innerText()
  await footer.locator('.bp-contact-attention').waitFor()
  await footer.click()
  await inbox.getByRole('heading',{name:'会话待办 1',exact:true}).waitFor()
  const original = inbox.getByRole('button',{name:`打开会话 ${copyName}`,exact:true})
  await original.waitFor()
  await page.setViewportSize({width:390,height:844});await noOverflow()
  await page.waitForFunction(() => {
    const heading = document.querySelector('.bp-workspace-toolbar[data-section="inbox"] h1')
    return heading?.clientWidth > 0 && heading.scrollWidth <= heading.clientWidth
  })
  await capture('harness-inbox-phone')
  await page.setViewportSize({width:1360,height:1000})
  await original.click()
  await page.waitForFunction(() => document.querySelector('.bp-page[data-section="inbox"]')?.checkVisibility() !== true)
  assert.equal(await copy.getAttribute('aria-current'),'page')
  await footer.click()
  await inbox.getByRole('heading',{name:'会话待办 0',exact:true}).waitFor()
  checks.push('marking a real Bot unread updates the sidebar and inbox; opening the original session clears its unread entry')
  const roomName = `收件箱验证群 ${copyId.slice(-8)}`
  const roomResponse = await page.request.post(new URL('/api/bot',connection.origin).href,{data:{
    endpoint:'create-room',payload:{name:roomName,members:[mainId,copyId],admin:mainId,greet:false},
  }})
  const room = await roomResponse.json()
  assert.equal(room.ok,true,'the owner can create a test group without sending a message')
  const group = sidebar.locator(`[data-room-id=${JSON.stringify(room.value.id)}]`)
  await group.click({button:'right'})
  await menu.getByRole('menuitem',{name:/标为未读|Mark as Unread/}).click()
  const openGroup = inbox.getByRole('button',{name:`打开会话 ${roomName}`,exact:true})
  await openGroup.click()
  await group.and(sidebar.locator('[aria-current="page"]')).waitFor()
  await footer.click()
  await inbox.getByRole('heading',{name:'会话待办 0',exact:true}).waitFor()
  checks.push('a real group unread entry opens the group session and clears on visit')
 }
 await page.getByRole('button',{name:'远程电脑',exact:true}).click()
 await page.locator('.bp-workspace-toolbar').waitFor()
 await page.getByRole('button',{name:'连接电脑',exact:true}).waitFor()
 assert.equal(await page.locator('.bp-page-header').count(),0,'the real entry must not add a second page header')
 assert.equal(await page.locator('.preview-shell,.preview-sidebar,.preview-top').count(),0,'no illustration-only shell can substitute for the actual Host')
 assert.equal(await page.locator('.bt-leftcol .bp-workspace-shortcuts').count(),1,'the real DS Bot sidebar owns the computer destination')
 assert.equal(await page.locator('.bp-workspace-toolbar h1').innerText(),'电脑')
 await noOverflow();await capture('harness-computer-light')
 checks.push('real sidebar computer shortcut selects the actual ProductPage through Harness panel registration')
 await page.getByRole('button',{name:'共享本机',exact:true}).click()
 await page.getByLabel('本机名称').waitFor();await page.getByLabel('本机名称').fill('界面验收电脑')
 await page.getByRole('button',{name:'连接电脑',exact:true}).click();await page.getByRole('button',{name:'共享本机',exact:true}).click()
 assert.equal(await page.getByLabel('本机名称').inputValue(),'界面验收电脑')
 assert.equal(actions.includes('machine.host.configure'),false)
 await capture('harness-sharing-light');checks.push('actual Host state is read while sharing edits remain local until explicit save')
 await page.locator('.bp-toolbar-destinations').getByRole('button',{name:'AI 连接',exact:true}).click()
 await page.getByRole('group',{name:'AI 连接类型'}).waitFor()
 await capture('harness-ai-light')
 await page.getByRole('button',{name:'CLI 聊天',exact:true}).click();await page.locator('.bp-cli-chat').waitFor()
 assert.ok(actions.includes('cliProviders.list'))
 await page.getByRole('button',{name:'Bot 设置',exact:true}).click();await page.locator('.bp-bot-settings-dialog .bb-root').waitFor()
 await capture('harness-bot-settings-light')
 if(process.argv.includes('--cli-setup')){
  for(const [toolId,driver,name]of [['stepcode','stepAgent','step'],['gemini','geminiAgent','gemini'],['dsh-tui','deepseekAgent','deepseek'],['qwen-code','qwenAgent','qwen'],['codebuddy-code','execution-only','codebuddy']]){
   const row=page.locator(`.bp-bot-settings-dialog details[data-tool-id="${toolId}"]`)
   if(!await row.evaluate(node=>node.open))await row.locator('summary').first().click()
   await row.getByRole('button',{name:'配置与修复',exact:true}).click()
   const setup=row.locator('.bp-cli-setup')
   if(driver==='execution-only'){
    await setup.getByRole('heading',{name:'配置与修复 · CodeBuddy Code',exact:true}).waitFor({timeout:35000})
    assert.equal(await setup.getByText('另作聊天模型（可选）',{exact:true}).count(),0)
    await setup.getByRole('button',{name:'安装/修复 CLI',exact:true}).waitFor()
    await setup.evaluate(node=>{const pane=node.closest('.bp-bot-settings-body');pane.scrollTop+=node.getBoundingClientRect().top-pane.getBoundingClientRect().top-8})
    await noOverflow();await capture('harness-codebuddy-setup-light')
    await page.setViewportSize({width:390,height:844});await noOverflow();await capture('harness-codebuddy-setup-phone');await page.setViewportSize({width:1360,height:1000})
    await setup.getByLabel('关闭工具配置').click();continue
   }
   await setup.getByText('另作聊天模型（可选）',{exact:true}).click()
   await setup.getByLabel('CLI 聊天驱动',{exact:true}).waitFor({timeout:35000})
   assert.equal(await setup.getByLabel('CLI 聊天驱动',{exact:true}).inputValue(),driver)
   assert.equal(await setup.getByLabel('CLI 模型 ID',{exact:true}).inputValue(),'')
   assert.equal(await setup.getByLabel('CLI 登录资料 JSON',{exact:true}).inputValue(),'')
   if(driver!=='deepseekAgent')assert.equal(await setup.getByLabel('使用本机已登录账号',{exact:true}).isChecked(),false)
   if(driver==='deepseekAgent')assert.ok((await setup.innerText()).includes('按量'))
   await setup.evaluate(node=>{const pane=node.closest('.bp-bot-settings-body');pane.scrollTop+=node.getBoundingClientRect().top-pane.getBoundingClientRect().top-8})
   await noOverflow();await capture(`harness-${name}-setup-light`)
   if(toolId==='stepcode'){
    await page.setViewportSize({width:390,height:844});await noOverflow();await capture('harness-step-setup-phone')
    await page.setViewportSize({width:1360,height:1000})
   }
   await setup.getByLabel('关闭工具配置').click()
  }
  assert.deepEqual(repairStarts,[])
  assert.equal(actions.includes('cliProviders.save'),false)
  checks.push('real Bot settings open Step, Gemini, DeepSeek, Qwen and CodeBuddy configuration; detection starts no installer, imports no credentials and saves no chat/binding; CodeBuddy execution does not expose an unsupported chat driver')
 }
 await page.getByLabel('关闭 Bot 设置').click()
 checks.push('the production toolbar opens AI and the committed Main Bot settings through real owner actions')
 const appearance=page.locator('.bp-workspace-toolbar .bp-appearance')
 await appearance.getByLabel('外观与显示',{exact:true}).click();await appearance.getByRole('button',{name:'深色',exact:true}).click();await appearance.getByLabel('外观与显示',{exact:true}).click()
 await page.locator('.bp-toolbar-destinations').getByRole('button',{name:'电脑',exact:true}).click()
 await page.getByRole('button',{name:'连接电脑',exact:true}).waitFor();await noOverflow();await capture('harness-computer-dark')
 await page.setViewportSize({width:390,height:844});await noOverflow();await capture('harness-computer-phone')
 if(process.argv.includes('--inbox-recovery')){
  await page.setViewportSize({width:1360,height:1000})
  const requesterBotId=await page.locator('.bt-leftcol .bt-tile[data-bot-id]').getAttribute('data-bot-id')
  const requestKey='isolated-reload-original'
  await page.evaluate(async ({requesterBotId,requestKey})=>{
   const response=await fetch('api/bot-product',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({action:'ui.namespace',payload:{}})})
   const body=await response.json()
   if(!body.ok)throw Error('Host namespace unavailable')
   sessionStorage.setItem(`bot-product:routing-submission:${body.value.hostId}`,`dsh-route-v1:${requesterBotId}:${requestKey}`)
  },{requesterBotId,requestKey})
  await page.reload()
  await ready()
  await page.locator('[data-contact-nav="inbox"]').click()
  await page.getByRole('button',{name:'查看团队任务',exact:true}).click()
  await page.getByText(/当前尚未查到原提交/).waitFor()
  assert.deepEqual(submissionLookups,[{requesterBotId,requestKey}])
  assert.equal(actions.includes('botRouting.dispatch'),false)
  checks.push('after browser reload, the real task page restores a Host-bound reference and only checks the original submission')
 }
 const expected=expectedClient,sha256=createHash('sha256').update(expected).digest('hex')
 await writeFile(join(output,'client-response-debug.json'),JSON.stringify({clientBundles,resources},null,2))
 assert.ok(clientBundles.some(row=>row.sha256===sha256),'the Host must serve the exact built plugin client bytes')
 assert.deepEqual(errors,[])
 const report={status:'passed',actualHarnessRuntime:true,harnessVersion,packageVersion:packageVersion??JSON.parse(await readFile(join(source,'package.json'),'utf8')).version,syntheticUiShell:false,apiMocks:false,isolatedUserHome:true,liveUserProfileModified:false,desktopNativeWindowVerified:false,paidModelCalls:0,checks,idleInbox,actions:[...new Set(actions)],client:{bytes:expected.length,sha256,exactServedBytes:true},images,pageErrors:errors}
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}catch(e){await capture('failure');await writeFile(join(output,'failure.txt'),sanitized(String(e.stack)));throw e}
finally{await browser.close()}
