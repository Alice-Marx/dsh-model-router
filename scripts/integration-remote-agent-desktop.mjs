import assert from 'node:assert/strict'
import {spawn,execFileSync} from 'node:child_process'
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomBytes,randomUUID} from 'node:crypto'
import net from 'node:net'
if(process.platform!=='win32')throw Error('DESKTOP_UNAVAILABLE: interactive Windows is required')
await import('../remote-computer-agent/build.mjs')
const {Agent,TOOL_NAMES}=await import('../remote-computer-agent/dist/index.mjs')
const Database=(await import(process.env.DSH_REMOTE_AGENT_DRIVER??pathToFileURL(resolve('tmp/integration/probes/sqlite/node_modules/better-sqlite3/lib/index.js')).href)).default
execFileSync('powershell.exe',['-NoLogo','-NoProfile','-File','native/windows-desktop/build.ps1'],{windowsHide:true})
const dir=resolve('tmp/integration/agent-desktop');await mkdir(dir,{recursive:true})
const run=await mkdtemp(join(dir,'run-')),metaFile=join(run,'window.json'),stateFile=join(run,'state.json'),secretFile=join(run,'desktop.secret'),pipeName='dsh-desktop-'+randomUUID(),token=randomBytes(32).toString('base64url')
const sourceFile=resolve('tests/fixtures/desktop-window/Program.cs'),fixtureExe=join(run,'dsh-desktop-fixture.exe')
await writeFile(secretFile,token,{mode:0o600})
execFileSync(join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/target:winexe','/reference:System.dll','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll',`/out:${fixtureExe.replaceAll('/','\\')}`,sourceFile.replaceAll('/','\\')],{windowsHide:true})
const helper=spawn(resolve('tmp/integration/agent-helper-build/dsh-desktop-helper.exe'),['--pipe',pipeName,'--secret-file',secretFile,'--allowed-process','dsh-desktop-fixture'],{windowsHide:true,stdio:'ignore'}),fixture=spawn(fixtureExe,[metaFile,stateFile],{windowsHide:false,stdio:'ignore'})
let agent,peer
const summary={status:'failed',platform:process.platform,node:process.version,checks:[],actualModelCalls:0,limitations:['Synthetic own-window fixture only; other apps/UAC/lock/RDP not exercised','Single monitor and current DPI only; 125%/multi-monitor and DPI transitions remain acceptance gates','GDI backend only; Windows Graphics Capture not validated','Application API protection is not same-account shell isolation']}
const readJson=async file=>JSON.parse(await readFile(file,'utf8')),sleep=ms=>new Promise(r=>setTimeout(r,ms))
async function waitFor(file,predicate=()=>true){for(let i=0;i<200;i++){try{const value=await readJson(file);if(predicate(value))return value}catch{}await sleep(50)}throw Error('DESKTOP_FIXTURE_UNAVAILABLE')}
async function quietAfterStop(){const start=await waitFor(stateFile),drained=await waitFor(stateFile,s=>s.tick>=start.tick+3);await sleep(500);const after=await waitFor(stateFile,s=>s.tick>drained.tick);assert.equal(after.text,drained.text);return after}
try{
  const target=await waitFor(metaFile);assert.notEqual(target.sessionSelector,0);await sleep(300)
  const denied=await new Promise((resolve,reject)=>{
    const socket=net.createConnection(`\\\\.\\pipe\\${pipeName}`);let data=''
    socket.setTimeout(3000,()=>socket.destroy(new Error('IPC_TIMEOUT')))
    socket.on('connect',()=>socket.write(JSON.stringify({token:'invalid',name:'desktop_screenshot',args:target})+'\n'))
    socket.on('data',chunk=>{data+=chunk;if(data.includes('\n')){socket.end();resolve(JSON.parse(data.split('\n')[0]))}});socket.on('error',reject)
  })
  assert.equal(denied.code,'AUTH_INVALID');summary.checks.push('named-pipe-token-denied')
  const aclFile=join(run,'pipe-acl.json');execFileSync(fixtureExe,['--acl',pipeName,aclFile],{windowsHide:true})
  const acl=await readJson(aclFile);assert.equal(acl.protectedAcl,true);assert.equal(acl.broadAllowed,false);assert.equal(acl.networkDenied,true);summary.checks.push('live-named-pipe-ACL-verified');await sleep(200)
  agent=new Agent({dataDir:join(run,'data'),roots:{fixture:run},desktop:{pipeName,secretFile}},Database)
  const pair=agent.store.pair('host',{botIds:['bot-a','bot-b'],roots:['fixture'],tools:TOOL_NAMES})
  let sequence=0,attempt=0
  const issue=botId=>agent.store.grant(agent.store.issue(agent.store.client(pair.token),{botId,taskId:'task',attemptId:'attempt-'+(++attempt),roots:['fixture'],tools:TOOL_NAMES}).grantToken)
  let context=issue('bot-a');const other=issue('bot-b')
  const call=(name,args,c=context)=>agent.call(name,args,c,`desktop-${++sequence}`)
  const capture=async(c=context)=>{await sleep(300);const result=await call('desktop_screenshot',target,c);assert.equal(result.status,'succeeded',JSON.stringify(result.error));return result.result}
  const click=async(x,y,c=context)=>{const shot=await capture(c);const result=await call('desktop_click',{...target,screenshotId:shot.screenshotId,x:x-shot.physicalOrigin.x,y:y-shot.physicalOrigin.y},c);assert.equal(result.status,'succeeded',JSON.stringify(result.error));await sleep(100)}
  const input=async(name,args,c=context)=>{const shot=await capture(c);const result=await call(name,{...target,screenshotId:shot.screenshotId,...args},c);assert.equal(result.status,'succeeded',JSON.stringify(result.error));return result}
  const first=await capture();assert.ok(first.dpi>=96);assert.equal(first.sessionId,target.sessionSelector);summary.checks.push('interactive-target-screenshot-metadata')
  const artifact=await agent.call('artifact_read',{artifactId:first.artifactId,length:1048576},context),png=Buffer.from(artifact.content,'base64');assert.equal(png.subarray(1,4).toString(),'PNG');await writeFile(join(dir,'synthetic-window.png'),png)
  const busy=await call('desktop_screenshot',target,other);assert.equal(busy.error.code,'DESKTOP_BUSY');summary.checks.push('cross-Bot-desktop-lease-denied')
  await assert.rejects(agent.call('fs_read',{rootId:'fixture',relativePath:'desktop.secret'},context),e=>e.code==='WORKSPACE_PRIVATE_PATH');summary.checks.push('desktop-pipe-secret-denied-to-authorized-root')
  peer=new Agent({dataDir:join(run,'peer-data'),roots:{fixture:run},desktop:{pipeName,secretFile}},Database)
  const peerPair=peer.store.pair('host',{botIds:['bot-a'],roots:['fixture'],tools:TOOL_NAMES})
  const peerContext=peer.store.grant(peer.store.issue(peer.store.client(peerPair.token),{botId:'bot-a',taskId:context.taskId,attemptId:context.attemptId,roots:['fixture'],tools:TOOL_NAMES}).grantToken)
  const peerBusy=await peer.call('desktop_screenshot',target,peerContext,'peer-capture');assert.equal(peerBusy.error.code,'DESKTOP_BUSY');await peer.close();peer=null
  await capture();summary.checks.push('two-Agent-helper-arbitration-and-independent-close')
  await click(target.buttonScreenX,target.buttonScreenY);await waitFor(stateFile,s=>s.clicks===1);summary.checks.push('real-button-click-counter')
  await click(target.inputScreenX,target.inputScreenY);await input('desktop_type',{text:'中文✓'});await waitFor(stateFile,s=>s.text==='中文✓');summary.checks.push('real-Unicode-SendInput-no-clipboard')
  await input('desktop_key',{key:'End'});await input('desktop_key',{key:'Backspace'});await waitFor(stateFile,s=>s.text==='中文');summary.checks.push('real-allowed-key-effect')
  await input('desktop_scroll',{delta:120});await waitFor(stateFile,s=>s.wheelEvents>0);summary.checks.push('real-target-wheel-event')
  const stale=await call('desktop_type',{...target,screenshotId:first.screenshotId,text:'stale'});assert.equal(stale.error.code,'TARGET_STALE');summary.checks.push('consumed-screenshot-denied')
  const wrong=await call('desktop_screenshot',{...target,sessionSelector:0});assert.equal(wrong.error.code,'DESKTOP_UNAVAILABLE');summary.checks.push('wrong-session-denied')
  const oldCapture=await capture();const stopped=await agent.desktop.cancel(context);assert.equal(stopped.stopConfirmed,true)
  await capture(other);const old=await call('desktop_type',{...target,screenshotId:oldCapture.screenshotId,text:'late'},context);assert.equal(old.status,'cancelled');assert.equal(old.result.stopConfirmed,true);assert.equal((await waitFor(stateFile)).text,'中文');await agent.desktop.cancel(other)
  summary.checks.push('confirmed-idle-cancel-handoff-and-late-input-denied')
  context=issue('bot-a');await click(target.inputScreenX,target.inputScreenY);const before=(await waitFor(stateFile)).text.length,shot=await capture(),op=`desktop-${++sequence}`
  const typing=agent.call('desktop_type',{...target,screenshotId:shot.screenshotId,text:'c'.repeat(2000),interKeyDelayMs:2},context,op)
  await waitFor(stateFile,s=>s.text.length>before+5)
  const cancelled=await agent.call('operation_cancel',{operationId:op},context),finished=await typing
  assert.equal(cancelled.stopConfirmed,true);assert.equal(finished.status,'cancelled');assert.equal(finished.result.stopConfirmed,true);assert.equal(finished.result.possiblyApplied,true)
  const quiet=await quietAfterStop();assert.ok(quiet.text.length<before+2000);summary.cancelledCharacters=quiet.text.length-before
  summary.checks.push('in-flight-operation-cancel-confirmed-after-partial-input','no-delayed-input-after-confirmed-cancel')
  context=issue('bot-a');await click(target.inputScreenX,target.inputScreenY);const revokeBefore=(await waitFor(stateFile)).text.length,revokeShot=await capture()
  const revokeTyping=call('desktop_type',{...target,screenshotId:revokeShot.screenshotId,text:'r'.repeat(2000),interKeyDelayMs:2})
  await waitFor(stateFile,s=>s.text.length>revokeBefore+5);agent.store.revokeGrants(agent.store.client(pair.token),{botId:'bot-a'})
  const revoked=await revokeTyping;assert.equal(revoked.status,'cancelled');assert.equal(revoked.result.stopConfirmed,true);assert.equal(revoked.result.cancelReason,'GRANT_REVOKED')
  const revokeQuiet=await quietAfterStop();assert.ok(revokeQuiet.text.length<revokeBefore+2000);summary.revokedCharacters=revokeQuiet.text.length-revokeBefore
  summary.checks.push('live-grant-revocation-stops-partial-input','no-delayed-input-after-grant-revocation')
  const sibling=issue('bot-b');await capture(sibling);summary.checks.push('sibling-Bot-continues-after-revocation')
  const expiring=await capture(sibling);await sleep(15100)
  const expired=await call('desktop_type',{...target,screenshotId:expiring.screenshotId,text:'expired'},sibling);assert.equal(expired.error.code,'TARGET_STALE');summary.checks.push('expired-screenshot-denied-after-real-wait')
  summary.status='passed';summary.sessionId=target.sessionSelector;summary.dpi=first.dpi;summary.captureBackend=first.captureBackend
}catch(e){summary.code=e.code??e.message;throw e}finally{
  try{if(peer)await peer.close();if(agent){const closed=await agent.close();summary.closeStopConfirmed=closed.desktopStopConfirmed}}finally{
    helper.kill();fixture.kill();const exited=child=>child.exitCode!==null||child.signalCode!==null;await Promise.all([helper,fixture].map(child=>exited(child)?undefined:new Promise(done=>child.once('close',done))))
    summary.ownedChildrenExited=exited(helper)&&exited(fixture)
    await writeFile(join(dir,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2))
  }
}
