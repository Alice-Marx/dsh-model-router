export const isStoryPausePoint = node => !node || Boolean(node.input || node.ending || node.choices?.length)

/** Never choose a branch or submit a name during automatic reading. */
export function readingAction({ node, mode, paused, done, readBefore = false, skipUnread = false }) {
  if (paused || !['auto', 'skip'].includes(mode)) return 'wait'
  if (isStoryPausePoint(node)) return 'stop'
  if (mode === 'skip' && !skipUnread && !readBefore) return 'stop'
  if (!done) return mode === 'skip' ? 'reveal' : 'wait'
  return 'advance'
}

export function isGalShortcutTarget(target) {
  return !target?.closest?.('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="button"]')
}
