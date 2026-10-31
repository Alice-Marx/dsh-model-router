# Consistent single-ledger backup and complete private export

This is the next W06.3 component after E48. It accepts an explicitly owned open
SQLite connection, never an arbitrary model-supplied path or SQL. It neither
stops a Host nor activates/relocates a database. The connection is borrowed and
must remain open; callers cannot start while it is already in a transaction.

Create a new restricted owner-only directory outside the source database tree.
Reserve an empty destination, use SQLite's online backup API (including committed
WAL pages), close the destination after integrity/FK checks, then fsync and hash
the standalone backup. Export from that backup inside one read transaction,
including every table, index, trigger, view, sequence, column definition and row.
Retain rowids and lossless SQLite integer/blob/null/text/real values. Unknown
columns and extension tables are retained; future user_version or unsupported
virtual tables fail explicitly. Never execute exported SQL or interpret payloads.

The private export includes all Task/plan/package/attempt/operation/outbox,
command deduplication, dependencies, admission intents, references, reconciliation,
events, leases/locks, money, holds, funding projections and raw receipts. It is
an exact database export, not a filtered UI projection or an old JSON rollback.
Bounds on database pages, schema items, rows, individual values and encoded bytes
plus cancellation prevent unbounded work. Failures preserve incomplete private
artifacts without a completed manifest; existing destinations are never reused.

Write and read back the logical export, then write a completed manifest only
after both artifacts are verified. A verifier reopens the backup read-only,
checks integrity and re-exports it to compare with the private logical artifact.
Public results contain only bounded aggregate counts and explicit safety flags;
SQL, row data, file names, source paths and digests of real user data stay private.

SQLite backup gives one database-consistent time point. It is not a stop receipt,
a snapshot spanning Bot state/Sessions/other databases, or proof all writers are
gone. Capturing active/unknown work is permitted for preservation, not permission
to activate a migration or rollback. Existing source/backup absolute paths and
epoch markers inside router_migration are retained verbatim; the backup must not
be opened as an activated authority at a new location. No rollback gate changes
until all domains and current task data can be recovered/reconciled.

Offline tests must cover a real schema4 router/journal with all retained rows,
WAL-only committed data, uncommitted writes, repeated fresh export after new data,
int64/blob/quoted names/WITHOUT ROWID/generated columns, bounds, cancellation,
future schemas, private permissions, tampering and unchanged borrowed connection.
No real user profile is backed up or changed by these tests.
