/**
 * Which model calls belong to the Bot product.
 *
 * Only Bot turns and its own admitted frames are policed: an ordinary Harness session (the
 * user's own chat, another plugin) has no committed Bot grant, and asserting one there refuses
 * the call with UNKNOWN_SUBJECT instead of letting the Harness answer.
 *
 * @param {{ admitted: boolean, isBotSession: (sessionId: string) => boolean, sessionId?: string }} scope
 * @returns {boolean} whether the Bot policy must decide this call
 */
export function needsBotPolicy({ admitted, isBotSession, sessionId }) {
  if (admitted) return true
  if (typeof isBotSession !== 'function' || typeof sessionId !== 'string') return false
  return isBotSession(sessionId) === true
}
