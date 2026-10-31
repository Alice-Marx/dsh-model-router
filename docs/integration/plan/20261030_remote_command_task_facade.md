# Remote container command Task facade: design and open gates

Status: design only. The existing Agent container controller is a component; it is not yet a Bot-facing command Task backend. This document does not authorize switching on that backend or relaxing the current file, workspace or migration guards.

## Agent protocol and binding

Use a distinct, versioned command tool such as `container_command_v1`. An older Agent must reject an unknown tool before starting work. An optional field on `shell_exec` is insufficient: an older or differently configured Agent could ignore the field and run a native process. The new handler must check its own actual Linux container mode and the selected immutable image/configuration at dispatch, fail closed on unsupported or changed configuration, and never call the native shell path.

The initial Task contract contains only the bound machine and root, bounded relative workspace, owner-approved command alias, bounded argument array and deadline. Reject endpoint, credentials, arbitrary host executable, Docker flags, environment variables and arbitrary script fields. Bind the Agent configuration, machine/grant revisions and physical root identity to the original attempt. A deterministic configuration digest is useful for change detection, not proof of a kernel boundary or durable ownership. Command Tasks are workspace-write until a stricter boundary is actually verified.

## Durable dispatch and stop evidence

Extend `task-contract.mjs`, `task-journal.mjs`, `task-service.mjs`, `remote-machines.mjs` and `remote-execution.mjs` for a separately versioned command target; preserve the existing remote-file contract and old journal data. Check the owner, Bot, machine, root, command/status/cancel grants and binding revisions at dispatch and observation. Persist the Task, attempt and exact original operation reference before sending. If dispatch may have happened but the response is lost, retain outcome-unknown and its workspace lock; recovery observes the same operation, never creates a replacement.

Cancellation targets the original container and keeps effects already applied. Require the original receipt to establish strict boolean `stopConfirmed` or `notStarted` before treating a process as stopped. Do not use a terminal status alone. Agent response hardening is recorded separately as E62 in the integration evidence directory; the future Task backend must independently validate the receipt, operation identity and output artifact authorization. Retain bounded-tail/truncation and possibly-applied information; cancellation is not rollback.

## Gates before product registration

1. Demonstrate version refusal and execution-time container-only enforcement, including configuration changes and an old Agent; no native fallback.
2. Establish the actual user-workspace permission and physical-root lifecycle, protected-path rules and stable ownership across aliases, parent/child roots, multiple Agents and external writers. Existing same-Agent workspace admissions and a prior bounded tree scan alone do not prove these guarantees. Do not change user workspace permissions merely to make a fixture pass.
3. Validate request binding, authorization, journal/outbox, dependency scheduling, original-operation recovery, receipt identity and unknown-lock retention with offline tests, including lost replies, revocation, cancellation and independent roots.
4. Exercise the same behavior through a real Agent and fixed-digest container in an isolated Ubuntu workspace, with actual process exits around create/start/receipt, changed paths, scoped artifacts and no replay. Preserve Windows as a separate OS-boundary task.
5. Only then connect the product Task/UI and verify status, cancellation and artifacts end to end. T11–T14, T19, T24 and T25 remain partial or unrun until their complete criteria are met; component tests cannot close them.

No real model calls are needed for these tests. Actual inference, billing and user workspace migration remain separate acceptance work.
