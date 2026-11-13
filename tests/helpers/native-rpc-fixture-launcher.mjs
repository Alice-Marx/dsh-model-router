import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

/** Real offline child processes; deliberately no claimed OS tree containment. */
export function createFixtureNativeLauncher({ onLaunch = () => {} } = {}) {
  return {
    async probe() { return { available: true, helper: { fixture: true }, limitations: ['Fixture has no OS sandbox or descendant accounting.'] } },
    async protect() {},
    supervise(_helper, mode, spec, launch) {
      if (mode !== 'supervise') throw new Error('Fixture only launches supervised processes')
      onLaunch(spec, launch)
      const events = new EventEmitter(), decoder = new StringDecoder('utf8'), controls = new Map()
      const child = spawn(spec.executable, spec.args, { cwd: spec.cwd, env: launch.env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
      let closed = false, buffer = ''
      const control = value => { controls.set(value.control, value); events.emit('control', value) }
      child.once('spawn', () => control({ control: 'spawned', pid: child.pid, fixture: true, containment: 'none' }))
      child.once('error', error => events.emit('failure', error))
      child.stdout.on('data', chunk => {
        buffer += decoder.write(chunk)
        if (Buffer.byteLength(buffer) > 262_144) { events.emit('failure', new Error('fixture frame limit')); child.stdin.end(); return }
        let end
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
          if (!line.trim()) continue
          try { events.emit('message', JSON.parse(line)) } catch { events.emit('failure', new Error('fixture invalid frame')); child.stdin.end() }
        }
      })
      child.stderr.resume()
      child.stdin.on('error', () => {})
      const exit = new Promise(resolve => child.once('close', (code, signal) => {
        closed = true; control({ control: 'stopped', pid: child.pid, exitCode: code, signal, treeStopped: false, containment: 'none', fixture: true })
        events.emit('closed', { code, signal }); resolve({ code, signal })
      }))
      return {
        child, events, exit,
        send: value => new Promise((resolve, reject) => { if (closed) { reject(new Error('closed')); return }; child.stdin.write(JSON.stringify(value) + '\n', error => error ? reject(error) : resolve()) }),
        end: () => child.stdin.end(), get closed() { return closed },
        waitControl(name) {
          if (controls.has(name)) return Promise.resolve(controls.get(name))
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { cleanup(); reject(new Error('fixture spawn timeout')) }, 5000)
            const cleanup = () => { clearTimeout(timer); events.off('control', listener); events.off('closed', ended) }
            const listener = value => { if (value.control === name) { cleanup(); resolve(value) } }
            const ended = () => { cleanup(); reject(new Error('fixture exited')) }
            events.on('control', listener); events.once('closed', ended)
          })
        },
      }
    },
  }
}

export async function nativeRpcFixtureEntry(script, version = '1.0.0') {
  const hash = bytes => createHash('sha256').update(bytes).digest('hex')
  return { executable: process.execPath, sha256: hash(await readFile(process.execPath)), script,
    scriptSha256: hash(await readFile(script)), version }
}
