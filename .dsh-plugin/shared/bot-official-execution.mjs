/** The model-facing CLI runner asks a Host-owned service, never the request, for authority. */
export const DEFAULT_OFFICIAL_MODEL = 'vendor-default'

export function officialModelId(value) {
  if (value === undefined || value === null || value === '' || value === DEFAULT_OFFICIAL_MODEL) return null
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(value)) {
    throw new TypeError('CLI model must be a bounded model identifier')
  }
  return value
}

const refused = code => { throw Object.assign(new Error(code), { code, notStarted: true }) }
const serviceOf = (ctx, name) => { try { return ctx?.get?.(name) ?? null } catch { return null } }
export const officialAdmissionAvailable = ctx => typeof serviceOf(ctx, 'botOfficialTools')?.authorize === 'function'

/** Read-only discovery does not require an additional execution admission. */
export async function botOfficialToolSnapshot(ctx) {
  const policy = serviceOf(ctx, 'botIntegrationPolicy')
  if (!policy) return null
  const identity = policy.activeIdentity?.()
  if (!identity || typeof identity.owner !== 'boolean') refused('BOT_OFFICIAL_CALL_CONTEXT_REQUIRED')
  if (identity.owner) return null
  const service = serviceOf(ctx, 'botOfficialTools')
  if (typeof service?.snapshotFor !== 'function') refused('BOT_OFFICIAL_TOOLS_UNAVAILABLE')
  const rows = await service.snapshotFor(identity.botId)
  if (!Array.isArray(rows)) refused('BOT_OFFICIAL_CATALOG_INVALID')
  // Deliberate allowlist: a future Host catalog field cannot accidentally add
  // a launch path, credential source, endpoint, or underlying grant capability.
  return rows.map(row => ({ toolId: row.toolId, label: row.label, vendor: row.vendor, source: row.source,
    installed: row.installed === true, loginState: row.loginState, status: row.status, reason: row.reason,
    modes: [...(row.modes ?? [])], identities: (row.identities ?? []).map(item => ({ model: item.model, label: item.label })),
    grant: row.grant ? { toolId: row.grant.toolId, cliModel: row.grant.cliModel, mode: row.grant.mode } : null }))
}

/**
 * No Bot identity is accepted here. The service resolves the current policy frame
 * itself and re-reads committed grants and live readiness on every admission.
 * A pre-product, standalone router has no policy and keeps its legacy behavior.
 */
export async function authorizeOfficialRequest(ctx, { toolId, cliModel, mode = 'read-only', executionEnvironment = 'harness' }) {
  const policy = serviceOf(ctx, 'botIntegrationPolicy')
  const service = serviceOf(ctx, 'botOfficialTools')
  if (!service) {
    if (policy) refused('BOT_OFFICIAL_TOOLS_UNAVAILABLE')
    return { cliModel: cliModel || DEFAULT_OFFICIAL_MODEL, modelId: officialModelId(cliModel) }
  }
  if (typeof service.authorize !== 'function') refused('BOT_OFFICIAL_TOOLS_UNAVAILABLE')
  const request = { toolId, mode, executionEnvironment, ...(cliModel == null || cliModel === '' ? {} : { cliModel }) }
  let value
  try { value = await service.authorize(request) }
  catch (error) {
    // This service only admits; no child has been launched when it rejects.
    if (error && typeof error === 'object') error.notStarted = true
    throw error
  }
  if (!value || typeof value.cliModel !== 'string' || !value.cliModel) refused('BOT_OFFICIAL_AUTHORIZATION_INVALID')
  const frame = typeof policy?.activeIdentity === 'function' ? policy.activeIdentity() : null
  if (policy && (!frame || typeof frame.owner !== 'boolean')) refused('BOT_OFFICIAL_CALL_CONTEXT_REQUIRED')
  return { cliModel: value.cliModel, modelId: officialModelId(value.cliModel), botScoped: frame?.owner === false }
}

/** Translate the saved default sentinel once more at the final launch seam. */
export async function admittedOfficialModel(authorizeOfficial, request) {
  return (await admittedOfficialSelection(authorizeOfficial, request)).modelId
}

export async function admittedOfficialSelection(authorizeOfficial, request) {
  const cliModel = request.cliModel ?? request.modelId ?? undefined
  if (typeof authorizeOfficial !== 'function') return { cliModel: cliModel || DEFAULT_OFFICIAL_MODEL, modelId: officialModelId(cliModel), botScoped: false }
  const value = await authorizeOfficial({ toolId: request.toolId, ...(cliModel == null ? {} : { cliModel }),
    mode: request.mode ?? 'read-only', executionEnvironment: request.executionEnvironment ?? 'harness' })
  if (!value || !Object.hasOwn(value, 'cliModel')) refused('BOT_OFFICIAL_AUTHORIZATION_INVALID')
  return { cliModel: value.cliModel, modelId: officialModelId(value.cliModel), botScoped: value.botScoped === true }
}
