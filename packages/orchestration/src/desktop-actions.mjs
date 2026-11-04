import { randomUUID } from 'node:crypto'
import { parseDesktopAct, parseDesktopView } from './desktop-contract.mjs'

export { framePoint, parseDesktopAct, parseDesktopView } from './desktop-contract.mjs'

/**
 * Owner-facing desktop control for a paired machine.
 *
 * The workbench is a person watching a remote screen, so the calls still run as that person's
 * Bot: the machine ceiling and the Bot grant decide what is allowed, and every action lands in
 * the operation records under that Bot. A screenshot is single-use, exactly like the
 * model-facing tool path — acting on a stale frame is refused instead of applied to whatever is
 * on screen now.
 */

const fail = code => { const error = new Error(code); error.code = code; throw error }

export function createDesktopActions({ machines, directory, now = Date.now, uuid = randomUUID } = {}) {
  if (!machines || typeof machines.call !== 'function' || typeof directory?.forBot !== 'function') {
    throw new TypeError('DESKTOP_ACTIONS_REQUIRE_MACHINES_AND_DIRECTORY')
  }
  const subjectFor = botId => {
    const subject = directory.forBot(botId)
    if (!subject) fail('UNKNOWN_BOT')
    return subject
  }
  const context = request => {
    const stamp = String(now()).replace(/[^0-9]/gu, '')
    return { machineId: request.machineId, rootId: request.rootId, taskId: `owner-desktop-${stamp}-${uuid().replace(/-/gu, '').slice(0, 12)}` }
  }
  return Object.freeze({
    async view(payload) {
      const request = parseDesktopView(payload)
      const subject = subjectFor(request.botId)
      const base = context(request)
      const attemptId = `owner-attempt-${uuid().replace(/-/gu, '').slice(0, 12)}`
      const record = await machines.call(subject, { ...base, attemptId, tool: 'desktop_screenshot', args: {} })
      const value = record?.value ?? {}
      if (!value?.artifactId) return { unavailable: true, reason: record?.status === 'succeeded' ? 'FRAME_MISSING' : 'FRAME_UNAVAILABLE', operationId: record?.operationId ?? null }
      const image = await machines.download(subject, { ...base, attemptId, operationId: record.operationId, artifactId: value.artifactId })
      const base64 = typeof image?.content === 'string' ? image.content : Buffer.from(image?.content ?? []).toString('base64')
      return {
        mediaType: value.mediaType ?? 'image/png', base64,
        screenshotId: value.screenshotId ?? null, width: value.width ?? null, height: value.height ?? null,
        takenAt: now(), operationId: record.operationId ?? null,
      }
    },
    async act(payload) {
      const request = parseDesktopAct(payload)
      const subject = subjectFor(request.botId)
      const base = context(request)
      const attemptId = `owner-attempt-${uuid().replace(/-/gu, '').slice(0, 12)}`
      const record = await machines.call(subject, { ...base, attemptId, operationId: `owner-op-${uuid().replace(/-/gu, '').slice(0, 16)}`, tool: request.tool, args: request.args })
      return { tool: request.tool, status: record?.status ?? 'unknown', value: record?.value ?? null, operationId: record?.operationId ?? null }
    },
  })
}
