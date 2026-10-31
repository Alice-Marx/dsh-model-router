# Captured workspace registry audit

Continue E51 using only the retained owner-private capture. Read the explicitly
selected `workspace.json` single-unit document; source platform and preserve-in-place
policy are explicit. Current fixed rc.3 `workspaceDomainSpec` supplies version2
and pure global/record schemas. Do not instantiate WorkspaceRegistry, open a
storage backend, bootstrap history, recover pending mutations or normalize paths
against the live filesystem: those paths can write or consult original data.

Keep raw document digest and parsed registry order, stable IDs, titles, paths,
timestamps, session order, global archived/pinned sets and historical default ID.
Check SDK accounting invariants: unique order with matching rows, unique paths,
one workspace accounting slot per Session. Distinguish an intentionally retained
deleted defaultWorkspaceId from a dangling active team workspace reference.
Pending mutation/uninitialized state require recovery context; do not repair them.

Resolve retained Session headers and check declared cwd against the stored
canonical workspace path. Unequal spellings need explicit canonical path evidence,
not guessed case folding or a live filesystem lookup. Equal strings prove saved
reference consistency only, not path existence/access rights or stopped writers.
Preserve unknown extension fields/tables by raw capture and report them. Future
versions, malformed/schema-invalid documents, missing sources and unsupported
layouts cannot fall back to a fabricated empty registry. All-domain closure,
original filesystem metadata, cross-domain consistency and recoverable apply
remain separate gates; applySupported=false and requiresStopProof=true always.
