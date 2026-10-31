# Remote Agent private paths inside an authorized root

The Host may authorize a parent directory that contains the Agent data directory
or the desktop pipe secret. Authorization of that parent must not expose those
control files through `fs_read`, `fs_list`, writes, or Git worktree export.

`Roots` accepts Host-only protected paths. Agent always supplies its data directory
and configured desktop secret. Public siblings remain usable; private entries
are omitted from directory listings. Both lexical and real paths are checked,
including paths whose final secret has not been created yet. Creating/replacing
an ancestor of a private path is refused. Root lookup requires an own property.

Reads check the opened descriptor and the current name. A multiply linked file
is compared with protected file identities (device/inode), scanning protected
directories without following loops. The scan is bounded; ambiguity or overflow
refuses the read rather than discarding protection. There is no inode cache that
could become stale after a new hard link or secret rotation. Worktree operations
refuse a tree containing private state before invoking Git. An ordinary file read
does not reject the entire public parent tree.

Verification: direct and aliased control files, hard links, missing future secrets,
private ancestor replacement, public siblings, case handling on Windows, root
prototype properties, and Agent construction. All fixtures use generated offline
secrets and isolated data. No real user credential is read by these tests.

This is an application API boundary. A shell executable running under the same OS
account is not isolated by path checks; OS-account/container execution remains a
separate acceptance gate. Concurrent adversarial filesystem mutation also needs
an OS boundary; the descriptor checks do not claim a kernel filesystem sandbox.
