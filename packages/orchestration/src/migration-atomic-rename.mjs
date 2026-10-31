import { rename } from 'node:fs/promises'

const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY'])
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function renameMigrationFile(source, target, { renameOperation = rename, sleep = pause } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      await renameOperation(source, target)
      return
    } catch (error) {
      if (attempt >= 5 || !TRANSIENT.has(error?.code)) throw error
      await sleep(50)
    }
  }
}
