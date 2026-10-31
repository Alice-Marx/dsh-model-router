# File-write cancellation effects checkpoint

The E64 root run exposed a deterministic misclassification in `Agent.write`:
all `WRITE_CANCELLED` failures were persisted with `possiblyApplied: true`,
including cancellation before the target `rename`. Stopping the in-process write
chain and proving that the target was not published are different facts.

The three existing cancellation throws in `Agent.write` are all before the
atomic target rename. They will carry an internal `possiblyApplied: false`
classification. The terminal catch accepts false only for that explicit
`WRITE_CANCELLED` combination; every other failure remains conservatively true.
The successful-result cancellation branch after `rename` remains true and keeps
its output digest. No stop-receipt schema, Host provenance, admission trigger or
retry rule changes.

Tests retain the original pre-write cancellation assertion and add a barrier at
the second target read, after temporary-file creation but before the final
pre-rename check. A complementary barrier after the real write returns verifies
that cancellation after publication remains `possiblyApplied: true` with the
content and digest preserved. Independent stop receipts are checked against the
canonical operation hash and repeated status/cancel observation.

The Host stop-proof suite additionally checks that a bound cancelled receipt can
project `possiblyApplied: false`, while the same bare value without a valid
independent receipt stays unknown and conservatively true. A naked false never
becomes stop evidence. No external-writer CAS, temporary-file side-effect proof,
parent/leaf pinning or complete filesystem isolation is claimed.

Validation includes the focused workspace/cancel/remote-write suites, all six
E64 stop-proof suites, the full root command and three-platform focused checks
where applicable. There is no real model inference or release operation.
