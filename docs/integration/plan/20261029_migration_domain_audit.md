# Migration reference and financial reconciliation

Continue W03.4/W06.3 after E48–E50 without applying real configuration. Byte
preservation is necessary but cannot prove the runtime will keep identity and
references. Add two owner-only, read-only audit layers over private artifacts.

Financial audit reuses inspectRouterState, spending, subscription quantities and
reservationSpending from the existing money authority; it does not compute a new
invoice, run a writer or normalize the source file. Retain every raw run/hold,
unknown value, archive, attribution and extension. Compare explicit calendar
context, daily/monthly API/reference/subscription quantities, incomplete markers,
raw records, all ledger tables and unassigned history. A legacy global budget 0
is unbounded; missing is unconfigured. Never duplicate a global amount per Bot.
DS usage v2 is preserved separately, including auxiliary metered rows, owners of
deleted Bots and its scan cursors. Token rows are not a second USD receipt.

Reference audit reads only a verified selected-tree capture and explicit owner
layout. Use the fixed rc.3 SDK's pure Session format catalog with strict physical
decoding/current validation, never a persistence backend that migrates files.
Plain and independently framed Zstd generations must have bounded decoded size;
native decompression may consume just the first frame, so check input consumed
and decode every frame, rejecting trailing/torn bytes. Keep all raw generations.
Validate complete frame/header/block/checksum boundaries independently before
native decompression: older Node releases accepted an incomplete final frame.
The boundary parser follows [RFC8878 sections3.1.1.1–2](https://www.rfc-editor.org/rfc/rfc8878.html#section-3.1.1.1),
with decoded/window limits; skippable frames are refused in this Session layout.

Check Bot/Main/group/member/Agent/part references, Session parent/child closure,
attachment digest/size/object paths and secret scopes. Missing, duplicate,
ambiguous or future/unsupported references remain explicit diagnostics. Unknown
extensions and data domains are retained and reported for review, not discarded.
Never execute expressions, tools, plugins or a model. Public summaries use only
fixed codes, bounded counts and safety flags; identities, paths, values and data
digests stay in owner-only artifacts.

Even an equal before/after audit is not a stop receipt or permission to activate.
Shared launchers, all domains, database consistency, OS metadata, program artifact
verification, recoverable apply and rollback remain independent gates.

The decoder runs in an isolated Worker (256MiB old generation, 16MiB young,
15s deadline), with at most two active and eight queued per process. Source bytes
32MiB, decoded bytes64MiB, individual row4MiB, JSON nodes4million, events100000,
references10000 and frames4096 are independent bounds. A dense valid record over
one million nodes is supported without removing the heap or byte limits.

Historical header inspection first uses the SDK historical catalog. Freeze the
latest captured child facts before replaying any parent, then use the official
child-aware catalog (including an explicit empty array). Unknown descriptors
remain visible; no child is invented or reclassified as continuable. A future
named generation prevents fallback to an earlier successfully decoded file.

The JSON v4 authority marker selects SQLite. A leftover/partly initialized SQL
file beside a legacy JSON v1–v3 is preserved as data, never automatically chosen
as the authoritative ledger. DS usage initializes lazily; absence of that file
does not mean historical model calls or spending were zero.
