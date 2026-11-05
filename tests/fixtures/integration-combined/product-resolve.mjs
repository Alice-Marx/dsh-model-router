import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// A source checkout has dev peer SDKs installed; a production plugin uses its Host's peers.
// Resolve the whole product through the selected isolated Host, including modules outside vendor.
const product = new URL('../../../', import.meta.url).href
const sources = ['.dsh-plugin/', 'modules/', 'packages/'].map(path => product + path)
if (!process.env.DSH_HARNESS) throw new Error('Isolated product SDK anchor is required')
const anchor = pathToFileURL(resolve(process.env.DSH_HARNESS, 'package.json')).href
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@deepseek-ai/') && sources.some(prefix => context.parentURL?.startsWith(prefix))) return next(specifier, { ...context, parentURL: anchor })
  return next(specifier, context)
} })
