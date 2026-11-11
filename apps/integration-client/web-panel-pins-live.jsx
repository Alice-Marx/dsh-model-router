import React, { useEffect, useState } from 'react'
import { WebPanelPins } from './web-panel-page.jsx'

/** The sidebar needs only the pin directory, never the entire usage/task snapshot. */
export function WebPanelPinsLive({ productApi, onSelect }) {
  const [state, setState] = useState({ api: null, panels: [] })
  useEffect(() => {
    let live = true, generation = 0, controller, timer
    const read = async () => {
      const mine = ++generation
      controller?.abort(); clearTimeout(timer)
      const request = new AbortController(); controller = request
      timer = setTimeout(() => request.abort(), 8000)
      try {
        const value = await productApi.dispatch('webPanels.list', {}, request.signal)
        if (live && mine === generation && !request.signal.aborted) setState({ api: productApi, panels: Array.isArray(value?.panels) ? value.panels : [] })
      } catch {
        if (live && mine === generation && !request.signal.aborted) setState({ api: productApi, panels: [] })
      } finally { if (mine === generation) clearTimeout(timer) }
    }
    const changed = action => { if (['webPanels.save', 'webPanels.remove', 'webPanels.order'].includes(action)) void read() }
    const off = productApi.subscribeActions?.(changed)
    globalThis.window?.addEventListener('focus', read)
    void read()
    return () => { live = false; generation++; clearTimeout(timer); controller?.abort(); off?.(); globalThis.window?.removeEventListener('focus', read) }
  }, [productApi])
  return <WebPanelPins panels={state.api === productApi ? state.panels : []} onSelect={onSelect}/>
}
