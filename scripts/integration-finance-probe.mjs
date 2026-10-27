import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {DEFAULT_TASK_DRIVER,verifyTaskDriver} from './integration-task-probe.mjs'
import {openSqliteRouterState} from '../packages/orchestration/src/sqlite-router-state.mjs'
import {createBudgetReservations} from '../.dsh-plugin/shared/budget-reservations.mjs'

async function main(args){
  if(args[0]==='--writer'||args[0]==='--crash'){
    const Database=await verifyTaskDriver(resolve(args[1]))
    const [file,legacyFile]=args.slice(2,4).map(p=>resolve(p))
    const store=await openSqliteRouterState({Database,file,legacyFile,lockStaleMs:1,onStep:step=>{if(args[0]==='--crash'&&step===args[4])process.exit(42)}})
    if(args[0]==='--crash')await store.rollback()
    else{
      const id=args[4],run={id,createdAt:Date.now(),status:'running',packages:[]}
      const value=await createBudgetReservations({state:store}).beginExecution({run,packageEstimates:[{id:'direct',estimatedCostUsd:0.7}],dailyLimitUsd:1})
      process.stdout.write(JSON.stringify({accepted:value.accepted})+'\n')
    }
    await store.close();return
  }
  assert.ok(!args.length,'No public probe arguments')
  await verifyTaskDriver(DEFAULT_TASK_DRIVER)
  const parent=resolve('tmp/integration/finance-native');await mkdir(parent,{recursive:true})
  const run=await mkdtemp(join(parent,'suite-'))
  const env={DSH_TASK_DRIVER:pathToFileURL(DEFAULT_TASK_DRIVER).href,HOME:run,USERPROFILE:run,APPDATA:run,LOCALAPPDATA:run}
  for(const key of ['PATH','Path','SystemRoot','windir','TEMP','TMP','TMPDIR','LANG'])if(process.env[key])env[key]=process.env[key]
  const result=spawnSync(process.execPath,['--test','tests/sqlite-router-state.native.mjs'],{cwd:process.cwd(),env,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4*1024*1024})
  await writeFile(join(run,'native-tests.log'),result.stdout+'\n'+result.stderr)
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr)
  const count=key=>Number(new RegExp(`(?:#|ℹ) ${key} (\\d+)`).exec(result.stdout)?.[1])
  const summary={status:'passed',driverVersion:'13.0.3',node:process.version,platform:process.platform,tests:count('tests'),pass:count('pass'),fail:count('fail'),actualModelCalls:0,limitations:['Isolated native driver and controlled homes; no automatic product profile migration','MR ledger/holds use one SQLite authority; front-channel Bot/auxiliary accounting and complete Task admission transaction remain open']}
  assert.ok(summary.tests>0&&summary.fail===0)
  await writeFile(join(run,'summary.json'),JSON.stringify(summary,null,2)+'\n')
  process.stdout.write(JSON.stringify(summary,null,2)+'\n')
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1})
