# Capability broker experiment

This is an M0 experiment, outside the published plugin's exports and file list.
It is not installed in normal Bot, RPC, command or CLI execution. The product
still uses the existing runtime until its shared facade is implemented.

`src/authority.mjs` accepts a host-owned object identity, never a model-supplied
`botId`. Model routes use separate provider/model components. A short-lived lease
can narrow a subject's tools and binds task, attempt, machine, workspace ID and
local/remote location. Only its token hash is retained. Admission is bounded;
expiry, grant changes, revocation and release invalidate the lease and abort
active cooperative handlers. A late successful return is discarded. Aborting a
signal does not prove a native process or external side effect has stopped.

`src/managed-bridge.mjs` owns the lease and forks `src/stdio-bridge.mjs` with a
filtered environment and a private Node IPC channel. The child speaks MCP over
stdio using the pinned official SDK. It receives neither a lease token nor
model/machine credentials. Every list/call consults the parent authority; backend
argument parsing occurs before execution. Unknown tools and forged actor/machine
arguments are refused. Request sizes, pending requests and lifetime are bounded.
Standalone startup without parent IPC fails closed. Child cleanup is scoped to
the process launched by that bridge.

The test suite uses real SDK clients in legacy and modern protocol modes. It
checks distinct Bot grants, revoked calls/listing, forged arguments and MCP
cancellation through to the parent handler; normal shutdown must end the child
without forced termination. No test sends a model request.

```sh
node --test tests/capability-authority.test.mjs tests/capability-bridge.test.mjs
```

These modules do not yet provide a stable Bot principal shared by every Session,
persisted Policy, approvals, budget reservations, receipts, audit storage, machine
pairing, or process-tree cancellation. They are not an OS sandbox. The present
bridge requires a **direct** trusted parent. An official CLI starts MCP servers
as grandchildren: a private named-pipe/socket bootstrap with verified ownership
and bounded handoff must be implemented and tested before that path is usable.
Putting a bearer ticket in a command line or broadly inherited environment is
not an accepted replacement. See the [experiment contract](../../docs/integration/20261027_security_bridge.md)
for measured boundaries and remaining gates.
