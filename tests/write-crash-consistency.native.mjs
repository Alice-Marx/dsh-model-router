import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'

await import('../remote-computer-agent/build.mjs')
const { Agent } = await import('../remote-computer-agent/dist/index.mjs')
const fixture = resolve('tests/fixtures/migration-write-crash.mjs')
const enabled = process.platform === 'win32'
const parent = resolve('tmp/integration/write-crash-consistency')
await mkdir(parent, { recursive: true })

for (const phase of ['before-rename', 'after-rename']) {
  test(`write crash consistency: ${phase} leaves one complete file and an unknown original operation`, { skip: !enabled, timeout: 30000 }, async t => {
    const dir = await mkdtemp(join(parent, 'case-')), project = join(dir, 'project')
    await mkdir(project)
    await writeFile(join(project, 'result.txt'), 'old complete\n')
    const child = spawn(process.execPath, [fixture, dir, phase], { cwd: dir, stdio: 'ignore', windowsHide: true })
    const exit = new Promise((resolveExit, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolveExit({ code, signal }))
    })
    assert.deepEqual(await exit, { code: 86, signal: null })
    const expected = phase === 'before-rename' ? 'old complete\n' : 'new complete\n'
    assert.equal(await readFile(join(project, 'result.txt'), 'utf8'), expected, 'the visible file is wholly old or wholly new, never a partial payload')

    const restarted = new Agent({ dataDir: join(dir, 'agent'), roots: { project } }, Database)
    t.after(() => restarted.close())
    const operation = restarted.store.db.prepare('SELECT id,status,result,error FROM operations WHERE id=?').get('operation-crash')
    assert.equal(operation.status, 'unknown')
    assert.equal(operation.error, 'OUTCOME_UNKNOWN')
    assert.equal(operation.result, null, 'the interrupted write cannot become a success receipt')
  })
}
