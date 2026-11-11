import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { withProductIndependent } from '../helpers/product-independent-composition.mjs'
import { connect } from '../../.dsh-plugin/bot-product.mjs'

/** Actual installed nativeweb owner admission and actual product HTTP route.
 * Only browser authentication and provider transport are isolated test inputs.
 */
export async function withIndependentChatNative(run) {
  const root = new Context(); let connection, route
  const fork = await root.plugin(ctx => {
    connection = new HostConnectionService(ctx, ['127.0.0.1'], { isAuthenticated: request => request.headers.get('cookie') === 'independent-fixture-owner=isolated', authenticateApi: () => undefined })
  })
  try {
    return await withProductIndependent(async f => {
      assert.equal(typeof route?.fetch, 'function', 'the actual composition registered its product route')
      await f.bind('a', 'alpha', 'one'); await f.bind('b', 'beta', 'vendor/two')
      await f.runtime.move('a', 'independent'); await f.runtime.move('b', 'independent')
      // Exercise the actual shipping wrapper, not a hand-assembled test facade.
      const connected = connect(f.ctx, { independentRuntime: { enabled: true, dir: f.runtimeDir } }, {
        stateDir: f.runtimeDir, valueOf: (config, key, fallback) => config[key] ?? fallback,
      })
      assert.equal(typeof connected.botRuntime?.turn, 'function')
      assert.equal(typeof connected.botRuntime?.conversationPage, 'function')
      const fetchRoute = async (body, { authenticated = true, signal } = {}) => route.fetch(new Request('http://127.0.0.1/api/bot-product', {
        method: 'POST', headers: { host: '127.0.0.1', origin: 'http://127.0.0.1', 'content-type': 'application/json', ...(authenticated ? { cookie: 'independent-fixture-owner=isolated' } : {}) }, body: JSON.stringify(body), signal,
      }))
      const action = async (action, payload, options) => {
        const response = await fetchRoute({ action, payload }, options), value = await response.json()
        return { response, value }
      }
      return await run({ ...f, connection, route, fetchRoute, action })
    }, { nativeLlm: true, beforeBoot: ({ ctx }) => {
      ctx.connection.admit = request => connection.admit(request)
      const register = ctx.connection.fetch.register
      ctx.connection.fetch.register = options => { if (options.path === '/api/bot-product') route = options; return register(options) }
    } })
  } finally { await fork.dispose() }
}
