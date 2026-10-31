import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {execFileSync} from 'node:child_process'

test('desktop lease/native: helper arbitration, queued cancellation, confirmed stop and bounded tombstones', {skip:process.platform!=='win32'},async()=>{
  const parent=resolve('tmp/integration/desktop-lease');await mkdir(parent,{recursive:true});const dir=await mkdtemp(join(parent,'case-')),exe=join(dir,'lease-tests.exe')
  const compiler=join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe')
  execFileSync(compiler,['/nologo','/target:exe',`/out:${exe}`,resolve('native/windows-desktop/DesktopLease.cs'),resolve('tests/fixtures/desktop-lease/LeaseTests.cs')],{encoding:'utf8',windowsHide:true})
  const output=execFileSync(exe,[],{encoding:'utf8',windowsHide:true,timeout:10000})
  assert.ok(output.includes('"passed":10'),output)
})
