import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { capabilityProbe, nativeProcess, resolveNativeHelper } from '../packages/cli-runtime/src/native-process.mjs'

const real = (name, fn) => test(name, { skip: process.platform !== 'win32', timeout: 30_000 }, fn)
const sourcePath = resolve('packages/cli-runtime/src/native-peer.ps1')

async function setup() {
  const root = resolve('tmp/integration/cli-native-peer-probe')
  await mkdir(root, { recursive: true })
  const home = await mkdtemp(join(root, 'case-'))
  await mkdir(join(home, 'tmp'))
  const helper = await resolveNativeHelper({ home })
  return { home, helper }
}

function replaceOnce(text, anchor, replacement) {
  assert.equal(text.split(anchor).length, 2, `probe test anchor changed: ${anchor}`)
  return text.replace(anchor, replacement)
}

async function modifiedHelper(home, helper, inject) {
  const source = await readFile(sourcePath, 'utf8')
  const boundary = source.indexOf('  public static string ProbeJob()')
  assert.ok(boundary > 0)
  const script = join(home, 'injected-probe.ps1')
  await writeFile(script, source.slice(0, boundary) + inject(source.slice(boundary)))
  return { ...helper, prefix: helper.prefix.map(value => value.endsWith('native-peer.ps1') ? script : value) }
}

async function runProbe(helper, home) {
  const proc = nativeProcess(helper, 'probe', null, { home })
  const response = new Promise((resolve, reject) => {
    proc.events.once('message', resolve)
    proc.events.once('failure', reject)
    proc.events.once('closed', () => reject(new Error(`probe closed without response: ${proc.stderr}`)))
  })
  const value = await response
  assert.equal((await proc.exit).code, 0)
  return value
}

real('Windows capability probe exercises actual Job admission and preserves the public interface', async () => {
  const { home } = await setup()
  const probe = await capabilityProbe({ home })
  assert.equal(probe.available, true, probe.reason)
  assert.equal(probe.peer, 'windows-kernel-pid')
  assert.equal(probe.supervisor, 'windows-job')
  assert.equal(probe.helper.platform, 'win32')
})

real('Windows capability probe reports Job-list failure as unavailable', async () => {
  const { home, helper } = await setup()
  const copy = await modifiedHelper(home, helper, text => replaceOnce(text,
    'if(!UpdateProcThreadAttribute(attributeList,0,PROC_THREAD_ATTRIBUTE_JOB_LIST,jobArray,(IntPtr)Marshal.SizeOf(typeof(IntPtr)),IntPtr.Zero,IntPtr.Zero))throw new Exception("JOB_LIST_UPDATE_FAILED");',
    'if(DateTime.UtcNow.Ticks>0 || !UpdateProcThreadAttribute(attributeList,0,PROC_THREAD_ATTRIBUTE_JOB_LIST,jobArray,(IntPtr)Marshal.SizeOf(typeof(IntPtr)),IntPtr.Zero,IntPtr.Zero))throw new Exception("JOB_LIST_UPDATE_FAILED");'))
  const result = await runProbe(copy, home)
  assert.equal(result.available, false)
  assert.equal(result.reason, 'JOB_LIST_UPDATE_FAILED')
})

real('Windows capability probe reclaims its suspended child after a post-create exception', async () => {
  const { home, helper } = await setup()
  const copy = await modifiedHelper(home, helper, text => replaceOnce(text,
    'bool member=false;if(!IsProcessInJob(pi.process,job,out member)||!member)throw new Exception("JOB_MEMBERSHIP_FAILED");',
    'File.WriteAllText(Path.Combine(Environment.CurrentDirectory,"probe-child-pid"),pi.pid.ToString());if(DateTime.UtcNow.Ticks>0)throw new Exception("TEST_POST_CREATE_FAILURE");bool member=false;if(!IsProcessInJob(pi.process,job,out member)||!member)throw new Exception("JOB_MEMBERSHIP_FAILED");'))
  const result = await runProbe(copy, home)
  assert.equal(result.available, false)
  assert.equal(result.reason, 'TEST_POST_CREATE_FAILURE')
  const pid = Number(await readFile(join(home, 'probe-child-pid'), 'utf8'))
  assert.ok(Number.isInteger(pid) && pid > 0)
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
})
