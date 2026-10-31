import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdir,mkdtemp,readFile,writeFile,stat,realpath} from 'node:fs/promises'
import {join,dirname,resolve,relative,isAbsolute} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import Database from 'better-sqlite3'
import {killProcessTree} from '../.dsh-plugin/shared/task-executors.mjs'
import {previewProfileMigration} from '../packages/orchestration/src/profile-migration-plan.mjs'
import {inspectMigrationSources} from '../packages/orchestration/src/migration-snapshot.mjs'
import {createPrivateMigrationDirectory} from '../packages/orchestration/src/migration-private-files.mjs'
import {createMigrationLedgerArchive} from '../packages/orchestration/src/migration-ledger-export.mjs'
import {createMigrationDataArchive} from '../packages/orchestration/src/migration-data-archive.mjs'
import {auditMigrationDataDomains,reconcileMigrationDomainAudits,summarizeMigrationDomainAudit} from '../packages/orchestration/src/migration-domain-audit.mjs'

const ROOT=resolve(import.meta.dirname,'..'),hostIndex=process.argv.indexOf('--host-root'),hostRoot=resolve(hostIndex>=0?process.argv[hostIndex+1]:join(ROOT,'tests/fixtures/integration-host'))
const parent=join(ROOT,'tmp/integration/migration-audit');await mkdir(parent,{recursive:true});const run=await mkdtemp(join(parent,'run-'))
const checks=[];let result
async function actualHost(){
 const child=spawn(process.execPath,[join(ROOT,'scripts/integration-web-search-config.mjs'),'--host-root',hostRoot,'--migration-audit-fixture','--migration-supporting-fixture'],{cwd:ROOT,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']})
 const chunks=[],errors=[];let size=0,closed=false,timedOut=false
 const collect=(target,chunk)=>{size+=chunk.length;if(size>8*1024**2)killProcessTree(child);else target.push(chunk)}
 child.stdout.on('data',c=>collect(chunks,c));child.stderr.on('data',c=>collect(errors,c))
 const timer=setTimeout(()=>{timedOut=true;killProcessTree(child)},90000)
 try{
  const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',value=>{closed=true;done(value)})})
  await writeFile(join(run,'host.stdout.log'),Buffer.concat(chunks));await writeFile(join(run,'host.stderr.log'),Buffer.concat(errors))
  assert.equal(timedOut,false);assert.equal(code,0);const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));assert.equal(value.status,'passed');assert.equal(value.actualModelCalls,0);return value
 }finally{clearTimeout(timer);if(!closed)killProcessTree(child)}
}
try{
 const sourceIndex=process.argv.indexOf('--source-run')
 let host
 if(sourceIndex>=0){
  const sourceRun=await realpath(resolve(process.argv[sourceIndex+1])),allowed=await realpath(join(ROOT,'tmp/integration/web-search-config')),rest=relative(allowed,sourceRun)
  assert.ok(rest&&!rest.startsWith('..')&&!isAbsolute(rest));const saved=JSON.parse(await readFile(join(sourceRun,'summary.json'),'utf8'));assert.equal(saved.status,'passed');assert.equal(saved.actualModelCalls,0);assert.equal(saved.sdkVersion,'0.2.1-rc.3');host={...saved,runDirectory:sourceRun}
 }else host=await actualHost()
 checks.push('Actual fixed rc.3 public Host configuration/cold-restart6 completed and its owned process exited with zero model requests')
 const home=join(host.runDirectory,'home'),profile=join(home,'profiles/web-search-config'),bot=join(host.runDirectory,'自定义团队 custom home'),workspace=join(host.runDirectory,'工作目录 workspace')
 const from=createRequire(createRequire(join(hostRoot,'package.json')).resolve('@deepseek-ai/dsh/package.json'))
 const names=JSON.parse(await readFile(join(profile,'package.json'),'utf8')).dsh.profile.bundles
 for(const path of [home,profile,bot,workspace]){const actual=await realpath(path),rest=relative(await realpath(host.runDirectory),actual);assert.ok(rest&&!rest.startsWith('..')&&!isAbsolute(rest))}
 const plan=await previewProfileMigration({profileDir:profile,dshHome:home,launchCwd:workspace,launcherLayers:[],launchEnvironment:{},availableSearchProviderIds:['auto','fixture-search'],orderedBundleLayers:names.map(packageName=>({packageName,packageDir:packageName==='@ljwei-stak/dsh-model-router'?ROOT:dirname(from.resolve(packageName+'/package.json'))})),targetBundleLayer:{packageName:'@ljwei-stak/dsh-model-router',packageDir:ROOT}})
 assert.equal(plan.status,'ready',JSON.stringify(plan.summary));checks.push('Pure configuration plan accepts actual installed SDK bundle layers and custom saved Bot paths')
 const privateRoot=join(tmpdir(),'dsh-migration-audit-'+randomUUID());await createPrivateMigrationDirectory(privateRoot)
 async function snapshot(path,name){const db=new Database(path,{readonly:true,fileMustExist:true});try{await createMigrationLedgerArchive({Database,database:db,privateOutput:join(privateRoot,name)})}finally{db.close()}return JSON.parse(await readFile(join(privateRoot,name,'ledger-export.private.json'),'utf8'))}
 const ledgerExport=await snapshot(join(home,'model-router/orchestration.sqlite'),'money'),usageExport=await snapshot(join(bot,'usage.sqlite'),'usage')
 assert.equal(usageExport.userVersion,2);checks.push('Native online snapshots preserve the actual fixture money/journal and frozen DS usage v2 without opening a writer')
 const selected=[{id:'bot',kind:'bot-data',root:bot},{id:'sessions',kind:'sessions',root:join(home,'sessions')},{id:'router',kind:'ledger',root:join(home,'model-router')}]
 selected.push({id:'storages',kind:'other',root:join(home,'storages')})
 if(await stat(join(home,'attachments')).then(s=>s.isDirectory(),()=>false))selected.push({id:'attachments',kind:'attachments',root:join(home,'attachments')})
 const inventory=await inspectMigrationSources(selected),capture=join(privateRoot,'capture');await createMigrationDataArchive({inventory,configurationPlan:plan,privateOutput:capture})
 const logs=inventory.sources.find(s=>s.id==='sessions').entries.filter(e=>e.type==='file'&&/session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(e.path));assert.ok(logs.length>0)
 const compressed=new Set(logs.map(e=>e.path.endsWith('.zstd')?'zstd':'none'));assert.equal(compressed.size,1)
 const layout={team:{sourceId:'bot',path:'state.json'},router:{sourceId:'router',path:'state.json'},usage:{sourceId:'bot',path:'usage.sqlite'},secrets:{sourceId:'bot',path:'secrets.json',optional:true},sessions:[{sourceId:'sessions',compression:[...compressed][0]}],attachments:selected.some(s=>s.id==='attachments')?[{sourceId:'attachments',prefix:'v1'}]:[],workspacePolicy:'preserve-in-place'}
 layout.workspaceRegistry={sourceId:'storages',path:'workspace.json',format:'sdk-json-single',platform:process.platform}
 if(host.supportingDomainsFixture)layout.supportingDomains={memory:[{sourceId:'bot',prefix:'memory'}],connectorConfig:{github:false}}
 const options={privateOutput:capture,layout,finance:{ledgerExport,usageExport,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}},audit=await auditMigrationDataDomains(options)
 assert.ok(audit.team.bots>0);assert.ok(audit.sessions.length>0);assert.equal(audit.financial.status,'audited');assert.equal(audit.financial.budgets.dailyBudgetUsd.amountUsd,17)
 const errors=audit.diagnostics.filter(d=>d.severity==='error');assert.deepEqual(errors,[],JSON.stringify(summarizeMigrationDomainAudit(audit)))
 assert.ok(audit.diagnostics.every(d=>['UNINTERPRETED_EXTENSION_RECORD','WORKSPACE_EXTENSION_DATA_PRESERVED'].includes(d.code)))
 assert.equal(audit.status,'audited');assert.equal(audit.workspaceRegistry.status,'audited');assert.ok(audit.workspaceRegistry.records.length>0);assert.ok(audit.workspaceRegistry.membership.every(m=>m.cwdMatchesSavedPath));checks.push('Captured fixed SDK workspace registry, team identity and Session/cwd accounting reconcile without live path access')
 checks.push('Actual JSONL storage addresses, compressed frames, Main/current Session and full financial references decode through the pure installed catalog')
 if(host.supportingDomainsFixture){assert.equal(audit.supportingDomains.status,'audited');assert.ok(audit.supportingDomains.memory.entries>=2);assert.ok(audit.supportingDomains.memory.journal.length>=2);assert.ok(audit.supportingDomains.capabilities.bindings.some(b=>b.expanded.includes('fixture-skill')));checks.push('Actual frozen remember entry/topic/journal and saved capability attachment are audited from the verified capture without replay or model requests')}
 assert.equal(reconcileMigrationDomainAudits(audit,await auditMigrationDataDomains(options)).equal,true);checks.push('Repeated archive-only identity/reference/money/workspace audit is equal; remaining domains stay separate')
 assert.equal(audit.applySupported,false);assert.equal(audit.requiresStopProof,true);checks.push('No migration apply/activation or stopped live-desktop claim is inferred from a passing fixture')
 result={status:'passed',level:'actual-fixed-rc3-host-private-capture-audit',checks,sdkVersion:'0.2.1-rc.3',actualModelCalls:0,externalSearchCalls:0,fixtureSearchCalls:host.fixtureSearchCalls,summary:summarizeMigrationDomainAudit(audit),limitations:['Synthetic fixture only; no real user data or installation','Workspace checks saved membership/cwd identity only; live path canonicalization/existence/access and remaining domains/OS metadata/stop gate/recoverable apply/rollback remain incomplete','Host uses a known fixture launcher; ephemeral network arguments are not a profile migration acceptance proof']}
 await writeFile(join(run,'private-fixture-location.json'),JSON.stringify({privateRoot,capture},null,2)+'\n')
}catch(e){result={status:'failed',checks,error:e.stack};process.exitCode=1}
await writeFile(join(run,'summary.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,runDirectory:run},null,2))
