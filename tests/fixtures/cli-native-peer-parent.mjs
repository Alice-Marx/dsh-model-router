// Real Node creator for the native PowerShell supervisor. The parent test kills
// this process, not the helper, to exercise creator-death rather than stdin EOF.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { nativeProcess } from '../../packages/cli-runtime/src/native-process.mjs'

const [workDir, requestPath] = process.argv.slice(2)
const { helper, home, spec } = JSON.parse(await readFile(requestPath, 'utf8'))
const proc = nativeProcess(helper, 'supervise', spec, { home })
let stderr = ''
proc.events.on('control', () => {})
proc.child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-4096) })
await writeFile(join(workDir, 'parent-ready.json'), JSON.stringify({ wrapperPid: proc.child.pid, creatorPid: process.pid }))
proc.events.once('closed', async value => {
  await writeFile(join(workDir, 'parent-result.json'), JSON.stringify({ ...value, stderr }))
  process.exit(0)
})
proc.events.once('failure', async error => {
  await writeFile(join(workDir, 'parent-result.json'), JSON.stringify({ error: String(error), stderr }))
})
setTimeout(() => process.exit(2), 60_000)
