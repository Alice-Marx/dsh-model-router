import { spawn } from 'node:child_process'
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

const fail = code => { throw Object.assign(new Error(code), { code }) }
const ID = /^[A-Za-z0-9_.-]{1,128}$/
const TAIL_LIMIT = 16 * 1024

async function canonical(path, directory) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) fail('MIGRATION_OS_QUARANTINE_PATH_INVALID')
  const resolved = await realpath(path).catch(() => fail('MIGRATION_OS_QUARANTINE_PATH_INVALID'))
  const info = await lstat(resolved).catch(() => fail('MIGRATION_OS_QUARANTINE_PATH_INVALID'))
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) fail('MIGRATION_OS_QUARANTINE_PATH_INVALID')
  return resolved
}

function launchInput({ runner, executable, args, cwd, operationId, stopTimeoutMs }) {
  if (typeof operationId !== 'string' || !ID.test(operationId)) fail('MIGRATION_OS_QUARANTINE_INPUT_INVALID')
  if (!Array.isArray(args) || args.length > 64 || args.some(value => typeof value !== 'string' || value.length > 8192 || value.includes('\0'))) fail('MIGRATION_OS_QUARANTINE_INPUT_INVALID')
  if (!Number.isSafeInteger(stopTimeoutMs) || stopTimeoutMs < 100 || stopTimeoutMs > 60000) fail('MIGRATION_OS_QUARANTINE_INPUT_INVALID')
  return { runner, executable, args, cwd, operationId }
}

export async function launchMigrationProcessTree({ runner, executable, args = [], cwd, operationId, stopTimeoutMs = 10000 } = {}) {
  if (process.platform !== 'win32') fail('MIGRATION_OS_QUARANTINE_UNSUPPORTED')
  launchInput({ runner, executable, args, cwd, operationId, stopTimeoutMs })
  const [trustedRunner, trustedExecutable, trustedCwd] = await Promise.all([
    canonical(runner, false),
    canonical(executable, false),
    canonical(cwd, true),
  ])
  const request = JSON.stringify({ executable: trustedExecutable, args, cwd: trustedCwd, operationId }) + '\n'
  if (Buffer.byteLength(request) > 65536) fail('MIGRATION_OS_QUARANTINE_INPUT_INVALID')

  let child
  try { child = spawn(trustedRunner, [], { cwd: trustedCwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }) }
  catch { fail('MIGRATION_OS_QUARANTINE_RUNNER_UNAVAILABLE') }
  let nativeStarted = false, closed = false, killRequested = false, stdout = '', stderr = ''
  const append = (current, chunk) => (current + chunk.toString('utf8')).slice(-TAIL_LIMIT)
  child.once('spawn', () => { nativeStarted = true })
  child.on('error', () => {})
  child.stdout.on('data', chunk => { stdout = append(stdout, chunk) })
  child.stderr.on('data', chunk => { stderr = append(stderr, chunk) })
  child.stdin.on('error', () => {})
  const closedResult = new Promise(resolve => {
    child.once('close', (code, signal) => {
      closed = true
      resolve(Object.freeze({
        schemaVersion: 1,
        operationId,
        code,
        signal,
        runnerNotStarted: !nativeStarted,
        treeStopped: nativeStarted,
        stopEvidence: nativeStarted ? 'windows-job-close' : 'native-runner-not-started',
        externalRestartBlocked: false,
        persistentExternalExclusion: false,
        stopWriteProvable: false,
      }))
    })
  })
  child.stdin.end(request)

  async function stop() {
    if (!closed && !killRequested) {
      killRequested = true
      child.kill('SIGKILL')
    }
    let timer
    try {
      return await Promise.race([
        closedResult,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('MIGRATION_OS_QUARANTINE_STOP_UNKNOWN'), { code: 'MIGRATION_OS_QUARANTINE_STOP_UNKNOWN' })), stopTimeoutMs)
        }),
      ])
    } finally { clearTimeout(timer) }
  }

  return Object.freeze({
    operationId,
    runnerPid: child.pid ?? null,
    closed: closedResult,
    stop,
    snapshot: () => Object.freeze({
      operationId,
      runnerPid: child.pid ?? null,
      nativeStarted,
      wrapperClosed: closed,
      stopRequested: killRequested,
      treeStopped: closed && nativeStarted,
      externalRestartBlocked: false,
      persistentExternalExclusion: false,
      stopWriteProvable: false,
    }),
    get stdout() { return stdout },
    get stderr() { return stderr },
  })
}
