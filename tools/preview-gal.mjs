import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'build/gal-preview')
await mkdir(output, { recursive: true })
await build({
  absWorkingDir: root,
  stdin: {
    contents: `import React from 'react';
import { createRoot } from 'react-dom/client';
import { GalModulePage } from './.dsh-plugin/client/gal-module-page.jsx';
createRoot(document.getElementById('root')).render(React.createElement(GalModulePage, {
  loadCatalog: async () => ({ok: true, value: []}),
}));`,
    resolveDir: root,
    loader: 'jsx',
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  jsx: 'transform',
  loader: { '.css': 'text', '.png': 'dataurl', '.webp': 'dataurl' },
  outfile: resolve(output, 'client.js'),
})
await writeFile(resolve(output, 'index.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gal 本地界面预览</title><style>body{margin:0}#preview-note{padding:8px 20px;background:#fff;color:#475569;font:14px system-ui}</style></head>
<body><div id="preview-note">本地 Gal 界面预览 · 使用实际插件组件 · 不连接模型账号</div><div id="root"></div><script src="/client.js"></script></body></html>`, 'utf8')

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  const file = pathname === '/' ? 'index.html' : pathname === '/client.js' ? 'client.js' : null
  if (!file) { response.writeHead(404); response.end(); return }
  try {
    const data = await readFile(resolve(output, file))
    response.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(data)
  } catch { response.writeHead(500); response.end('Preview file unavailable') }
})
if (!process.argv.includes('--build-only')) {
  server.listen(0, '127.0.0.1', () => console.log(`Gal preview: http://127.0.0.1:${server.address().port}/`))
} else console.log(`Gal preview built: ${output}`)
