import {spawnSync} from 'node:child_process'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
const result=spawnSync(process.execPath,['--test','tests/cli-runtime-native.test.mjs'],{cwd:resolve(import.meta.dirname,'..'),encoding:'utf8',timeout:180000,windowsHide:true,maxBuffer:4*1024*1024})
const output=resolve('tmp/integration/cli-native-tests');await mkdir(output,{recursive:true});await writeFile(join(output,'tests.log'),result.stdout+'\n'+result.stderr)
const count=key=>Number(new RegExp(`(?:#|ℹ) ${key} (\\d+)`).exec(result.stdout)?.[1])
const tests=count('tests'),pass=count('pass'),fail=count('fail'),skipped=count('skipped')
const status=result.status!==0?'failed':tests===0&&skipped>0?'skipped':'passed'
const summary={status,platform:process.platform,node:process.version,peer:process.platform==='win32'?'windows-kernel-pid':'python-peer',tests,pass,fail,skipped,actualModelCalls:0,
  limitations:['Synthetic owned fixture CLI only; the real Codex app-server entry probe requires an installation-attested executable','No real model inference; CLI model identity and usage remain unverified here']}
await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2))
if(status==='failed'){console.error(result.stdout+'\n'+result.stderr);process.exitCode=1}
