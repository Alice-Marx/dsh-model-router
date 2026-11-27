import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { install } from '../modules/bot-runtime/vendor/ds-bot/src/host/store.js'

test('team state flush completes before replacing the committed snapshot', async t => {
  const base = resolve('tmp/integration/team-durability')
  await fs.mkdir(base, { recursive: true })
  const home = await fs.mkdtemp(join(base, 'case-'))
  const statePath = join(home, 'state.json')
  const disposers = []
  const rt = { home, statePath, warn() {}, ctx: { effect: install => disposers.push(install()) } }
  install(rt)
  t.after(async () => { for (const dispose of disposers) await dispose?.() })
  await rt.load()
  await rt.save()
  const committed = await fs.readFile(statePath, 'utf8')
  const originalWrite = fs.writeFile
  let writes = 0
  fs.writeFile = async (file, data, options) => {
    if (file === `${statePath}.${process.pid}.tmp`) {
      assert.equal(options.flush, true)
      if (++writes === 1) {
        await originalWrite(file, data, 'utf8')
        throw Object.assign(new Error('simulated flush failure'), { code: 'EIO' })
      }
    }
    return originalWrite(file, data, options)
  }
  syncBuiltinESMExports()
  try {
    rt.state.prefs.marker = 'complete'
    await assert.rejects(rt.save(), { code: 'EIO' })
    assert.equal(await fs.readFile(statePath, 'utf8'), committed)
    assert.deepEqual((await fs.readdir(home)).filter(name => name.endsWith('.tmp')), [])
    await rt.save()
    assert.equal(JSON.parse(await fs.readFile(statePath, 'utf8')).prefs.marker, 'complete')
  } finally {
    fs.writeFile = originalWrite
    syncBuiltinESMExports()
  }
})
