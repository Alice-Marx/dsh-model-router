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
