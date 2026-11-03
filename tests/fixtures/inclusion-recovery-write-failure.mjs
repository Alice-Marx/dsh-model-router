import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { recoverInclusionTransaction } from '../../scripts/integration-upstream-recover.mjs'

const [payloadPath] = process.argv.slice(2)
const options = JSON.parse(await readFile(payloadPath, 'utf8'))
// Preflight still reads valid actual fixture originals/marker. Only the real
// recovery writer's unique temporary file is obstructed in this child process.
const obstruction = `${join(options.root, 'docs/integration/baseline.json')}.${process.pid}.recovery.tmp`
await mkdir(obstruction)
await writeFile(join(options.root, options.output, 'write-fault.json'), `${JSON.stringify({
  kind: 'fixture-recovery-write-collision', obstruction, ownerPid: process.pid,
})}\n`, { flag: 'wx' })
await recoverInclusionTransaction(options)
process.exitCode = 87
