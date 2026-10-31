import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchMigrationLinuxProcessTree } from '../../packages/orchestration/src/migration-linux-quarantine.mjs'

const [workDir, requestPath] = process.argv.slice(2)
const request = JSON.parse(await readFile(requestPath, 'utf8'))
const handle = await launchMigrationLinuxProcessTree(request)
await writeFile(join(workDir, 'parent-ready.json'), JSON.stringify({ wrapperPid: handle.runnerPid, creatorPid: process.pid }))
handle.closed.then(async result => {
  await writeFile(join(workDir, 'parent-result.json'), JSON.stringify(result))
  process.exit(0)
})
setTimeout(() => process.exit(2), 60000)
