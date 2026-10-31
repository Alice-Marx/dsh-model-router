# Stop-proof automatic regression checkpoint

E64 added `tests/task-retry-stop-evidence.native.mjs` and verified it manually
with the other five stop-proof suites, but did not register that new suite in
the root test command or CI. This checkpoint changes only `package.json` and
`.github/workflows/ci.yml` so the existing eleven journal/dispatch-fence checks
run with the normal root suite and on Windows and Ubuntu CI.

No Task, CLI, Agent, UI or acceptance semantics change here. E64 provenance,
unknown outcome, retry fencing and stop-versus-rollback rules remain unchanged.
The independent `workspace-agent.native.mjs` cancellation no-effects failure is
not hidden, skipped or reclassified by this registration checkpoint; it requires
a separate root-cause fix and evidence.

Validation is the focused eleven-test suite, the six-suite E64 aggregate, the
full root command, CI contract checks and tracking/document checks. Component
registration does not make the full product, any acceptance scenario or a work
package complete. No real model inference or release operation is involved.
