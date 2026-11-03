import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const [mode, ...args] = process.argv.slice(2)
const hold = () => setInterval(() => {}, 1000)
const exists = path => {
  try { readFileSync(path); return true } catch { return false }
}

if (mode === 'launcher') {
  const [adapter, dir, hostMode, barrier, holdCreated] = args
  const record = (name, value) => writeFileSync(`${dir}/${name}.json`, JSON.stringify(value))
  try {
    const { createWindowsManagedTerminal } = await import(pathToFileURL(adapter).href)
    const proc = await createWindowsManagedTerminal({
      launch: { file: process.execPath, args: [import.meta.filename, hostMode, 'ready.json', 'late-marker', 'heartbeat'], utf8Console: false },
      cwd: dir, cols: 80, rows: 30,
      env: { SystemRoot: process.env.SystemRoot, PATH: process.env.Path ?? '', TEMP: `${dir}/tmp`, TMP: `${dir}/tmp`, K31_BARRIER: barrier },
      ttlMs: 60_000, privateOutput: `${dir}/output-parent`,
    })
    proc.onExit(value => record('host-event', value))
    proc.onTreeClosed(value => record('tree-event', value))
    proc.onControlLost(value => record('lost-event', { ...value, treeClosed: proc.treeClosed, hostExited: proc.hostExited }))
    proc.closed.then(value => { record('closed-event', value); process.exit(0) })
    record('launcher-ready', { launcherPid: process.pid, hostPid: proc.pid, hostIdentity: proc.startIdentity })
    if (holdCreated !== 'hold') await proc.resume()
  } catch (error) {
    record('factory-error', { code: error.code ?? 'UNKNOWN', nativeCode: error.nativeCode ?? null })
    process.exit(0)
  }
} else if (mode === 'tree' || mode === 'host-exit' || mode === 'spoof-tree' || mode === 'session-tree') {
  const [ready, marker, heartbeat, label] = args
  // A surviving Windows child must outlive Node's own parent lifetime job.
  // detached creates a process group; it does not request Job breakaway.
  const child = spawn(process.execPath, [import.meta.filename, 'child', ready, marker, heartbeat], { stdio: 'ignore', windowsHide: true, detached: mode === 'host-exit' })
  if (mode === 'host-exit') {
    child.unref()
    while (!exists(ready)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
    process.exit(0)
  }
  if (mode === 'spoof-tree') {
    console.log('{"control":"treeClosed","proof":"windows-job-active-process-zero","activeProcesses":0}')
    console.log('{"control":"hostExit","exitCode":0}')
    console.log('{"control":"stopRequested","reason":"stop"}')
  }
  if (mode === 'session-tree') console.log(`SESSION_${label}`)
  hold()
} else if (mode === 'natural-host') {
  const [ready, heartbeat, grandchildExit, childExit] = args
  const child = spawn(process.execPath, [import.meta.filename, 'natural-child', ready, heartbeat, grandchildExit, childExit], { stdio: 'ignore', windowsHide: true, detached: true })
  child.unref()
  while (!exists(ready)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  process.exit(0)
} else if (mode === 'natural-child') {
  const [ready, heartbeat, grandchildExit, childExit] = args
  const grandchild = spawn(process.execPath, [import.meta.filename, 'natural-grandchild', grandchildExit], { stdio: 'ignore', windowsHide: true })
  grandchild.on('exit', code => {
    if (code !== 0) process.exit(2)
    setTimeout(() => { appendFileSync(childExit, 'child\n'); process.exit(0) }, 600)
  })
  writeFileSync(ready, JSON.stringify({ hostPid: process.ppid, childPid: process.pid, grandchildPid: grandchild.pid }))
  appendFileSync(heartbeat, 'alive\n')
  setInterval(() => appendFileSync(heartbeat, 'alive\n'), 100)
} else if (mode === 'natural-grandchild') {
  const [grandchildExit] = args
  setTimeout(() => { appendFileSync(grandchildExit, 'grandchild\n'); process.exit(0) }, 700)
} else if (mode === 'child') {
  const [ready, marker, heartbeat] = args
  process.on('uncaughtException', error => { writeFileSync(ready + '.child-error', String(error)); process.exit(2) })
  process.on('exit', code => writeFileSync(ready + '.child-exit', JSON.stringify({ code })))
  const grandchild = spawn(process.execPath, [import.meta.filename, 'grandchild', marker], { stdio: 'ignore', windowsHide: true })
  grandchild.on('error', error => writeFileSync(ready + '.grandchild-error', String(error)))
  grandchild.on('exit', code => writeFileSync(ready + '.grandchild-exit', JSON.stringify({ code })))
  writeFileSync(ready, JSON.stringify({ hostPid: process.ppid, childPid: process.pid, grandchildPid: grandchild.pid }))
  if (heartbeat) {
    appendFileSync(heartbeat, 'alive\n')
    setInterval(() => appendFileSync(heartbeat, 'alive\n'), 100)
  }
  hold()
} else if (mode === 'grandchild') {
  const [marker] = args
  process.on('uncaughtException', error => { writeFileSync(marker + '.error', String(error)); process.exit(2) })
  setTimeout(() => { appendFileSync(marker, 'late\n'); process.exit(0) }, 4000)
  hold()
} else if (mode === 'breakaway-child') {
  const [marker] = args
  setTimeout(() => { appendFileSync(marker, 'escaped\n'); process.exit(0) }, 1000)
  hold()
} else {
  process.exit(2)
}
