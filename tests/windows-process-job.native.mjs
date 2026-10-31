import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {spawn,execFileSync} from 'node:child_process'
import {setTimeout as sleep} from 'node:timers/promises'
import {legacyBarrierSource} from './fixtures/windows-process-job-legacy.mjs'
import {CONTROL_SOURCE} from './fixtures/windows-process-job-control.mjs'
const enabled=process.platform==='win32',real=(name,fn)=>test(name,{skip:!enabled,timeout:30000},fn)
const worker=resolve('tests/fixtures/windows-process-job-worker.mjs'),parentProgram=resolve('tests/fixtures/windows-process-job-agent-parent.mjs')
let build
async function compiled(){
 if(build)return build
 const root=resolve('tmp/integration/windows-job-checks');await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,'build-')),compiler=join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),source=resolve('native/windows-desktop/ProcessJob.cs'),control=join(dir,'control.cs'),legacy=join(dir,'legacy.cs')
 await writeFile(control,CONTROL_SOURCE);await writeFile(legacy,legacyBarrierSource())
 const compile=(file,name,define=[])=>{const output=join(dir,name+'.exe');execFileSync(compiler,['/nologo','/optimize+','/target:exe','/platform:anycpu','/out:'+output,'/reference:System.dll','/reference:System.Core.dll','/reference:System.Web.Extensions.dll',...define,file],{windowsHide:true});return output}
 build={dir,root,production:compile(source,'production'),barrier:compile(source,'barrier',['/define:DSH_JOB_TEST_BARRIER']),legacy:compile(legacy,'legacy'),control:compile(control,'control')};return build
}
async function wait(fn,ms=8000){const end=Date.now()+ms;while(Date.now()<end){const value=await fn();if(value)return value;await sleep(25)}throw Error('Owned Job fixture did not reach the expected state')}
const json=path=>readFile(path,'utf8').then(JSON.parse).catch(()=>null)
const within=(promise,ms=10000)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owned Job fixture close timeout')),ms);promise.then(v=>{clearTimeout(timer);resolve(v)},e=>{clearTimeout(timer);reject(e)})})
async function fixture(t){
 const b=await compiled(),dir=await mkdtemp(join(b.root,'case-')),owned=new Map(),children=[]
 const inspect=pid=>JSON.parse(execFileSync(b.control,['query',String(pid)],{encoding:'utf8',windowsHide:true}))
 const remember=(pid,expected)=>{const value=inspect(pid);assert.equal(value.alive,true);if(expected)assert.equal(value.creation,expected);owned.set(pid,value.creation);return value}
 const kill=pid=>{const expected=owned.get(pid);if(!expected)return;const value=inspect(pid);if(value.alive){assert.equal(value.creation,expected,'an owned PID was reused');execFileSync(b.control,['kill',String(pid),expected],{windowsHide:true})}}
 function launch(executable,request){
  const child=spawn(executable,[],{cwd:dir,windowsHide:true,stdio:['pipe','pipe','pipe']}),r={child,stdout:'',stderr:''};children.push(r)
  r.exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}))});r.exit.catch(()=>{})
  r.closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}))});r.closed.catch(()=>{})
  child.stdout.on('data',data=>{r.stdout=(r.stdout+data).slice(-1048576)});child.stderr.on('data',data=>{r.stderr=(r.stderr+data).slice(-1048576)});child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request)+'\n');return r
 }
 const request=(mode='report',args=[],patch={})=>({executable:process.execPath,args:[worker,mode,...args],cwd:dir,...patch})
 t.after(async()=>{for(const r of children){if(r.child.exitCode===null&&r.child.signalCode===null)r.child.kill('SIGKILL')}for(const [pid] of owned)kill(pid);await Promise.all(children.map(r=>within(r.closed).catch(()=>null)))})
 return {...b,dir,owned,children,inspect,remember,kill,launch,request}
}
real('Windows Job: exact Unicode, empty, quotes, newline and trailing-backslash argv survive native creation',async t=>{
 const f=await fixture(t),args=['a b','中文路径/文件','say "hi"','C:\\dir\\','line1\nline2','','\\','\\\\','tab\there'],r=f.launch(f.production,f.request('report',args));assert.equal((await within(r.closed)).code,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout).args,args);assert.equal(JSON.parse(r.stdout).cwd,f.dir)
})
real('Windows Job: child exit code and repeated normal cleanup keep their original result',async t=>{
 const f=await fixture(t);for(let i=0;i<12;i++){const r=f.launch(f.production,f.request('exit7'));assert.equal((await within(r.closed)).code,7,r.stderr)}
})
real('Windows Job: unavailable executable fails closed before any worker can run',async t=>{
 const f=await fixture(t),r=f.launch(f.production,f.request('report',[],{executable:join(f.dir,'missing.exe')}));assert.equal((await within(r.closed)).code,126);assert.match(r.stderr,/PROCESS_ISOLATION_UNAVAILABLE/)
})
real('Windows Job: production binary ignores runtime barrier fields',async t=>{
 const f=await fixture(t),r=f.launch(f.production,f.request('report',[],{barrier:{stage:'preCreate',dir:f.dir}}));assert.equal((await within(r.closed)).code,0,r.stderr);assert.equal(await json(join(f.dir,'gate-preCreate.json')),null)
})
real('Windows Job: normal direct-child exit kills an owned descendant before its delayed write',async t=>{
 const f=await fixture(t),ready=join(f.dir,'ready.json'),marker=join(f.dir,'late'),r=f.launch(f.production,f.request('exit-with-child',[ready,marker]));assert.equal((await within(r.closed)).code,0,r.stderr);const info=await json(ready);assert.ok(info);await wait(()=>!f.inspect(info.descendantPid).alive);await sleep(1000);assert.equal(await readFile(marker,'utf8').catch(()=>null),null)
})
real('Windows Job: deterministic legacy create-before-assign death leaves a suspended child, then exact-identity cleanup removes it',async t=>{
 const f=await fixture(t),gate=join(f.dir,'legacy.json'),r=f.launch(f.legacy,f.request('hold',[],{fixtureGate:gate})),value=await wait(()=>json(gate));assert.equal(value.inJob,false);f.remember(value.childPid,value.childStartFileTime);r.child.kill('SIGKILL');await within(r.exit);assert.equal(f.inspect(value.childPid).alive,true);f.kill(value.childPid);await within(r.closed);assert.equal(f.inspect(value.childPid).alive,false)
})
for(const stage of ['created','resumed'])real('Windows Job: launcher death at '+stage+' cannot leave the atomically admitted child alive',async t=>{
 const f=await fixture(t),ready=join(f.dir,'ready.json'),marker=join(f.dir,'late'),r=f.launch(f.barrier,f.request(stage==='resumed'?'tree':'hold',stage==='resumed'?[ready,marker]:[],{barrier:{stage,dir:f.dir}})),gate=await wait(()=>json(join(f.dir,'gate-'+stage+'.json')));assert.equal(gate.inJob,true);f.remember(gate.childPid,gate.childStartFileTime)
 let info;if(stage==='resumed'){info=await wait(()=>json(ready));f.remember(info.descendantPid)}r.child.kill('SIGKILL');await within(r.closed);await wait(()=>!f.inspect(gate.childPid).alive);if(info)await wait(()=>!f.inspect(info.descendantPid).alive);await sleep(1000);assert.equal(await readFile(marker,'utf8').catch(()=>null),null)
})
for(const stage of ['preCreate','created','resumed'])real('Windows Job: actual creator death at '+stage+' ends its launcher and original process tree',async t=>{
 const f=await fixture(t),ready=join(f.dir,'ready.json'),marker=join(f.dir,'late'),requestFile=join(f.dir,'request.json');await writeFile(requestFile,JSON.stringify(f.request(stage==='resumed'?'tree':'hold',stage==='resumed'?[ready,marker]:[],{barrier:{stage,dir:f.dir}})))
 const parent=spawn(process.execPath,[parentProgram,f.dir,f.barrier,requestFile],{cwd:f.dir,windowsHide:true,stdio:'ignore'}),closed=new Promise((done,reject)=>{parent.once('error',reject);parent.once('close',done)});f.children.push({child:parent,closed});closed.catch(()=>{})
 const gate=await wait(()=>json(join(f.dir,'gate-'+stage+'.json')));f.remember(gate.wrapperPid,gate.wrapperStartFileTime);if(gate.childPid){assert.equal(gate.inJob,true);f.remember(gate.childPid,gate.childStartFileTime)}let info;if(stage==='resumed'){info=await wait(()=>json(ready));f.remember(info.descendantPid)}
 parent.kill('SIGKILL');await within(closed);await wait(()=>!f.inspect(gate.wrapperPid).alive);if(gate.childPid)await wait(()=>!f.inspect(gate.childPid).alive);if(info)await wait(()=>!f.inspect(info.descendantPid).alive);await sleep(1000);assert.equal(await readFile(marker,'utf8').catch(()=>null),null)
})
