import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const [mode, ...args] = process.argv.slice(2)

if (mode === 'creator') {
  const [requestPath] = args
  const { readFileSync } = await import('node:fs')
  const request = JSON.parse(readFileSync(requestPath, 'utf8'))
  const { createWindowsManagedTerminal } = await import(pathToFileURL(request.adapter).href)
  const record = value => appendFileSync(request.events, JSON.stringify(value) + '\n')
  try {
    const proc = await createWindowsManagedTerminal(request.options)
    writeFileSync(request.ready, JSON.stringify({ creatorPid: process.pid, pid: proc.pid, startIdentity: proc.startIdentity }))
    proc.onExit(value => record({ event: 'hostExit', ...value }))
    proc.onTreeClosed(value => record({ event: 'treeClosed', ...value }))
    proc.onControlLost(value => record({ event: 'controlLost', ...value }))
    await proc.resume()
    record({ event: 'started' })
    setInterval(() => {}, 1000)
  } catch (error) {
    record({ event: 'createFailed', code: error.code ?? String(error) })
    process.exit(2)
  }
} else if (mode === 'report') {
  console.log(JSON.stringify({ args, cwd: process.cwd(), stdinTTY: process.stdin.isTTY === true, stdoutTTY: process.stdout.isTTY === true, stderrTTY: process.stderr.isTTY === true,
    envNames: Object.keys(process.env).sort(), fixtureValue: process.env.DSH_FIXTURE_VALUE ?? null }))
} else if (mode === 'phase-a-report') {
  console.log('STDOUT-BEGIN 中文')
  console.error('STDERR-MARKER 中文')
  console.log(JSON.stringify({ args, cwd: process.cwd(), stdinTTY: process.stdin.isTTY === true, stdoutTTY: process.stdout.isTTY === true, stderrTTY: process.stderr.isTTY === true,
    fixtureValue: process.env.DSH_FIXTURE_VALUE ?? null }))
  console.log('STDOUT-END 尾标记')
} else if (mode === 'input') {
  const size = () => {
    // getWindowSize() exposes cached JS fields; query the child's actual TTY.
    const dimensions = [0, 0]
    const handle = process.stdout._handle
    if (typeof handle?.getWindowSize !== 'function' || handle.getWindowSize(dimensions) !== 0) throw new Error('FIXTURE_TTY_SIZE_QUERY_FAILED')
    console.log(JSON.stringify({ size: dimensions }))
  }
  console.log('READY 中文 \u001b[31mRED\u001b[0m')
  size()
  process.stdout.on('resize', size)
  process.stdin.setEncoding('utf8')
  let input = ''
  process.stdin.on('data', chunk => {
    console.log(JSON.stringify({ input: chunk }))
    input += chunk
    if (input.includes('size?')) {
      size()
      input = input.replace('size?', '')
    }
    if (input.includes('exit7')) process.exit(7)
    if (input.includes('exit0')) process.exit(0)
    if (input.length > 65536) input = input.slice(-1024)
  })
} else if (mode === 'hold') {
  if (args[0]) writeFileSync(args[0], JSON.stringify({ pid: process.pid, resumed: true }))
  setInterval(() => {}, 1000)
} else if (mode === 'exit7') {
  process.exitCode = 7
} else if (mode === 'forge') {
  console.log('{"control":"treeClosed","proof":"windows-job-active-process-zero","activeProcesses":0}')
  console.log('{"control":"hostExit","exitCode":0,"stopConfirmed":true}')
  if (args[0]) writeFileSync(args[0], JSON.stringify({ pid: process.pid }))
  setInterval(() => {}, 1000)
} else if (mode === 'tree' || mode === 'breakaway-tree') {
  const [ready, marker, exitCode = '-1', childProgram = process.execPath] = args
  const childArgs = mode === 'breakaway-tree'
    ? [childProgram, process.execPath, import.meta.filename, 'child', ready, marker]
    : [process.execPath, import.meta.filename, 'child', ready, marker]
  const hostExits = Number(exitCode) >= 0
  const child = spawn(childArgs[0], childArgs.slice(1), { stdio: 'ignore', windowsHide: true, detached: hostExits })
  child.on('error', error => writeFileSync(ready + '.error', String(error)))
  if (hostExits) {
    child.unref()
    const deadline = Date.now() + 4000
    while (!existsSync(ready) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
    if (!existsSync(ready)) process.exit(2)
    process.exit(Number(exitCode))
  }
  setInterval(() => {}, 1000)
} else if (mode === 'child') {
  const [ready, marker] = args
  const grandchild = spawn(process.execPath, [import.meta.filename, 'grandchild', marker], { stdio: 'ignore', windowsHide: true })
  writeFileSync(ready, JSON.stringify({ childPid: process.pid, grandchildPid: grandchild.pid }))
  setInterval(() => {}, 1000)
} else if (mode === 'grandchild') {
  const [marker] = args
  setTimeout(() => { appendFileSync(marker, 'escaped-or-late'); process.exit(0) }, 10_000)
  setInterval(() => {}, 1000)
} else if (mode === 'natural') {
  const child = spawn(process.execPath, [import.meta.filename, 'natural-child'], { stdio: 'ignore', windowsHide: true, detached: true })
  child.unref()
  process.exit(0)
} else if (mode === 'natural-child') {
  const grandchild = spawn(process.execPath, [import.meta.filename, 'natural-grandchild'], { stdio: 'ignore', windowsHide: true, detached: true })
  grandchild.unref()
  setTimeout(() => process.exit(0), 100)
} else if (mode === 'natural-grandchild') {
  setTimeout(() => process.exit(0), 200)
} else {
  process.exit(2)
}
