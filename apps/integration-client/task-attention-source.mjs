import { useCallback, useMemo, useSyncExternalStore } from 'react'

const sources = new WeakMap()
const empty = Object.freeze({ value: null, lastInbox: null, inboxUnsupported: false, readOnly: false, failed: false })
const unavailable = { subscribe: () => () => {}, getSnapshot: () => empty }

function sourceFor(api) {
  if (typeof api?.attention !== 'function') return unavailable
  if (sources.has(api)) return sources.get(api)
  const listeners = new Map()
  let state = empty, timer, deadline, request
  const useInbox = () => typeof api.inbox === 'function' && !state.inboxUnsupported && [...listeners.values()].includes(true)
  const publish = next => {
    state = { ...state, ...next }
    for (const listener of listeners.keys()) listener()
  }
  const cancel = () => {
    clearTimeout(timer)
    clearTimeout(deadline)
    request?.abort()
    request = undefined
  }
  const schedule = delay => {
    if (listeners.size && !document.hidden) timer = setTimeout(load, delay)
  }
  const load = async () => {
    cancel()
    if (!listeners.size || document.hidden) return
    const controller = new AbortController()
    request = controller
    const inbox = useInbox()
    const timeout = setTimeout(() => {
      if (request !== controller) return
      cancel()
      publish({ value: null, failed: true })
      schedule(15000)
    }, 8000)
    deadline = timeout
    let delay = 5000
    try {
      const value = await (inbox ? api.inbox(controller.signal) : api.attention(controller.signal))
      if (request !== controller) return
      if (inbox && value?.inboxView !== true) {
        publish({ inboxUnsupported: true, value, readOnly: false, failed: false })
        delay = 0
      } else {
        publish({ value, ...(inbox ? { lastInbox: value } : {}), readOnly: false, failed: false })
      }
    } catch (error) {
      if (request !== controller) return
      if (inbox && ['INVALID_ATTENTION_REQUEST', 'INVALID_PRODUCT_ACTION', 'PRODUCT_ACTION_UNAVAILABLE'].includes(error?.code)) {
        publish({ inboxUnsupported: true })
        delay = 0
      } else {
        publish({ value: null, readOnly: error?.code === 'PRODUCT_READ_ONLY', failed: true })
        delay = 15000
      }
    } finally {
      clearTimeout(timeout)
      if (request === controller) { request = undefined; schedule(delay) }
    }
  }
  const visible = () => {
    if (document.hidden) {
      cancel()
      publish({ value: null })
    } else void load()
  }
  let unsubscribe
  const source = {
    getSnapshot: () => state,
    refresh: () => void load(),
    subscribe(listener, inbox) {
      const before = useInbox()
      listeners.set(listener, inbox)
      if (listeners.size === 1) {
        document.addEventListener('visibilitychange', visible)
        unsubscribe = api.subscribeActions?.(action => {
          if (action === 'notifications.read' || action === 'notifications.markAll') void load()
        })
        void load()
      } else if (before !== useInbox()) void load()
      return () => {
        listeners.delete(listener)
        if (listeners.size) return
        cancel()
        document.removeEventListener('visibilitychange', visible)
        unsubscribe?.()
        state = { ...empty, inboxUnsupported: state.inboxUnsupported }
      }
    },
  }
  sources.set(api, source)
  return source
}

/** The sidebar and lightweight pages use a single visible-window poll per Host connection. */
export function useTaskAttention(api, mode = 'summary') {
  const source = useMemo(() => mode === false ? unavailable : sourceFor(api), [api, mode])
  const subscribe = useCallback(listener => source.subscribe(listener, mode === 'inbox'), [source, mode])
  return [useSyncExternalStore(subscribe, source.getSnapshot, source.getSnapshot), source.refresh]
}
