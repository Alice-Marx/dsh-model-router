import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { generate } from './build-client.mjs'
import { buildOpenmausProtocol } from './build-openmaus-protocol.mjs'

const root = resolve(import.meta.dirname, '..')
// Keep stdout available for npm pack --json.
const run = file => execFileSync(process.execPath, [join(root, file)], { cwd: root, stdio: ['ignore', 2, 2] })
run('scripts/check-readme.mjs')
const result = await generate({ check: true })
if (!result.ok) throw new Error(result.errors?.join('; ') ?? 'client build check failed')
await buildOpenmausProtocol()
run('remote-computer-agent/build.mjs')
mkdirSync(join(root, 'dist'), { recursive: true })
