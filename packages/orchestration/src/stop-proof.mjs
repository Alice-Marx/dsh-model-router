/**
 * Which task backends owe a stop proof, and which evidence each accepts.
 *
 * One truth for two readers: the journal decides whether a terminal attempt may
 * keep a terminal state (`needsStopProof`), and the service refuses to register
 * a side-effecting backend that nobody taught to prove itself. Keeping the list
 * in one module is what stops a new backend from silently landing in the second
 * set — the failure that turns a failed write into a silently repeated one.
 *
 * `remote-command` is on the list because a container command with a side effect
 * is exactly what must not be retried on a guess; it was missing while its
 * driver already produced `container-supervisor` evidence, which the journal did
 * not accept either. Both halves are fixed here.
 */

const EVIDENCE = Object.freeze({
  'codex-read': Object.freeze(['native-tree', 'cli-no-dispatch']),
  'bot-turn-read': Object.freeze(['bot-turn-ended', 'bot-turn-not-sent']),
  'bot-turn-write': Object.freeze(['bot-turn-ended', 'bot-turn-not-sent']),
  'remote-write': Object.freeze(['agent-stop-receipt', 'agent-write-completed', 'remote-dispatch-not-sent']),
  'remote-command': Object.freeze(['container-supervisor', 'remote-dispatch-not-sent']),
})

const IDS = Object.freeze(Object.keys(EVIDENCE))

/** A frozen set so a caller cannot widen the requirement at run time. */
export const STOP_PROOF_BACKENDS = Object.freeze(new Set(IDS))

/** True when this backend id must present a stop proof before a terminal state stands. */
export const requiresStopProof = (backend) => STOP_PROOF_BACKENDS.has(backend)

/** The evidence strings this backend may cite, or null when it owes no proof. */
export const stopProofEvidence = (backend) => EVIDENCE[backend] ?? null

/** True for backends whose effects can land outside this process. */
export const hasExternalEffect = (backend) =>
  backend?.effect === 'workspace-write' || (backend?.location === 'remote' && backend?.effect !== 'read')
