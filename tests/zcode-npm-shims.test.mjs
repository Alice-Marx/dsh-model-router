import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { legacyZCodeDesktopShim, prepareZCodeNpmShims } from '../.dsh-plugin/shared/zcode-npm-shims.mjs'

const entry = 'D:\\Program Files\\ZCode\\resources\\glm\\zcode.cjs'
const wrappers = {
  zcode: '#!/bin/sh\nexec node "/d/Program Files/ZCode/resources/glm/zcode.cjs" "$@"\n',
  'zcode.cmd': `@ECHO off\nnode "${entry}" %*\n`,
  'zcode.ps1': `#!/usr/bin/env pwsh\n$ret=0\nif ($MyInvocation.ExpectingInput) {\n  $input | & node "${entry}" $args\n} else {\n  & node "${entry}" $args\n}\n$ret=$LASTEXITCODE\nexit $ret\n`,
}
const exists = path => lstat(path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })

async function fixture(t, files = wrappers) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'router-zcode-shims-')))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const prefix = join(directory, 'npm-prefix')
  await mkdir(prefix)
  for (const [name, body] of Object.entries(files)) await writeFile(join(prefix, name), body)
  return { directory, prefix, options: { prefix, platform: 'win32' } }
}

test('recognition is limited to the three complete observed desktop wrapper templates', () => {
  for (const [name, body] of Object.entries(wrappers)) {
    assert.equal(legacyZCodeDesktopShim(name, Buffer.from(body)), entry.toLowerCase())
    assert.equal(legacyZCodeDesktopShim(name, Buffer.from(`\uFEFF${body.replaceAll('\n', '\r\n')}`)), entry.toLowerCase())
    assert.equal(legacyZCodeDesktopShim(name, Buffer.from(`${body}echo appended-command\n`)), null)
    assert.equal(legacyZCodeDesktopShim(name, Buffer.from(body.replaceAll('ZCode/resources', 'Other/resources').replaceAll('ZCode\\resources', 'Other\\resources'))), null)
    assert.equal(legacyZCodeDesktopShim(name, Buffer.from(body.replaceAll('zcode.cjs', 'other.cjs'))), null)
  }
  assert.equal(legacyZCodeDesktopShim('zcode.exe', Buffer.from(wrappers.zcode)), null)
})

test('dynamic shell or PowerShell paths never qualify as handwritten desktop wrappers', () => {
  for (const symbol of ['$', '`', '%', '!', '&', ';', '(', ')', '^']) {
    for (const [name, body] of Object.entries(wrappers)) {
      assert.equal(legacyZCodeDesktopShim(name, Buffer.from(body.replaceAll('Program Files', `Program${symbol}Files`))), null)
    }
  }
})

test('all three launchers are backed up byte-for-byte without executing desktop code or changing other tools', async t => {
  const originals = Object.fromEntries(Object.entries(wrappers).map(([name, body]) => [name, `\uFEFF${body.replaceAll('\n', '\r\n')}`]))
  const f = await fixture(t, { ...originals, 'codex.cmd': 'other tool', 'zcode.exe': 'unrelated executable' })
  const transaction = await prepareZCodeNpmShims(f.options)
  assert.equal(transaction.backups.length, 3)
  assert.equal(transaction.backupDir.startsWith(`${f.prefix}\\.zcode-legacy-shims-`) || transaction.backupDir.startsWith(`${f.prefix}/.zcode-legacy-shims-`), true)
  for (const [name, body] of Object.entries(originals)) {
    assert.equal(await exists(join(f.prefix, name)), false)
    assert.equal(await readFile(join(transaction.backupDir, name), 'utf8'), body)
  }
  const manifest = JSON.parse(await readFile(join(transaction.backupDir, 'manifest.json'), 'utf8'))
  assert.equal(manifest.kind, 'zcode-desktop-shims'); assert.equal(manifest.files.length, 3)
  assert.equal(await readFile(join(f.prefix, 'codex.cmd'), 'utf8'), 'other tool')
  assert.equal(await readFile(join(f.prefix, 'zcode.exe'), 'utf8'), 'unrelated executable')
})

test('failure restores missing launchers exclusively and preserves both new files and backup bytes', async t => {
  const f = await fixture(t)
  await chmod(join(f.prefix, 'zcode'), 0o755)
  const originalMode = (await stat(join(f.prefix, 'zcode'))).mode & 0o777
  const transaction = await prepareZCodeNpmShims(f.options)
  await writeFile(join(f.prefix, 'zcode.cmd'), 'new npm or user file')
  const restored = await transaction.restoreMissing()
  assert.deepEqual(restored.restored.sort(), ['zcode', 'zcode.ps1'])
  assert.deepEqual(restored.preserved, ['zcode.cmd'])
  assert.equal(await readFile(join(f.prefix, 'zcode.cmd'), 'utf8'), 'new npm or user file')
  assert.equal(await readFile(join(f.prefix, 'zcode'), 'utf8'), wrappers.zcode)
  assert.equal((await stat(join(f.prefix, 'zcode'))).mode & 0o777, originalMode)
  for (const [name, body] of Object.entries(wrappers)) assert.equal(await readFile(join(transaction.backupDir, name), 'utf8'), body)
  const again = await transaction.restoreMissing()
  assert.equal(again.restored.length, 0); assert.equal(again.preserved.length, 3)
})

test('ordinary npm shims and unknown collisions are left for npm without force or backups', async t => {
  const files = { zcode: '#!/bin/sh\nbasedir=$(dirname "$0")\nexec node "$basedir/node_modules/@ljwei-stak/zcode-cli/bin/zcode.mjs" "$@"\n',
    'zcode.cmd': '@ECHO off\r\nGOTO start\r\n', 'zcode.ps1': '#!/usr/bin/env pwsh\n$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n' }
  const f = await fixture(t, files)
  const transaction = await prepareZCodeNpmShims(f.options)
  assert.equal(transaction.backupDir, null); assert.equal(transaction.backups.length, 0)
  assert.deepEqual((await readdir(f.prefix)).sort(), Object.keys(files).sort())
  for (const [name, bytes] of Object.entries(files)) assert.equal(await readFile(join(f.prefix, name), 'utf8'), bytes)
})

test('mixed recognized and unknown files stop before any wrapper is moved', async t => {
  const files = { zcode: wrappers.zcode, 'zcode.cmd': 'custom wrapper owned by user', 'zcode.ps1': wrappers['zcode.ps1'] }
  const f = await fixture(t, files)
  await assert.rejects(prepareZCodeNpmShims(f.options), /无法识别.*已保留全部文件/)
  assert.equal((await readdir(f.prefix)).length, 3)
  for (const [name, body] of Object.entries(files)) assert.equal(await readFile(join(f.prefix, name), 'utf8'), body)
})

test('links at command locations and junctions in prefix ancestors are refused without writes', async t => {
  const f = await fixture(t, { zcode: wrappers.zcode })
  const outside = join(f.directory, 'outside'); await mkdir(outside)
  await symlink(outside, join(f.prefix, 'zcode.cmd'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(prepareZCodeNpmShims(f.options), /含链接或非普通文件/)
  assert.equal(await readFile(join(f.prefix, 'zcode'), 'utf8'), wrappers.zcode)
  const linkedPrefix = join(f.directory, 'linked-prefix')
  await symlink(outside, linkedPrefix, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(prepareZCodeNpmShims({ prefix: join(linkedPrefix, 'nested'), platform: 'win32' }), /前缀不能经过目录联接/)
  assert.deepEqual(await readdir(outside), [])
})

test('a repeat migration is a no-op while commands are absent and creates a distinct backup after rollback', async t => {
  const f = await fixture(t)
  const first = await prepareZCodeNpmShims(f.options)
  const empty = await prepareZCodeNpmShims(f.options)
  assert.equal(empty.backupDir, null); assert.equal(empty.backups.length, 0)
  await first.restoreMissing()
  const second = await prepareZCodeNpmShims(f.options)
  assert.notEqual(first.backupDir, second.backupDir)
  assert.equal(second.backups.length, 3)
  assert.equal(await readFile(join(first.backupDir, 'zcode'), 'utf8'), wrappers.zcode)
})

test('different desktop targets stop before moving any recognized launcher', async t => {
  const f = await fixture(t, { ...wrappers, 'zcode.cmd': wrappers['zcode.cmd'].replace('D:', 'E:') })
  await assert.rejects(prepareZCodeNpmShims(f.options), /指向不同桌面安装/)
  assert.equal((await readdir(f.prefix)).length, 3)
})

test('a cancelled preparation leaves command files and backup directories untouched', async t => {
  const f = await fixture(t), controller = new AbortController()
  controller.abort()
  await assert.rejects(prepareZCodeNpmShims({ ...f.options, signal: controller.signal }), { name: 'AbortError' })
  assert.equal((await readdir(f.prefix)).length, 3)
})

test('a modified backup cannot restore unverified bytes', async t => {
  const f = await fixture(t), transaction = await prepareZCodeNpmShims(f.options)
  await writeFile(join(transaction.backupDir, 'zcode'), 'changed backup')
  await assert.rejects(transaction.restoreMissing(), /备份已变化/)
  assert.equal(await exists(join(f.prefix, 'zcode')), false)
})
