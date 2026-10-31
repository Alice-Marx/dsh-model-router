import {createHash,timingSafeEqual} from 'node:crypto'

/**
 * Independent pure contract for the versioned `container_command_v1` tool.
 *
 * This module is a CONTRACT ONLY. It validates a model-supplied command request
 * against the trusted, in-process effective container configuration and binds
 * both into a deterministic digest. It never registers a tool, spawns a process,
 * talks to Docker, or changes any existing runtime behavior. Wiring into the
 * Agent dispatch point is a separate, later step owned by the GPT lead.
 *
 * Trust model (read before wiring):
 * - The `config` argument is the TRUSTED effective configuration observed by the
 *   Agent process (its real platform, isolation mode, fixed image, owner alias
 *   map, machine id and granted root ids). The model must never influence it.
 * - The `request` argument is UNTRUSTED model output. It is closed to a fixed
 *   field set; any extra/legacy/docker/host/credential field is rejected.
 * - The caller MAY propose an `expectedDigest` to pin a previously agreed
 *   binding, but the comparison target is always recomputed from the trusted
 *   config. A caller therefore cannot self-certify a trusted configuration.
 * - The clock used for deadline freshness is supplied by the TRUSTED caller
 *   (`options.now`, or one host clock read when omitted). A request can never
 *   supply, extend or restate the clock.
 *
 * Deadline (protocol-required; absolute epoch milliseconds only):
 * - The request MUST carry `deadline` as an absolute Unix epoch millisecond
 *   integer, the same unit and meaning as the container supervisor's fixed
 *   absolute deadline. Relative durations (`timeoutMs`, `timeoutSeconds`,
 *   `deadlineIn`, `expiresIn`, `ttl`, ...) are refused: a relative form would
 *   let a stale request be re-prepared as if it were still in the future.
 * - Freshness is `deadline > now`. A deadline at or before the trusted clock is
 *   refused as expired, so a lapsed contract can never be revived by preparing
 *   or dispatching it again.
 * - The deadline is bounded twice: it must be a safe integer within the
 *   Date-range ceiling, and no further than `maxDeadlineHorizonMs` beyond the
 *   trusted clock, so a caller cannot widen the window on re-validation.
 * - The deadline is bound into the target and into the digest, so tampering
 *   with it changes the digest and breaks any pin.
 * - This contract proves only the REQUESTED bound. The dispatch layer still
 *   clamps execution to its own bounded command timeout and to the original
 *   grant expiry; neither is proven here.
 *
 * Preparation is not dispatch:
 * - `prepareContainerCommand` is the FIRST phase. `expectedDigest` is optional
 *   there and only pins an already agreed binding. A contract prepared without
 *   a pin reports `pinned:false` and MUST NOT be treated as an executable
 *   pinned contract.
 * - `dispatchContainerCommand` and `verifyContainerCommandContract` are the
 *   FORMAL verification entries. They refuse a missing or changed
 *   `expectedDigest` and re-check deadline freshness against the current
 *   trusted clock. They are pure functions: calling them registers nothing,
 *   spawns nothing and does NOT wire the Agent dispatch point. Wiring is a
 *   separate, later step owned by the GPT lead, and a passing check here is not
 *   product acceptance.
 *
 * Interpreter policy (read before trusting argv):
 * - Refusing a `script` field and never joining a shell is NOT the same as
 *   refusing code execution. An owner-approved alias may resolve to an
 *   interpreter such as `/bin/sh` or `/usr/local/bin/node`, whose argv can run
 *   code (`-c`, `-e`, or a script file). Exact static argv is not host
 *   isolation.
 * - The owner MUST list every interpreter alias in `config.interpreterAliases`.
 *   An unlisted interpreter executable is refused, so changing an alias to
 *   point at a shell, or naming one absolutely, cannot silently enable code
 *   execution.
 * - Even a listed interpreter receives no options of its own: `argv[0]` must be
 *   a non-empty, non-flag program path, and no element anywhere may be an
 *   inline-code flag. This also covers aliases that point at an interpreter.
 * - This does NOT prove that an approved interpreter cannot execute code: it
 *   can still run a script file from the mounted workspace, and the denylist of
 *   interpreters cannot be proven complete. The capability therefore stays
 *   gated on an explicit owner policy and is not product-ready.
 *
 * Digest limitations (must be restated wherever a digest is trusted):
 * - A digest equals neither kernel validation nor a continuous lifecycle proof.
 * - A digest cannot prove physical root safety or private-path safety; that is a
 *   separate WorkspacePin/scope concern evaluated on the live filesystem.
 * - A digest cannot stop the effective config from being replaced after this
 *   check. The dispatching Agent MUST re-verify against the actual trusted
 *   config at dispatch time (see computeContainerCommandDigest).
 *
 * No fallback path exists here. If platform, isolation, image, alias, workspace
 * reference, arguments or digest are anything other than exactly expected, the
 * request is rejected. The command's permission effect is always workspace-write.
 */

export const CONTAINER_COMMAND_TOOL='container_command_v1'
export const CONTAINER_COMMAND_SCHEMA_VERSION=1

/** Immutable fixed image this contract binds. Must stay byte-identical to the
 *  CONTAINER_IMAGE in container-command.ts; a drift guard test enforces parity. */
export const CONTAINER_COMMAND_IMAGE='node@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d'

export const CONTAINER_COMMAND_LIMITS=Object.freeze({
  maxArgs:256,
  maxArgChars:65536,
  maxTotalArgvBytes:1048576,
  maxRelativePathChars:4096,
  maxIdChars:128,
  // Deadline bounds. The deadline is an absolute epoch-ms integer: it may not
  // exceed the representable Date range, and it may not sit further than this
  // horizon beyond the trusted clock, so re-validation cannot widen the window.
  maxDeadlineMs:8640000000000000,
  maxDeadlineHorizonMs:1800000,
  aliasPattern:/^[-a-z0-9]{1,32}$/,
  // Owner aliases resolve only to a safe in-container binary path under a fixed
  // prefix; this grammar rejects host paths, /workspace paths and traversal.
  executablePathPattern:/^\/(?:usr\/local\/bin|usr\/bin|bin)\/[-a-zA-Z0-9_.]+$/,
  idPattern:/^[-a-zA-Z0-9_.]{1,128}$/,
  digestPattern:/^[0-9a-f]{64}$/,
})

export const CONTAINER_COMMAND_TRUST_NOTES=Object.freeze([
  'digest is not kernel validation and not a continuous lifecycle proof',
  'digest cannot prove physical root or private-path safety (WorkspacePin concern)',
  'digest cannot prevent the effective config from being replaced after this check',
  'the dispatching Agent must re-verify against the actual trusted config at dispatch time',
  'no fallback path exists; any deviation is rejected',
  'the deadline is an absolute epoch-ms value from the trusted caller clock; relative durations are refused so a lapsed request cannot be re-prepared as future',
  'exact static argv is not host isolation; an approved interpreter can still run a script file from the mounted workspace',
  'the interpreter denylist cannot be proven complete, so every interpreter alias needs an explicit owner policy and the capability is not product-ready',
])

/** Basenames of executables that can execute caller-supplied code. The check
 *  runs on the RESOLVED executable path, never on the alias, so it covers an
 *  alias pointing at an interpreter, an absolute executable name and any owner
 *  configuration change. This list is a denylist and is not provably complete;
 *  that is exactly why the owner must approve interpreter aliases explicitly. */
export const CONTAINER_COMMAND_INTERPRETERS=Object.freeze([
  'sh','bash','dash','ash','zsh','ksh','busybox','env','xargs','script','nohup','setsid',
  'node','nodejs','deno','bun','qjs',
  'python','python2','python3','pypy','pypy3',
  'perl','ruby','php','lua','luajit','tclsh','wish','r','rscript',
  'awk','gawk','mawk','nawk','sed','ed','ex','vi','vim','nvim',
])

/** Argument tokens that hand inline code to an interpreter. An approved
 *  interpreter may never receive one, in any position, which also covers
 *  delegation forms such as `env node -e ...` or `busybox sh -c ...`. */
export const CONTAINER_COMMAND_CODE_FLAGS=Object.freeze([
  '-e','--eval','-c','-p','--print','-r','--require','--import','-i','--interactive','-m','--module','--input-type',
])

/** Request fields that would restate the deadline as a relative duration. */
export const CONTAINER_COMMAND_RELATIVE_DEADLINE_KEYS=Object.freeze(['timeoutMs','timeout','timeoutSeconds','timeout_s','deadlineIn','deadlineInMs','deadlineRelative','expiresIn','expiresInMs','ttl','ttlMs','maxDuration','maxDurationMs'])

export class ContainerCommandContractError extends Error{
  code:string
  status:number
  constructor(code:string,status:number=400){
    super(code)
    this.name='ContainerCommandContractError'
    this.code=code
    this.status=status
  }
}
const fail=(code:string,status:number=400):never=>{throw new ContainerCommandContractError(code,status)}

/** Deterministic sha256 hex, identical to protocol.sha. */
export const sha256Hex=(value:string)=>createHash('sha256').update(value).digest('hex')
/** Deterministic canonical JSON with recursively sorted object keys; identical
 *  to protocol.canonical so a future wiring step can swap to it unchanged. */
export function canonical(v:any):string{
  if(v===null||typeof v!=='object')return JSON.stringify(v)
  if(Array.isArray(v))return `[${v.map(canonical).join(',')}]`
  return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
}
const constantTimeEqual=(a:string,b:string)=>{
  const x=Buffer.from(a,'hex'),y=Buffer.from(b,'hex')
  return x.length===y.length&&x.length>0&&timingSafeEqual(x,y)
}

/** Resolve the trusted clock for deadline freshness. The caller MUST pass the
 *  clock it actually observed; when omitted the host clock is read exactly once
 *  per call. A request can never supply or influence this value, so a lapsed
 *  deadline stays lapsed. */
const trustedNow=(options?:ContainerCommandOptions):number=>{
  const now=options?.now
  if(now===undefined)return Date.now()
  if(typeof now!=='number'||!Number.isSafeInteger(now)||now<=0||now>CONTAINER_COMMAND_LIMITS.maxDeadlineMs)fail('CONTAINER_COMMAND_CLOCK_INVALID')
  return now
}

/** Validate the absolute epoch-ms deadline. Only an absolute integer is
 *  accepted: a relative duration, a string, a fractional or unsafe number, or
 *  an out-of-range value is refused, and the result is bounded both by the
 *  Date-range ceiling and by the horizon beyond the trusted clock. */
export function validateContainerDeadline(value:any,now:number):number{
  if(value===undefined)fail('CONTAINER_COMMAND_DEADLINE_MISSING')
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0||value>CONTAINER_COMMAND_LIMITS.maxDeadlineMs)fail('CONTAINER_COMMAND_DEADLINE_INVALID')
  if(value<=now)fail('CONTAINER_COMMAND_DEADLINE_EXPIRED',409)
  if(value-now>CONTAINER_COMMAND_LIMITS.maxDeadlineHorizonMs)fail('CONTAINER_COMMAND_DEADLINE_TOO_FAR')
  return value
}

export type PlatformName='linux'|'win32'|'darwin'|string
export type ContainerEffectiveConfig={
  platform:PlatformName
  isolation:'container'|'os-account'|'application'
  image:string
  executables:Record<string,string>
  /** Owner-approved interpreter aliases. Every alias whose resolved executable
   *  is a known interpreter MUST be listed here; see the interpreter policy in
   *  the module header. Absent means no alias may be an interpreter. */
  interpreterAliases?:string[]
  machineId:string
  allowedRoots:string[]
}
export type ContainerWorkspaceRef={
  kind:'remote'
  machineId:string
  rootId:string
  relativePath:string
}
export type ContainerCommandRequest={
  workspaceRef:ContainerWorkspaceRef
  alias:string
  argv:string[]
  /** Absolute Unix epoch milliseconds. Required; see the deadline section of
   *  the module header. Relative durations are refused. */
  deadline:number
  expectedDigest?:string
}
export type ContainerCommandTarget={
  tool:typeof CONTAINER_COMMAND_TOOL
  schemaVersion:number
  machineId:string
  rootId:string
  relativePath:string
  alias:string
  executable:string
  argv:string[]
  image:string
  deadline:number
}
export type ContainerCommandContract={
  tool:typeof CONTAINER_COMMAND_TOOL
  schemaVersion:number
  mutating:true
  effect:'workspace-write'
  target:ContainerCommandTarget
  digest:string
  /** True only when the request carried an `expectedDigest` that matched the
   *  digest recomputed from the trusted config. A prepared contract with
   *  `pinned:false` is not an executable pinned contract. */
  pinned:boolean
  /** The trusted clock reading this contract was validated against. */
  validatedAt:number
}
export type ContainerCommandDispatch=ContainerCommandContract&{
  dispatchVerified:true
  verifiedAt:number
}
/** Trusted clock injection. `now` is epoch milliseconds read by the caller; a
 *  request can never supply it. */
export type ContainerCommandOptions={now?:number}

const REQUEST_KEYS=['workspaceRef','alias','argv','deadline','expectedDigest']
const WORKSPACE_KEYS=['kind','machineId','rootId','relativePath']
const CONFIG_KEYS=['platform','isolation','image','executables','interpreterAliases','machineId','allowedRoots']
const TARGET_KEYS=['tool','schemaVersion','machineId','rootId','relativePath','alias','executable','argv','image','deadline']
const CONTRACT_KEYS=['tool','schemaVersion','mutating','effect','target','digest','pinned','validatedAt','dispatchVerified','verifiedAt']
const isPlainObject=(x:any)=>x!==null&&typeof x==='object'&&!Array.isArray(x)
const closedKeys=(value:any,allowed:string[])=>Object.keys(value).filter(k=>!allowed.includes(k))
const utf8Bytes=(s:string)=>Buffer.byteLength(s,'utf8')

/** Safe relative directory grammar, mirroring Roots.resolve in scope.ts without
 *  node:path so behaviour is identical on every host platform. Empty string is
 *  the workspace root and is allowed. */
export function isSafeRelativePath(value:any):boolean{
  if(typeof value!=='string'||value.includes('\0')||value.length>CONTAINER_COMMAND_LIMITS.maxRelativePathChars)return false
  if(value.startsWith('/'))return false
  if(/^[a-zA-Z]:/.test(value)||/^[/\\]{2}/.test(value)||/[:]/.test(value))return false
  const parts=value.split(/[\\/]/).filter(Boolean)
  return !parts.some(x=>x==='..'||x==='.'||/[. ]$/.test(x))
}

/** Validate the trusted effective container configuration. Defence in depth:
 *  even a trusted caller's config must be closed, Linux, container-isolated,
 *  pinned to the fixed image, and carry a non-empty owner alias map whose every
 *  entry resolves to a safe in-container binary path. */
export function validateContainerEffectiveConfig(value:any):ContainerEffectiveConfig{
  if(!isPlainObject(value))fail('CONTAINER_COMMAND_CONFIG_INVALID')
  if(closedKeys(value,CONFIG_KEYS).length)fail('CONTAINER_COMMAND_CONFIG_INVALID')
  if(typeof value.platform!=='string')fail('CONTAINER_COMMAND_CONFIG_INVALID')
  if(value.platform!=='linux')fail('CONTAINER_COMMAND_PLATFORM_UNSUPPORTED',503)
  if(value.isolation!=='container')fail('CONTAINER_COMMAND_NOT_CONTAINER',503)
  if(value.image!==CONTAINER_COMMAND_IMAGE)fail('CONTAINER_COMMAND_IMAGE_MISMATCH',503)
  if(typeof value.machineId!=='string'||!CONTAINER_COMMAND_LIMITS.idPattern.test(value.machineId))fail('CONTAINER_COMMAND_CONFIG_INVALID')
  if(!Array.isArray(value.allowedRoots)||value.allowedRoots.some((r:any)=>typeof r!=='string'||!CONTAINER_COMMAND_LIMITS.idPattern.test(r)))fail('CONTAINER_COMMAND_CONFIG_INVALID')
  if(!isPlainObject(value.executables)||!Object.keys(value.executables).length)fail('CONTAINER_COMMAND_CONFIG_INVALID')
  for(const [name,path] of Object.entries(value.executables)){
    if(!CONTAINER_COMMAND_LIMITS.aliasPattern.test(name)||typeof path!=='string'||!CONTAINER_COMMAND_LIMITS.executablePathPattern.test(path))fail('CONTAINER_COMMAND_CONFIG_INVALID')
  }
  // Owner interpreter policy: a closed list of aliases the owner explicitly
  // approves as interpreters. Anything else in it, or an alias that is not an
  // interpreter at all, is a configuration error rather than a silent bypass.
  let interpreterAliases:string[]=[]
  if(value.interpreterAliases!==undefined){
    if(!Array.isArray(value.interpreterAliases)||value.interpreterAliases.some((a:any)=>typeof a!=='string'||!CONTAINER_COMMAND_LIMITS.aliasPattern.test(a)))fail('CONTAINER_COMMAND_CONFIG_INVALID')
    if(new Set(value.interpreterAliases).size!==value.interpreterAliases.length)fail('CONTAINER_COMMAND_CONFIG_INVALID')
    interpreterAliases=[...value.interpreterAliases].sort()
    for(const alias of interpreterAliases){
      const path=value.executables[alias]
      if(typeof path!=='string'||!isKnownInterpreter(path))fail('CONTAINER_COMMAND_CONFIG_INVALID')
    }
  }
  return {...value,interpreterAliases} as ContainerEffectiveConfig
}

/** True when the resolved in-container executable is a known interpreter. The
 *  basename of the absolute path is used, so an alias pointing at an
 *  interpreter and an absolute executable name are treated identically. */
export function isKnownInterpreter(executable:string):boolean{
  const base=executable.split('/').pop()??''
  return CONTAINER_COMMAND_INTERPRETERS.includes(base.toLowerCase())
}

/** Approved-interpreter argument policy. An approved interpreter receives no
 *  options of its own: the first element must be a non-empty, non-flag program
 *  path, and no element anywhere may be an inline-code flag. This covers
 *  delegation forms (`env node -e ...`, `busybox sh -c ...`) without relying on
 *  the alias name. It does NOT stop a script file from being executed. */
export function validateInterpreterArgv(executable:string,argv:string[]):void{
  const first=argv[0]
  if(typeof first!=='string'||first.length===0||first.startsWith('-'))fail('CONTAINER_COMMAND_INTERPRETER_ARGUMENT_INVALID',403)
  for(const item of argv){
    if(CONTAINER_COMMAND_CODE_FLAGS.includes(item)||CONTAINER_COMMAND_CODE_FLAGS.some(f=>item.startsWith(`${f}=`)))fail('CONTAINER_COMMAND_INTERPRETER_ARGUMENT_INVALID',403)
  }
}

/** Validate the untrusted workspace reference against the trusted config: it
 *  must be a closed remote reference to the actual machine, a granted root and
 *  a safe relative directory. */
export function validateContainerWorkspaceRef(ref:any,config:ContainerEffectiveConfig):ContainerWorkspaceRef{
  if(!isPlainObject(ref))fail('CONTAINER_COMMAND_WORKSPACE_INVALID')
  if(closedKeys(ref,WORKSPACE_KEYS).length)fail('CONTAINER_COMMAND_WORKSPACE_INVALID')
  if(ref.kind!=='remote')fail('CONTAINER_COMMAND_WORKSPACE_INVALID')
  if(typeof ref.machineId!=='string'||ref.machineId!==config.machineId)fail('CONTAINER_COMMAND_MACHINE_MISMATCH',403)
  if(typeof ref.rootId!=='string'||!config.allowedRoots.includes(ref.rootId))fail('CONTAINER_COMMAND_ROOT_DENIED',403)
  if(!isSafeRelativePath(ref.relativePath))fail('CONTAINER_COMMAND_WORKSPACE_INVALID')
  return {kind:'remote',machineId:ref.machineId,rootId:ref.rootId,relativePath:ref.relativePath}
}

/** Validate and copy the bounded argument vector. Arguments are exact discrete
 *  strings handed to the container process; there is never a shell join. NUL is
 *  rejected, per-element and total byte sizes are capped, and a defensive copy
 *  is returned so later mutation of the caller array cannot change it. */
export function validateContainerArgv(value:any):string[]{
  if(!Array.isArray(value)||value.length>CONTAINER_COMMAND_LIMITS.maxArgs)fail('CONTAINER_COMMAND_ARGUMENT_INVALID')
  let total=0
  const out:string[]=[]
  for(const item of value){
    if(typeof item!=='string')fail('CONTAINER_COMMAND_ARGUMENT_INVALID')
    if(item.includes('\0'))fail('CONTAINER_COMMAND_ARGUMENT_NUL')
    const bytes=utf8Bytes(item)
    if(item.length>CONTAINER_COMMAND_LIMITS.maxArgChars||bytes>CONTAINER_COMMAND_LIMITS.maxTotalArgvBytes)fail('CONTAINER_COMMAND_ARGUMENT_TOO_LARGE')
    total+=bytes
    if(total>CONTAINER_COMMAND_LIMITS.maxTotalArgvBytes)fail('CONTAINER_COMMAND_ARGUMENT_TOO_LARGE')
    out.push(item)
  }
  return out
}

/** Resolve an owner-configured alias to its fixed in-container executable. The
 *  command can only ever be an alias the owner configured; a host path, a script
 *  name, or an unknown alias is rejected. */
export function resolveContainerAlias(alias:any,config:ContainerEffectiveConfig):string{
  if(typeof alias!=='string'||!CONTAINER_COMMAND_LIMITS.aliasPattern.test(alias))fail('CONTAINER_COMMAND_ALIAS_INVALID')
  const executable=Object.hasOwn(config.executables,alias)?config.executables[alias]:undefined
  if(typeof executable!=='string'||!CONTAINER_COMMAND_LIMITS.executablePathPattern.test(executable))fail('CONTAINER_COMMAND_ALIAS_UNKNOWN',403)
  return executable
}

/** Normalize and validate a request into a frozen target bound to the trusted
 *  config. Exported so a dispatching Agent can rebuild a target for re-verifying
 *  a persisted digest against the live config. The deadline is validated here
 *  against the trusted clock, so a lapsed or over-horizon request never becomes
 *  a target. */
export function buildContainerCommandTarget(request:ContainerCommandRequest,config:ContainerEffectiveConfig,options?:ContainerCommandOptions):ContainerCommandTarget{
  const trusted=validateContainerEffectiveConfig(config)
  const now=trustedNow(options)
  const ref=validateContainerWorkspaceRef(request.workspaceRef,trusted)
  const executable=resolveContainerAlias(request.alias,trusted)
  const argv=validateContainerArgv(request.argv)
  const deadline=validateContainerDeadline(request.deadline,now)
  if(isKnownInterpreter(executable)){
    if(!trusted.interpreterAliases?.includes(request.alias))fail('CONTAINER_COMMAND_INTERPRETER_POLICY_REQUIRED',503)
    validateInterpreterArgv(executable,argv)
  }
  return Object.freeze({
    tool:CONTAINER_COMMAND_TOOL,
    schemaVersion:CONTAINER_COMMAND_SCHEMA_VERSION,
    machineId:ref.machineId,
    rootId:ref.rootId,
    relativePath:ref.relativePath,
    alias:request.alias,
    executable,
    argv:Object.freeze(argv),
    image:config.image,
    deadline,
  }) as ContainerCommandTarget
}

/** Deterministic digest binding the target to the trusted effective config.
 *  Uses canonical (key-sorted) serialization, so field/key order never matters.
 *  Any change to the image, the alias map, the interpreter policy, the platform,
 *  the deadline, or the workspace identity (machine/root/relative path/alias/
 *  argv) yields a different digest. This is NOT a kernel or lifecycle proof
 *  (see module header). */
export function computeContainerCommandDigest(config:ContainerEffectiveConfig,target:ContainerCommandTarget):string{
  return sha256Hex(canonical({
    tool:CONTAINER_COMMAND_TOOL,
    schemaVersion:CONTAINER_COMMAND_SCHEMA_VERSION,
    platform:config.platform,
    image:config.image,
    executables:config.executables,
    interpreterAliases:[...(config.interpreterAliases??[])].sort(),
    machineId:config.machineId,
    rootId:target.rootId,
    relativePath:target.relativePath,
    alias:target.alias,
    executable:target.executable,
    argv:target.argv,
    deadline:target.deadline,
  }))
}

/**
 * Prepare a `container_command_v1` contract from an untrusted request and the
 * trusted effective config. Rejects (never falls back) on any deviation: closed
 * request fields, forbidden legacy/script/docker/host/env/endpoint/credential
 * fields, a missing or malformed deadline, a relative deadline form, an expired
 * or over-horizon deadline, an unapproved interpreter alias, non-Linux or
 * non-container config, wrong image, unknown alias, unsafe workspace reference,
 * or out-of-bounds/NUL arguments.
 *
 * This is the FIRST phase only. `request.expectedDigest` is OPTIONAL here and
 * only pins an already agreed binding; the caller can pin a value, never certify
 * the config. A contract returned without a pin reports `pinned:false` and MUST
 * NOT be treated as an executable pinned contract: use
 * `dispatchContainerCommand` for the formal verification entry. On success a
 * frozen contract marked workspace-write is returned; its target is a defensive
 * deep copy so later mutation of the caller inputs cannot change it.
 *
 * Nothing here registers a tool, spawns a process or wires the Agent dispatch
 * point; a successful prepare is not product acceptance.
 */
export function prepareContainerCommand(request:any,config:ContainerEffectiveConfig,options?:ContainerCommandOptions):ContainerCommandContract{
  const trusted=validateContainerEffectiveConfig(config)
  const now=trustedNow(options)
  if(!isPlainObject(request))fail('CONTAINER_COMMAND_REQUEST_INVALID')
  if(Object.hasOwn(request,'script'))fail('CONTAINER_COMMAND_SCRIPT_FORBIDDEN',403)
  const relative=CONTAINER_COMMAND_RELATIVE_DEADLINE_KEYS.filter(k=>Object.hasOwn(request,k))
  if(relative.length)fail('CONTAINER_COMMAND_DEADLINE_RELATIVE_FORBIDDEN',403)
  const forbidden=closedKeys(request,REQUEST_KEYS)
  if(forbidden.length)fail('CONTAINER_COMMAND_FORBIDDEN_FIELD',403)
  const target=buildContainerCommandTarget(request,trusted,{now})
  const digest=computeContainerCommandDigest(trusted,target)
  let pinned=false
  if(request.expectedDigest!==undefined){
    const expected=request.expectedDigest
    if(typeof expected!=='string'||!CONTAINER_COMMAND_LIMITS.digestPattern.test(expected))fail('CONTAINER_COMMAND_DIGEST_INVALID')
    if(!constantTimeEqual(expected,digest))fail('CONTAINER_COMMAND_DIGEST_MISMATCH',409)
    pinned=true
  }
  return Object.freeze({
    tool:CONTAINER_COMMAND_TOOL,
    schemaVersion:CONTAINER_COMMAND_SCHEMA_VERSION,
    mutating:true,
    effect:'workspace-write',
    target,
    digest,
    pinned,
    validatedAt:now,
  }) as ContainerCommandContract
}

/**
 * FORMAL dispatch verification entry for an already prepared request. Unlike
 * `prepareContainerCommand`, a missing `expectedDigest` is refused: the caller
 * must present the binding agreed during preparation, and a request whose
 * workspace, alias, argv or deadline changed since then fails the comparison.
 * Deadline freshness is re-checked against the trusted clock, so a lapsed
 * contract cannot be dispatched, and the returned object is explicitly marked
 * `dispatchVerified`.
 *
 * This is a pure check. It does not execute, does not register a tool and does
 * not by itself wire or enable the Agent dispatch point; the future dispatch
 * point must still re-verify against the actual trusted config and its own
 * bounded command timeout.
 */
export function dispatchContainerCommand(request:any,config:ContainerEffectiveConfig,options?:ContainerCommandOptions):ContainerCommandDispatch{
  const trusted=validateContainerEffectiveConfig(config)
  const now=trustedNow(options)
  if(!isPlainObject(request))fail('CONTAINER_COMMAND_REQUEST_INVALID')
  if(Object.hasOwn(request,'script'))fail('CONTAINER_COMMAND_SCRIPT_FORBIDDEN',403)
  if(CONTAINER_COMMAND_RELATIVE_DEADLINE_KEYS.some(k=>Object.hasOwn(request,k)))fail('CONTAINER_COMMAND_DEADLINE_RELATIVE_FORBIDDEN',403)
  if(closedKeys(request,REQUEST_KEYS).length)fail('CONTAINER_COMMAND_FORBIDDEN_FIELD',403)
  const expected=request.expectedDigest
  if(expected===undefined)fail('CONTAINER_COMMAND_DIGEST_REQUIRED',409)
  if(typeof expected!=='string'||!CONTAINER_COMMAND_LIMITS.digestPattern.test(expected))fail('CONTAINER_COMMAND_DIGEST_INVALID')
  const contract=prepareContainerCommand(request,trusted,{now})
  if(!constantTimeEqual(expected,contract.digest))fail('CONTAINER_COMMAND_DIGEST_MISMATCH',409)
  return Object.freeze({...contract,dispatchVerified:true,verifiedAt:now}) as ContainerCommandDispatch
}

/**
 * FORMAL re-verification of a persisted contract object against the live
 * trusted config and the current trusted clock. The contract's own digest is
 * used as the required pin, so a missing or tampered digest is refused and any
 * change to the trusted config, the workspace binding, the alias, the argv, the
 * deadline or the interpreter policy is detected. A lapsed deadline is refused.
 *
 * Pure check only: this neither executes the command nor wires the Agent.
 */
export function verifyContainerCommandContract(contract:any,config:ContainerEffectiveConfig,options?:ContainerCommandOptions):ContainerCommandDispatch{
  const trusted=validateContainerEffectiveConfig(config)
  const now=trustedNow(options)
  if(!isPlainObject(contract))fail('CONTAINER_COMMAND_CONTRACT_INVALID')
  if(closedKeys(contract,CONTRACT_KEYS).length)fail('CONTAINER_COMMAND_CONTRACT_INVALID')
  if(contract.tool!==CONTAINER_COMMAND_TOOL||contract.schemaVersion!==CONTAINER_COMMAND_SCHEMA_VERSION)fail('CONTAINER_COMMAND_CONTRACT_INVALID')
  if(contract.mutating!==true||contract.effect!=='workspace-write')fail('CONTAINER_COMMAND_CONTRACT_INVALID')
  if(contract.dispatchVerified!==undefined&&contract.dispatchVerified!==true)fail('CONTAINER_COMMAND_CONTRACT_INVALID')
  if(typeof contract.pinned!=='boolean'||typeof contract.validatedAt!=='number'||!Number.isSafeInteger(contract.validatedAt))fail('CONTAINER_COMMAND_CONTRACT_INVALID')
  if(contract.dispatchVerified===true&&(typeof contract.verifiedAt!=='number'||!Number.isSafeInteger(contract.verifiedAt)))fail('CONTAINER_COMMAND_CONTRACT_INVALID')
  if(!isPlainObject(contract.target)||closedKeys(contract.target,TARGET_KEYS).length)fail('CONTAINER_COMMAND_CONTRACT_INVALID')
  const target=contract.target
  return dispatchContainerCommand({
    workspaceRef:{kind:'remote',machineId:target.machineId,rootId:target.rootId,relativePath:target.relativePath},
    alias:target.alias,
    argv:[...target.argv],
    deadline:target.deadline,
    expectedDigest:contract.digest,
  },trusted,{now})
}

/** Pure predicate mirroring prepareContainerCommand without throwing; useful for
 *  capability probing and tests. It deliberately does NOT mirror the formal
 *  dispatch entries, because a probe that succeeds must never be mistaken for a
 *  pinned, dispatchable contract. Never a fallback: a false result must be
 *  turned into a rejection by the caller, not silently downgraded. */
export function isContainerCommandAcceptable(request:any,config:ContainerEffectiveConfig,options?:ContainerCommandOptions):boolean{
  try{prepareContainerCommand(request,config,options);return true}catch{return false}
}

/** Frozen documentation snapshot for callers, tests and the review report. */
export function describeContainerCommandContract(){
  return Object.freeze({
    tool:CONTAINER_COMMAND_TOOL,
    schemaVersion:CONTAINER_COMMAND_SCHEMA_VERSION,
    effect:'workspace-write',
    image:CONTAINER_COMMAND_IMAGE,
    limits:{...CONTAINER_COMMAND_LIMITS,aliasPattern:CONTAINER_COMMAND_LIMITS.aliasPattern.source,executablePathPattern:CONTAINER_COMMAND_LIMITS.executablePathPattern.source,idPattern:CONTAINER_COMMAND_LIMITS.idPattern.source,digestPattern:CONTAINER_COMMAND_LIMITS.digestPattern.source},
    deadline:{
      unit:'absolute Unix epoch milliseconds',
      required:true,
      source:'trusted caller clock (options.now, else one host clock read); never request-supplied',
      relativeForms:'refused; a relative duration would let a lapsed request be re-prepared as future',
      freshness:'deadline must be strictly greater than the trusted clock',
      maxHorizonMs:CONTAINER_COMMAND_LIMITS.maxDeadlineHorizonMs,
      maxDeadlineMs:CONTAINER_COMMAND_LIMITS.maxDeadlineMs,
      boundInto:['target','digest'],
      provesOnlyTheRequestedBound:true,
    },
    phases:{
      prepare:'first phase; expectedDigest optional and only pins an agreed binding; pinned:false is not an executable pinned contract',
      dispatch:'formal verification entry; a missing or changed expectedDigest is refused',
      verify:'formal re-verification of a persisted contract against the live trusted config and current clock',
      wired:false,
    },
    interpreterPolicy:{
      ownerApprovalRequired:'every interpreter alias must be listed in config.interpreterAliases',
      detectedBy:'resolved executable basename, so aliases pointing at an interpreter and absolute names are covered',
      argvRule:'an approved interpreter receives no options of its own and no inline-code flag in any position',
      residual:'an approved interpreter can still execute a script file from the mounted workspace, and the denylist is not provably complete',
      productReady:false,
    },
    interpreters:[...CONTAINER_COMMAND_INTERPRETERS],
    codeFlags:[...CONTAINER_COMMAND_CODE_FLAGS],
    trustNotes:CONTAINER_COMMAND_TRUST_NOTES,
  })
}
