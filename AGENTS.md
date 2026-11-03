# Unified model-router product

- This package is the desktop app's only Bot runtime. Do not mount `ds-bot` beside it or create another agent loop.
- `modules/bot-runtime/vendor/ds-bot/` is synchronized from `../ds-bot/`; do not edit it directly. Run `node scripts/sync-ds-bot.mjs`, or `npm run build:client` to synchronize it and rebuild `.dsh-plugin/client.js`.
- `.dsh-plugin/client.js` is generated. Check it with `npm run check:client`; never edit it by hand.
- Model, tool, machine and funding authority comes from committed Host state. Do not accept authority, executable paths, endpoints, credentials or operation identity from model arguments.
- Human advanced workbench RPC and model-originated tools share the same policy. Owner RPC requires an authenticated owner; Bot routes stay restricted to their committed grants.
- Remote writes, commands, browsers and desktops keep durable task/attempt/operation identity. Unknown outcomes are reconciled, never blindly replayed. Stop requests are not stop confirmations.
- Keep test homes and credentials out of user DSH data and Git. Use isolated `tmp/integration/` directories and offline fixtures. No real model calls are needed for the test suite.

## Checks

```sh
npm install --include=dev
npm run build:client
npm run check:client
npm test
node scripts/integration-product-source.mjs
npm --prefix remote-computer-agent ci
npm --prefix remote-computer-agent run build
```

The desktop app in `../app/` must also pass `npm test`. Its Host uses the bundled plain Node on every platform so `better-sqlite3` and PTY native modules never load through Electron's ABI. Packaged checks must open SQLite for real.

Update both README translations when changing user-facing behavior. Do not publish a preview as a stable release, create tags, or synchronize releases unless the user explicitly asks.
