// Closed catalog of the 26 upstream OpenMausBot built-in Bot engine drivers.
//
// Upstream source: OpenMausBot at pin 1bc4749aa8307d7d6998bf86de4ef6478460dd93
// (Apache-2.0), server/drivers/builtIn.ts BUILT_IN_DRIVERS. Every entry records the
// upstream file it was verified against. This catalog is closed: exactly these 26 ids
// exist, no unknown id resolves, and no arbitrary executable/endpoint/command can be
// registered as a driver. The 13 CLIs in .dsh-plugin/shared/official-tool-registry.mjs
// are one-shot official tools, a different and smaller set; they are NOT drivers and are
// deliberately not conflated with this list.

export const UPSTREAM_SOURCE = Object.freeze({
  project: 'OpenMausBot',
  pin: '1bc4749aa8307d7d6998bf86de4ef6478460dd93',
  license: 'Apache-2.0',
  driversRoot: 'server/drivers',
  builtInList: 'server/drivers/builtIn.ts (BUILT_IN_DRIVERS)',
})

const unavailable = (reason, target) => ({ availability: 'unavailable', availabilityReason: reason, targetCapability: target })

const api = (id, name, evidence, extra = {}) => ({
  id, name, kind: 'api-provider', transport: 'https-openai-chat-completions',
  multipleInstances: true,
  evidence,
  ...unavailable(
    'API provider channel, not a conversation engine: stateless OpenAI chat-completions HTTP calls with no retained session process, no native tools and no permission broker. It belongs to the Host model-routing channel, not to packages/bot-engines.',
    'api-provider-channel'),
  ...extra,
})

const acpPending = (id, name, evidence, extra = {}) => ({
  id, name, kind: 'conversation-engine',
  evidence,
  ...unavailable(
    'CLI conversation engine whose upstream adapter runs it over ACP (Agent Client Protocol) stdio. Porting it requires the upstream acp/core.ts session/state machine first; it is deliberately not faked by spawning the CLI ad hoc.',
    'pending-acp-core'),
  ...extra,
})

export const BOT_ENGINE_DRIVERS = Object.freeze([
  // ---- API providers (8) — createOpenAIChatRuntime, one request per call, no session ----
  Object.freeze(api('grok', 'Grok (API)', Object.freeze({
    file: 'server/drivers/grok.ts', anchor: 'L33-45',
    modelSelection: 'Static catalog, default grok-4.7 (grok-4.7/grok-4/grok-4-fast/grok-3-mini)',
    credentials: 'Per-instance apiKeyEnv, default XAI_API_KEY; default URL https://api.x.ai/v1',
    session: 'None: one chat-completions request per model call',
    permissions: 'None: no local tools, no permission flow',
    usage: 'Usage reported by the xAI chat-completions response',
  }))),
  Object.freeze(api('groq', 'Groq (API)', Object.freeze({
    file: 'server/drivers/groq.ts', anchor: 'L41-95',
    modelSelection: 'Static default catalog refreshed from GET /models with the API key (8s timeout)',
    credentials: 'GROQ_API_KEY (instance env, or process env when URL is the default)',
    session: 'None: stateless chat-completions calls',
    permissions: 'None',
    usage: 'Provider-reported usage; includeUsageInCompleted; billing metered',
  }))),
  Object.freeze(api('mistral', 'Mistral (API)', Object.freeze({
    file: 'server/drivers/mistral.ts', anchor: 'L48-60',
    modelSelection: 'Static catalog with configured-model override',
    credentials: 'MISTRAL_API_KEY (instance env first, then process env)',
    session: 'None',
    permissions: 'None',
    usage: 'Provider-reported usage',
  }))),
  Object.freeze(api('cerebras', 'Cerebras (API)', Object.freeze({
    file: 'server/drivers/cerebras.ts', anchor: 'L39-51',
    modelSelection: 'Static catalog with configured-model override',
    credentials: 'CEREBRAS_API_KEY (instance env first, then process env)',
    session: 'None',
    permissions: 'None',
    usage: 'Provider-reported usage',
  }))),
  Object.freeze(api('greenference', 'Greenference (API)', Object.freeze({
    file: 'server/drivers/greenference.ts', anchor: 'L57-71',
    modelSelection: 'Static catalog with configured-model override',
    credentials: 'GREENFERENCE_API_KEY (instance env; process env only on the default URL)',
    session: 'None',
    permissions: 'None',
    usage: 'Provider-reported usage',
  }))),
  Object.freeze(api('meta', 'Meta Muse (API)', Object.freeze({
    file: 'server/drivers/meta.ts', anchor: 'L54-68',
    modelSelection: 'Static catalog with configured-model override',
    credentials: 'META_API_KEY (instance env; process env only on the default URL)',
    session: 'None',
    permissions: 'None',
    usage: 'Provider-reported usage',
  }))),
  Object.freeze(api('minimax', 'MiniMax (API)', Object.freeze({
    file: 'server/drivers/minimax.ts', anchor: 'L11,L71-86',
    modelSelection: 'Static catalog; URL from config or MINIMAX_BASE_URL',
    credentials: 'MINIMAX_API_KEY (API key env); local mmx-cli profile via "mmx auth login --api-key" also supported upstream',
    session: 'None',
    permissions: 'None',
    usage: 'Provider-reported usage',
  }), { access: 'custom' })),
  Object.freeze(api('openai-compat', 'Other (OpenAI-compatible)', Object.freeze({
    file: 'server/drivers/openai-compat.ts', anchor: 'L43-184',
    modelSelection: 'Caller-configured model id on any OpenAI-compatible endpoint (default OpenRouter)',
    credentials: 'Configurable apiKeyEnv (OMB_OPENAI_API_KEY / OMB_OPENROUTER_API_KEY are first-class), else the endpoint key is added to the instance config',
    session: 'None',
    permissions: 'None',
    usage: 'Provider-reported usage',
  }), { access: 'api' })),

  // ---- Conversation engines (18) ----
  Object.freeze({
    id: 'claude', name: 'Claude', kind: 'conversation-engine',
    transport: 'cli-stream-json-stdio (retained process; -p --output-format stream-json --input-format stream-json --verbose --include-partial-messages)',
    multipleInstances: true,
    evidence: Object.freeze({
      file: 'server/drivers/claude.ts', anchor: 'L758-771,L1006-1013',
      modelSelection: '--model <slug> on argv; static catalog plus endpoint/org extras upstream',
      credentials: 'Subscription OAuth under an isolated CLAUDE_CONFIG_DIR, or ANTHROPIC_API_KEY for managed/endpoint accounts; parent account env keys are stripped',
      session: 'One retained CLI process per thread; init frame confirms session_id; later turns are new stdin user messages; relaunch uses --resume <session_id>; a steered continuation can chain several native result frames into one logical turn',
      permissions: '--permission-mode default|acceptEdits|auto|bypassPermissions; permission/question asks arrive through an MCP permission-prompt tool backed by a local ask/answer broker socket; duplicate ask ids and post-close asks fail closed',
      usage: 'result.usage is per-turn in streaming-input sessions; total_cost_usd is the process running total, so a turn cost is the growth since the previous result; missing values stay unknown',
    }),
    availability: 'implemented',
    availabilityReason: null,
    targetCapability: 'claude-engine',
    implementation: 'src/claude-engine.mjs',
  }),
  Object.freeze({
    id: 'codex', name: 'Codex', kind: 'conversation-engine',
    transport: 'cli-app-server-ndjson (codex app-server JSON-RPC over stdio)',
    multipleInstances: true,
    evidence: Object.freeze({
      file: 'server/drivers/codex.ts', anchor: 'L8-9,L579',
      modelSelection: 'Model selected on thread/start and switchable per turn upstream',
      credentials: 'ChatGPT plan login or OpenAI API key per instance',
      session: 'Threads resume by codex thread id (thread/resume); completion is turn/completed; approvals arrive as server-to-client requests',
      permissions: 'Upstream maps approval modes onto codex approval policy per thread',
      usage: 'Token usage is reported as a running total for the app-server process',
    }),
    ...unavailable('Not yet ported as a Bot conversation engine. The target already runs codex as one-shot task execution (packages/cli-runtime/src/codex-session-core.mjs); lifting it into a retained multi-turn Bot engine is a separate port with its own tests.', 'pending-engine-port'),
  }),
  Object.freeze({
    id: 'museCode', name: 'Muse Code', kind: 'conversation-engine',
    transport: 'msdp-stdio (Muse Session Protocol over "muse serve" stdio)',
    multipleInstances: true, access: 'subscription',
    evidence: Object.freeze({
      file: 'server/drivers/muse-code.ts', anchor: 'L250-262,L444-462',
      modelSelection: 'model/list from the signed-in account; static fallback (muse-wonder-1.0, muse-spark-1.3/1.2); session/set_model',
      credentials: '"muse login" under the instance HOME, or META_API_KEY for that instance',
      session: 'session/start confirms sessionId; session/resume (sessionNotFound falls back to a fresh session); hosts are keyed by cwd/approval/MCP posture',
      permissions: 'approval/requested with availableChoices (approved once / approvedForSession / denied); full-auto maps to allowAll',
      usage: 'session/tokenUsage and turn/completed usage (inputTokens/outputTokens/cachedTokens); no dollar figure',
    }),
    ...unavailable('Requires the Muse Session Protocol host port (upstream drives it through @muse-code/sdk Connection over a supervised stdio transport). Not faked.', 'pending-engine-port'),
  }),
  Object.freeze({
    id: 'pi', name: 'pi', kind: 'conversation-engine',
    transport: 'cli-jsonrpc-stdio (pi --mode rpc --no-session)',
    multipleInstances: true, access: 'custom',
    evidence: Object.freeze({
      file: 'server/drivers/pi.ts', anchor: 'L4-5,L57,L363-364',
      modelSelection: 'BYOK: pi reads ~/.pi/agent/auth.json itself; the driver holds no key',
      credentials: 'None held by the host; pi manages its own auth',
      session: 'resumeCursor is pi sessionFile (switch_session); --no-session accepts a prompt without a session',
      permissions: 'pi asks through its own RPC requests',
      usage: 'Reported by pi per turn',
    }),
    ...unavailable('Not yet ported: the upstream driver drives pi over "pi --mode rpc --no-session" JSON-RPC stdio (BYOK auth under ~/.pi), which needs its own RPC adapter, session-file cursors and request broker before it can be a Bot engine. Not faked.', 'pending-engine-port'),
  }),
  Object.freeze({
    id: 'antigravityAgent', name: 'Google Gemini (Antigravity)', kind: 'conversation-engine',
    transport: 'acp-stdio via managed runtime (resolveAntigravityRuntime executable, isolated Google profile)',
    multipleInstances: true,
    evidence: Object.freeze({
      file: 'server/drivers/antigravity.ts', anchor: 'L31-88',
      modelSelection: 'Static gemini-3.8-flash with low/medium/high variants; AGY_ACP_DEFAULT_MODEL seeds new sessions',
      credentials: 'Google account OAuth into an isolated profile (prepareAntigravityProfile)',
      session: 'ACP resume method "resume"; session-scoped approval',
      permissions: 'yolo / auto_edit / default session modes',
      usage: 'ACP session reports',
    }),
    ...unavailable('Requires the ACP core port plus the managed Antigravity runtime resolver.', 'pending-acp-core'),
  }),
  Object.freeze(acpPending('grokAgent', 'Grok', Object.freeze({
    file: 'server/drivers/acp/grok.ts', anchor: 'L368-395',
    modelSelection: 'Static grok-4.7/4.6/4.5 plus local slugs from ~/.grok/config.toml; session/set_model (never on narrowed tool scope)',
    credentials: 'grok.com subscription login at ~/.grok/auth.json via grok login --device-auth; XAI_API_KEY is deleted from the child env because a leaked key silently flips billing to pay-as-you-go',
    session: 'One ACP session per conversation; -m must sit between "agent" and "stdio"',
    permissions: '--permission-mode default|auto|acceptEdits|bypassPermissions before "agent"; verified native tool selection only on grok 1.0.41 agent profiles',
    usage: 'ACP token usage reports',
  }), { transport: 'acp-stdio (grok --permission-mode … agent [-m slug] [--reasoning-effort lvl] stdio)' })),
  Object.freeze(acpPending('geminiAgent', 'Gemini', Object.freeze({
    file: 'server/drivers/acp/gemini.ts', anchor: 'L1-5,L51-88',
    modelSelection: 'gemini-2.5-pro / gemini-2.5-flash, -m on spawn',
    credentials: 'GEMINI_API_KEY / GOOGLE_API_KEY, Vertex, or an enterprise Code Assist licence; consumer Google logins stopped working 2026-06-18 (route those accounts through antigravityAgent)',
    session: 'ACP session lifecycle',
    permissions: '--yolo (full) / --approval-mode auto_edit (edits) / ask otherwise',
    usage: 'ACP session reports',
  }), { transport: 'acp-stdio (gemini --acp)', access: 'api' })),
  Object.freeze(acpPending('kimiAgent', 'Kimi', Object.freeze({
    file: 'server/drivers/acp/kimi.ts', anchor: 'L521-566',
    modelSelection: 'CLI catalog aliases from ~/.kimi-code/config.toml (kimi provider list reports the same four); -m is global and precedes "acp"',
    credentials: 'Kimi Code account login via device sign-in; MOONSHOT_API_KEY/KIMI_API_KEY are deleted so billing cannot flip to pay-as-you-go',
    session: 'ACP session lifecycle',
    permissions: 'ACP permission requests',
    usage: 'ACP session reports',
  }), { transport: 'acp-stdio (kimi -m <model> acp)' })),
  Object.freeze(acpPending('droidAgent', 'Droid', Object.freeze({
    file: 'server/drivers/acp/droid.ts', anchor: 'L173-185',
    modelSelection: 'Driver model catalog',
    credentials: 'droid login or FACTORY_API_KEY',
    session: 'ACP session lifecycle',
    permissions: 'ACP permission requests',
    usage: 'ACP session reports',
  }), { transport: 'acp-stdio (droid)' })),
  Object.freeze(acpPending('cursorAgent', 'Cursor', Object.freeze({
    file: 'server/drivers/acp/cursor.ts', anchor: 'L474-513',
    modelSelection: 'Models fetched from the cursor-agent CLI; --model is a global flag before "acp"',
    credentials: 'cursor_login OAuth, or CURSOR_API_KEY / CURSOR_AUTH_TOKEN (a key in env already authenticates and suppresses the login flow)',
    session: 'ACP session lifecycle',
    permissions: '--force (full auto) / --auto-review (auto) on argv',
    usage: 'ACP session reports',
  }), { transport: 'acp-stdio (cursor-agent [--force|--auto-review] [--model id] acp)' })),
  Object.freeze(acpPending('opencodeGo', 'OpenCode', Object.freeze({
    file: 'server/drivers/acp/opencode-go.ts', anchor: 'L851-912',
    modelSelection: 'Catalog loaded from the opencode CLI/config (OPENCODE_API_KEY plus provider envs); typed/injected models declared via env; free no-login Zen fallback is gated',
    credentials: 'OPENCODE_API_KEY or per-provider keys, or opencode auth login storage',
    session: 'ACP sessions; shared process across conversations (shareProcess); global project folder isolation for non-git folders',
    permissions: 'OPENCODE_PERMISSION env allow-map under full auto; owned-directory grants otherwise',
    usage: 'ACP session reports',
  }), { transport: 'acp-stdio (opencode acp)' })),
  Object.freeze(acpPending('qwenAgent', 'Qwen', Object.freeze({
    file: 'server/drivers/acp/qwen.ts', anchor: 'L208-240',
    modelSelection: 'Provider routes from ~/.qwen (model_routes); ACP session/load switches and confirms the whole route; unconfigured or ambiguous models refuse',
    credentials: 'Qwen Code account/config under QWEN_RUNTIME_DIR / QWEN_HOME / ~/.qwen',
    session: 'ACP session lifecycle; restartOnMcpChange (live session/load ignores fresh MCP credentials)',
    permissions: '--approval-mode default|auto-edit|auto, --yolo for full auto',
    usage: 'ACP session reports; QWEN_DEBUG_LOG_FILE parsed for quiet-status evidence',
  }), { transport: 'acp-stdio (qwen --acp)', access: 'custom' })),
  Object.freeze(acpPending('hermesAgent', 'Hermes', Object.freeze({
    file: 'server/drivers/acp/hermes.ts', anchor: 'L407-456',
    modelSelection: 'resolveHermesModels from the hermes CLI config; session/set_model per turn; one concrete model bound per grant',
    credentials: 'hermes setup login; OPENAI_API_KEY/OPENROUTER_API_KEY deleted (a leftover key auto-resolves to OpenRouter with no Authorization header)',
    session: 'ACP session lifecycle; restartOnMcpChange',
    permissions: 'ACP permission requests',
    usage: 'ACP session reports',
  }), { transport: 'acp-stdio (hermes acp)', access: 'custom' })),
  Object.freeze(acpPending('clineAgent', 'Cline', Object.freeze({
    file: 'server/drivers/acp/cline.ts', anchor: 'L55-69',
    modelSelection: 'Driver model catalog',
    credentials: 'Cline CLI sign-in',
    session: 'ACP session lifecycle',
    permissions: '--auto-approve false: every action asks',
    usage: 'ACP session reports',
  }), { transport: 'acp-stdio (cline --acp --auto-approve false)' })),
  Object.freeze(acpPending('copilotAgent', 'GitHub Copilot', Object.freeze({
    file: 'server/drivers/acp/copilot.ts', anchor: 'L186-199',
    modelSelection: 'Driver model catalog',
    credentials: 'GitHub Copilot subscription login',
    session: 'ACP sessions; one-shot session-state kept out of the person\'s copilot --resume list',
    permissions: 'ACP permission requests',
    usage: 'ACP session reports',
  }), { transport: 'acp-stdio (copilot --acp --stdio)' })),
  Object.freeze(acpPending('commandCodeAgent', 'Command Code', Object.freeze({
    file: 'server/drivers/acp/command-code.ts', anchor: 'L82-95',
    modelSelection: 'Driver model catalog',
    credentials: 'Command Code CLI sign-in',
    session: 'ACP session lifecycle',
    permissions: 'ACP permission requests',
    usage: 'ACP session reports',
  }), { transport: 'acp-stdio (command-code acp)' })),
  Object.freeze({
    id: 'customAcp', name: 'Custom (ACP)', kind: 'conversation-engine',
    transport: 'acp-stdio (user-configured command)',
    multipleInstances: true, access: 'custom',
    evidence: Object.freeze({
      file: 'server/drivers/acp/custom.ts', anchor: 'L14-26',
      modelSelection: 'agent-default plus models advertised by the configured agent',
      credentials: 'Whatever the configured ACP command uses',
      session: 'ACP session lifecycle',
      permissions: 'ACP permission requests',
      usage: 'ACP session reports',
    }),
    ...unavailable('Pending ACP core and trusted owner registration: custom engines remain in migration scope. Registration must commit a Host-approved executable pin, grant scope and permission broker; arbitrary executable/command fields in model or turn requests remain rejected.', 'pending-acp-core'),
  }),
  Object.freeze(acpPending('deepseekAgent', 'DeepSeek Harness', Object.freeze({
    file: 'server/drivers/acp/deepseek.ts', anchor: 'L286-305',
    modelSelection: 'Driver model catalog',
    credentials: 'DeepSeek account login in the dsh CLI',
    session: 'ACP session lifecycle',
    permissions: 'ACP permission requests',
    usage: 'ACP session reports',
  }), { transport: 'acp-stdio (dsh --profile acp)' })),
].map(Object.freeze))

const byId = new Map(BOT_ENGINE_DRIVERS.map(driver => [driver.id, driver]))
if (byId.size !== BOT_ENGINE_DRIVERS.length) throw new Error('DUPLICATE_BOT_ENGINE_DRIVER_ID')

/** The closed id set, exactly the 26 upstream built-in drivers. */
export const BOT_ENGINE_DRIVER_IDS = Object.freeze([...byId.keys()])

export function getBotEngineDriver(id) {
  if (typeof id !== 'string') return undefined
  return byId.get(id)
}

export function listBotEngineDrivers() {
  return BOT_ENGINE_DRIVERS.map(driver => Object.freeze({ ...driver, evidence: driver.evidence }))
}

/**
 * Resolve a driver request into an engine factory. Only 'claude' is implemented; every
 * other id returns an explicit unavailable verdict with its reason. Unknown ids throw.
 * The input is never allowed to carry an executable, endpoint, command or credential:
 * those are Host-owned and attempting to supply them is an error, not a configuration.
 */
export async function resolveBotEngine(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('INVALID_ENGINE_REQUEST')
  assertNoAdHocDriverInput(request)
  const { driver: id } = request
  const entry = byId.get(id)
  if (!entry) throw new Error(`UNKNOWN_BOT_ENGINE_DRIVER: ${JSON.stringify(String(id))} (closed catalog of ${BOT_ENGINE_DRIVERS.length} upstream drivers)`)
  if (entry.availability !== 'implemented') {
    return { status: 'unavailable', driver: entry.id, name: entry.name, reason: entry.availabilityReason, targetCapability: entry.targetCapability }
  }
  const { createClaudeEngine } = await import('./claude-engine.mjs')
  return { status: 'ready', driver: entry.id, name: entry.name, createEngine: createClaudeEngine, implementation: entry.implementation }
}

/** Ad-hoc engine inputs are refused outright: authority comes from committed Host state only. */
export function assertNoAdHocDriverInput(request) {
  const forbidden = ['executable', 'path', 'command', 'cmd', 'endpoint', 'url', 'baseUrl', 'args', 'argv', 'env', 'environment', 'credentials', 'apiKey', 'token', 'autoApprove', 'alwaysAllow', 'bypassPermissions']
  for (const key of Object.keys(request)) {
    if (forbidden.includes(key)) throw new TypeError(`HOST_OWNED_ENGINE_INPUT: ${key} may not appear in a driver request`)
  }
  return true
}
