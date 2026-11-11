// Apache-2.0 attribution for code ported into packages/bot-acp.
//
// The ACP (Agent Client Protocol) client core in packages/bot-acp is ported and
// re-grounded from OpenMausBot at pin
// 1bc4749aa8307d7d6998bf86de4ef6478460dd93 (Apache-2.0):
//
//   server/drivers/acp/core.ts          shared ACP driver core (session/turn state machine)
//   server/drivers/acp/host.ts          AcpHost/AcpLink JSON-RPC stdio host and routing
//   server/drivers/acp/turn-state.ts    turn end classification (endTurn, trackRunningTool)
//   server/drivers/acp/question-requests.ts  question request parsing and fail-closed reply
//   server/drivers/acp/rpc-error.ts     wire error to Error mapping
//   server/drivers/acp/session-reports.ts   usage/session report readers
//   server/drivers/acp/session-model-controls.ts  session model/config option controls
//   server/drivers/acp/config-options.ts     config-option readers (model/variant)
//   server/drivers/acp/custom.ts        custom-ACP engine support shape
//   server/testing/fake-acp-cli.ts      ACP wire shapes used by the offline fixtures
//
// Copyright 2026 OpenMausBot contributors. Licensed under the Apache License,
// Version 2.0 (the "License"); you may not use these files except in compliance
// with the License. You may obtain a copy of the License at
//     http://www.apache.org/licenses/LICENSE-2.0
// The full license text is preserved verbatim in LICENSE-OpenMausBot.
//
// Modifications in this repository: the port is a standalone, Host-bound adapter
// with no product composition wiring; permissions, cancellation, identity and
// funding evidence are re-grounded on this repository's own Host contracts
// (capability-broker authority, cli-runtime native supervisor).
