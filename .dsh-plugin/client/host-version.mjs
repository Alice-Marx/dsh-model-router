/**
 * Detect a Host that still runs older plugin code than this client.
 *
 * Harness serves the new client.js right after an update, but a running Host
 * keeps the plugin modules it already imported until Harness fully restarts.
 * New remote methods then fail with HTTP 404 because the Host never
 * registered their descriptors.
 */
/* global __ROUTER_CLIENT_VERSION__ */
export const ROUTER_CLIENT_VERSION = typeof __ROUTER_CLIENT_VERSION__ === 'string' ? __ROUTER_CLIENT_VERSION__ : ''

export const STALE_HOST_MESSAGE = '插件后台版本较旧，请完全退出并重启 Harness（包括托盘图标）后再使用。'

/** Gateway answers for a method the running Host never registered. */
export function isMissingRemoteMethod(message) {
  const value = String(message ?? '')
  return /transport failure for [^:]+: HTTP 404\b/.test(value) || /Remote method \S+ is no longer mounted/.test(value)
}

/** Replace a missing-method error by the restart advice. */
export function remoteErrorText(message, fallback = '') {
  if (isMissingRemoteMethod(message)) return STALE_HOST_MESSAGE
  return String(message ?? '').trim() || fallback
}

/**
 * Compare the Host's reported version (from `list()`, 0.14.0-beta.2+) with
 * this client. A Host older than 0.14.0-beta.2 reports none.
 */
export function staleHostNotice({ hostVersion, clientVersion = ROUTER_CLIENT_VERSION, loaded = true } = {}) {
  if (!loaded || !clientVersion) return ''
  if (typeof hostVersion !== 'string' || !hostVersion) return `${STALE_HOST_MESSAGE}（界面为 ${clientVersion}，后台为更早版本）`
  if (hostVersion !== clientVersion) return `${STALE_HOST_MESSAGE}（界面为 ${clientVersion}，后台为 ${hostVersion}）`
  return ''
}
