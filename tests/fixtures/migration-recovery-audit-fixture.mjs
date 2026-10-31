import {mkdtemp,mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import Database from 'better-sqlite3'
import {createRouterState} from '../../.dsh-plugin/shared/router-state.mjs'
import {openSqliteRouterState} from '../../packages/orchestration/src/sqlite-router-state.mjs'
import {taskHash} from '../../packages/orchestration/src/task-contract.mjs'
import {exportMigrationLedger} from '../../packages/orchestration/src/migration-ledger-export.mjs'

// Owner-only offline fixture for the read-only migration recovery audit. Every
// case lives under an isolated tmp/integration directory; no real profile,
// credential or DSH user data is ever read. Tasks are created through the real
// journal/export API so the export is a genuine schema5 snapshot; holds,
// receipts, refs and tombstones are inserted as raw ledger rows (the same
// technique tests/migration-ledger-export.test.mjs uses) to reach states the
// happy path cannot produce.

export const recoveryRoot=resolve('tmp/integration/step-migration-recovery/cases')

export async function openRecoveryStore(t){
  const dir=await mkdtemp(join(recoveryRoot,'case-')),source=join(dir,'source')
  await mkdir(source,{recursive:true})
  const file=join(source,'ledger.sqlite'),legacyFile=join(source,'state.json')
  await createRouterState({file:legacyFile}).saveHealth(null)
  const store=await openSqliteRouterState({Database,file,legacyFile})
  const journal=store.openTaskJournal()
  const db=new Database(file)
  t.after(async()=>{
    try{db.close()}catch{}
    try{journal.close()}catch{}
    try{await store.close()}catch{}
  })
  const runner=journal.claimRunner('recovery-runner',60000,0)
  return {dir,file,legacyFile,source,store,journal,db,runner}
}

export const exportLedger=db=>exportMigrationLedger(db)

export const localTarget=()=>({backend:'fixture',version:'v1',effect:'read',machineId:'machine-a',workspaceId:'workspace-a',location:'local',capability:'execution/read',retryCapability:'execution/retry',model:null})
export const taskInput=target=>({backend:'fixture',input:{task:'fixture'},target,targetHash:taskHash(target)})

// A counter keeps request keys unique and monotonically advances the fake clock
// while staying well inside the runner lease (600000) and the task deadline.
export function clock(start=1000){let now=start;return()=>now+=7}

export function makeSettled(j,runner,bot,key,now,outcome='succeeded'){
  const v=j.submit(runner,bot,key,'h',taskInput(localTarget()),2000000,now())
  j.claim(runner,bot,v.taskId,now())
  return j.finish(runner,bot,v.taskId,v.attemptId,outcome,{},now())
}
export function makeActive(j,runner,bot,key,now,phase='running'){
  const v=j.submit(runner,bot,key,'h',taskInput(localTarget()),2000000,now())
  if(phase==='running')j.claim(runner,bot,v.taskId,now())
  return j.get(bot,v.taskId)
}
export function makeWaitingBudget(j,runner,bot,key,now){
  const v=j.submit(runner,bot,key,'h',taskInput(localTarget()),2000000,now())
  j.claim(runner,bot,v.taskId,now())
  return j.finish(runner,bot,v.taskId,v.attemptId,'waiting-budget',{},now())
}
export function makeNeedsReconciliation(j,runner,bot,key,now){
  const v=j.submit(runner,bot,key,'h',taskInput(localTarget()),2000000,now())
  j.claim(runner,bot,v.taskId,now())
  return j.finish(runner,bot,v.taskId,v.attemptId,'unknown',{},now())
}
// A blocked-before-dispatch task: the current attempt carries notStarted:true,
// started_ms stays null and there is no ref, money or tombstone.
export function makeBlocked(j,runner,bot,key,now){
  const v=j.submit(runner,bot,key,'h',taskInput(localTarget()),2000000,now())
  j.block(runner,bot,v.taskId,'FIXTURE_BLOCK',now())
  return j.get(bot,v.taskId)
}

// Insert a durable execution hold. status active/interrupted; packages may carry
// a null estimatedCostUsd (unknown money) which must never collapse to zero.
export function insertHold(db,{id,runId,status='active',packages=null,completedIds=[]}={}){
  const pkgs=packages??[{id:'pkg-1',estimatedCostUsd:null,started:true}]
  db.prepare('INSERT OR REPLACE INTO router_runs VALUES(?,?)').run(runId,JSON.stringify({id:runId,createdAt:1,status:status==='interrupted'?'interrupted':'running',packages:[],reviews:[]}))
  db.prepare('INSERT OR REPLACE INTO router_holds VALUES(?,?,?)').run(id,runId,JSON.stringify({id,runId,ownerToken:'SECRET-HOLD-TOKEN',ownerPid:4242,status,createdAt:1,updatedAt:1,packages:pkgs,completedIds}))
}
// Insert a model-call receipt. state drives the in-flight/unknown/settled class.
export function insertReceipt(db,{id,botId='bot-a',taskId=null,runId='run-receipt',operationId=null,state='settled',extra={}}={}){
  db.prepare('INSERT OR REPLACE INTO router_runs VALUES(?,?)').run(runId,JSON.stringify({id:runId,createdAt:1,status:'succeeded',packages:[],reviews:[]}))
  const payload={schemaVersion:1,id,runId,botId,source:'mr-api',funding:'api',state,createdAt:1,ownerPid:1,usageComplete:false,...(operationId!=null?{operationId}:{}),...extra}
  db.prepare('INSERT OR REPLACE INTO router_model_calls VALUES(?,?,?,?,?,?)').run(id,botId,taskId,runId,'identity-'+id,JSON.stringify(payload))
}
// Bind a legacy run tombstone directly to a task (a run the journal knows about).
export function insertTombstone(db,{runId,taskId,ownerBot}){
  db.prepare('INSERT OR IGNORE INTO legacy_task_runs VALUES(?,?,?)').run(runId,taskId,ownerBot)
}
// Insert an execution reference + reconciliation evidence for an attempt.
export function insertReference(db,{attemptId,runId,taskId,operationId,targetHash}){
  const reference={kind:'mr-run',runId,marker:{schemaVersion:1,taskId,attemptId,operationId,targetHash}}
  db.prepare('INSERT OR REPLACE INTO task_execution_refs VALUES(?,?,?)').run(attemptId,JSON.stringify(reference),taskHash(reference))
}
