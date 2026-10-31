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

const PLAN_KEYS = ['schemaVersion','taskId','origin','planRevision','packages']
const ORIGIN_KEYS = ['kind','botId','sessionId']
const PACKAGE_KEYS = ['id','targetBotId','objective','dependsOn','acceptance','effectClass','execution']
const ORIGIN_KINDS = new Set(['private','group'])
const EFFECT_CLASSES = new Set(['read','workspace-write'])
const PLAN_PACKAGE_LIMIT = 32
const PLAN_TEXT_LIMIT = 4_000
const PLAN_DEPENDENCY_LIMIT = 16
// A work package cannot carry a runnable path, an arbitrary MCP URL or a
// credential; the Host fixes executables, endpoints and secrets. A path is any
// separator-led segment ending in an executable extension, so drive, POSIX,
// relative and spaced forms are all caught; a bare file name is not a path.
const EXECUTABLE_PATH = /[\\/][^\n'"`,;()]*\.(?:exe|cmd|bat|ps1|sh|bash|zsh|py|pl|rb|app|com|msi)(?![A-Za-z0-9])/i
const URL_LIKE = /\bhttps?:\/\/[^\s'"`]+/i
const SECRET_LIKE = /(?:\b(?:sk|pk|ghp|gho|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}|\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*|[A-Za-z0-9+/]{40,}={0,2}$)/

/** Fixed file operation data only; endpoints, credentials and programs are Host-owned. */
export function parseRemoteTaskWrite(value){
 const v=closed(value,['machineId','rootId','relativePath','content','expectedHash'])
 for(const key of ['machineId','rootId'])if(typeof v[key]!=='string'||!/^[-A-Za-z0-9_.]{1,128}$/.test(v[key]))throw new PolicyError('INVALID_REMOTE_TASK_INPUT')
 if(typeof v.relativePath!=='string'||v.relativePath.length>2048||/^[\\/]|[\0-\x1f\x7f\\:]/.test(v.relativePath)||v.relativePath.split('/').some(p=>!p||p==='.'||p==='..'))throw new PolicyError('INVALID_REMOTE_TASK_PATH')
 if(typeof v.content!=='string'||Buffer.byteLength(v.content)>8192||SECRET_LIKE.test(v.content))throw new PolicyError('INVALID_REMOTE_TASK_CONTENT')
 if(v.expectedHash!==null&&!/^[a-f0-9]{64}$/.test(v.expectedHash??''))throw new PolicyError('REMOTE_TASK_HASH_REQUIRED')
 return {machineId:v.machineId,rootId:v.rootId,relativePath:v.relativePath,content:v.content,expectedHash:v.expectedHash}
}

/**
 * Fixed container-command Task data only: bound machine/root, a bounded
 * workspace-relative working directory, an owner-approved argv alias array
 * and a bounded deadline. Endpoints, credentials, environment variables,
 * Docker flags, arbitrary host executables and script bodies are refused;
 * the Host and the container configuration own every executable.
 */
export function parseRemoteTaskCommand(value){
 const v=closed(value,['machineId','rootId','workspaceRelativePath','argv','timeoutMs'])
 for(const key of ['machineId','rootId'])if(typeof v[key]!=='string'||!/^[-A-Za-z0-9_.]{1,128}$/.test(v[key]))throw new PolicyError('INVALID_REMOTE_TASK_INPUT')
 if(typeof v.workspaceRelativePath!=='string'||v.workspaceRelativePath.length>2048||/^[\\/]|[\0-\x1f\x7f\\:]/.test(v.workspaceRelativePath)||(v.workspaceRelativePath!==''&&v.workspaceRelativePath.split('/').some(p=>!p||p==='.'||p==='..')))throw new PolicyError('INVALID_REMOTE_TASK_PATH')
 if(!Array.isArray(v.argv)||v.argv.length<1||v.argv.length>64||v.argv.some(a=>typeof a!=='string'||!a.length||Buffer.byteLength(a)>4096||a.includes('\0')||/[\0-\x1f\x7f]/.test(a)||SECRET_LIKE.test(a)))throw new PolicyError('INVALID_REMOTE_TASK_ARGV')
 if(!Number.isSafeInteger(v.timeoutMs)||v.timeoutMs<1000||v.timeoutMs>600000)throw new PolicyError('INVALID_REMOTE_TASK_DEADLINE')
 return {machineId:v.machineId,rootId:v.rootId,workspaceRelativePath:v.workspaceRelativePath,argv:v.argv,timeoutMs:v.timeoutMs}
}

/**
 * Parse a structured plan. Packages are dependency-graph nodes: the model
 * proposes objectives, acceptance and reasons, and the Host judges legality,
 * readiness, identity and resource locks. Parsing rejects schema and text
 * problems before any execution or scheduling decision.
 */
export function parseTaskPlan(value) {
  const plan = closed(value, PLAN_KEYS)
  if (plan.schemaVersion !== 1) throw new PolicyError('TASK_PLAN_VERSION_UNSUPPORTED')
  taskRef(plan.taskId)
  if (!Number.isSafeInteger(plan.planRevision) || plan.planRevision < 1) throw new PolicyError('INVALID_TASK_PLAN')
  const origin = plan.origin
  if (!origin || typeof origin !== 'object' || Array.isArray(origin) || Object.keys(origin).some(key => !ORIGIN_KEYS.includes(key))) {
    throw new PolicyError('INVALID_TASK_PLAN')
  }
  if (!ORIGIN_KINDS.has(origin.kind)) throw new PolicyError('INVALID_TASK_PLAN')
  taskRef(origin.botId)
  if (origin.sessionId !== null && origin.sessionId !== undefined) taskRef(origin.sessionId)
  if (!Array.isArray(plan.packages) || !plan.packages.length || plan.packages.length > PLAN_PACKAGE_LIMIT) {
    throw new PolicyError('INVALID_TASK_PLAN')
  }
  const text = (value, path) => {
    if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > PLAN_TEXT_LIMIT) throw new PolicyError('TASK_PLAN_TEXT_LIMIT')
    if (EXECUTABLE_PATH.test(value)) throw new PolicyError('TASK_PLAN_EXECUTABLE_PATH')
    if (URL_LIKE.test(value)) throw new PolicyError('TASK_PLAN_MCP_URL')
    if (SECRET_LIKE.test(value)) throw new PolicyError('TASK_PLAN_SECRET')
    return value
  }
  for (const item of plan.packages) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !PACKAGE_KEYS.includes(key))) {
      throw new PolicyError('INVALID_TASK_PLAN')
    }
    taskRef(item.id); taskRef(item.targetBotId)
    text(item.objective, 'objective')
    if (!EFFECT_CLASSES.has(item.effectClass)) throw new PolicyError('TASK_PLAN_EFFECT_CLASS')
    if(item.execution!==undefined){
      const execution=closed(item.execution,['backend','input'])
      if(item.effectClass!=='workspace-write'||!['remote-write','remote-command'].includes(execution.backend))throw new PolicyError('TASK_PLAN_EXECUTION_INVALID')
      if(execution.backend==='remote-write')parseRemoteTaskWrite(execution.input)
      else parseRemoteTaskCommand(execution.input)
    }
    if (!Array.isArray(item.acceptance) || item.acceptance.length > 16) throw new PolicyError('INVALID_TASK_PLAN')
    for (const entry of item.acceptance) text(entry, 'acceptance')
    if (!Array.isArray(item.dependsOn) || item.dependsOn.length > PLAN_DEPENDENCY_LIMIT) throw new PolicyError('INVALID_TASK_PLAN')
    for (const dependency of item.dependsOn) taskRef(dependency)
  }
  return { schemaVersion: 1, taskId: plan.taskId,
    origin: { kind: origin.kind, botId: origin.botId, sessionId: origin.sessionId ?? null },
    planRevision: plan.planRevision,
    packages: plan.packages.map(item => ({ id: item.id, targetBotId: item.targetBotId, objective: item.objective,
      dependsOn: [...item.dependsOn], acceptance: [...item.acceptance], effectClass: item.effectClass,...(item.execution===undefined?{}:{execution:{backend:item.execution.backend,input:item.execution.backend==='remote-write'?parseRemoteTaskWrite(item.execution.input):parseRemoteTaskCommand(item.execution.input)}}) })) }
}

/**
 * Judge a parsed plan: duplicate ids, dangling or self dependencies, cycles and
 * unknown target Bots are refused before any package is scheduled. `knownBots`
 * is the Host-owned Bot directory; omitting it skips the authorization check.
 */
export function validateTaskPlan(plan, { knownBots = null } = {}) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.packages)) throw new PolicyError('INVALID_TASK_PLAN')
  const ids = new Set()
  for (const item of plan.packages) {
    if (ids.has(item.id)) throw new PolicyError('TASK_PLAN_DUPLICATE_PACKAGE')
    ids.add(item.id)
  }
  if (knownBots !== null) {
    if (!(knownBots instanceof Set) && !Array.isArray(knownBots)) throw new TypeError('TASK_PLAN_BOTS_REQUIRED')
    const allowed = knownBots instanceof Set ? knownBots : new Set(knownBots)
    for (const item of plan.packages) {
      if (!allowed.has(item.targetBotId)) throw new PolicyError('TASK_PLAN_TARGET_UNKNOWN')
    }
  }
  const dependents = new Map()
  const remaining = new Map()
  for (const item of plan.packages) {
    for (const dependency of item.dependsOn) {
      if (dependency === item.id) throw new PolicyError('TASK_PLAN_SELF_DEPENDENCY')
      if (!ids.has(dependency)) throw new PolicyError('TASK_PLAN_DANGLING_DEPENDENCY')
    }
    if (new Set(item.dependsOn).size !== item.dependsOn.length) throw new PolicyError('TASK_PLAN_DUPLICATE_DEPENDENCY')
    remaining.set(item.id, new Set(item.dependsOn))
    for (const dependency of item.dependsOn) {
      if (!dependents.has(dependency)) dependents.set(dependency, [])
      dependents.get(dependency).push(item.id)
    }
  }
  // Kahn topological order: anything left at the end sits on a cycle.
  const ready = [...remaining.entries()].filter(([, needs]) => needs.size === 0).map(([id]) => id)
  const order = []
  while (ready.length) {
    const id = ready.shift()
    order.push(id)
    for (const dependent of dependents.get(id) ?? []) {
      const needs = remaining.get(dependent)
      needs.delete(id)
      if (needs.size === 0) ready.push(dependent)
    }
  }
  if (order.length !== plan.packages.length) throw new PolicyError('TASK_PLAN_CYCLE')
  return Object.freeze({ order: Object.freeze(order) })
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
