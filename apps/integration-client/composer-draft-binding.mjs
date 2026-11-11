import { observedRequestIds, readSendOutcome } from './composer-draft-witness.mjs'

// Read-only adapter for the public SessionBinding: no prompt interception,
// retention, replacement, or access to the concrete Session implementation.
export function createComposerDraftBinding(binding) {
  const session = binding?.session, events = binding?.eventSource
  if (typeof session?.getSnapshot !== 'function' || typeof session?.subscribe !== 'function' ||
      typeof events?.getSnapshot !== 'function' || typeof events?.subscribe !== 'function') return null
  const inbox = session.projections?.faceOf?.('inbox')
  const echoes = new Map(), accepted = new Set(), listeners = new Set()
  let snapshot, serialized = '', releases = []
  const collect = () => {
    for (const row of session.getSnapshot()?.pendingSubmissions ?? []) {
      if (typeof row?.requestId === 'string' && row.requestId) echoes.set(row.requestId, {
        requestId: row.requestId, text: row.text, time: row.time,
      })
    }
    for (const id of observedRequestIds((events.getSnapshot()?.entries ?? [])
      .filter(row => row.type === 'event').map(row => row.event))) accepted.add(id)
    // Queue acceptance is also durable admission. Read only the published
    // inbox projection, using the same UserMessage source identity as the SDK.
    const queue = inbox?.getSnapshot?.()
    for (const target of ['next-turn', 'next-step']) for (const message of queue?.[target] ?? []) {
      if (message?.source?.kind === 'user' && typeof message.source.rpcId === 'string') accepted.add(message.source.rpcId)
    }
    while (echoes.size > 128) echoes.delete(echoes.keys().next().value)
    while (accepted.size > 512) accepted.delete(accepted.values().next().value)
    const value = { pendingSubmissions: [...echoes.values()], acceptedRequestIds: [...accepted] }
    const next = JSON.stringify(value)
    if (next === serialized) return
    serialized = next; snapshot = value
    for (const listener of [...listeners]) listener()
  }
  collect()
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) {
        releases = [session.subscribe(collect), events.subscribe(collect), inbox?.subscribe?.(collect)].filter(value => typeof value === 'function')
        collect()
      }
      return () => {
        listeners.delete(listener)
        if (!listeners.size) { for (const release of releases) release(); releases = [] }
      }
    },
    outcome(pending) { collect(); return readSendOutcome({ pending, acceptedRequestIds: snapshot.acceptedRequestIds }) },
  })
}
