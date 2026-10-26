# Combined DSH host fixture

This fixture runs both frozen DS Bot and the current MR checkout through the
official `dsh` CLI and a private Web profile. It does not patch DSH or DS source.
The SDK dependency graph is pinned by `../integration-host/pnpm-lock.yaml`.

From the project root, after installing that fixture and checking out the frozen
DS commit recorded in `docs/integration/baseline.json`:

```sh
node scripts/integration-combined-host.mjs --ds-root tmp/integration/upstream/ds-bot-frozen --host-root tests/fixtures/integration-host
```

The command creates an unused loopback port and a fresh `DSH_HOME` under
`tmp/integration/combined-host/`, registers an in-process offline model, and checks:

- Both plugins load and share the actual DSH tool registry and model directory.
- A Main Bot's AgentLoop creates a worker, whose AgentLoop calls MR's route tool.
- A Main-to-worker dispatch and its reply use DS delivery and real Sessions.
- Recorded model routes stay exact; each Bot receives token usage from fixture
  chunks. The fixture also answers memory-review calls outside AgentLoop.
- A fresh host process restores Bot identities, models and exchange history.
- Owned processes exit after the check. Logs redact temporary login URLs.

No actual provider request occurs. Other model adapters, title inference and
telemetry are disabled in this profile; external `fetch` calls are refused. The
child does not inherit model credentials, `NODE_OPTIONS`, or the user's home.
This is test isolation, not an OS security sandbox. MR's installed-tool discovery
may inspect CLI versions and login status if its workbench is opened.

Add `--serve` to keep the already-tested host alive for browser inspection. Its
private `browser-access.json` stays under the run directory. Write `stop` to a
file named `stop` in that same directory to finish; a bounded timeout also stops
the host. Never copy login URLs, cookies or private machine settings into Git.

The command reports existing legacy MR tool exposure separately. It does not
install the future Bot policy, unified ledger, CLI bridge or remote agent, and
does not prove browser, Electron, GUI control or real-model acceptance. Browser
evidence and real-machine results are recorded separately in the project.
