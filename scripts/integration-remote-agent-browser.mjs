import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
await import('../remote-computer-agent/build.mjs')
const {Agent,TOOL_NAMES}=await import('../remote-computer-agent/dist/index.mjs')
const Database=(await import(process.env.DSH_REMOTE_AGENT_DRIVER??pathToFileURL(resolve('tmp/integration/probes/sqlite/node_modules/better-sqlite3/lib/index.js')).href)).default
const dir=resolve('tmp/integration/agent-browser');await mkdir(dir,{recursive:true});const run=await mkdtemp(join(dir,'run-'))
const server=http.createServer((req,res)=>{if(req.url==='/redirect'){res.writeHead(302,{Location:`http://127.0.0.1:1/blocked`});res.end();return}res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="utf-8"><title>Agent fixture</title><h1>Isolated browser fixture</h1><input aria-label="Entry"><button onclick="document.cookie=\'private=one\';document.getElementById(\'state\').textContent=document.cookie">Set cookie</button><p id="state">empty</p>')})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const endpoint=`http://127.0.0.1:${server.address().port}`
const agent=new Agent({dataDir:join(run,'data'),roots:{fixture:run},browserOrigins:[endpoint],browserExecutablePath:process.env.DSH_REMOTE_AGENT_BROWSER},Database)
const paired=agent.store.pair('host',{botIds:['bot-a','bot-b'],roots:['fixture'],tools:TOOL_NAMES}),issue=botId=>agent.store.grant(agent.store.issue(agent.store.client(paired.token),{botId,taskId:'task',attemptId:'attempt',roots:['fixture'],tools:TOOL_NAMES}).grantToken),c=issue('bot-a'),other=issue('bot-b')
let sequence=0;const call=(name,args,context=c)=>agent.call(name,args,context,`browser-operation-${++sequence}`)
try{
  const open=await call('browser_open',{url:endpoint});assert.equal(open.status,'succeeded',JSON.stringify(open.error));const browserSessionId=open.result.browserSessionId
  const snap=await call('browser_snapshot',{browserSessionId});const input=snap.nodes.find(x=>x.tag==='input'),button=snap.nodes.find(x=>x.tag==='button');assert.ok(input);assert.ok(button)
  assert.equal((await call('browser_type',{browserSessionId,snapshotId:snap.snapshotId,ref:input.ref,text:'中文✓'})).status,'succeeded')
  const stale=await call('browser_click',{browserSessionId,snapshotId:snap.snapshotId,ref:button.ref});assert.equal(stale.error.code,'TARGET_STALE')
  const snap2=await call('browser_snapshot',{browserSessionId});assert.equal((await call('browser_click',{browserSessionId,snapshotId:snap2.snapshotId,ref:snap2.nodes.find(x=>x.tag==='button').ref})).status,'succeeded')
  assert.ok((await call('browser_snapshot',{browserSessionId})).text.includes('private=one'))
  await assert.rejects(call('browser_snapshot',{browserSessionId},other),e=>e.code==='SCOPE_DENIED')
  const second=await call('browser_open',{url:endpoint},other);const isolated=await call('browser_snapshot',{browserSessionId:second.result.browserSessionId},other);assert.ok(isolated.text.includes('empty'));assert.ok(!isolated.text.includes('private=one'))
  const redirect=await call('browser_open',{url:endpoint+'/redirect'});assert.equal(redirect.status,'failed');assert.equal(redirect.error.code,'BROWSER_NAVIGATION_FAILED')
  const forbidden=await call('browser_open',{url:'file:///etc/passwd'});assert.equal(forbidden.error.code,'URL_OUTSIDE_SCOPE')
  const summary={status:'passed',platform:process.platform,node:process.version,browserVersion:open.result.browserVersion,checks:['real-Playwright-open/snapshot/Unicode-fill/click','stale-snapshot-rejected','Bot-context-cookie-isolation','cross-owner-access-denied','redirect-and-file-URL-denied'],actualModelCalls:0,limitations:['Explicit local browser executable may differ from distribution-pinned browser build','Remote browser OS dependency installation remains separate','No script/upload/download or persistent-profile API yet']};await writeFile(join(dir,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2))
}finally{await agent.close();await new Promise(r=>server.close(r))}
