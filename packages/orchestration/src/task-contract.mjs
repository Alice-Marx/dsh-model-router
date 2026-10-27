import { createHash } from 'node:crypto'
import { PolicyError } from '../../capability-broker/src/authority.mjs'

export const taskRef = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new PolicyError('INVALID_TASK_REFERENCE')
  return value
}
const closed = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key=>!keys.includes(key))) throw new PolicyError('INVALID_TASK_REQUEST')
  return JSON.parse(canonicalTaskJson(value))
}

/** Canonical, bounded, lossless JSON for idempotency; never invokes getters. */
export function canonicalTaskJson(value) {
  const seen = new Set()
  let nodes = 0
  const visit = (item, depth) => {
    if (++nodes > 4096 || depth > 20) throw new PolicyError('TASK_INPUT_LIMIT')
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item
    if (typeof item === 'number' && Number.isFinite(item) && !Object.is(item,-0)) return item
    if (typeof item !== 'object' || seen.has(item)) throw new PolicyError('INVALID_TASK_JSON')
    const prototype = Object.getPrototypeOf(item)
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) throw new PolicyError('INVALID_TASK_JSON')
    seen.add(item)
    const result = Array.isArray(item) ? [] : Object.create(null)
    const keys = Reflect.ownKeys(item).filter(key=>key !== 'length' || !Array.isArray(item))
    if (keys.some(key=>typeof key !== 'string')) throw new PolicyError('INVALID_TASK_JSON')
    for (const key of keys.sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(item,key)
      if (!descriptor.enumerable || !('value' in descriptor)) throw new PolicyError('INVALID_TASK_JSON')
      if (Array.isArray(item) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key)>=item.length)) throw new PolicyError('INVALID_TASK_JSON')
      result[key] = visit(descriptor.value,depth+1)
    }
    if (Array.isArray(item) && keys.length !== item.length) throw new PolicyError('INVALID_TASK_JSON')
    seen.delete(item)
    return result
  }
  const json = JSON.stringify(visit(value,0))
  if (Buffer.byteLength(json) > 32_768) throw new PolicyError('TASK_INPUT_LIMIT')
  return json
}

export const taskHash = value => createHash('sha256').update(canonicalTaskJson(value)).digest('hex')
export function parseTaskSubmit(value) {
  const v = closed(value,['requestKey','backend','input'])
  taskRef(v.requestKey);taskRef(v.backend)
  canonicalTaskJson(v.input)
  return {requestKey:v.requestKey,backend:v.backend,input:JSON.parse(canonicalTaskJson(v.input))}
}
export function parseTaskReference(value) {
  const v = closed(value,['taskId'])
  return {taskId:taskRef(v.taskId)}
}
export function parseTaskRetry(value) {
  const v = closed(value,['taskId','requestKey'])
  return {taskId:taskRef(v.taskId),requestKey:taskRef(v.requestKey)}
}
// Reconciliation accepts references only; outcome/evidence are supplied by the host observer.
export const parseTaskReconcile = parseTaskRetry
export function parseLegacyTaskRetry(value) {
  const v = closed(value,['runId','requestKey'])
  return {runId:taskRef(v.runId),requestKey:taskRef(v.requestKey)}
}
