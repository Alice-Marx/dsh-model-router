# Agent workspace admission and controller ownership

Before the model-facing command Task facade, close same-build controller and
workspace races. The current PID file alone has a stale-owner race: two cold
starters may both read the dead PID, and the later starter can unlink a new live
owner's file. First add a separate private SQLite semaphore connection holding
BEGIN IMMEDIATE for the controller lifetime. Kernel file locks release on real
process death; business journal writes use their existing separate database.
Admin-only management connections remain separate. Preserve the PID file for
legacy compatibility, but remove it only when it is still this instance's inode.
Older binaries do not know the semaphore: mixed-version startup still requires
the installer/maintenance stop protocol, not a claim of retroactive coordination.

Next reserve mutating workspace operations against the actual canonical root
identity in one Agent journal transaction. Root aliases/overlaps must conflict,
reads and disjoint roots continue, and unknown commands retain their reservation
until the original process/container is confirmed stopped. Do not expire a write
lock merely because wall time or a lease elapsed. Check each mutating entry,
including Git/native paths; container configuration must not silently run Git
under the Agent's privileged account.

Pin the selected directory through a real descriptor/verified mount transition,
hold it until Docker start acknowledges, and recheck the actual bound identity.
An admission scan is not itself directory pinning. Keep worker UID/permissions
explicit and refuse unreadable/unwritable layouts; do not chmod/chown a user's
existing project to make a test pass. The Task facade stays disabled until its
root/config/grant binding, independent branches, cancellation and cold original
operation observation meet the complete contract. Windows has its own boundary.

Use real child processes and native SQLite for stale-PID simultaneous cold start,
abrupt owner death, identity-safe close and admin coexistence. Retain a failing
pre-change witness, then validate all supported OS machines and the actual Linux
container suite. No real model requests or user profile operations.
