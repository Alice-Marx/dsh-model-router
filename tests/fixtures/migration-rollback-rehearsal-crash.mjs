import {readFile} from 'node:fs/promises'
import Database from 'better-sqlite3'
import {beginMigrationExclusive} from '../../packages/orchestration/src/migration-fence.mjs'
import {rehearseMigrationRollback} from '../../packages/orchestration/src/migration-rollback-rehearsal.mjs'

const request=JSON.parse(await readFile(process.argv[2],'utf8'))
const {fenceHome,operationId,crashPhase,...rehearsal}=request
const fence=await beginMigrationExclusive(fenceHome,{operationId,drainTimeoutMs:30000,pollMs:10})
await rehearseMigrationRollback({Database,...rehearsal,assertExclusive:()=>fence.verify(),onBoundary:async boundary=>{
 if(crashPhase==='domain-0'&&boundary.phase==='domain-restored'&&boundary.index===0)process.exit(86)
 if(crashPhase==='domain-1'&&boundary.phase==='domain-restored'&&boundary.index===1)process.exit(86)
 if(crashPhase==='ledger'&&boundary.phase==='ledger-restored')process.exit(86)
 if(crashPhase==='final'&&boundary.phase==='before-final-recheck')process.exit(86)
}})
await fence.release()
