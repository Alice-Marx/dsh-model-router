import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

test('native desktop patches preserve changed pixel coverage and recover after dropped frames', { skip: process.platform !== 'win32' }, () => {
  const parent = resolve('tmp/integration/desktop-delta'); mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, 'run-')), exe = join(dir, 'delta-tests.exe')
  const compiler = join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  const sources = ['Program.cs','DesktopLease.cs','DesktopStream.cs','FullDesktop.cs'].map(name => resolve('native/windows-desktop', name))
  execFileSync(compiler, ['/nologo','/target:exe','/main:DeltaFrameTests',`/out:${exe}`,
    '/reference:System.dll','/reference:System.Core.dll','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll',
    ...sources, resolve('tests/fixtures/desktop-lease/DeltaFrameTests.cs')], { windowsHide: true })
  const output = execFileSync(exe, { encoding: 'utf8', windowsHide: true })
  assert.match(output, /Delta frame coverage.*passed/)
})
