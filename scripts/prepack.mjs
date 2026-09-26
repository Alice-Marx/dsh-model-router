import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { generate } from './build-client.mjs'

const root = resolve(import.meta.dirname, '..')
const result = await generate({ check: true })
if (!result.ok) throw new Error(result.errors?.join('; ') ?? 'client build check failed')
mkdirSync(join(root, 'dist'), { recursive: true })
