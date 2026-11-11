import { createElement as h, Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { COMPOSER_DRAFT_LIMITS, createComposerDraftStore } from './composer-draft.mjs'
import { ComposerDraftBound } from './composer-draft-bound.jsx'

/**
 * The Host namespace, read from the Host, and the slot wrapper the wiring uses.
 *
 * Why an adapter at all: a browser origin is not a Host identity. Two Hosts can
 * serve the same `dsh-app://app` origin, so a namespace minted in the page would
 * be shared by both and their drafts would mix. The Host therefore mints and
 * persists its own id, and this component asks for it on every mount:
 *
 *   productApi.dispatch('ui.namespace', {}, signal)
 *     -> { schemaVersion: 1, hostId: 'host-<16 hex>' }
 *
 * The Host keeps that value in its own SQLite
 * (`packages/orchestration/src/ui-host-namespace.mjs`), so it survives restarts
 * and differs per Host. Nothing here generates a namespace of its own: a read
 * that fails, times out, is aborted or answers late leaves the drafts switched
 * off rather than guessing an identity.
 *
 * Rules this holds:
 *   - until a validated namespace arrives, no read, no write, no restore;
 *   - a Host replacement aborts the read in flight and drops the old store
 *     before the new one is used, so a late answer cannot overwrite the new
 *     Host's drafts;
 *   - a failure is reported, not retried in the background; the caller re-reads
 *     explicitly by raising `attempt`.
 */

const NAMESPACE_PATTERN = /^host-[0-9a-f]{16}$/

/** The one shape the Host answers with; anything else is a refusal. */
export function validateNamespace(value) {
  if (!value || typeof value !== 'object') throw new Error('宿主没有返回界面存储标识。')
  if (value.schemaVersion !== 1) throw new Error('宿主界面存储标识版本不被此客户端支持。')
  if (typeof value.hostId !== 'string' || !NAMESPACE_PATTERN.test(value.hostId)) throw new Error('宿主界面存储标识格式无效。')
  return value.hostId
}

const messageOf = error => (error?.message ? String(error.message) : String(error ?? '未知错误'))

/**
 * Asks the Host for its namespace and renders the draft once it answers.
 *
 * @param {object} props
 * @param {{ dispatch: (action: string, payload: unknown, signal?: AbortSignal) => Promise<unknown> }} props.productApi
 * @param {number} [props.attempt] raising it re-reads the namespace explicitly
 * @param {(status: { status: 'pending'|'ready'|'error', hostId: string, error: string }) => void} [props.onStatus]
 * @param {(store: ReturnType<import('./composer-draft.mjs').createComposerDraftStore> | undefined) => void} [props.onStore]
 *   the store this Host namespace owns, or undefined while the drafts are off
 * @param {Record<string, unknown>} [props.storage] defaults to the window's localStorage
 */
export function ComposerDraftHost({ productApi, attempt = 0, namespaceTimeoutMs = 8000, onStatus, onStore, storage, children, ...slot }) {
  const [state, setState] = useState({ status: 'pending', hostId: '', error: '' })
  const [retry, setRetry] = useState(0)
  // Effects run after rendering. Never expose A's ready store on the first
  // render of B, even when the replacement RPC has not started yet.
  const current = state.api === productApi && state.attempt === attempt && state.retry === retry ? state : { status: 'pending', hostId: '', error: '' }
  const generation = useRef(0)

  useEffect(() => {
    const mine = (generation.current += 1)
    const controller = new AbortController()
    // A replacement Host retires the old store first: until its own namespace
    // answers, this window serves no drafts at all, and a late answer for the
    // Host it replaced cannot install itself.
    const scope = { api: productApi, attempt, retry }
    setState({ ...scope, status: 'pending', hostId: '', error: '' })
    let timer
    const read = async () => {
      try {
        const value = await Promise.race([
          productApi.dispatch('ui.namespace', {}, controller.signal),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('读取宿主草稿标识超时，请重试。')), namespaceTimeoutMs) }),
        ])
        // A later request (a Host replacement, a remount) owns the answer now.
        if (generation.current !== mine || controller.signal.aborted) return
        setState({ ...scope, status: 'ready', hostId: validateNamespace(value), error: '' })
      } catch (error) {
        if (generation.current !== mine || controller.signal.aborted) return
        setState({ ...scope, status: 'error', hostId: '', error: messageOf(error) })
        controller.abort()
      } finally {
        clearTimeout(timer)
      }
    }
    void read()
    return () => { clearTimeout(timer); controller.abort() }
  }, [productApi, attempt, retry, namespaceTimeoutMs])

  useEffect(() => {
    if (typeof onStatus === 'function') onStatus({ status: current.status, hostId: current.hostId, error: current.error })
  }, [state, onStatus, productApi, attempt, retry])
  // One store per Host namespace. A replacement flushes what the retired Host
  // still had pending and lets it go before the new one takes over.
  const store = useMemo(() => (current.hostId
    ? createComposerDraftStore({ storage: storage ?? globalThis.localStorage, hostId: current.hostId, limits: COMPOSER_DRAFT_LIMITS })
    : undefined), [current.hostId, storage])
  const held = useRef(undefined)
  useEffect(() => {
    if (typeof onStore === 'function') onStore(store ?? null)
  }, [store, onStore])
  useEffect(() => {
    const previous = held.current
    held.current = store
    if (previous !== undefined && previous !== store) previous.flush()
  }, [store])
  useEffect(() => () => { held.current?.flush() }, [])

  if (typeof children === 'function') return children({ store, status: current.status, hostId: current.hostId, error: current.error })
  return h(Fragment, null, h(ComposerDraftBound, { ...slot, store, hostStatus: current.status }),
    current.status === 'error' ? h('span', { className: 'bp-draft-recovery' },
      h('span', { role: 'status' }, '草稿恢复暂不可用'),
      h('button', { type: 'button', onClick: () => setRetry(value => value + 1) }, '重试草稿恢复')) : null)
}

/**
 * The wrapper the wiring puts in the Host's composer slot. It keeps the original
 * registration's component and its props untouched — the Host still renders the
 * very component it registered — and adds the draft beside it.
 *
 * @param {React.ComponentType} component the component the slot already had
 * @param {{ productApi: object }} options
 */
export function withComposerDraft(component, options = {}) {
  const { productApi } = options
  const Wrapped = props => h(Fragment, null,
    h(component, props),
    h(ComposerDraftHost, { ...props, ...options, productApi, sessionBinding: options.sessionBindingOf?.(props.sessionId) }),
  )
  // Anything that probes the slot for the component it registered still finds it.
  Wrapped.composerDraftOriginal = component
  return Wrapped
}

/** A stable re-read handle for a caller that wants to retry explicitly. */
export function useNamespaceRetry() {
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  return { attempt, retry }
}
