# Isolated M0 DSH host fixture

This optional fixture installs the complete rc.3 DSH plus the frozen DS test tools.
It is not a product profile and must never use a real DSH home or model account.

```sh
pnpm --dir tests/fixtures/integration-host install --frozen-lockfile --strict-peer-dependencies --ignore-scripts
```

The lock pins all resolutions. `@opentelemetry/api` is overridden to 1.9.0 because
the current transitive telemetry packages require a version below 1.10.0. A fresh
unconstrained install selected 1.10.0 and failed strict peer checking. The override
is confined to this fixture; root/product dependencies are unchanged.

DS's upstream test resolver expects its Harness anchor to expose the peer packages
directly. pnpm's dependency-only layout does not put every transitive SDK at the
fixture root. Run the checked-in helper to resolve public package metadata and
create an isolated resolver anchor without patching DSH or frozen DS sources:

```sh
node scripts/integration-upstream-tests.mjs --ds-root tmp/integration/upstream/ds-bot-frozen --host-root tests/fixtures/integration-host
```

It checks the frozen commit and strips model credentials from the child environment.
The initial full-suite result and limitations are recorded in
`docs/integration/evidence/20261026_m0_ds_full.json`.

`--ignore-scripts` is intentional. Native tools and their platform execution need
separate probes; successful dependency installation does not prove all of them run.
