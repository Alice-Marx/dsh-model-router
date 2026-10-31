import z from '@deepseek-ai/schemastery'

// Schemastery's object resolver preserves unlisted properties. Keep that
// behavior: an older DS profile may carry extension options that this outer
// adapter does not yet know. No defaults here may replace a saved DS value.
// Paths deliberately retain the frozen runtime's interpretation (including
// relative paths and literal ~); a migration tool needs the old launch cwd.
export const BotRuntimeConfig = z.object({
  home: z.string(),
  workspace: z.string(),
  mainName: z.string(),
  mainRole: z.string(),
  checkRatio: z.number(),
  memory: z.boolean(),
  memoryReview: z.boolean(),
  memoryReviewDelayMs: z.number(),
  browser: z.boolean(),
  browserHeadless: z.boolean(),
  browserPlugin: z.string(),
  playwrightUrl: z.string(),
  browserExecutablePath: z.string(),
  // These two may be host-supplied APIs/functions. Loader expression handling
  // remains owned by the SDK; this adapter never evaluates expression nodes.
  browserPluginApi: z.any(),
  browserComplete: z.any(),
  github: z.union([z.boolean(), z.object({})]),
  diagnosticsFile: z.union([z.boolean(), z.string()]),
  textOnlyModels: z.array(z.string()).default(undefined),
  ocrModel: z.string(),
  handoffListTokens: z.number(),
  handoffRecentTokens: z.number(),
  timeRefreshIntervalMs: z.number(),
  timeZone: z.string(),
  updateCheck: z.boolean(),
  updateRegistry: z.string(),
})

/** Validate without rewriting paths, dropping extensions, or starting work. */
export function normalizeBotRuntimeConfig(value) {
  return { ...BotRuntimeConfig(value), updateCheck: false }
}
