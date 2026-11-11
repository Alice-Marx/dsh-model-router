import { createElement as h, useMemo, useSyncExternalStore } from 'react'
import { createComposerDraftBinding } from './composer-draft-binding.mjs'
import { ComposerDraft } from './composer-draft-session.jsx'

function Bound({ control, ...props }) {
  const snapshot = useSyncExternalStore(control.subscribe, control.getSnapshot, control.getSnapshot)
  const useSubmissions = select => select(snapshot)
  return h(ComposerDraft, { ...props, useSubmissions, witness: control.outcome, evidenceRevision: snapshot })
}

export function ComposerDraftBound({ sessionBinding, ...props }) {
  const control = useMemo(() => createComposerDraftBinding(sessionBinding), [sessionBinding])
  return control ? h(Bound, { ...props, control }) : h(ComposerDraft, props)
}
