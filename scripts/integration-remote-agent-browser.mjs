import assert from 'node:assert/strict'
import http from 'node:http'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
await import('../remote-computer-agent/build.mjs')
const {Agent,TOOL_NAMES}=await import('../remote-computer-agent/dist/index.mjs')
const Database=(await import(process.env.DSH_REMOTE_AGENT_DRIVER??pathToFileURL(resolve('tmp/integration/probes/sqlite/node_modules/better-sqlite3/lib/index.js')).href)).default
const dir=resolve('tmp/integration/agent-browser');await mkdir(dir,{recursive:true});const run=await mkdtemp(join(dir,'run-'))
const server=http.createServer((req,res)=>{
  if(req.url==='/redirect'){res.writeHead(302,{Location:'http://127.0.0.1:1/blocked'});res.end();return}
  if(req.url==='/file'){res.writeHead(200,{'content-type':'text/plain','content-disposition':'attachment; filename="private.txt"'});res.end('private-download');return}
  res.setHeader('content-type','text/html')
  if(req.url==='/download'){res.end('<!doctype html><a href="/file" download>Download private artifact</a><p id="state">empty</p><script>document.getElementById(\'state\').textContent=document.cookie||\'empty\'</script>');return}
  res.end('<!doctype html><meta charset="utf-8"><title>Agent fixture</title><h1>Isolated browser fixture</h1><input aria-label="Entry"><input type="file" aria-label="Upload" onchange="document.getElementById(\'state\').textContent=\'uploaded:\'+this.files[0].name"><button onclick="document.cookie=\'private=one\';document.getElementById(\'state\').textContent=document.cookie">Set cookie</button><p id="state">empty</p><script>document.getElementById(\'state\').textContent=document.cookie||\'empty\'</script>')
})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const endpoint=`http://127.0.0.1:${server.address().port}`
const agent=new Agent({dataDir:join(run,'data'),roots:{fixture:run},browserOrigins:[endpoint],browserExecutablePath:process.env.DSH_REMOTE_AGENT_BROWSER,browserProfiles:{work:join(run,'profiles')}},Database)
const paired=agent.store.pair('host',{botIds:['bot-a','bot-b'],roots:['fixture'],tools:TOOL_NAMES}),issue=(botId,attemptId='attempt')=>agent.store.grant(agent.store.issue(agent.store.client(paired.token),{botId,taskId:'task',attemptId,roots:['fixture'],tools:TOOL_NAMES}).grantToken),c=issue('bot-a'),other=issue('bot-b')
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
  await call('browser_close',{browserSessionId});await call('browser_close',{browserSessionId:second.result.browserSessionId},other)
  await assert.rejects(call('browser_snapshot',{browserSessionId}),e=>e.code==='BROWSER_SESSION_NOT_FOUND')
  const redirect=await call('browser_open',{url:endpoint+'/redirect'});assert.equal(redirect.status,'failed');assert.equal(redirect.error.code,'BROWSER_NAVIGATION_FAILED')
  const forbidden=await call('browser_open',{url:'file:///etc/passwd'});assert.equal(forbidden.error.code,'URL_OUTSIDE_SCOPE')

  const persistent=await call('browser_open',{url:endpoint,profileId:'work'}),persistentId=persistent.result.browserSessionId
  assert.equal(persistent.result.persistent,true);assert.equal(persistent.result.profileId,'work')
  const persistentSnap=await call('browser_snapshot',{browserSessionId:persistentId});await call('browser_click',{browserSessionId:persistentId,snapshotId:persistentSnap.snapshotId,ref:persistentSnap.nodes.find(x=>x.tag==='button').ref})
  const persistentState=await call('browser_snapshot',{browserSessionId:persistentId});assert.ok(persistentState.text.includes('private=one'),persistentState.text)
  await call('browser_close',{browserSessionId:persistentId})
  const nextAttempt=issue('bot-a','attempt-2'),reopened=await call('browser_open',{url:`${endpoint}/download`,profileId:'work'},nextAttempt),reopenedId=reopened.result.browserSessionId
  const reopenedState=await call('browser_snapshot',{browserSessionId:reopenedId},nextAttempt);assert.ok(reopenedState.text.includes('private=one'),reopenedState.text)
  const downloadSnap=await call('browser_snapshot',{browserSessionId:reopenedId},nextAttempt)
  const clicked=await call('browser_click',{browserSessionId:reopenedId,snapshotId:downloadSnap.snapshotId,ref:downloadSnap.nodes.find(x=>x.tag==='a').ref},nextAttempt)
  assert.ok(clicked.result.downloadId,JSON.stringify(clicked))
  const downloaded=await call('browser_download',{browserSessionId:reopenedId,downloadId:clicked.result.downloadId},nextAttempt)
  assert.equal(Buffer.from(downloaded.result.content,'base64').toString(),'private-download');assert.equal(downloaded.result.filename,'private.txt')
  const consumed=await call('browser_download',{browserSessionId:reopenedId,downloadId:clicked.result.downloadId},nextAttempt);assert.equal(consumed.status,'failed');assert.equal(consumed.error.code,'BROWSER_DOWNLOAD_NOT_FOUND')
  await call('browser_close',{browserSessionId:reopenedId},nextAttempt)

  const otherPersistent=await call('browser_open',{url:endpoint,profileId:'work'},other),otherId=otherPersistent.result.browserSessionId
  assert.ok((await call('browser_snapshot',{browserSessionId:otherId},other)).text.includes('empty'))
  const crossDownload=await call('browser_download',{browserSessionId:otherId,downloadId:clicked.result.downloadId},other);assert.equal(crossDownload.status,'failed');assert.equal(crossDownload.error.code,'BROWSER_DOWNLOAD_NOT_FOUND')
  await call('browser_close',{browserSessionId:otherId},other)
  const denied=await call('browser_open',{url:endpoint,profileId:'unknown'});assert.equal(denied.error.code,'BROWSER_PROFILE_DENIED')
  const fresh=await call('browser_open',{url:endpoint});assert.ok((await call('browser_snapshot',{browserSessionId:fresh.result.browserSessionId})).text.includes('empty'));await call('browser_close',{browserSessionId:fresh.result.browserSessionId})
  const advanced=await call('browser_open',{url:endpoint}),advancedId=advanced.result.browserSessionId
  const script=await call('browser_script',{browserSessionId:advancedId,script:'({title:document.title,cookie:document.cookie})'});assert.equal(script.result.result.title,'Agent fixture')
  const uploadSnap=await call('browser_snapshot',{browserSessionId:advancedId}),uploadRef=uploadSnap.nodes.find(x=>x.text==='Upload').ref
  const uploaded=await call('browser_upload',{browserSessionId:advancedId,snapshotId:uploadSnap.snapshotId,ref:uploadRef,filename:'private.txt',contentBase64:Buffer.from('upload-私').toString('base64')})
  assert.equal(uploaded.status,'succeeded',JSON.stringify(uploaded.error))
  const uploadedState=await call('browser_script',{browserSessionId:advancedId,script:'document.getElementById(\'state\').textContent'});assert.equal(uploadedState.result.result,'uploaded:private.txt')
  const internal=await call('browser_script',{browserSessionId:advancedId,script:'(async()=>{try{await fetch(\'http://127.0.0.1:1/private\');return \'allowed\'}catch{return \'blocked\'}})()'});assert.equal(internal.result.result,'blocked',JSON.stringify(internal))
  const oversized=await call('browser_upload',{browserSessionId:advancedId,snapshotId:(await call('browser_snapshot',{browserSessionId:advancedId})).snapshotId,ref:uploadRef,filename:'large.bin',contentBase64:Buffer.alloc(1048577).toString('base64')});assert.equal(oversized.status,'failed');assert.equal(oversized.error.code,'BROWSER_UPLOAD_LIMIT')
  await call('browser_close',{browserSessionId:advancedId})
  const summary={status:'passed',platform:process.platform,node:process.version,browserVersion:open.result.browserVersion,checks:['real-Playwright-open/snapshot/Unicode-fill/click','stale-snapshot-rejected','Bot-context-cookie-isolation','cross-owner-access-denied','redirect-and-file-URL-denied','nonpersistent-close-reclaims-session','explicit-persistent-profile-survives-attempt','same-profile-name-does-not-share-across-Bots','download-is-scoped-consumed-and-bounded','script-and-in-memory-upload','upload-limit-and-internal-address-denied'],actualModelCalls:0,limitations:['Explicit local browser executable may differ from distribution-pinned browser build','Remote browser OS dependency installation remains separate']};await writeFile(join(dir,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2))
}finally{await agent.close();await new Promise(r=>server.close(r))}
