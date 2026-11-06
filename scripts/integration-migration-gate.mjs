import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,mkdtemp,writeFile,readFile,copyFile,symlink} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {createServer} from 'node:net'
import {resolve,join,dirname} from 'node:path'
import {pathToFileURL} from 'node:url'
import {setTimeout as sleep} from 'node:timers/promises'
import {resolverAnchor} from './integration-upstream-tests.mjs'
import {combinedOverlay,isolatedHostEnvironment} from './integration-combined-host.mjs'
import {killProcessTree} from '../.dsh-plugin/shared/task-executors.mjs'
import {prepareMigrationConfigurationCommit,resumeMigrationConfigurationCommit,inspectMigrationConfigurationCommit} from '../packages/orchestration/src/migration-configuration-commit.mjs'
import {inspectMigrationSources,reconcileMigrationInventories} from '../packages/orchestration/src/migration-snapshot.mjs'
const ROOT=resolve(import.meta.dirname,'..'),hostIndex=process.argv.indexOf('--host-root'),hostRoot=resolve(hostIndex>=0?process.argv[hostIndex+1]:join(ROOT,'tests/fixtures/integration-host'))
const {anchor}=await resolverAnchor(hostRoot);await copyFile(join(ROOT,'tests/fixtures/integration-combined/mock-plugin.mjs'),join(anchor,'offline-model.mjs'))
const parent=join(ROOT,'tmp/integration/migration-gate');await mkdir(parent,{recursive:true});const run=await mkdtemp(join(parent,'run-')),home=join(run,'home'),profile=join(home,'profiles/migration-gate'),workspace=join(run,'workspace'),privateOutput=join(run,'transaction-private')
await mkdir(join(profile,'node_modules/@ljwei-stak'),{recursive:true});await mkdir(workspace);await symlink(ROOT,join(profile,'node_modules/@ljwei-stak/dsh-model-route-bot'),process.platform==='win32'?'junction':'dir')
await writeFile(join(profile,'package.json'),JSON.stringify({name:'migration-gate-offline',private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@ljwei-stak/dsh-model-route-bot']}}}))
const patches=[...combinedOverlay(join(anchor,'offline-model.mjs')).filter(row=>row.id!=='bot'),{id:'model-router-galgame',config:{botRuntime:{memory:false,memoryReview:false,browser:false,github:false,diagnosticsFile:false,workspace}}}],before=Buffer.from(JSON.stringify(patches,null,2)+'\n'),path=join(profile,'cordis.patch.yml')
await writeFile(path,before)
const requireHost=createRequire(join(hostRoot,'package.json')),sdkPath=requireHost.resolve('@deepseek-ai/dsh/package.json'),sdk=JSON.parse(await readFile(sdkPath,'utf8'));assert.equal(sdk.version,'0.2.1-rc.3');const bin=resolve(dirname(sdkPath),sdk.bin.dsh)
const socket=createServer();await new Promise(done=>socket.listen(0,'127.0.0.1',done));const port=socket.address().port;await new Promise(done=>socket.close(done));const base=`http://127.0.0.1:${port}`
let child,closed=true,exit,cookie,timer,chunks=[]
const output=()=>Buffer.concat(chunks).toString('utf8')
async function until(fn){const end=Date.now()+30000;while(Date.now()<end){const r=await fn();if(r)return r;if(closed)throw Error('Owned gate Host exited before observation');await sleep(50)}throw Error('Owned gate Host observation timed out')}
async function launch(blocked=false){
 chunks=[];closed=false;let bytes=0
 child=spawn(process.execPath,['--import',pathToFileURL(join(ROOT,'modules/bot-runtime/vendor/ds-bot/test/harness-resolve.mjs')).href,'--import',pathToFileURL(join(ROOT,'tests/fixtures/integration-combined/offline-preload.mjs')).href,bin,'--profile','migration-gate','--no-open','--host','127.0.0.1','--port',String(port)],{cwd:workspace,env:isolatedHostEnvironment(home,anchor),windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']})
 exit=new Promise((done,reject)=>{child.once('error',reject);child.once('close',code=>{closed=true;done(code)})});const capture=c=>{bytes+=c.length;if(bytes<4*1024**2)chunks.push(c);else killProcessTree(child)};child.stdout.on('data',capture);child.stderr.on('data',capture);timer=setTimeout(()=>killProcessTree(child),45000)
 if(blocked){await until(()=>output().includes('PROFILE_MIGRATION_PENDING'));return}
 const url=await until(()=>output().match(new RegExp(`${base.replaceAll('.','\\.')}\\/\\?token=[^\\s]+`))?.[0]);const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(5000)});cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');assert.ok(cookie)
}
async function stop(label){
 if(!child)return;clearTimeout(timer);if(!closed)killProcessTree(child);let t
 try{await Promise.race([exit,new Promise((_,reject)=>{t=setTimeout(()=>reject(Error('Owned gate Host stop unconfirmed')),10000)})])}finally{clearTimeout(t)}
 await writeFile(join(run,label+'.log'),output().replace(/(\?token=)[^\s]+/g,'$1[redacted]'));child=null
}
async function api(name,body){const r=await fetch(`${base}/api/${name}`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body??{}),signal:AbortSignal.timeout(5000)});if(r.status!==200)return {httpStatus:r.status};return r.json()}
async function botState(){return until(async()=>{const r=await api('bot',{endpoint:'state',payload:{}});return r.ok&&r.value})}
const inventory=()=>inspectMigrationSources([{id:'bot',kind:'bot-data',root:join(home,'bot')},{id:'money',kind:'ledger',root:join(home,'model-router')}])
const checks=[];let result
try{
 await launch();const initial=await botState(),main=initial.bots.find(b=>b.id===initial.mainBotId);assert.ok(main);assert.equal((await api('integration-probe')).calls.length,0);await stop('baseline');const baseline=await inventory();checks.push('Actual fixed rc.3 default product saves Main/Session with zero model calls and its owned Host is stopped')
 const maintenance=Buffer.from(JSON.stringify([...patches,{id:'model-router-galgame',disabled:true}],null,2)+'\n');await prepareMigrationConfigurationCommit({home,privateOutput,changes:[{path,beforeSha256:createHash('sha256').update(before).digest('hex'),maintenance,after:before}]})
 await launch(true);await stop('prepared-blocked');assert.equal(reconcileMigrationInventories(baseline,await inventory()).equal,true);checks.push('Prepared startup gate is enforced by actual public apply before money/Task/Bot writers; saved data bytes unchanged')
 await resumeMigrationConfigurationCommit({privateOutput,phase:'maintenance'});await launch();await until(async()=>Array.isArray((await api('integration-probe')).calls));assert.equal((await api('bot-product',{action:'snapshot'})).httpStatus,404);assert.equal((await api('integration-probe')).calls.length,0);await stop('maintenance-disabled');assert.equal(reconcileMigrationInventories(baseline,await inventory()).equal,true);checks.push('Maintenance patch is understood by actual SDK Loader and disables the product entry without starting a writer')
 await resumeMigrationConfigurationCommit({privateOutput,phase:'install'});assert.equal((await inspectMigrationConfigurationCommit({privateOutput})).phase,'validating');await launch(true);await stop('installed-pending');assert.equal(reconcileMigrationInventories(baseline,await inventory()).equal,true);checks.push('Installed final bytes still cannot activate while gate is validating; stored Bot and ledger bytes remain unchanged')
 await resumeMigrationConfigurationCommit({privateOutput,phase:'rollback'});assert.deepEqual(await readFile(path),before);checks.push('Pre-activation rollback restores original reviewed configuration bytes and writes the terminal gate last')
 await launch();const restored=await botState(),same=restored.bots.find(b=>b.id===main.id);assert.equal(restored.mainBotId,main.id);assert.equal(same.sessionId,main.sessionId);assert.equal((await api('integration-probe')).calls.length,0);await stop('rollback-restarted');checks.push('Actual cold restart after rollback retains exact Main/Session identity with zero model requests')
 await resumeMigrationConfigurationCommit({privateOutput,phase:'rollback'});assert.deepEqual(await readFile(path),before);assert.equal((await inspectMigrationConfigurationCommit({privateOutput})).recognized,true);checks.push('Repeated pre-activation rollback is idempotent; no model request or post-activation data rollback is inferred')
 result={status:'passed',checks,sdkVersion:sdk.version,actualModelCalls:0,level:'actual-fixed-rc3-host-startup-gate-and-preactivation-configuration-recovery',activationSupported:false,limitations:['Synthetic owned Host fixture only; no real user application stopped or configuration/data changed','This exercises reviewed configuration bytes and the public product startup gate; original/unknown legacy launchers still need explicit stop/gating evidence','Full data-domain/consistent-backup/OS-metadata/artifact/money/location and post-activation rollback gates remain required; no activation API is exposed by this component']}
}catch(e){result={status:'failed',checks,error:e.stack};process.exitCode=1}finally{await stop('last')}
await writeFile(join(run,'summary.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,runDirectory:run},null,2))
