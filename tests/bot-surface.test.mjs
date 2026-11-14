import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { installBotSurface } from '../apps/integration-client/bot-surface.mjs'

const settle = () => new Promise(setImmediate)
test('Bot mode suspends classic visuals and restores their exact media and saved state on exit', async () => {
  const dom = new JSDOM(`<!doctype html><html data-dsh-skin="maid-atelier"><head>
    <link rel="stylesheet" href="/api/skin-center/v2/skins/maid-atelier/stylesheet">
    <style data-plugin="dsh-wallpaper-engine" media="screen">body{color:purple}</style>
    <style data-dsh-shell-rendering></style><style data-plugin="unrelated">body{font-size:14px}</style>
    <link rel="stylesheet" href="https://example.com/api/skin-center/v2/skins/a/stylesheet">
  </head><body><div data-dsh-skin-layer="background"></div></body></html>`, { url: 'http://harness.test/' })
  const { window: win } = dom
  win.localStorage.setItem('classic-skin', 'maid-atelier')
  const before = [...win.document.head.children].map(node => node.outerHTML)
  const dispose = installBotSurface(win)
  assert.equal(win.document.body.dataset.botProductUi, '1')
  assert.equal(win.document.documentElement.dataset.dshBotSurface, 'bot')
  assert.deepEqual([...win.document.head.children].map(node => node.getAttribute('media')), ['not all', 'not all', 'not all', null, null])
  assert.equal(win.document.querySelector('[data-dsh-skin-layer]').isConnected, true, 'the classic renderer keeps ownership of its nodes')
  dispose(); dispose()
  assert.deepEqual([...win.document.head.children].map(node => node.outerHTML), before)
  assert.equal(win.document.body.hasAttribute('data-bot-product-ui'), false)
  assert.equal(win.document.documentElement.hasAttribute('data-dsh-bot-surface'), false)
  assert.equal(win.document.documentElement.dataset.dshSkin, 'maid-atelier')
  assert.equal(win.localStorage.getItem('classic-skin'), 'maid-atelier')
  await settle(); dom.window.close()
})

test('late activation and replacement remain isolated; a later Agent media change is restored', async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://harness.test/' })
  const { window: win } = dom, doc = win.document
  const dispose = installBotSurface(win)
  const late = doc.createElement('style'); late.dataset.skinOwner = 'maid-atelier'; doc.head.append(late)
  await settle(); assert.equal(late.media, 'not all')
  late.setAttribute('media', '(prefers-color-scheme: dark)')
  await settle(); assert.equal(late.media, 'not all')
  late.textContent = 'body{background:red}'
  const replacement = doc.createElement('link'); replacement.rel = 'stylesheet'
  replacement.href = '/api/skin-center/v2/skins/new-skin/patches'
  doc.head.append(replacement); await settle()
  assert.equal(replacement.media, 'not all')
  dispose()
  assert.equal(late.media, '(prefers-color-scheme: dark)')
  assert.equal(replacement.hasAttribute('media'), false)
  const after = doc.createElement('style'); after.dataset.skinOwner = 'another'; doc.head.append(after)
  await settle(); assert.equal(after.hasAttribute('media'), false, 'Agent mode has no remaining observer')
  const again = installBotSurface(win); assert.equal(after.media, 'not all'); again()
  dom.window.close()
})
