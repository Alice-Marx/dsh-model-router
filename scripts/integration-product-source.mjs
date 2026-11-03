import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncDsBot } from './sync-ds-bot.mjs'

export async function verifyProductSource() {
  return syncDsBot({ check: true })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await verifyProductSource())}\n`)
}
