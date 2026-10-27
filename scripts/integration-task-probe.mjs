import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {openTaskJournal} from '../packages/orchestration/src/task-journal.mjs'

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..')
export const DEFAULT_TASK_DRIVER=resolve(ROOT,'tmp/integration/probes/sqlite/node_modules/better-sqlite3/lib/index.js')
export async function verifyTaskDriver(path) {
  const manifest=JSON.parse(await readFile(resolve(dirname(path),'../package.json'),'utf8'))
  assert.equal(manifest.name,'better-sqlite3');assert.equal(manifest.version,'13.0.3')
  return (await import(pathToFileURL(path).href)).default
}
async function main(args) {
  if(args[0]==='--crash-child') {
    const Database=await verifyTaskDriver(resolve(args[1])),journal=openTaskJournal(Database,resolve(args[2]))
    const fence=journal.claimRunner('crash-child',500,1000)
    const task=journal.submit(fence,'crash-bot','crash-request','fixture',{fixture:true},5000,1001)
    journal.claim(fence,'crash-bot',task.taskId,1002)
    process.stdout.write(JSON.stringify(task)+'\n',()=>process.exit(23))
    return
  }
  assert.ok(args.length===0||(args.length===2&&args[0]==='--driver'),'Use --driver <verified-better-sqlite3-entry>')
  const driver=args.length?resolve(args[1]):DEFAULT_TASK_DRIVER
  await verifyTaskDriver(driver)
  const parent=join(ROOT,'tmp/integration/task-native');await mkdir(parent,{recursive:true})
  const run=await mkdtemp(join(parent,'suite-'))
  const env={DSH_TASK_DRIVER:pathToFileURL(driver).href,HOME:run,USERPROFILE:run,APPDATA:run,LOCALAPPDATA:run}
  for(const key of ['PATH','Path','SystemRoot','windir','TEMP','TMP','TMPDIR','LANG'])if(process.env[key])env[key]=process.env[key]
  const result=spawnSync(process.execPath,['--test','tests/task-journal.native.mjs'],{cwd:ROOT,env,encoding:'utf8',timeout:90_000,windowsHide:true,maxBuffer:4*1024*1024})
  await writeFile(join(run,'native-tests.log'),result.stdout+'\n'+result.stderr)
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr)
  const count=name=>Number(new RegExp(`(?:#|ℹ) ${name} (\\d+)`).exec(result.stdout)?.[1])
  const summary={status:'passed',driverVersion:'13.0.3',node:process.version,platform:process.platform,tests:count('tests'),pass:count('pass'),fail:count('fail'),actualModelCalls:0,
    limitations:['Single-package read-only task foundation; not complete Task DAG or money accounting','Fixture backends and intentional process exit; no native CLI or remote agent execution']}
  await writeFile(join(run,'summary.json'),JSON.stringify(summary,null,2)+'\n')
  process.stdout.write(JSON.stringify(summary,null,2)+'\n')
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1})
