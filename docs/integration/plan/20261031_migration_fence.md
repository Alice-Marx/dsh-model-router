# Migration exclusive-fence prototype (stop-fence slice 2)

Slice 2 of the stop-fence design (section 6): a single-machine admission and
exclusive-fence protocol for controlled hosts, on synthetic test homes only.
It coordinates processes that **participate in the protocol**; it does not
constrain old programs or third parties (that is slice 4), does not touch user
data, and does not advance `activationSupported`.

## Authority layout (inside a synthetic home)

```
<home>/fence/guard/           short-lived mutex directory (O_EXCL mkdir)
<home>/fence/guard/owner      {pid, startTicks} of the mutex holder
<home>/fence/intent.json      durable maintenance intent {operationId, ...}
<home>/fence/shared/<pid>-<ticks>.json   live shared admissions
<home>/fence/exclusive.json   the exclusive claim {operationId, pid, ...}
```

## Protocol

- **Shared admission** (a new-style host before creating any writer): take the
  guard mutex; if `intent.json` or `exclusive.json` exists → refuse
  `MIGRATION_MAINTENANCE_ACTIVE`; otherwise create the shared claim; release
  the guard. The check-and-create pair is atomic under the guard, which is
  the verified closing of the read-gate → create-writer gap the design
  demands.
- **Exclusive** (the migration coordinator): under the guard, persist the
  durable intent (this alone blocks every new shared admission, across
  coordinator death); then drain: every live shared claim whose owner is
  alive is waited for, dead owners' claims are reclaimed with owner-file
  identity discipline; when zero live shared remain, re-take the guard,
  re-verify the intent is ours and no shared claim appeared, and create the
  exclusive claim.
- **Release**: under the guard, remove the exclusive claim and the intent;
  shared admissions flow again. An unknown operationId never releases
  someone else's fence.
- **Crash takeover**: the intent is durable, so a crashed coordinator keeps
  blocking new writers. A takeover coordinator re-claims a stale exclusive
  claim only after verifying its owner pid is dead (Linux start-ticks make
  the pid identity reuse-safe; Windows keeps pid-only identity as a
  documented prototype limitation), keeps the intent, and re-runs the drain.
  A live foreign coordinator answers `MIGRATION_FENCE_BUSY`.
- **Guard discipline**: the mutex is a claimed directory with an owner file;
  a dead owner's guard is reclaimed after identity verification; every
  acquisition is bounded and abortable.

## Honest limits

Participation is voluntary and same-machine; pid liveness is not a kernel
write barrier; Windows claims carry no start-tick identity; nothing here is a
stop-write proof for old programs, and `stopWriteProvable`-style honesty is
kept by refusing to claim any such thing. Verification: real child-process
holders (shared, late-acquire after exclusive, concurrent coordinators,
crashed coordinator takeover) on Windows and Linux machines, plus the full
local regression.
