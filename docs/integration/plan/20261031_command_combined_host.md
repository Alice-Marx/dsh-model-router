# Combined-host container-command acceptance

E76 registered the remote-command backend, but its acceptance runs did not cover
an actual default-product AgentLoop submission. This checkpoint adds that
scenario to `scripts/integration-product-default.mjs` and the offline model
fixture.

On Ubuntu with `DSH_TEST_DOCKER=1`, the owned Agent uses the fixed container
image and the approved `node` alias must return exitCode 0, one original
operation, bounded artifacts and confirmed stop evidence. Elsewhere, the plain
Agent must settle `CONTAINER_COMMAND_UNAVAILABLE` as never-started with
`possiblyApplied:false`, no native fallback and no retained workspace lock.

The first run exposed a real registration gap beyond E76:
`product-composition.grantFor` published the backend but did not include
`remote/container_command_v1` in the Bot grant, so the AgentLoop received
`TOOL_DENIED`. The grant compiler now includes that capability only for a
workspace-write binding that also contains status and cancel. No policy is
relaxed. The task-backend catalog assertion now includes remote-command.

Validation preserves every previous product check and adds the real AgentLoop
submission. No real model inference, endpoint credential, user profile change
or release operation is involved. Combined-host success is still not a Windows
OS-isolation claim, a broader model-command policy decision or full-product
acceptance.
