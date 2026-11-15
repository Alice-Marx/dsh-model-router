import { useLayoutEffect } from 'react'

// In the mobile Host the native sidebar track is zero-width, while DS Bot keeps
// its 88px rail. Reserve only the part the Host has not already reserved.
export function useWorkspaceInset(ref) {
  useLayoutEffect(() => {
    const node = ref.current, win = node?.ownerDocument?.defaultView, doc = node?.ownerDocument
    if (!node || !win || !doc || !win.MutationObserver || !win.requestAnimationFrame) return
    let parent = node.parentElement
    while (parent?.parentElement && parent.getBoundingClientRect().width === 0) parent = parent.parentElement
    let sidebar, frame = 0, last = -1
    const resize = win.ResizeObserver ? new win.ResizeObserver(() => schedule()) : null
    const attributes = new win.MutationObserver(() => schedule())
    const update = () => {
      frame = 0
      const current = doc.querySelector('.bt-leftcol:not([data-leaving]):not([aria-hidden="true"])')
      if (current !== sidebar) {
        if (sidebar) resize?.unobserve(sidebar)
        attributes.disconnect(); sidebar = current
        if (sidebar) { resize?.observe(sidebar); attributes.observe(sidebar, { attributes: true, attributeFilter: ['data-left', 'data-leaving', 'aria-hidden', 'style'] }) }
      }
      const host = parent.getBoundingClientRect(), rect = sidebar?.getBoundingClientRect()
      const width = rect ? sidebar.dataset.left === 'drawer' || win.innerWidth < 650 ? Math.min(rect.width, 88) : rect.width : 0
      const inset = rect ? Math.max(0, Math.round(rect.left + width - host.left)) : 0
      if (inset !== last) { last = inset; node.style.marginLeft = inset + 'px' }
    }
    const schedule = () => { if (!frame) frame = win.requestAnimationFrame(update) }
    const portals = new win.MutationObserver(schedule); portals.observe(doc.body, { childList: true })
    resize?.observe(parent); win.addEventListener('resize', schedule); update()
    return () => { if (frame) win.cancelAnimationFrame(frame); win.removeEventListener('resize', schedule); resize?.disconnect(); attributes.disconnect(); portals.disconnect(); node.style.removeProperty('margin-left') }
  }, [ref])
}
