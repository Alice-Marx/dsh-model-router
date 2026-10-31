# Private selected-tree capture before migration

E48 provides a bounded read-only inventory; E49 provides a consistent standalone
ledger snapshot. This component captures every regular file and empty directory
in the explicitly selected inventory, plus the complete ready configuration
plan. It never changes source data or activates the target.

Revalidate the original inventory/configuration, create a new owner-only private
directory outside all selected data, profile, home, workspace, source-file and
bundle roots, and copy with exclusive destination creation. Source descriptor
identity and streamed bytes must match the preview; links, special files and
hardlinks are explicitly unsupported here. No implicit exclusions, ID rewriting
or overwriting an existing destination. Retain original source modes privately,
while all archive copies have owner-only permissions. Existing Windows ACLs are
not captured/restored by this component; that remains a future restore gate.
Only ordinary primary file streams are captured: NTFS alternate streams, xattrs,
ownership and original ACL restoration are additional OS metadata gates.

After fsync/readback, inventory all copied domains and compare their relative
structure/content with the original. Revalidate source/configuration again and
write the complete manifest only after successful verification. Partial captures
remain private with no completed manifest. Verification reads only the archive,
so later legitimate source changes do not invalidate preserved bytes; it never
opens an original source path or executes a plan/payload.

Raw SQLite files are identified by their header and retained byte-for-byte along
with all other files. This is preservation, not a consistent live database copy.
E49's online snapshots remain separate. Matching pre/post hashes do not establish
a cross-domain stopped-writer point. Always return crossDomainConsistent=false,
databaseConsistent=false, requiresStopProof=true and applySupported=false.

Restore/apply must separately verify the trusted retained plan/manifest identity,
all domains and references, database snapshots, ownership/permissions and writer
stop receipts. Internal hashes alone are not an authenticated origin signature.
Nothing in this component loosens rollback guards or authorizes a generation move.

Offline tests cover complete unknown/private-looking file names, empty folders,
config preservation, destination/source and junction conflicts, drift, hardlink
refusal, limits/cancel, tampering, fresh versus old captures, permissions and
verification while original paths no longer exist. A private owner capture may
be attempted only after tests pass; never upload real profile/data to test hosts.
