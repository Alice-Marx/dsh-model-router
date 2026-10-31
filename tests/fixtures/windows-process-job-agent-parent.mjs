// Mimics the Agent's spawn contract from remote-computer-agent/src/agent.ts: it creates
// the wrapper directly (no shell), pipes stdio and writes exactly one JSON request line
// to stdin. Used by tests/windows-process-job.native.mjs to stand in for the real Agent
// process so the wrapper's parent-death behaviour can be observed without touching the
// Agent sources.
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [workDir, wrapper, requestPath] = process.argv.slice(2)
const request = JSON.parse(await readFile(requestPath, 'utf8'))
const child = spawn(wrapper, [], { cwd: workDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
child.stdin.end(JSON.stringify(request) + '\n')
child.stdin.on('error', () => {})
await writeFile(join(workDir,'parent-ready.json'),JSON.stringify({wrapperPid:child.pid,creatorPid:process.pid}))
let stdout = '', stderr = ''
child.stdout.on('data', (chunk) => { stdout += chunk })
child.stderr.on('data', (chunk) => { stderr += chunk })
const report = (extra) => writeFile(join(workDir, 'parent-result.json'), JSON.stringify({ wrapperPid: child.pid, stdout, stderr, ...extra }))
child.on('error', async (error) => { await report({ error: String(error) }); process.exit(1) })
child.on('close', async (code, signal) => { await report({ exitCode: code, signal }); process.exit(0) })
setTimeout(() => { void report({ error: 'parent fixture idle timeout' }).then(() => process.exit(2)) }, 60000)
