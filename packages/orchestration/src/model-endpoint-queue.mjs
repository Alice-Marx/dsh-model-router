const queueError = (code, message) => Object.assign(new Error(message), { code })

/** One running inference per local endpoint. FIFO within each priority. */
export function createModelEndpointQueue({ maxWaiting = 64, waitMs = 120_000 } = {}) {
  const endpoints = new Map()
  let closed = false, waiting = 0
  const closedError = () => queueError('MODEL_ENDPOINT_QUEUE_CLOSED', '本机推理队列已关闭。')

  const hold = (key, endpoint) => {
    endpoint.running = true
    let released = false
    return () => {
      if (released) return
      released = true
      endpoint.running = false
      const next = endpoint.interactive[0] ?? endpoint.background[0]
      if (next) next.start()
      else endpoints.delete(key)
    }
  }

  return Object.freeze({
    async acquire(key, { interactive = false, signal } = {}) {
      if (closed) throw closedError()
      signal?.throwIfAborted()
      let endpoint = endpoints.get(key)
      if (!endpoint) {
        endpoint = { running: false, interactive: [], background: [] }
        endpoints.set(key, endpoint)
      }
      if (!endpoint.running) return hold(key, endpoint)
      if (waiting >= maxWaiting) throw queueError('MODEL_ENDPOINT_QUEUE_FULL', '本机推理队列已满，请稍后重试。')
      const lane = interactive ? endpoint.interactive : endpoint.background
      return new Promise((resolve, reject) => {
        const remove = () => {
          lane.splice(lane.indexOf(entry), 1)
          clearTimeout(timer)
          signal?.removeEventListener('abort', cancel)
          waiting--
        }
        const cancel = () => entry.refuse(signal.reason)
        const entry = {
          start() { remove(); resolve(hold(key, endpoint)) },
          refuse(error) { remove(); reject(error) },
        }
        const timer = setTimeout(() => entry.refuse(queueError('MODEL_ENDPOINT_QUEUE_TIMEOUT', '等待本机模型超时，请重试。')), waitMs)
        timer.unref?.()
        waiting++
        lane.push(entry)
        signal?.addEventListener('abort', cancel, { once: true })
      })
    },
    close() {
      closed = true
      for (const endpoint of endpoints.values()) {
        for (const entry of [...endpoint.interactive, ...endpoint.background]) entry.refuse(closedError())
      }
      endpoints.clear()
    },
  })
}
