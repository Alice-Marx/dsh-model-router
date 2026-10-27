# Bot principal and legacy access adapter

This M0 adapter builds on the capability authority. The published plugin source
now has an optional `botIntegrationPolicy` service seam covering all 13 registered
MR tools, both commands and all 23 exported RPC receivers. No default profile
installs this service. `requireBotPolicy: true` makes its absence or invalid
contract fail closed; a strict profile must set that flag and load a compatible
host adapter before admitting work.

`src/principals.mjs` gives one Bot a host-owned stable object. Trusted lifecycle
code binds each live Agent object and Session id to it. Multiple chat/group/part
Sessions share grants, while copied Agent objects do not acquire authority.
Detaching one Session does not detach its siblings. Retirement revokes leases,
removes bindings and prevents revival under the same Bot id in this process.
Bindings are reconstructed from trusted state after restart; they are not
accepted from RPC payloads. The frozen DS lifecycle still needs that adapter.

`src/bot-policy.mjs` enters a bounded capability lease and AsyncLocalStorage
context around a legacy operation. Concurrent Bot calls keep distinct subjects;
route planning/listing filters the configured catalog by that subject. Nested MR
model calls inherit its context even when they omit `sessionId`; auxiliary
LlmRuntime calls resolve only registered trusted Session metadata. Both request
construction and first stream pull check the exact model. Later chunks are also
checked. A quiet auxiliary provider waiting for output is not yet actively
aborted by grant replacement: provider-request cancellation/accounting remains
part of the execution and receipt integration.

The plugin checks tool permissions before approval prompts, at the monotonic
guard, and again in the body after asynchronous admission. Commands retain the
actual command registry's Agent identity. RPC wrappers read only the Gateway's
`ctx.invocation.peer.principal`, never an argument claiming `botId` or `owner`.
Only the authenticated Host owner is admitted by this first RPC adapter; other
peer kinds and calls lacking invocation context are denied. Every remote method
still needs an explicit owner capability.

Bot native execution/team/retry/install/rating paths stay closed even if granted
their legacy tool names: their fixed executable, approval, saved-run ownership
and accounting contracts must be implemented in the Execution facade. A strict
RPC background launch also stays closed until its task lease can outlive the
request safely. This gate does not remove those features from the final scope.
Legacy profiles without the policy service keep their current behavior.

These are application permissions, not OS file/process isolation. CLI private
bootstrap, OS workers, persistent Task/Policy, budget reservations and receipts
are still pending. The `--legacy-policy` probe retains its manual trusted test
bindings. The separate `--lifecycle` composition loads policy from startup and
uses the frozen DS `createRuntime` export to maintain bindings automatically.
Neither command migrates production data.

`src/ds-lifecycle.mjs` wraps that runtime's load/save/refresh/resolveAgent methods.
Successful saves commit the captured ownership snapshot; `required: true` prevents
the read-only store's no-write return from granting memory-only changes. Initial
load/refresh reads committed state (bounded at 32 MiB). Active own-chat and
group-member Sessions bind; archived segments do not. Failed persistence suspends
grants and aborts their leases, while successful refresh/save can recover from
committed state. A missing committed file after hydration also suspends access.
Stale revisions cannot restore older grants, conflicting equal
revisions and reassigned Session ownership are refused. Disposal restores only
its own wrappers; a late save completion cannot recreate grants after close.

The strict fixture covers actual DS creation, group-member Sessions, folder/part
transition, deletion, cold-process reconstruction and authenticated Gateway RPC
allow/deny checks. Read-only takeover, scheduling, hot reload and every crash
interleaving remain outside this evidence. Grants still come from trusted host
configuration; a model-supplied role, instruction or payload is never a grant.

```sh
node --test tests/bot-policy.test.mjs tests/legacy-policy.test.mjs
node scripts/integration-combined-host.mjs --ds-root <frozen-DS> --host-root tests/fixtures/integration-host --legacy-policy
node scripts/integration-combined-host.mjs --ds-root <frozen-DS> --host-root tests/fixtures/integration-host --lifecycle
```

## Durable managed Task foundation

`task-contract.mjs`, `task-journal.mjs`, `task-service.mjs` and `task-tools.mjs`
provide closed commands, a native SQLite journal, one fenced bounded runner and
SDK Agent-derived command ownership. They currently support one fixed read-only
package per Task. Retry creates a new attempt/operation and retains the original
deadline. Cancellation waits for backend quiescence. Restart marks interrupted
operations unknown and refuses replay. The read-only reconciliation API described
below can settle only a verified original execution record.

The `--tasks` strict composition executes the actual MR API executor and recorded
step rerun. Only journal-linked legacy runs can be retried by their owner. The
legacy MR ledger remains the money writer; this journal stores references and
does not claim unified receipts, budgets or a cross-database atomic commit.
This foundation is opt-in and does not open the old direct Bot execution tools.
See [contract, reproduction and remaining limits](../../docs/integration/20261027_managed_tasks.md).

`mr-read-backend.mjs` now owns the fixed API adapter. Before dispatch, the actual
MR lifecycle durably links its run and stamps task/attempt/operation/target ids;
each model request rechecks the current journal fence. `bot_task_reconcile`
reads bounded original ledger snapshots and accepts only matching terminal
receipts with no unresolved hold or amount. It does not dispatch, release holds,
repair the source or create another invoice. A missing/unknown receipt remains
blocked; revocation rejects late observations. Schema2 preserves schema1 task
identities and refuses future versions. Actual budget refusals become
`waiting-budget`, with explicit retry/cancel and the original deadline.
See [receipt reconciliation contract](../../docs/integration/20261027_receipt_reconciliation.md).

## SQLite MR money authority

The strict `--tasks` composition now installs `sqlite-router-state.mjs` as the
single MR ledger/hold writer. Normalized run/hold tables and archived metadata
commit under one revision; only explicitly pure callbacks recompute on CAS
conflicts. The original budget and archival algorithms are shared with JSON.
Cutover preserves a byte-verified backup and leaves a version4 marker that old
writers refuse. Rollback exports the latest receipts, blocks unsettled holds and
active tasks, and invalidates the old epoch. Migration/rollback interruption
requires matching evidence, never an empty-state fallback.
This supersedes the earlier JSON-authority checkpoint for this isolated profile.
Front-channel Bot/auxiliary admission, complete Task/funding atomic admission,
per-source receipts and default product migration remain open. See
[money cutover, rollback and reproduction](../../docs/integration/20261027_sqlite_finance.md).
