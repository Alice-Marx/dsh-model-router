import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'

export const name = 'workbench-offline-verification'
export const inject = ['llm']

const PROVIDER = 'verification-offline'
const MODEL = 'fixed-answer'

class WorkbenchOfflineAdapter extends LlmAdapter {
  providerInfo() { return { id: PROVIDER, name: 'Offline verification' } }
  async listModels() { return [{ provider: PROVIDER, id: MODEL, name: MODEL }] }
  async resolveModel(provider, model) {
    return { provider, id: model, name: model, context: { contextWindow: 8192 }, defaultMaxTokens: 128 }
  }
  async *stream() {
    await appendFile(join(process.env.DSH_HOME, 'offline-model-calls.jsonl'), JSON.stringify({ provider: PROVIDER, model: MODEL }) + '\n')
    await pause(1800)
    yield { type: 'text-delta', text: 'Offline verification answer.' }
    yield { type: 'usage', usage: { inputTokens: 18, outputTokens: 7, totalTokens: 25 } }
    yield { type: 'finish', reason: 'stop' }
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.llm.registerAdapter([PROVIDER], new WorkbenchOfflineAdapter()))
}
