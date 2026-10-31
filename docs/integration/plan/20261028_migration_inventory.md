# Read-only migration data inventory

W03.4/W06.3 needs a byte-preserving inventory before backup or migration. The
Host explicitly selects all data domains; the tool never searches a user home
or guesses that an unknown directory is disposable. Each selected tree is
enumerated deterministically, including empty directories, with descriptor
identity checks and streaming SHA256. Root overlap, links, special files,
source changes and resource-limit exhaustion fail explicitly. Limits and an
AbortSignal bound work; no symlink is silently followed or omitted.

The private inventory contains selected absolute paths, relative names, file
identities and hashes. The public summary is a strict whitelist of aggregate
counts and safety flags: no paths, arbitrary labels, file names or content.
Source verification repeats the inventory and compares identities and bytes;
target reconciliation compares relative structure and content, allowing a
different destination root and file IDs. Both inputs remain untouched.

This is not a stop-writer proof or a transaction spanning domains. A live
SQLite main file plus WAL must not be copied using these primitives as though
they were a consistent database backup. Consistent SQLite backup, private
archive ACLs, identity/reference/domain reconciliation, migration gate,
recoverable apply, rollback and actual user selection remain separate steps.
No caller can turn a successful scan into `consistentSnapshot: true`.

Offline fixtures cover all files including unknown and private-looking names,
empty directories, content versus identity, drift, same-size edits, overlap,
links, explicit limits, cancellation, redaction and source byte preservation.

The project CLI is `npm run integration:migrate-profile -- --request <JSON>`.
It combines the configuration planner with optional explicitly selected data
trees. Without data selection it reports `needs-data-selection`; `preview-ready`
means the requested preview completed, not that a migration can be applied.
`--private-output` requires a new absolute directory outside selected source
trees. The parent must already exist and be controlled by the owner. No existing
directory ACL is modified. Before storing any private plan it applies Unix0700
or Windows current-user-only inheritable ACLs; stdout remains redacted. Private
plans must stay outside Git/npm/public evidence and model inputs. Writer stop,
consistent databases, complete domain selection and apply are still unsupported.
