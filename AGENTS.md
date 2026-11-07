# Unified model-router product

- This package is the desktop app's Bot runtime. Integration mode reuses Harness Sessions; independent mode uses `packages/orchestration/src/bot-loop.mjs` with `bot-session-store.mjs`. Never let both serve the same Bot: a Bot is moved atomically and the old path goes read-only first.
- `modules/bot-runtime/vendor/ds-bot/` is pinned to DS Bot 0.2.7, commit `71d344bf193f3f18185f25de3d8e5c483046910a`. Do not edit it directly. Product changes belong in `modules/bot-runtime/product-overlay/`; `SOURCE.json` records upstream/overlay origins and hashes. Import only from an explicitly named checkout: `node scripts/sync-ds-bot.mjs --source ../DS-Bot-upstream --source-commit 71d344bf193f3f18185f25de3d8e5c483046910a`. Verify with `node scripts/sync-ds-bot.mjs --check --source ../DS-Bot-upstream --source-commit 71d344bf193f3f18185f25de3d8e5c483046910a`. Without an external checkout, `node scripts/sync-ds-bot.mjs --check` validates the recorded vendor bytes; it must not guess `../ds-bot/`. `npm run build:client` rebuilds from the pinned source/overlay and generates `.dsh-plugin/client.js`.
- `.dsh-plugin/client.js` is generated. Check it with `npm run check:client`; never edit it by hand.
- Model, tool, machine and funding authority comes from committed Host state. Do not accept authority, executable paths, endpoints, credentials or operation identity from model arguments.
- Human advanced workbench RPC and model-originated tools share the same policy. Owner RPC requires an authenticated owner; Bot routes stay restricted to their committed grants.
- Remote writes, commands, browsers and desktops keep durable task/attempt/operation identity. Unknown outcomes are reconciled, never blindly replayed. Stop requests are not stop confirmations.
- Keep test homes and credentials out of user DSH data and Git. Use isolated `tmp/integration/` directories and offline fixtures. No real model calls are needed for the test suite.

## Checks

```sh
npm install --include=dev
node scripts/prepare-native-driver.mjs
npm run build:client
npm run check:client
npm test
node scripts/integration-product-source.mjs
node scripts/check-readme.mjs
node --test tests/readme-math.test.mjs
npm --prefix remote-computer-agent ci
npm --prefix remote-computer-agent run build
```

The desktop app in `../app/` must also pass `npm test`. Its Host uses the bundled plain Node on every platform so `better-sqlite3` and PTY native modules never load through Electron's ABI. Packaged checks must open SQLite for real.

Update both README translations when changing user-facing behavior. Preserve all six formula anchors and 33 paired inline mathematical expressions; update `README.i18n.yaml` with exact Git blob hashes after both texts are final. Label local verification builds separately from published versions. Do not publish a preview as a stable release, create tags, or synchronize releases unless the user explicitly asks.
