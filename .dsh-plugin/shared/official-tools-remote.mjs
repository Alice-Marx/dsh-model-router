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
export const OFFICIAL_TOOLS_REMOTE_DESCRIPTORS = Object.freeze([
  descriptor('list', [], listResultCodec),
  descriptor('installTool', [toolIdParameter], installResultCodec),
  descriptor('cancel', [toolIdParameter], installResultCodec),
  descriptor('status', [toolIdParameter], statusResultCodec),
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
