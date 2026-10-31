import {AsyncLocalStorage} from 'node:async_hooks'
import {taskHash} from './task-contract.mjs'

const current=new AsyncLocalStorage(),contracts=new WeakMap()
const fail=code=>{throw Object.assign(new Error(code),{code})}

/** Host-only opaque handle; no wire object can establish this relationship. */
export function createTaskAdmission({database,capture,commit,proveNotDispatched}){
  let reference=null,committed=false
  const handle=Object.freeze({
    checkpoint(value){
      if(committed)fail('TASK_ADMISSION_ALREADY_COMMITTED')
      if(reference&&taskHash(reference)!==taskHash(value))fail('TASK_EXECUTION_REFERENCE_CONFLICT')
      capture(value);reference=structuredClone(value)
    },
    committed:()=>committed,
    notDispatched:()=>!committed&&proveNotDispatched(),
  })
  contracts.set(handle,{database,prepare(candidate,result){
    if(committed||result?.accepted===false||!reference)return null
    const hold=candidate.budgetReservations?.[reference.runId]
    if(!hold)return null
    const run=candidate.runs.find(row=>row.id===reference.runId)
    if(hold.status!=='active'||!run||taskHash(run.managedExecution??null)!==taskHash(reference.marker))fail('TASK_ADMISSION_RUN_MISMATCH')
    commit(reference)
    return()=>{committed=true}
  }})
  return handle
}
export function withinTaskAdmission(handle,work){if(!contracts.has(handle))fail('TASK_ADMISSION_REQUIRED');return current.run(handle,work)}
export const currentTaskAdmission=()=>current.getStore()

/** Called only inside the financial writer's native transaction. Publish after COMMIT. */
export function prepareTaskAdmission(handle,database,candidate,result){
  if(!handle)return null
  const contract=contracts.get(handle)
  if(!contract||contract.database!==database)fail('TASK_ATOMIC_CONNECTION_REQUIRED')
  return contract.prepare(candidate,result)
}
