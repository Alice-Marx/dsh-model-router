import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { generate } from './build-client.mjs'

const root = resolve(import.meta.dirname, '..')
execFileSync(process.execPath, [join(root, 'scripts/check-readme.mjs')], { stdio: 'inherit' })
const result = await generate({ check: true })
if (!result.ok) throw new Error(result.errors?.join('; ') ?? 'client build check failed')
mkdirSync(join(root, 'dist'), { recursive: true })
