import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { includeIncrement } from '../../scripts/integration-upstream-include.mjs'

const [payloadPath] = process.argv.slice(2)
const { options, point, action = 'crash' } = JSON.parse(await readFile(payloadPath, 'utf8'))
await includeIncrement({ ...options, onBoundary: async boundary => {
  if (boundary.point !== point) return
  if (action === 'rollback-write-failure') {
    // Fixture-only collision against the real atomic rollback writer. No
    // production bypass or filesystem permissions outside this fixture.
    const now = Date.now()
    Date.now = () => now
    const target = join(options.root, 'docs/integration/baseline.json')
    const obstruction = join(dirname(target), `.baseline.json.${process.pid}.${now}.tmp`)
    await mkdir(obstruction)
    await writeFile(join(options.root, options.output, 'write-fault.json'), `${JSON.stringify({
      kind: 'fixture-rollback-write-collision', obstruction, ownerPid: process.pid,
    })}\n`, { flag: 'wx' })
    throw new Error(`INCLUSION_TEST_ROLLBACK_WRITE:${point}`)
  }
  if (action === 'throw') throw new Error(`INCLUSION_TEST_PARTIAL_WRITE:${point}`)
  process.exit(86)
} })
process.exitCode = 87
