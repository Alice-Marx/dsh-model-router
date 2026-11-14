// Classic Agent skins paint the whole Host, outside the Bot's slot tree. Lease
// their visual styles only while the Bot shell is mounted; never change their
// saved selection, plugin state, or DOM ownership.
const VISUAL_STYLES = [
  'link[data-dsh-skin-link]',
  'style[data-skin-owner]',
  'style[data-dsh-shell-rendering]',
  'style[data-dsh-scene-neutralizer]',
  'style[data-dsh-custom-theme-style]',
  'style[data-dsh-compat="responsive"]',
  'style[data-plugin="dsh-wallpaper-engine"]',
  'style[data-plugin^="dsh-plugin-wallpaper-engine"]',
  'style#we-font-scope',
  'style#we-font-patch',
  'style#we-caret-patch',
].join(',')

function classicVisualStyle(node, win) {
  if (node.matches(VISUAL_STYLES)) return true
  if (node.tagName !== 'LINK' || node.rel !== 'stylesheet') return false
  try {
    const url = new URL(node.href, win.location.href)
    return url.origin === win.location.origin && /^\/api\/skin-center\/v2\/skins\/[^/]+\/(stylesheet|patches)$/.test(url.pathname)
  } catch { return false }
}

export function installBotSurface(win = window) {
  const doc = win.document, body = doc.body, html = doc.documentElement
  const previous = [body.getAttribute('data-bot-product-ui'), html.getAttribute('data-dsh-bot-surface')]
  body.setAttribute('data-bot-product-ui', '1')
  html.setAttribute('data-dsh-bot-surface', 'bot')
  const suspended = new Map()
  const suspend = () => {
    for (const node of doc.head.querySelectorAll('style,link[rel="stylesheet"]')) {
      if (!classicVisualStyle(node, win)) continue
      const media = node.getAttribute('media')
      if (!suspended.has(node) || media !== 'not all') suspended.set(node, media)
      if (media !== 'not all') node.setAttribute('media', 'not all')
    }
  }
  // Cover late skin activation, plugin reload and stylesheet replacement. The
  // observation stays in <head>; chat streaming does not trigger a DOM sweep.
  const observer = new win.MutationObserver(suspend)
  observer.observe(doc.head, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['media', 'href', 'rel', 'data-plugin', 'data-skin-owner', 'data-dsh-skin-link'] })
  suspend()
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    observer.disconnect()
    for (const [node, media] of suspended) {
      if (node.getAttribute('media') !== 'not all') continue
      if (media === null) node.removeAttribute('media')
      else node.setAttribute('media', media)
    }
    for (const [node, name, value] of [[body, 'data-bot-product-ui', previous[0]], [html, 'data-dsh-bot-surface', previous[1]]]) {
      if (value === null) node.removeAttribute(name)
      else node.setAttribute(name, value)
    }
  }
}
