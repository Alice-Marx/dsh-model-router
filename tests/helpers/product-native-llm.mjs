import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime, LlmAdapter } from '@deepseek-ai/dsh-llm'

/**
 * What the offline adapter declares about each exact route, as the pinned
 * adapter would. The admission prices a request against these numbers, so they
 * have to be real metadata and not an empty stub: `alpha/one` and
 * `beta/vendor/two` each declare a window the fixture grant covers, and each
 * declares the per-request output cap the SDK materializes into a request that
 * carries none. `tests/helpers/product-independent-composition.mjs` attests the
 * same values for the non-native stub, so both transports answer alike.
 */
export const OFFLINE_MODEL_BOUNDS = Object.freeze({
  one: Object.freeze({ contextWindow: 4096, defaultMaxTokens: 64 }),
  'vendor/two': Object.freeze({ contextWindow: 2048, defaultMaxTokens: 32 }),
})

/** Detached exact-route metadata for the offline transport. */
export function offlineModelInfo(provider, model) {
  const bounds = OFFLINE_MODEL_BOUNDS[model]
  return { provider, id: model, name: model, ...(bounds ? { context: { contextWindow: bounds.contextWindow }, defaultMaxTokens: bounds.defaultMaxTokens } : {}) }
}

/** Real installed SDK and Cordis waterfall; only the provider transport is offline. */
export async function attachNativeLlm(host) {
  const root = new Context()
  let service, scope, releaseAdapter
  class OfflineAdapter extends LlmAdapter {
    async listModels(provider) {
      const id = provider === 'alpha' ? 'one' : 'vendor/two'
      return [{ provider, id, name: id }]
    }
    async resolveModel(provider, model) { return offlineModelInfo(provider, model) }
    async *stream(options) {
      await host.state.beforeRequest?.(options)
      host.upstream.push(structuredClone({ provider: options.provider, model: options.model, messages: options.messages, tools: options.tools }))
      for (const chunk of host.state.chunks) yield chunk
    }
  }
  const fork = await root.plugin(ctx => {
    scope = ctx
    service = new LlmRuntime(ctx)
    releaseAdapter = service.registerAdapter(['alpha', 'beta'], new OfflineAdapter())
  })
  host.llm = service
  // A true AgentLoop integration test mounts its public services on this same
  // Cordis fiber and SDK instance; copying a loop marker is not that proof.
  host.nativeLlmContext = scope
  host.replaceOfflineLlmAdapter = adapter => {
    releaseAdapter?.()
    releaseAdapter = service.registerAdapter(['alpha', 'beta'], adapter)
  }
  host.on = (name, listener) => scope.on(name, listener)
  host.off = (name, listener) => scope.off(name, listener)
  host.emit = (name, value) => scope.emit(name, value)
  return () => fork.dispose()
}
