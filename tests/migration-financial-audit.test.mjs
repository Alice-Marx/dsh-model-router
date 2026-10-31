import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {mkdir,mkdtemp,readFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {initialRouterState,createRouterState} from '../.dsh-plugin/shared/router-state.mjs'
import {archiveSpending,dayKey} from '../.dsh-plugin/shared/run-ledger.mjs'
import {archiveSubscriptionUsage} from '../.dsh-plugin/shared/subscription-usage.mjs'
import {openSqliteRouterState} from '../packages/orchestration/src/sqlite-router-state.mjs'
import {exportMigrationLedger} from '../packages/orchestration/src/migration-ledger-export.mjs'
import {auditMigrationFinance,reconcileMigrationFinance,summarizeMigrationFinance,classifyLegacyGlobalBudget} from '../packages/orchestration/src/migration-financial-audit.mjs'
const tz=Intl.DateTimeFormat().resolvedOptions().timeZone,at=new Date(2026,9,25,12).getTime(),root=resolve('tmp/integration/migration-financial-audit');await mkdir(root,{recursive:true})
const audit=(routerState,options={})=>auditMigrationFinance({routerState,usageExport:null,timeZone:tz,...options})
function fixture(){
 const state=initialRouterState();state.runs=[{id:'api',createdAt:at,status:'succeeded',packages:[{id:'p',ran:true,costUsd:0.125,finishedAt:at}],reviews:[]},{id:'unknown',createdAt:at,status:'failed',packages:[{id:'p',ran:true,costUsd:null,knownCostUsd:0.025,finishedAt:at}],reviews:[]},{id:'sub',createdAt:at,status:'succeeded',packages:[{id:'p',ran:true,billing:'subscription',costUsd:0,referenceCostUsd:0.2,finishedAt:at}],reviews:[]}]
 return state
}
function usage(t){
 const db=new Database(':memory:');t.after(()=>db.close())
 db.exec('PRAGMA user_version=2;CREATE TABLE calls(key TEXT PRIMARY KEY,session TEXT NOT NULL,time INTEGER NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,kind TEXT NOT NULL,live INTEGER NOT NULL,input INTEGER NOT NULL,cache_read INTEGER NOT NULL,cache_write INTEGER NOT NULL,output INTEGER NOT NULL);CREATE TABLE owners(session TEXT PRIMARY KEY,owner TEXT NOT NULL,name TEXT NOT NULL);CREATE TABLE marks(session TEXT PRIMARY KEY,through INTEGER NOT NULL,fold TEXT NOT NULL,sealed INTEGER NOT NULL);CREATE TABLE kinds(session TEXT PRIMARY KEY,kind TEXT NOT NULL)')
 db.prepare('INSERT INTO calls VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('s#1:0:0','session',at,'provider','model','turn',0,9007199254740993n,1,0,2)
 db.prepare('INSERT INTO calls VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('live:aux','',at,'provider','model','checkpoint',1,3,0,0,4)
 db.prepare('INSERT INTO owners VALUES(?,?,?)').run('deleted-session','deleted-bot','SECRET-DELETED-NAME');db.prepare('INSERT INTO marks VALUES(?,?,?,?)').run('session',17,'{"provider":"provider"}',0);db.prepare('INSERT INTO kinds VALUES(?,?)').run('session','turn')
 return db
}

test('financial audit: known API, unknown USD and subscription reference cost remain separate',()=>{
 const state=fixture(),before=structuredClone(state),r=audit(state);assert.equal(r.status,'audited');assert.deepEqual(state,before)
 const day=r.router.calendar.find(c=>c.day===dayKey(at));assert.equal(day.money.today,0.15);assert.equal(day.money.unknownToday,1);assert.equal(day.money.subscriptionToday,0.2);assert.equal(day.money.subscriptionRunsToday,1)
 assert.equal(state.runs[1].packages[0].costUsd,null);assert.equal(r.router.unassignedRunCount,3);assert.equal(r.applySupported,false)
})
test('financial audit: active and interrupted holds are preserved and require reconciliation',()=>{
 const state=fixture();state.budgetReservations={api:{id:'api',runId:'api',ownerToken:'SECRET-TOKEN',ownerPid:123,status:'interrupted',createdAt:at,updatedAt:at,packages:[{id:'pending',estimatedCostUsd:0.4,started:true}],completedIds:[]}}
 const r=audit(state);assert.equal(r.status,'needs-context');assert.equal(r.router.reservations.reservedUsd,0.4);assert.equal(r.router.reservations.unknownReservations,1);assert.ok(r.diagnostics.some(d=>d.code==='ACTIVE_OR_INTERRUPTED_HOLDS'))
 const changed=structuredClone(state);changed.budgetReservations={};assert.equal(reconcileMigrationFinance(r,audit(changed)).moneyEqual,false)
})
test('financial audit: daily and monthly archives, subscription unknown tokens and prior attempts survive',()=>{
 const state=fixture(),old=structuredClone(state.runs[2]);old.id='archived';old.createdAt=at-86400000;old.packages[0].finishedAt=old.createdAt
 state.archivedSpending=archiveSpending([old]);state.archivedSubscriptionUsage=archiveSubscriptionUsage([old]);state.runs[0].priorAttemptSpending=archiveSpending([old]);state.runs[0].priorAttemptSubscriptionUsage=archiveSubscriptionUsage([old])
 const r=audit(state);assert.equal(r.status,'audited');assert.equal(r.router.calendar.find(c=>c.day===dayKey(at)).subscription.today.unknownUsageCalls,1);assert.equal(r.router.calendar.find(c=>c.day===dayKey(old.createdAt)).money.subscriptionRunsToday,2)
 const lost=structuredClone(state);delete lost.runs[0].priorAttemptSubscriptionUsage;assert.equal(reconcileMigrationFinance(r,audit(lost)).moneyEqual,false)
})
test('financial audit: zero/unset/positive legacy limits are distinct shared global states',()=>{
 assert.deepEqual(classifyLegacyGlobalBudget(0),{kind:'unbounded',scope:'shared-global'});assert.deepEqual(classifyLegacyGlobalBudget(undefined,false),{kind:'unconfigured',scope:'shared-global'});assert.deepEqual(classifyLegacyGlobalBudget(12.5),{kind:'amount',amountUsd:12.5,scope:'shared-global'})
 assert.throws(()=>classifyLegacyGlobalBudget(-1),{code:'BUDGET_INPUT_INVALID'});const r=audit(fixture(),{budgetConfig:{dailyBudgetUsd:0,monthlyBudgetUsd:100}});assert.equal(r.budgets.dailyBudgetUsd.kind,'unbounded');assert.equal(r.budgets.monthlyBudgetUsd.scope,'shared-global');assert.equal(reconcileMigrationFinance(r,audit(fixture(),{budgetConfig:{dailyBudgetUsd:1,monthlyBudgetUsd:100}})).moneyEqual,false)
})
test('financial audit: duplicate runs, invalid receipts and incomplete archives block without dropping raw source',()=>{
 for(const mutate of [s=>s.runs.push(structuredClone(s.runs[0])),s=>s.runs[0].packages[0].costUsd=-1,s=>s.historyIncomplete=true,s=>s.subscriptionUsageIncomplete=true]){const s=fixture();mutate(s);const before=structuredClone(s),r=audit(s);assert.equal(r.status,'blocked');assert.deepEqual(s,before)}
})
test('financial audit: source attribution stays unassigned and conflicting Bot/account ownership blocks',()=>{
 const s=fixture();s.runs[0].modelCall={botId:'bot-a',fundingScopeId:'account-a'};s.runs[0].cliExecution={botId:'bot-b',fundingScopeId:'account-b'}
 const r=audit(s);assert.equal(r.status,'blocked');assert.ok(r.diagnostics.some(d=>d.code==='MONEY_ATTRIBUTION_CONFLICT'));assert.equal(r.router.unassignedRunCount,2)
})
test('financial audit: raw extension fields, nullable quantities and deleted-run identity changes are detected',()=>{
 const s=fixture();s.futurePreference={enabled:true};const before=audit(s)
 for(const modify of [s=>delete s.futurePreference,s=>s.runs[1].packages[0].costUsd=0,s=>s.runs[0].id='reassigned',s=>s.runs[0].packages[0].customField='new']){const next=structuredClone(s);modify(next);assert.equal(reconcileMigrationFinance(before,audit(next)).equal,false)}
 assert.deepEqual(reconcileMigrationFinance(before,audit(structuredClone(s))),{equal:true,moneyEqual:true,changes:[],readyToApply:false,requiresStopProof:true})
})
test('financial audit: DS usage preserves auxiliary and deleted owners without becoming a USD receipt',t=>{
 const db=usage(t),r=audit(fixture(),{usageExport:exportMigrationLedger(db)});assert.equal(r.status,'audited');assert.equal(r.usage.calls,2);assert.equal(r.usage.meteredCalls,1);assert.equal(r.usage.owners,1);assert.equal(r.usage.tokenTotals.input,'9007199254740996');assert.equal(r.usage.accountingMeaning,'preserved-token-observations-not-USD-receipts')
 assert.equal(r.router.calendar.find(c=>c.day===dayKey(at)).money.today,0.15)
 db.prepare('DELETE FROM owners').run();assert.equal(reconcileMigrationFinance(r,audit(fixture(),{usageExport:exportMigrationLedger(db)})).equal,false)
})
test('financial audit: usage future schema, invalid token types and modified export evidence are refused',t=>{
 const db=usage(t);db.pragma('user_version=3');assert.ok(audit(fixture(),{usageExport:exportMigrationLedger(db)}).diagnostics.some(d=>d.code==='USAGE_EXPORT_INVALID'));db.pragma('user_version=2')
 db.prepare('UPDATE calls SET input=-1 WHERE key=?').run('live:aux');assert.equal(audit(fixture(),{usageExport:exportMigrationLedger(db)}).status,'blocked')
 const modified=exportMigrationLedger(db);modified.tables[0].rows=[];assert.equal(audit(fixture(),{usageExport:modified}).status,'blocked')
})
test('financial audit: actual SQL cutover preserves money while ledger introduction stays explicitly different',async t=>{
 const dir=await mkdtemp(join(root,'case-')),legacyFile=join(dir,'state.json'),file=join(dir,'state.sqlite'),legacy=createRouterState({file:legacyFile})
 await legacy.update(state=>Object.assign(state,fixture()))
 const before=audit(JSON.parse(await readFile(legacyFile,'utf8'))),store=await openSqliteRouterState({Database,file,legacyFile}),db=new Database(file,{readonly:true})
 t.after(async()=>{db.close();await store.close()})
 const marker=JSON.parse(await readFile(legacyFile,'utf8')),after=audit(marker,{ledgerExport:exportMigrationLedger(db)})
 assert.equal(after.status,'audited');const comparison=reconcileMigrationFinance(before,after);assert.equal(comparison.moneyEqual,true);assert.deepEqual(comparison.changes,['ledger']);assert.equal(comparison.equal,false);assert.equal(comparison.readyToApply,false)
})
test('financial audit: marker epoch mismatch and missing SQLite export never choose a JSON fallback',async t=>{
 const dir=await mkdtemp(join(root,'case-')),legacyFile=join(dir,'state.json'),file=join(dir,'state.sqlite');await createRouterState({file:legacyFile}).saveHealth(null);const store=await openSqliteRouterState({Database,file,legacyFile}),db=new Database(file,{readonly:true});t.after(async()=>{db.close();await store.close()})
 const marker=JSON.parse(await readFile(legacyFile,'utf8'));assert.equal(audit(marker).status,'needs-context');marker.migration.id='wrong';const r=audit(marker,{ledgerExport:exportMigrationLedger(db)});assert.equal(r.status,'blocked');assert.equal(r.router,null);assert.ok(r.diagnostics.some(d=>d.code==='ROUTER_MARKER_MISMATCH'))
})
test('financial audit: authoritative source receipts supply ownership without assigning it to every Bot',async t=>{
 const dir=await mkdtemp(join(root,'case-')),legacyFile=join(dir,'state.json'),file=join(dir,'state.sqlite'),legacy=createRouterState({file:legacyFile});await legacy.update(s=>Object.assign(s,fixture()))
 const store=await openSqliteRouterState({Database,file,legacyFile}),db=new Database(file);t.after(async()=>{db.close();await store.close()})
 db.prepare('INSERT INTO router_model_calls VALUES(?,?,?,?,?,?)').run('receipt','bot-receipt',null,'api','identity','{"fundingScopeId":"account-receipt"}')
 const marker=JSON.parse(await readFile(legacyFile,'utf8')),r=audit(marker,{ledgerExport:exportMigrationLedger(db)});assert.equal(r.status,'audited');assert.equal(r.router.unassignedRunCount,2);assert.deepEqual(r.router.attribution.find(x=>x.runId==='api').botIds,['bot-receipt'])
 db.prepare('UPDATE router_funding_runs SET bot_id=? WHERE run_id=?').run('different-bot','api');const conflict=audit(marker,{ledgerExport:exportMigrationLedger(db)});assert.equal(conflict.status,'blocked');assert.ok(conflict.diagnostics.some(d=>d.code==='MONEY_ATTRIBUTION_CONFLICT'))
})
test('financial audit: explicit calendar and explicit absence are required instead of inferred contexts',()=>{
 assert.equal(auditMigrationFinance({routerState:fixture(),usageExport:null}).status,'needs-context');assert.equal(auditMigrationFinance({timeZone:tz}).status,'needs-context');assert.equal(audit(null).status,'audited')
})
test('financial audit: private input getters/cycles/oversized trees are refused without execution',()=>{
 let calls=0;const x={};Object.defineProperty(x,'secret',{enumerable:true,get(){calls++;return'PRIVATE'}});assert.throws(()=>auditMigrationFinance(x),{code:'MIGRATION_FINANCE_INPUT_INVALID'});assert.equal(calls,0)
 const cyclic={};cyclic.self=cyclic;assert.throws(()=>auditMigrationFinance(cyclic),{code:'MIGRATION_FINANCE_INPUT_INVALID'});let nested={};for(let i=0;i<70;i++)nested={next:nested};assert.throws(()=>auditMigrationFinance(nested),{code:'MIGRATION_FINANCE_LIMIT'})
})
test('financial audit: public summaries contain only fixed codes and bounded aggregate counts',()=>{
 const r=audit(fixture()),publicText=JSON.stringify(summarizeMigrationFinance(r));for(const value of ['api','unknown"','costUsd','0.125','fingerprint','timeZone'])assert.ok(!publicText.includes(value))
 const injected=summarizeMigrationFinance({status:'PRIVATE-PATH',router:{runCount:Infinity},diagnostics:[{code:'SECRET',severity:'SECRET',message:'SECRET'}]});assert.equal(injected.status,'blocked');assert.equal(injected.runs,0);assert.deepEqual(injected.diagnostics,[{code:'UNKNOWN_DIAGNOSTIC',severity:'error'}]);assert.ok(!JSON.stringify(injected).includes('SECRET'))
})
test('financial audit: altered saved reconciliation reports cannot authorize an equality result',()=>{
 const r=audit(fixture()),tampered=structuredClone(r);tampered.router.runCount=0;assert.throws(()=>reconcileMigrationFinance(r,tampered),{code:'MIGRATION_FINANCE_AUDIT_INVALID'})
})
test('financial audit: a leftover unactivated SQL file cannot supersede a legacy JSON authority',t=>{
 const db=new Database(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE router_meta(singleton INTEGER PRIMARY KEY,schema_version INTEGER,revision INTEGER,payload TEXT)')
 const original=fixture();assert.equal(audit(original).status,'audited');assert.equal(audit(original,{ledgerExport:exportMigrationLedger(db)}).status,'blocked');assert.equal(original.runs.length,3)
})
test('financial audit: raw calendar history beyond the runtime display horizon cannot disappear behind equal normalized totals',()=>{
 const source=initialRouterState();for(let i=0;i<110;i++)source.archivedSpending.days[dayKey(at-i*86400000)]={costUsd:0.1,unknown:0,subscriptionUsd:0,subscriptionRuns:0}
 const shortened=structuredClone(source);for(const key of Object.keys(shortened.archivedSpending.days).sort().slice(0,20))delete shortened.archivedSpending.days[key]
 const before=audit(source),after=audit(shortened);assert.equal(before.router.normalizedDigest,after.router.normalizedDigest);assert.notEqual(before.router.rawArchiveDigest,after.router.rawArchiveDigest);assert.equal(reconcileMigrationFinance(before,after).moneyEqual,false)
})
