import Database from 'better-sqlite3'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {openSqliteRouterState} from '../packages/orchestration/src/sqlite-router-state.mjs'
import {createRouterState} from '../.dsh-plugin/shared/router-state.mjs'
import {createBudgetReservations} from '../.dsh-plugin/shared/budget-reservations.mjs'
import {withinTaskAdmission} from '../packages/orchestration/src/task-admission.mjs'
import {taskHash} from '../packages/orchestration/src/task-contract.mjs'

// Actual process exit, without close()/finally, exercises SQLite WAL recovery.
const [dir,stage]=process.argv.slice(2),file=join(dir,'journal.sqlite'),legacyFile=join(dir,'state.json')
await createRouterState({file:legacyFile}).saveHealth(null)
const stop=point=>{if(point===stage)process.exit(78)}
const store=await openSqliteRouterState({Database,file,legacyFile,lockStaleMs:1,onAtomicStep:stop})
const j=store.openTaskJournal(),f=j.claimRunner('crash-runner',1000,0)
const target={backend:'fixture',version:'v1',effect:'read',machineId:'machine-a',workspaceId:'workspace-a',location:'local',capability:'execution/read',retryCapability:'execution/retry',model:null}
const payload={backend:'fixture',input:{task:'offline crash fixture'},target,targetHash:taskHash(target)}
const task=j.submit(f,'bot-a','crash','crash',payload,20000,1)
j.claim(f,'bot-a',task.taskId,2,{atomic:true})
await writeFile(join(dir,'identity.json'),JSON.stringify(task))
stop('admitting')
const reference={kind:'cli-run',runId:'crash-run',marker:{schemaVersion:1,taskId:task.taskId,attemptId:task.attemptId,operationId:task.operationId,targetHash:payload.targetHash}}
const frame=j.createAdmission(f,'bot-a',task.taskId,task.attemptId,()=>3)
frame.checkpoint(reference)
stop('reference-prepared')
const createdAt=Date.now(),receipt={schemaVersion:1,id:'crash-receipt',runId:reference.runId,packageId:'cli',botId:'bot-a',sessionId:null,taskId:task.taskId,attemptId:task.attemptId,operationId:task.operationId,source:'cli',provider:'fixture',model:'gpt-fixture',funding:'api',pricing:{input:1,output:2},requestHash:taskHash(payload),createdAt,ownerPid:process.pid,state:'admitted',finishedAt:null,usage:null,usageComplete:false,actualModel:null,reportedCostUsd:null,finishKind:null,outcome:null}
const run={id:reference.runId,createdAt,status:'running',managedExecution:reference.marker,cliExecution:{botId:'bot-a',receiptId:receipt.id},packages:[],reviews:[]}
const state={read:()=>store.read(),update:(change,options)=>store.update(change,{...options,modelReceipt:receipt})}
await withinTaskAdmission(frame,()=>createBudgetReservations({state}).beginExecution({run,packageEstimates:[{id:'cli',estimatedCostUsd:0.1}],dailyLimitUsd:1}))
if(stage==='fixture-dispatched'){
  j.assertDispatch(f,'bot-a',task.taskId,task.attemptId,4)
  // This local file is the offline provider stand-in; never calls a model.
  await writeFile(join(dir,'dispatch.json'),JSON.stringify({operationId:task.operationId,calls:1}))
  stop('fixture-dispatched')
}
throw new Error(`Unknown crash phase: ${stage}`)
