import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { quarantineSystemdLaunchers } from '../../packages/orchestration/src/migration-systemd-quarantine.mjs'

const [workDir, requestPath] = process.argv.slice(2)
const request = JSON.parse(await readFile(requestPath, 'utf8'))
await quarantineSystemdLaunchers(request)
await writeFile(join(workDir, 'parent-ready.json'), JSON.stringify({ creatorPid: process.pid }))
setInterval(() => {}, 1000)
