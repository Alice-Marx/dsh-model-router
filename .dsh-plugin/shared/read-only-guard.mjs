/**
 * Proof that a read-only run stayed read-only.
 *
 * Claude may now use its normal reading tools in a read-only step (plan mode plus the run
 * workspace), so withholding tools is no longer the guarantee. The guarantee is evidence:
 * the Host fingerprints the workspace before the run and compares it afterwards, and a run
 * that changed anything is reported as failed instead of being called a successful read.
 */

export const READ_ONLY_WRITE_CODE = 'READ_ONLY_RUN_CHANGED_WORKSPACE'

/** Normalize a `git status --porcelain` listing so ordering and line endings cannot hide a change. */
export function normalizeFingerprint(value) {
  return String(value ?? '')
    .split('\n')
    .map(line => line.replace(/\r$/u, '').trimEnd())
    .filter(Boolean)
    .sort()
    .join('\n')
}

/**
 * @param {string|null} before fingerprint before the run
 * @param {string|null} after fingerprint after the run
 * @returns {boolean} true only when both fingerprints exist and differ
 */
export function workspaceChanged(before, after) {
  if (typeof before !== 'string' || typeof after !== 'string') return false
  return normalizeFingerprint(before) !== normalizeFingerprint(after)
}

/** The parts of a run result this guard may rewrite, and nothing else. */
export function readOnlyViolation(result) {
  return {
    ...result,
    status: 'failed',
    error: READ_ONLY_WRITE_CODE,
    reason: READ_ONLY_WRITE_CODE,
    modelNotice: '只读任务改动了工作区：结果按失败处理，改动不会被当作产物整合。',
  }
}
