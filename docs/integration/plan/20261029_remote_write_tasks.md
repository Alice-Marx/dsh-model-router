# Scoped remote write tasks

Add a fixed remote file-write backend to the existing Task runner. The model
chooses a paired machine/root and relative file data plus required previous hash;
it cannot choose endpoints, credentials, executable paths or a shell. The owner
must grant workspace-write, fs_write, operation_status and operation_cancel.
Commands/browser/desktop require their additional execution/isolation contracts;
this backend does not silently grant them.

Resolve the durable target from the submitting Bot's actual live machine binding.
Persist machine/root/config revision/binding revision in the target hash and use
the actual machine/root for the existing journal workspace lock. Revalidate before
dispatch and after ticket issuance. Read-only backends remain unaffected.

Journal5 adds a remote-operation execution reference, distinct from MR/CLI money
runs; old readers refuse user_version5 before dispatch. Financial authority JSON
marker remains4: money/source/epoch protocol is unchanged. All database readers,
exports and schema future-refusal tests must accept5/refuse6 together. Preserve
the complete existing plans/outbox/dedup/funding data during schema4->5.

Checkpoint the original Task operation identity before the first remote request.
Agent durable operation dedup remains authoritative. Poll only operation_status,
never replay a write during reconciliation. An absent/lost/unknown receipt stays
needs-reconciliation and retains its workspace lock. Cancellation is final only
with a terminal durable remote receipt; revoked scopes/missing stop confirmation
do not turn into successful cancellation. Reconciliation is observational, may
use a newly regranted read-status scope for the same machine/root, and cannot
authorize a new write. Owner actions still use the recorded Bot/Task/attempt.

No model request or separate USD invoice is created for filesystem IO. Outer Bot
model calls retain their original receipts. Tests use real isolated Agents/native
journals: CAS writes, duplicates/conflicts, lock exclusion/independent reads,
revocation races, lost response, Host cold recovery and observation-only reconcile.
Product facade/tool/catalog/plan wiring and regression are part of this work.
