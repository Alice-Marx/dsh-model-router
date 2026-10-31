import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, rename, symlink, link, lstat, stat, open, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { loadPinnedWrite } from './fixtures/pinned-write-build.mjs'
import { barrier, caseDir, names, identity, digest, assertNoPinnedTemps, rejectsWith } from './fixtures/pinned-write-hostile.mjs'

const { pinnedCreateNewFile, pinnedWriteSupported, PinnedDirectory } = await loadPinnedWrite()
const linux = process.platform === 'linux'
const only = { skip: !linux }

test('pinned write: unsupported platforms are refused instead of silently degrading', async t => {
  assert.equal(pinnedWriteSupported('linux'), true)
  for (const platform of ['win32', 'darwin', 'freebsd', 'sunos', 'aix']) assert.equal(pinnedWriteSupported(platform), false, platform)
  if (linux) return
  const dir = await caseDir('platform'), root = join(dir, 'root')
  await mkdir(root)
  await rejectsWith(pinnedCreateNewFile({ rootPath: root, relativePath: 'new.txt', content: 'must never exist' }), 'PINNED_WRITE_UNSUPPORTED')
  await rejectsWith(PinnedDirectory.pin(root), 'PINNED_WRITE_UNSUPPORTED')
  assert.deepEqual(await names(root), [], 'a refused platform must not touch the filesystem')
})

test('pinned create: writes a brand-new file with exact bytes, 0600 mode and one link', only, async t => {
  const dir = await caseDir('create'), root = join(dir, 'root'), nested = join(root, 'nested', 'dir')
  await mkdir(nested, { recursive: true })
  const content = 'pinned payload\nsecond line\n'
  const result = await pinnedCreateNewFile({ rootPath: root, relativePath: 'nested/dir/notes.txt', content })
  assert.equal(result.path, await realpath(join(nested, 'notes.txt')))
  assert.equal(result.directoryPath, await realpath(nested))
  assert.equal(result.size, Buffer.byteLength(content))
  assert.equal(result.sha256, digest(content))
  assert.equal(result.nlink, 1)
  assert.equal(await readFile(result.path, 'utf8'), content)
  const onDisk = await stat(result.path)
  assert.equal(onDisk.mode & 0o777, 0o600)
  assert.equal(onDisk.nlink, 1, 'the published name must be the only link once the call returned')
  assert.equal(`${onDisk.dev}:${onDisk.ino}`, `${result.dev}:${result.ino}`)
  assert.deepEqual(await names(nested), ['notes.txt'])
  await assertNoPinnedTemps(root, nested)
})

test('pinned create: the before-pin report describes the real directory the write must stay inside', only, async t => {
  const dir = await caseDir('report'), root = join(dir, 'root'), nested = join(root, 'nested')
  await mkdir(nested, { recursive: true })
  const reports = []
  const result = await pinnedCreateNewFile({ rootPath: root, relativePath: 'nested/placed.txt', content: 'reported', check: async report => { reports.push(report) } })
  assert.equal(result.path, await realpath(join(nested, 'placed.txt')))
  assert.deepEqual(reports.map(r => r.phase), ['before-pin', 'before-publish', 'after-publish'])
  const [first] = reports
  assert.equal(first.rootPath, await realpath(root))
  assert.equal(first.directoryPath, await realpath(nested))
  assert.equal(first.targetPath, await realpath(join(nested, 'placed.txt')))
  assert.equal(first.targetName, 'placed.txt')
  assert.equal(first.sha256, digest('reported'))
  assert.equal(first.size, 8)
  assert.equal(first.temp, undefined, 'no temp file exists before the pin')
  assert.equal(`${(await stat(nested)).dev}:${(await stat(nested)).ino}`, `${first.directory.dev}:${first.directory.ino}`)
  assert.equal(reports[1].temp.name.startsWith('.dsh-pinned-write-'), true)
  assert.equal(reports[2].directory.ino, first.directory.ino)
})

test('pinned create: the private temp file is 0600, exclusive and visible only while parked', only, async t => {
  const dir = await caseDir('temp-detail'), root = join(dir, 'root')
  await mkdir(root)
  const gate = barrier()
  let parked = null
  const check = async report => { if (report.phase === 'before-publish') { parked = report; await gate.hold() } }
  const job = pinnedCreateNewFile({ rootPath: root, relativePath: 'parked.txt', content: 'parked payload', check })
  await gate.arrived
  assert.equal(parked.temp.size, Buffer.byteLength('parked payload'))
  assert.equal(parked.temp.mode, 0o600)
  assert.deepEqual(await names(root), [parked.temp.name], 'only the private temp file may exist while parked')
  assert.equal((await stat(join(root, parked.temp.name))).mode & 0o777, 0o600)
  assert.equal((await lstat(join(root, parked.temp.name))).nlink, 1)
  gate.release()
  const result = await job
  assert.equal(result.path, await realpath(join(root, 'parked.txt')))
  assert.equal(await stat(join(root, parked.temp.name)).then(() => 'present', () => 'absent'), 'absent', 'the private name must be gone after publication')
  assert.deepEqual(await names(root), ['parked.txt'])
})

test('pinned create: base64 and empty payloads round-trip exactly', only, async t => {
  const dir = await caseDir('payload'), root = join(dir, 'root')
  await mkdir(root)
  const raw = Buffer.from([0, 1, 2, 253, 254, 255])
  const binary = await pinnedCreateNewFile({ rootPath: root, relativePath: 'binary.bin', content: raw.toString('base64'), encoding: 'base64' })
  assert.deepEqual(await readFile(binary.path), raw)
  assert.equal(binary.sha256, digest(raw))
  assert.equal(binary.size, raw.byteLength)
  const empty = await pinnedCreateNewFile({ rootPath: root, relativePath: 'empty.txt', content: '' })
  assert.equal(empty.size, 0)
  assert.equal(empty.sha256, digest(Buffer.alloc(0)))
  assert.equal((await readFile(empty.path)).byteLength, 0)
  assert.deepEqual(await names(root), ['binary.bin', 'empty.txt'])
})

test('pinned create: an existing target is never overwritten', only, async t => {
  const dir = await caseDir('exists'), root = join(dir, 'root')
  await mkdir(root)
  const target = join(root, 'taken.txt')
  await writeFile(target, 'original owner content')
  const before = await identity(target)
  await rejectsWith(pinnedCreateNewFile({ rootPath: root, relativePath: 'taken.txt', content: 'attacker content' }), 'TARGET_EXISTS')
  assert.equal(await readFile(target, 'utf8'), 'original owner content')
  assert.equal(await identity(target), before)
  assert.deepEqual(await names(root), ['taken.txt'])
  await assertNoPinnedTemps(root)
})

test('pinned create: an existing directory target is refused and left intact', only, async t => {
  const dir = await caseDir('exists-dir'), root = join(dir, 'root')
  await mkdir(root)
  await mkdir(join(root, 'occupied'))
  await writeFile(join(root, 'occupied', 'keep.txt'), 'keep')
  await rejectsWith(pinnedCreateNewFile({ rootPath: root, relativePath: 'occupied', content: 'replacement' }), 'TARGET_EXISTS')
  assert.deepEqual(await names(join(root, 'occupied')), ['keep.txt'])
  assert.deepEqual(await names(root), ['occupied'])
  await assertNoPinnedTemps(root)
})

test('pinned create: a symlink at the target is refused and never followed', only, async t => {
  const dir = await caseDir('symlink-target'), root = join(dir, 'root'), outside = join(dir, 'outside')
  await mkdir(root); await mkdir(outside)
  const secret = join(outside, 'secret.txt')
  await writeFile(secret, 'protected payload')
  await symlink(secret, join(root, 'alias.txt'))
  await rejectsWith(pinnedCreateNewFile({ rootPath: root, relativePath: 'alias.txt', content: 'replacement' }), 'TARGET_EXISTS')
  assert.equal(await readFile(secret, 'utf8'), 'protected payload')
  assert.equal((await lstat(join(root, 'alias.txt'))).isSymbolicLink(), true)
  assert.deepEqual(await names(root), ['alias.txt'])
  await assertNoPinnedTemps(root)
})

test('pinned create: a dangling symlink target is refused', only, async t => {
  const dir = await caseDir('symlink-dangling'), root = join(dir, 'root'), outside = join(dir, 'outside')
  await mkdir(root); await mkdir(outside)
  await symlink(join(outside, 'absent.txt'), join(root, 'dangling.txt'))
  await rejectsWith(pinnedCreateNewFile({ rootPath: root, relativePath: 'dangling.txt', content: 'replacement' }), 'TARGET_EXISTS')
  assert.equal((await lstat(join(root, 'dangling.txt'))).isSymbolicLink(), true)
  assert.deepEqual(await names(outside), [])
  assert.deepEqual(await names(root), ['dangling.txt'])
  await assertNoPinnedTemps(root)
})

test('pinned create: a symlinked directory component is refused instead of followed', only, async t => {
  const dir = await caseDir('symlink-parent'), root = join(dir, 'root'), outside = join(dir, 'outside')
  await mkdir(root); await mkdir(outside)
  await symlink(outside, join(root, 'escape'), 'dir')
  await rejectsWith(pinnedCreateNewFile({ rootPath: root, relativePath: 'escape/planted.txt', content: 'escaped' }), 'WORKSPACE_OUTSIDE_SCOPE')
  // A symlink that is not the immediate parent passes the admission lstat, so the
  // descriptor walk has to classify it. Linux reports ENOTDIR rather than ELOOP
  // for `O_DIRECTORY|O_NOFOLLOW` on a symlink, which is exactly the case that
  // used to be answered with TARGET_PARENT_INVALID.
  await mkdir(join(outside, 'deeper'))
  await assert.rejects(pinnedCreateNewFile({ rootPath: root, relativePath: 'escape/deeper/planted.txt', content: 'escaped' }), error => {
    assert.equal(error?.code, 'WORKSPACE_OUTSIDE_SCOPE')
    assert.equal(error?.reason, 'symlink-component', 'the walk must classify the refused component, not guess from the errno alone')
    return true
  })
  assert.deepEqual(await names(outside), ['deeper'], 'nothing may be created through a symlinked component')
  assert.deepEqual(await names(join(outside, 'deeper')), [])
  assert.deepEqual(await names(root), ['escape'])
  await assertNoPinnedTemps(root)
})

test('pinned create: a symlinked root is resolved before pinning and reported truthfully', only, async t => {
  const dir = await caseDir('root-alias'), real = join(dir, 'real-root'), alias = join(dir, 'alias')
  await mkdir(real); await symlink(real, alias, 'dir')
  const result = await pinnedCreateNewFile({ rootPath: alias, relativePath: 'through-alias.txt', content: 'alias payload' })
  assert.equal(result.path, await realpath(join(real, 'through-alias.txt')))
  assert.equal(result.directoryPath, await realpath(real))
  assert.equal(await readFile(join(real, 'through-alias.txt'), 'utf8'), 'alias payload')
  assert.deepEqual(await names(real), ['through-alias.txt'])
  assert.deepEqual(await names(dir), ['alias', 'real-root'])
})

test('pinned create: a host veto before publish publishes nothing and cleans its temp file', only, async t => {
  const dir = await caseDir('veto'), root = join(dir, 'root')
  await mkdir(root)
  const veto = Object.assign(new Error('WORKSPACE_PRIVATE_PATH'), { code: 'WORKSPACE_PRIVATE_PATH' })
  await rejectsWith(pinnedCreateNewFile({ rootPath: root, relativePath: 'guarded.txt', content: 'guarded payload', check: async report => { if (report.phase === 'before-publish') throw veto } }), 'WORKSPACE_PRIVATE_PATH')
  assert.deepEqual(await names(root), [], 'a vetoed write must leave the directory exactly as it was')
  await assertNoPinnedTemps(root)
})

test('pinned create: a grant revoked before pinning stops the write before any descriptor is held', only, async t => {
  const dir = await caseDir('revoked'), root = join(dir, 'root')
  await mkdir(root)
  const revoked = Object.assign(new Error('GRANT_REVOKED'), { code: 'GRANT_REVOKED' })
  await rejectsWith(pinnedCreateNewFile({ rootPath: root, relativePath: 'revoked.txt', content: 'payload', check: async report => { if (report.phase === 'before-pin') throw revoked } }), 'GRANT_REVOKED')
  assert.deepEqual(await names(root), [])
  await assertNoPinnedTemps(root)
})

test('pinned create: cancellation while parked before publish publishes nothing', only, async t => {
  const dir = await caseDir('cancel'), root = join(dir, 'root')
  await mkdir(root)
  const gate = barrier(), controller = new AbortController()
  let parked = null
  const check = async report => { if (report.phase === 'before-publish') { parked = report; await gate.hold() } }
  const job = pinnedCreateNewFile({ rootPath: root, relativePath: 'cancelled.txt', content: 'never lands', signal: controller.signal, check })
  await gate.arrived
  assert.deepEqual(await names(root), [parked.temp.name], 'the component must be parked with exactly its private temp file')
  controller.abort()
  gate.release()
  await rejectsWith(job, 'WRITE_CANCELLED')
  assert.deepEqual(await names(root), [], 'a cancelled write must clean up its own temp file')
  await assertNoPinnedTemps(root)
})

test('pinned create: a signal already aborted before the call refuses immediately', only, async t => {
  const dir = await caseDir('pre-abort'), root = join(dir, 'root')
  await mkdir(root)
  const controller = new AbortController()
  controller.abort()
  await rejectsWith(pinnedCreateNewFile({ rootPath: root, relativePath: 'pre.txt', content: 'payload', signal: controller.signal }), 'WRITE_CANCELLED')
  assert.deepEqual(await names(root), [])
})

test('pinned create: a parent directory replaced while parked is refused and writes nowhere', only, async t => {
  const dir = await caseDir('replace'), root = join(dir, 'root'), protectedDir = join(dir, 'protected')
  await mkdir(join(root, 'nested'), { recursive: true }); await mkdir(protectedDir)
  const gate = barrier()
  let parked = null
  const check = async report => { if (report.phase === 'before-publish') { parked = report; await gate.hold() } }
  const job = pinnedCreateNewFile({ rootPath: root, relativePath: 'nested/planted.txt', content: 'must not land', check })
  await gate.arrived
  // Hostile action performed while the component is parked at the publish gate:
  // the whole parent chain is replaced and a symlink is aimed at a protected
  // directory, which is exactly what a path re-check cannot see.
  await rename(root, join(dir, 'moved-root'))
  await mkdir(root)
  await symlink(protectedDir, join(root, 'nested'), 'dir')
  gate.release()
  await rejectsWith(job, 'DIRECTORY_CHANGED')
  assert.deepEqual(await names(join(dir, 'moved-root', 'nested')), [], 'the original directory must be left without our temp file')
  assert.deepEqual(await names(protectedDir), [], 'nothing may be written through the replacement')
  assert.deepEqual(await names(root), ['nested'])
})

test('pinned create: moving the held directory into a protected location is detected, not prevented by the descriptor', only, async t => {
  const dir = await caseDir('moved'), root = join(dir, 'root'), protectedDir = join(dir, 'protected')
  await mkdir(join(root, 'nested'), { recursive: true }); await mkdir(protectedDir)
  const gate = barrier()
  let parked = null
  const check = async report => { if (report.phase === 'before-publish') { parked = report; await gate.hold() } }
  const job = pinnedCreateNewFile({ rootPath: root, relativePath: 'nested/planted.txt', content: 'must not land', check })
  await gate.arrived
  // A descriptor pins an inode, not a location: a mover with enough privilege can
  // still relocate the directory under a protected path. The component must
  // refuse instead of publishing into the relocated directory.
  await rename(join(root, 'nested'), join(protectedDir, 'nested'))
  gate.release()
  await rejectsWith(job, 'DIRECTORY_CHANGED')
  assert.deepEqual(await names(join(protectedDir, 'nested')), [], 'nothing may be written into the relocated directory')
  assert.deepEqual(await names(root), [], 'the original parent is gone, and nothing was created at the requested path')
})

test('pinned create: an external writer that claims the target first wins and our write is refused', only, async t => {
  const dir = await caseDir('writer'), root = join(dir, 'root')
  await mkdir(root)
  const target = join(root, 'contested.txt')
  const check = async report => { if (report.phase === 'before-publish') await writeFile(target, 'external writer') }
  await rejectsWith(pinnedCreateNewFile({ rootPath: root, relativePath: 'contested.txt', content: 'ours', check }), 'TARGET_EXISTS')
  assert.equal(await readFile(target, 'utf8'), 'external writer')
  assert.deepEqual(await names(root), ['contested.txt'])
  await assertNoPinnedTemps(root)
})

test('pinned create: a hard link to a protected file placed at the target is refused', only, async t => {
  const dir = await caseDir('hardlink'), root = join(dir, 'root'), outside = join(dir, 'outside')
  await mkdir(root); await mkdir(outside)
  const secret = join(outside, 'secret.bin')
  await writeFile(secret, 'protected payload')
  const target = join(root, 'stolen.bin')
  const check = async report => { if (report.phase === 'before-publish') await link(secret, target) }
  await rejectsWith(pinnedCreateNewFile({ rootPath: root, relativePath: 'stolen.bin', content: 'replacement', check }), 'TARGET_EXISTS')
  assert.equal(await readFile(secret, 'utf8'), 'protected payload')
  assert.equal(await identity(target), await identity(secret), 'the existing hard link must be left untouched')
  assert.deepEqual(await names(root), ['stolen.bin'])
  await assertNoPinnedTemps(root)
})

test('pinned create: a private temp file that somebody else linked is refused', only, async t => {
  const dir = await caseDir('tamper'), root = join(dir, 'root'), elsewhere = join(dir, 'elsewhere')
  await mkdir(root); await mkdir(elsewhere)
  const check = async report => { if (report.phase === 'before-publish') await link(join(root, report.temp.name), join(elsewhere, 'leaked.bin')) }
  await rejectsWith(pinnedCreateNewFile({ rootPath: root, relativePath: 'planted.txt', content: 'payload', check }), 'PINNED_WRITE_TAMPERED')
  assert.deepEqual(await names(root), [], 'our own private name must always be removed')
  assert.deepEqual(await names(elsewhere), ['leaked.bin'], 'a foreign link created by another writer is not ours to remove')
})

test('pinned create: a post-publish veto reports an unverified outcome, never success', only, async t => {
  const dir = await caseDir('unverified'), root = join(dir, 'root')
  await mkdir(root)
  const check = async report => { if (report.phase === 'after-publish') throw Object.assign(new Error('WORKSPACE_CHANGED'), { code: 'WORKSPACE_CHANGED' }) }
  await assert.rejects(pinnedCreateNewFile({ rootPath: root, relativePath: 'landed.txt', content: 'landed', check }), error => {
    assert.equal(error.code, 'PINNED_WRITE_UNVERIFIED')
    assert.equal(error.possiblyApplied, true)
    return true
  })
  assert.equal(await readFile(join(root, 'landed.txt'), 'utf8'), 'landed', 'the file did land, so the outcome must not be reported as a clean success')
})

test('pinned create: an existing target is refused even when the caller knows its current hash', only, async t => {
  const dir = await caseDir('no-cas'), root = join(dir, 'root')
  await mkdir(root)
  await writeFile(join(root, 'cas.txt'), 'current content')
  // The component deliberately does not implement hash CAS against an existing
  // target: a plain rename re-check cannot prove it against an external writer.
  await rejectsWith(pinnedCreateNewFile({ rootPath: root, relativePath: 'cas.txt', content: 'next content' }), 'TARGET_EXISTS')
  assert.equal(await readFile(join(root, 'cas.txt'), 'utf8'), 'current content')
  await assertNoPinnedTemps(root)
})

test('pinned create: hostile relative paths are refused before any filesystem access', only, async t => {
  const dir = await caseDir('hostile-path'), root = join(dir, 'root')
  await mkdir(root)
  const cases = [
    ['', 'INVALID_ARGUMENT'], ['.', 'WORKSPACE_OUTSIDE_SCOPE'], ['..', 'WORKSPACE_OUTSIDE_SCOPE'],
    ['../escape.txt', 'WORKSPACE_OUTSIDE_SCOPE'], ['a/../../escape.txt', 'WORKSPACE_OUTSIDE_SCOPE'],
    ['a/./b.txt', 'WORKSPACE_OUTSIDE_SCOPE'], ['/absolute.txt', 'WORKSPACE_OUTSIDE_SCOPE'],
    ['trailing.', 'INVALID_ARGUMENT'], ['trailing ', 'INVALID_ARGUMENT'],
    ['x'.repeat(256), 'INVALID_ARGUMENT'], ['bad\u0000name', 'INVALID_ARGUMENT'],
    [Array.from({ length: 65 }, (_, i) => `d${i}`).join('/'), 'INVALID_ARGUMENT'],
    [42, 'INVALID_ARGUMENT']
  ]
  for (const [relativePath, code] of cases) await rejectsWith(pinnedCreateNewFile({ rootPath: root, relativePath, content: 'payload' }), code)
  assert.deepEqual(await names(root), [], 'no refused path may create anything')
  await assertNoPinnedTemps(root)
})

test('pinned create: unusable roots, payloads and encodings are refused', only, async t => {
  const dir = await caseDir('root-refuse'), root = join(dir, 'root')
  await mkdir(root)
  await writeFile(join(dir, 'plain.txt'), 'data')
  const base = { rootPath: root, relativePath: 'x.txt' }
  await rejectsWith(pinnedCreateNewFile({ ...base, rootPath: join(dir, 'plain.txt'), content: 'x' }), 'TARGET_PARENT_INVALID')
  await rejectsWith(pinnedCreateNewFile({ ...base, rootPath: join(dir, 'missing-root'), content: 'x' }), 'TARGET_PARENT_INVALID')
  await rejectsWith(pinnedCreateNewFile({ ...base, rootPath: 'relative-root', content: 'x' }), 'INVALID_ARGUMENT')
  await rejectsWith(pinnedCreateNewFile({ ...base, rootPath: `${root}\u0000`, content: 'x' }), 'INVALID_ARGUMENT')
  await rejectsWith(pinnedCreateNewFile({ ...base, content: 'x'.repeat(64), maxBytes: 8 }), 'INVALID_ARGUMENT')
  await rejectsWith(pinnedCreateNewFile({ ...base, content: 'x', maxBytes: -1 }), 'INVALID_ARGUMENT')
  await rejectsWith(pinnedCreateNewFile({ ...base, content: 'x', maxBytes: 1.5 }), 'INVALID_ARGUMENT')
  await rejectsWith(pinnedCreateNewFile({ ...base, content: 'x', encoding: 'utf16le' }), 'INVALID_ARGUMENT')
  await rejectsWith(pinnedCreateNewFile({ ...base, content: 'not base64!!', encoding: 'base64' }), 'INVALID_ARGUMENT')
  await rejectsWith(pinnedCreateNewFile({ ...base, content: 42 }), 'INVALID_ARGUMENT')
  await rejectsWith(pinnedCreateNewFile({ ...base, content: null }), 'INVALID_ARGUMENT')
  await rejectsWith(pinnedCreateNewFile({}), 'INVALID_ARGUMENT')
  assert.deepEqual(await names(root), [])
})

test('pinned create: descriptors and private names are not leaked across many writes', only, async t => {
  const dir = await caseDir('leak'), root = join(dir, 'root')
  await mkdir(root)
  for (let i = 0; i < 25; i++) await pinnedCreateNewFile({ rootPath: root, relativePath: `file-${i}.txt`, content: `body ${i}` })
  assert.equal((await names(root)).length, 25)
  await assertNoPinnedTemps(root)
  const resolved = await realpath(root)
  const descriptors = await names('/proc/self/fd')
  const targets = await Promise.all(descriptors.map(async fd => realpath(`/proc/self/fd/${fd}`).catch(() => null)))
  assert.deepEqual(targets.filter(target => target && (target === resolved || target.startsWith(`${resolved}/`))), [], 'no descriptor may still point into the written root')
})

test('pinned directory: symlink, file and missing components are refused', only, async t => {
  const dir = await caseDir('pin-refuse'), root = join(dir, 'root'), outside = join(dir, 'outside')
  await mkdir(root); await mkdir(outside)
  await writeFile(join(dir, 'plain.txt'), 'data')
  await symlink(outside, join(root, 'link'), 'dir')
  await rejectsWith(PinnedDirectory.pin(root, ['link']), 'WORKSPACE_OUTSIDE_SCOPE')
  await rejectsWith(PinnedDirectory.pin(join(dir, 'plain.txt')), 'TARGET_PARENT_INVALID')
  await rejectsWith(PinnedDirectory.pin(join(dir, 'missing')), 'TARGET_PARENT_INVALID')
  await rejectsWith(PinnedDirectory.pin(join(dir, 'plain.txt'), ['nested']), 'TARGET_PARENT_INVALID')
  const pinned = await PinnedDirectory.pin(root)
  t.after(() => pinned.close())
  assert.equal(pinned.hostPath, root)
  assert.match(pinned.fdPath, /^\/proc\/\d+\/fd\/\d+$/)
  assert.equal(pinned.scanPath, `${pinned.fdPath}/`)
  assert.equal((await pinned.lstatChild('link'))?.isSymbolicLink(), true)
  assert.equal(await pinned.lstatChild('missing'), null)
  assert.equal(await pinned.verifyHostPath(root).then(() => 'verified', e => e.code), 'verified')
})

test('pinned directory: the held descriptor keeps serving the original directory after the host path is replaced', only, async t => {
  const dir = await caseDir('descriptor'), root = join(dir, 'root')
  await mkdir(root)
  await writeFile(join(root, 'original.txt'), 'original')
  const pinned = await PinnedDirectory.pin(root)
  t.after(() => pinned.close())
  await rename(root, join(dir, 'moved'))
  await mkdir(root)
  await writeFile(join(root, 'original.txt'), 'replacement')
  assert.equal(await readFile(pinned.childPath('original.txt'), 'utf8'), 'original')
  assert.equal(await readFile(`${pinned.scanPath}original.txt`, 'utf8'), 'original')
  const created = await open(pinned.childPath('through-descriptor.txt'), 'wx', 0o600)
  await created.close()
  assert.deepEqual(await names(join(dir, 'moved')), ['original.txt', 'through-descriptor.txt'], 'the descriptor must keep addressing the original inode')
  assert.deepEqual(await names(root), ['original.txt'], 'the replacement directory must stay untouched')
  await rejectsWith(pinned.verifyHostPath(root), 'DIRECTORY_CHANGED')
})
