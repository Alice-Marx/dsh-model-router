import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const output=resolve('tmp/integration/ui-refinement-browser');await mkdir(output,{recursive:true})
const bundle=await build({entryPoints:['tests/fixtures/ui-refinement-preview.jsx'],bundle:true,write:false,format:'iife',platform:'browser',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"development"'}})
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/fixture.js'?'text/javascript':'text/html; charset=utf-8');res.end(req.url==='/fixture.js'?bundle.outputFiles[0].contents:'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DS Bot · 本地界面预览</title><div id="root"></div><script src="/fixture.js"></script></html>')})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`
if(process.argv.includes('--serve')){console.log(url);await new Promise(()=>{});process.exit()}
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1360,height:1000}}),errors=[],checks=[],images=[]
page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text())})
const capture=async name=>{const path=join(output,name+'.png');await page.screenshot({path,fullPage:true,animations:'disabled'});images.push(path)}
const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
try{
 await page.goto(url);await page.getByRole('button',{name:'连接电脑',exact:true}).waitFor();await noOverflow()
 assert.equal(await page.locator('.bp-local-computer input:visible').count(),0)
 assert.equal(await page.getByLabel('设备邀请码').isVisible(),false)
 assert.equal(await page.getByRole('button',{name:'验证并配对',exact:true}).count(),0)
 await capture('computer-light');checks.push('computer setup presents one action at a time; no hidden grant is submitted')
 await page.getByRole('button',{name:'共享本机',exact:true}).click();await page.getByLabel('本机名称').waitFor()
 assert.equal(await page.locator('.bp-local-computer input:visible').count(),4)
 assert.equal(await page.getByLabel('本机连接网卡').isVisible(),false)
 await page.getByLabel('本机名称').fill('我的设计电脑');await page.getByLabel('允许修改共享文件夹').check()
 await page.getByRole('button',{name:'连接电脑',exact:true}).click();await page.getByRole('button',{name:'共享本机',exact:true}).click()
 assert.equal(await page.getByLabel('本机名称').inputValue(),'我的设计电脑')
 assert.equal(await page.evaluate(()=>window.__refinement.calls.some(c=>c.action==='machine.host.configure')),false)
 await capture('sharing-light');checks.push('network options stay folded; edited sharing options survive tab changes and require explicit save')
 await page.getByRole('button',{name:'保存并开启远程访问',exact:true}).click();await page.getByRole('button',{name:'生成两分钟配对邀请',exact:true}).waitFor()
 const saved=await page.evaluate(()=>window.__refinement.calls.find(c=>c.action==='machine.host.configure'))
 assert.equal(saved.payload.allowWrite,true);assert.equal(saved.payload.name,'我的设计电脑')
 await page.getByRole('button',{name:'Bot 设置',exact:true}).first().click();await page.locator('.bb-root').waitFor()
 assert.equal(await page.locator('.bb-tool[open]').count(),0)
 await capture('bot-settings-light')
 await page.locator('.bb-tool > summary').first().click();assert.equal(await page.locator('.bb-tool[open]').count(),1)
 checks.push('tool rows expand individually without changing the saved grant')
 await page.getByLabel('关闭 Bot 设置').click();await page.getByRole('button',{name:'AI 连接',exact:true}).first().click();await page.getByRole('group',{name:'AI 连接类型'}).waitFor()
 assert.equal(await page.locator('.bp-cli-chat').isVisible(),false)
 await capture('ai-light');await page.getByRole('button',{name:'CLI 聊天',exact:true}).click();await page.locator('[data-cli-profile]').waitFor()
 assert.equal(await page.getByRole('heading',{name:'我的模型连接',exact:true}).isVisible(),false)
 await page.getByRole('button',{name:'官方工具',exact:true}).click();await page.getByText('Codex CLI',{exact:true}).waitFor()
 checks.push('API, CLI chat and official tool lists are separated without losing connection context')
 await page.getByRole('button',{name:'切换深色',exact:true}).click();await capture('ai-dark')
 await page.getByRole('button',{name:'电脑',exact:true}).last().click();await page.getByRole('button',{name:'连接电脑',exact:true}).click();await capture('computer-dark')
 await page.setViewportSize({width:390,height:844});await noOverflow();await capture('computer-phone')
 await page.getByRole('button',{name:'共享本机',exact:true}).click();await noOverflow();await capture('sharing-phone')
 await page.getByRole('button',{name:'Bot 设置',exact:true}).last().click();await page.locator('.bb-root').waitFor();await noOverflow();await capture('bot-settings-phone')
 await page.getByLabel('关闭 Bot 设置').click();assert.deepEqual(errors,[])
 const report={status:'passed',localFixture:true,actualHostDesktopVerified:false,checks,images,pageErrors:errors};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}catch(e){await capture('failure');throw e}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
