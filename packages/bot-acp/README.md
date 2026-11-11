# packages/bot-acp

The generic ACP (Agent Client Protocol) session core for the Bot runtime: a strictly
bounded JSON-RPC 2.0 stdio transport, multi-turn session management, fail-closed
permissions, and a Host-bound adapter the product composition can wire.

Ported and re-grounded from OpenMausBot `server/drivers/acp/*` at pin
`1bc4749aa8307d7d6998bf86de4ef6478460dd93` (Apache-2.0); see `licenses/NOTICE.md`
for the exact upstream paths and the preserved license text.

> **Status.** This module is a core, not a product feature. It is **not wired into
> product composition**, and no ACP CLI is claimed to be verified end-to-end here.
> Presence in the tree is not availability: the parent composition still has to
> register a pinned entry, a grant scope and the funding/ledger hooks.

## Modules

| File | Purpose |
| --- | --- |
| `src/rpc-codec.mjs` | Pure codec: newline framing with UTF-8 reassembly and a hard frame cap, message classification, id validation, wire-error mapping, client/agent capability schema |
| `src/stdio-rpc.mjs` | Bounded transport: `createChildPipe` (real stdio) and `createStdioRpc` (id-mapped requests, notifications, responses, pending/deadline/idle/backlog limits, duplicate/unknown/late response accounting, accurate pending rejection on real process exit) |
| `src/acp-host.mjs` | One agent process and the sessions in it: sessionId routing, single-flight `initialize`/`authenticate`, session/lifetime/draining bounds, fail-closed unrouted handler |
| `src/session-core.mjs` | Multi-turn session: handshake, `session/new`, capability-gated `session/load`, serial turns with explicit busy, text-only prompts, `session/update` merging, stopReason classification, advertised-only model/config/mode control, an `onDispatched` dispatch marker and `acpNotDispatched`-tagged pre-dispatch refusals |
| `src/permission-policy.mjs` | `session/request_permission` decided by committed Tool/Task/operation authority; every unknown, duplicate, expired, revoked, timed-out or closing case denies. `createClientMethodGuard` refuses `fs/*` and `terminal/*` unless the Host enables them with a submitted root and IO callbacks |
| `src/native-launch.mjs` | `pinAcpEntry` (absolute path + digest + real version proof), `createSupervisorPipe` (native supervisor stdio relay), `launchAcpProcess` — all reusing `packages/cli-runtime/src/native-process.mjs` |
| `src/acp-adapter.mjs` | `createAcpAdapter` — the public surface: identity, Host hooks, the one-slot turn fence, settlement ordering, cancellation, usage/cost evidence, stop evidence |
## Public API

```js
import { createAcpAdapter } from './packages/bot-acp/src/acp-adapter.mjs'

const adapter = await createAcpAdapter({
  authority,            // capability-broker authority: { describe, assertModel, assertTool }
  subject,              // registered authority subject
  binding,              // { taskId, attemptId, machineId, workspaceId, location }
  operationId,          // durable operation identity
  entry,                // { executable, sha256, version, script?, scriptSha256? } — Host-pinned
  spawnArgs,            // Host-constructed argv after the executable (e.g. ['acp'])
  runtimeRoot,          // isolated absolute runtime root (private HOME)
  workspace,            // agent cwd
  model,                // { catalogProvider, catalogModel }
  signal,               // AbortSignal
  hooks,                // { onBeforeRequest, onObserve, onSettle, onClose } — the only ledger recipients
  onPermissionRequest,  // Host permission callback; absent denies every ask
  operationTool,        // (identity) => committed tool name | null
  resumeSessionId,      // only honoured when the agent advertises loadSession
})

await adapter.start()                       // initialize → authenticate → session/new (or load)
const turn = await adapter.submitTurn({ text })   // text only
adapter.cancel()                            // a request, never a stop confirmation
await adapter.stop('reason')                // real process stop + evidence
adapter.snapshot()                          // evidence snapshot
```

A turn result carries `{ ok, outcome, stopReason, sessionId, text, usage, costUsd,
costStatus, elapsedMs, cancelRequestedAt, updates, errorText, dispatched }`.

`outcome` is one of `succeeded`, `cancelled`, `failed`, `not-run` or `unknown`.
`not-run` means the prompt provably never reached the agent (a refused admission, a
failed launch or session handshake, a pre-dispatch refusal, a cancelled
reservation); `unknown` means the prompt was issued and the agent may have acted
on it — an unknown outcome is reported verbatim and is never replayed
automatically. `dispatched` records whether the prompt was really issued, and
`snapshot().turnsDispatched` counts dispatches, never completions.

`submitTurn` rejects only for a request that never became a turn (a malformed
payload, a Host admission refusal, a denied grant). Once a turn exists it always
ends in exactly one settlement, delivered to `hooks.onSettle` before the returned
promise resolves.

## Policy invariants

- **Authority is Host state.** Model routes, tools, executable paths, digests,
  environment and credentials never arrive through a turn payload: `submitTurn`
  accepts `{ text }` and nothing else. A driver request naming an executable,
  endpoint or credential is an error (`HOST_OWNED_ENGINE_INPUT` upstream, and the
  same discipline here). Request JSON that claims a `botId`, `owner` or `config`
  is never authority.
- **One turn slot, reserved before the first await.** `submitTurn` takes its slot
  synchronously, so a second call in the same tick is refused with
  `ACP_TURN_IN_PROGRESS` and performs no admission, no launch and no prompt.
  Admission, session start, dispatch, the peer's result and the Host settlement
  all belong to that one slot, and the Host grant is re-judged after every
  asynchronous boundary. A turn settled underneath a pending call (cancel, stop,
  revocation, peer exit) is never resumed: the late continuation refuses with
  `ACP_TURN_NOT_DISPATCHED`.
- **Settlement is durable before it is public.** `hooks.onSettle` is the only
  settlement path, and it runs before the success is published and before the
  slot is released; a slow hook keeps the turn observably pending
  (`busy === true`, `snapshot().settlement.inFlight`). A hook that refuses
  refuses the success: `submitTurn` rejects with `ACP_SETTLEMENT_FAILED` carrying
  the original native result and its unknown funding evidence, and the adapter
  retires instead of letting a new request run on an unrecorded turn. Nothing is
  caught and swallowed into a success, no cost or usage figure is invented, and
  no second ledger is opened.
- **Not-run and unknown are different answers.** A refused admission releases the
  slot so the caller may call again and records no settlement. After admission,
  a failure before the prompt is issued settles once as `not-run`; a prompt whose
  write may have reached the agent settles as `unknown`. `turnsDispatched` counts
  the dispatch moment, not completions.
- **Session and model identity are fenced by a pending turn.** `start`,
  `startFresh`, `selectModel` and `setMode` refuse while a turn is pending. The
  model a turn runs under is the Host-committed `catalogModel`: a peer advertising
  another model is not authority, and selecting one anyway would make the turn
  evidence and the funded grant disagree. A different binding needs a rebuilt,
  re-authorized adapter (`ACP_MODEL_BINDING_CHANGED`), never owner or permission
  data smuggled through request JSON.
- **Stop and cancel work at every stage.** `stop` settles a pending turn first
  (not-run before dispatch, unknown afterwards), awaits a launch that raced it so
  no late spawn outlives the stop, really stops the native tree, and only then
  waits for in-flight settlements before reporting `onClose`. `cancel` during a
  pending admission settles the reservation as not-run; after dispatch it sends
  `session/cancel`, and an unanswered cancel ends in a real process stop. Only the
  launcher's own accounting (Windows job object) confirms a tree stop; a cancel
  request is never a stop confirmation, and a stop without one is reported
  `unconfirmed`, not `confirmed`.- **Fail-closed permissions.** Only an `allow`-kind option the agent itself offered
  can approve, and only after the Host handler answers against a committed grant.
  Missing handler, unknown option, duplicate ask, timeout, close, revocation and
  abort all deny. Session-scoped "allow always" is deliberately not implemented:
  every ask is decided by the Host.
- **Client file and terminal access is off by default.** `fs/read_text_file`,
  `fs/write_text_file` and `terminal/*` are advertised `false` and refused with
  method-not-found. Enabling them requires a Host-submitted root plus Host IO
  callbacks; a hand-written instruction in a prompt is never the boundary.
- **Unknown is not success.** An unknown `stopReason` is reported verbatim;
  `end_turn` with no output is a lost turn; a refused resume never opens a new
  session and replays the old turn.
- **Cancel is a request, not a confirmation.** `session/cancel` and the process
  tree-stop are recorded separately; only the native supervisor's own accounting
  (Windows job object) confirms a tree stop.
- **No second ledger.** ACP reports token/context usage and no dollar figure, so
  `costUsd` stays `null` and `costStatus` stays `unknown`; evidence flows to the
  Host hooks only.
- **`onObserve` is diagnostic, `onSettle` is the record.** `onObserve` reports
  that a session exists; it is never a settlement and never carries money. Only
  `onSettle` records a turn, and only `onClose` reports the stop evidence.

## Tests

| File | Runs |
| --- | --- |
| `tests/bot-acp-codec.test.mjs` | fast, offline: framing, UTF-8 splits, oversize, malformed, duplicate/unknown ids, exit rejection, real-child pipe |
| `tests/bot-acp-permissions.test.mjs` | fast, offline: every deny path, client-method guard, path containment |
| `tests/bot-acp-session-state.test.mjs` | fast, in-process: session lifecycle, turn rules, model/mode gating, permission routing |
| `tests/bot-acp-turn-fence.test.mjs` | fast, in-process: the turn fence — same-tick submits, slow/refused admission, slow/refused settlement, stop during a launch, pin/launch/dispatch failures, late and retired-process traffic, cancel/revocation at every stage, identity fences — against a controlled launcher seam |
| `tests/bot-acp-session.native.mjs` | **serial** (`node --test --test-concurrency=1`): real offline child through the real native supervisor, including the turn-fence suite |

`scripts/verify-bot-acp.mjs` runs all five in an isolated `tmp/integration/bot-acp/`
directory and writes `report.json`. No agent CLI, network, user profile, credential
or desktop is touched.

The seam suite proves the *timing* of the fence deterministically; the native
suite proves the same rules against a real offline Node child and a real native
supervisor, which is the only real-machine evidence. Neither is a substitute for
the other.
