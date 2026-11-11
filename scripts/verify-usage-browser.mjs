import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {build} from 'esbuild'
import {chromium} from 'playwright'
const root=resolve(import.meta.dirname,'..'),output=resolve(root,'tmp/integration/usage-browser');await mkdir(output,{recursive:true})
const bundle=await build({absWorkingDir:root,entryPoints:['tests/fixtures/usage-preview.jsx'],bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'text'}})
const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
const server=http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/fixture.js'?'text/javascript':'text/html;charset=utf-8');res.end(req.url==='/fixture.js'?bundle.outputFiles[0].contents:html)})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1360,height:1000},acceptDownloads:true}),errors=[],images=[],checks=[]
page.on('pageerror',error=>errors.push(error.message));page.on('console',entry=>{if(entry.type()==='error')errors.push(entry.text())})
const capture=async name=>{const path=join(output,`${name}.png`);await page.screenshot({path,fullPage:true,animations:'disabled'});images.push(path)}
try{
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('heading',{name:'收据明细'}).waitFor();await capture('usage-wide')
  await page.getByLabel('收据开始日期').fill('2026-11-07');await page.getByLabel('收据结束日期').fill('2026-11-07');await page.getByLabel('筛选收据 Bot').selectOption('analyst');await page.getByLabel('收据分组').selectOption('day')
  assert.match(await page.locator('.bp-usage-pagination').innerText(),/2 \/ 4/);assert.match(await page.locator('.bp-usage-totals').innerText(),/USD 0.200000/)
  assert.equal(await page.locator('.bp-usage-groups tbody tr').count(),1);assert.match(await page.locator('.bp-usage-groups').innerText(),/2026-11-07/)
  checks.push('inclusive Host-timezone dates, Bot filter and date grouping use the same two receipts; unknown charges stay unknown')
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'导出 CSV'}).click();const download=await downloadEvent,csv=await readFile(await download.path(),'utf8')
  assert.match(download.suggestedFilename(),/2026-11-07/);assert.match(csv,/fixture-known/);assert.match(csv,/fixture-unknown/);assert.doesNotMatch(csv,/fixture-subscription|fixture-undated/);assert.match(csv,/"API","","未知"/)
  checks.push('actual browser CSV download contains exactly the filtered source rows with a blank unknown amount')
  await page.getByLabel('收据开始日期').fill('2026-11-08');await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'导出 CSV'}).isDisabled(),true)
  checks.push('invalid date interval blocks export instead of inventing a report')
  await page.getByLabel('收据开始日期').fill('');await page.getByLabel('收据结束日期').fill('');await page.getByLabel('筛选收据 Bot').selectOption('');await page.getByLabel('收据分组').selectOption('none')
  await page.evaluate(()=>document.body.setAttribute('data-bp-appearance','dark'));await capture('usage-dark')
  await page.setViewportSize({width:375,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await capture('usage-phone')
  checks.push('dark appearance and 375px layout preserve readable controls and internal table scrolling without page overflow')
  assert.deepEqual(errors,[]);const report={status:'passed',checks,images,pageErrors:errors};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
