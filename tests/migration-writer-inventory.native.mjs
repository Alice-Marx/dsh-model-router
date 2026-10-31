import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, open, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { inventoryMigrationWriters } from '../packages/orchestration/src/migration-writer-inventory.mjs'

const linux = process.platform === 'linux', only = { skip: !linux }
const parent = resolve('tmp/integration/migration-writer-inventory'); await mkdir(parent, { recursive: true })
const exited = child => new Promise(done => child.once('exit', (code, signal) => done({ code, signal })))

/**
 * A real child process holding declared handles inside a synthetic domain.
 * mode 'write' keeps a write handle open; 'read' holds a read-only handle;
 * 'cwd' only chdirs into the domain.
 */
function holder(t, domain, mode, name) {
  return new Promise((resolveHolder, reject) => {
    const ready = join(domain, `ready-${name}.json`)
    const target = join(domain, `held-${name}`)
    const program = mode === 'cwd'
      ? `const fs=require('node:fs');process.chdir(${JSON.stringify(domain)});fs.writeFileSync(${JSON.stringify(ready)},'cwd');setInterval(()=>{},1000)`
      : `const fs=require('node:fs');const fd=fs.openSync(${JSON.stringify(target)},${mode === 'write' ? "'a'" : "'r'"},0o600);${mode === 'read' ? "fs.readSync(fd,Buffer.alloc(1),0,1,0);" : ""}fs.writeFileSync(${JSON.stringify(ready)},String(fd));setInterval(()=>{},1000)`
    const child = spawn(process.execPath, ['-e', program], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''; child.stderr.on('data', data => { stderr += data })
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
    const timer = setTimeout(() => reject(new Error(`holder did not start: ${stderr}`)), 15000)
    const poll = async () => {
      try { const value = await readFile(ready, 'utf8'); clearTimeout(timer); resolveHolder({ child, value }) }
      catch { setTimeout(poll, 50) }
    }
    void poll()
  })
}

test('writer inventory: input shape is closed and bounded', async () => {
  const dir = await mkdtemp(join(parent, 'case-'))
  for (const bad of [
    [], 'x', [{}], [{ name: 'x' }], [{ roots: [dir] }], [{ name: 'x', roots: [] }], [{ name: 'x', roots: [dir], extra: 1 }],
    [{ name: 'x', roots: ['relative/path'] }], [{ name: 'x', roots: [dir + '\0'] }], [{ name: 'x'.repeat(129), roots: [dir] }],
  ]) await assert.rejects(inventoryMigrationWriters({ domains: bad }), /MIGRATION_WRITER_INPUT_INVALID/)
  await assert.rejects(inventoryMigrationWriters({ domains: [{ name: 'x', roots: [dir] }], limits: { nope: 1 } }), /MIGRATION_WRITER_INPUT_INVALID/)
  await assert.rejects(inventoryMigrationWriters({ domains: [{ name: 'x', roots: [dir] }], limits: { maxPids: 0 } }), /MIGRATION_WRITER_INPUT_INVALID/)
})

test('writer inventory: diagnostics never claim a stop-write proof', async () => {
  const dir = await mkdtemp(join(parent, 'case-'))
  const result = await inventoryMigrationWriters({ domains: [{ name: 'empty', roots: [dir] }] })
  assert.equal(result.schemaVersion, 1)
  assert.equal(result.stopWriteProvable, false, 'an inventory is a diagnostic, never a stop proof')
  assert.equal(result.domains.length, 1)
  assert.ok(Array.isArray(result.domains[0].roots))
})

test('writer inventory: a missing root is a diagnostic, not an error', async () => {
  const dir = await mkdtemp(join(parent, 'case-'))
  const result = await inventoryMigrationWriters({ domains: [{ name: 'gap', roots: [join(dir, 'absent')] }] })
  assert.equal(result.domains[0].roots[0].diagnostic, 'ROOT_MISSING')
})

test('writer inventory: non-Linux platforms report the capability gap honestly', { skip: linux }, async () => {
  const dir = await mkdtemp(join(parent, 'case-'))
  const result = await inventoryMigrationWriters({ domains: [{ name: 'win', roots: [dir] }] })
  assert.equal(result.enumeration.mode, 'unavailable')
  assert.ok(result.domains[0].diagnostics.includes('WRITER_ENUMERATION_UNAVAILABLE'))
  assert.equal(result.stopWriteProvable, false)
})

test('writer inventory: a live write handle inside the domain is observed with identity', only, async t => {
  const dir = await mkdtemp(join(parent, 'case-')), domain = join(dir, 'domain'); await mkdir(domain)
  const held = await holder(t, domain, 'write', 'w1')
  const result = await inventoryMigrationWriters({ domains: [{ name: 'd1', roots: [domain] }] })
  const accessor = result.domains[0].accessors.find(entry => entry.pid === held.child.pid)
  assert.ok(accessor, 'the write holder is observed')
  assert.equal(accessor.writable, true)
  assert.ok(accessor.accesses.some(entry => entry.kind === 'handle' && entry.mode === 'write'))
  assert.equal(typeof accessor.startedAtTicks, 'number')
  assert.ok(accessor.comm)
  held.child.kill('SIGKILL'); await exited(held.child)
  const after = await inventoryMigrationWriters({ domains: [{ name: 'd1', roots: [domain] }] })
  assert.equal(after.domains[0].accessors.find(entry => entry.pid === held.child.pid), undefined, 'a dead holder is gone')
})

test('writer inventory: a read-only handle is observed but not writable', only, async t => {
  const dir = await mkdtemp(join(parent, 'case-')), domain = join(dir, 'domain'); await mkdir(domain)
  await writeFile(join(domain, 'held-r1'), 'read me')
  const held = await holder(t, domain, 'read', 'r1')
  const result = await inventoryMigrationWriters({ domains: [{ name: 'd1', roots: [domain] }] })
  const accessor = result.domains[0].accessors.find(entry => entry.pid === held.child.pid)
  assert.ok(accessor)
  assert.equal(accessor.writable, false, 'a read-only handle must not be classified writable')
  assert.ok(accessor.accesses.every(entry => entry.mode !== 'write'))
})

test('writer inventory: a process whose working directory is inside the domain is observed', only, async t => {
  const dir = await mkdtemp(join(parent, 'case-')), domain = join(dir, 'domain'); await mkdir(domain)
  const held = await holder(t, domain, 'cwd', 'c1')
  const result = await inventoryMigrationWriters({ domains: [{ name: 'd1', roots: [domain] }] })
  const accessor = result.domains[0].accessors.find(entry => entry.pid === held.child.pid)
  assert.ok(accessor, 'cwd access is reported as potential-writer evidence')
  assert.ok(accessor.accesses.some(entry => entry.kind === 'cwd'))
})

test('writer inventory: overlapping declarations converge on one physical identity', only, async t => {
  const dir = await mkdtemp(join(parent, 'case-')), domain = join(dir, 'domain'); await mkdir(domain)
  const alias = join(dir, 'alias')
  const { symlink } = await import('node:fs/promises'); await symlink(domain, alias)
  const held = await holder(t, domain, 'write', 'w2')
  const result = await inventoryMigrationWriters({ domains: [{ name: 'real', roots: [domain] }, { name: 'aliased', roots: [alias] }] })
  for (const report of result.domains) {
    const accessor = report.accessors.find(entry => entry.pid === held.child.pid)
    assert.ok(accessor, `${report.name} observes the holder through its own declaration`)
    assert.equal(accessor.writable, true)
  }
  const identities = result.domains.flatMap(d => d.roots.map(r => r.identity))
  assert.equal(new Set(identities).size, 1, 'the alias resolves to the same physical identity')
})

test('writer inventory: the calling process itself is not hidden', only, async t => {
  const dir = await mkdtemp(join(parent, 'case-')), domain = join(dir, 'domain'); await mkdir(domain)
  const probe = join(domain, 'probe.bin'); await writeFile(probe, 'x')
  const keep = await open(probe, 'r')  // the caller's own read handle inside the domain
  t.after(() => keep.close())
  const result = await inventoryMigrationWriters({ domains: [{ name: 'd1', roots: [domain] }] })
  const self = result.domains[0].accessors.find(entry => entry.pid === process.pid)
  assert.ok(self, 'the caller holding a domain handle is reported like any process')
  assert.equal(self.writable, false)
  await keep.close()
  const after = await inventoryMigrationWriters({ domains: [{ name: 'd1', roots: [domain] }] })
  assert.equal(after.domains[0].accessors.find(entry => entry.pid === process.pid), undefined, 'closing the handle clears the report')
})
