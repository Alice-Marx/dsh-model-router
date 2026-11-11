import { createElement as h, useEffect, useRef, useState } from 'react'
import { threadKeyFromRoster } from './composer-draft.mjs'
import { matchSubmission, newQueueRows } from './composer-draft-witness.mjs'

/**
 * The composer draft of one conversation, bound to the Host composer.
 *
 * The Host owns the composer: its text lives in the input state a composer slot
 * receives (`useInput`), and text goes back in through the insertion face the
 * same slot receives (`inputActions.captureInsertion()` / `insertText()`). Those
 * are the only two doors used here — the vendor's own composer extras use the
 * same pair (vendor/ds-bot/src/client/composer.js:70,79 and enter-key.js:18), and
 * this file adds no DOM query, no hashed class selector and no global
 * contenteditable lookup, because none of those is a contract.
 *
 * What this never does: send. No submit, no turn, no model call, no approval, no
 * attachment re-add. Restoring a draft fills an empty composer and stops.
 *
 * When a draft is dropped, and why nothing else may drop it:
 *   - the witness says this exact send was accepted — the session's own
 *     submission identity, read in composer-draft-witness.mjs. That is the only
 *     "yes" there is;
 *   - the composer was emptied with no send in flight, which is a person
 *     deleting what they typed, so nothing may come back later.
 * A composer that emptied while a send was in flight keeps its draft until the
 * witness answers, and remembers that a send is still open so a reload asks
 * again. An unobserved outcome is never a success: no phase, no empty input and
 * no elapsed time is read as one.
 *
 * What the Host has to provide for any of it to work: `useInput` (to read the
 * draft) and `inputActions` (to put text back). Without the insertion face this
 * component does nothing at all — it does not read, write or restore — because a
 * half-wired draft is worse than none.
 */

const readDraft = state => (typeof state?.draft === 'string' ? state.draft : '')
const readPhase = state => (typeof state?.phase === 'string' ? state.phase : '')
/** User-sourced queue rows as one stable string, for a store selector. */
const readQueue = state => (Array.isArray(state?.queue)
  ? state.queue.filter(row => row?.source?.kind === 'user').map(row => String(row?.id ?? '')).join(',')
  : '')
const readSubmissions = snapshot => {
  const rows = Array.isArray(snapshot?.pendingSubmissions) ? snapshot.pendingSubmissions : []
  // One stable string for a store selector, parsed back into the echo shape the
  // witness helpers read.
  return JSON.stringify(rows.map(row => ({ requestId: row?.requestId, text: row?.text, time: Number(row?.time ?? 0) })))
}

/** Phases in which the Host has taken the composer's text for a send. */
const IN_FLIGHT_PHASES = new Set(['submitting', 'adjudicating', 'claimed'])

const idsOf = value => (typeof value === 'string' && value ? value.split(',') : [])

const partsOf = key => {
  const thread = key.indexOf(':thread:')
  if (thread !== -1) {
    const kind = key.slice(0, key.indexOf(':'))
    return { kind, ownerId: key.slice(kind.length + 1, thread), threadId: key.slice(thread + ':thread:'.length) }
  }
  const colon = key.indexOf(':')
  return colon === -1 ? null : { kind: key.slice(0, colon), ownerId: key.slice(colon + 1) }
}

/**
 * The conversation a mounted session belongs to, as the Host roster names it. A
 * session the roster does not know (an unowned or an Agent session) has no draft.
 * `threadOf` maps a session to the stable threadId the Host directory gave it; a
 * session it does not name is the Bot's default conversation, which every part of
 * that Bot shares.
 */
export function useComposerDraftKey(sessionId, useRoster, threadOf) {
  return typeof useRoster === 'function'
    ? useRoster(value => threadKeyFromRoster(sessionId, value, threadOf))
    : ''
}

// A Host that publishes no insertion face is a different component, not a
// different hook order: the vendor's composer slots keep one hook order for a
// whole mount, and so does this. NoInput touches nothing — no read, no write, no
// restore, not even the conversation directory.
const NoInput = ({ onNote }) => {
  const said = useRef(false)
  useEffect(() => {
    if (said.current) return
    said.current = true
    if (typeof onNote === 'function') onNote('no-input-face')
  }, [onNote])
  return null
}

const ReadInput = ({ useInput, useSubmissions, ...rest }) => h(DraftBody, {
  ...rest,
  draft: useInput(readDraft),
  phase: useInput(readPhase),
  queue: useInput(readQueue),
  submissions: typeof useSubmissions === 'function' ? useSubmissions(readSubmissions) : '',
})

/**
 * @param {object} props
 * @param {ReturnType<import('./composer-draft.mjs').createComposerDraftStore>} [props.store]
 * @param {string} props.sessionId the mounted part's session
 * @param {(select: (state: unknown) => unknown) => unknown} [props.useRoster]
 * @param {(select: (state: unknown) => unknown) => unknown} [props.useInput]
 * @param {(select: (state: unknown) => unknown) => unknown} [props.useSubmissions]
 *   the Host's session hook, when this slot carries one; it is what makes a send
 *   identifiable instead of merely suspicious
 * @param {{ captureInsertion?: () => unknown, insertText?: (text: string, span: unknown) => unknown }} [props.inputActions]
 * @param {(context: { text: string, at: number, requestId?: string }) => 'accepted'|'failed'|undefined} [props.witness]
 * @param {(sessionId: string) => string | undefined} [props.threadOf]
 * @param {(note: string) => void} [props.onNote]
 */
export function ComposerDraft(props) {
  const face = props.inputActions
  const usable = typeof face?.captureInsertion === 'function' && typeof face?.insertText === 'function'
  return usable && typeof props.useInput === 'function' ? h(ReadInput, props) : h(NoInput, props)
}

function DraftBody({ store, sessionId, useRoster, inputActions, witness, threadOf, onNote, draft, phase, queue, submissions, evidenceRevision }) {
  const key = useComposerDraftKey(sessionId, useRoster, threadOf)
  const [status, setStatus] = useState('idle')
  const shown = useRef('idle')
  const latest = useRef({ draft, phase, queue, submissions, witness })
  latest.current = { draft, phase, queue, submissions, witness }
  const local = useRef({ key: '', revision: 0, seen: '', saved: '', restored: '', queueBefore: '', submissionsBefore: [], foreign: false, flight: null, timer: 0 })

  const note = value => {
    if (typeof onNote === 'function') onNote(value)
    if (shown.current === value) return
    shown.current = value
    setStatus(value)
  }
  const face = useRef(inputActions)
  face.current = inputActions

  // Dropping one draft. Only a witness that says this send was accepted, or a
  // deletion this conversation can be held to, gets here.
  const drop = (parts, row) => {
    row.flight = null
    row.revision += 1
    const dropped = store?.clear({ ...parts, revision: row.revision })
    note(dropped?.ok ? 'cleared' : `kept:${dropped?.reason}`)
  }

  // A conversation is mounted: the surface serving it makes its draft reachable,
  // and an unsent line from this same conversation goes back into an empty
  // composer. What the person already typed always wins over a stored read.
  useEffect(() => {
    const row = local.current
    if (!key || !store) {
      row.key = ''
      return undefined
    }
    const parts = partsOf(key)
    row.key = key
    row.saved = ''
    row.restored = ''
    row.flight = null
    clearTimeout(row.timer)
    row.timer = 0
    row.queueBefore = latest.current.queue
    row.submissionsBefore = JSON.parse(latest.current.submissions || '[]').map(row => row.requestId)
    row.seen = latest.current.draft
    store.see({ ...parts, sessionId })
    const record = store.read(parts)
    row.revision = record?.revision ?? 0
    // Text this conversation never saved — another conversation's, or another
    // Host's — is not ours to drop when it goes: only a deletion of text we can
    // attribute to this composer clears this conversation's draft.
    row.foreign = Boolean(latest.current.draft) && latest.current.draft !== (record?.text ?? '')
    if (!record?.text) { note('empty'); return () => store.flush() }
    // A send that was still unanswered when this window closed: the witness gets
    // the first word, so an accepted send does not come back as text.
    if (record.pendingAt) {
      const pending = { text: record.text, at: record.pendingAt, requestId: record.pendingRequestId || undefined }
      const answer = latest.current.witness?.(pending)
      if (answer === 'accepted') {
        row.revision += 1
        const dropped = store.clear({ ...parts, revision: row.revision })
        note(dropped?.ok ? 'cleared' : `kept:${dropped?.reason}`)
        return () => store.flush()
      }
      row.flight = pending
      note('kept-unknown')
      return () => store.flush()
    }
    if (latest.current.draft) { note('kept-typing'); return () => store.flush() }
    if (face.current.insertText(record.text, face.current.captureInsertion()) === false) {
      note('restore-refused')
      return () => store.flush()
    }
    row.restored = record.text
    row.seen = record.text
    row.revision = record.revision
    note('restored')
    return () => { store.flush() }
  }, [key, store, sessionId])

  // Every change of the composer's text, and every new piece of evidence about
  // the send that emptied it, lands here.
  useEffect(() => {
    const row = local.current
    if (!row.key || !store) return
    const parts = partsOf(row.key)
    if (draft) {
      if (draft === row.seen) return
      // Typing again cancels whatever the previous empty might have meant, and
      // remembers the queue this text was typed beside.
      row.seen = draft
      row.foreign = false
      row.flight = null
      row.queueBefore = latest.current.queue
      row.submissionsBefore = JSON.parse(latest.current.submissions || '[]').map(row => row.requestId)
      clearTimeout(row.timer)
      row.timer = 0
      row.revision += 1
      const stored = store.save({ ...parts, sessionId, text: draft, revision: row.revision })
      if (stored?.ok) row.saved = draft
      note(stored?.ok ? 'saved' : `refused:${stored?.reason}`)
      return
    }
    if (row.flight) {
      // New evidence about a send that is still open.
      const answer = latest.current.witness?.(row.flight)
      if (answer === 'accepted') { drop(parts, row); return }
      if (answer === 'failed') { row.flight = null; note('kept-failed'); return }
      return
    }
    if (draft === row.seen) return
    const emptied = row.seen
    row.seen = ''
    if (!emptied) return

    const at = Date.now()
    const candidates = JSON.parse(latest.current.submissions || '[]')
    const echo = matchSubmission(candidates, { text: emptied, at, before: row.submissionsBefore })
    const tookQueue = newQueueRows(idsOf(latest.current.queue), idsOf(row.queueBefore)).length > 0
    const inFlight = echo !== null || candidates.some(item => !row.submissionsBefore.includes(item.requestId)) || tookQueue ||
      (evidenceRevision === undefined && IN_FLIGHT_PHASES.has(latest.current.phase))
    if (inFlight) {
      // The Host took the text. Whether it was accepted is the witness's word.
      row.flight = { text: emptied, at, requestId: echo?.requestId }
      const answer = latest.current.witness?.(row.flight)
      if (answer === 'accepted') { drop(parts, row); return }
      if (answer === 'failed') { row.flight = null; note('kept-failed'); return }
      // Unknown: keep the text, and remember that a send is still open so a
      // reload asks again instead of quietly showing the sent line back.
      row.revision += 1
      const marked = store.save({ ...parts, sessionId, text: emptied, revision: row.revision, pendingAt: at, pendingRequestId: echo?.requestId })
      note(marked?.ok ? 'kept-unknown' : `refused:${marked?.reason}`)
      return
    }
    if (row.foreign) { note('kept-foreign'); return }
    // A person deleted what they typed. Nothing may come back later — but the
    // deletion is attributed to this conversation first, because a Host that
    // clears its composer while switching sessions must not take the draft of
    // the conversation it is leaving down with it.
    const owner = row.key
    clearTimeout(row.timer)
    row.timer = setTimeout(() => {
      row.timer = 0
      if (local.current.key !== owner || latest.current.draft) return
      drop(partsOf(owner), row)
    }, 0)
  }, [draft, store, sessionId, queue, submissions, phase, evidenceRevision])

  // A window that goes away writes what is pending before it does.
  useEffect(() => () => { clearTimeout(local.current.timer); store?.flush() }, [store])

  if (status !== 'kept-unknown') return null
  const recover = () => {
    const row = local.current, parts = partsOf(row.key), record = store?.read(parts)
    if (!record?.text || latest.current.draft) return
    if (face.current.insertText(record.text, face.current.captureInsertion()) === false) return
    row.flight = null
    note('restored')
  }
  return h('span', { className: 'bp-draft-recovery' },
    h('span', { role: 'status' }, '发送结果待确认，草稿已保留'),
    h('button', { type: 'button', onClick: recover }, '恢复草稿'),
    h('button', { type: 'button', onClick: () => drop(partsOf(local.current.key), local.current) }, '清除草稿'))
}

export const COMPOSER_DRAFT_STATUSES = Object.freeze([
  'idle', 'empty', 'kept-typing', 'no-input-face', 'restore-refused',
  'restored', 'saved', 'cleared', 'kept-unknown', 'kept-failed', 'kept-foreign',
])
