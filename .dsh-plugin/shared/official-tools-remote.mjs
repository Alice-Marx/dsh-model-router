/**
 * Narrow Typert Remote contract for the official desktop tool installer.
 *
 * The official Client Gateway mounts this contribution with remote.$mount;
 * the Host Typert registry owns the matching strict descriptors. No endpoint
 * accepts a command, package name, URL, argument vector, or executable path.
 */
import { getOfficialTool } from './official-tool-registry.mjs'

export const OFFICIAL_TOOLS_REMOTE_PACKAGE = '@ljwei-stak/model-router-galgame'
export const OFFICIAL_TOOLS_REMOTE_NAMESPACE = 'modelRouterOfficialTools'

function strictCodec(typeSymbol, parse) {
  return Object.freeze({ mode: 'strict', typeSymbol, create: () => ({ parse }) })
}

function plainObject(value, subject) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${subject} must be an object`)
  }
  return value
}

const toolIdCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#OfficialToolId`, value => {
  if (typeof value !== 'string' || !getOfficialTool(value)) {
    throw new TypeError('toolId must name a fixed official tool')
  }
  return value
})

const listResultCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#OfficialToolList`, value => {
  const result = plainObject(value, 'tool list result')
  if (!Array.isArray(result.tools)) throw new TypeError('tool list result needs a tools array')
  return result
})

const installResultCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#OfficialToolInstall`, value => {
  const result = plainObject(value, 'install result')
  if (typeof result.accepted !== 'boolean') throw new TypeError('install result needs accepted')
  if (result.accepted && !result.job) throw new TypeError('accepted install needs a job')
  if (!result.accepted && typeof result.error !== 'string') throw new TypeError('refused install needs an error')
  return result
})

const statusResultCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#OfficialToolStatus`, value => {
  const result = plainObject(value, 'install status result')
  if (result.job !== null && (typeof result.job !== 'object' || Array.isArray(result.job))) {
    throw new TypeError('install status result needs a job or null')
  }
  return result
})

const anyObjectCodec = name => strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#${name}`, value => plainObject(value, name))

const freshCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#HealthFresh`, value => {
  if (typeof value !== 'boolean') throw new TypeError('fresh must be a boolean')
  return value
})

const idText = (value, subject) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(value)) throw new TypeError(`${subject} must be a short id`)
  return value
}

const optionalRouteText = (value, subject) => {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > 240 || value.includes('\0')) throw new TypeError(`${subject} is invalid`)
  return value
}

const rateRequestCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#RateRequest`, value => {
  const request = plainObject(value, 'rate request')
  if (!['up', 'down', 'clear'].includes(request.rating)) throw new TypeError('rating must be up, down or clear')
  return { runId: idText(request.runId, 'runId'), packageId: idText(request.packageId, 'packageId'), rating: request.rating }
})

const rerunRequestCodec = strictCodec(`${OFFICIAL_TOOLS_REMOTE_PACKAGE}#RerunRequest`, value => {
  const request = plainObject(value, 'rerun request')
  const provider = optionalRouteText(request.provider, 'provider')
  const model = optionalRouteText(request.model, 'model')
  if (Boolean(provider) !== Boolean(model)) throw new TypeError('provider and model must be supplied together')
  return {
    runId: idText(request.runId, 'runId'), packageId: idText(request.packageId, 'packageId'),
    ...(provider ? { provider, model } : {}),
    confirmOverBudget: request.confirmOverBudget === true,
  }
})

function descriptor(method, parameters, result) {
  return Object.freeze({
    id: `${OFFICIAL_TOOLS_REMOTE_PACKAGE}#${OFFICIAL_TOOLS_REMOTE_NAMESPACE}/${method}`,
    service: OFFICIAL_TOOLS_REMOTE_NAMESPACE,
    namespace: OFFICIAL_TOOLS_REMOTE_NAMESPACE,
    method,
    invocation: { kind: 'direct' },
    parameters,
    result,
  })
}

const toolIdParameter = Object.freeze({
  name: 'toolId', wire: 'toolId', source: 'json', codec: toolIdCodec,
})
const jsonParameter = (name, codec) => Object.freeze({ name, wire: name, source: 'json', codec })

export const OFFICIAL_TOOLS_REMOTE_DESCRIPTORS = Object.freeze([
  descriptor('list', [], listResultCodec),
  descriptor('installTool', [toolIdParameter], installResultCodec),
  descriptor('cancel', [toolIdParameter], installResultCodec),
  descriptor('status', [toolIdParameter], statusResultCodec),
  // Workbench: onboarding health check, run ledger, ratings, step retry, security boundaries.
  descriptor('health', [jsonParameter('fresh', freshCodec)], anyObjectCodec('HealthReport')),
  descriptor('completeOnboarding', [], anyObjectCodec('OnboardingState')),
  descriptor('ledger', [], anyObjectCodec('RunLedger')),
  descriptor('rateResult', [jsonParameter('request', rateRequestCodec)], anyObjectCodec('RateResult')),
  descriptor('rerunStep', [jsonParameter('request', rerunRequestCodec)], anyObjectCodec('RerunResult')),
  descriptor('boundaries', [], anyObjectCodec('SecurityBoundaries')),
])

export const OFFICIAL_TOOLS_CLIENT_REMOTE = Object.freeze({
  package: OFFICIAL_TOOLS_REMOTE_PACKAGE,
  descriptors: OFFICIAL_TOOLS_REMOTE_DESCRIPTORS,
})

export const OFFICIAL_TOOLS_HOST_TYPERT = Object.freeze({
  package: OFFICIAL_TOOLS_REMOTE_PACKAGE,
  face: 'host',
  schemas: [],
  invocations: OFFICIAL_TOOLS_REMOTE_DESCRIPTORS,
  model: { services: [], events: [], objects: [] },
})
