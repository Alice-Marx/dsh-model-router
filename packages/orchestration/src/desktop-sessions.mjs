import { randomUUID } from 'node:crypto'

const INPUT_TOOLS = ['desktop_click', 'desktop_key', 'desktop_type', 'desktop_scroll']
const NODE_CARRIER=Symbol('host-only-desktop-carrier')
const fail = code => { throw Object.assign(new Error(code), { code }) }
const id = value => typeof value === 'string' && /^[-A-Za-z0-9_.]{1,128}$/u.test(value)
const closed = (value, names) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !names.includes(key))) fail('INVALID_DESKTOP_REQUEST')
}

/** Only owner actions mint session tickets. Pairing secrets and Agent grants never reach the viewer. */
export function createDesktopSessionHost({ machine, binding, authority, issue, request, cleanupRequest, event, desktopProxy, desktopHttp, connectDesktop, now = Date.now }) {
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
    if (row.tools?.some(tool => !tools.includes(tool))) fail('MACHINE_BOT_DENIED')
    return { record, grant, tools }
  }
  const remember = (row, value) => {
    if (!id(value?.sessionId) || typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value.token)
      || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now() || value.expiresAt > now() + 300_000
      || value.path !== '/desktop/v1/socket') fail('MACHINE_PROTOCOL_INVALID')
    sessions.set(value.sessionId, { ...row, sessionId: value.sessionId, expiresAt: value.expiresAt })
    const url = new URL(value.path, row.record.config.endpoint)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const ticket = { sessionId: value.sessionId, token: value.token, expiresAt: value.expiresAt, websocketUrl: url.href,
      mode: row.mode, taskId: row.identity.taskId, attemptId: row.identity.attemptId,
      canControl: INPUT_TOOLS.every(tool => row.tools.includes(tool)),
      displays: Array.isArray(value.displays) ? value.displays : [], displayId: value.displayId ?? row.displayId ?? null }
    if (!row.record.config.transport) return ticket
    if(row.internal)return {...ticket,websocketUrl:undefined,openWebSocket:async()=>{
      check(row.subject,row)
      const socket=await connectDesktop(row.record,undefined,undefined,{autoPong:true})
      const validate=()=>{const live=sessions.get(value.sessionId);if(!live||live.expiresAt<=now())fail('DESKTOP_SESSION_EXPIRED');check(live.subject,live)}
      try{validate()}catch(error){socket.terminate();throw error}
      const send=socket.send.bind(socket)
      socket.send=(...args)=>{try{validate()}catch(error){socket.terminate();throw error};return send(...args)}
      const sweep=setInterval(()=>{try{const live=sessions.get(row.sessionId??value.sessionId);if(!live)fail('DESKTOP_SESSION_EXPIRED');check(live.subject,live);if(live.expiresAt<=now())fail('DESKTOP_SESSION_EXPIRED')}catch{socket.terminate()}},100)
      sweep.unref();socket.once('close',()=>clearInterval(sweep))
      return socket
    }}
    const carrier=row.clientOrigin==='dsh-app://app'?desktopHttp:desktopProxy
    return carrier.wrapTicket(ticket, { ownerPeer: row.ownerPeer, botId: row.botId, clientOrigin: row.clientOrigin,
      validate: () => { check(row.subject,row); if (ticket.expiresAt<=now()) fail('DESKTOP_SESSION_EXPIRED'); return true },
      connect: async ({signal}) => connectDesktop(row.record,signal,row.clientOrigin),
    })
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
    openInternal(subject,input,context={}) { if(!id(context.taskId)||!id(context.attemptId))fail('INVALID_DESKTOP_IDENTITY');return this.open(subject,input,{...context,[NODE_CARRIER]:true}) },
    async open(subject, input, context = {}) {
      const {signal,clientOrigin,taskId,attemptId,peer}=context
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
      row.internal=context[NODE_CARRIER]===true
      if (record.config.transport && (typeof connectDesktop!=='function'||!row.internal&&(!(clientOrigin==='dsh-app://app'?desktopHttp:desktopProxy)||!peer))) fail('DESKTOP_PROXY_UNAVAILABLE')
      row.subject=subject;row.ownerPeer=peer;row.clientOrigin=clientOrigin
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
    async renew(subject, input, { signal, clientOrigin, peer, taskId, attemptId } = {}) {
      const row = current(subject, input), { record, tools } = check(subject, row)
      if(row.internal&&(taskId!==row.identity.taskId||attemptId!==row.identity.attemptId))fail('DESKTOP_SESSION_OWNER_MISMATCH')
      if (record.config.transport && !row.internal && (peer!==row.ownerPeer || clientOrigin!==row.clientOrigin)) fail('MACHINE_BOT_DENIED')
      const grantToken = await issue(record, row.botId, { roots: [row.rootId], tools }, row.identity, signal)
      const value = await request(record.config, '/desktop/v1/session/renew', grantToken,
        { sessionId: row.sessionId, ...(clientOrigin ? { origin: clientOrigin } : {}) }, signal)
      check(subject, row)
      return remember({ ...row, grantToken, tools }, value)
    },
    async close(subject, input, { signal, taskId, attemptId } = {}) {
      closed(input,['sessionId']);if(!id(input.sessionId))fail('INVALID_DESKTOP_REQUEST')
      const row=sessions.get(input.sessionId)
      if(!row||authority.describe(subject).botId!==row.botId)fail('MACHINE_BOT_DENIED')
      if(row.internal&&(taskId!==row.identity.taskId||attemptId!==row.identity.attemptId))fail('DESKTOP_SESSION_OWNER_MISMATCH')
      desktopProxy?.revoke(row.sessionId)
      desktopHttp?.revoke(row.sessionId)
      const value = cleanupRequest?await cleanupRequest(row.record,{sessionId:row.sessionId,botId:row.botId,...row.identity},signal)
        :await request(row.record.config, '/desktop/v1/session/close', row.grantToken, { sessionId: row.sessionId }, signal)
      if (value?.stopConfirmed !== true) fail('DESKTOP_STOP_UNCONFIRMED')
      sessions.delete(row.sessionId); event(row.machineId, row.botId, 'desktop-session-closed')
      return { stopConfirmed: true }
    },
    async closeAll() {
      return Promise.allSettled([...sessions.values()].map(async row => {
        desktopProxy?.revoke(row.sessionId)
        desktopHttp?.revoke(row.sessionId)
        const value = cleanupRequest?await cleanupRequest(row.record,{sessionId:row.sessionId,botId:row.botId,...row.identity},AbortSignal.timeout(2500))
          :await request(row.record.config, '/desktop/v1/session/close', row.grantToken,{ sessionId: row.sessionId }, AbortSignal.timeout(2500))
        if (value?.stopConfirmed !== true) fail('DESKTOP_STOP_UNCONFIRMED')
        sessions.delete(row.sessionId)
        event(row.machineId, row.botId, 'desktop-session-closed')
        return { sessionId: row.sessionId, stopConfirmed: true }
      }))
    },
  })
}
