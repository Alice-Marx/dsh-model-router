import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { checkFraming, framingOf } from '../packages/orchestration/src/web-panel-framing.mjs'

const APP = 'http://127.0.0.1:8799'
const PAGE = 'https://www.globo.com/'

test('framingOf follows X-Frame-Options the way browsers do', () => {
  assert.equal(framingOf({}, PAGE, APP), 'allowed')
  assert.equal(framingOf({ 'x-frame-options': 'DENY' }, PAGE, APP), 'blocked')
  assert.equal(framingOf({ 'x-frame-options': ' sameorigin ' }, PAGE, APP), 'blocked')
  assert.equal(framingOf({ 'x-frame-options': 'SAMEORIGIN' }, 'http://127.0.0.1:8799/x', APP), 'allowed')
  assert.equal(framingOf({ 'x-frame-options': 'ALLOWALL' }, PAGE, APP), 'allowed')
  assert.equal(framingOf({ 'x-frame-options': 'ALLOW-FROM https://a.example' }, PAGE, APP), 'allowed')
  assert.equal(framingOf({ 'x-frame-options': 'DENY, SAMEORIGIN' }, PAGE, APP), 'blocked')
  assert.equal(framingOf({ 'x-frame-options': 'nonsense, other' }, PAGE, APP), 'allowed')
})

test('framingOf reads a CSP frame-ancestors list source by source', () => {
  const csp = "frame-ancestors 'self' https://*.globo.com https://*.globoi.com https://*.i.globo https://*.techtudo.com.br always"
  assert.equal(framingOf({ 'content-security-policy': csp }, PAGE, APP), 'blocked')
  const verdict = (sources, app = APP) => framingOf({ 'content-security-policy': `default-src 'self'; frame-ancestors ${sources}` }, PAGE, app)
  assert.equal(verdict("'none'"), 'blocked')
  assert.equal(verdict("'self'"), 'blocked')
  assert.equal(verdict('*'), 'allowed')
  assert.equal(verdict('http:'), 'allowed')
  assert.equal(verdict('https:'), 'blocked')
  assert.equal(verdict('http:', 'https://omb.example.com'), 'allowed')
  assert.equal(verdict('http://127.0.0.1:8799'), 'allowed')
  assert.equal(verdict('http://127.0.0.1:*'), 'allowed')
  assert.equal(verdict('http://127.0.0.1'), 'blocked')
  assert.equal(verdict('127.0.0.1:8799'), 'blocked')
  assert.equal(verdict('omb.example.com', 'https://omb.example.com'), 'allowed')
  assert.equal(verdict('*.example.com', 'https://omb.example.com'), 'allowed')
  assert.equal(verdict('*.example.com', 'https://example.com'), 'blocked')
  assert.equal(verdict('https://OMB.example.com/', 'https://omb.example.com'), 'allowed')
  assert.equal(verdict('https://omb.example.com:443', 'https://omb.example.com'), 'allowed')
  assert.equal(verdict('http://omb.example.com:80', 'https://omb.example.com'), 'unknown')
  assert.equal(framingOf({ 'content-security-policy': 'frame-ancestors; default-src *' }, PAGE, APP), 'blocked')
  assert.equal(verdict("'nonce-abc' 'unsafe-inline'"), 'blocked')
})

test('framingOf says unknown rather than blocked when a source cannot be read', () => {
  const verdict = sources => framingOf({ 'content-security-policy': `frame-ancestors ${sources}` }, PAGE, APP)
  assert.equal(verdict('http://127.0.0.1:8799/only/this'), 'unknown')
  assert.equal(verdict('https://a.example/only/this'), 'blocked')
  assert.equal(verdict('https://a.example %%'), 'unknown')
})

test('a policy that refuses wins, and a report-only policy is not enforced', () => {
  assert.equal(framingOf({ 'x-frame-options': 'DENY', 'content-security-policy': 'frame-ancestors *' }, PAGE, APP), 'allowed')
  assert.equal(framingOf({ 'content-security-policy': "frame-ancestors *, frame-ancestors 'none'" }, PAGE, APP), 'blocked')
  assert.equal(framingOf({ 'content-security-policy-report-only': "frame-ancestors 'none'" }, PAGE, APP), 'allowed')
})

test('the native shell origin is opaque, so no http page can claim it', () => {
  // `dsh-app://app` has an opaque origin, exactly as the browser sees it: a
  // frame-ancestors of 'self' can never match it, and a page that names nothing
  // still refuses nothing.
  assert.equal(framingOf({ 'content-security-policy': "frame-ancestors 'self'" }, 'http://127.0.0.1:7841/', 'dsh-app://app'), 'blocked')
  assert.equal(framingOf({}, 'http://127.0.0.1:7841/', 'dsh-app://app'), 'allowed')
  assert.equal(framingOf({}, 'http://127.0.0.1:7841/', 'not an origin'), 'unknown')
})

test('checkFraming reads the page itself over a real socket', async t => {
  const server = createServer((req, res) => {
    if (req.url === '/deny') res.writeHead(200, { 'x-frame-options': 'DENY' }).end('no')
    else if (req.url === '/sameorigin') res.writeHead(200, { 'x-frame-options': 'SAMEORIGIN' }).end('ok')
    else if (req.url === '/hop') res.writeHead(302, { location: '/deny' }).end()
    else if (req.url === '/csp') res.writeHead(200, { 'content-security-policy': 'frame-ancestors http://127.0.0.1:*' }).end('ok')
    else if (req.url === '/huge') { res.writeHead(200); res.end('x'.repeat(4 * 1024 * 1024)) }
    else if (req.url === '/slow') { setTimeout(() => res.writeHead(200).end('late'), 4000) }
    else if (req.url === '/ok') res.writeHead(200).end('yes')
    else res.writeHead(404).end()
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => { server.closeAllConnections(); server.close() })
  const port = server.address().port
  const at = path => `http://127.0.0.1:${port}${path}`
  assert.deepEqual(await checkFraming(at('/deny'), APP), { framing: 'blocked', reason: null, host: `127.0.0.1:${port}` })
  assert.deepEqual(await checkFraming(at('/sameorigin'), APP), { framing: 'blocked', reason: null, host: `127.0.0.1:${port}` })
  assert.deepEqual(await checkFraming(at('/sameorigin'), `http://127.0.0.1:${port}`), { framing: 'allowed', reason: null, host: `127.0.0.1:${port}` })
  assert.deepEqual(await checkFraming(at('/csp'), APP), { framing: 'allowed', reason: null, host: `127.0.0.1:${port}` })
  assert.deepEqual(await checkFraming(at('/ok'), APP), { framing: 'allowed', reason: null, host: `127.0.0.1:${port}` })
  // A redirect may lead to a sign-in page the owner's browser never gets.
  assert.deepEqual(await checkFraming(at('/hop'), APP), { framing: 'unknown', reason: 'redirect', host: `127.0.0.1:${port}` })
  assert.deepEqual(await checkFraming(at('/missing'), APP), { framing: 'unknown', reason: 'bad-status', host: `127.0.0.1:${port}` })
  // A large body is never downloaded: only the headers decide, and the answer is immediate.
  const huge = await checkFraming(at('/huge'), APP)
  assert.deepEqual(huge, { framing: 'allowed', reason: null, host: `127.0.0.1:${port}` })
})

test('a probe carries no credentials and never a Host header of its own', async t => {
  const seen = []
  const server = createServer((req, res) => {
    seen.push({ ...req.headers })
    res.writeHead(200).end('ok')
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => { server.closeAllConnections(); server.close() })
  const port = server.address().port
  await checkFraming(`http://127.0.0.1:${port}/panel?token=secret`, APP)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].cookie, undefined)
  assert.equal(seen[0].authorization, undefined)
  assert.equal(seen[0].referer, undefined)
  assert.equal(seen[0].origin, undefined)
})

test('a slow page, an unreachable page and a cancelled probe each say so', async t => {
  const server = createServer((req, res) => { if (req.url === '/slow') setTimeout(() => res.writeHead(200).end('late'), 4000); else res.writeHead(200).end('ok') })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => { server.closeAllConnections(); server.close() })
  const port = server.address().port
  const started = Date.now()
  assert.equal((await checkFraming(`http://127.0.0.1:${port}/slow`, APP, { timeoutMs: 250 })).reason, 'timeout')
  assert.ok(Date.now() - started < 3000, 'a deadline must not wait for the page')
  const controller = new AbortController()
  const pending = checkFraming(`http://127.0.0.1:${port}/slow`, APP, { timeoutMs: 4000, signal: controller.signal })
  setTimeout(() => controller.abort(), 30)
  assert.equal((await pending).reason, 'aborted')
  // Nothing is listening here, and a name that resolves nowhere is the same answer.
  assert.equal((await checkFraming('http://127.0.0.1:1/panel', APP, { timeoutMs: 1000 })).reason, 'unreachable')
  assert.equal((await checkFraming('http://panel.invalid/panel', APP, { lookup: async () => [] })).reason, 'unreachable')
})

test('an address that is not a plain web page is refused before any socket opens', async () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,<b>hi</b>', 'file:///etc/hosts', 'not a url']) {
    assert.equal((await checkFraming(url, APP)).reason, url === 'not a url' ? 'invalid-url' : 'unsupported-scheme', url)
  }
  assert.equal((await checkFraming('https://user:secret@example.com/', APP)).reason, 'credentials-in-url')
})

test('DNS resolution obeys the probe deadline and cancellation without opening a late socket', async t => {
  let sockets = 0, finish
  const server = createServer((req, res) => { sockets++; res.end('ok') })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => { server.closeAllConnections(); server.close() })
  const lookup = () => new Promise(done => { finish = done })
  const url = `http://slow-dns.invalid:${server.address().port}/`
  const started = Date.now()
  const timeout = await checkFraming(url, APP, { timeoutMs: 40, lookup })
  assert.equal(timeout.reason, 'timeout')
  assert.ok(Date.now() - started < 1500)
  finish([{ address: '127.0.0.1', family: 4 }])
  const controller = new AbortController()
  const pending = checkFraming(url, APP, { timeoutMs: 4000, signal: controller.signal, lookup })
  controller.abort()
  assert.equal((await pending).reason, 'aborted')
  finish([{ address: '127.0.0.1', family: 4 }])
  await new Promise(done => setTimeout(done, 20))
  assert.equal(sockets, 0, 'a resolver answering after cancellation cannot dispatch the request')
})
