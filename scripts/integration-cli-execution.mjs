import {spawnSync} from 'node:child_process'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
const root=resolve(import.meta.dirname,'..'),output=join(root,'tmp/integration/cli-execution')
const result=spawnSync(process.execPath,['--test','tests/cli-execution.native.mjs'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4*1024*1024})
await mkdir(output,{recursive:true});await writeFile(join(output,'tests.log'),result.stdout+'\n'+result.stderr)
const count=key=>Number(new RegExp(`(?:#|ℹ) ${key} (\\d+)`).exec(result.stdout)?.[1])
const summary={status:result.status===0?'passed':'failed',level:'native-task-money-with-offline-cli',platform:process.platform,node:process.version,tests:count('tests'),pass:count('pass'),fail:count('fail'),actualModelCalls:0,
  limitations:['Real SQLite Task and financial stores; the injected CLI protocol is an explicitly offline test double','Real Codex native bridge and version proof are verified separately; no inference turn in this probe','Default product Task/funding configuration, other official CLI adapters, remote execution and approvals remain open','Task/execution reference and financial admission have separate fenced transactions; complete atomic admission remains open','Codex configured-model proof is insufficient for an actual API invoice; API CLI charges stay unknown with their hold']}
await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2))
if(result.status!==0){console.error(result.stdout+'\n'+result.stderr);process.exitCode=1}
