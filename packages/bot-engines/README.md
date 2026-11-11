# packages/bot-engines

Native Bot conversation engines: a closed catalog of the 26 upstream OpenMausBot
built-in drivers, plus the first ported engine — the **Claude** conversation-session
adapter, its public LLM bridge and Host-owned registration. The product can explicitly
configure a pinned Claude text/subscription route and select it through the existing Bot
model binding. Serving, grants, request history and the one money authority remain in the Host.

Status: `claude` is implemented and covered by real offline child-process tests. Every
other catalog entry is explicitly **unavailable** with a concrete reason and target
capability. Custom ACP engines remain in migration scope: the generic ACP core now exists
in `packages/bot-acp` (session lifecycle, permissions, bounded stdio transport, native
launch — offline-verified, **not** wired into product composition and no ACP CLI claimed
usable), so `customAcp` is gated on trusted owner registration of pinned entries, grants
and the permission broker rather than on the core itself.

## Modules

| File | Purpose |
| --- | --- |
| `src/driver-catalog.mjs` | Closed 26-entry catalog (`BOT_ENGINE_DRIVERS`, `resolveBotEngine`, `assertNoAdHocDriverInput`) |
| `src/claude-engine.mjs` | `createClaudeEngine` / `pinClaudeEntry` — the conversation-session adapter |
| `src/claude-protocol.mjs` | Pure stream-json helpers (frame classification, usage/cost math, broker wire) |
| `src/claude-permission-broker.mjs` | Host-side ask/answer broker (named pipe / unix socket, fail-closed) |
| `src/claude-permission-proxy.mjs` | MCP stdio `approve` proxy mounted as `mcp__dsh` in the CLI's `--mcp-config` |
| `src/claude-llm-turn.mjs` | Pure request projection for the LLM route (capability gate, retained-history continuity, usage/finish mapping) |
| `src/claude-llm-adapter.mjs` | `ClaudeLlmAdapter` / `createClaudeLlmAdapter` — the public `LlmAdapter` bridge over the retained Claude session |
| `src/host-registrations.mjs` | Closed Host profile validation, public model registration and private CLI credential provisioning |
| `licenses/NOTICE.md`, `licenses/LICENSE-OpenMausBot` | Upstream attribution and full Apache-2.0 license (pin `1bc4749a…`) |

## Policy invariants

- **Closed catalog.** Exactly the 26 upstream built-in driver ids exist. Unknown ids are
  an error, not a fallback. `customAcp` awaits the generic ACP core in `packages/bot-acp`
  (present, offline-verified, unwired) plus trusted owner registration of pinned entries,
  grants and the permission broker. Turn/model request JSON cannot register a command.
- **Authority is Host state.** Model routes, tools, executable paths, digests,
  environments and credentials never arrive through turn payloads. A driver request
  carrying any of `executable/path/command/endpoint/url/args/env/credentials/apiKey/
  token/autoApprove/alwaysAllow/bypassPermissions` is rejected (`HOST_OWNED_ENGINE_INPUT`).
- **Fail-closed permissions.** `bypassPermissions` is not an available mode. `--tools ""`
  disables built-in tools, including reads and edits that otherwise need no prompt.
  `--allowedTools` only pre-approves the configured MCP tools. Only `mcp__dsh_task__<grantedTool>`
  permission asks can ever be allowed; everything else (e.g. `Bash`) is auto-denied by the
  engine without reaching the host. Duplicate ask ids, post-close asks and unanswered
  permission asks all deny.
- **Configuration boundary.** `--setting-sources ""` excludes user/project/local
  settings, `disableAllHooks` disables their hooks, and `--disable-slash-commands`
  disables skills and commands. The private home and strict MCP config are retained.
  Machine-managed CLI policy still applies; this is not a filesystem sandbox.
  Subscription credentials are provisioned into the private home by the Host; bare
  mode is not used because it ignores OAuth login. A CLI lacking required flags must
  fail startup; it must not retry with broader settings.
- **One ledger.** Cost/usage figures flow only to the Host hooks (`onBeforeRequest`,
  `onObserve`, `onSettle`, `onClose`). Values the CLI does not report stay `null` /
  `'unknown'`; nothing is fabricated here.
- **Every turn re-checks authorization** (admission hook, model route, grant revision,
  broker liveness), and a refusal before dispatch provably dispatches nothing.
- **Unknown outcomes are never blindly replayed.** A `--resume` that the CLI refuses
  (error result before init, or exit before any frame) settles `resume-refused` and stops
  — the earlier task is never replayed into a fresh session.
- **Stop requests are not stop confirmations.** `treeStopped: true` appears only from the
  launcher's own accounting (Windows job object `ActiveProcesses == 0`).

## Turn lifecycle fence

- **The turn slot is reserved synchronously.** `submitTurn` takes the single slot before
  its first `await` (the admission hook). A second submit in the same tick — or while
  admission, launch, dispatch, result or the Host settlement is pending — is refused
  `ENGINE_TURN_IN_PROGRESS` with zero extra admissions and zero launches. The slot is
  freed only by a completed Host settlement (or an admission refusal, which provably
  dispatched nothing); a legal next turn may then be submitted.
- **The Host settlement completes the turn.** The public `submitTurn` promise and the
  `turn` event fire only after the unique `onSettle` callback ran. If the settlement
  hook throws, the turn promise rejects with `ENGINE_SETTLE_HOOK_FAILED`, the native
  evidence attached untouched (`error.turnResult`), `fundingStatus: 'unknown'` (the CLI
  really may have run), an `turn-settle-failed` event is emitted, and the engine stops:
  no next turn, no fresh process pretending success, never a replay.
- **Post-admission failures settle exactly once**, each receipt bound to its `turnId`
  and the engine's `operationId` (no second ledger): a failure provably before the
  prompt was written to the CLI's stdin settles `not-run` with `usage: null` and
  `costUsd: null` (nothing is invented); a failed stdin write settles `unknown`
  (may-dispatch). A failed write does not kill the engine — the retained process may
  serve the next turn.
- **Old generations cannot settle new turns.** A `result` frame only settles the turn
  currently in flight on the process that produced it; frames from a dead or former
  process generation are dropped at that state gate (they do not even count as strays),
  and a late twin result after the settle gate is counted (`strayResults`), never applied.
- **stop() ends the native tree first**, independently of every Host hook: the current
  process and any still-pending launch are ended before waiting on the settlement chain,
  the `tree-stopped` event carries the supervisor's job-object evidence while a slow
  settlement is still pending, and `stop()` itself resolves only after the settlement
  chain and `onClose` ran. A trusted hook that never returns leaves `stop()` pending —
  observable through `snapshot().settlementPending` — but the tree above is already down.
- **`hooks.onObserve` is observation, not the ledger.** Its failures are counted
  (`snapshot().observeHookFailures`) and emitted (`observe-failed`), never silently
  swallowed, and never a turn or financial outcome.

## The Claude engine in one page

```
createClaudeEngine({
  authority, subject, binding, operationId,          // trusted Host state
  entry: { executable, sha256, version,              // digest-pinned native entry
           script?, scriptSha256? },                 //   (script: pinned cli.js-style entry)
  runtimeRoot, workspace,                            // isolated dirs
  model: { catalogProvider, catalogModel },          // asserted against the authority
  permissionMode: 'default'|'acceptEdits'|'auto',    // bypassPermissions refused
  tools: ['read_notes'], handlers: [...],            // committed-grant MCP bridge
  hooks: { onBeforeRequest, onObserve, onSettle, onClose },
  onPermissionRequest?, provisionCredentials?, deadlineMs, signal, launcher?,
})
  → { submitTurn({text}), respondToRequest(id, {behavior,message?}), stop(), snapshot(), events }
```

- **Session**: one retained CLI process per session (`-p --output-format stream-json
  --input-format stream-json --verbose --include-partial-messages --strict-mcp-config`).
  The `system/init` frame confirms the session id and the model; a model mismatch is
  fatal. After a process exit the next turn relaunches with `--resume <session_id>`.
- **Turns**: `submitTurn({ text })` — text (1..64000 bytes, no NUL) is the ONLY accepted
  field. Each turn is settled by the CLI's own `result` frame.
- **Cost**: `total_cost_usd` is a running total; a turn's cost is the delta since the
  previous result (first reading taken whole; a shrinking total taken whole — the CLI may
  restore an older baseline after `--resume`).
- **Stop evidence**: `{status, pid, exitCode, nativeStopReason, containment, treeStopped,
  forcedKill, stopRequestedIsNotConfirmation}` — `status: 'confirmed'` only when the
  launcher's job-object accounting says the whole tree ended.

## The Claude LLM bridge (`claude-llm-adapter.mjs`)

The retained Claude session as a **public SDK route**: a `LlmAdapter` the Host registers
with the installed `ctx.llm.registerAdapter([provider], adapter)`, so one Bot conversation
becomes one `provider/model` route that the Host's own `llm/stream` waterfall — the same one
an integrated turn goes through — admits, prices and receipts. The bridge holds no money and
issues no receipt of its own; it is not a second chat surface and not a second ledger.

```
createClaudeLlmAdapter({
  provider, model,                                   // the one committed route
  funding: 'subscription',                            // the only open kind
  entry | entryFor,                                   // Host pinned installation reference
  runtimeRoot, workspace | workspaceFor,              // isolated absolute dirs
  identityFor: ({provider, model, sessionId}) => ({   // trusted Host resolver
    subject, botId, authority, binding, persona?,
  }),
  hooks, onPermissionRequest, provisionCredentials,   // Host state, never request state
  tools, handlers, permissionMode, deadlineMs, launcher, engineFactory,
})
  → LlmAdapter { listModels, resolveModel, prepareCall, stream, replaceRoute, close, snapshot }
```

- **Trust boundary.** Only a Host constructs it. A request may carry
  `provider/model/messages/system/signal/sessionId` and nothing else: an extra field
  (identity, path, command, credential, engine configuration) is refused
  (`CLAUDE_ROUTE_UNKNOWN_REQUEST_FIELD`), and so are `tools`, `toolHistory`, `maxTokens`,
  `reasoningEffort`, `temperature`, `stop` and `purpose` — capabilities this route cannot
  honour and therefore does not silently ignore.
- **One session per conversation.** `stream(options)` is one turn: the trailing new user
  text is projected out of the request history (the retained CLI already holds everything
  before it) and dispatched on the one native session. Continuity is proved by durable
  message id and by the SDK's own model provenance; a rewritten prefix, an unseen history, a
  repeated dispatch, a changed Bot/model/persona/grant revision or a different route
  generation retire the old session and refuse — never a quiet drop and never a replay.
- **Honest outcomes.** Usage the CLI does not report emits no `usage` chunk; a turn with no
  output, an `unknown` outcome or a cancellation is an `error`/`aborted` finish, never a
  success. Exactly one finish per turn, emitted only after the engine's own Host settlement
  ran. Model provenance in the replay state proves the CLI-configured init only.
- **Cancellation belongs to the turn.** The session is never bound to the first turn's
  short-lived signal; cancelling stops the native tree, waits for the engine's settlement and
  retires the session. `close()` refuses further calls, waits for an engine that is still
  being created and stops every live tree — it creates nothing.

## Tests (offline, real child processes)

```
node --test --test-concurrency=1 tests/bot-engine-llm-adapter.test.mjs      # 33 pure cases, no process
node --test --test-concurrency=1 tests/bot-engine-llm-adapter.native.mjs    # 9 native cases
node --test --test-concurrency=1 tests/bot-engine-catalog.test.mjs tests/bot-engine-protocol.test.mjs tests/bot-engine-claude-session.native.mjs
node scripts/verify-bot-engines.mjs
```

The native suite installs the real Cordis + `@deepseek-ai/dsh-llm` `LlmRuntime`, registers
this adapter through the public `registerAdapter`/`prepareCall` seam, and drives the real
`createClaudeEngine` (no engine-factory seam) through the real native-peer supervisor into a
real Node child (`tests/fixtures/bot-engine-claude-fixture.mjs`). It proves: two turns on one
retained PID with only the new input reaching the CLI, a same-tick second turn refused by the
engine fence, a refused `--resume` that is never a replay, a turn lost to a dead process
refused as unknown, cancellation and teardown, a route re-registration refused on the
captured generation, a revoked grant retiring the native tree, an API-funded route refused
before anything launches, and the parent's real `createModelAccounting` recording exactly one
receipt with the CLI-reported usage and no invented cost.

No claude CLI, no network. The native suite drives a real Node fixture
(`tests/fixtures/bot-engine-claude-fixture.mjs`) through the real PowerShell
native-peer `supervise` launcher: two-turn retained session, permission allow/deny/
question flows, out-of-band host answers, missing usage, utf8/oversize/split/stray
frames, model mismatch, admission refusal with zero dispatch, mid-turn revoke, host stop
and abort with job-object tree-stop evidence, and both resume-refusal paths. Two further
groups prove the turn-lifecycle fence: a native group (same-tick double submit, stray
results during a pending settlement, a failing settlement hook, tree stop ahead of a
slow settlement, a failing observation hook) and a launcher-seam group whose gated
in-memory supervisor exercises the states a healthy process never produces (stuck
admission, stop during admission/launch, stdin write failure, a throwing `supervise()`,
a tampered entry script, late frames from a dead generation). Gates are explicit
promises; the seam models the pipe's causal order (frames cannot overtake the stdin
write completion). Run serially (`--test-concurrency=1`); the machine has memory limits.

## Remaining ports and acceptance

- **ACP products**: the generic core is implemented; trusted owner registration and
  real-driver integration are still required for the upstream ACP drivers.
- **Other engine ports** (`pending-engine-port`): codex, museCode, pi.
- **API providers** (8): stateless OpenAI chat-completions channels — they belong to the
  Host model-routing channel, not to conversation engines.
- **Host acceptance**: configured Claude routes have whole-product offline native tests.
  Live installed CLI/account acceptance, broader controls and remaining engines are pending.

## Configured product route

The unreleased Bot plugin accepts a Host-owned `conversationEngines` array. Each profile
has `id`, `driver: 'claude'`, a unique `provider`, exact `model`, optional `name`, pinned
`entry` (`executable`, `sha256`, `version`, optional `script`/`scriptSha256`),
`credentialRef: 'ds-secret/NAME'`, optional `deadlineMs` (default 30 minutes), and
optional `hostTools` (default false).
The entry comes from installation verification; this setting neither installs nor logs in.

`credentialRef` selects an explicit Host-only secret with an empty Bot scope. Its value
is the opaque JSON content of the selected CLI credential profile. The Host validates it
and writes it to the protected engine home under `.claude/.credentials.json`; ambient
user accounts are not discovered. Changes/removal retire the old Bot session before the
next request. The Host-confirmed Bot persona uses a private `system-prompt.txt` through
`--append-system-prompt-file`. Neither credential nor persona contents go in process argv.

Enable the independent runtime and choose the configured model in the existing Bot
settings. The trusted catalog permits subscription funding for this route. It exposes
text conversation by default. With `hostTools: true`, the native process also
receives a private MCP server for the Bot's available file, approved container
command, browser, desktop, operation, artifact, Task and data tools. The catalog is resolved when a native
session starts. Start a new conversation to refresh it after adding tools. Each
call rechecks current route funding, credentials, committed Bot grants and paired
computer scope. File writes and container commands use the existing Task service. A retained child can call
tools only during its admitted turn. Cancellation reaches the MCP handler and
requests cancellation of a submitted Task when the Bot has that permission. Its
durable record retains the actual outcome. Bridge request IDs are single-use
within a process connection. An uncertain write returns its original Task ID
and a reconciliation instruction so the model can query `bot_task_status`.
Browser tools open, snapshot, type, click and close an Agent browser. Desktop tools capture PNG,
click, type, press keys and scroll. The Host stores conversation-owned operation identities before
dispatch. Unknown mutations fence later mutations on that target until `bot_remote_operation_status`
or `bot_remote_operation_cancel` reads the original Agent operation. Browser sessions and screenshot
references belong to the Bot conversation that created them. Screenshots use the Agent artifact
channel and arrive as MCP image content, chunked over the private pipe with bounded reassembly.
Verbose CLI `user/tool_result` image echoes are reduced to size and SHA256 receipts before Host
events are emitted. The CLI receives the original pixels through MCP. Echo parsing allows bounded
image frames while retaining the ordinary text frame and session output limits.
The five data tools share their descriptions and business argument projection with the SDK registry.
They use the Bot's existing private data engine and controlled library under its committed `tool/data`
grant, in both chat modes. `data_show.chart` has a validated nested object schema. Saved tables and
cards are readable in the Data panel, and CSV exports are written to the same Bot library. Current
support is CSV/TSV/JSON, SQLite, bar/line/area and CSV export. Native cancellation reaches the fixed
data worker; a cancelled library read cannot later start a table write. Committed changes are not
rolled back by cancellation, and failed or timed-out data calls are never automatically retried.
DuckDB and remaining data formats/charts/exports, team tools, browser script/upload/download and rich
native tool transcripts remain pending.
Independent chat now supports explicit new conversations. A persisted reset intent blocks
new turns until the old native tree is proven stopped (or proven never started); unknown
results stay blocked across restart. Old transcripts remain readable. Whole-product native
tests prove the next explicit send launches a fresh process with only the new context,
and resetting itself creates no model receipt. Live account onboarding remains pending. See
`tests/product-conversation-engine.test.mjs` for the offline whole-product acceptance.

The same text route now accepts requests made by the actual installed AgentLoop in
integration mode. A Host-only projection verifies the SDK marker, frozen request,
canonical live Session messages and empty tool history, preserves appended Host facts,
and uses the Host Session persona. Capability assembly omits unsupported native tool
declarations for that request; Main keeps its full Host tool authority. Switching back
to an API route restores its tool declarations. The offline public-loop test proves two
native turns in one child, followed by an explicit API turn with three accounting
receipts total. The opt-in Host MCP path is tested with the actual SDK, native
subprocesses, Noise transport, paired Agent and SQLite Task service in both chat modes.
The remaining native tool families and drivers need further integration.
