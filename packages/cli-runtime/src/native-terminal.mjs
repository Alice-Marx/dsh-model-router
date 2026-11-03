import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access, lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { connect } from 'node:net'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { fileURLToPath } from 'node:url'
import { privateEnvironment } from './native-process.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const MAX_FRAME = 262_144
const MAX_BUFFERED_OUTPUT = 1_048_576
const TREE_PROOF = 'windows-job-active-process-zero'
const EVENT_FIELDS = Object.freeze({
  listening: ['control'],
  dataConnected: ['control'],
  launcherCreated: ['control', 'pid', 'start', 'containment', 'conpty'],
  started: ['control', 'pid', 'start'],
  hostExit: ['control', 'pid', 'start', 'exitCode'],
  treeClosed: ['control', 'pid', 'start', 'proof', 'activeProcesses'],
  stopRequested: ['control', 'reason'],
  resized: ['control', 'cols', 'rows', 'requestId'],
  operationFailed: ['control', 'operation', 'code', 'requestId'],
  outputDropped: ['control', 'bytesDropped'],
  fault: ['control', 'stage', 'code'],
})

function terminalError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function protocolError(code = 'NATIVE_TERMINAL_PROTOCOL_INVALID') {
  return terminalError(code)
}

function validIdentity(frame) {
  return Number.isSafeInteger(frame.pid) && frame.pid > 0 && /^\d{1,20}$/.test(frame.start) && frame.start !== '0'
}

function validSize(cols, rows) {
  return Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0 && cols <= 32767 && rows <= 32767
}

export function createNativeTerminalProtocol() {
  let stage = 'new'
  let identity = null
  let stopped = false
  let droppedBytes = 0
  return Object.freeze({
    accept(frame) {
      if (!frame || typeof frame !== 'object' || Array.isArray(frame) || typeof frame.control !== 'string' || !Object.hasOwn(EVENT_FIELDS, frame.control)) throw protocolError()
      const allowed = new Set(EVENT_FIELDS[frame.control])
      if (Object.keys(frame).some(key => !allowed.has(key))) throw protocolError('NATIVE_TERMINAL_PROTOCOL_FIELDS')
      const name = frame.control
      if (name === 'listening') {
        if (stage !== 'new') throw protocolError('NATIVE_TERMINAL_PROTOCOL_SEQUENCE')
        stage = 'listening'
      } else if (name === 'dataConnected') {
        if (stage !== 'listening') throw protocolError('NATIVE_TERMINAL_PROTOCOL_SEQUENCE')
        stage = 'data'
      } else if (name === 'launcherCreated') {
        if (stage !== 'data' || !validIdentity(frame) || frame.containment !== 'windows-job' || frame.conpty !== true) throw protocolError('NATIVE_TERMINAL_PROTOCOL_CREATE')
        identity = { pid: frame.pid, start: frame.start }
        stage = 'created'
      } else if (name === 'started') {
        if (stage !== 'created' || !validIdentity(frame) || frame.pid !== identity.pid || frame.start !== identity.start) throw protocolError('NATIVE_TERMINAL_PROTOCOL_START')
        stage = 'started'
      } else if (name === 'hostExit') {
        if (!['created', 'started'].includes(stage) || !validIdentity(frame) || frame.pid !== identity.pid || frame.start !== identity.start || !Number.isInteger(frame.exitCode) || frame.exitCode < 0 || frame.exitCode > 0xffffffff) throw protocolError('NATIVE_TERMINAL_PROTOCOL_EXIT')
        stage = 'hostExited'
      } else if (name === 'treeClosed') {
        if (stage !== 'hostExited' || !validIdentity(frame) || frame.pid !== identity.pid || frame.start !== identity.start || frame.proof !== TREE_PROOF || frame.activeProcesses !== 0) throw protocolError('NATIVE_TERMINAL_PROTOCOL_TREE')
        stage = 'treeClosed'
      } else if (name === 'stopRequested') {
        if (!['created', 'started', 'hostExited'].includes(stage) || stopped || !['stop', 'abort', 'deadline', 'control-ended'].includes(frame.reason)) throw protocolError('NATIVE_TERMINAL_PROTOCOL_STOP')
        stopped = true
      } else if (name === 'resized') {
        if (stage !== 'started' || stopped || !validSize(frame.cols, frame.rows) || !Number.isInteger(frame.requestId) || frame.requestId < 1 || frame.requestId > 0x7fffffff) throw protocolError('NATIVE_TERMINAL_PROTOCOL_RESIZE')
      } else if (name === 'operationFailed') {
        if (!['created', 'started', 'hostExited'].includes(stage) || !['query', 'resize', 'stop'].includes(frame.operation) || !/^[A-Z0-9_]{1,64}$/.test(frame.code)) throw protocolError('NATIVE_TERMINAL_PROTOCOL_OPERATION')
        if (frame.operation === 'resize' ? !Number.isInteger(frame.requestId) || frame.requestId < 1 || frame.requestId > 0x7fffffff : Object.hasOwn(frame, 'requestId')) throw protocolError('NATIVE_TERMINAL_PROTOCOL_OPERATION')
      } else if (name === 'outputDropped') {
        if (!['created', 'started', 'hostExited', 'treeClosed'].includes(stage) || !Number.isSafeInteger(frame.bytesDropped) || frame.bytesDropped <= droppedBytes) throw protocolError('NATIVE_TERMINAL_PROTOCOL_OUTPUT')
        droppedBytes = frame.bytesDropped
      } else if (name === 'fault') {
        if (stage === 'treeClosed' || frame.stage !== 'native' || !/^[A-Z0-9_]{1,64}$/.test(frame.code)) throw protocolError('NATIVE_TERMINAL_PROTOCOL_FAULT')
      }
      return frame
    },
    get stage() { return stage },
    get identity() { return identity ? Object.freeze({ ...identity }) : null },
  })
}

function prepareLaunch(launch, env) {
  if (!launch || typeof launch !== 'object' || !isAbsolute(launch.file ?? '')) throw terminalError('NATIVE_TERMINAL_LAUNCH_INVALID')
  if (launch.utf8Console !== true) return { ...launch }
  const literal = value => `'${String(value).replace(/'/g, "''")}'`
  const args = typeof launch.args === 'string' ? [launch.args] : launch.args
  if (!Array.isArray(args)) throw terminalError('NATIVE_TERMINAL_LAUNCH_INVALID')
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    `& ${literal(launch.file)} @(${args.map(literal).join(', ')})`,
    'exit $LASTEXITCODE',
  ].join('; ')
  const root = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows'
  return { ...launch, file: join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], verbatim: false }
}

function validateLaunch(launch, cwd, env, cols, rows, ttlMs, privateOutput) {
  if (!isAbsolute(cwd ?? '') || !isAbsolute(privateOutput ?? '') || !validSize(cols, rows) || !Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 86_400_000) throw terminalError('NATIVE_TERMINAL_SPEC_INVALID')
  if (!env || typeof env !== 'object' || Array.isArray(env)) throw terminalError('NATIVE_TERMINAL_ENV_INVALID')
  const args = launch.verbatim === true ? (typeof launch.args === 'string' ? launch.args : Array.isArray(launch.args) && launch.args.length === 1 ? launch.args[0] : null) : launch.args
  if (typeof args !== 'string' && (!Array.isArray(args) || args.some(value => typeof value !== 'string' || value.includes('\0')))) throw terminalError('NATIVE_TERMINAL_ARGS_INVALID')
  if (typeof args === 'string' && args.includes('\0')) throw terminalError('NATIVE_TERMINAL_ARGS_INVALID')
  for (const [key, value] of Object.entries(env)) if (!key || key.includes('=') || key.includes('\0') || typeof value !== 'string' || value.includes('\0')) throw terminalError('NATIVE_TERMINAL_ENV_INVALID')
  return args
}

function deferred() {
  let resolve, reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  promise.catch(() => {})
  return { promise, resolve, reject }
}

// The supplied directory is a parent, never a resource owned by this factory.
// Only the unique child created here may be protected or recursively removed.
async function allocatePrivateOutput(parentPath) {
  const parent = resolve(parentPath)
  try {
    const parentInfo = await lstat(parent, { bigint: true })
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || await realpath(parent) !== parent) throw new Error('parent')
    const path = await mkdtemp(join(parent, 'dsh-managed-'))
    const info = await lstat(path, { bigint: true })
    const cleanup = async () => {
      try {
        const within = relative(parent, path)
        if (!within || within === '..' || within.startsWith('..\\') || within.startsWith('../') || isAbsolute(within)) return false
        const currentParent = await lstat(parent, { bigint: true })
        const current = await lstat(path, { bigint: true })
        if (!currentParent.isDirectory() || currentParent.isSymbolicLink() || currentParent.dev !== parentInfo.dev || currentParent.ino !== parentInfo.ino || await realpath(parent) !== parent) return false
        if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== info.dev || current.ino !== info.ino || await realpath(path) !== path) return false
        await rm(path, { recursive: true, force: true })
        return true
      } catch { return false }
    }
    try { await mkdir(join(path, 'tmp')) } catch (error) { await cleanup(); throw error }
    return { path, cleanup }
  } catch { throw terminalError('NATIVE_TERMINAL_PRIVATE_OUTPUT_INVALID') }
}

export async function createWindowsManagedTerminal({ launch, cwd, cols, rows, env, ttlMs = 21_600_000, privateOutput, signal } = {}) {
  if (process.platform !== 'win32') throw terminalError('NATIVE_TERMINAL_UNSUPPORTED')
  const prepared = prepareLaunch(launch, env ?? {})
  const args = validateLaunch(prepared, cwd, env, cols, rows, ttlMs, privateOutput)
  if (signal?.aborted) throw terminalError('NATIVE_TERMINAL_ABORTED')
  const root = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows'
  const powershell = await realpath(join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  const helperPath = join(HERE, 'native-terminal-peer.ps1')
  await access(helperPath)
  const ownedOutput = await allocatePrivateOutput(privateOutput)
  privateOutput = ownedOutput.path
  const dataEndpoint = `\\\\.\\pipe\\dsh-terminal-${randomBytes(24).toString('hex')}`
  let helper
  try {
    helper = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath], {
      cwd: privateOutput, env: privateEnvironment(privateOutput), windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    await ownedOutput.cleanup()
    throw terminalError('NATIVE_TERMINAL_HELPER_UNAVAILABLE')
  }
  helper.stdin.on('error', () => {})
  let stderr = ''
  helper.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-4096) })
  const protocol = createNativeTerminalProtocol()
  const created = deferred()
  const closed = deferred()
  const listeners = { data: [], exit: [], tree: [], lost: [], output: [], dropped: [] }
  const retained = { exit: null, tree: null, lost: null, output: null, dropped: null }
  const outputDone = deferred()
  let startedCall = null
  let stopCall = null
  let resizeCall = null
  let resizeChain = Promise.resolve()
  let resizeSequence = 0
  let socket = null
  let outputDecoder = new StringDecoder('utf8')
  let bufferedOutput = ''
  let controlBuffer = ''
  let controlDecoder = new StringDecoder('utf8')
  let helperClosed = false
  let protocolFailed = false
  let launcherCreated = false
  let treeClosed = false
  let hostExited = false
  let controlLost = false
  let outputTruncated = false
  let outputClosed = false
  let bytesDropped = 0
  let startupTimer = null
  let stopTimer = null
  let resizeTimer = null
  let cleaned = false

  const emit = (name, value) => {
    if (name !== 'data') retained[name] = value
    for (const listener of [...listeners[name]]) {
      try { listener(value) } catch {}
    }
  }
  const send = frame => new Promise((resolve, reject) => {
    let wire
    try { wire = JSON.stringify(frame) + '\n' } catch { reject(terminalError('NATIVE_TERMINAL_CONTROL_INVALID')); return }
    if (helperClosed || helper.stdin.destroyed || helper.stdin.writableEnded) { reject(terminalError('NATIVE_TERMINAL_CONTROL_LOST')); return }
    if (Buffer.byteLength(wire) > MAX_FRAME) { reject(terminalError('NATIVE_TERMINAL_CONTROL_LIMIT')); return }
    helper.stdin.write(wire, error => error ? reject(terminalError('NATIVE_TERMINAL_CONTROL_LOST')) : resolve())
  })
  const clearWaits = () => {
    clearTimeout(startupTimer); clearTimeout(stopTimer); clearTimeout(resizeTimer)
    startupTimer = stopTimer = resizeTimer = null
  }
  const removePrivateOutput = async () => {
    if (cleaned) return
    cleaned = true
    return ownedOutput.cleanup()
  }
  const rejectPending = error => {
    created.reject(error)
    startedCall?.wait.reject(error)
    stopCall?.wait.reject(error)
    resizeCall?.wait.reject(error)
    clearWaits()
  }
  const loseControl = (code, event = {}) => {
    if (treeClosed || controlLost) return
    controlLost = true
    outputTruncated = true
    const error = terminalError(code)
    if (typeof event.nativeCode === 'string' && /^[A-Z0-9_]{1,64}$/.test(event.nativeCode)) error.nativeCode = event.nativeCode
    rejectPending(error)
    emit('lost', Object.freeze({ code, ...event }))
  }
  const abortHelper = () => {
    if (helperClosed) return
    try { helper.stdin.end() } catch {}
    try { helper.kill('SIGKILL') } catch {}
  }
  const protocolFailure = error => {
    if (protocolFailed || treeClosed) return
    protocolFailed = true
    loseControl(error.code ?? 'NATIVE_TERMINAL_PROTOCOL_INVALID')
    abortHelper()
  }
  const deliverData = text => {
    if (!text) return
    if (!listeners.data.length) {
      const merged = bufferedOutput + text
      outputTruncated = outputTruncated || merged.length > MAX_BUFFERED_OUTPUT
      bufferedOutput = merged.length > MAX_BUFFERED_OUTPUT ? merged.slice(-MAX_BUFFERED_OUTPUT) : merged
      return
    }
    for (const listener of [...listeners.data]) {
      try { listener(text) } catch {}
    }
  }
  const finishOutput = (incomplete = false) => {
    outputTruncated ||= incomplete
    if (outputClosed) return
    deliverData(outputDecoder.end())
    outputClosed = true
    outputDone.resolve()
  }
  const attachSocket = () => {
    socket = connect(dataEndpoint)
    socket.on('data', chunk => deliverData(outputDecoder.write(chunk)))
    socket.on('end', () => finishOutput())
    socket.on('error', () => {
      finishOutput(true)
      if (!treeClosed && !helperClosed) {
        loseControl('NATIVE_TERMINAL_DATA_LOST')
        abortHelper()
      }
    })
    socket.on('close', hadError => finishOutput(hadError || !treeClosed))
  }
  const accept = frame => {
    try { protocol.accept(frame) } catch (error) { protocolFailure(error); return }
    if (frame.control === 'listening') attachSocket()
    else if (frame.control === 'launcherCreated') { launcherCreated = true; created.resolve() }
    else if (frame.control === 'started') startedCall?.wait.resolve(Object.freeze({ pid: frame.pid, startIdentity: frame.start, started: true }))
    else if (frame.control === 'hostExit') { hostExited = true; emit('exit', Object.freeze({ exitCode: frame.exitCode, signal: null })) }
    else if (frame.control === 'treeClosed') {
      treeClosed = true
      clearWaits()
      emit('tree', Object.freeze({ proof: frame.proof, activeProcesses: 0 }))
    } else if (frame.control === 'stopRequested') {
      clearTimeout(stopTimer)
      stopCall?.wait.resolve(true)
    } else if (frame.control === 'resized') {
      if (resizeCall?.requestId !== frame.requestId) return
      clearTimeout(resizeTimer)
      resizeCall?.wait.resolve(true)
      resizeCall = null
    } else if (frame.control === 'operationFailed') {
      if (frame.operation === 'resize' && resizeCall?.requestId === frame.requestId) {
        clearTimeout(resizeTimer)
        resizeCall.wait.reject(terminalError('NATIVE_TERMINAL_RESIZE_FAILED'))
        resizeCall = null
      } else if (frame.operation !== 'resize') {
        loseControl('NATIVE_TERMINAL_OPERATION_FAILED', { nativeCode: frame.code })
        abortHelper()
      }
    } else if (frame.control === 'outputDropped') {
      outputTruncated = true
      bytesDropped = frame.bytesDropped
      emit('dropped', Object.freeze({ bytesDropped }))
    } else if (frame.control === 'fault') {
      loseControl('NATIVE_TERMINAL_HELPER_FAULT', { nativeCode: frame.code })
      abortHelper()
    }
  }
  helper.stdout.on('data', chunk => {
    controlBuffer += controlDecoder.write(chunk)
    if (Buffer.byteLength(controlBuffer) > MAX_FRAME) { protocolFailure(terminalError('NATIVE_TERMINAL_CONTROL_LIMIT')); return }
    let end
    while ((end = controlBuffer.indexOf('\n')) >= 0) {
      const line = controlBuffer.slice(0, end); controlBuffer = controlBuffer.slice(end + 1)
      if (!line.trim()) continue
      if (Buffer.byteLength(line) > MAX_FRAME) { protocolFailure(terminalError('NATIVE_TERMINAL_CONTROL_LIMIT')); return }
      try { accept(JSON.parse(line)) } catch { protocolFailure(terminalError('NATIVE_TERMINAL_CONTROL_JSON')) }
    }
  })
  helper.once('error', () => {
    if (!helperClosed) loseControl('NATIVE_TERMINAL_HELPER_UNAVAILABLE')
    created.reject(terminalError('NATIVE_TERMINAL_HELPER_UNAVAILABLE'))
  })
  helper.once('close', (code, helperSignal) => {
    helperClosed = true
    if (!treeClosed) loseControl('NATIVE_TERMINAL_CONTROL_LOST', { helperExitCode: code })
    rejectPending(terminalError('NATIVE_TERMINAL_CONTROL_LOST'))
    if (code !== 0 || helperSignal) outputTruncated = true
    clearWaits()
    signal?.removeEventListener('abort', aborted)
    void (async () => {
      if (!socket) finishOutput(true)
      let drainTimer
      await Promise.race([outputDone.promise, new Promise(done => {
        drainTimer = setTimeout(() => { finishOutput(true); socket?.destroy(); done() }, 2000)
      })])
      clearTimeout(drainTimer)
      const runtimeCleaned = await removePrivateOutput()
      emit('output', Object.freeze({ outputTruncated, bytesDropped }))
      closed.resolve(Object.freeze({ code, signal: helperSignal, runtimeCleaned, outputTruncated, bytesDropped }))
    })()
  })
  const spec = {
    schema: 1,
    executable: prepared.file,
    args: prepared.verbatim === true ? [args] : args,
    verbatim: prepared.verbatim === true,
    cwd,
    env,
    cols,
    rows,
    ttlMs,
    dataEndpoint,
    privateOutput,
  }
  void send(spec).catch(() => {
    loseControl('NATIVE_TERMINAL_SPEC_FAILED')
    abortHelper()
  })
  const aborted = () => {
    if (treeClosed) return
    if (!launcherCreated) abortHelper()
    else if (!stopCall) void requestStop('abort').catch(() => {})
  }
  signal?.addEventListener('abort', aborted, { once: true })
  startupTimer = setTimeout(() => {
    created.reject(terminalError('NATIVE_TERMINAL_CREATE_TIMEOUT'))
    loseControl('NATIVE_TERMINAL_CREATE_TIMEOUT')
    abortHelper()
  }, 20_000)
  const requestStop = reason => {
    if (treeClosed) return Promise.resolve(false)
    if (stopCall) return stopCall.promise
    const identity = protocol.identity
    if (!identity) return Promise.reject(terminalError('NATIVE_TERMINAL_NOT_CREATED'))
    const wait = deferred()
    const promise = send({ control: reason === 'abort' ? 'abort' : 'stop', ...identity }).then(() => wait.promise)
    stopCall = { promise, wait }
    stopTimer = setTimeout(() => {
      wait.reject(terminalError('NATIVE_TERMINAL_STOP_TIMEOUT'))
      loseControl('NATIVE_TERMINAL_STOP_TIMEOUT')
      abortHelper()
    }, 15_000)
    wait.promise.then(() => clearTimeout(stopTimer), () => clearTimeout(stopTimer))
    promise.catch(() => {})
    return promise
  }
  const on = (name, listener) => {
    if (typeof listener !== 'function') throw terminalError('NATIVE_TERMINAL_LISTENER_INVALID')
    listeners[name].push(listener)
    if (retained[name]) {
      try { listener(retained[name]) } catch {}
    }
    return () => { listeners[name] = listeners[name].filter(value => value !== listener) }
  }
  const proc = {
    get pid() { return protocol.identity?.pid },
    get startIdentity() { return protocol.identity?.start },
    containment: 'windows-job',
    treeTracking: true,
    get hostExited() { return hostExited },
    get treeClosed() { return treeClosed },
    get controlLost() { return controlLost },
    get outputTruncated() { return outputTruncated },
    get outputClosed() { return outputClosed && helperClosed },
    get bytesDropped() { return bytesDropped },
    get stderr() { return stderr.slice(-256) },
    closed: closed.promise,
    onData(listener) {
      if (typeof listener !== 'function') throw terminalError('NATIVE_TERMINAL_LISTENER_INVALID')
      listeners.data.push(listener)
      if (bufferedOutput) {
        const pending = bufferedOutput; bufferedOutput = ''
        try { listener(pending) } catch {}
      }
      return () => { listeners.data = listeners.data.filter(value => value !== listener) }
    },
    onExit(listener) { return on('exit', listener) },
    onTreeClosed(listener) { return on('tree', listener) },
    onOutputClosed(listener) { return on('output', listener) },
    onOutputDropped(listener) { return on('dropped', listener) },
    onControlLost(listener) { return on('lost', listener) },
    write(data) {
      if (!protocol.stage || protocol.stage !== 'started' || hostExited || treeClosed || controlLost || !socket || socket.destroyed) return false
      if (typeof data !== 'string' && !Buffer.isBuffer(data) && !ArrayBuffer.isView(data)) throw terminalError('NATIVE_TERMINAL_INPUT_INVALID')
      return socket.write(data)
    },
    resize(nextCols, nextRows) {
      if (!validSize(nextCols, nextRows)) return Promise.reject(terminalError('NATIVE_TERMINAL_RESIZE_INVALID'))
      if (protocol.stage !== 'started' || hostExited || treeClosed || controlLost) return Promise.resolve(false)
      resizeChain = resizeChain.catch(() => {}).then(async () => {
        if (protocol.stage !== 'started' || hostExited || treeClosed || controlLost) return false
        if (resizeSequence >= 0x7fffffff) throw terminalError('NATIVE_TERMINAL_RESIZE_ID_LIMIT')
        const wait = deferred()
        const holder = { wait, requestId: ++resizeSequence, timer: null }
        resizeCall = holder
        holder.timer = resizeTimer = setTimeout(() => {
          wait.reject(terminalError('NATIVE_TERMINAL_RESIZE_TIMEOUT'))
          if (resizeCall === holder) resizeCall = null
        }, 15_000)
        try {
          await send({ control: 'resize', ...protocol.identity, cols: nextCols, rows: nextRows, requestId: holder.requestId })
          return await wait.promise
        } finally {
          clearTimeout(holder.timer)
          if (resizeCall === holder) resizeCall = null
        }
      })
      return resizeChain
    },
    kill() { return requestStop('stop') },
    resume() {
      if (startedCall) return startedCall.promise
      if (signal?.aborted || controlLost || treeClosed) return Promise.reject(terminalError('NATIVE_TERMINAL_ABORTED'))
      const wait = deferred()
      const identity = protocol.identity
      const promise = send({ control: 'resume', ...identity }).then(() => wait.promise)
      startedCall = { promise, wait }
      promise.catch(() => {})
      return promise
    },
  }
  try {
    await Promise.race([
      created.promise,
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(terminalError('NATIVE_TERMINAL_CREATE_TIMEOUT')), 20_000)
        created.promise.then(() => clearTimeout(timer), () => clearTimeout(timer))
      }),
    ])
    clearTimeout(startupTimer)
    return Object.freeze(proc)
  } catch (error) {
    abortHelper()
    if (socket && !socket.destroyed) socket.destroy()
    await closed.promise
    throw error.code ? error : terminalError('NATIVE_TERMINAL_CREATE_FAILED')
  }
}
