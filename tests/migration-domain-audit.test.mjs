import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile,readFile,rename} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {zstdCompressSync} from 'node:zlib'
import {sessionFormatCatalog} from '@deepseek-ai/dsh-session-format-catalog'
import {createUserMessage} from '@deepseek-ai/dsh-llm'
import {initialRouterState} from '../.dsh-plugin/shared/router-state.mjs'
import {previewProfileMigration} from '../packages/orchestration/src/profile-migration-plan.mjs'
import {inspectMigrationSources} from '../packages/orchestration/src/migration-snapshot.mjs'
import {createMigrationDataArchive} from '../packages/orchestration/src/migration-data-archive.mjs'
import {auditMigrationDataDomains,summarizeMigrationDomainAudit,reconcileMigrationDomainAudits} from '../packages/orchestration/src/migration-domain-audit.mjs'

const ROOT=resolve(import.meta.dirname,'..'),parent=resolve('tmp/integration/migration-domain-audit'),PRODUCT='@ljwei-stak/dsh-model-router',tz=Intl.DateTimeFormat().resolvedOptions().timeZone;await mkdir(parent,{recursive:true})
const json=x=>JSON.stringify(x)+'\n',line=x=>Buffer.from(json(x))
async function fixture({compression='none',simple=false}={}){
 const dir=await mkdtemp(join(parent,'case-')),home=join(dir,'home'),profile=join(home,'profiles/desktop'),bot=join(home,'bot'),sessions=join(home,'sessions'),attachments=join(home,'attachments'),router=join(home,'model-router')
 for(const path of [profile,bot,sessions,attachments,router])await mkdir(path,{recursive:true})
 async function bundle(folder,name,patch){const packageDir=join(dir,folder);await mkdir(packageDir);await writeFile(join(packageDir,'package.json'),json({name,version:'0.25.6-preview.1',dsh:{bundle:{patch:'cordis.patch.yml'}}}));await writeFile(join(packageDir,'cordis.patch.yml'),patch);return{packageName:name,packageDir}}
 const base=await bundle('base','@fixture/base',json([{insert:[{id:'web',name:'fixture-web',config:{searchProvider:'auto'}}]}])),mr=await bundle('old',PRODUCT,json([{insert:[{id:'model-router-galgame',name:PRODUCT,config:{dailyBudgetUsd:0,monthlyBudgetUsd:100}}]}])),target=await bundle('target',PRODUCT,await readFile(join(ROOT,'cordis.patch.yml'),'utf8'))
 await writeFile(join(profile,'package.json'),json({dsh:{profile:{bundles:[base.packageName,mr.packageName]}}}))
 const plan=await previewProfileMigration({profileDir:profile,dshHome:home,launchCwd:profile,orderedBundleLayers:[base,mr],launcherLayers:[],launchEnvironment:{},targetBundleLayer:target});assert.equal(plan.status,'ready')
 const team={version:1,mainBotIds:['bot-a'],bots:{'bot-a':{id:'bot-a',name:'PRIVATE-NAME',model:'fixture-gpt',sessionId:simple?'bot-a':'bot-current',segments:simple?[]:[{sessionId:'bot-a'}],capabilities:['cap-a']}},rooms:simple?{}:{'room-a':{id:'room-a',members:['bot-a'],admin:'bot-a',sessions:{'bot-a':'room-bot'},segments:{'bot-a':[{sessionId:'room-old'}]}}},agents:simple?{}:{agent:{id:'agent',sessions:['agent-session']}},capabilities:{items:{'cap-a':{id:'cap-a'}}}}
 await writeFile(join(bot,'state.json'),json(team));await writeFile(join(bot,'secrets.json'),json({version:1,secrets:[{name:'KEY',value:'SECRET-PRIVATE-KEY',scope:['bot-a']}]}));await writeFile(join(bot,'unknown-data'),'OPAQUE-PRIVATE');await writeFile(join(router,'state.json'),json(initialRouterState()))
 const data=Buffer.from('PRIVATE-FILE-CONTENT'),digest=createHash('sha256').update(data).digest('hex'),ref={attachmentId:'sha256:'+digest,name:'document.txt',bytes:data.length},attachmentPath=join(attachments,'v1/files',digest.slice(0,2),digest,ref.name);await mkdir(join(attachmentPath,'..'),{recursive:true});await writeFile(attachmentPath,data)
 async function session(id,{parentSession,version=4,events=[],pathId=id,cwd}={}){
  const header={version:4,id,createdAt:1,isSeeded:false,delegationDepth:parentSession?1:0,...(parentSession?{parentSession,origin:'subagent'}:{}),...(cwd?{cwd}:{})}
  const physical=version===4?sessionFormatCatalog.encodeCurrentHeader(header,0):{type:'session',version,id,createdAt:1,delegationDepth:0,...(version>=2?{isSeeded:false}:{})}
  const folder=join(sessions,'_no-cwd',pathId);await mkdir(folder,{recursive:true});const name=version===0?'session.jsonl':`session.v${version}.jsonl`,parts=[line(physical),...events.map(line)]
  await writeFile(join(folder,name+(compression==='zstd'?'.zstd':'')),compression==='zstd'?Buffer.concat(parts.map(p=>zstdCompressSync(p))):Buffer.concat(parts));return join(folder,name+(compression==='zstd'?'.zstd':''))
 }
 const ids=simple?['bot-a']:['bot-a','bot-current','room-a','room-bot','room-old','agent-session']
 for(const id of ids)await session(id,{events:id==='bot-a'?[{type:'user/message',seq:0,time:2,surfaceOp:'append',data:createUserMessage({content:[{type:'text',text:'PRIVATE-PROMPT'},{type:'file',attachment:ref}],source:{kind:'user'}})}]:[]})
 if(!simple)await session('child',{parentSession:'bot-current'})
 const selected=[{id:'bot',kind:'bot-data',root:bot},{id:'sessions',kind:'sessions',root:sessions},{id:'attachments',kind:'attachments',root:attachments},{id:'router',kind:'ledger',root:router}],output=join(dir,'archive')
 const layout={team:{sourceId:'bot',path:'state.json'},router:{sourceId:'router',path:'state.json'},secrets:{sourceId:'bot',path:'secrets.json'},usage:null,sessions:[{sourceId:'sessions',compression}],attachments:[{sourceId:'attachments',prefix:'v1'}],workspacePolicy:'preserve-in-place'}
 const f={dir,home,profile,bot,sessions,attachments,router,team,ref,attachmentPath,plan,selected,layout,output,session}
 f.saveTeam=()=>writeFile(join(bot,'state.json'),json(team));f.capture=async()=>createMigrationDataArchive({inventory:await inspectMigrationSources(selected),configurationPlan:plan,privateOutput:output});f.audit=(options={})=>auditMigrationDataDomains({privateOutput:output,layout,finance:{timeZone:tz},...options})
 return f
}

test('domain audit: actual SDK records retain Bot/Main/group/parts/Agent/child and attachment references',async()=>{
 const f=await fixture();await f.capture();const r=await f.audit();assert.equal(r.status,'audited',JSON.stringify(summarizeMigrationDomainAudit(r)));assert.equal(r.team.bots,1);assert.equal(r.team.rooms,1);assert.equal(r.team.agents,1);assert.equal(r.sessions.length,7);assert.equal(r.attachments.resolved,1);assert.equal(r.secrets.length,1);assert.equal(r.financial.budgets.dailyBudgetUsd.kind,'unbounded')
 assert.equal(r.applySupported,false);assert.equal(r.requiresCompleteDomainReview,true);assert.equal(r.requiresStopProof,true)
})
test('domain audit: independently framed compressed logs keep later attachment events',async()=>{
 const f=await fixture({compression:'zstd',simple:true});await f.capture();const r=await f.audit();assert.equal(r.status,'audited');assert.equal(r.attachments.resolved,1);assert.equal(r.sessions[0].eventCount,1)
})
test('domain audit: only the saved capture is read even when original directories are moved',async()=>{
 const f=await fixture({simple:true});await f.capture();const before=await f.audit();await rename(f.home,join(f.dir,'moved-original'));const after=await f.audit();assert.equal(reconcileMigrationDomainAudits(before,after).equal,true)
})
test('domain audit: missing current, historical and Agent Session references are detected',async()=>{
 const f=await fixture();f.team.bots['bot-a'].segments.push({sessionId:'missing-part'});f.team.agents.agent.sessions.push('missing-agent');f.team.rooms['room-a'].sessions['bot-a']='missing-current';await f.saveTeam();await f.capture();const r=await f.audit();assert.equal(r.status,'blocked');assert.ok(r.diagnostics.filter(d=>d.code==='MISSING_SESSION_REFERENCE').length>=3)
})
test('domain audit: dangling Main/member/capability identities and cross-owner sessions do not reassign',async()=>{
 const f=await fixture();f.team.mainBotIds.push('gone');f.team.rooms['room-a'].members.push('deleted');f.team.rooms['room-a'].sessions['bot-a']='bot-current';f.team.bots['bot-a'].capabilities.push('unknown-cap');await f.saveTeam();await f.capture();const r=await f.audit();for(const code of ['MISSING_BOT_REFERENCE','MISSING_CAPABILITY_REFERENCE','CONFLICTING_SESSION_OWNER'])assert.ok(r.diagnostics.some(d=>d.code===code));assert.equal(r.status,'blocked')
})
test('domain audit: duplicate header IDs, path binding violations and parent cycles are refused',async()=>{
 const f=await fixture({simple:true});await f.session('bot-a',{pathId:'impostor',parentSession:'loop'});await f.session('loop',{parentSession:'bot-a'});await f.capture();const r=await f.audit();for(const code of ['DUPLICATE_SESSION_ID','SESSION_STORAGE_BINDING_INVALID'])assert.ok(r.diagnostics.some(d=>d.code===code))
 const g=await fixture({simple:true});await g.session('bot-a',{parentSession:'loop'});await g.session('loop',{parentSession:'bot-a'});await g.capture();assert.ok((await g.audit()).diagnostics.some(d=>d.code==='SESSION_PARENT_CYCLE'))
})
test('domain audit: attachment digest and byte length mismatches remain explicit',async()=>{
 const f=await fixture({simple:true});await writeFile(f.attachmentPath,'CHANGED');await f.capture();const r=await f.audit();assert.equal(r.status,'blocked');assert.ok(r.diagnostics.some(d=>d.code==='ATTACHMENT_MISSING_OR_CHANGED'))
})
test('domain audit: secret scopes and values are preserved; removed Bot scopes remain orphaned',async()=>{
 const f=await fixture({simple:true});await writeFile(join(f.bot,'secrets.json'),json({version:1,secrets:[{name:'KEY',value:'PRIVATE-VALUE',scope:['bot-a','deleted-bot']}]}));await f.capture();const r=await f.audit();assert.equal(r.status,'audited');assert.deepEqual(r.secrets[0].scope,['bot-a','deleted-bot']);assert.ok(r.diagnostics.some(d=>d.code==='SECRET_SCOPE_ORPHAN'))
 const g=await fixture({simple:true});await writeFile(join(g.bot,'secrets.json'),json({version:2,secrets:[]}));await g.capture();assert.equal((await g.audit()).status,'blocked')
})
test('domain audit: unknown future generations and compression/context mismatches are not silently skipped',async()=>{
 const f=await fixture({simple:true});await f.session('bot-a',{version:5});await f.capture();const r=await f.audit();assert.equal(r.status,'blocked');assert.ok(r.diagnostics.some(d=>d.code==='SESSION_FORMAT_REFUSED'))
 const different=structuredClone(f.layout);different.sessions[0].compression='zstd';const other=await f.audit({layout:different});assert.ok(other.diagnostics.some(d=>d.code==='SESSION_COMPRESSION_CONTEXT'));assert.equal(other.applySupported,false)
})
test('domain audit: all historical generations stay distinct while current generation supplies active references',async()=>{
 const f=await fixture({simple:true});await f.session('bot-a',{version:0});await f.capture();const r=await f.audit();assert.equal(r.status,'audited');assert.equal(r.generations.length,2);assert.equal(r.sessions[0].version,4)
})
test('domain audit: historical parents collect their actual captured child facts and keep unknown descriptors visible',async()=>{
 const f=await fixture({simple:true});await rename(join(f.sessions,'_no-cwd/bot-a/session.v4.jsonl'),join(f.sessions,'preserved-old-copy'))
 await f.session('bot-a',{version:3});await f.session('historical-child',{parentSession:'bot-a'});await f.capture();const r=await f.audit()
 assert.equal(r.sessions.length,2);assert.equal(r.status,'needs-context');assert.ok(r.diagnostics.some(d=>d.code==='SESSION_CHILD_CONTEXT_REQUIRED'));assert.ok(r.sessions.some(s=>s.id==='historical-child'))
})
test('domain audit: explicit layouts, real usage export and workspace context cannot be guessed',async()=>{
 const f=await fixture({simple:true});f.team.workspaceId='workspace-private';f.team.bots['bot-a'].workDir=resolve('tmp/workspace-private');await f.saveTeam();await writeFile(join(f.bot,'usage.sqlite'),'SQLite format 3\0');await f.capture();const r=await f.audit();assert.equal(r.status,'needs-context');for(const code of ['WORKSPACE_REGISTRY_REQUIRED','FINANCE_CONTEXT_REQUIRED','LAYOUT_CONTEXT_REQUIRED'])assert.ok(r.diagnostics.some(d=>d.code===code))
 const missing=await f.audit({layout:{}});assert.ok(missing.diagnostics.some(d=>d.code==='LAYOUT_CONTEXT_REQUIRED'));assert.equal(missing.applySupported,false)
})
test('domain audit: bounded reads, cancellation and unexpected option limits refuse safely',async()=>{
 const f=await fixture({simple:true});await f.capture();await assert.rejects(f.audit({limits:{maxFileBytes:1}}),{code:'MIGRATION_DOMAIN_READ_LIMIT'});await assert.rejects(f.audit({limits:{maxSessions:0}}),{code:'MIGRATION_DOMAIN_INPUT_INVALID'})
 const controller=new AbortController();controller.abort();await assert.rejects(f.audit({signal:controller.signal}),{code:'MIGRATION_DOMAIN_CANCELLED'})
})
test('domain audit: public summaries redact private identities, values, file names and data digests',async()=>{
 const f=await fixture({simple:true});await f.capture();const r=await f.audit(),publicText=JSON.stringify(summarizeMigrationDomainAudit(r));for(const value of ['PRIVATE','bot-a','SECRET','document.txt',f.dir,r.fingerprint])assert.ok(!publicText.includes(value))
 const fake=summarizeMigrationDomainAudit({status:'PRIVATE',diagnostics:[{code:'PRIVATE',severity:'PRIVATE',id:'PRIVATE'}]});assert.equal(fake.status,'blocked');assert.deepEqual(fake.diagnostics,[{code:'UNKNOWN_DIAGNOSTIC',severity:'error'}]);assert.ok(!JSON.stringify(fake).includes('PRIVATE'))
 const edited=structuredClone(r);edited.sessions=[];assert.throws(()=>reconcileMigrationDomainAudits(r,edited),{code:'MIGRATION_DOMAIN_AUDIT_INVALID'})
})

test('domain audit: deeply nested and very wide opaque JSON cannot bypass interpretation limits',async()=>{
 const f=await fixture({simple:true});let deep={};for(let i=0;i<100;i++)deep={child:deep};f.team.extension=deep;await f.saveTeam();await f.capture()
 await assert.rejects(f.audit(),{code:'MIGRATION_DOMAIN_JSON_LIMIT'})
 const g=await fixture({simple:true});g.team.extension=Array(500).fill(null);await g.saveTeam();await g.capture()
 await assert.rejects(g.audit({limits:{maxJsonNodes:100}}),{code:'MIGRATION_DOMAIN_JSON_LIMIT'})
})
test('domain audit: selected memory/capability domains are audited from the saved capture and included in reconciliation',async()=>{
 const f=await fixture({simple:true});f.team.capabilities.items['cap-a']={name:'cap-a',kind:'skill',content:'PRIVATE-CAPABILITY'};await f.saveTeam();await mkdir(join(f.bot,'memory/bots/bot-a'),{recursive:true});await writeFile(join(f.bot,'memory/bots/bot-a/MEMORY.md'),'- PRIVATE-MEMORY\n');f.layout.supportingDomains={memory:[{sourceId:'bot',prefix:'memory'}],connectorConfig:{github:false}};await f.capture();const before=await f.audit();assert.equal(before.status,'audited');assert.equal(before.supportingDomains.memory.entries,1);assert.equal(summarizeMigrationDomainAudit(before).supportingDomains.capabilities,1)
 await rename(f.home,join(f.dir,'moved-home'));assert.equal(reconcileMigrationDomainAudits(before,await f.audit()).equal,true);const altered=structuredClone(before);altered.supportingDomains.memory.entries=0;assert.throws(()=>reconcileMigrationDomainAudits(before,altered),{code:'MIGRATION_DOMAIN_AUDIT_INVALID'})
})
test('domain audit: an explicit supporting-domain review cannot silently omit observed Bot memory files',async()=>{
 const f=await fixture({simple:true});f.team.capabilities.items['cap-a']={name:'cap-a',kind:'skill',content:'PRIVATE'};await f.saveTeam();await mkdir(join(f.bot,'memory/team'),{recursive:true});await writeFile(join(f.bot,'memory/team/MEMORY.md'),'- PRIVATE-MEMORY');f.layout.supportingDomains={memory:[]};await f.capture();const r=await f.audit();assert.equal(r.status,'needs-context');assert.ok(r.diagnostics.some(x=>x.field==='unselected-memory'));assert.equal(r.applySupported,false)
})
test('domain audit: captured memory pending state remains recovery-required and never changes the captured entry',async()=>{
 const f=await fixture({simple:true});f.team.capabilities.items['cap-a']={name:'cap-a',kind:'skill',content:'PRIVATE'};await f.saveTeam();await mkdir(join(f.bot,'memory'),{recursive:true});await writeFile(join(f.bot,'memory/pending.json'),json({id:'pending',op:'add',scope:'team',steps:[{action:'write',path:'team/MEMORY.md',text:'PRIVATE-NEXT'}],row:{id:'pending'}}));f.layout.supportingDomains={memory:[{sourceId:'bot',prefix:'memory'}]};await f.capture();const r=await f.audit();assert.equal(r.status,'needs-context');assert.ok(r.diagnostics.some(x=>x.code==='MEMORY_PENDING_RECOVERY_REQUIRED'));assert.equal(r.supportingDomains.memory.entries,0);assert.equal(r.applySupported,false)
})

test('domain audit: captured SDK workspace unit closes declared membership without consulting live paths',async()=>{
 const f=await fixture({simple:true}),cwd=process.platform==='win32'?'C:\\missing\\private-workspace':'/missing/private-workspace'
 f.team.workspaceId='workspace';await f.saveTeam();const original=await f.session('bot-a',{cwd})
 const {sessionStorageAddress}=await import('../packages/orchestration/src/migration-session-reader.mjs');const path=join(f.sessions,sessionStorageAddress({id:'bot-a',cwd}),'session.v4.jsonl');await mkdir(join(path,'..'),{recursive:true});await rename(original,path)
 const registry={unit:{name:'workspace',version:2},global:{initialized:true,workspaceIds:['workspace']},tables:{workspaces:{workspace:{path:cwd,title:'PRIVATE',sessionIds:['bot-a'],createdAt:'a',updatedAt:'b'}}}}
 await writeFile(join(f.bot,'workspace.json'),json(registry));f.layout.workspaceRegistry={sourceId:'bot',path:'workspace.json',format:'sdk-json-single',platform:process.platform}
 await f.capture();const r=await f.audit();assert.equal(r.status,'audited',JSON.stringify(summarizeMigrationDomainAudit(r)));assert.equal(r.workspaceRegistry.records.length,1);assert.equal(r.workspaceRegistry.membership[0].cwdMatchesSavedPath,true);assert.equal(summarizeMigrationDomainAudit(r).workspaceRecords,1);assert.equal(r.applySupported,false)
})
