import test from 'node:test'
import assert from 'node:assert/strict'
import {canonicalTaskJson,taskHash,parseTaskSubmit,parseTaskReference,parseTaskRetry,parseLegacyTaskRetry} from '../packages/orchestration/src/task-contract.mjs'

test('task contract: actor, machine, model, executable and state cannot be supplied through command metadata',()=>{
  const base={requestKey:'one',backend:'fixed',input:{text:'fixture'}}
  for(const key of ['botId','ownerBotId','machineId','workspace','model','command','state'])assert.throws(()=>parseTaskSubmit({...base,[key]:'forged'}),/INVALID_TASK_REQUEST/)
  assert.deepEqual(parseTaskSubmit(base),base)
})
test('task contract: retries carry only a persisted reference and an idempotency key',()=>{
  assert.deepEqual(parseTaskRetry({taskId:'task-a',requestKey:'retry-a'}),{taskId:'task-a',requestKey:'retry-a'})
  assert.throws(()=>parseTaskRetry({taskId:'task-a',requestKey:'retry-a',provider:'other'}),/INVALID_TASK_REQUEST/)
  assert.deepEqual(parseLegacyTaskRetry({runId:'legacy-a',requestKey:'retry-a'}),{runId:'legacy-a',requestKey:'retry-a'})
  assert.throws(()=>parseTaskReference({taskId:'../outside'}),/INVALID_TASK_REFERENCE/)
})
test('task contract: canonical request hashing preserves Unicode/newlines and ignores object-key ordering',()=>{
  const left={z:['中文\nfixture',1],a:{second:true,first:null}}
  const right={a:{first:null,second:true},z:['中文\nfixture',1]}
  assert.equal(taskHash(left),taskHash(right))
  assert.deepEqual(JSON.parse(canonicalTaskJson(left)),left)
  assert.notEqual(taskHash(left),taskHash({...left,z:['changed',1]}))
})
test('task contract: non-JSON values, sparse arrays, accessors and cycles fail without evaluating input code',()=>{
  for(const value of [undefined,NaN,Infinity,-0,BigInt(1),new Date(),[,,]])assert.throws(()=>canonicalTaskJson(value),/INVALID_TASK_JSON/)
  let reads=0
  const value={get input(){reads++;return 'must not execute'}}
  assert.throws(()=>canonicalTaskJson(value),/INVALID_TASK_JSON/)
  assert.throws(()=>parseTaskSubmit({requestKey:'a',backend:'b',get input(){reads++;return {}}}),/INVALID_TASK_JSON/)
  const misleading=[];misleading.length=1;misleading[4294967295]='must not silently vanish'
  assert.throws(()=>canonicalTaskJson(misleading),/INVALID_TASK_JSON/)
  assert.equal(reads,0)
  const cycle={};cycle.self=cycle
  assert.throws(()=>canonicalTaskJson(cycle),/INVALID_TASK_JSON/)
})
test('task contract: deeply nested and oversized payloads are bounded; prototype-looking JSON keys stay data',()=>{
  assert.throws(()=>canonicalTaskJson({text:'x'.repeat(32769)}),/TASK_INPUT_LIMIT/)
  let deep={};for(let i=0;i<25;i++)deep={child:deep}
  assert.throws(()=>canonicalTaskJson(deep),/TASK_INPUT_LIMIT/)
  assert.equal(canonicalTaskJson(JSON.parse('{"__proto__":{"value":1}}')),'{"__proto__":{"value":1}}')
  assert.equal(Object.prototype.value,undefined)
})
