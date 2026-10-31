# Remote command isolation and durable worker design

Implement command execution behind the existing remote Agent operation protocol.
Do not enable the Bot shell tool until its real execution boundary and original
operation recovery/cancellation are verified. Existing native mode stays explicit
and is never described as a private-state boundary. Windows Job Objects limit
process lifetime; they do not by themselves isolate readable user files.

First deliver Linux container workers, using the already frozen amd64 image
digest from the actual isolation probe. No image pulls or floating tag selection
at execution time. The owner selects a Docker executable/image and fixed
in-container executable aliases; tool callers supply only alias/argv or an
explicitly enabled in-container shell script. A container-only configuration must
leave the old native executable/shell fields empty, so older Agent code cannot
silently run those commands natively when it sees unknown container fields.

Bind only the selected authorized workspace. Verify protected-control-tree
exclusion before mounting it. Use no host network, Docker socket or home mounts;
read-only root filesystem and no-new-privileges. A fixed read-only trusted Node
supervisor runs as container PID1 with only SETUID/SETGID; it clears supplementary
groups and runs caller programs as65532:65532 with zero effective capabilities
and a clean environment. Its absolute deadline survives Agent process death;
the unprivileged child cannot signal or ptrace the different-UID supervisor.
Bound pids/memory/CPU/tmpfs/log storage and returned output. The extra mount is
only this verified public supervisor code, never Agent data or credentials.
Docker daemon and host administration remain trusted. Report configured,
available and measured boundaries separately from process-group/Job control.

Persist the operation's exact container name, unpredictable ownership label,
workspace/identity and create/start phase before issuing Docker actions. Record
the immutable container ID before start. Retain the container and bounded logs
until original operation receipts and output artifacts are durable. A crashed
Docker client is not proof the container stopped. Cancellation verifies the owned
container's terminal state; missing/unreachable control stays outcome-unknown.

On Agent cold reopen, inspect the original owned container and operation only.
Never create/start a replacement during status reconciliation. An absent
container after start intent is unknown; a proven pre-start record may terminate
without effects. Labels/IDs must match before observation, stop or cleanup. Save
terminal receipt and worker phase in one SQLite transaction before removing only
the owned stopped container. Unknown operations retain their workspace lock at
the Host Task layer. No external command/provider exactly-once claim is made.

Tests must include real Linux containers and Agent transport, Unicode/newline
argv, bounded output, nonzero exit/timeout, child process cancellation/revocation,
cross-Bot private-state and Agent-secret read refusal, lost reply, actual Agent
process exits around create/start/receipt boundaries and no reexecution. Only
after these pass should a tracked command Task facade expose the capability.
Windows requires its own account/AppContainer implementation and actual checks;
do not substitute Linux evidence for that boundary. Zero real model requests.

The initial controller is not the complete product command facade. In particular,
the authorized mount requires compatible original filesystem permissions, and a
bounded admission scan alone does not pin a concurrently replaced host subtree.
Full workspace ownership/locking/pinning and every exposed Git/native entry must
be reviewed before enabling model-facing commands. Keep that tool unavailable
until its complete contract is verified; do not describe configuration labels or
one negative read as proof of all OS/file race boundaries.
