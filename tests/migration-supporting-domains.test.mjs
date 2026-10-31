import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {auditMigrationSupportingDomains as audit,summarizeMigrationSupportingDomains as summary} from '../packages/orchestration/src/migration-supporting-domains.mjs'
const file=(path,value)=>({path,bytes:Buffer.from(typeof value==='string'?value:JSON.stringify(value))})
const idName=id=>createHash('sha256').update(id).digest('hex').slice(0,32)
const row=(patch={})=>({id:'change-a',time:'2026-10-29T00:00:00.000Z',op:'add',scope:'bot:bot-a',file:'MEMORY.md',actor:'user',after:'- PRIVATE-TEXT',...patch})
function fixture(){return {team:{version:1,bots:{'bot-a':{id:'bot-a',capabilities:['pack-a']},'bot-b':{id:'bot-b',capabilities:[]}},rooms:{'room-a':{id:'room-a'}},capabilities:{items:{'skill-a':{name:'skill-a',kind:'skill',content:'PRIVATE-SKILL'},'http-a':{name:'http-a',kind:'mcp',transport:'streamable-http',url:'https://example.invalid/mcp/$DSH_SECRET_KEY',headers:{Authorization:'Bearer $DSH_SECRET_KEY'},approved:true},'pack-a':{name:'pack-a',kind:'pack',items:['skill-a','http-a']}}}},secrets:{version:1,secrets:[{name:'KEY',value:'PRIVATE-KEY',scope:['bot-a']}]},sessionIds:['session-a'],memoryFiles:[file('bots/bot-a/MEMORY.md','# Private\n- PRIVATE-TEXT [source: user; at: today]\n## Index\n- [[主题]]\n'),file('bots/bot-a/主题.md','# 主题\n- PRIVATE-TOPIC\n'),file('team/MEMORY.md','- PRIVATE-TEAM\n'),file('groups/room-a/MEMORY.md','- PRIVATE-GROUP\n'),file('snapshots/session-a.md','# PRIVATE-FROZEN\n'),file('summaries/bot-a.json',{hash:'PRIVATE-SUMMARY-HASH',text:'PRIVATE-SUMMARY',at:1}),file('reviewed.json',{'chat:session-a':3,'group:room-a':2}),file('journal.jsonl',JSON.stringify(row())+'\n')]}}
test('supporting domains: frozen memory entries, metadata, topics, group scopes, snapshots and review cursors are preserved',()=>{
 const f=fixture(),original=f.memoryFiles.map(x=>Buffer.from(x.bytes)),r=audit(f)
 assert.equal(r.status,'audited');assert.equal(r.memory.entries,4);assert.equal(r.memory.journal.length,1);assert.equal(r.memory.snapshots[0].sessionId,'session-a');assert.equal(r.memory.reviewCursors.length,2);assert.equal(r.memory.summaries[0].ownerId,'bot-a');assert.deepEqual(f.memoryFiles.map(x=>x.bytes),original);assert.equal(r.applySupported,false)
})
test('supporting domains: non-path identities use the original hashed filename without renaming owner IDs',()=>{
 const f=fixture(),id='private/bot.中文';f.team.bots[id]={id,capabilities:[]};f.sessionIds.push(id);f.memoryFiles.push(file(`bots/${idName(id)}/MEMORY.md`,'- PRIVATE-HASHED'),file(`snapshots/${idName(id)}.md`,'PRIVATE-FROZEN'))
 const r=audit(f);assert.equal(r.status,'audited');assert.equal(r.memory.documents.find(x=>x.owner===id).owner,id);assert.ok(r.memory.snapshots.some(x=>x.sessionId===id))
})
test('supporting domains: deleted memory archives and journal destinations remain historical instead of becoming live Bots',()=>{
 const f=fixture();f.memoryFiles.push(file('archive/deleted-old/MEMORY.md','- PRIVATE-DELETED'));f.memoryFiles.find(x=>x.path==='journal.jsonl').bytes=Buffer.from(JSON.stringify(row({op:'archive',scope:'bot:deleted',to:'archive/deleted-old'}))+'\n');const r=audit(f);assert.equal(r.status,'audited');assert.equal(r.memory.archiveFiles,1);assert.equal(r.memory.documents.length,4)
 const bad=fixture();bad.memoryFiles.find(x=>x.path==='journal.jsonl').bytes=Buffer.from(JSON.stringify(row({op:'archive',to:'archive/missing'})));assert.ok(audit(bad).diagnostics.some(x=>x.code==='MEMORY_ARCHIVE_MISSING'))
})
test('supporting domains: conflicting journal IDs fail, while a complete final row without newline is retained',()=>{
 const f=fixture(),journal=f.memoryFiles.find(x=>x.path==='journal.jsonl');journal.bytes=Buffer.from(JSON.stringify(row()));assert.equal(audit(f).memory.journal.length,1)
 journal.bytes=Buffer.from(JSON.stringify(row())+'\n'+JSON.stringify(row({after:'changed'}))+'\n');assert.equal(audit(f).status,'blocked');assert.ok(audit(f).diagnostics.some(x=>x.code==='MEMORY_JOURNAL_CONFLICT'))
})
test('supporting domains: torn tails, old torn evidence and unknown journal operations require context without truncating',()=>{
 const f=fixture(),journal=f.memoryFiles.find(x=>x.path==='journal.jsonl');journal.bytes=Buffer.concat([journal.bytes,Buffer.from('{"id":')]);const before=Buffer.from(journal.bytes);assert.equal(audit(f).status,'needs-context');assert.deepEqual(journal.bytes,before)
 const g=fixture();g.memoryFiles.push(file('journal.torn','PRIVATE-TORN'));assert.equal(audit(g).status,'needs-context')
 const h=fixture();h.memoryFiles.find(x=>x.path==='journal.jsonl').bytes=Buffer.from(JSON.stringify(row({op:'future-operation'})));assert.equal(audit(h).status,'needs-context')
})
test('supporting domains: a pending change stays pending even when its original journal ID already exists',()=>{
 const f=fixture();f.memoryFiles.push(file('pending.json',{id:'change-a',op:'add',scope:'bot:bot-a',steps:[{action:'write',path:'bots/bot-a/MEMORY.md',text:'PRIVATE-NEXT'}],row:row()}));const r=audit(f);assert.equal(r.status,'needs-context');assert.equal(r.memory.pending.journaled,true);assert.ok(r.diagnostics.some(x=>x.code==='MEMORY_PENDING_RECOVERY_REQUIRED'));assert.ok(f.memoryFiles[0].bytes.includes('PRIVATE-TEXT'))
})
test('supporting domains: pending paths cannot be reinterpreted across Windows, POSIX or alternate-stream boundaries',()=>{
 for(const path of ['../outside','/outside','C:/outside','file:stream','a\\b','\\\\host\\share']){const f=fixture();f.memoryFiles.push(file('pending.json',{id:'pending',op:'add',scope:'team',steps:[{action:'write',path,text:'PRIVATE'}],row:row({id:'pending'})}));assert.ok(audit(f).diagnostics.some(x=>x.code==='MEMORY_PENDING_PATH_INVALID'))}
})
test('supporting domains: missing topics and invalid Index names remain explicit',()=>{
 const f=fixture();f.memoryFiles=f.memoryFiles.filter(x=>!x.path.endsWith('/主题.md'));assert.ok(audit(f).diagnostics.some(x=>x.code==='MEMORY_TOPIC_MISSING'))
 const g=fixture();g.memoryFiles[0]=file(g.memoryFiles[0].path,'## Index\n- [[../outside]]');assert.ok(audit(g).diagnostics.some(x=>x.code==='MEMORY_TOPIC_LINK_INVALID'))
})
test('supporting domains: orphan scopes and review/snapshot caches survive with warnings, without fabricated owners',()=>{
 const f=fixture();f.memoryFiles.push(file('bots/deleted/MEMORY.md','- OLD'),file('snapshots/deleted.md','OLD'),file('summaries/deleted.json',{hash:'old',text:'OLD'}));f.memoryFiles.find(x=>x.path==='reviewed.json').bytes=Buffer.from(JSON.stringify({'chat:deleted':-1}));const r=audit(f);assert.equal(r.status,'audited');for(const code of ['MEMORY_SCOPE_ORPHAN','MEMORY_SNAPSHOT_ORPHAN','MEMORY_SUMMARY_ORPHAN','MEMORY_REVIEW_ORPHAN'])assert.ok(r.diagnostics.some(x=>x.code===code));assert.equal(r.memory.documents.find(x=>x.path.includes('deleted')).owner,null)
})
test('supporting domains: unknown binary files are preserved and need review instead of being decoded as memory',()=>{
 const f=fixture();f.memoryFiles.push({path:'future/cache.bin',bytes:Buffer.from([255,0,254])});const r=audit(f);assert.equal(r.status,'needs-context');assert.equal(r.memory.opaqueFiles,1);assert.ok(r.memory.files.some(x=>x.path==='future/cache.bin'&&x.bytes===3))
})
test('supporting domains: malformed known UTF-8, JSON and cursor values do not become empty successful domains',()=>{
 for(const entry of [{path:'team/MEMORY.md',bytes:Buffer.from([255])},file('reviewed.json','{broken'),file('reviewed.json',{key:'invalid'}),file('summaries/bot-a.json',{text:4}),file('pending.json',{version:9})]){const f=fixture();f.memoryFiles=f.memoryFiles.filter(x=>x.path!==entry.path);f.memoryFiles.push(entry);assert.equal(audit(f).status,'blocked')}
})
test('supporting domains: real flat pack expansion preserves original attachments and stdio approvals',()=>{
 const f=fixture();f.team.capabilities.items['stdio-a']={name:'stdio-a',kind:'mcp',transport:'stdio',command:'fixture-program',args:['$DSH_SECRET_KEY'],env:{},approved:false};f.team.capabilities.items['pack-a'].items.push('stdio-a');const r=audit(f);assert.equal(r.status,'audited');assert.deepEqual(r.capabilities.bindings.find(x=>x.botId==='bot-a').expanded,['skill-a','http-a','stdio-a']);assert.equal(r.capabilities.items.find(x=>x.name==='stdio-a').approved,false);assert.equal(f.team.capabilities.items['stdio-a'].approved,false);assert.ok(r.diagnostics.some(x=>x.code==='CAPABILITY_UNAPPROVED_PRESERVED'))
})
test('supporting domains: missing or nested packs fail original flat-pack semantics',()=>{
 for(const child of ['missing','pack-b']){const f=fixture();f.team.capabilities.items['pack-b']={name:'pack-b',kind:'pack',items:['skill-a']};f.team.capabilities.items['pack-a'].items.push(child);assert.equal(audit(f).status,'blocked');assert.ok(audit(f).diagnostics.some(x=>x.code==='CAPABILITY_REFERENCE_INVALID'))}
})
test('supporting domains: missing and empty-scope secrets remain unavailable; no scope is widened during audit',()=>{
 const f=fixture();f.secrets.secrets[0].scope=[];const r=audit(f);assert.equal(r.status,'needs-context');assert.equal(r.capabilities.references[0].allowed,false);assert.deepEqual(f.secrets.secrets[0].scope,[]);assert.ok(r.diagnostics.some(x=>x.code==='CAPABILITY_SECRET_DENIED'))
 const g=fixture();g.secrets=null;assert.ok(audit(g).diagnostics.some(x=>x.code==='CAPABILITY_SECRET_MISSING'))
})
test('supporting domains: secret references use only frozen MCP argument/header/URL fields without substitution',()=>{
 const f=fixture();f.team.capabilities.items['skill-a'].content='$DSH_SECRET_NOT_A_REFERENCE';const r=audit(f);assert.equal(r.status,'audited');assert.equal(r.capabilities.references.length,1);assert.equal(r.capabilities.references[0].secretName,'KEY');assert.equal(f.team.capabilities.items['http-a'].headers.Authorization,'Bearer $DSH_SECRET_KEY');assert.ok(!JSON.stringify(r).includes('PRIVATE-KEY'))
})
test('supporting domains: connector credential presence with empty shell scope does not imply login verification or sharing',()=>{
 const f=fixture();f.secrets.secrets.push({name:'GITHUB_TOKEN',value:'PRIVATE-GITHUB-TOKEN',scope:[]});f.connectorConfig={github:{url:'https://example.invalid/mcp'}};const r=audit(f);assert.equal(r.capabilities.connector.credentialPresent,true);assert.equal(r.capabilities.connector.verified,false);assert.deepEqual(f.secrets.secrets[1].scope,[]);assert.equal(summary(r).connectorVerified,false)
})
test('supporting domains: malformed capability structures are refused without iterating executable arguments',()=>{
 for(const patch of [{name:'wrong'},{transport:'stdio',command:'fixture',args:42},{transport:'stdio',command:'fixture',env:4},{url:'file:///private'},{headers:{Authorization:42}}]){const f=fixture();Object.assign(f.team.capabilities.items['http-a'],patch);assert.equal(audit(f).status,'blocked')}
 const future=fixture();future.team.capabilities.items['skill-a'].kind='future';assert.equal(audit(future).status,'blocked')
})
test('supporting domains: secret and creator orphans stay visible; invalid and duplicate secret entries fail',()=>{
 const f=fixture();f.secrets.secrets[0].scope.push('deleted');f.team.capabilities.items['skill-a'].createdBy='deleted';const r=audit(f);assert.equal(r.status,'audited');assert.ok(r.diagnostics.some(x=>x.code==='SUPPORTING_SECRET_ORPHAN'));assert.ok(r.diagnostics.some(x=>x.code==='CAPABILITY_CREATOR_ORPHAN'))
 const g=fixture();g.secrets.secrets.push({...g.secrets.secrets[0]});assert.equal(audit(g).status,'blocked')
})
test('supporting domains: public summaries never expose private identities, content, paths, URLs or data hashes',()=>{
 const r=audit(fixture()),text=JSON.stringify(summary(r));for(const value of ['PRIVATE','bot-a','room-a','session-a','https:','MEMORY.md',r.fingerprint,r.memory.files[0].sha256])assert.ok(!text.includes(value))
 const fake=summary({status:'PRIVATE',memory:{entries:'PRIVATE'},diagnostics:[{code:'PRIVATE',severity:'PRIVATE',path:'PRIVATE'}]});assert.equal(fake.status,'blocked');assert.ok(!JSON.stringify(fake).includes('PRIVATE'))
})
test('supporting domains: complete opaque metadata contributes to reconciliation fingerprints',()=>{
 const f=fixture(),a=audit(f);f.team.capabilities.items['skill-a'].future={label:'PRIVATE-EXTENSION'};const b=audit(f);assert.notEqual(a.fingerprint,b.fingerprint);f.secrets.secrets[0].lastUsedAt=42;assert.notEqual(b.fingerprint,audit(f).fingerprint)
})
test('supporting domains: file/byte/line/JSON/diagnostic bounds and cancellation fail safely',()=>{
 const f=fixture();for(const [limits,code] of [[{maxFiles:1},'MIGRATION_SUPPORTING_FILE_LIMIT'],[{maxFileBytes:1},'MIGRATION_SUPPORTING_READ_LIMIT'],[{maxLines:1},'MIGRATION_SUPPORTING_LINE_LIMIT'],[{maxJsonNodes:1},'MIGRATION_SUPPORTING_JSON_LIMIT'],[{maxFiles:0},'MIGRATION_SUPPORTING_INPUT_INVALID']])assert.throws(()=>audit({...f,limits}),{code})
 const g=fixture();g.memoryFiles.push(file('future/a','x'),file('future/b','x'));assert.throws(()=>audit({...g,limits:{maxDiagnostics:1}}),{code:'MIGRATION_SUPPORTING_DIAGNOSTIC_LIMIT'})
 assert.throws(()=>audit({...f,signal:AbortSignal.abort()}),{code:'MIGRATION_SUPPORTING_CANCELLED'})
})
test('supporting domains: duplicate/escaping capture names and deeply nested opaque JSON cannot bypass bounds',()=>{
 const f=fixture();f.memoryFiles.push(f.memoryFiles[0]);assert.throws(()=>audit(f),{code:'MIGRATION_SUPPORTING_INPUT_INVALID'})
 const g=fixture();g.memoryFiles.push(file('../outside','PRIVATE'));assert.throws(()=>audit(g),{code:'MIGRATION_SUPPORTING_INPUT_INVALID'})
 const h=fixture();let deep={};for(let i=0;i<100;i++)deep={child:deep};h.team.future=deep;assert.throws(()=>audit(h),{code:'MIGRATION_SUPPORTING_JSON_LIMIT'})
})
test('supporting domains: an archived empty directory remains a valid saved archive and contributes to its fingerprint',()=>{
 const f=fixture();f.memoryDirectories=['archive','archive/empty-deleted'];f.memoryFiles.find(x=>x.path==='journal.jsonl').bytes=Buffer.from(JSON.stringify(row({op:'archive',to:'archive/empty-deleted'})));const r=audit(f);assert.equal(r.status,'audited');assert.ok(r.memory.directories.includes('archive/empty-deleted'));f.memoryDirectories=[];assert.equal(audit(f).status,'blocked')
})
test('supporting domains: JSON null/arrays and colliding Bot/group storage identities do not pass as empty data',()=>{
 for(const path of ['reviewed.json','summaries/bot-a.json','pending.json'])for(const value of ['null','[]']){const f=fixture();f.memoryFiles=f.memoryFiles.filter(x=>x.path!==path);f.memoryFiles.push(file(path,value));assert.equal(audit(f).status,'blocked')}
 const f=fixture();f.team.rooms['bot-a']={id:'bot-a'};assert.ok(audit(f).diagnostics.some(x=>x.code==='MEMORY_IDENTITY_COLLISION'))
})
