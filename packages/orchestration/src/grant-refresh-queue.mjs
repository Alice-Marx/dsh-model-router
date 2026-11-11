/** Coalesce synchronous grant notifications and drain their reads before Host teardown. */
export function createGrantRefreshQueue({ lifecycle, onError = () => {} }) {
  let closed = false, dirty = false, active = null
  const request = () => {
    if (closed) return
    dirty = true
    if (active) return
    active = Promise.resolve().then(async () => {
      while (dirty && !closed) {
        dirty = false
        try { await lifecycle()?.refreshGrants() }
        catch (cause) { try { onError(cause) } catch { /* logging cannot leak a rejection */ } }
      }
    }).finally(() => { active = null })
  }
  return Object.freeze({ request, async close() { closed = true; dirty = false; await active } })
}
