import { spawn } from 'node:child_process'
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const fail = code => { throw Object.assign(new Error(code), { code }) }
const ID = /^[A-Za-z0-9_.-]{1,128}$/
const HELPER = fileURLToPath(new URL('./migration-linux-quarantine.py', import.meta.url))

async function canonical(path, directory) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) fail('MIGRATION_LINUX_QUARANTINE_PATH_INVALID')
  const resolved = await realpath(path).catch(() => fail('MIGRATION_LINUX_QUARANTINE_PATH_INVALID'))
  const info = await lstat(resolved).catch(() => fail('MIGRATION_LINUX_QUARANTINE_PATH_INVALID'))
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) fail('MIGRATION_LINUX_QUARANTINE_PATH_INVALID')
  return resolved
}

export async function launchMigrationLinuxProcessTree({ python = '/usr/bin/python3', executable, args = [], cwd, operationId, cgroupRoot = '/sys/fs/cgroup', stopTimeoutMs = 15000 } = {}) {
  if (process.platform !== 'linux') fail('MIGRATION_LINUX_QUARANTINE_UNSUPPORTED')
  if (typeof operationId !== 'string' || !ID.test(operationId) || !Array.isArray(args) || args.length > 64 || args.some(value => typeof value !== 'string' || value.length > 8192 || value.includes('\0'))) fail('MIGRATION_LINUX_QUARANTINE_INPUT_INVALID')
  if (!Number.isSafeInteger(stopTimeoutMs) || stopTimeoutMs < 100 || stopTimeoutMs > 60000) fail('MIGRATION_LINUX_QUARANTINE_INPUT_INVALID')
  const [trustedPython, trustedExecutable, trustedCwd, trustedCgroupRoot] = await Promise.all([canonical(python, false), canonical(executable, false), canonical(cwd, true), canonical(cgroupRoot, true)])
  const rootInfo = await lstat(trustedCgroupRoot), outside = relative('/sys/fs/cgroup', trustedCgroupRoot)
  if ((outside && (outside === '..' || outside.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(outside))) || rootInfo.uid !== process.getuid()) fail('MIGRATION_LINUX_QUARANTINE_CGROUP_UNTRUSTED')
  const request = JSON.stringify({ executable: trustedExecutable, args, cwd: trustedCwd, operationId, cgroupRoot: trustedCgroupRoot }) + '\n'
  if (Buffer.byteLength(request) > 65536) fail('MIGRATION_LINUX_QUARANTINE_INPUT_INVALID')
  let child
  try { child = spawn(trustedPython, [HELPER], { cwd: trustedCwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } }) }
  catch { fail('MIGRATION_LINUX_QUARANTINE_RUNNER_UNAVAILABLE') }
  let nativeStarted = false, closed = false, stopRequested = false, stdout = '', stderr = ''
  child.once('spawn', () => { nativeStarted = true })
  child.on('error', () => {})
  child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString('utf8')).slice(-1048576) })
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-16384) })
  child.stdin.on('error', () => {})
  let lastResult = null
  const closedResult = new Promise(resolve => {
    child.once('close', (code, signal) => {
      closed = true
      let receipt = null
      try { receipt = JSON.parse(stdout.trim().split('\n').at(-1)) } catch {}
      const valid = receipt?.schemaVersion === 1 && receipt.operationId === operationId && typeof receipt.treeStopped === 'boolean'
      lastResult = Object.freeze({
        schemaVersion: 1,
        operationId,
        code: valid && Number.isSafeInteger(receipt.code) ? receipt.code : code,
        signal,
        reason: valid ? receipt.reason ?? null : null,
        runnerNotStarted: !nativeStarted,
        treeStopped: valid && receipt.treeStopped === true,
        cgroupRemoved: valid && receipt.cgroupRemoved === true,
        stopEvidence: valid && receipt.treeStopped === true ? receipt.stopEvidence : 'supervisor-receipt-unavailable',
        externalRestartBlocked: false,
        persistentExternalExclusion: false,
        stopWriteProvable: false,
        ...(valid && receipt.error ? { error: receipt.error } : {}),
      })
      resolve(lastResult)
    })
  })
  child.stdin.end(request)
  async function stop() {
    if (!closed && !stopRequested) {
      stopRequested = true
      child.kill('SIGTERM')
    }
    let timer
    try {
      return await Promise.race([closedResult, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('MIGRATION_LINUX_QUARANTINE_STOP_UNKNOWN'), { code: 'MIGRATION_LINUX_QUARANTINE_STOP_UNKNOWN' })), stopTimeoutMs)
      })])
    } finally { clearTimeout(timer) }
  }
  return Object.freeze({
    operationId,
    runnerPid: child.pid ?? null,
    closed: closedResult,
    stop,
    snapshot: () => Object.freeze({ operationId, runnerPid: child.pid ?? null, nativeStarted, wrapperClosed: closed, stopRequested, treeStopped: lastResult?.treeStopped === true, externalRestartBlocked: false, persistentExternalExclusion: false, stopWriteProvable: false }),
    get stdout() { return stdout },
    get stderr() { return stderr },
  })
}
