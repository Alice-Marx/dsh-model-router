import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
const c=await import('../remote-computer-agent/src/container-task-contract.ts')
const {baselineConfig,baselineRequest,withWorkspace,withConfig,MACHINE_ID,OTHER_MACHINE_ID,ROOT_ID,OTHER_ROOT_ID,NOW,HORIZON,DEADLINE,PAST_DEADLINE,FAR_DEADLINE,withClock}=await import('./fixtures/container-task-contract-config.mjs')
const cases=await import('./fixtures/container-task-contract-cases.mjs')

const prepare=(request,config,options=withClock)=>c.prepareContainerCommand(request,config,options)
const buildTarget=(request,config,options=withClock)=>c.buildContainerCommandTarget(request,config,options)
const dispatch=(request,config,options=withClock)=>c.dispatchContainerCommand(request,config,options)
const verify=(contract,config,options=withClock)=>c.verifyContainerCommandContract(contract,config,options)
const digest=(config,target)=>c.computeContainerCommandDigest(config,target)
const req=(patch)=>({...baselineRequest(),...patch})
const expectCode=(fn,code)=>{try{fn();assert.fail(`expected rejection ${code}`)}catch(e){assert.equal(e&&e.code,code)}}

test('container task contract: valid baseline prepares a frozen workspace-write contract',()=>{
  const contract=prepare(baselineRequest(),baselineConfig())
  assert.equal(contract.tool,'container_command_v1')
  assert.equal(contract.schemaVersion,1)
  assert.equal(contract.effect,'workspace-write')
  assert.equal(contract.mutating,true)
  assert.match(contract.digest,/^[0-9a-f]{64}$/)
  assert.equal(contract.pinned,false)
  assert.equal(contract.validatedAt,NOW)
  assert.deepEqual({...contract.target},{tool:'container_command_v1',schemaVersion:1,machineId:MACHINE_ID,rootId:ROOT_ID,relativePath:'',alias:'node',executable:'/usr/local/bin/node',argv:['program.mjs'],image:c.CONTAINER_COMMAND_IMAGE,deadline:DEADLINE})
  assert.ok(Object.isFrozen(contract)&&Object.isFrozen(contract.target)&&Object.isFrozen(contract.target.argv))
})

test('container task contract: non-Linux platform is rejected (pure explicit param, host-independent)',()=>{
  for(const platform of ['win32','darwin','freebsd','sunos','Linux','linux '])expectCode(()=>prepare(baselineRequest(),withConfig(baselineConfig(),{platform})),'CONTAINER_COMMAND_PLATFORM_UNSUPPORTED')
})

test('container task contract: no-container, missing and malformed config is rejected',()=>{
  for(const isolation of ['application','os-account'])expectCode(()=>prepare(baselineRequest(),withConfig(baselineConfig(),{isolation})),'CONTAINER_COMMAND_NOT_CONTAINER')
  expectCode(()=>prepare(baselineRequest(),null),'CONTAINER_COMMAND_CONFIG_INVALID')
  expectCode(()=>prepare(baselineRequest(),{}),'CONTAINER_COMMAND_CONFIG_INVALID')
  expectCode(()=>prepare(baselineRequest(),'x'),'CONTAINER_COMMAND_CONFIG_INVALID')
})

test('container task contract: a config not pinned to the fixed image is rejected',()=>{
  expectCode(()=>prepare(baselineRequest(),withConfig(baselineConfig(),{image:'node:latest'})),'CONTAINER_COMMAND_IMAGE_MISMATCH')
})

test('container task contract: effective config is closed (shell/dockerExecutable/unknown keys refused)',()=>{
  for(const patch of [{shell:true},{shell:false},{dockerExecutable:'/usr/bin/docker'},{extra:1},{executables:{}}])expectCode(()=>c.validateContainerEffectiveConfig(withConfig(baselineConfig(),patch)),'CONTAINER_COMMAND_CONFIG_INVALID')
  for(const executables of [{node:'/workspace/node'},{node:'/opt/node'},{Node:'/usr/bin/node'},{'a_b':'/usr/bin/sh'},{'':'/usr/bin/sh'},{node:'/bin/../bin/sh'},{node:'node'}])expectCode(()=>c.validateContainerEffectiveConfig(withConfig(baselineConfig(),{executables})),'CONTAINER_COMMAND_CONFIG_INVALID')
  for(const interpreterAliases of ['node',['node','node'],['git'],['NODE'],['node','git'],[123],[null]])
    expectCode(()=>c.validateContainerEffectiveConfig(withConfig(baselineConfig(),{interpreterAliases})),'CONTAINER_COMMAND_CONFIG_INVALID')
  assert.deepEqual(c.validateContainerEffectiveConfig(baselineConfig()).interpreterAliases,['node'])
})

test('container task contract: unknown alias and host-path command are rejected',()=>{
  for(const [alias,code] of [['python','CONTAINER_COMMAND_ALIAS_UNKNOWN'],['constructor','CONTAINER_COMMAND_ALIAS_UNKNOWN'],['__proto__','CONTAINER_COMMAND_ALIAS_INVALID'],['/usr/local/bin/node','CONTAINER_COMMAND_ALIAS_INVALID'],['/bin/sh','CONTAINER_COMMAND_ALIAS_INVALID'],['','CONTAINER_COMMAND_ALIAS_INVALID'],['NODE','CONTAINER_COMMAND_ALIAS_INVALID']])expectCode(()=>prepare(req({alias}),baselineConfig()),code)
})

test('container task contract: illegal workspace relative directories are rejected',()=>{
  for(const rel of cases.ILLEGAL_RELATIVE_PATHS)expectCode(()=>prepare(withWorkspace(baselineRequest(),{relativePath:rel}),baselineConfig()),'CONTAINER_COMMAND_WORKSPACE_INVALID')
})

test('container task contract: safe relative directories are accepted',()=>{
  for(const rel of ['','sub','sub/dir','a/b/c','.hidden','weird but ok','中文/目录','.a.b'])assert.doesNotThrow(()=>prepare(withWorkspace(baselineRequest(),{relativePath:rel}),baselineConfig()))
})

test('container task contract: machine id and root id must match the trusted config',()=>{
  expectCode(()=>prepare(withWorkspace(baselineRequest(),{machineId:OTHER_MACHINE_ID}),baselineConfig()),'CONTAINER_COMMAND_MACHINE_MISMATCH')
  expectCode(()=>prepare(withWorkspace(baselineRequest(),{rootId:OTHER_ROOT_ID}),baselineConfig()),'CONTAINER_COMMAND_ROOT_DENIED')
  expectCode(()=>prepare(withWorkspace(baselineRequest(),{kind:'local'}),baselineConfig()),'CONTAINER_COMMAND_WORKSPACE_INVALID')
  expectCode(()=>prepare(withWorkspace(baselineRequest(),{injected:1}),baselineConfig()),'CONTAINER_COMMAND_WORKSPACE_INVALID')
})

test('container task contract: argv count, per-element size, total size, NUL and type are enforced',()=>{
  expectCode(()=>prepare(req({argv:new Array(257).fill('x')}),baselineConfig()),'CONTAINER_COMMAND_ARGUMENT_INVALID')
  expectCode(()=>prepare(req({argv:['a\0b']}),baselineConfig()),'CONTAINER_COMMAND_ARGUMENT_NUL')
  expectCode(()=>prepare(req({argv:['x'.repeat(65537)]}),baselineConfig()),'CONTAINER_COMMAND_ARGUMENT_TOO_LARGE')
  assert.doesNotThrow(()=>prepare(req({argv:Array.from({length:16},()=>'y'.repeat(65536))}),baselineConfig()))
  expectCode(()=>prepare(req({argv:Array.from({length:17},()=>'y'.repeat(65536))}),baselineConfig()),'CONTAINER_COMMAND_ARGUMENT_TOO_LARGE')
  expectCode(()=>prepare(req({argv:'not-array'}),baselineConfig()),'CONTAINER_COMMAND_ARGUMENT_INVALID')
  expectCode(()=>prepare(req({argv:[123]}),baselineConfig()),'CONTAINER_COMMAND_ARGUMENT_INVALID')
  expectCode(()=>prepare(req({argv:undefined}),baselineConfig()),'CONTAINER_COMMAND_ARGUMENT_INVALID')
})

test('container task contract: legacy/script/docker/host/env/endpoint/credential fields are rejected',()=>{
  for(const {patch,code} of cases.FORBIDDEN_REQUEST_PATCHES)expectCode(()=>prepare(req(patch),baselineConfig()),code)
})

test('container task contract: missing required fields and non-object request are rejected',()=>{
  expectCode(()=>prepare({alias:'node',argv:['x']},baselineConfig()),'CONTAINER_COMMAND_WORKSPACE_INVALID')
  expectCode(()=>prepare({workspaceRef:baselineRequest().workspaceRef,argv:['x']},baselineConfig()),'CONTAINER_COMMAND_ALIAS_INVALID')
  expectCode(()=>prepare({workspaceRef:baselineRequest().workspaceRef,alias:'node'},baselineConfig()),'CONTAINER_COMMAND_ARGUMENT_INVALID')
  expectCode(()=>prepare(null,baselineConfig()),'CONTAINER_COMMAND_REQUEST_INVALID')
  expectCode(()=>prepare(42,baselineConfig()),'CONTAINER_COMMAND_REQUEST_INVALID')
})

test('container task contract: digest changes when image, alias mapping, or identity changes',()=>{
  const target=buildTarget(baselineRequest(),baselineConfig()),base=digest(baselineConfig(),target)
  assert.notEqual(digest(withConfig(baselineConfig(),{image:'node:latest'}),target),base)
  assert.notEqual(digest(withConfig(baselineConfig(),{executables:{node:'/usr/bin/node'}}),target),base)
  assert.notEqual(digest(withConfig(baselineConfig(),{executables:{node:'/usr/local/bin/node',git:'/usr/bin/git'}}),target),base)
  assert.notEqual(digest(withConfig(baselineConfig(),{platform:'win32'}),target),base)
  assert.notEqual(digest(withConfig(baselineConfig(),{interpreterAliases:[]}),target),base)
  const wide=withConfig(baselineConfig(),{allowedRoots:[ROOT_ID,OTHER_ROOT_ID]})
  assert.notEqual(digest(wide,buildTarget(withWorkspace(baselineRequest(),{rootId:OTHER_ROOT_ID}),wide)),base)
  const moved=withConfig(baselineConfig(),{machineId:OTHER_MACHINE_ID})
  assert.notEqual(digest(moved,buildTarget(withWorkspace(baselineRequest(),{machineId:OTHER_MACHINE_ID}),moved)),base)
  assert.notEqual(digest(baselineConfig(),buildTarget(req({argv:['program.mjs','--flag']}),baselineConfig())),base)
  assert.notEqual(digest(baselineConfig(),buildTarget(req({deadline:DEADLINE+1}),baselineConfig())),base)
  assert.equal(digest(baselineConfig(),buildTarget(baselineRequest(),baselineConfig())),base)
})

test('container task contract: digest does not depend on object key order',()=>{
  const a=prepare(baselineRequest(),baselineConfig())
  const b=prepare({argv:['program.mjs'],alias:'node',deadline:DEADLINE,workspaceRef:{relativePath:'',rootId:ROOT_ID,machineId:MACHINE_ID,kind:'remote'}},{allowedRoots:[ROOT_ID],machineId:MACHINE_ID,executables:{node:'/usr/local/bin/node'},interpreterAliases:['node'],image:c.CONTAINER_COMMAND_IMAGE,isolation:'container',platform:'linux'})
  assert.equal(a.digest,b.digest)
})

test('container task contract: a stale expected digest is rejected, a correct one is accepted',()=>{
  const cfg=baselineConfig(),good=prepare(baselineRequest(),cfg)
  assert.equal(prepare(req({expectedDigest:good.digest}),cfg).digest,good.digest)
  assert.equal(prepare(req({expectedDigest:good.digest}),cfg).pinned,true)
  expectCode(()=>prepare(req({argv:['program.mjs','changed'],expectedDigest:good.digest}),cfg),'CONTAINER_COMMAND_DIGEST_MISMATCH')
  expectCode(()=>prepare(req({expectedDigest:good.digest}),withConfig(cfg,{executables:{node:'/usr/bin/node'}})),'CONTAINER_COMMAND_DIGEST_MISMATCH')
  expectCode(()=>prepare(req({expectedDigest:'nothex'}),cfg),'CONTAINER_COMMAND_DIGEST_INVALID')
  expectCode(()=>prepare(req({expectedDigest:c.sha256Hex('x')}),cfg),'CONTAINER_COMMAND_DIGEST_MISMATCH')
})

test('container task contract: caller cannot self-certify a trusted config via a matching digest',()=>{
  const trusted=baselineConfig(),attackerConfig=withConfig(baselineConfig(),{executables:{node:'/usr/bin/node'}})
  const attackerDigest=digest(attackerConfig,buildTarget(baselineRequest(),attackerConfig))
  expectCode(()=>prepare(req({expectedDigest:attackerDigest}),trusted),'CONTAINER_COMMAND_DIGEST_MISMATCH')
  expectCode(()=>prepare(req({config:attackerConfig}),trusted),'CONTAINER_COMMAND_FORBIDDEN_FIELD')
})

test('container task contract: special argv are exact discrete strings with no shell concatenation',()=>{
  const contract=prepare(req({argv:cases.SPECIAL_ARGV}),baselineConfig())
  assert.deepEqual([...contract.target.argv],cases.SPECIAL_ARGV)
  const serialized=JSON.stringify(contract)
  assert.ok(!serialized.includes('"shell"')&&!serialized.includes('"script"')&&!serialized.includes('"-c"'))
  assert.equal(contract.target.executable,'/usr/local/bin/node')
})

test('container task contract: returned contract is a safe copy unaffected by later input mutation',()=>{
  const request=baselineRequest(),config=baselineConfig(),contract=prepare(request,config)
  const digestBefore=contract.digest,argvSnapshot=[...contract.target.argv]
  request.argv.push('injected');request.argv[0]='mutated';request.workspaceRef.relativePath='../escape';request.alias='git';request.deadline=DEADLINE+1
  config.executables.git='/usr/bin/git';config.machineId=OTHER_MACHINE_ID;config.allowedRoots.push(OTHER_ROOT_ID)
  assert.equal(contract.digest,digestBefore)
  assert.deepEqual([...contract.target.argv],argvSnapshot)
  assert.equal(contract.target.alias,'node')
  assert.equal(contract.target.relativePath,'')
  assert.equal(contract.target.machineId,MACHINE_ID)
  assert.equal(contract.target.deadline,DEADLINE)
  assert.ok(Object.isFrozen(contract.target.argv))
  assert.throws(()=>{contract.target.argv.push('x')})
})

test('container task contract: isContainerCommandAcceptable never throws and mirrors prepare',()=>{
  assert.equal(c.isContainerCommandAcceptable(baselineRequest(),baselineConfig(),withClock),true)
  assert.equal(c.isContainerCommandAcceptable(req({script:'x'}),baselineConfig(),withClock),false)
  assert.equal(c.isContainerCommandAcceptable(baselineRequest(),withConfig(baselineConfig(),{platform:'win32'}),withClock),false)
  assert.equal(c.isContainerCommandAcceptable(req({alias:'nope'}),baselineConfig(),withClock),false)
  assert.equal(c.isContainerCommandAcceptable(req({deadline:PAST_DEADLINE}),baselineConfig(),withClock),false)
})

test('container task contract: describeContainerCommandContract documents tool, effect and trust notes',()=>{
  const d=c.describeContainerCommandContract()
  assert.equal(d.tool,'container_command_v1')
  assert.equal(d.effect,'workspace-write')
  assert.ok(Object.isFrozen(d))
  assert.ok(d.trustNotes.some(n=>n.includes('no fallback')))
  assert.ok(d.trustNotes.some(n=>n.includes('physical root')))
  assert.ok(d.trustNotes.some(n=>n.includes('replaced after this check')))
})

test('container task contract: image constant stays byte-identical to container-command.ts',async()=>{
  const src=await readFile(new URL('../remote-computer-agent/src/container-command.ts',import.meta.url),'utf8')
  const match=src.match(/CONTAINER_IMAGE\s*=\s*'([^']+)'/)
  assert.ok(match,'CONTAINER_IMAGE literal not found in container-command.ts')
  assert.equal(c.CONTAINER_COMMAND_IMAGE,match[1])
})

test('container task contract: sha256Hex and canonical are deterministic and key-sorted',()=>{
  assert.equal(c.sha256Hex('x'),'2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881')
  assert.equal(c.canonical({b:1,a:2}),c.canonical({a:2,b:1}))
  assert.equal(c.canonical({a:[3,{d:1,c:2}]}),'{"a":[3,{"c":2,"d":1}]}')
})

test('container task contract: deadline is required, absolute and never request-supplied clock',()=>{
  const cfg=baselineConfig()
  expectCode(()=>prepare(req({deadline:undefined}),cfg),'CONTAINER_COMMAND_DEADLINE_MISSING')
  expectCode(()=>prepare({workspaceRef:baselineRequest().workspaceRef,alias:'node',argv:['program.mjs']},cfg),'CONTAINER_COMMAND_DEADLINE_MISSING')
  expectCode(()=>prepare(baselineRequest(),cfg,{now:'x'}),'CONTAINER_COMMAND_CLOCK_INVALID')
  expectCode(()=>prepare(baselineRequest(),cfg,{now:1.5}),'CONTAINER_COMMAND_CLOCK_INVALID')
  expectCode(()=>prepare(baselineRequest(),cfg,{now:NaN}),'CONTAINER_COMMAND_CLOCK_INVALID')
  expectCode(()=>prepare(baselineRequest(),cfg,{now:-1}),'CONTAINER_COMMAND_CLOCK_INVALID')
  for(const patch of cases.RELATIVE_DEADLINE_PATCHES)expectCode(()=>prepare(req(patch.patch),cfg),patch.code)
  expectCode(()=>dispatch(req({timeoutMs:60000}),cfg),'CONTAINER_COMMAND_DEADLINE_RELATIVE_FORBIDDEN')
})

test('container task contract: malformed deadlines are refused as invalid integers',()=>{
  for(const deadline of cases.INVALID_DEADLINES)expectCode(()=>prepare(req({deadline}),baselineConfig()),'CONTAINER_COMMAND_DEADLINE_INVALID')
  assert.equal(c.validateContainerDeadline(DEADLINE,NOW),DEADLINE)
})

test('container task contract: an expired or over-horizon deadline is refused, so a lapsed task cannot become future-valid',()=>{
  const cfg=baselineConfig()
  for(const deadline of [PAST_DEADLINE,NOW,NOW-60000])expectCode(()=>prepare(req({deadline}),cfg),'CONTAINER_COMMAND_DEADLINE_EXPIRED')
  expectCode(()=>prepare(req({deadline:FAR_DEADLINE}),cfg),'CONTAINER_COMMAND_DEADLINE_TOO_FAR')
  assert.doesNotThrow(()=>prepare(req({deadline:NOW+HORIZON}),cfg))
  assert.doesNotThrow(()=>prepare(req({deadline:NOW+1}),cfg))
  // A contract prepared before its deadline cannot be revived by re-validating
  // it later, and rewinding the trusted clock cannot widen the window either.
  const contract=prepare(baselineRequest(),cfg)
  expectCode(()=>verify(contract,cfg,{now:NOW+60001}),'CONTAINER_COMMAND_DEADLINE_EXPIRED')
  expectCode(()=>prepare(req({deadline:NOW+HORIZON}),cfg,{now:NOW-1}),'CONTAINER_COMMAND_DEADLINE_TOO_FAR')
})

test('container task contract: a tampered deadline breaks the binding and any pin',()=>{
  const cfg=baselineConfig(),good=prepare(baselineRequest(),cfg)
  assert.notEqual(prepare(req({deadline:DEADLINE+1}),cfg).digest,good.digest)
  expectCode(()=>prepare(req({deadline:DEADLINE+1,expectedDigest:good.digest}),cfg),'CONTAINER_COMMAND_DIGEST_MISMATCH')
  expectCode(()=>dispatch(req({deadline:DEADLINE+1,expectedDigest:good.digest}),cfg),'CONTAINER_COMMAND_DIGEST_MISMATCH')
  const tampered={...good,target:{...good.target,deadline:DEADLINE+1}}
  expectCode(()=>verify(tampered,cfg),'CONTAINER_COMMAND_DIGEST_MISMATCH')
})

test('container task contract: preparation is not dispatch; dispatch refuses a missing or changed pin',()=>{
  const cfg=baselineConfig(),prepared=prepare(baselineRequest(),cfg)
  assert.equal(prepared.pinned,false)
  assert.equal(prepared.dispatchVerified,undefined)
  expectCode(()=>dispatch(baselineRequest(),cfg),'CONTAINER_COMMAND_DIGEST_REQUIRED')
  expectCode(()=>dispatch(req({expectedDigest:undefined}),cfg),'CONTAINER_COMMAND_DIGEST_REQUIRED')
  expectCode(()=>dispatch(req({expectedDigest:'nothex'}),cfg),'CONTAINER_COMMAND_DIGEST_INVALID')
  const sent=dispatch(req({expectedDigest:prepared.digest}),cfg)
  assert.equal(sent.digest,prepared.digest)
  assert.equal(sent.dispatchVerified,true)
  assert.equal(sent.verifiedAt,NOW)
  assert.equal(sent.pinned,true)
  assert.ok(Object.isFrozen(sent))
  expectCode(()=>dispatch(req({argv:['program.mjs','changed'],expectedDigest:prepared.digest}),cfg),'CONTAINER_COMMAND_DIGEST_MISMATCH')
  expectCode(()=>dispatch(req({alias:'node',argv:['program.mjs'],deadline:DEADLINE,workspaceRef:baselineRequest().workspaceRef,expectedDigest:prepared.digest}),withConfig(cfg,{executables:{node:'/usr/bin/node'}})),'CONTAINER_COMMAND_DIGEST_MISMATCH')
  expectCode(()=>dispatch(req({expectedDigest:prepared.digest,deadline:undefined}),cfg),'CONTAINER_COMMAND_DEADLINE_MISSING')
  expectCode(()=>dispatch(req({script:'x',expectedDigest:prepared.digest}),cfg),'CONTAINER_COMMAND_SCRIPT_FORBIDDEN')
  expectCode(()=>dispatch(req({expectedDigest:prepared.digest}),cfg,{now:NOW+60001}),'CONTAINER_COMMAND_DEADLINE_EXPIRED')
})

test('container task contract: verifyContainerCommandContract re-verifies a persisted contract against the live config and clock',()=>{
  const cfg=baselineConfig(),contract=prepare(baselineRequest(),cfg)
  const checked=verify(contract,cfg)
  assert.equal(checked.digest,contract.digest)
  assert.equal(checked.dispatchVerified,true)
  assert.deepEqual([...checked.target.argv],['program.mjs'])
  assert.equal(verify(dispatch(req({expectedDigest:contract.digest}),cfg),cfg).digest,contract.digest)
  expectCode(()=>verify({...contract,digest:c.sha256Hex('tamper')},cfg),'CONTAINER_COMMAND_DIGEST_MISMATCH')
  const {digest:_drop,...noDigest}=contract
  expectCode(()=>verify(noDigest,cfg),'CONTAINER_COMMAND_DIGEST_REQUIRED')
  expectCode(()=>verify({...contract,target:{...contract.target,argv:['other.mjs']}},cfg),'CONTAINER_COMMAND_DIGEST_MISMATCH')
  expectCode(()=>verify({...contract,target:{...contract.target,rootId:OTHER_ROOT_ID}},cfg),'CONTAINER_COMMAND_ROOT_DENIED')
  expectCode(()=>verify({...contract,extra:1},cfg),'CONTAINER_COMMAND_CONTRACT_INVALID')
  expectCode(()=>verify(null,cfg),'CONTAINER_COMMAND_CONTRACT_INVALID')
  expectCode(()=>verify({...contract,mutating:false},cfg),'CONTAINER_COMMAND_CONTRACT_INVALID')
  expectCode(()=>verify({...contract,tool:'other_v1'},cfg),'CONTAINER_COMMAND_CONTRACT_INVALID')
  expectCode(()=>verify({...contract,dispatchVerified:'yes'},cfg),'CONTAINER_COMMAND_CONTRACT_INVALID')
  expectCode(()=>verify({...contract,target:{...contract.target,injected:1}},cfg),'CONTAINER_COMMAND_CONTRACT_INVALID')
  expectCode(()=>verify({tool:'container_command_v1',schemaVersion:1,mutating:true,effect:'workspace-write',target:contract.target,digest:contract.digest},cfg),'CONTAINER_COMMAND_CONTRACT_INVALID')
  expectCode(()=>verify(contract,withConfig(cfg,{executables:{node:'/usr/bin/node'}})),'CONTAINER_COMMAND_DIGEST_MISMATCH')
  expectCode(()=>verify(contract,cfg,{now:NOW+60001}),'CONTAINER_COMMAND_DEADLINE_EXPIRED')
})

test('container task contract: an interpreter alias needs an explicit owner policy, whatever its name or absolute path',()=>{
  for(const {alias,executables} of cases.INTERPRETER_CONFIGS){
    const unapproved=withConfig(baselineConfig(),{executables,interpreterAliases:[]})
    expectCode(()=>prepare(req({alias}),unapproved),'CONTAINER_COMMAND_INTERPRETER_POLICY_REQUIRED')
    expectCode(()=>dispatch(req({alias,expectedDigest:c.sha256Hex('pin')}),unapproved),'CONTAINER_COMMAND_INTERPRETER_POLICY_REQUIRED')
  }
  // A normal alias repointed at a shell by a configuration change is refused
  // until the owner re-declares it.
  const changed=withConfig(baselineConfig(),{executables:{node:'/usr/local/bin/node',git:'/bin/sh'},interpreterAliases:['node']})
  expectCode(()=>prepare(req({alias:'git'}),changed),'CONTAINER_COMMAND_INTERPRETER_POLICY_REQUIRED')
  const declared=withConfig(baselineConfig(),{executables:{node:'/usr/local/bin/node',git:'/bin/sh'},interpreterAliases:['node','git']})
  assert.equal(prepare(req({alias:'git'}),declared).target.executable,'/bin/sh')
})

test('container task contract: an approved interpreter can never receive inline code or its own options',()=>{
  for(const {alias,executables,interpreterAliases} of cases.INTERPRETER_CONFIGS){
    const cfg=withConfig(baselineConfig(),{executables,interpreterAliases})
    for(const argv of cases.INTERPRETER_ARGV_ATTACKS)expectCode(()=>prepare(req({alias,argv}),cfg),'CONTAINER_COMMAND_INTERPRETER_ARGUMENT_INVALID')
    for(const argv of cases.INTERPRETER_ALLOWED_ARGV)assert.doesNotThrow(()=>prepare(req({alias,argv}),cfg))
    const contract=prepare(req({alias}),cfg)
    assert.deepEqual([...contract.target.argv],['program.mjs'])
  }
})

test('container task contract: a normal non-interpreter alias keeps its own flags (no parameter-name ban)',()=>{
  const cfg=withConfig(baselineConfig(),{executables:{node:'/usr/local/bin/node',git:'/usr/bin/git'},interpreterAliases:['node']})
  const contract=prepare(req({alias:'git',argv:['-c','core.pager=cat','status']}),cfg)
  assert.deepEqual([...contract.target.argv],['-c','core.pager=cat','status'])
  assert.equal(contract.target.executable,'/usr/bin/git')
  assert.equal(c.isKnownInterpreter('/usr/bin/git'),false)
  assert.equal(c.isKnownInterpreter('/bin/sh'),true)
  assert.equal(c.isKnownInterpreter('/usr/local/bin/node'),true)
})

test('container task contract: an approved interpreter can still run a script file, so the capability stays owner-gated',()=>{
  // Documented residual risk, asserted rather than hidden: the argument policy
  // blocks inline code, not a script file from the mounted workspace.
  const cfg=baselineConfig()
  assert.doesNotThrow(()=>prepare(req({argv:['evil.mjs']}),cfg))
  const d=c.describeContainerCommandContract()
  assert.equal(d.interpreterPolicy.productReady,false)
  assert.match(d.interpreterPolicy.residual,/script file/)
  assert.ok(d.trustNotes.some(n=>n.includes('not host isolation')))
  assert.ok(d.trustNotes.some(n=>n.includes('owner policy')))
  assert.equal(d.phases.wired,false)
  assert.equal(d.deadline.unit,'absolute Unix epoch milliseconds')
  assert.equal(d.deadline.maxHorizonMs,HORIZON)
})
