import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import * as esbuild from 'esbuild'

// A standalone preview of the real client component. No Harness process or
// server-side plugin is loaded, and the bundle remains in memory.
const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const portAt = args.indexOf('--port')
const portValue = portAt < 0 ? process.env.WORKBENCH_PREVIEW_PORT || '4173' : args[portAt + 1]
const port = Number(portValue)
if (!/^\d+$/.test(String(portValue)) || !Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('Provide --port <0-65535> or WORKBENCH_PREVIEW_PORT; the default is 4173.')
}
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const build = await esbuild.context({
  absWorkingDir: root,
  entryPoints: ['scripts/workbench-preview.jsx'],
  outfile: 'workbench-preview.js',
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  loader: { '.css': 'text' },
  define: {
    __ROUTER_CLIENT_VERSION__: JSON.stringify(pkg.version),
    __WORKBENCH_PREVIEW_VERSION__: JSON.stringify(pkg.version),
    'process.env.NODE_ENV': '"development"',
  },
  plugins: [{
    name: 'lf-css',
    setup(builder) {
      builder.onLoad({ filter: /\.css$/ }, file => ({
        contents: readFileSync(file.path, 'utf8').replace(/\r\n/g, '\n'), loader: 'text',
      }))
    },
  }],
})

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Model Router · 本地 UI 演示</title>
<style>
  html, body, #root { margin: 0; width: 100%; height: 100%; }
  body { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; }
  #root { display: flex; flex-direction: column; }
  .preview-toolbar { flex-shrink: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 12px 24px; background: #152033; color: #f4f7fc; font-size: 12px; line-height: 1.5; }
  .preview-toolbar strong { color: #91dfce; }
  .preview-toolbar p { margin: 0; flex: 1 1 300px; }
  .preview-toolbar label { display: flex; align-items: center; gap: 8px; }
  .preview-toolbar select, .preview-toolbar button { border: 1px solid #5c6b82; border-radius: 6px; color: #f4f7fc; background: #24334b; font: inherit; padding: 5px 8px; }
  .preview-toolbar :focus-visible { outline: 2px solid #91dfce; outline-offset: 3px; }
  .preview-content { flex: 1; min-height: 0; }
  @media (max-width: 640px) { .preview-toolbar { padding: 10px 14px; } }
</style></head><body><div id="root"></div><script type="module" src="/workbench-preview.js"></script></body></html>`

try {
  await build.rebuild()
  if (args.includes('--check')) {
    console.log('[workbench-preview] Actual RouterMainPage and demo fixtures compile successfully.')
    await build.dispose()
  } else {
    const server = createServer(async (request, response) => {
      const headers = {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        // The preview cannot contact paid APIs or remote RPCs even if UI code
        // accidentally attempts to. All client remotes are in-memory mocks.
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      }
      const path = new URL(request.url, 'http://127.0.0.1').pathname
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end('Method not allowed')
        return
      }
      if (path === '/') {
        response.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' }).end(request.method === 'HEAD' ? undefined : html)
        return
      }
      if (path === '/workbench-preview.js') {
        try {
          // Reloading the page picks up client edits without modifying client.js.
          const result = await build.rebuild()
          const bundle = result.outputFiles.find(file => file.path.endsWith('.js'))
          response.writeHead(200, { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' }).end(request.method === 'HEAD' ? undefined : bundle.contents)
        } catch (error) {
          response.writeHead(500, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }).end(`Preview build failed: ${error.message}`)
        }
        return
      }
      response.writeHead(404, headers).end('Not found')
    })
    server.on('error', async error => {
      console.error(`[workbench-preview] ${error.message}`)
      await build.dispose()
      process.exitCode = 1
    })
    server.listen(port, '127.0.0.1', () => {
      console.log(`[workbench-preview] http://127.0.0.1:${server.address().port}`)
      console.log('[workbench-preview] Demo data only. No model calls, credentials, installs, or terminals. Reload after editing UI source.')
    })
    const stop = () => server.close(async () => { await build.dispose(); process.exit(0) })
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  }
} catch (error) {
  await build.dispose()
  throw error
}
