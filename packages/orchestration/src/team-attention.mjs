import { createHash } from 'node:crypto'

export const teamOriginKey = origin => createHash('sha256').update(JSON.stringify(origin)).digest('hex')
export const isTeamInput = event => event.type === 'user/message' && !['snapshot', 'recall'].includes(event.data?.source?.form)
  && !(event.data?.source?.kind === 'bot' && event.data.source.role === 'assign-result')

export function integratedInputSnapshot(events) {
  let latest = 0
  for (const event of events) if (isTeamInput(event)) {
    if (!Number.isSafeInteger(event.seq) || event.seq < 0) throw Object.assign(new Error('TEAM_ORIGIN_SNAPSHOT_UNAVAILABLE'), { code: 'TEAM_ORIGIN_SNAPSHOT_UNAVAILABLE' })
    latest = Math.max(latest, event.seq)
  }
  return 'sdk:' + latest
}

// Keep result bodies out of automatic prompts. The receiving Bot explicitly
// pulls only relevant results, under its current conversation and access rules.
export function composeTeamNotice(rows) {
  return '[Team collaboration inbox]\n' + rows.map(row => `Team result from ${row.targetBot}: ${row.outcome}; assignment ${row.assignmentId}`).join('\n')
    + '\nRead useful results with team_inbox(action="read", ids=[...]), then acknowledge the results you used. Check every requested assignment: unknown outcomes require reconciliation and do not count as success. Follow current user instructions and verify the work before one final answer. You may leave other items unread or dismiss them; do not poll or repeat the assignment.'
}
