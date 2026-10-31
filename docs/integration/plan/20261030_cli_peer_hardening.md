# CLI native-peer supervisor hardening

E61 delivered the atomic Job-list admission, the creator watchdog and the
legacy-orphan reclamation for `packages/cli-runtime/src/native-peer.ps1`. The
KIMI handoff §6.2 listed the four boundaries that remained open after an
independent static review; this checkpoint closes them inside the same
supervisor with real-machine fixtures. The E61 conclusions, the pipe framing,
the peer owner/tree verification, the stop accounting and the short-lived
identity checks are unchanged.

1. **Bounded stdin relay.** The relay to the child is now a bounded queue
   drained by its own thread. A child that stops reading fills the queue and
   the child pipe; the host loop observes a bounded `TryAdd` timeout, answers
   `stopped` with reason `input-stalled`, terminates the job tree with 137 and
   still reports `treeStopped`. A broken pipe (the child died first) only ends
   the drain thread; the loop observes the exit and keeps the graceful frame.
   Deadline, EOF cancellation and the oversized-line refusal are unchanged.
   A synchronous `WriteLineAsync().Wait()` alternative was rejected: on a
   synchronously opened handle the write runs inline, so the timeout would
   never be observed.
2. **Handle-ownership transfer.** `OwnStream` clears the raw pointer before
   the `FileStream` is constructed and closes the safe handle exactly once if
   construction fails, removing the raw-pointer/safe-handle double-close
   window on both pipe ends.
3. **Restricted inheritance.** `CreateProcess` now carries
   `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` (0x00020002) alongside the Job list,
   so the child inherits exactly its stdin/stdout pipe ends plus a private
   inheritable duplicate of stderr instead of every inheritable handle in the
   supervisor. The constant matters: 0x00020001 is a reserved number that
   both real Windows machines reject with ERROR_NOT_SUPPORTED — this was
   reproduced and fixed during the checkpoint, not assumed.
4. **Fixture symmetry.** The helper-death matrix gains the `preCreate` stage
   (dying before creation must leave no child and no created gate), the legacy
   gate now reclaims a suspended child by exact PID/FILETIME recovered from
   the raw file when the gate JSON cannot be parsed, and two new production
   cases cover a real never-reading child and relay writes racing a fast
   child exit.

This remains process containment by a Job object, not an account, AppContainer
or filesystem boundary; the handle list restricts accidental inheritance by a
same-user child but is not a defense against a malicious same-user process.
Verification: the CLI suites on both real Windows machines, the full local
root regression, and Ubuntu explicit-skip evidence for the Windows-only
machinery. No model inference, no release.
