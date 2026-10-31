// Test-only claim holder: pins a physical root and parks, so the parent
// process observes a live cross-process claim. Killed with SIGKILL by tests
// that also verify stale-claim reclamation; never touches real user data.
import { writeFile } from 'node:fs/promises'
await import('../../remote-computer-agent/build.mjs')
const { WorkspacePin } = await import('../../remote-computer-agent/dist/index.mjs')
const [root, ready] = process.argv.slice(2)
const pin = await WorkspacePin.capture(root)
await writeFile(ready, JSON.stringify({ pid: process.pid, key: pin.identity.key }))
setInterval(() => {}, 1000)
