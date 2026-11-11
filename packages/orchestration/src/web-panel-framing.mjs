// Whether a pinned page lets this app frame it, decided the way a browser
// decides: HTML's X-Frame-Options processing and CSP Level 3's frame-ancestors.
// Ported from the upstream product (OpenMausBot server/web-panel-framing.ts,
// pinned 1bc4749aa8307d7d6998bf86de4ef6478460dd93) so a refusal reads the same
// here as it does there.
//
// Chrome fires `load` on a frame it refused, and the parent page cannot tell
// that frame from a working cross-origin one, so only the page's own headers say
// why a pinned panel stays blank.
//
// Three deliberate differences from the upstream probe, all of them about scope
// rather than verdict:
//
// 1. Loopback and private addresses are allowed. A pinned panel is very often the
//    owner's own localhost dashboard, so the upstream "never from this computer
//    or a private network" rule would refuse the product's most common page. The
//    URL still comes only from an owner's explicit pin.
// 2. The request carries no credentials of any kind: no cookie jar, no
//    Authorization header, nothing from this Host's configuration. A redirect or
//    an error answer may therefore be a sign-in page the owner's browser never
//    gets, which is why those read as `unknown` rather than `blocked`.
// 3. The answer is a verdict, never a page. No body is returned to a client and
//    no HTML is executed on the Host, so a site cannot use the probe as an open
//    proxy or as a way to run its markup here.
//
// `embeddingOrigin` is supplied by the Host channel from the real client origin
// (the native shell's `dsh-app://app`, or the browser origin). It is used only to
// evaluate frame-ancestors; it grants nothing.

import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'

/** `unknown` whenever this cannot be sure. */
export const FRAMING = Object.freeze(['allowed', 'blocked', 'unknown'])

/** A closed vocabulary: the panel shows one of these, never a server's own words. */
export const PROBE_REASONS = Object.freeze([
  'invalid-url', 'unsupported-scheme', 'credentials-in-url', 'redirect', 'bad-status',
  'unreachable', 'timeout', 'response-limit', 'aborted',
])

export const PROBE_TIMEOUT_MS = 8_000
// Framing is decided by headers. One byte of body is enough to learn that a body
// exists; the rest is never downloaded, so a hostile page cannot make the Host
// pull megabytes to answer a yes/no question.
export const PROBE_MAX_BYTES = 1
// A redirect is not followed: it may lead to a sign-in page the owner's browser
// never gets, and following it would turn the probe into a crawler.
export const PROBE_MAX_REDIRECTS = 0

const SCHEME_SOURCE = /^[a-z][a-z0-9+.-]*:$/
const HOST_SOURCE = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d+|\*))?(\/[^?#]*)?$/

function headerItems(value) {
  return (value === undefined ? [] : [value].flat()).flatMap(item => item.split(','))
}

/** An app on https may sit in a frame that only names http, as CSP lets a scheme upgrade. */
function schemeMatches(scheme, app) {
  return scheme === app.protocol || (scheme === 'http:' && app.protocol === 'https:')
}

function hostMatches(host, app) {
  if (host === '*') return true
  if (host.startsWith('*.')) return app.hostname.endsWith(host.slice(1))
  return app.hostname === host
}

function sourceMatches(token, page, app) {
  const source = token.toLowerCase()
  if (source === '*') return true
  if (source === "'self'") return app.origin === page.origin
  if (source.startsWith("'")) return false
  if (SCHEME_SOURCE.test(source)) return schemeMatches(source, app)
  const parts = HOST_SOURCE.exec(source)
  if (!parts) return null
  const [, scheme, host, port, path] = parts
  if (!schemeMatches(scheme ? `${scheme}:` : page.protocol, app)) return false
  if (!hostMatches(host, app)) return false
  const defaultPort = app.protocol === 'https:' ? '443' : '80'
  const appPort = app.port || defaultPort
  if (port === '80' && appPort === '443') return null
  if (port !== '*' && (port ?? defaultPort) !== appPort) return false
  return path === undefined || path === '/' ? true : null
}

function ancestorsAllow(sources, page, app) {
  let unsure = false
  for (const source of sources) {
    const matches = sourceMatches(source, page, app)
    if (matches) return true
    if (matches === null) unsure = true
  }
  return unsure ? null : false
}

/** The source list of each enforced policy's first frame-ancestors directive. */
function frameAncestorLists(value) {
  const lists = []
  for (const policy of headerItems(value)) {
    const directive = policy.split(';').map(part => part.trim().split(/\s+/)).find(([name]) => name.toLowerCase() === 'frame-ancestors')
    if (directive) lists.push(directive.slice(1))
  }
  return lists
}

function xFrameOptionsAllow(value, page, app) {
  const options = new Set(headerItems(value).map(item => item.trim().toLowerCase()))
  if (options.size > 1) return !['deny', 'allowall', 'sameorigin'].some(option => options.has(option))
  if (options.has('deny')) return false
  return !options.has('sameorigin') || page.origin === app.origin
}

export function framingOf(headers, pageUrl, embeddingOrigin) {
  let page, app
  try {
    page = new URL(pageUrl)
    app = new URL(embeddingOrigin)
  } catch {
    return 'unknown'
  }
  const lists = frameAncestorLists(headers['content-security-policy'])
  if (lists.length === 0) return xFrameOptionsAllow(headers['x-frame-options'], page, app) ? 'allowed' : 'blocked'
  let unsure = false
  for (const sources of lists) {
    const allows = ancestorsAllow(sources, page, app)
    if (allows === false) return 'blocked'
    if (allows === null) unsure = true
  }
  return unsure ? 'unknown' : 'allowed'
}

/** The verdict for a page, or the reason it cannot be reached. Never a message, never a path. */
export function framingResult(framing, reason = null, host = '') {
  return Object.freeze({ framing: FRAMING.includes(framing) ? framing : 'unknown', reason: reason ?? null, host })
}

function requestOnce(url, address, signal, maxBytes) {
  return new Promise((resolve, reject) => {
    const pinned = (_host, options, callback) => {
      if (options.all) callback(null, [address])
      else callback(null, address.address, address.family)
    }
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = send(url, {
      agent: false, signal, lookup: pinned,
      // Nothing that identifies this Host: no cookie, no authorization, no
      // referer. A page that behaves differently for a signed-in browser is
      // exactly the case this probe must not speak for.
      headers: { 'user-agent': 'dsh-model-router-web-panel-probe', accept: 'text/html,text/plain;q=0.9,*/*;q=0.1' },
    }, response => {
      const status = response.statusCode ?? 0
      const { headers } = response
      if (status < 200 || status >= 300) {
        response.destroy()
        resolve({ status, location: headers.location, headers })
        return
      }
      let size = 0
      response.on('data', chunk => {
        size += chunk.length
        if (size >= maxBytes) { response.destroy(); resolve({ status, headers, truncated: true }) }
      })
      response.on('end', () => resolve({ status, headers, truncated: false }))
      response.on('error', () => resolve({ status, headers, truncated: true }))
    })
    req.on('error', reject)
    req.end()
  })
}

async function addressesFor(host, lookup) {
  const literal = isIP(host)
  if (literal) return [{ address: host, family: literal }]
  const found = typeof lookup === 'function' ? await lookup(host) : await dnsLookup(host, { all: true })
  return Array.isArray(found) ? found.filter(entry => entry && typeof entry.address === 'string') : []
}

function abortableLookup(host, lookup, signal) {
  return new Promise((resolve, reject) => {
    const done = (settle, value) => { signal.removeEventListener('abort', abort); settle(value) }
    const abort = () => done(reject, signal.reason)
    if (signal.aborted) { reject(signal.reason); return }
    signal.addEventListener('abort', abort, { once: true })
    addressesFor(host, lookup).then(value => done(resolve, value), error => done(reject, error))
  })
}

/**
 * Read one page's headers and decide. `options.lookup` exists so a test can point
 * a name at loopback without touching the machine's resolver.
 */
export async function checkFraming(rawUrl, embeddingOrigin, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : PROBE_TIMEOUT_MS
  const maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : PROBE_MAX_BYTES
  const maxRedirects = Number.isSafeInteger(options.maxRedirects) && options.maxRedirects >= 0 ? options.maxRedirects : PROBE_MAX_REDIRECTS
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])])
  let url
  try { url = new URL(rawUrl) } catch { return framingResult('unknown', 'invalid-url') }
  const host = url.host
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return framingResult('unknown', 'unsupported-scheme', host)
  if (url.username || url.password) return framingResult('unknown', 'credentials-in-url', host)
  try {
    for (let hop = 0; ; hop++) {
      signal.throwIfAborted()
      const bare = url.hostname.replace(/^\[|\]$/g, '')
      const addresses = await abortableLookup(bare, options.lookup, signal)
      signal.throwIfAborted()
      if (!addresses.length) return framingResult('unknown', 'unreachable', url.host)
      const answer = await requestOnce(url, addresses[0], signal, maxBytes)
      if (answer.status >= 300 && answer.status < 400) {
        if (!answer.location || hop >= maxRedirects) return framingResult('unknown', 'redirect', url.host)
        url = new URL(answer.location, url)
        continue
      }
      if (answer.status < 200 || answer.status >= 300) return framingResult('unknown', 'bad-status', url.host)
      return framingResult(framingOf(answer.headers, url.href, embeddingOrigin), null, url.host)
    }
  } catch {
    // A cancelled probe is the caller's own business; a deadline is the page's.
    if (options.signal?.aborted) return framingResult('unknown', 'aborted', url.host)
    if (signal.aborted) return framingResult('unknown', 'timeout', url.host)
    return framingResult('unknown', 'unreachable', url.host)
  }
}
