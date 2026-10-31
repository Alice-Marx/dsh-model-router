# Recoverable configuration commit and startup gate

Implement the file transaction used by the owner migration coordinator. Its input
is an explicit, reviewed set of configuration before/maintenance/after byte images;
it does not infer launcher completeness, stop another application, migrate money,
or authorize activation merely because a capture audit passed.

Persist a private immutable byte plan/backups and append-only hash-chained event
journal. A shared home gate is the activation boundary; the product checks it
before opening funds/Task/Bot writers. Prepared/maintenance/installing/validating/
rollback states refuse startup. Final committed/rolled-back state is written last.
Unknown, corrupt or redirected gate/journal data refuse rather than opening JSON.

All changes occur under one exclusive coordinator lock. Recovery may reclaim its
own dead local process lock, never a live/foreign owner. Persist write intent and
staged inode before changing a name. Retire the actual current file to a unique
same-directory name, then verify its identity/hash. Publish staged bytes with a
no-clobber hardlink, so a concurrently created file is preserved. A foreign value
is retained and blocks recovery; never overwrite it to make the journal match.
Source, destination, stage and retired paths cannot be links/redirected/hardlinked
inputs. Recheck names after descriptors and before each mutation.

Crash recovery accepts only planned original identities or journaled staged
identities/content, including a missing target with a verified retired original.
Repeated resume is idempotent. Pre-activation rollback restores original config
bytes and removes only verified files created by this transaction. After activation
the full latest-data/money export and rollback protocol is required; this file
component cannot revert active business data to a pre-migration snapshot.

This component's release gate remains separate: trusted owner coordinator must
prove all shared Hosts/launchers stopped/gated, complete domains and consistent
backups, program artifacts, permissions/OS metadata and money/location identities.
It is initially exercised only in isolated fixtures, including real process exits
at each intent/name/publication/gate boundary. File fsync/parent directory fsync
are used where supported; process-exit tests are not power-loss/OS metadata proof.
