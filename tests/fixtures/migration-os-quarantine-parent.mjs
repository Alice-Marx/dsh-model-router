import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchMigrationProcessTree } from '../../packages/orchestration/src/migration-os-quarantine.mjs'

const [workDir, requestPath] = process.argv.slice(2)
const request = JSON.parse(await readFile(requestPath, 'utf8'))
const handle = await launchMigrationProcessTree(request)
await writeFile(join(workDir, 'parent-ready.json'), JSON.stringify({ wrapperPid: handle.runnerPid, creatorPid: process.pid }))
handle.closed.then(async result => {
  await writeFile(join(workDir, 'parent-result.json'), JSON.stringify(result))
  process.exit(0)
})
setTimeout(() => process.exit(2), 60000)
