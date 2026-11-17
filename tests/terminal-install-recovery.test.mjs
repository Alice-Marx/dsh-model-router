import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,mkdtemp,readFile,writeFile,stat} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createNativeTerminalProtocol,createWindowsManagedTerminal} from '../packages/cli-runtime/src/native-terminal.mjs'
import {getOfficialTool,DSH_TUI_BACKEND_VERSION} from '../.dsh-plugin/shared/official-tool-registry.mjs'
import {resolveDshTask} from '../.dsh-plugin/shared/official-headless-adapters.mjs'
import {resolveInstallPlan} from '../.dsh-plugin/shared/tool-install-preferences.mjs'
import {awaitInstallReadiness,finishVerifiedInstall,installPreferences,setInstallPreferences} from '../.dsh-plugin/shared/official-tools-runtime.mjs'
import {installJobProgress,shouldApplyInstallStatus} from '../.dsh-plugin/client/tool-install-state.mjs'
import {createRequire} from 'node:module'
import {openSqliteRouterState} from '../packages/orchestration/src/sqlite-router-state.mjs'
import {createFundedRouterState} from '../packages/orchestration/src/funded-router-state.mjs'
import {createDeferredRouterState} from '../packages/orchestration/src/deferred-router-state.mjs'
import {createRouterTerminals,installRouterStateStore} from '../.dsh-plugin/router-core.mjs'
import {OfficialToolsRemoteService} from '../.dsh-plugin/official-tools-remote-service.mjs'

test('bootstrap notification cannot bypass pipe, suspended creation or start identity',()=>{
 const protocol=createNativeTerminalProtocol();protocol.accept({control:'bootstrapping'})
 assert.equal(protocol.stage,'bootstrapping')
 assert.throws(()=>protocol.accept({control:'bootstrapping'}))
 assert.throws(()=>protocol.accept({control:'launcherCreated',pid:10,start:'1',containment:'windows-job',conpty:true}))
 protocol.accept({control:'listening'});protocol.accept({control:'dataConnected'})
 protocol.accept({control:'launcherCreated',pid:10,start:'1',containment:'windows-job',conpty:true})
 assert.throws(()=>protocol.accept({control:'started',pid:11,start:'1'}))
})
test('policy-wrapped asynchronous install settings are awaited for the list and every mutation',async()=>{
 const f=await terminalFixture(),previous=structuredClone(installPreferences());let rejectSettings=false,settingsError=null
 const policy={check(){},filterRoutes(rows){return rows},async run(call,operation){await Promise.resolve();if(call.name==='installSettings'&&rejectSettings)throw new DOMException('request disconnected','AbortError');return await operation()}}
 const service=Object.create(OfficialToolsRemoteService.prototype)
 Object.defineProperty(service,'ctx',{value:{get:name=>name==='botIntegrationPolicy'?policy:undefined,invocation:{}}})
 service.services={requireBotPolicy:()=>true,installSettingsError:()=>settingsError,installRequestedDirectory:()=>f.dir}
 setInstallPreferences({installDir:f.dir,registry:'https://registry.npmjs.org/',methods:{},scriptUrls:{},allowScriptInstall:true})
 try{
  const view=await service.list();assert.equal(view.install.installDir,f.dir)
  rejectSettings=true;await assert.rejects(service.list(),{name:'AbortError'})
  rejectSettings=false;settingsError='fixture validation must finish before any command'
  for(const method of ['installTool','repairTool','uninstallTool']){
   const reply=await service[method]({tool:'unknown-offline-tool'})
   assert.equal(reply.ok,false);assert.match(JSON.stringify(reply.error),/fixture validation/)
  }
 }finally{setInstallPreferences(previous)}
})

async function terminalFixture(){
 const base=resolve('tmp/integration/terminal-install-recovery');await mkdir(base,{recursive:true});const dir=await mkdtemp(join(base,'case-'))
 await mkdir(join(dir,'output'));const marker=join(dir,'started.txt')
 return {dir,marker,spec:{launch:{file:process.execPath,args:['-e','require("node:fs").writeFileSync("started.txt","yes");console.log("终端恢复验证")']},
  cwd:dir,cols:100,rows:30,env:{...process.env,HOME:dir,USERPROFILE:dir},privateOutput:join(dir,'output'),ttlMs:12000}}
}
test('a real cold bootstrap longer than twenty seconds can complete before any tool is resumed',{skip:process.platform!=='win32',timeout:80000},async()=>{
 const f=await terminalFixture(),peer=join(f.dir,'delayed-peer.ps1')
 const source=await readFile(new URL('../packages/cli-runtime/src/native-terminal-peer.ps1',import.meta.url),'utf8')
 assert.ok(source.includes("[Console]::Out.Flush()"))
 await writeFile(peer,source.replace("[Console]::Out.Flush()","[Console]::Out.Flush()\nStart-Sleep -Milliseconds 23000"))
 let launches=0
 const proc=await createWindowsManagedTerminal(f.spec,{spawnHelper:(file,args,options)=>{launches++;return spawn(file,[...args.slice(0,-1),peer],options)}})
 assert.equal(await stat(f.marker).catch(()=>null),null,'construction must not run the tool')
 let output='';proc.onData(text=>output+=text);await proc.resume();const done=await proc.closed
 assert.equal(launches,1);assert.equal(proc.treeClosed,true);assert.equal(done.outputTruncated,false);assert.match(output,/终端恢复验证/)
 assert.equal(await readFile(f.marker,'utf8'),'yes')
})
test('a silent bootstrap fails with its phase and never replays or starts the tool',{skip:process.platform!=='win32',timeout:15000},async()=>{
 const f=await terminalFixture();let launches=0
 await assert.rejects(createWindowsManagedTerminal(f.spec,{bootstrapTimeoutMs:100,spawnHelper:(_file,_args,options)=>{launches++;return spawn(process.execPath,['-e','setInterval(()=>{},1000)'],options)}}),error=>error.code==='NATIVE_TERMINAL_BOOTSTRAP_TIMEOUT'&&['new','bootstrapping'].includes(error.startupStage))
 assert.equal(launches,1);assert.equal(await stat(f.marker).catch(()=>null),null)
})
test('the actual terminal manager persists close proof through the deferred SQLite authority',{skip:process.platform!=='win32',timeout:25000},async()=>{
 const f=await terminalFixture(),Database=createRequire(import.meta.url)('better-sqlite3'),file=join(f.dir,'history.sqlite')
 const store=await openSqliteRouterState({Database,file,legacyFile:join(f.dir,'absent-legacy.json')})
 const funded=createFundedRouterState({store,policy:{activeIdentity:()=>null},authority:{},pricingFor:async()=>null})
 const deferred=createDeferredRouterState({file});deferred.resolve(funded.state);installRouterStateStore(deferred.state)
 const manager=createRouterTerminals({useManaged:true,prepare:async()=>{},resolveLaunch:async()=>({...f.spec.launch,display:'fixed offline test'}),environment:()=>f.spec.env,
  allocateOutputParent:async()=>({path:join(f.dir,'output')}),releaseOutputParent:async()=>{}})
 try{
  const session=await manager.start({confirmed:true,target:'shell',mode:'interactive',cwd:f.dir,cols:100,rows:30})
  let saved
  for(let i=0;i<100;i++){saved=(await deferred.state.read()).terminalSessions.find(row=>row.id===session.sessionId);if(saved?.treeClosed&&saved?.outputClosed)break;await new Promise(resolve=>setTimeout(resolve,50))}
  assert.equal(saved?.treeClosed,true);assert.equal(saved?.outputClosed,true);assert.equal(saved?.backend,'managed');assert.equal(saved?.controlLost,false)
 }finally{manager.disposeAll();await deferred.state.close()}
})
test('process creation has an independent deadline after a peer connects',{skip:process.platform!=='win32',timeout:15000},async()=>{
 const f=await terminalFixture()
 const fake=`let text='';process.stdin.on('data',b=>{text+=b;if(!text.includes('\\n'))return;process.stdin.removeAllListeners('data');const spec=JSON.parse(text);const server=require('node:net').createServer(()=>process.stdout.write(JSON.stringify({control:'dataConnected'})+'\\n'));server.listen(spec.dataEndpoint,()=>process.stdout.write(JSON.stringify({control:'listening'})+'\\n'))})`
 await assert.rejects(createWindowsManagedTerminal(f.spec,{bootstrapTimeoutMs:5000,createTimeoutMs:100,spawnHelper:(_file,_args,options)=>spawn(process.execPath,['-e',fake],options)}),error=>error.code==='NATIVE_TERMINAL_CREATE_TIMEOUT'&&error.startupStage==='data')
 assert.equal(await stat(f.marker).catch(()=>null),null)
})
test('dsh TUI installation and the selected managed backend use the same rc.3',async()=>{
 const tool=getOfficialTool('dsh-tui');assert.equal(DSH_TUI_BACKEND_VERSION,'0.2.2-rc.3')
 for(const method of ['npm','pnpm']){
  const plan=resolveInstallPlan(tool,method,{installDir:'D:\\isolated',methods:{},registry:'https://registry.npmjs.org/'},{platform:'win32'})
  assert.ok(plan.args.includes('@deepseek-ai/dsh@0.2.2-rc.3'));assert.ok(!plan.args.some(arg=>arg.includes('rc.2')))
  if(method==='npm')assert.ok(plan.args.includes('--no-audit'))
 }
 const selection={preferred:true,directories:['D:\\isolated'],plan:{packageModuleRoots:['D:\\isolated\\node_modules']}}
 const dependencies={findNode:async()=>process.execPath,findEntries:async()=>[{entry:'D:\\isolated\\dsh.js',version:'0.2.2-rc.3'}]}
 const launch=await resolveDshTask('D:\\work','read-only',null,selection,dependencies)
 assert.equal(launch.file,process.execPath);assert.ok(launch.args.includes('--json'))
 const old=await resolveDshTask('D:\\work','read-only',null,selection,{...dependencies,findEntries:async()=>[{entry:'D:\\isolated\\old.js',version:'0.2.2-rc.2'}]})
 assert.match(old.unsupported,/所选安装目录.*rc.3/)
})
test('readiness timeout and cancellation finish verification without accepting a late success',async()=>{
 let complete,calls=0
 const late=new Promise(resolve=>complete=resolve)
 const result=await awaitInstallReadiness('dsh-tui',{}, {timeoutMs:20,readinessFor:()=>{calls++;return late}})
 assert.equal(result.ready,false);assert.equal(result.code,'INSTALL_READINESS_TIMEOUT');assert.equal(calls,1)
 complete({ready:true});await Promise.resolve();assert.equal(result.ready,false)
 const controller=new AbortController()
 const waiting=awaitInstallReadiness('dsh-tui',{}, {signal:controller.signal,timeoutMs:1000,readinessFor:()=>new Promise(()=>{})})
 controller.abort();assert.equal((await waiting).code,'INSTALL_VERIFICATION_CANCELLED')
})
test('installed bytes alone cannot declare execution readiness successful',async()=>{
 const job={tool:getOfficialTool('dsh-tui'),outputTail:[],controller:new AbortController()}
 await finishVerifiedInstall(job,{installed:true,version:'0.20.1'},{lookupLatest:async()=>({version:'0.20.1'}),readinessFor:async()=>({supported:true,ready:false,reason:'still verifying'})})
 assert.equal(job.status,'failed');assert.equal(job.postInstallProbe.installed,true);assert.match(job.error,/still verifying/)
})
test('install progress distinguishes a queued job, dependency work and post-install verification',()=>{
 const start='2026-11-16T15:00:00.000Z',now=Date.parse(start)+90000,job={status:'running',phase:'queued',startedAt:start}
 assert.match(installJobProgress(job,now).label,/等待其他工具/)
 const installing=installJobProgress({...job,phase:'installing',lastOutputAt:start},now)
 assert.equal(installing.elapsedSeconds,90);assert.equal(installing.waitingForOutput,true)
 assert.match(installJobProgress({...job,phase:'verifying'},now).label,/安装命令已完成/)
 assert.match(installJobProgress({...job,operation:'uninstall',phase:'verifying'},now).label,/卸载命令已完成/)
 assert.equal(installJobProgress({...job,status:'succeeded'},now),null)
 assert.equal(shouldApplyInstallStatus(job,{...job,startedAt:'2026-11-16T14:59:00.000Z'}),false)
})
