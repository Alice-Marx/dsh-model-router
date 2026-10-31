# CLI native-peer Windows Job creation checkpoint

`packages/cli-runtime/src/native-peer.ps1` is a separate supervisor from the
Agent `native/windows-desktop/ProcessJob.cs`. Its suspended `CreateProcess` is
currently followed by `AssignProcessToJobObject`; killing PowerShell between
those calls leaves an unowned suspended child and can leave inherited stdio
open. Agent E59 does not verify this helper.

The first permanent fixture reproduces that exact legacy order in a generated
copy of the real CLI script. The gate records kernel process identity and Job
membership before the assignment. Cleanup uses the owned process handle and
exact creation FILETIME, never a process-name kill. The legacy fixture must
show that its child survives helper death before it is explicitly reclaimed.

The production helper will use `STARTUPINFOEX` and
`PROC_THREAD_ATTRIBUTE_JOB_LIST`, with `KILL_ON_JOB_CLOSE`, so CreateProcess
establishes Job membership atomically. Unsupported systems fail closed; there
is no fallback to post-create assignment. `IsProcessInJob` verifies the result
before the child is resumed. The existing suspended creation, `CREATE_NO_WINDOW`,
anonymous stdin/stdout pipes, base64 CLI-output channel, control framing,
deadline/cancellation semantics and `ActiveProcesses` stopped evidence remain.

The supervisor also opens its actual creator's kernel process handle, validates
creation time, and watches it together with a private shutdown event. Creator
death terminates the Job and exits the helper without fabricating a graceful
`stopped` frame. The creator is checked before creation and again before Resume.
Normal cleanup signals and joins the watchdog before closing any handle being
waited on. Attribute-list cleanup is conditional and the Job handle closes last.

Console JSON input/output is explicitly UTF-8 before the first request is read.
The production script has no barrier request field, environment switch or test
delay. Test-only copies are generated from unique source anchors under an
isolated `tmp/integration` directory; anchor drift fails the fixture.

Independent real Windows fixtures cover the legacy failure, helper death after
atomic creation and after resume, actual creator death before creation/after
creation/while descendants run, exact Unicode argv, nonzero exit and normal
containment/stop evidence. Existing native CLI bridge, installed official Codex
no-inference protocol and Agent Windows Job suites remain separate regressions.

This is cooperative process containment, not a Windows account, AppContainer,
filesystem boundary or completed model-facing command backend. No real model
inference, user profile change, installer change or frozen vendor change is
part of this checkpoint. Full remote CLI/PTY/write facades and product
acceptance remain open.
