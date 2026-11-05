import { randomUUID } from 'node:crypto'

const INPUT_TOOLS = ['desktop_click', 'desktop_key', 'desktop_type', 'desktop_scroll']
const fail = code => { throw Object.assign(new Error(code), { code }) }
const id = value => typeof value === 'string' && /^[-A-Za-z0-9_.]{1,128}$/u.test(value)
const closed = (value, names) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !names.includes(key))) fail('INVALID_DESKTOP_REQUEST')
}

/** Only owner actions mint session tickets. Pairing secrets and Agent grants never reach the viewer. */
export function createDesktopSessionHost({ machine, binding, authority, issue, request, event, now = Date.now }) {
  const sessions = new Map()
  const check = (subject, row) => {
    const botId = authority.describe(subject).botId
    if (botId !== row.botId) fail('MACHINE_BOT_DENIED')
    const record = machine(row.machineId), grant = binding(record.id, botId)
    if (row.machineRevision !== undefined && (record.revision !== row.machineRevision || grant.revision !== row.bindingRevision)) fail('MACHINE_GRANT_CHANGED')
    if (!grant.scope.roots.includes(row.rootId) || !grant.scope.tools.includes('desktop_screenshot')) fail('MACHINE_BOT_DENIED')
    authority.assertTool(subject, 'remote/desktop_screenshot')
    const tools = ['desktop_screenshot', ...INPUT_TOOLS.filter(tool => grant.scope.mode === 'workspace-write' && grant.scope.tools.includes(tool)
      && (() => { try { authority.assertTool(subject, `remote/${tool}`); return true } catch { return false } })())]
    if (row.mode === 'control' && INPUT_TOOLS.some(tool => !tools.includes(tool))) fail('MACHINE_BOT_DENIED')
    return { record, grant, tools }
  }
  const remember = (row, value) => {
    if (!id(value?.sessionId) || typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value.token)
      || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now() || value.expiresAt > now() + 300_000
      || value.path !== '/desktop/v1/socket') fail('MACHINE_PROTOCOL_INVALID')
    sessions.set(value.sessionId, { ...row, sessionId: value.sessionId, expiresAt: value.expiresAt })
    const url = new URL(value.path, row.record.config.endpoint)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return { sessionId: value.sessionId, token: value.token, expiresAt: value.expiresAt, websocketUrl: url.href,
      mode: row.mode, taskId: row.identity.taskId, attemptId: row.identity.attemptId,
      canControl: INPUT_TOOLS.every(tool => row.tools.includes(tool)),
      displays: Array.isArray(value.displays) ? value.displays : [], displayId: value.displayId ?? row.displayId ?? null }
  }
  const current = (subject, input) => {
    closed(input, ['sessionId'])
    if (!id(input.sessionId)) fail('INVALID_DESKTOP_REQUEST')
    const row = sessions.get(input.sessionId)
    if (!row) fail('DESKTOP_SESSION_EXPIRED')
    check(subject, row)
    return row
  }
  return Object.freeze({
    async open(subject, input, { signal, clientOrigin, taskId, attemptId } = {}) {
      closed(input, ['machineId', 'rootId', 'mode', 'displayId', 'fps'])
      if (!id(input.machineId) || !id(input.rootId) || input.mode !== undefined && !['watch', 'control'].includes(input.mode)
        || input.fps !== undefined && (!Number.isInteger(input.fps) || input.fps < 5 || input.fps > 30)
        || input.displayId !== undefined && (typeof input.displayId !== 'string' || input.displayId.length > 128 || /[\u0000-\u001f]/u.test(input.displayId))) fail('INVALID_DESKTOP_REQUEST')
      for (const [key, row] of sessions) if (row.expiresAt <= now()) sessions.delete(key)
      if (sessions.size >= 32) fail('DESKTOP_SESSION_LIMIT')
      if ((taskId !== undefined || attemptId !== undefined) && (!id(taskId) || !id(attemptId))) fail('INVALID_DESKTOP_IDENTITY')
      const row = { ...input, mode: input.mode ?? 'watch', botId: authority.describe(subject).botId,
        identity: { taskId: taskId ?? `owner-desktop-${randomUUID()}`, attemptId: attemptId ?? `attempt-${randomUUID()}` } }
      const { record, grant, tools } = check(subject, row)
      row.record = record; row.machineRevision = record.revision; row.bindingRevision = grant.revision; row.tools = tools
      row.grantToken = await issue(record, row.botId, { roots: [row.rootId], tools }, row.identity, signal)
      check(subject, row)
      const value = await request(record.config, '/desktop/v1/session', row.grantToken,
        { mode: row.mode, ...(row.displayId ? { displayId: row.displayId } : {}), fps: input.fps ?? 15,
          ...(clientOrigin ? { origin: clientOrigin } : {}) }, signal)
      check(subject, row)
      event(record.id, row.botId, 'desktop-session-opened')
      return remember(row, value)
    },
    async renew(subject, input, { signal, clientOrigin } = {}) {
      const row = current(subject, input), { record, tools } = check(subject, row)
      const grantToken = await issue(record, row.botId, { roots: [row.rootId], tools }, row.identity, signal)
      const value = await request(record.config, '/desktop/v1/session/renew', grantToken,
        { sessionId: row.sessionId, ...(clientOrigin ? { origin: clientOrigin } : {}) }, signal)
      check(subject, row)
      return remember({ ...row, grantToken, tools }, value)
    },
    async close(subject, input, { signal } = {}) {
      const row = current(subject, input)
      const value = await request(row.record.config, '/desktop/v1/session/close', row.grantToken, { sessionId: row.sessionId }, signal)
      if (value?.stopConfirmed !== true) fail('DESKTOP_STOP_UNCONFIRMED')
      sessions.delete(row.sessionId); event(row.machineId, row.botId, 'desktop-session-closed')
      return { stopConfirmed: true }
    },
    async closeAll() {
      return Promise.allSettled([...sessions.values()].map(async row => {
        const value = await request(row.record.config, '/desktop/v1/session/close', row.grantToken,
          { sessionId: row.sessionId }, AbortSignal.timeout(2500))
        if (value?.stopConfirmed !== true) fail('DESKTOP_STOP_UNCONFIRMED')
        sessions.delete(row.sessionId)
        event(row.machineId, row.botId, 'desktop-session-closed')
        return { sessionId: row.sessionId, stopConfirmed: true }
      }))
    },
  })
}
