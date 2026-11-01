import {readFile} from 'node:fs/promises'
import Database from 'better-sqlite3'
import {restoreMigrationArchives} from '../../packages/orchestration/src/migration-restore.mjs'

const request=JSON.parse(await readFile(process.argv[2],'utf8'))
await restoreMigrationArchives({Database,...request,onBoundary:async boundary=>{
 if(boundary.phase==='domain-restored'&&boundary.index===0&&request.crashPhase==='domain')process.exit(86)
 if(boundary.phase==='ledger-restored'&&request.crashPhase==='ledger')process.exit(86)
}})
