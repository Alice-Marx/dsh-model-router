/** Adapt the explicit Host-wide Schedule API introduced by Harness 0.2.2. */
export function adaptScheduleService(service) {
  if (!service || typeof service.delete === 'function' || typeof service.edit !== 'function' || typeof service.view !== 'function') return service
  const entry = value => ({ ...value, sessionId: value.target?.kind === 'session' ? value.target.sessionId : undefined })
  const fail = code => { throw Object.assign(new Error(code), { code }) }
  return Object.freeze({
    async catalog() { return (await service.catalog()).map(entry) },
    async list({ sessionId }) { return (await service.catalog()).map(entry).filter(value => value.sessionId === sessionId && value.status === 'active') },
    async create(sessionId, request) {
      const selectors = { at: 'at', after_seconds: 'after', every_seconds: 'every', daily: 'daily', weekly: 'weekly', cron: 'cron' }
      const selected = Object.keys(selectors).filter(key => Object.hasOwn(request, key))
      if (selected.length !== 1 || typeof sessionId !== 'string' || !sessionId) fail('BOT_SCHEDULE_TIMING_INVALID')
      const key = selected[0]
      return entry(await service.create({ title: request.title, prompt: request.prompt,
        timing: { kind: selectors[key], [key]: request[key] }, target: { kind: 'session', sessionId } }))
    },
    async delete({ sessionId, id }) {
      const current = await service.view({ id })
      if (current.target?.kind !== 'session' || current.target.sessionId !== sessionId) return { id, deleted: false, code: 'schedule_not_found' }
      const result = await service.edit({ id, action: 'delete', expectedUpdatedAt: current.updatedAt ?? null })
      if (result.code === 'schedule_conflict') fail('BOT_SCHEDULE_CHANGED')
      return result
    },
  })
}
