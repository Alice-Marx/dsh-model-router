import {spawnSync} from 'node:child_process'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
const args=process.argv.slice(2),env={...process.env}
if(args.length){if(args.length!==2||args[0]!=='--driver')throw Error('Use --driver <better-sqlite3-entry>');env.DSH_REMOTE_AGENT_DRIVER=new URL('file:///'+resolve(args[1]).replaceAll('\\','/')).href}
const result=spawnSync(process.execPath,['--test','tests/remote-agent.test.mjs'],{cwd:resolve(import.meta.dirname,'..'),env,encoding:'utf8',timeout:120000,windowsHide:true,maxBuffer:4*1024*1024})
const output=resolve('tmp/integration/agent-native');await mkdir(output,{recursive:true});await writeFile(join(output,'tests.log'),result.stdout+'\n'+result.stderr)
const count=key=>Number(new RegExp(`(?:#|ℹ) ${key} (\\d+)`).exec(result.stdout)?.[1])
const summary={status:result.status===0?'passed':'failed',platform:process.platform,node:process.version,driver:'better-sqlite3@13.0.3',tests:count('tests'),pass:count('pass'),fail:count('fail'),actualModelCalls:0,limitations:['No complete Host policy/UI integration or persistent production deployment','Interactive Windows/DPI/multi-display and signed installer acceptance remain separate','Four network modes validated at configuration boundary; no live VPN/Tunnel/public TLS connection in this probe']}
await writeFile(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));if(result.status!==0){console.error(result.stdout+'\n'+result.stderr);process.exitCode=1}
