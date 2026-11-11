import { randomBytes, randomUUID } from 'node:crypto'
import { createConnection, createServer } from 'node:net'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const { PNG } = createRequire(import.meta.url)('pngjs')

/** Real DesktopTools client and private pipe, with an offscreen helper peer. */
export async function nativeDesktopFixture(t) {
  const root = resolve(import.meta.dirname, '../..')
  const base = join(root, 'tmp/integration/native-desktop-helper')
  await mkdir(base, { recursive: true })
  const home = await mkdtemp(join(base, 'case-'))
  const config = { pipeName: `dsh-desktop-native-${randomBytes(8).toString('hex')}`, secretFile: join(home, 'helper-secret') }
  const token = randomBytes(32).toString('hex'), instance = randomBytes(16).toString('hex')
  await writeFile(config.secretFile, token)
  const image = PNG.sync.write({ width: 384, height: 384, data: randomBytes(384 * 384 * 4) })
  const calls = [], frames = new Map(), sockets = new Set()
  const servers = []
  for (const control of [false, true]) {
    const server = createServer(socket => {
      sockets.add(socket); socket.once('close', () => sockets.delete(socket))
      let text = ''
      let handled = false
      socket.on('data', chunk => {
        if (handled) return
        text += chunk.toString('utf8')
        if (!text.includes('\n')) return
        handled = true
        const request = JSON.parse(text.slice(0, text.indexOf('\n')))
        const respond = (result, code = null) => socket.end(JSON.stringify({ protocolVersion: 2,
          ok: !code, effect: code ? 'not-applied' : 'applied', ...(code ? { code, stopConfirmed: true } : { result }) }) + '\n')
        if (request.token !== token || request.protocolVersion !== 2) { respond(null, 'AUTH_DENIED'); return }
        if (control) {
          if (request.name === 'probe') respond({ protocolVersion: 2, helperInstanceId: instance })
          else if (request.name === 'cancel') respond({ helperInstanceId: instance, stopConfirmed: true })
          else respond(null, 'UNSUPPORTED')
          return
        }
        if (request.helperInstanceId !== instance) { respond(null, 'HELPER_CHANGED'); return }
        if (request.name === 'desktop_screenshot') {
          const screenshotId = `shot-${randomUUID()}`
          frames.set(screenshotId, { owner: request.owner, expires: Date.now() + 15000, used: false })
          calls.push({ name: request.name, owner: request.owner, screenshotId })
          respond({ screenshotId, mediaType: 'image/png', width: 384, height: 384, pngBase64: image.toString('base64') })
          return
        }
        const frame = frames.get(request.args?.screenshotId)
        if (!frame || frame.owner !== request.owner || frame.used || frame.expires < Date.now()) { respond(null, 'TARGET_STALE'); return }
        if (request.name === 'desktop_click' && (!Number.isInteger(request.args.x) || !Number.isInteger(request.args.y)
          || request.args.x < 0 || request.args.y < 0 || request.args.x >= 384 || request.args.y >= 384)) { respond(null, 'COORDINATE_OUTSIDE_FRAME'); return }
        frame.used = true
        calls.push({ name: request.name, owner: request.owner, args: request.args })
        respond({ applied: true, stopConfirmed: true })
      })
    })
    const endpoint = process.platform === 'win32' ? '\\\\.\\pipe\\' + config.pipeName + (control ? '-control' : '') : join(home, 'desktop' + (control ? '-control' : '') + '.sock')
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve) })
    servers.push(server)
  }
  const output = join(home, 'desktop.mjs')
  const agentModule = pathToFileURL(join(root, 'remote-computer-agent/dist/index.mjs')).href
  await build({ entryPoints: [join(root, 'remote-computer-agent/src/desktop.ts')], outfile: output, bundle: true,
    platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent',
    plugins: [{ name: 'actual-agent-protocol', setup(builder) {
      builder.onResolve({ filter: /^\.\/protocol\.js$/ }, () => ({ path: agentModule, external: true }))
    } }] })
  const { DesktopTools } = await import(pathToFileURL(output).href)
  const close = async () => {
    for (const socket of sockets) socket.destroy()
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))))
  }
  t.after(close)
  return { config, image, calls, frames,
    attach(agent) {
      const options = { validate: context => agent.store.validate(context) }
      if (process.platform !== 'win32') options.connect = path => {
        const control = path.endsWith('-control')
        return createConnection(join(home, `desktop${control ? '-control' : ''}.sock`))
      }
      agent.desktop = new DesktopTools(config, options)
    } }
}
