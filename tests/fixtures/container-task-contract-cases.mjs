// Deterministic synthesized inputs for container-task-contract tests.
// Data only; the test file supplies the trusted baseline and assertions.

// Legacy / script / docker / host / env / endpoint / credential fields that a
// caller might try to smuggle into a container_command_v1 request. Each entry is
// a patch merged onto a valid baseline request plus the expected reject code.
export const FORBIDDEN_REQUEST_PATCHES=[
  {patch:{script:'rm -rf /'},code:'CONTAINER_COMMAND_SCRIPT_FORBIDDEN'},
  {patch:{executable:'/bin/sh'},code:'CONTAINER_COMMAND_FORBIDDEN_FIELD'},
  {patch:{env:{SECRET:'x'}},code:'CONTAINER_COMMAND_FORBIDDEN_FIELD'},
  {patch:{dockerArgs:['--privileged']},code:'CONTAINER_COMMAND_FORBIDDEN_FIELD'},
  {patch:{dockerOptions:'--privileged'},code:'CONTAINER_COMMAND_FORBIDDEN_FIELD'},
  {patch:{endpoint:'http://attacker'},code:'CONTAINER_COMMAND_FORBIDDEN_FIELD'},
  {patch:{url:'http://attacker'},code:'CONTAINER_COMMAND_FORBIDDEN_FIELD'},
  {patch:{token:'attacker-token'},code:'CONTAINER_COMMAND_FORBIDDEN_FIELD'},
  {patch:{secret:'attacker-secret'},code:'CONTAINER_COMMAND_FORBIDDEN_FIELD'},
  {patch:{credentials:'attacker'},code:'CONTAINER_COMMAND_FORBIDDEN_FIELD'},
  {patch:{password:'attacker'},code:'CONTAINER_COMMAND_FORBIDDEN_FIELD'},
  {patch:{image:'node:latest'},code:'CONTAINER_COMMAND_FORBIDDEN_FIELD'},
  {patch:{shell:true},code:'CONTAINER_COMMAND_FORBIDDEN_FIELD'},
  {patch:{config:{image:'node:latest'}},code:'CONTAINER_COMMAND_FORBIDDEN_FIELD'},
  {patch:{machineId:'machine-contract-fixture'},code:'CONTAINER_COMMAND_FORBIDDEN_FIELD'},
  {patch:{rootId:'project'},code:'CONTAINER_COMMAND_FORBIDDEN_FIELD'},
]

// Relative directories that must be refused by the safe-path grammar.
export const ILLEGAL_RELATIVE_PATHS=[
  '/abs','/','../escape','..','a/../b','a\\..\\b','.','./a','a/.',
  'C:\\win','\\\\srv\\share','//unc','a:b','trailing ','trailing.',
  'a\0b','ok/../..',
]

// Exact argv that must survive verbatim with no shell joining.
export const SPECIAL_ARGV=[
  'a b','中文','line\nnext','--privileged','$(echo x)',';rm -rf /',
  '`id`','&& echo','|cat','a\tb','',
]

// Owner configurations in which an alias resolves to a known interpreter. The
// approval column is the only difference, so these prove the gate is an owner
// policy decision and not an alias-name or parameter-name ban.
export const INTERPRETER_CONFIGS=[
  {alias:'node',executables:{node:'/usr/local/bin/node'},interpreterAliases:['node']},
  {alias:'sh',executables:{sh:'/bin/sh'},interpreterAliases:['sh']},
  {alias:'bx',executables:{bx:'/bin/busybox'},interpreterAliases:['bx']},
  {alias:'py',executables:{py:'/usr/bin/python3'},interpreterAliases:['py']},
  {alias:'tool',executables:{tool:'/usr/bin/env'},interpreterAliases:['tool']},
]

// argv that must be refused for an owner-approved interpreter. These cover
// inline code, interpreter-owned options, delegation forms and combined short
// flags; none of them is banned because of a parameter name on a normal alias.
export const INTERPRETER_ARGV_ATTACKS=[
  ['-e','process.exit(1)'],
  ['--eval','process.exit(1)'],
  ['-e=process.exit(1)'],
  ['--eval=process.exit(1)'],
  ['-p','1+1'],
  ['--print','1+1'],
  ['-r','fs'],
  ['--require','fs'],
  ['--import','fs'],
  ['-i'],
  ['--interactive'],
  ['-m','http'],
  ['--module','http'],
  ['--input-type','module'],
  ['--input-type=module'],
  ['-c','rm -rf /'],
  ['-ec','rm -rf /'],
  ['-ce','rm -rf /'],
  ['-'],
  [''],
  ['sh','-c','rm -rf /'],
  ['node','-e','process.exit(1)'],
  ['python3','-c','import os'],
  ['-e'],
]

// argv that must keep working: an approved interpreter running a program file,
// and a normal non-interpreter alias taking its own flags. Note that a script's
// own argument that happens to be an inline-code flag is still refused for an
// approved interpreter; that over-rejection is deliberate and safe by default.
export const INTERPRETER_ALLOWED_ARGV=[
  ['program.mjs'],
  ['program.mjs','--flag'],
  ['a b','中文','line\nnext'],
]

// Malformed deadline values that must be refused as DEADLINE_INVALID.
export const INVALID_DEADLINES=[
  NaN,Infinity,-Infinity,-1,0,1.5,'1793300060000',null,true,{},[],1793300060000.5,
  Number.MAX_SAFE_INTEGER+2,8640000000000001,
]

// Request fields that restate the deadline as a relative duration.
export const RELATIVE_DEADLINE_PATCHES=[
  {patch:{timeoutMs:60000},code:'CONTAINER_COMMAND_DEADLINE_RELATIVE_FORBIDDEN'},
  {patch:{timeout:60},code:'CONTAINER_COMMAND_DEADLINE_RELATIVE_FORBIDDEN'},
  {patch:{timeoutSeconds:60},code:'CONTAINER_COMMAND_DEADLINE_RELATIVE_FORBIDDEN'},
  {patch:{deadlineIn:60000},code:'CONTAINER_COMMAND_DEADLINE_RELATIVE_FORBIDDEN'},
  {patch:{expiresIn:60000},code:'CONTAINER_COMMAND_DEADLINE_RELATIVE_FORBIDDEN'},
  {patch:{ttl:60000},code:'CONTAINER_COMMAND_DEADLINE_RELATIVE_FORBIDDEN'},
  {patch:{maxDurationMs:60000},code:'CONTAINER_COMMAND_DEADLINE_RELATIVE_FORBIDDEN'},
]
