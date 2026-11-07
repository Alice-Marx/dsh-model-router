// One unresolved submission per connected product API. Keep only its reference in window memory;
// tasks, outputs, credentials and previews never enter this cache or browser storage.
const scopes = new WeakMap()
const same = (left, right) => left?.requestKey === right?.requestKey && left?.requesterBotId === right?.requesterBotId
const reference = value => {
  for (const field of ['requestKey', 'requesterBotId']) {
    if (typeof value?.[field] !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value[field])) throw new TypeError('INVALID_ROUTING_SUBMISSION_REFERENCE')
  }
  return { requestKey: value.requestKey, requesterBotId: value.requesterBotId }
}

// This portable code is a lookup reference, never authority or a task to execute.
export function submissionCode(input) {
  const value = reference(input)
  return `dsh-route-v1:${value.requesterBotId}:${value.requestKey}`
}

function parseCode(code) {
  if (typeof code !== 'string' || code.length > 1024) throw new TypeError('INVALID_ROUTING_SUBMISSION_CODE')
  const match = /^dsh-route-v1:([A-Za-z0-9_-]{1,128}):([A-Za-z0-9_-]{1,128})$/.exec(code.trim())
  if (!match) throw new TypeError('INVALID_ROUTING_SUBMISSION_CODE')
  return { requesterBotId: match[1], requestKey: match[2] }
}

export function routingSubmissions(scope) {
  if (!scope || !['object', 'function'].includes(typeof scope)) throw new TypeError('ROUTING_SUBMISSION_SCOPE_REQUIRED')
  if (scopes.has(scope)) return scopes.get(scope)
  let value = null
  const listeners = new Set()
  const publish = next => { value = next === null ? null : Object.freeze(next); for (const listener of [...listeners]) listener() }
  const store = Object.freeze({
    getSnapshot: () => value,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    start(input) {
      const identity = reference(input)
      if (value) return false
      publish({ ...identity, state: 'submitting', planId: null, planState: null })
      return true
    },
    restore(code) {
      if (value) return false
      publish({ ...parseCode(code), state: 'unknown', planId: null, planState: null })
      return true
    },
    update(input, result) {
      if (!same(value, input)) return false
      if (!['unknown', 'not-found', 'confirmed'].includes(result.state)) throw new TypeError('INVALID_ROUTING_SUBMISSION_STATE')
      // A delayed failed lookup cannot erase a receipt that already confirmed acceptance.
      if (value.state === 'confirmed' && result.state !== 'confirmed') return false
      publish({ ...reference(input), state: result.state,
        planId: result.state === 'confirmed' ? result.planId : null,
        planState: result.state === 'confirmed' ? result.planState ?? (value.state === 'confirmed' ? value.planState : null) : null })
      return true
    },
    clear(input) {
      if (!same(value, input) || value.state !== 'confirmed') return false
      publish(null)
      return true
    },
    dismissUnconfirmed(input) {
      if (!same(value, input) || value.state !== 'not-found') return false
      publish(null)
      return true
    },
  })
  scopes.set(scope, store)
  return store
}
