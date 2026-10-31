import {spawnSync} from 'node:child_process'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
const root=resolve(import.meta.dirname,'..'),output=join(root,'tmp/integration/remote-machines')
const result=spawnSync(process.execPath,['--test','tests/remote-machines.native.mjs'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4*1024*1024})
await mkdir(output,{recursive:true});await writeFile(join(output,'tests.log'),result.stdout+'\n'+result.stderr)
const count=key=>Number(new RegExp(`(?:#|ℹ) ${key} (\\d+)`).exec(result.stdout)?.[1])
const summary={status:result.status===0?'passed':'failed',level:'native-host-agent-http',platform:process.platform,node:process.version,tests:count('tests'),pass:count('pass'),fail:count('fail'),actualModelCalls:0,
  limitations:['This probe owns a local loopback Agent; deployed remote targets are separate evidence','Only the default read tool facade is enabled; shell/browser/desktop Task execution remains separate','No live public TLS, VPN, Electron ABI or production deployment claim']}
await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2))
if(result.status!==0){console.error(result.stdout+'\n'+result.stderr);process.exitCode=1}
