# Persistent workspace roots-generation binding and invalidation

CODEX P0 item 3 ("真实工作区权限与世代") and the E58 limitation line ("Managed
workspace ownership/permissions and persistent root/config generation binding
remain open") define the gap this checkpoint addresses. Everything here is
Agent-side; the Host machine/binding contract is not modified.

## Problem

The Agent's `roots` config maps rootId → host path. Nothing persists which
roots configuration produced which durable workspace state:

1. `workspace_admissions` bind a physical root identity (dev/ino/birth +
   ancestors), but they do not record the roots config they were admitted
   under. After a restart with a changed roots config (a root re-pointed,
   added, or removed), surviving admissions, fences and any Host-side view of
   the machine keep being interpreted as if the configuration were stable.
2. A roots-config change between runs is currently invisible: the machine
   health/preview shows platform/version/capabilities, never the workspace
   configuration era, so a stale Host preview cannot be told apart from a
   current one.
3. Live operations that become `unknown` across a restart while their root is
   re-pointed linger without a defined reconciliation trigger.

## Design

1. **Generation digest.** `rootsGeneration = sha256(canonical(sorted
   [rootId, resolve(path)] pairs))` over the configured roots map only — not
   dataDir (a different dataDir is a different database entirely), not
   executables/shell (they do not change which physical trees the roots
   denote). Sorting by rootId makes the digest independent of key order;
   `resolve()` normalizes separators without touching the filesystem.
2. **Persistence.** The digest is stored in the existing Store `meta` table
   under `workspaceRootsGeneration`. First run records it. Later runs compare.
3. **Change handling (fail closed).** When a non-first run observes a
   different digest, every surviving admission whose operation is still
   unsettled (status `admitted/running/cancel_pending/unknown`, or a shell
   operation without settled stop evidence — the same liveness predicate as
   the legacy fence) is inserted into a new `workspace_generation_fences`
   table, the meta row is updated to the new digest, and an audit row
   `WORKSPACE_ROOTS_GENERATION_CHANGED` is written. The fence check in
   `withWorkspace` mirrors the legacy fence: while any fenced operation stays
   unsettled, new mutating workspace operations fail
   `WORKSPACE_RECOVERY_REQUIRED`; plain reads continue. Reconciliation uses
   the existing paths — once the fenced operation settles with stop evidence
   (or is admin-recovered), the fence goes inert; nothing is auto-rolled-back.
   The admission itself is not deleted by the fence: the physical lock record
   stays until its own terminal trigger.
4. **Pre-generation rows.** Existing admission rows predate the
   `roots_generation` column and are backfilled with `''`. A first run on an
   old database only records the digest and does not fence, because there is
   no observed change — fencing every upgraded deployment would turn a
   routine software update into a global write outage. Fencing happens only
   on an observed digest change, which is the event that actually invalidates
   interpretation of persisted workspace state.
5. **Admission tagging.** `workspace_admissions` gains `roots_generation`
   (`ALTER TABLE`, default `''`), recorded on every new admission for
   auditability. Replay of an old admission does not depend on the column;
   the physical identity conflict check is unchanged and stays authoritative.
6. **Preview exposure.** `machine_ping` gains `rootsGeneration`. The current
   Host validates only known fields and stores a fixed health projection, so
   the addition is inert today; it is the documented hook by which a future
   Host preview can show that its view of the machine's workspace
   configuration is from a different era. No current Host behavior changes.

## Scope and non-goals

- Real 0600 ownership under container UID65532, managed workspace
  ownership/permissions, cross-Agent dataDir coordination on one host,
  external-writer CAS, fs_write leaf/parent descriptor wiring and Windows
  descriptor publication stay open and unchanged.
- User projects are never chmod/chown-ed; fixtures keep preparing only their
  own trees.
- No model shell/command gating change, no Host remote-machines contract
  change, no release.

## Verification

A new native suite (`tests/workspace-generation.native.mjs`, real
better-sqlite3, Windows and Linux) covers: same-config restart keeps
admissions meaningful and does not fence (a surviving unknown admission still
yields `WORKSPACE_BUSY` on its root while other roots proceed); a changed
roots config fences new writes on every root with
`WORKSPACE_RECOVERY_REQUIRED` while plain reads continue and the audit row
exists; settling the fenced operation (terminal with stop evidence) makes the
fence inert and writes proceed; `machine_ping` exposes the digest and it is
stable across key order and changes with the config; new admissions record
the current digest. The suite enters `npm test` (and thereby Windows/Ubuntu
CI); existing workspace suites must stay green unchanged.
