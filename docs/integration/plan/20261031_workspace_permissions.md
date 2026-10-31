# Real workspace permissions and cross-dataDir coordination

CODEX P0 item 3 remainder after E68 (generations): the real ownership boundary
of managed workspaces under container UID 65532, and coordination between
Agents with different data directories on one host. Two parts, both Linux
(the container/worker path); Windows descriptor publication stays open as
before.

## A. Managed-workspace permission contract (probe, not a mutation)

The container runs as root with every capability dropped except SETUID/SETGID
and re-executes the model-facing program as 65532:65532 inside a read-only
filesystem whose only writable mount is the workspace bind. This means the
**real on-disk permissions are the whole boundary**: nothing in the Agent
loosens, chmods or chowns user data, ever.

The contract this checkpoint verifies on a real machine:

1. **Operator grant**: an operator may pre-grant container access to a
   workspace root (group 65532 with rX/w, or world bits). A worker command
   against such a root succeeds and its writes carry the worker's own
   identity semantics (files created as 65532).
2. **Fail closed on private files**: an agent-owned 0600 file without a group
   grant is unreadable by the worker; the command fails closed and the
   private bytes never appear in artifacts.
3. **Agent dataDir isolation**: the Agent's own dataDir (0700, agent user) is
   on the same filesystem but outside the mount and outside the grant; the
   worker cannot read it even by path.
4. **No escalation**: dropped capabilities plus uid 65532 mean a worker that
   meets an inaccessible file cannot chmod/chown its way in.

A standalone probe script (same shape as the existing isolation probe) runs
these four cases against real Docker on the Linux host and writes an evidence
summary. The fixtures prepare only their own trees.

## B. Cross-dataDir physical-root coordination (kernel advisory lock)

`WorkspaceAdmissions` serializes writers inside one Agent dataDir. Two Agents
with different dataDirs on the same host share no database, so the same
physical root could be admitted by both. Design:

1. On Linux, `WorkspacePin.capture` takes an exclusive non-blocking `flock`
   on the held directory descriptor. The lock is on the inode, so aliases and
   re-created paths resolve to the same exclusion; the fd closes with the
   pin, releasing the kernel lock exactly when the operation's pin closes.
2. `flock` conflicts even between two descriptors of the same process, so a
   process-local registry keyed by the physical identity ref-counts nested
   captures (the container shell path legitimately re-pins the cwd already
   pinned by `withWorkspace`). The outermost capture holds the kernel lock;
   inner captures share it; only the outermost close releases.
3. A conflicting lock surfaces as the existing public `WORKSPACE_BUSY`; a
   second Agent process (different dataDir, different database) now fails at
   the kernel boundary instead of silently overlapping. The per-dataDir
   journal, stop-evidence and release semantics are unchanged.
4. Windows keeps path-based admission only (no directory flock on this
   path); it stays documented as an open boundary, not a claim.

Verified by: a two-process Linux fixture (a child process holds the pin; the
parent Agent answers WORKSPACE_BUSY on the same physical root through a
different dataDir), a nested-capture case proving no self-deadlock, and the
existing workspace suites staying green on all platforms.

No model inference, no user-data mutation outside the probe's own fixtures,
no release.
